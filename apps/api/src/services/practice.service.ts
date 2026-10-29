// Practice drills, adaptive mocks and full tests.
//
// Drill: a student picks a question set from one exam and works through it, with an optional
// answer check per question.
// Adaptive mock: one section in two modules. Module 1 is built when the mock starts; Module 2 is
// built only after Module 1 is submitted, harder or easier depending on the Module 1 score.
// Full test: a Reading & Writing mock, a break, then a Math mock (see FullTestModel).
// Uploaded practice test: a full test whose modules are fixed by an admin (see test-upload.service)
// instead of drawn from the bank; routing between them follows the same rule.
//
// Questions of uploaded tests (tagged "full-test") belong to their test only: every bank query
// below excludes them.
//
// Answer keys never leave the server until a drill question is checked or the attempt ends.
// Module 2's questions do not exist anywhere the student can reach until Module 1 is closed.
//
// Time is measured on the server: module times from the module clock, question times from when
// each question was loaded to when the next one was (see recordView).
import {
  AttemptModel,
  FullTestModel,
  PaperModel,
  QuestionModel,
  trusted,
  type AttemptDoc,
  type FullTestDoc,
  type PaperDoc,
  type QuestionDoc,
} from "@satsharks/db";
import {
  FULL_TEST_BREAK_MINUTES,
  EXAM_UPLOAD_SOURCE,
  FULL_TEST_QUESTION_TAG,
  MOCK_FORMAT,
  MOCK_MODULE_LABELS,
  SECTION_LABELS,
  SECTION_PACE_SECONDS,
  SECTIONS,
  type Annotation,
  type AttemptNavItem,
  type AttemptQuestion,
  type AttemptSummary,
  type CatalogExam,
  type CatalogTopic,
  type FullTestSummary,
  type MockModule,
  type ModuleResult,
  type PracticeCatalog,
  type PracticeTestListing,
  type ReviewQuestion,
  type Section,
  type TimeMultiplier,
  TEST_UPLOAD_SOURCE,
  uploadAccessKey,
} from "@satsharks/types";
import type { BankDrillInput, CreateAttemptInput, CreateFullTestInput, CreateMockInput, RetryDrillInput, SaveAnnotationsInput, SaveAnswerInput } from "@satsharks/validation";
import mongoose from "mongoose";
import { AppError } from "../utils/app-error";
import { gradeAnswer } from "../utils/grading";
import { drillSize, paidOnly, requireContent, requireFeature, type UserAccess } from "./access.service";
import { activityService } from "./activity.service";
import { historyService } from "./history.service";
import { orderModule, pickModule, pickPatternModule, requiredForHard, type Candidate } from "./mock-assembly";
import { sectionScore, totalScore } from "./scoring";
import { settingsService } from "./settings.service";
import { testUploadService } from "./test-upload.service";

const MAX_QUESTIONS_PER_ATTEMPT = 200;
const CATALOG_TTL_MS = 60_000;
// Untimed attempts have no clock to bound a question's time, so one stretch on a question counts
// for at most this long (a tab left open overnight is not ten hours of work).
const UNTIMED_VIEW_CAP_SECONDS = 10 * 60;

// The catalog as every account sees it; locks are added per account on each request.
type BaseCatalog = { exams: Omit<CatalogExam, "locked" | "lockReason" | "pinned" | "label" | "free">[]; topics: PracticeCatalog["topics"] };
let catalogCache: { value: BaseCatalog; expires: number } | null = null;

export function invalidateCatalog(): void {
  catalogCache = null;
}

// Papers from the same exam (one per section) share this id; it is also the exam's access key.
const examKeyOf = (paper: Pick<PaperDoc, "_id" | "sourceMetadata">): string => {
  const examId = paper.sourceMetadata?.examId;
  return examId != null ? String(examId) : String(paper._id);
};

type Item = AttemptDoc["items"][number];

// ---------- module bookkeeping (mocks) ----------

const moduleOneCount = (attempt: AttemptDoc) => attempt.items.filter((item) => item.module === "m1").length;

// Positions (1-based) of the module the student is working in.
function currentRange(attempt: AttemptDoc): { start: number; count: number } {
  if (attempt.kind !== "mock") return { start: 1, count: attempt.items.length };
  const m1 = moduleOneCount(attempt);
  return attempt.currentModule === "m2" ? { start: m1 + 1, count: attempt.items.length - m1 } : { start: 1, count: m1 };
}

const inCurrentModule = (attempt: AttemptDoc, position: number) => {
  const { start, count } = currentRange(attempt);
  return position >= start && position < start + count;
};

function timeRemaining(attempt: AttemptDoc): number | null {
  if (!attempt.timed || attempt.timeLimitSeconds === null) return null;
  if (attempt.status === "done") return 0;
  const elapsed = Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000);
  return Math.max(0, attempt.timeLimitSeconds - elapsed);
}

// ---------- time measurement ----------

// When the clock of the current module (or drill) stops: its deadline if timed, otherwise never.
function deadline(attempt: AttemptDoc): number {
  return attempt.timed && attempt.timeLimitSeconds !== null ? attempt.startedAt.getTime() + attempt.timeLimitSeconds * 1000 : Infinity;
}

// Seconds the question currently on screen has been open, up to `now`.
function openViewSeconds(attempt: AttemptDoc, now: number): { index: number; seconds: number } | null {
  if (attempt.viewPosition == null || !attempt.viewStartedAt) return null;
  const end = Math.min(now, deadline(attempt));
  let seconds = Math.max(0, Math.floor((end - attempt.viewStartedAt.getTime()) / 1000));
  if (!attempt.timed) seconds = Math.min(seconds, UNTIMED_VIEW_CAP_SECONDS);
  return { index: attempt.viewPosition - 1, seconds };
}

// Items with the open view's time added (for writes that replace the whole items array).
function itemsWithOpenView(attempt: AttemptDoc, items: Item[], now: number): Item[] {
  const open = openViewSeconds(attempt, now);
  if (!open || !items[open.index]) return items;
  return items.map((item, index) => (index === open.index ? { ...item, timeSpentSeconds: (item.timeSpentSeconds ?? 0) + open.seconds } : item));
}

// Time used by the module (or drill) that is closing now. Timed: the module clock, never more than
// its limit. Untimed: the time questions were actually on screen.
function moduleTimeUsed(attempt: AttemptDoc, items: Item[], now: number): number {
  if (attempt.timed && attempt.timeLimitSeconds !== null) {
    return Math.min(attempt.timeLimitSeconds, Math.max(0, Math.floor((now - attempt.startedAt.getTime()) / 1000)));
  }
  const { start, count } = currentRange(attempt);
  return items.slice(start - 1, start - 1 + count).reduce((sum, item) => sum + (item.timeSpentSeconds ?? 0), 0);
}

// ---------- views ----------

