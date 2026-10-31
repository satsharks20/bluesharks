// Performance analytics (proposal 3.2): predicted score with a range and trend, skills sorted by the
// points they cost, error patterns and timing. Every part ends with one next step and, where it
// helps, a drill that practises it (started with POST /api/practice/drills/bank).
//
// Read from finished, scored sections (AttemptModel) and the permanent question log; attempts the
// student removed from their lists still count.
import { AttemptModel, FullTestModel, QuestionLogModel, QuestionModel, trusted, type AttemptDoc, type QuestionLogDoc } from "@satsharks/db";
import {
  ERROR_PATTERNS,
  FREE_ANALYTICS,
  FULL_TEST_QUESTION_TAG,
  SECTION_LABELS,
  SECTION_PACE_SECONDS,
  SECTIONS,
  type Analytics,
  type DrillSuggestion,
  type ErrorPattern,
  type ErrorPatternStat,
  type NextStep,
  type ScorePrediction,
  type Section,
  type SkillStat,
  type SlowQuestion,
  type TimingStat,
} from "@satsharks/types";
import mongoose from "mongoose";
import { classifyError, pointsToGain, predictScore, trapAnswerOf } from "./engagement-rules";

// Enough history for stable numbers without reading a student's whole log on every visit.
const LOG_WINDOW = 3000;
const BANK_TTL_MS = 10 * 60_000;
let bankShares: { value: Map<string, number>; expires: number } | null = null;

const skillKey = (section: Section, skill: string) => `${section}|${skill}`;

// Each skill's share of its section in the published bank: how often it shows up on a test.
async function skillShares(): Promise<Map<string, number>> {
  if (bankShares && bankShares.expires > Date.now()) return bankShares.value;
  const rows = await QuestionModel.aggregate<{ _id: { section: Section; skill: string | null }; n: number }>([
    { $match: { status: "published", tags: { $ne: FULL_TEST_QUESTION_TAG } } },
    { $group: { _id: { section: "$section", skill: "$skill" }, n: { $sum: 1 } } },
  ]);
  const totals: Record<Section, number> = { reading_writing: 0, math: 0 };
  for (const row of rows) totals[row._id.section] += row.n;
  const value = new Map<string, number>();
  for (const row of rows) {
    if (row._id.skill && totals[row._id.section] > 0) value.set(skillKey(row._id.section, row._id.skill), row.n / totals[row._id.section]);
  }
  bankShares = { value, expires: Date.now() + BANK_TTL_MS };
  return value;
}

async function scoredSections(userId: string): Promise<Pick<AttemptDoc, "section" | "sectionScore" | "completedAt">[]> {
  return AttemptModel.find({ userId, kind: "mock", status: "done", sectionScore: trusted({ $ne: null }) })
    .select("section sectionScore completedAt")
    .sort({ completedAt: 1 })
    .lean<AttemptDoc[]>();
}

function prediction(sections: Pick<AttemptDoc, "section" | "sectionScore" | "completedAt">[]): ScorePrediction {
  const result = predictScore(sections.map((attempt) => ({ date: attempt.completedAt ?? new Date(0), section: attempt.section, score: attempt.sectionScore! })));
  return { ...result, basedOn: sections.length };
}

const drill = (section: Section, skill: string | null, label: string, extra: Partial<DrillSuggestion> = {}): DrillSuggestion => ({
  section,
  skills: skill ? [skill] : [],
  difficulty: null,
  count: 15,
  timed: false,
  label,
  ...extra,
});

