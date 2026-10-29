// Builds the modules of an adaptive mock from a pool of published questions.
//
// Repeats: a student is given questions they have never been given first (`seenAt` null). When the
// pool has run out of those, the ones given longest ago fill the gap, so a test can always start.
// Questions with the same fingerprint (`key`, the source reuses questions across exam dates) are
// one question: only one of them is ever drawn, and seeing one counts as seeing all.
// Top-up: when the chosen exams cannot fill both modules (an exam with no Math, or too few), the
// pool also holds the student's other exams, marked `fallback`. Never-seen questions of the chosen
// exams come first, then never-seen ones of the other exams, then repeats.
//
// Two ways to build a module:
//   Official pattern (pickPatternModule) — the count and order of question types of the official
//     tests (MODULE_PATTERN in packages/types). The default.
//   Spread (pickModule + orderModule) — one question per skill in turn, as the source site does.
//     Used when an admin turns the pattern off.
// Each module prefers a difficulty:
//   Module 1          — no preference
//   Module 2 (harder) — hard first, then medium, then unlabelled, then easy
//   Module 2 (easier) — easy first, then medium, then unlabelled, then hard
// The preference only orders questions within what a module needs; never seen comes first.
import { COMMAND_OF_EVIDENCE_SKILL, MATH_SPR_POSITIONS, MODULE_PATTERN, type Difficulty, type MockModule, type PatternEntry, type QuestionType, type Section } from "@satsharks/types";

export interface Candidate {
  id: string;
  // Fingerprint; questions that look the same share it. Falls back to the id.
  key: string;
  skill: string | null;
  topic: string | null;
  difficulty: Difficulty | null;
  questionType: QuestionType;
  // On a table or graph (Command of Evidence: the quantitative kind).
  quantitative: boolean;
  // When this student was last given the question (ms), or null if never.
  seenAt: number | null;
  // From another exam, only there to fill what the chosen exams lack.
  fallback?: boolean;
}

const RANK: Record<"m2_easy" | "m2_hard", Record<string, number>> = {
  m2_hard: { hard: 0, medium: 1, none: 2, easy: 3 },
  m2_easy: { easy: 0, medium: 1, none: 2, hard: 3 },
};

// Reading & Writing modules follow the official order of domains (spread mode).
const RW_DOMAIN_ORDER = ["Craft and Structure", "Information and Ideas", "Standard English Conventions", "Expression of Ideas"];
const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, none: 1, hard: 2 };
const difficultyOf = (candidate: Candidate) => DIFFICULTY_ORDER[candidate.difficulty ?? "none"]!;

export type Random = () => number;

function shuffle<T>(items: T[], random: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

// One candidate per fingerprint, never one already used in this attempt. A fingerprint counts as
// seen when any of its questions was.
export function uniqueByKey(pool: Candidate[], exclude: ReadonlySet<string>, random: Random): Candidate[] {
  const byKey = new Map<string, Candidate[]>();
  for (const candidate of pool) {
    if (exclude.has(candidate.key)) continue;
    byKey.set(candidate.key, [...(byKey.get(candidate.key) ?? []), candidate]);
  }
  return [...byKey.values()].map((all) => {
    // The chosen exam's copy of a question rather than another exam's.
    const own = all.filter((twin) => !twin.fallback);
    const twins = own.length > 0 ? own : all;
    const pick = twins[Math.floor(random() * twins.length)]!;
    const seen = all.map((twin) => twin.seenAt).filter((at): at is number => at !== null);
    return { ...pick, seenAt: seen.length > 0 ? Math.max(...seen) : null };
  });
}

// Never seen first (the chosen exams' before other exams', random, then the module's preferred
// difficulty), then seen longest ago first.
function ranked(candidates: Candidate[], module: MockModule, random: Random): Candidate[] {
  const rank = module === "m1" ? null : RANK[module];
  const fresh = shuffle(candidates.filter((candidate) => candidate.seenAt === null), random);
  if (rank) fresh.sort((a, b) => rank[a.difficulty ?? "none"]! - rank[b.difficulty ?? "none"]!);
  fresh.sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback));
  const seen = shuffle(candidates.filter((candidate) => candidate.seenAt !== null), random).sort((a, b) => a.seenAt! - b.seenAt!);
  return [...fresh, ...seen];
}

// Takes from each group in turn (one skill after another): never-seen questions of the chosen exams
// in every group first, then never-seen ones of other exams, then seen ones.
const tier = (candidate: Candidate) => (candidate.seenAt !== null ? 2 : candidate.fallback ? 1 : 0);
function roundRobin(groups: Candidate[][]): Candidate[] {
  const out: Candidate[] = [];
  for (const level of [0, 1, 2]) {
    const queues = groups.map((group) => group.filter((candidate) => tier(candidate) === level));
    while (queues.some((queue) => queue.length > 0)) {
      for (const queue of queues) {
        const next = queue.shift();
        if (next) out.push(next);
      }
    }
  }
  return out;
}

function bySkill(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = candidate.skill ?? "(no skill)";
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups.values()];
}

// ---------- spread mode ----------

export function pickModule(pool: Candidate[], size: number, module: MockModule, exclude: ReadonlySet<string>, random: Random = Math.random): Candidate[] {
  const available = uniqueByKey(pool, exclude, random);
  const queues = shuffle(bySkill(available), random).map((group) => ranked(group, module, random));
  return roundRobin(queues).slice(0, size);
}

// Order of questions inside a module: Reading & Writing by domain, Math from easier to harder.
export function orderModule(questions: Candidate[], section: Section): Candidate[] {
  if (section === "math") return [...questions].sort((a, b) => difficultyOf(a) - difficultyOf(b));
  const domain = (candidate: Candidate) => {
    const index = RW_DOMAIN_ORDER.indexOf(candidate.topic ?? "");
    return index < 0 ? RW_DOMAIN_ORDER.length : index;
  };
  return [...questions].sort((a, b) => domain(a) - domain(b) || difficultyOf(a) - difficultyOf(b));
}