function moduleResults(attempt: AttemptDoc): ModuleResult[] {
  if (attempt.kind !== "mock" || attempt.status !== "done") return [];
  const build = (module: "m1" | "m2", items: Item[], timeUsed: number | null): ModuleResult => ({
    module,
    route: module === "m1" ? "m1" : attempt.m2Type,
    total: items.length,
    correct: items.filter((item) => item.correct === true).length,
    incorrect: items.filter((item) => item.answer !== null && item.correct !== true).length,
    skipped: items.filter((item) => item.answer === null).length,
    timeUsedSeconds: timeUsed,
    timeLimitSeconds: attempt.timed ? attempt.timeLimitSeconds : null,
  });
  const m1 = attempt.items.filter((item) => item.module === "m1");
  const m2 = attempt.items.filter((item) => item.module !== "m1");
  const results = [build("m1", m1, attempt.m1TimeUsedSeconds ?? null)];
  if (m2.length > 0) results.push(build("m2", m2, attempt.m2TimeUsedSeconds ?? null));
  return results;
}

function toSummary(attempt: AttemptDoc, paperTitle: string): AttemptSummary {
  const range = currentRange(attempt);
  const m1Total = moduleOneCount(attempt);
  return {
    id: String(attempt._id),
    kind: attempt.kind,
    name: attempt.name,
    section: attempt.section,
    paperTitle,
    fullTestId: attempt.fullTestId ? String(attempt.fullTestId) : null,
    timeMultiplier: (attempt.timeMultiplier ?? 1) as TimeMultiplier,
    sectionScore: attempt.sectionScore ?? null,
    timeUsedSeconds: attempt.timeUsedSeconds ?? null,
    modules: moduleResults(attempt),
    mock:
      attempt.kind === "mock"
        ? {
            currentModule: attempt.currentModule,
            m2Type: attempt.m2Type,
            moduleStart: range.start,
            moduleQuestionCount: range.count,
            m1Correct: attempt.m1Correct,
            m2Correct: attempt.m2Correct,
            m1Total,
            m2Total: attempt.items.length - m1Total,
            routingRequiredCorrect: attempt.routingRequiredCorrect,
          }
        : null,
    status: attempt.status,
    timed: attempt.timed,
    timeLimitSeconds: attempt.timeLimitSeconds,
    timeRemainingSeconds: timeRemaining(attempt),
    lastPosition: attempt.lastPosition,
    total: attempt.items.length,
    answered: attempt.items.filter((item) => item.answer !== null).length,
    correct: attempt.correct,
    incorrect: attempt.incorrect,
    unanswered: attempt.unanswered,
    createdAt: attempt.createdAt.toISOString(),
    completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : null,
  };
}

// While a mock is running, only the current module is listed; Module 1 is closed once submitted.
function toNavigation(attempt: AttemptDoc): AttemptNavItem[] {
  const all = attempt.items.map((item, index) => ({
    position: index + 1,
    answered: item.answer !== null,
    flagged: item.flagged,
    checked: item.checked,
  }));
  if (attempt.kind !== "mock" || attempt.status === "done") return all;
  return all.filter((entry) => inCurrentModule(attempt, entry.position));
}

function toQuestionView(question: QuestionDoc, item: Item, position: number, reveal: boolean): AttemptQuestion {
  return {
    position,
    module: item.module ?? null,
    section: question.section,
    questionType: question.questionType,
    prompt: question.prompt,
    passage: question.passage,
    choices: question.choices.map((choice) => ({ key: choice.key, text: choice.text, viz: choice.viz ?? null })),
    assets: question.assets.map((asset) => ({ kind: asset.kind, url: asset.url, maxWidth: asset.maxWidth })),
    viz: question.viz ?? null,
    answer: item.answer,
    flagged: item.flagged,
    checked: item.checked,
    result: reveal
      ? { correct: item.correct, correctAnswer: question.correctAnswer ?? null, explanation: question.explanation ?? null }
      : null,
    annotations: (item.annotations ?? []).map(({ id, target, start, end, color, underline, note }) => ({ id, target, start, end, color, underline, note })),
  };
}

async function attemptTitle(attempt: AttemptDoc): Promise<string> {
  if (attempt.kind === "mock") {
    if (attempt.paperIds.length === 0) return `All exams — ${SECTION_LABELS[attempt.section]}`;
    const papers = await PaperModel.find({ _id: trusted({ $in: attempt.paperIds }) }).select("title").lean<PaperDoc[]>();
    const first = papers[0]?.title.split(" — ")[0] ?? "Selected exams";
    return papers.length > 1 ? `${first} + ${papers.length - 1} more` : first;
  }
  if (attempt.origin === "retry") return "Mistake bank";
  if (attempt.origin === "bank") return "All exams";
  const paper = attempt.paperId ? await PaperModel.findById(attempt.paperId).select("title").lean<PaperDoc>() : null;
  return paper?.title ?? "";
}

async function gradeItems(items: Item[]): Promise<Item[]> {
  const questions = await QuestionModel.find({ _id: trusted({ $in: items.map((item) => item.questionId) }) })
    .select("+correctAnswer questionType")
    .lean<QuestionDoc[]>();
  const byId = new Map(questions.map((question) => [String(question._id), question]));
  return items.map((item) => {
    const question = byId.get(String(item.questionId));
    return { ...item, correct: item.answer === null || !question ? null : gradeAnswer(question, item.answer) };
  });
}

// The section score for a finished mock, from the conversion table for the route it took.
async function scoreFor(attempt: Pick<AttemptDoc, "kind" | "section" | "m2Type" | "items">, correct: number): Promise<number | null> {
  if (attempt.kind !== "mock") return null;
  return sectionScore(await settingsService.getConversionTables(), attempt.section, attempt.m2Type, correct, attempt.items.length);
}

// A mock finished before its conversion table was entered is scored once the table exists.
async function withScore(attempt: AttemptDoc): Promise<AttemptDoc> {
  if (attempt.kind !== "mock" || attempt.status !== "done" || attempt.sectionScore != null) return attempt;
  const score = await scoreFor(attempt, attempt.correct);
  if (score === null) return attempt;
  await AttemptModel.updateOne({ _id: attempt._id, sectionScore: null }, { $set: { sectionScore: score } });
  return { ...attempt, sectionScore: score };
}

// Grades every item and closes the attempt. Idempotent.
async function finalize(attempt: AttemptDoc): Promise<AttemptDoc> {
  if (attempt.status === "done") return attempt;
  const now = Date.now();
  // Closed by the clock (not by the student): blanks left now count as "ran out of time".
  const timedOut = attempt.timed && attempt.timeLimitSeconds !== null && now >= deadline(attempt);
  const items = await gradeItems(itemsWithOpenView(attempt, attempt.items, now));
  const correct = items.filter((item) => item.correct === true).length;
  const unanswered = items.filter((item) => item.answer === null).length;
  const closingTime = moduleTimeUsed(attempt, items, now);
  const set: Record<string, unknown> = {
    items,
    correct,
    incorrect: items.length - correct - unanswered,
    unanswered,
    status: "done",
    completedAt: new Date(now),
    viewPosition: null,
    viewStartedAt: null,
    timedOut,
  };
  if (attempt.kind === "mock") {
    set.m1Correct = items.filter((item) => item.module === "m1" && item.correct === true).length;
    set.m2Correct = items.filter((item) => item.module !== "m1" && item.correct === true).length;
    const m1Time = attempt.currentModule === "m1" ? closingTime : (attempt.m1TimeUsedSeconds ?? null);
    const m2Time = attempt.currentModule === "m2" ? closingTime : null;
    set.m1TimeUsedSeconds = m1Time;
    set.m2TimeUsedSeconds = m2Time;
    set.timeUsedSeconds = m1Time === null && m2Time === null ? null : (m1Time ?? 0) + (m2Time ?? 0);
    set.sectionScore = await scoreFor(attempt, correct);
  } else {
    set.timeUsedSeconds = closingTime;
  }
  const updated = await AttemptModel.findOneAndUpdate({ _id: attempt._id, status: "active" }, { $set: set }, { new: true }).lean<AttemptDoc>();
  // Every question goes into the permanent history (points, streak, mistake bank). Only the request
  // that closed the attempt does this; logging is idempotent anyway.
  if (updated) await activityService.recordAttempt(updated, updated.items);
  // Another request finished it first: return that result.
  return updated ?? (await AttemptModel.findById(attempt._id).lean<AttemptDoc>())!;
}