function skillStats(logs: QuestionLogDoc[], shares: Map<string, number>): SkillStat[] {
  const groups = new Map<string, SkillStat>();
  for (const log of logs) {
    if (log.correct === null || !log.skill) continue;
    const key = skillKey(log.section, log.skill);
    const stat = groups.get(key) ?? { section: log.section, topic: log.topic ?? "", skill: log.skill, answered: 0, correct: 0, accuracy: 0, pointsToGain: 0 };
    stat.answered += 1;
    if (log.correct) stat.correct += 1;
    groups.set(key, stat);
  }
  return [...groups.values()]
    .map((stat) => {
      const accuracy = stat.correct / stat.answered;
      return { ...stat, accuracy, pointsToGain: pointsToGain(accuracy, shares.get(skillKey(stat.section, stat.skill)) ?? 0) };
    })
    .sort((a, b) => b.pointsToGain - a.pointsToGain || a.accuracy - b.accuracy);
}

const ERROR_STEPS: Record<ErrorPattern, (skill: string) => string> = {
  careless: (skill) => `Most of your mistakes are on things you know. Slow down: do 15 ${skill} questions untimed and check each one before moving on.`,
  out_of_time: () => "You lose points to the clock. Practise at test pace: a timed set, about one question per official minute.",
  not_known: (skill) => `${skill} is not secure yet. Learn it, then practise 15 questions with instant feedback.`,
  changed_answer: (skill) => `You changed right answers to wrong ones. Only change an answer when you can say why the new one is right. Practise ${skill}.`,
  trap: (skill) => `You pick the tempting wrong answer. Rule out each choice before picking one. Practise harder ${skill} questions.`,
};

async function errorAnalysis(userId: string, logs: QuestionLogDoc[], skills: SkillStat[]): Promise<NonNullable<Analytics["errors"]>> {
  const accuracy = new Map(skills.map((stat) => [skillKey(stat.section, stat.skill), stat.accuracy]));
  const missed = logs.filter((log) => log.correct === false || (log.correct === null && log.timedOut)).slice(0, 500);

  // Trap answers: the wrong choice most students pick on each of these questions.
  const wrongIds = [...new Set(missed.filter((log) => log.correct === false).map((log) => String(log.questionId)))];
  const traps = new Map<string, string>();
  if (wrongIds.length > 0) {
    const rows = await QuestionLogModel.aggregate<{ _id: { q: mongoose.Types.ObjectId; a: string }; n: number }>([
      { $match: { questionId: { $in: wrongIds.map((id) => new mongoose.Types.ObjectId(id)) }, correct: false } },
      { $group: { _id: { q: "$questionId", a: "$answer" }, n: { $sum: 1 } } },
    ]);
    const byQuestion = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const counts = byQuestion.get(String(row._id.q)) ?? {};
      counts[row._id.a] = row.n;
      byQuestion.set(String(row._id.q), counts);
    }
    for (const [id, counts] of byQuestion) {
      const trap = trapAnswerOf(counts);
      if (trap !== null) traps.set(id, trap);
    }
  }

  const counts = new Map<ErrorPattern, { count: number; skills: Map<string, { section: Section; skill: string; n: number }> }>();
  for (const log of missed) {
    const pattern = classifyError({
      correct: log.correct,
      answer: log.answer,
      timedOut: log.timedOut,
      changedFromCorrect: log.changedFromCorrect,
      skillAccuracy: log.skill ? (accuracy.get(skillKey(log.section, log.skill)) ?? null) : null,
      trapAnswer: traps.get(String(log.questionId)) ?? null,
    });
    if (!pattern) continue;
    const entry = counts.get(pattern) ?? { count: 0, skills: new Map() };
    entry.count += 1;
    if (log.skill) {
      const key = skillKey(log.section, log.skill);
      const skill = entry.skills.get(key) ?? { section: log.section, skill: log.skill, n: 0 };
      skill.n += 1;
      entry.skills.set(key, skill);
    }
    counts.set(pattern, entry);
  }
  const total = [...counts.values()].reduce((sum, entry) => sum + entry.count, 0);
  const patterns: ErrorPatternStat[] = ERROR_PATTERNS.map((pattern) => {
    const entry = counts.get(pattern);
    const top = entry ? [...entry.skills.values()].sort((a, b) => b.n - a.n)[0] : undefined;
    return { pattern, count: entry?.count ?? 0, share: total ? (entry?.count ?? 0) / total : 0, topSkill: top ? { section: top.section, skill: top.skill } : null };
  }).sort((a, b) => b.count - a.count);

  const main = patterns[0];
  let step: NextStep = { text: "No mistakes to analyse yet. Finish a test or a few drills.", drill: null };
  if (main && main.count > 0) {
    const skill = main.topSkill?.skill ?? "these skills";
    const section = main.topSkill?.section ?? missed[0]?.section ?? "math";
    step = {
      text: ERROR_STEPS[main.pattern](skill),
      drill:
        main.pattern === "out_of_time"
          ? drill(section, null, `Timed ${SECTION_LABELS[section]} set`, { count: 10, timed: true })
          : drill(section, main.topSkill?.skill ?? null, `Practise ${skill}`, main.pattern === "trap" ? { difficulty: "hard" } : {}),
    };
  }
  return { total, patterns, step };
}