// ---------- official pattern ----------

const matches = (entry: PatternEntry, candidate: Candidate) => ("skill" in entry.match ? candidate.skill === entry.match.skill : candidate.topic === entry.match.topic);

// How an entry's questions split further: Math by answer type, Command of Evidence by kind
// (half on a table or graph, as in the official tests).
function parts(entry: PatternEntry, count: number, module: MockModule): { test: (candidate: Candidate) => boolean; count: number }[] {
  const spr = module === "m1" ? entry.sprM1 : entry.sprM2;
  if (spr !== undefined) {
    const typed = Math.min(spr, count);
    return [
      { test: (candidate) => candidate.questionType === "spr", count: typed },
      { test: (candidate) => candidate.questionType !== "spr", count: count - typed },
    ];
  }
  if ("skill" in entry.match && entry.match.skill === COMMAND_OF_EVIDENCE_SKILL) {
    const quantitative = Math.ceil(count / 2);
    return [
      { test: (candidate) => candidate.quantitative, count: quantitative },
      { test: (candidate) => !candidate.quantitative, count: count - quantitative },
    ];
  }
  return [{ test: () => true, count }];
}

export function pickPatternModule(
  pool: Candidate[],
  section: Section,
  module: MockModule,
  exclude: ReadonlySet<string>,
  random: Random = Math.random,
): Candidate[] {
  const entries = MODULE_PATTERN[section];
  const size = entries.reduce((sum, entry) => sum + (module === "m1" ? entry.m1 : entry.m2), 0);
  const available = uniqueByKey(pool, exclude, random);
  const taken = new Set<string>();
  const picked: Candidate[][] = entries.map(() => []);
  const wanted = entries.map((entry) => (module === "m1" ? entry.m1 : entry.m2));

  // Each entry's candidates in the order they should be taken: skills spread evenly (Math domains
  // hold several), never seen first.
  const lists = entries.map((entry) => roundRobin(shuffle(bySkill(available.filter((candidate) => matches(entry, candidate))), random).map((group) => ranked(group, module, random))));

  const take = (index: number, from: Candidate[], test: (candidate: Candidate) => boolean, limit: number) => {
    for (const candidate of from) {
      if (picked[index]!.length >= wanted[index]! || limit <= 0) return;
      if (taken.has(candidate.key) || !test(candidate)) continue;
      taken.add(candidate.key);
      picked[index]!.push(candidate);
      limit--;
    }
  };
  const fresh = (candidate: Candidate) => candidate.seenAt === null;
  const any = () => true;

  // 1. Never-seen questions of the entry itself, in its parts (answer type, evidence kind).
  entries.forEach((entry, index) => {
    for (const part of parts(entry, wanted[index]!, module)) take(index, lists[index]!, (candidate) => fresh(candidate) && part.test(candidate), part.count);
  });
  // 2. Still never seen: the entry's other part, then a skill of the same domain, then any skill.
  // A repeat is the last resort: a nearly used-up exam gives new questions out of place first.
  const rest = ranked(available, module, random);
  entries.forEach((_, index) => take(index, lists[index]!, fresh, Infinity));
  entries.forEach((entry, index) => {
    if (entry.domain) take(index, ranked(available.filter((candidate) => candidate.topic === entry.domain), module, random), fresh, Infinity);
  });
  entries.forEach((_, index) => take(index, rest, fresh, Infinity));
  // 3. Seen before, longest ago first: the entry's parts, then the entry, the domain, anything.
  entries.forEach((entry, index) => {
    for (const part of parts(entry, wanted[index]!, module)) take(index, lists[index]!, part.test, part.count - picked[index]!.filter(part.test).length);
  });
  entries.forEach((_, index) => take(index, lists[index]!, any, Infinity));
  entries.forEach((entry, index) => {
    if (entry.domain) take(index, ranked(available.filter((candidate) => candidate.topic === entry.domain), module, random), any, Infinity);
  });
  entries.forEach((_, index) => take(index, rest, any, Infinity));

  return orderPattern(picked, entries, section).slice(0, size);
}

// Reading and Writing: entry by entry, easier to harder inside each (entries sharing a group are
// mixed as one block). Math: easier to harder, typed answers in their official places.
function orderPattern(picked: Candidate[][], entries: readonly PatternEntry[], section: Section): Candidate[] {
  const byDifficulty = (list: Candidate[]) => [...list].sort((a, b) => difficultyOf(a) - difficultyOf(b));
  if (section === "math") {
    const all = picked.flat();
    const typed = byDifficulty(all.filter((candidate) => candidate.questionType === "spr"));
    const slots = MATH_SPR_POSITIONS.filter((position) => position <= all.length).slice(0, typed.length);
    const choices = byDifficulty([...all.filter((candidate) => candidate.questionType !== "spr"), ...typed.slice(slots.length)]);
    const out: Candidate[] = [];
    let t = 0;
    for (let position = 1; position <= all.length; position++) out.push(slots.includes(position) ? typed[t++]! : choices.shift()!);
    return out;
  }
  const out: Candidate[] = [];
  for (let index = 0; index < entries.length; index++) {
    const group = entries[index]!.group;
    let block = picked[index]!;
    while (group && entries[index + 1]?.group === group) block = [...block, ...picked[++index]!];
    out.push(...byDifficulty(block));
  }
  return out;
}

// Correct answers needed in Module 1 for the harder Module 2.
export function requiredForHard(moduleOneSize: number, thresholdPercent: number): number {
  return Math.ceil((moduleOneSize * thresholdPercent) / 100);
}