// When the student was last given each question of a section (any drill, mock or full test,
// deleted ones too), by fingerprint: a question reused under another id counts as given.
async function seenByKey(userId: string, section: Section): Promise<Map<string, number>> {
  // Aggregation pipelines are not passed through the query sanitizer; values are an ObjectId and
  // fixed strings.
  const rows = await AttemptModel.aggregate<{ _id: mongoose.Types.ObjectId; at: Date; key: string | null }>([
    { $match: { userId: new mongoose.Types.ObjectId(userId), section } },
    { $project: { createdAt: 1, "items.questionId": 1 } },
    { $unwind: "$items" },
    { $group: { _id: "$items.questionId", at: { $max: "$createdAt" } } },
    { $lookup: { from: "questions", localField: "_id", foreignField: "_id", as: "question", pipeline: [{ $project: { contentKey: 1 } }] } },
    { $project: { at: 1, key: { $ifNull: [{ $first: "$question.contentKey" }, null] } } },
  ]);
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = row.key ?? String(row._id);
    seen.set(key, Math.max(seen.get(key) ?? 0, row.at.getTime()));
  }
  return seen;
}

type PoolRow = {
  _id: mongoose.Types.ObjectId;
  contentKey: string | null;
  skill: string | null;
  topic: string | null;
  difficulty: Candidate["difficulty"];
  questionType: Candidate["questionType"];
  quantitative: boolean;
};

// The questions a mock draws from: published, in the section, from the chosen exams (or all),
// each with when this student last saw it.
async function mockPool(userId: string, section: Section, paperIds: mongoose.Types.ObjectId[], fallback = false): Promise<Candidate[]> {
  // Aggregation pipelines are not passed through the query sanitizer; values here are ObjectIds
  // from validated input and fixed strings.
  const match: Record<string, unknown> = { status: "published", section, tags: { $ne: FULL_TEST_QUESTION_TAG } };
  if (paperIds.length > 0) match.paperId = { $in: paperIds };
  const [rows, seen] = await Promise.all([
    QuestionModel.aggregate<PoolRow>([
      { $match: match },
      {
        $project: {
          _id: 1,
          contentKey: 1,
          skill: 1,
          topic: 1,
          difficulty: 1,
          questionType: 1,
          // A Command of Evidence question on a table or graph (the quantitative kind).
          quantitative: {
            $or: [
              { $ne: [{ $ifNull: ["$viz", null] }, null] },
              { $gt: [{ $size: { $ifNull: ["$assets", []] } }, 0] },
              { $regexMatch: { input: "$prompt", regex: "\\b(graph|table|chart|data)\\b", options: "i" } },
            ],
          },
        },
      },
    ]),
    seenByKey(userId, section),
  ]);
  return rows.map((row) => {
    const key = row.contentKey ?? String(row._id);
    return {
      id: String(row._id),
      key,
      skill: row.skill,
      topic: row.topic,
      difficulty: row.difficulty,
      questionType: row.questionType,
      quantitative: row.quantitative,
      seenAt: seen.get(key) ?? null,
      fallback,
    };
  });
}

// One module drawn from the pool: the official pattern unless an admin turned it off.
function drawModule(pool: Candidate[], section: Section, module: MockModule, usedKeys: ReadonlySet<string>, officialPattern: boolean): mongoose.Types.ObjectId[] {
  const picked = officialPattern
    ? pickPatternModule(pool, section, module, usedKeys)
    : orderModule(pickModule(pool, MOCK_FORMAT[section].questionsPerModule, module, usedKeys), section);
  return picked.map((candidate) => new mongoose.Types.ObjectId(candidate.id));
}

// A drill's questions: never given to this student first (random), then the ones given longest
// ago, one per fingerprint.
async function freshFirst(userId: string, section: Section, match: Record<string, unknown>, size: number): Promise<mongoose.Types.ObjectId[]> {
  const [rows, seen] = await Promise.all([
    QuestionModel.aggregate<{ _id: mongoose.Types.ObjectId; contentKey: string | null }>([{ $match: match }, { $project: { _id: 1, contentKey: 1 } }]),
    seenByKey(userId, section),
  ]);
  // A random one of each fingerprint, then a random order within "never given".
  const byKey = new Map<string, { id: mongoose.Types.ObjectId; tie: number }>();
  for (const row of rows) {
    const key = row.contentKey ?? String(row._id);
    const tie = Math.random();
    if ((byKey.get(key)?.tie ?? -1) < tie) byKey.set(key, { id: row._id, tie });
  }
  const order = [...byKey.entries()].map(([key, { id, tie }]) => ({ id, seenAt: seen.get(key) ?? -1, tie }));
  order.sort((a, b) => a.seenAt - b.seenAt || a.tie - b.tie);
  return order.slice(0, size).map((entry) => entry.id);
}