async function timingAnalysis(userId: string, logs: QuestionLogDoc[]): Promise<NonNullable<Analytics["timing"]>> {
  const answered = logs.filter((log) => log.correct !== null && log.timeSpentSeconds > 0);
  const sections: TimingStat[] = SECTIONS.map((section) => {
    const own = answered.filter((log) => log.section === section);
    return {
      section,
      paceSeconds: SECTION_PACE_SECONDS[section],
      averageSeconds: own.length ? Math.round(own.reduce((sum, log) => sum + log.timeSpentSeconds, 0) / own.length) : null,
      answered: own.length,
    };
  });

  const latest = await AttemptModel.findOne({ userId, kind: "mock", status: "done", timed: true, "items.0": trusted({ $exists: true }) })
    .sort({ completedAt: -1 })
    .select("name section items.timeSpentSeconds")
    .lean<AttemptDoc>();
  const pace = latest
    ? { name: latest.name, section: latest.section, paceSeconds: SECTION_PACE_SECONDS[latest.section], seconds: latest.items.map((item) => item.timeSpentSeconds ?? 0) }
    : null;

  // Test questions (where the clock matters) furthest over the official pace.
  const slowest: SlowQuestion[] = logs
    .filter((log) => log.origin === "mock" && log.timeSpentSeconds > SECTION_PACE_SECONDS[log.section])
    .map((log) => ({
      attemptId: String(log.attemptId),
      position: log.position,
      section: log.section,
      skill: log.skill,
      seconds: log.timeSpentSeconds,
      overPace: log.timeSpentSeconds - SECTION_PACE_SECONDS[log.section],
      correct: log.correct,
    }))
    .sort((a, b) => b.overPace - a.overPace)
    .slice(0, 5);

  // Where the most time over pace goes, by skill.
  const lost = new Map<string, { section: Section; skill: string; seconds: number }>();
  for (const log of answered) {
    const over = log.timeSpentSeconds - SECTION_PACE_SECONDS[log.section];
    if (over <= 0 || !log.skill) continue;
    const key = skillKey(log.section, log.skill);
    const entry = lost.get(key) ?? { section: log.section, skill: log.skill, seconds: 0 };
    entry.seconds += over;
    lost.set(key, entry);
  }
  const worst = [...lost.values()].sort((a, b) => b.seconds - a.seconds)[0];
  const step: NextStep = worst
    ? {
        text: `${worst.skill} takes you the most time over pace (${Math.round(worst.seconds / 60)} min in total). Practise it against the clock.`,
        drill: drill(worst.section, worst.skill, `Timed ${worst.skill}`, { count: 10, timed: true }),
      }
    : { text: "You are within the official pace. Keep taking timed tests to stay there.", drill: null };
  return { sections, pace, slowest, step };
}