// Checks the chosen exams and that the pool can fill both modules without repeats. With `access`,
// the exams must be open to the account, and "all exams" (no ids) means all exams open to it.
// Without it (continuing a full test already begun) nothing is checked against the plan.
// Chosen exams that cannot fill both modules (an exam with no Math, or too few questions) are
// topped up from the account's other exams (`extraPaperIds`), used only for what is missing.
async function checkedMockPool(
  userId: string,
  section: Section,
  ids: string[],
  access?: UserAccess,
  // Without `access`: which other exams may top up the pool (continuing a full test).
  openTo?: UserAccess,
): Promise<{ paperIds: mongoose.Types.ObjectId[]; extraPaperIds: mongoose.Types.ObjectId[]; pool: Candidate[] }> {
  let paperIds = [...new Set(ids)].map((id) => new mongoose.Types.ObjectId(id));
  let limited = false;
  if (paperIds.length > 0) {
    const papers = await PaperModel.find({ _id: trusted({ $in: paperIds }), status: "published", sections: section, source: trusted({ $ne: TEST_UPLOAD_SOURCE }) })
      .select("sourceMetadata")
      .lean<PaperDoc[]>();
    if (papers.length !== paperIds.length) throw AppError.badRequest(`Some selected exams are not available for ${SECTION_LABELS[section]}`);
    if (access && papers.some((paper) => !access.content(examKeyOf(paper)))) throw paidOnly("Some of the selected exams are");
  } else if (access && !access.paid) {
    const exams = (await baseCatalog()).exams.filter((exam) => exam.sections[section]);
    const open = exams.filter((exam) => access.content(exam.examId)).map((exam) => new mongoose.Types.ObjectId(exam.sections[section]!.paperId));
    // An empty list means "every exam" to the pool, so a free account with none open stops here.
    if (open.length === 0) throw paidOnly(`${SECTION_LABELS[section]} exams are`);
    if (open.length < exams.length) {
      paperIds = open;
      limited = true;
    }
  }
  const needed = MOCK_FORMAT[section].questionsPerModule * 2;
  const distinct = (candidates: Candidate[]) => new Set(candidates.map((candidate) => candidate.key)).size;
  let pool = await mockPool(userId, section, paperIds);
  let extraPaperIds: mongoose.Types.ObjectId[] = [];
  if (paperIds.length > 0 && !limited && distinct(pool) < needed) {
    const chosen = new Set(paperIds.map(String));
    extraPaperIds = (await baseCatalog()).exams
      .filter((exam) => exam.sections[section] && !chosen.has(exam.sections[section]!.paperId) && (!(access ?? openTo) || (access ?? openTo)!.content(exam.examId)))
      .map((exam) => new mongoose.Types.ObjectId(exam.sections[section]!.paperId));
    if (extraPaperIds.length > 0) pool = [...pool, ...(await mockPool(userId, section, extraPaperIds, true))];
  }
  if (distinct(pool) < needed) {
    throw AppError.badRequest(
      limited || extraPaperIds.length > 0
        ? `A ${SECTION_LABELS[section]} mock needs ${needed} questions; the exams open to your account have ${distinct(pool)}. See the Pricing page to upgrade.`
        : `A ${SECTION_LABELS[section]} mock needs ${needed} questions; the selected exams have ${distinct(pool)}. Choose more exams.`,
    );
  }
  return { paperIds, extraPaperIds, pool };
}

// One module of an uploaded practice test, in the test's own order.
async function fixedModule(paperId: mongoose.Types.ObjectId, module: MockModule): Promise<mongoose.Types.ObjectId[]> {
  const rows = await QuestionModel.find({ paperId, moduleType: module }).select("_id").sort({ questionNumber: 1 }).lean<{ _id: mongoose.Types.ObjectId }[]>();
  if (rows.length === 0) throw AppError.conflict(`This practice test has no questions in ${MOCK_MODULE_LABELS[module]}. Please tell SAT Sharks.`);
  return rows.map((row) => row._id);
}

// Where a mock's questions come from: drawn from a pool of bank questions, or the fixed modules
// of an uploaded practice test (one section's paper).
type MockSource =
  | { pool: Candidate[]; paperIds: mongoose.Types.ObjectId[]; extraPaperIds: mongoose.Types.ObjectId[] }
  | { fixed: { paperId: mongoose.Types.ObjectId; testUploadId: mongoose.Types.ObjectId } };

// Builds Module 1 and saves a new mock attempt. Its clock starts now.
async function startMock(
  userId: string,
  options: { section: Section; source: MockSource; timed: boolean; timeMultiplier: TimeMultiplier; name: string; fullTestId?: mongoose.Types.ObjectId },
): Promise<AttemptDoc> {
  const format = MOCK_FORMAT[options.section];
  const { source } = options;
  const moduleOne =
    "fixed" in source
      ? await fixedModule(source.fixed.paperId, "m1")
      : drawModule(source.pool, options.section, "m1", new Set(), (await settingsService.getAdaptive()).officialPattern);
  const attempt = await AttemptModel.create({
    userId,
    kind: "mock",
    origin: "mock",
    name: options.name,
    section: options.section,
    paperId: "fixed" in source ? source.fixed.paperId : null,
    paperIds: "fixed" in source ? [source.fixed.paperId] : source.paperIds,
    extraPaperIds: "fixed" in source ? [] : source.extraPaperIds,
    testUploadId: "fixed" in source ? source.fixed.testUploadId : null,
    timed: options.timed,
    timeMultiplier: options.timeMultiplier,
    // Per module; Module 2 gets the same limit.
    timeLimitSeconds: options.timed ? Math.round(format.minutesPerModule * 60 * options.timeMultiplier) : null,
    fullTestId: options.fullTestId ?? null,
    currentModule: "m1",
    items: moduleOne.map((questionId) => ({ questionId, module: "m1" })),
  });
  return attempt.toObject();
}

// Closes Module 1: grades it, applies the routing rule, builds Module 2 and restarts the clock.
// Safe to call twice: only the first call changes anything.
async function submitModuleOne(attempt: AttemptDoc): Promise<AttemptDoc> {
  if (attempt.kind !== "mock" || attempt.status !== "active" || attempt.currentModule !== "m1") return attempt;

  const now = Date.now();
  const graded = await gradeItems(itemsWithOpenView(attempt, attempt.items, now));
  const moduleOne = graded.filter((item) => item.module === "m1");
  const m1Correct = moduleOne.filter((item) => item.correct === true).length;
  const { routingThresholdPercent, officialPattern } = await settingsService.getAdaptive();
  const required = requiredForHard(moduleOne.length, routingThresholdPercent);
  const m2Type: MockModule = m1Correct >= required ? "m2_hard" : "m2_easy";

  let moduleTwo: mongoose.Types.ObjectId[];
  if (attempt.testUploadId && attempt.paperId) {
    moduleTwo = await fixedModule(attempt.paperId, m2Type);
  } else {
    // The same pool as Module 1, top-up included.
    const extra = attempt.extraPaperIds ?? [];
    const pool = [
      ...(await mockPool(String(attempt.userId), attempt.section, attempt.paperIds)),
      ...(extra.length > 0 ? await mockPool(String(attempt.userId), attempt.section, extra, true) : []),
    ];
    // Module 1's questions, and any question that looks the same, are not used again.
    const moduleOneIds = new Set(moduleOne.map((item) => String(item.questionId)));
    const used = new Set(pool.filter((candidate) => moduleOneIds.has(candidate.id)).map((candidate) => candidate.key));
    moduleTwo = drawModule(pool, attempt.section, m2Type, used, officialPattern);
  }

  const updated = await AttemptModel.findOneAndUpdate(
    { _id: attempt._id, status: "active", currentModule: "m1" },
    {
      $set: {
        items: [
          ...graded,
          ...moduleTwo.map((questionId) => ({ questionId, module: m2Type })),
        ],
        currentModule: "m2",
        m2Type,
        m1Correct,
        m1TimeUsedSeconds: moduleTimeUsed(attempt, graded, now),
        m1TimedOut: attempt.timed && attempt.timeLimitSeconds !== null && now >= deadline(attempt),
        routingThresholdPercent,
        routingRequiredCorrect: required,
        startedAt: new Date(now),
        lastPosition: moduleOne.length + 1,
        viewPosition: null,
        viewStartedAt: null,
      },
    },
    { new: true },
  ).lean<AttemptDoc>();
  return updated ?? (await AttemptModel.findById(attempt._id).lean<AttemptDoc>())!;
}