// The next step for one section's skills breakdown: its costliest skill.
function skillStep(skills: SkillStat[], section: Section): NextStep {
  const top = skills.find((skill) => skill.section === section);
  return top
    ? { text: `Start with ${top.skill}: about ${top.pointsToGain} points to gain at ${Math.round(top.accuracy * 100)}% accuracy now.`, drill: drill(top.section, top.skill, `Practise ${top.skill}`) }
    : { text: `Answer some ${SECTION_LABELS[section]} questions first: drills, mocks or a full test.`, drill: null };
}

// The free view's teaser (proposal "the results-page moment"): how many skills cost points and how
// many points in all, never more than the distance to 1600. Real numbers; the skills stay hidden.
const LOCKED_MIN_POINTS = 5;
function lockedSummary(skills: SkillStat[], predicted: number | null): { skills: number; points: number } {
  const costly = skills.filter((skill) => skill.pointsToGain >= LOCKED_MIN_POINTS);
  const points = costly.reduce((sum, skill) => sum + skill.pointsToGain, 0);
  const room = predicted === null ? 1200 : Math.max(0, 1600 - predicted);
  return { skills: costly.length, points: Math.round(Math.min(points, room) / 10) * 10 };
}

export const analyticsService = {
  // The predicted total alone (goals, emails). null until both sections have a score.
  async predictedTotal(userId: string): Promise<number | null> {
    return prediction(await scoredSections(userId)).total;
  },

  async predictionFor(userId: string): Promise<ScorePrediction> {
    return prediction(await scoredSections(userId));
  },

  // `full`: everything; otherwise the free view (score only, top weak areas of each section, no errors or timing).
  async analytics(userId: string, full: boolean): Promise<Analytics> {
    const [sections, logs, shares, fullTests] = await Promise.all([
      scoredSections(userId),
      QuestionLogModel.find({ userId }).sort({ answeredAt: -1 }).limit(LOG_WINDOW).lean<QuestionLogDoc[]>(),
      skillShares(),
      FullTestModel.countDocuments({ userId, completedAt: trusted({ $ne: null }) }),
    ]);
    const standalone = await AttemptModel.countDocuments({ userId, kind: "mock", status: "done", fullTestId: null });
    const predicted = prediction(sections);
    const skills = skillStats(logs, shares);
    const top = skills[0];

    const predictionStep: NextStep =
      predicted.total === null
        ? {
            text:
              predicted.basedOn === 0
                ? "Finish a full test (or one mock of each section) to get your predicted score."
                : `Finish a ${predicted.sections.math === null ? "Math" : "Reading and Writing"} mock to complete your predicted score.`,
            drill: null,
          }
        : top
          ? { text: `The fastest way up: ${top.skill} costs you about ${top.pointsToGain} points.`, drill: drill(top.section, top.skill, `Practise ${top.skill}`) }
          : { text: "Practise a few drills so we can see which skills cost you points.", drill: null };

    return {
      full,
      completedPapers: fullTests + standalone,
      prediction: full ? predicted : { ...predicted, low: null, high: null, trend: [] },
      predictionStep,
      skills: full ? skills : SECTIONS.flatMap((section) => skills.filter((skill) => skill.section === section).slice(0, FREE_ANALYTICS.weakAreas)),
      skillSteps: { reading_writing: skillStep(skills, "reading_writing"), math: skillStep(skills, "math") },
      errors: full ? await errorAnalysis(userId, logs, skills) : null,
      timing: full ? await timingAnalysis(userId, logs) : null,
      locked: full ? null : lockedSummary(skills, predicted.total),
    };
  },

  // The skill to focus on next (weekly email).
  async focusSkill(userId: string): Promise<SkillStat | null> {
    const [logs, shares] = await Promise.all([QuestionLogModel.find({ userId }).sort({ answeredAt: -1 }).limit(LOG_WINDOW).lean<QuestionLogDoc[]>(), skillShares()]);
    return skillStats(logs, shares)[0] ?? null;
  },
};