// Loads an attempt the user owns. When a timed attempt's clock has run out it moves on here, so
// time cannot be extended by not calling "end": a mock's Module 1 is submitted (and Module 2's
// clock starts), anything else is finished.
async function loadAttempt(userId: string, attemptId: string): Promise<AttemptDoc> {
  let attempt = await AttemptModel.findOne({ _id: attemptId, userId }).lean<AttemptDoc>();
  if (!attempt) throw AppError.notFound("Attempt not found");
  if (attempt.status === "active" && timeRemaining(attempt) === 0) {
    attempt = attempt.kind === "mock" && attempt.currentModule === "m1" ? await submitModuleOne(attempt) : await finalize(attempt);
  }
  return withScore(attempt);
}

function itemAt(attempt: AttemptDoc, position: number): Item {
  const item = attempt.items[position - 1];
  if (!item) throw AppError.notFound("Question not found in this attempt");
  // A submitted mock module cannot be reopened while the mock is running.
  if (attempt.kind === "mock" && attempt.status === "active" && !inCurrentModule(attempt, position)) {
    throw AppError.conflict("That question belongs to a module that is already submitted");
  }
  return item;
}

// The student has opened `position`: the question they were on gets its time, and the new one
// starts counting. The write only lands if no other request moved the view first.
async function recordView(attempt: AttemptDoc, position: number): Promise<void> {
  if (attempt.status !== "active") return;
  const now = Date.now();
  const set: Record<string, unknown> = { viewPosition: position, viewStartedAt: new Date(now), lastPosition: position };
  const update: Record<string, unknown> = { $set: set };
  const open = openViewSeconds(attempt, now);
  if (open && open.seconds > 0 && attempt.items[open.index]) update.$inc = { [`items.${open.index}.timeSpentSeconds`]: open.seconds };
  const filter: Record<string, unknown> = { _id: attempt._id, status: "active", viewStartedAt: attempt.viewStartedAt ?? null };
  if (attempt.kind === "mock") filter.currentModule = attempt.currentModule;
  await AttemptModel.updateOne(filter, update);
}

async function summary(attempt: AttemptDoc): Promise<AttemptSummary> {
  return toSummary(attempt, await attemptTitle(attempt));
}

// ---------- full tests ----------

async function loadFullTest(userId: string, fullTestId: string): Promise<FullTestDoc> {
  const fullTest = await FullTestModel.findOne({ _id: fullTestId, userId }).lean<FullTestDoc>();
  if (!fullTest) throw AppError.notFound("Full test not found");
  return fullTest;
}

async function fullTestSummary(userId: string, fullTest: FullTestDoc): Promise<FullTestSummary> {
  const rw = fullTest.readingWritingAttemptId ? await loadAttempt(userId, String(fullTest.readingWritingAttemptId)) : null;
  const math = fullTest.mathAttemptId ? await loadAttempt(userId, String(fullTest.mathAttemptId)) : null;
  const stage = !rw || rw.status !== "done" ? "reading_writing" : !math ? "break" : math.status !== "done" ? "math" : "done";
  const total = stage === "done" ? totalScore(rw!.sectionScore ?? null, math!.sectionScore ?? null) : null;

  // Record the outcome once known (and the total once both conversion tables exist).
  if (stage === "done" && (fullTest.completedAt === null || fullTest.totalScore !== total)) {
    await FullTestModel.updateOne({ _id: fullTest._id }, { $set: { completedAt: fullTest.completedAt ?? math!.completedAt ?? new Date(), totalScore: total } });
  }
  return {
    id: String(fullTest._id),
    name: fullTest.name,
    stage,
    timed: fullTest.timed,
    timeMultiplier: (fullTest.timeMultiplier ?? 1) as TimeMultiplier,
    readingWriting: rw ? await summary(rw) : null,
    math: math ? await summary(math) : null,
    breakEndsAt: stage === "break" && rw?.completedAt ? new Date(rw.completedAt.getTime() + FULL_TEST_BREAK_MINUTES * 60_000).toISOString() : null,
    totalScore: total,
    createdAt: fullTest.createdAt.toISOString(),
    completedAt: stage === "done" ? (fullTest.completedAt ?? math!.completedAt ?? new Date()).toISOString() : null,
  };
}

// Lock, pin and label of an exam or test for one account (Admin → Access).
function display(access: UserAccess, key: string): Pick<CatalogExam, "locked" | "lockReason" | "pinned" | "label" | "free"> {
  const rule = access.rule(key);
  const lockReason = access.lockReason(key);
  return { locked: lockReason !== null, lockReason, pinned: rule.pinned, label: rule.label, free: rule.level === "free" };
}

// Pinned exams and tests first; the order is otherwise kept (stable sort).
const pinnedFirst = <T extends { pinned: boolean }>(items: T[]): T[] => [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned));

// What can be practised: published papers grouped by exam, and the topic/skill vocabulary.
async function baseCatalog(): Promise<BaseCatalog> {
  if (catalogCache && catalogCache.expires > Date.now()) return catalogCache.value;

  const papers = await PaperModel.find({ status: "published", source: trusted({ $ne: TEST_UPLOAD_SOURCE }) }).lean<PaperDoc[]>();
  const exams = new Map<string, BaseCatalog["exams"][number]>();
  for (const paper of papers) {
    const meta = paper.sourceMetadata ?? {};
    // Papers from the same exam (one per section) are shown as one card.
    const examId = examKeyOf(paper);
    const exam = exams.get(examId) ?? {
      examId,
      name: typeof meta.examName === "string" ? meta.examName : paper.title,
      examDate: typeof meta.examDate === "string" ? meta.examDate : null,
      // Uploaded exams can also be taken whole, as a fixed full test.
      testUploadId: paper.source === EXAM_UPLOAD_SOURCE && typeof paper.metadata?.testUploadId === "string" ? paper.metadata.testUploadId : null,
      sections: {},
    };
    for (const section of paper.sections) {
      exam.sections[section] = { paperId: String(paper._id), questionCount: paper.questionCount };
    }
    exams.set(examId, exam);
  }

  const rows = await QuestionModel.aggregate<{ _id: { section: Section; topic: string | null; skill: string | null } }>([
    { $match: { status: "published", tags: { $ne: FULL_TEST_QUESTION_TAG } } },
    { $group: { _id: { section: "$section", topic: "$topic", skill: "$skill" } } },
  ]);
  const topics = Object.fromEntries(SECTIONS.map((section) => [section, [] as CatalogTopic[]])) as Record<Section, CatalogTopic[]>;
  for (const { _id } of rows) {
    if (!_id.topic) continue;
    let topic = topics[_id.section].find((entry) => entry.topic === _id.topic);
    if (!topic) topics[_id.section].push((topic = { topic: _id.topic, skills: [] }));
    if (_id.skill && !topic.skills.includes(_id.skill)) topic.skills.push(_id.skill);
  }
  for (const section of SECTIONS) {
    topics[section].sort((a, b) => a.topic.localeCompare(b.topic));
    for (const topic of topics[section]) topic.skills.sort((a, b) => a.localeCompare(b));
  }

  const value: BaseCatalog = {
    exams: [...exams.values()].sort((a, b) => (b.examDate ?? "").localeCompare(a.examDate ?? "")),
    topics,
  };
  catalogCache = { value, expires: Date.now() + CATALOG_TTL_MS };
  return value;
}

export const practiceService = {
  // The catalog for one account: exams kept for paid accounts are listed, but locked.
  async catalog(access: UserAccess): Promise<PracticeCatalog> {
    const base = await baseCatalog();
    return {
      exams: pinnedFirst(base.exams.map((exam) => ({ ...exam, ...display(access, exam.examId) }))),
      topics: base.topics,
      access: access.summary,
    };
  },

  // Every exam an admin can set access for (published ones, as students see them).
  async catalogExams(): Promise<BaseCatalog["exams"]> {
    return (await baseCatalog()).exams;
  },

  async createAttempt(userId: string, input: CreateAttemptInput, access: UserAccess): Promise<AttemptSummary> {
    requireFeature(access, "drills");
    const paper = await PaperModel.findOne({ _id: input.paperId, status: "published", source: trusted({ $ne: TEST_UPLOAD_SOURCE }) }).lean<PaperDoc>();
    if (!paper) throw AppError.notFound("That exam is not available");
    requireContent(access, examKeyOf(paper));
    const section = paper.sections[0];
    if (!section) throw AppError.badRequest("That exam has no questions");

    // Aggregation pipelines are not passed through the query sanitizer, so operators are written
    // plainly here. Every value comes from the validated input (strings) or from the database.
    const match: Record<string, unknown> = { paperId: paper._id, status: "published", tags: { $ne: FULL_TEST_QUESTION_TAG } };
    if (input.topics.length > 0) match.topic = { $in: input.topics };
    if (input.skills.length > 0) match.skill = { $in: input.skills };
    if (input.difficulty) match.difficulty = input.difficulty;

    if (input.excludeAnswered) {
      const answered = await AttemptModel.aggregate<{ _id: mongoose.Types.ObjectId }>([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $unwind: "$items" },
        { $match: { "items.answer": { $ne: null } } },
        { $group: { _id: "$items.questionId" } },
      ]);
      if (answered.length > 0) match._id = { $nin: answered.map((row) => row._id) };
    }

    // A free account's daily drill limit cuts the set to what is left today.
    const size = drillSize(access, Math.min(input.limit ?? MAX_QUESTIONS_PER_ATTEMPT, MAX_QUESTIONS_PER_ATTEMPT));
    const picked = await freshFirst(userId, section, match, size);
    if (picked.length === 0) throw AppError.badRequest("No questions match those filters");

    const attempt = await AttemptModel.create({
      userId,
      kind: "drill",
      origin: "exam",
      name: input.name || `${paper.title.split(" — ")[0]} practice`,
      section,
      paperId: paper._id,
      timed: input.timed,
      timeLimitSeconds: input.timed ? (input.timeMinutes ?? 30) * 60 : null,
      items: picked.map((questionId) => ({ questionId })),
    });
    return toSummary(attempt.toObject(), paper.title);
  },

  // Drill mode across the whole bank (every exam the account can open), by topic, skill and
  // difficulty, with instant feedback. Also what the analytics "practise it" buttons start.
  async createBankDrill(userId: string, input: BankDrillInput, access: UserAccess): Promise<AttemptSummary> {
    requireFeature(access, "drills");
    const catalog = await this.catalog(access);
    const paperIds = catalog.exams
      .filter((exam) => !exam.locked)
      .map((exam) => exam.sections[input.section]?.paperId)
      .filter((id): id is string => !!id)
      .map((id) => new mongoose.Types.ObjectId(id));
    if (paperIds.length === 0) throw AppError.badRequest(`No ${SECTION_LABELS[input.section]} exams are open to your account`);

    // Aggregation pipelines are not sanitized: every value is validated input or from the database.
    const match: Record<string, unknown> = { paperId: { $in: paperIds }, section: input.section, status: "published", tags: { $ne: FULL_TEST_QUESTION_TAG } };
    if (input.topics.length > 0) match.topic = { $in: input.topics };
    if (input.skills.length > 0) match.skill = { $in: input.skills };
    if (input.difficulty) match.difficulty = input.difficulty;
    if (input.excludeAnswered) {
      const answered = await AttemptModel.aggregate<{ _id: mongoose.Types.ObjectId }>([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $unwind: "$items" },
        { $match: { "items.answer": { $ne: null } } },
        { $group: { _id: "$items.questionId" } },
      ]);
      if (answered.length > 0) match._id = { $nin: answered.map((row) => row._id) };
    }
    const picked = await freshFirst(userId, input.section, match, drillSize(access, input.count));
    if (picked.length === 0) throw AppError.badRequest("No questions match those filters");

    const label = input.skills.length === 1 ? input.skills[0]! : input.topics.length === 1 ? input.topics[0]! : SECTION_LABELS[input.section];
    // Timed without a length: the official pace for this many questions.
    const minutes = input.timeMinutes ?? Math.max(1, Math.ceil((picked.length * SECTION_PACE_SECONDS[input.section]) / 60));
    const attempt = await AttemptModel.create({
      userId,
      kind: "drill",
      origin: "bank",
      name: input.name || `${label} drill`,
      section: input.section,
      paperId: null,
      timed: input.timed,
      timeLimitSeconds: input.timed ? minutes * 60 : null,
      items: picked.map((questionId) => ({ questionId })),
    });
    return toSummary(attempt.toObject(), "All exams");
  },

  // The retry queue: the section's mistakes that are due today, as a drill with instant feedback.
  async createRetryDrill(userId: string, input: RetryDrillInput, access: UserAccess): Promise<AttemptSummary> {
    const ids = await historyService.dueQuestionIds(userId, input.section, input.count, access.feature("analytics"));
    if (ids.length === 0) throw AppError.badRequest("No mistakes are due in this section right now");
    const attempt = await AttemptModel.create({
      userId,
      kind: "drill",
      origin: "retry",
      name: `Mistake retry: ${SECTION_LABELS[input.section]}`,
      section: input.section,
      paperId: null,
      timed: false,
      items: ids.map((questionId) => ({ questionId })),
    });
    return toSummary(attempt.toObject(), "Mistake bank");
  },

  // Starts an adaptive mock: builds Module 1 now. Module 2 is built when Module 1 is submitted.
  async createMock(userId: string, input: CreateMockInput, access: UserAccess): Promise<AttemptSummary> {
    requireFeature(access, "mocks");
    const { paperIds, extraPaperIds, pool } = await checkedMockPool(userId, input.section, input.paperIds, access);
    const attempt = await startMock(userId, {
      section: input.section,
      source: { pool, paperIds, extraPaperIds },
      timed: input.timed,
      timeMultiplier: input.timeMultiplier as TimeMultiplier,
      name: input.name || `Adaptive ${SECTION_LABELS[input.section]} mock`,
    });
    return summary(attempt);
  },

  // Starts a full test with its Reading & Writing section. Both pools are checked now, so the
  // student does not discover after the break that Math cannot be built.
  async createFullTest(userId: string, input: CreateFullTestInput, access: UserAccess): Promise<FullTestSummary> {
    if (input.testUploadId) {
      // A fixed test is set on its own, like an exam; the full-test feature is for pool-built tests.
      requireContent(access, uploadAccessKey(input.testUploadId), "This test is");
      return this.createPracticeTest(userId, input.testUploadId, input);
    }
    requireFeature(access, "full_tests");
    const rw = await checkedMockPool(userId, "reading_writing", input.paperIds.reading_writing, access);
    const math = await checkedMockPool(userId, "math", input.paperIds.math, access);
    const fullTest = await FullTestModel.create({
      userId,
      name: input.name || "Full practice test",
      timed: input.timed,
      timeMultiplier: input.timeMultiplier,
      paperIds: { reading_writing: rw.paperIds, math: math.paperIds },
    });
    const attempt = await startMock(userId, {
      section: "reading_writing",
      source: { pool: rw.pool, paperIds: rw.paperIds, extraPaperIds: rw.extraPaperIds },
      timed: input.timed,
      timeMultiplier: input.timeMultiplier as TimeMultiplier,
      name: `${fullTest.name} — Reading and Writing`,
      fullTestId: fullTest._id,
    });
    const saved = await FullTestModel.findByIdAndUpdate(fullTest._id, { $set: { readingWritingAttemptId: attempt._id } }, { new: true }).lean<FullTestDoc>();
    return fullTestSummary(userId, saved!);
  },

  // Active uploaded practice tests a student can sit.
  async practiceTests(access: UserAccess): Promise<PracticeTestListing[]> {
    const tests = await testUploadService.listActive();
    return pinnedFirst(tests.map((test) => ({ ...test, ...display(access, uploadAccessKey(test.id)) })));
  },

  // A sitting of an uploaded practice test: the ordinary full-test flow with the test's fixed modules.
  async createPracticeTest(userId: string, testUploadId: string, input: CreateFullTestInput): Promise<FullTestSummary> {
    const rw = await testUploadService.sectionPaper(testUploadId, "reading_writing", true);
    const math = await testUploadService.sectionPaper(testUploadId, "math", true);
    // Checked now, so the student does not find out after the break that Math cannot start.
    await fixedModule(math.paperId, "m1");
    const fullTest = await FullTestModel.create({
      userId,
      name: input.name || rw.upload.title,
      timed: input.timed,
      timeMultiplier: input.timeMultiplier,
      paperIds: { reading_writing: [rw.paperId], math: [math.paperId] },
      testUploadId: rw.upload._id,
    });
    const attempt = await startMock(userId, {
      section: "reading_writing",
      source: { fixed: { paperId: rw.paperId, testUploadId: rw.upload._id } },
      timed: input.timed,
      timeMultiplier: input.timeMultiplier as TimeMultiplier,
      name: `${fullTest.name} — Reading and Writing`,
      fullTestId: fullTest._id,
    });
    const saved = await FullTestModel.findByIdAndUpdate(fullTest._id, { $set: { readingWritingAttemptId: attempt._id } }, { new: true }).lean<FullTestDoc>();
    return fullTestSummary(userId, saved!);
  },

  // Ends the break: starts the Math section. Calling it again returns the same Math section.
  // `access` only decides which other exams may top up a Math pool the chosen exams cannot fill.
  async continueFullTest(userId: string, fullTestId: string, access?: UserAccess): Promise<FullTestSummary> {
    const fullTest = await loadFullTest(userId, fullTestId);
    if (fullTest.mathAttemptId) return fullTestSummary(userId, fullTest);
    const rw = fullTest.readingWritingAttemptId ? await loadAttempt(userId, String(fullTest.readingWritingAttemptId)) : null;
    if (!rw || rw.status !== "done") throw AppError.conflict("Finish Reading and Writing before starting Math");

    let source: MockSource;
    if (fullTest.testUploadId) {
      const math = await testUploadService.sectionPaper(String(fullTest.testUploadId), "math", false);
      source = { fixed: { paperId: math.paperId, testUploadId: fullTest.testUploadId } };
    } else {
      const math = await checkedMockPool(userId, "math", fullTest.paperIds.math.map(String), undefined, access);
      source = { pool: math.pool, paperIds: math.paperIds, extraPaperIds: math.extraPaperIds };
    }
    let attempt: AttemptDoc;
    try {
      attempt = await startMock(userId, {
        section: "math",
        source,
        timed: fullTest.timed,
        timeMultiplier: (fullTest.timeMultiplier ?? 1) as TimeMultiplier,
        name: `${fullTest.name} — Math`,
        fullTestId: fullTest._id,
      });
    } catch (error) {
      // Two "continue" requests at once: the unique index let only one create the Math section.
      if ((error as { code?: unknown }).code !== 11000) throw error;
      const existing = await AttemptModel.findOne({ fullTestId: fullTest._id, section: "math" }).lean<AttemptDoc>();
      if (!existing) throw error;
      attempt = existing;
    }
    await FullTestModel.updateOne({ _id: fullTest._id, mathAttemptId: null }, { $set: { mathAttemptId: attempt._id } });
    return fullTestSummary(userId, await loadFullTest(userId, fullTestId));
  },

  async getFullTest(userId: string, fullTestId: string): Promise<FullTestSummary> {
    return fullTestSummary(userId, await loadFullTest(userId, fullTestId));
  },

  async listFullTests(userId: string): Promise<FullTestSummary[]> {
    const fullTests = await FullTestModel.find({ userId, removedAt: null }).sort({ createdAt: -1 }).limit(50).lean<FullTestDoc[]>();
    return Promise.all(fullTests.map((fullTest) => fullTestSummary(userId, fullTest)));
  },

  // Deletes a drill or mock the student owns, finished or not. A section of a full test is deleted
  // with its full test (deleteFullTest), so a full test is never left with one section missing.
  async deleteAttempt(userId: string, attemptId: string): Promise<void> {
    const attempt = await AttemptModel.findOne({ _id: attemptId, userId }).select("fullTestId").lean<AttemptDoc>();
    if (!attempt) throw AppError.notFound("Attempt not found");
    if (attempt.fullTestId) throw AppError.conflict("This section belongs to a full test. Delete the full test instead.");
    // Removed from the student's lists only: history and analytics keep every attempt (proposal 3.1).
    await AttemptModel.updateOne({ _id: attempt._id, userId }, { $set: { removedAt: new Date() } });
  },

  async deleteFullTest(userId: string, fullTestId: string): Promise<void> {
    const fullTest = await loadFullTest(userId, fullTestId);
    const removedAt = new Date();
    await AttemptModel.updateMany({ fullTestId: fullTest._id, userId }, { $set: { removedAt } });
    await FullTestModel.updateOne({ _id: fullTest._id, userId }, { $set: { removedAt } });
  },

  async listAttempts(userId: string): Promise<AttemptSummary[]> {
    const attempts = await AttemptModel.find({ userId, removedAt: null }).sort({ createdAt: -1 }).limit(100).lean<AttemptDoc[]>();
    return Promise.all(attempts.map(async (attempt) => summary(await withScore(attempt))));
  },

  async getAttempt(userId: string, attemptId: string): Promise<{ attempt: AttemptSummary; navigation: AttemptNavItem[] }> {
    const attempt = await loadAttempt(userId, attemptId);
    return { attempt: await summary(attempt), navigation: toNavigation(attempt) };
  },

  // `peek`: the test screen loading the next question ahead of time. The student is not looking at
  // it yet, so the view (and its timing) is not recorded.
  async getQuestion(userId: string, attemptId: string, position: number, peek = false): Promise<AttemptQuestion> {
    const attempt = await loadAttempt(userId, attemptId);
    const item = itemAt(attempt, position);
    const reveal = item.checked || attempt.status === "done";
    const query = QuestionModel.findById(item.questionId);
    if (reveal) query.select("+correctAnswer +explanation");
    // Independent of each other, so one database round trip instead of two.
    const [question] = await Promise.all([query.lean<QuestionDoc>(), peek ? undefined : recordView(attempt, position)]);
    if (!question) throw AppError.notFound("This question is no longer available");
    return toQuestionView(question, item, position, reveal);
  },

  // For reports: which question a student means by an attempt and position, without ever telling
  // the student the question's ID.
  async locateQuestion(userId: string, attemptId: string, position: number): Promise<{ attempt: AttemptDoc; item: Item }> {
    const attempt = await loadAttempt(userId, attemptId);
    return { attempt, item: itemAt(attempt, position) };
  },

  async saveAnswer(userId: string, attemptId: string, position: number, input: SaveAnswerInput): Promise<AttemptNavItem> {
    const attempt = await loadAttempt(userId, attemptId);
    if (attempt.status !== "active") throw AppError.conflict("This attempt has ended");
    const item = itemAt(attempt, position);
    // Once the answer has been revealed it can no longer be changed.
    if (item.checked && input.answer !== undefined) throw AppError.conflict("This question has already been checked");

    const index = position - 1;
    const set: Record<string, unknown> = { lastPosition: position };
    const update: Record<string, unknown> = { $set: set };
    if (input.answer !== undefined) set[`items.${index}.answer`] = input.answer === "" ? null : input.answer;
    if (input.flagged !== undefined) set[`items.${index}.flagged`] = input.flagged;
    // Each different answer is remembered (last 10), to spot a right answer changed to a wrong one.
    if (input.answer && input.answer !== item.answer) update.$push = { [`items.${index}.answers`]: { $each: [input.answer], $slice: -10 } };
    // The module guard repeats the check in the write itself, so a save racing a module
    // submission cannot land in a closed module.
    const filter: Record<string, unknown> = { _id: attempt._id, status: "active" };
    if (attempt.kind === "mock") filter.currentModule = attempt.currentModule;
    const result = await AttemptModel.updateOne(filter, update);
    if (result.matchedCount === 0) throw AppError.conflict("This module has already been submitted");

    const answer = input.answer !== undefined ? (input.answer === "" ? null : input.answer) : item.answer;
    return { position, answered: answer !== null, flagged: input.flagged ?? item.flagged, checked: item.checked };
  },

  // Replaces the student's highlights and notes on one question. Like answers: only while the
  // attempt runs, and in a mock only in the current module.
  async saveAnnotations(userId: string, attemptId: string, position: number, input: SaveAnnotationsInput): Promise<Annotation[]> {
    const attempt = await loadAttempt(userId, attemptId);
    if (attempt.status !== "active") throw AppError.conflict("This attempt has ended");
    itemAt(attempt, position);
    const filter: Record<string, unknown> = { _id: attempt._id, status: "active" };
    if (attempt.kind === "mock") filter.currentModule = attempt.currentModule;
    const result = await AttemptModel.updateOne(filter, { $set: { [`items.${position - 1}.annotations`]: input.annotations } });
    if (result.matchedCount === 0) throw AppError.conflict("This module has already been submitted");
    return input.annotations;
  },

  // Reveals the answer to one drill question. The question is locked afterwards.
  async checkQuestion(userId: string, attemptId: string, position: number): Promise<AttemptQuestion> {
    const attempt = await loadAttempt(userId, attemptId);
    if (attempt.kind === "mock") throw AppError.badRequest("Answers in a mock are shown after it is finished");
    if (attempt.status !== "active") throw AppError.conflict("This attempt has ended");
    const item = itemAt(attempt, position);
    if (item.answer === null) throw AppError.badRequest("Answer the question before checking it");

    const question = await QuestionModel.findById(item.questionId).select("+correctAnswer +explanation").lean<QuestionDoc>();
    if (!question) throw AppError.notFound("This question is no longer available");
    const correct = gradeAnswer(question, item.answer);
    const index = position - 1;
    await AttemptModel.updateOne(
      { _id: attempt._id, status: "active" },
      { $set: { [`items.${index}.checked`]: true, [`items.${index}.correct`]: correct } },
    );
    // Into the history now (with the time it has been open), without delaying the answer.
    const open = openViewSeconds(attempt, Date.now());
    const seconds = (item.timeSpentSeconds ?? 0) + (open && open.index === index ? open.seconds : 0);
    const items = attempt.items.map((entry, i) => (i === index ? { ...entry, checked: true, correct, timeSpentSeconds: seconds } : entry));
    void activityService.recordAttempt(attempt, items, [position]);
    return toQuestionView(question, { ...item, checked: true, correct }, position, true);
  },

  // Mock only: submits Module 1 and starts Module 2.
  async submitModule(userId: string, attemptId: string): Promise<{ attempt: AttemptSummary; navigation: AttemptNavItem[] }> {
    const loaded = await loadAttempt(userId, attemptId);
    if (loaded.kind !== "mock") throw AppError.badRequest("Only an adaptive mock has modules");
    if (loaded.status !== "active") throw AppError.conflict("This mock has ended");
    if (loaded.currentModule !== "m1") throw AppError.conflict("Module 1 has already been submitted");
    const attempt = await submitModuleOne(loaded);
    return { attempt: await summary(attempt), navigation: toNavigation(attempt) };
  },

  async endAttempt(userId: string, attemptId: string): Promise<AttemptSummary> {
    return summary(await withScore(await finalize(await loadAttempt(userId, attemptId))));
  },

  async getResult(userId: string, attemptId: string): Promise<{ attempt: AttemptSummary; questions: ReviewQuestion[] }> {
    const attempt = await loadAttempt(userId, attemptId);
    if (attempt.status !== "done") throw AppError.conflict("Results are available after the attempt is submitted");

    const questions = await QuestionModel.find({ _id: trusted({ $in: attempt.items.map((item) => item.questionId) }) })
      .select("+correctAnswer +explanation")
      .lean<QuestionDoc[]>();
    const byId = new Map(questions.map((question) => [String(question._id), question]));

    const review: ReviewQuestion[] = [];
    attempt.items.forEach((item, index) => {
      const question = byId.get(String(item.questionId));
      if (!question) return;
      const view = toQuestionView(question, item, index + 1, true);
      review.push({
        ...view,
        result: view.result!,
        topic: question.topic,
        skill: question.skill,
        difficulty: question.difficulty,
        timeSpentSeconds: item.timeSpentSeconds ?? 0,
      });
    });
    return { attempt: await summary(attempt), questions: review };
  },
};
