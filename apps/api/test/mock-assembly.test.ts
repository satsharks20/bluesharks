import assert from "node:assert/strict";
import { test } from "node:test";
import { MATH_SPR_POSITIONS, MODULE_PATTERN } from "@satsharks/types";
import { orderModule, pickModule, pickPatternModule, requiredForHard, type Candidate } from "../src/services/mock-assembly";

// Deterministic "random" so tests are repeatable.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

const candidate = (fields: Partial<Candidate> & { id: string }): Candidate => ({
  key: fields.id,
  skill: null,
  topic: null,
  difficulty: null,
  questionType: "mcq",
  quantitative: false,
  seenAt: null,
  ...fields,
});

const SKILLS = Array.from({ length: 10 }, (_, i) => `skill-${i}`);
// 10 skills x 6 questions: 2 easy, 2 hard, 2 unlabelled each.
const pool: Candidate[] = SKILLS.flatMap((skill, s) =>
  ["easy", "easy", "hard", "hard", null, null].map((difficulty, i) =>
    candidate({ id: `${s}-${i}`, skill, topic: `topic-${s % 4}`, difficulty: difficulty as Candidate["difficulty"] }),
  ),
);

test("a module is spread across every skill before any skill repeats", () => {
  const module = pickModule(pool, 22, "m1", new Set(), seeded(1));
  assert.equal(module.length, 22);
  const perSkill = SKILLS.map((skill) => module.filter((q) => q.skill === skill).length);
  // 22 over 10 skills: every skill twice, two skills three times.
  assert.ok(perSkill.every((n) => n >= 2 && n <= 3), perSkill.join(","));
  assert.equal(new Set(module.map((q) => q.id)).size, 22, "no duplicates");
});

test("the harder Module 2 takes hard questions first, the easier one easy questions first", () => {
  const hard = pickModule(pool, 20, "m2_hard", new Set(), seeded(2));
  const easy = pickModule(pool, 20, "m2_easy", new Set(), seeded(3));
  assert.ok(hard.every((q) => q.difficulty === "hard"), "20 picks over 10 skills with 2 hard each: all hard");
  assert.ok(easy.every((q) => q.difficulty === "easy"));
});

test("when a preferred difficulty runs out, the module is still filled", () => {
  const hard = pickModule(pool, 40, "m2_hard", new Set(), seeded(4));
  assert.equal(hard.length, 40);
  assert.equal(hard.filter((q) => q.difficulty === "hard").length, 20);
  assert.equal(hard.filter((q) => q.difficulty === "easy").length, 0, "unlabelled before easy");
});

test("Module 2 never repeats a Module 1 question", () => {
  const one = pickModule(pool, 22, "m1", new Set(), seeded(5));
  const two = pickModule(pool, 22, "m2_hard", new Set(one.map((q) => q.key)), seeded(6));
  assert.equal(two.length, 22);
  assert.ok(two.every((q) => !one.some((o) => o.id === q.id)));
});

test("a pool smaller than the module returns what it has", () => {
  assert.equal(pickModule(pool.slice(0, 5), 22, "m1", new Set(), seeded(7)).length, 5);
});

test("Math modules run from easier to harder; Reading & Writing follows the official domain order", () => {
  const math = orderModule(pickModule(pool, 22, "m1", new Set(), seeded(8)), "math");
  const rank = (q: Candidate) => ({ easy: 0, medium: 1, hard: 2 })[q.difficulty ?? "medium"];
  assert.ok(math.every((q, i) => i === 0 || rank(math[i - 1]!) <= rank(q)));

  const domains = ["Expression of Ideas", "Craft and Structure", "Standard English Conventions", "Information and Ideas"];
  const rw = orderModule(
    domains.map((topic, i) => candidate({ id: String(i), topic })),
    "reading_writing",
  );
  assert.deepEqual(rw.map((q) => q.topic), ["Craft and Structure", "Information and Ideas", "Standard English Conventions", "Expression of Ideas"]);
});

test("routing threshold: 65% means 15 of 22 and 18 of 27", () => {
  assert.equal(requiredForHard(22, 65), 15);
  assert.equal(requiredForHard(27, 65), 18);
  assert.equal(requiredForHard(22, 50), 11);
  assert.equal(requiredForHard(22, 100), 22);
});

// ---------- repeats ----------

test("never-seen questions come first; when they run out, the ones seen longest ago", () => {
  // Skill 0 only: 6 questions, 4 seen at different times.
  const small = pool.filter((q) => q.skill === "skill-0").map((q, i) => ({ ...q, seenAt: i < 4 ? 1000 * (4 - i) : null }));
  const picked = pickModule(small, 4, "m1", new Set(), seeded(9));
  assert.deepEqual(picked.slice(0, 2).map((q) => q.seenAt), [null, null], "unseen first");
  assert.deepEqual(picked.slice(2).map((q) => q.seenAt), [1000, 2000], "then oldest seen");
});

test("questions that look the same are one question: never twice, and seen once means seen", () => {
  const twins = [
    candidate({ id: "a", key: "same", skill: "s" }),
    candidate({ id: "b", key: "same", skill: "s", seenAt: 5 }),
    candidate({ id: "c", key: "other", skill: "s" }),
  ];
  const picked = pickModule(twins, 3, "m1", new Set(), seeded(10));
  assert.equal(picked.length, 2, "only two different questions");
  assert.equal(picked[0]!.key, "other", "the twin of a seen question counts as seen");
});

// ---------- official pattern ----------

const RW_SKILLS = MODULE_PATTERN.reading_writing.map((entry) => ({ skill: (entry.match as { skill: string }).skill, domain: entry.domain! }));
// 12 questions per skill, a third each easy / unlabelled / hard; half the evidence ones on a graph.
const rwPool: Candidate[] = RW_SKILLS.flatMap(({ skill, domain }, s) =>
  Array.from({ length: 12 }, (_, i) =>
    candidate({ id: `rw-${s}-${i}`, skill, topic: domain, difficulty: (["easy", null, "hard"] as const)[i % 3], quantitative: i % 2 === 0 }),
  ),
);

test("Reading and Writing follows the official pattern: counts and order of question types", () => {
  for (const module of ["m1", "m2_hard"] as const) {
    const picked = pickPatternModule(rwPool, "reading_writing", module, new Set(), seeded(11));
    assert.equal(picked.length, 27);
    const expected = MODULE_PATTERN.reading_writing.flatMap((entry) => Array<string>(module === "m1" ? entry.m1 : entry.m2).fill((entry.match as { skill: string }).skill));
    // Boundaries and Form, Structure, and Sense are mixed as one block, so compare that block as a set.
    const conventions = new Set(["Boundaries", "Form, Structure, and Sense"]);
    const shape = (skills: string[]) => skills.map((skill) => (conventions.has(skill) ? "Conventions" : skill));
    assert.deepEqual(shape(picked.map((q) => q.skill!)), shape(expected), module);
    for (const skill of conventions) assert.equal(picked.filter((q) => q.skill === skill).length, 3);
    const evidence = picked.filter((q) => q.skill === "Command of Evidence");
    assert.equal(evidence.filter((q) => q.quantitative).length, 2, "two of four on a table or graph");
  }
});

test("inside each block, easier questions come first", () => {
  const picked = pickPatternModule(rwPool, "reading_writing", "m1", new Set(), seeded(12));
  const rank = (q: Candidate) => ({ easy: 0, none: 1, medium: 1, hard: 2 })[q.difficulty ?? "none"];
  const words = picked.filter((q) => q.skill === "Words in Context");
  assert.ok(words.every((q, i) => i === 0 || rank(words[i - 1]!) <= rank(q)));
});

test("a short skill is filled from its own domain before anything else", () => {
  const noCrossText = rwPool.filter((q) => q.skill !== "Cross-Text Connections");
  const picked = pickPatternModule(noCrossText, "reading_writing", "m1", new Set(), seeded(13));
  assert.equal(picked.length, 27);
  assert.equal(picked.filter((q) => q.topic === "Craft and Structure").length, 7, "Craft and Structure keeps its 7");
});

test("the pattern prefers never-seen questions even over the exact skill mix", () => {
  // Every Words in Context question seen: the slot takes unseen Craft and Structure questions.
  const seenWords = rwPool.map((q) => (q.skill === "Words in Context" ? { ...q, seenAt: 1 } : q));
  const picked = pickPatternModule(seenWords, "reading_writing", "m1", new Set(), seeded(14));
  assert.equal(picked.filter((q) => q.seenAt !== null).length, 0);
  assert.equal(picked.filter((q) => q.topic === "Craft and Structure").length, 7);
});

test("a repeat is the last resort: a used-up domain takes new questions from another domain first", () => {
  // Every Standard English Conventions question seen; plenty new elsewhere.
  const seenConventions = rwPool.map((q) => (q.topic === "Standard English Conventions" ? { ...q, seenAt: 1 } : q));
  const picked = pickPatternModule(seenConventions, "reading_writing", "m1", new Set(), seeded(17));
  assert.equal(picked.length, 27);
  assert.equal(picked.filter((q) => q.seenAt !== null).length, 0);
});

test("top-up: the chosen exam's new questions first, then other exams' new ones, repeats last", () => {
  // The chosen exam: 6 Words in Context questions, 2 of them seen. Other exams: plenty, all new.
  const own = rwPool.filter((q) => q.skill === "Words in Context").slice(0, 6).map((q, i) => ({ ...q, id: `own-${i}`, key: `own-${i}`, seenAt: i < 2 ? 5 : null }));
  const others = rwPool.map((q) => ({ ...q, fallback: true }));
  const one = pickPatternModule([...own, ...others], "reading_writing", "m1", new Set(), seeded(18));
  const words = one.filter((q) => q.skill === "Words in Context");
  assert.equal(words.filter((q) => !q.fallback).length, 4, "the four new ones of the chosen exam fill Words in Context");
  assert.equal(one.filter((q) => q.seenAt !== null).length, 0, "other exams' new questions before a repeat");
  assert.equal(one.length, 27);
});

test("an exam with no questions in the section: both modules come from other exams", () => {
  const others = rwPool.map((q) => ({ ...q, fallback: true }));
  const one = pickPatternModule(others, "reading_writing", "m1", new Set(), seeded(19));
  const two = pickPatternModule(others, "reading_writing", "m2_hard", new Set(one.map((q) => q.key)), seeded(20));
  assert.equal(one.length + two.length, 54);
});

const MATH_DOMAINS = MODULE_PATTERN.math.map((entry) => (entry.match as { topic: string }).topic);
const mathPool: Candidate[] = MATH_DOMAINS.flatMap((topic, d) =>
  Array.from({ length: 30 }, (_, i) =>
    candidate({ id: `m-${d}-${i}`, topic, skill: `${topic}-${i % 4}`, questionType: i % 3 === 0 ? "spr" : "mcq", difficulty: (["easy", null, "hard"] as const)[i % 3] }),
  ),
);

test("Math follows the official domain counts with typed answers in their places", () => {
  const one = pickPatternModule(mathPool, "math", "m1", new Set(), seeded(15));
  assert.equal(one.length, 22);
  assert.deepEqual(
    MATH_DOMAINS.map((topic) => one.filter((q) => q.topic === topic).length),
    MODULE_PATTERN.math.map((entry) => entry.m1),
  );
  const typed = one.map((q, i) => (q.questionType === "spr" ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual(typed, [...MATH_SPR_POSITIONS]);
  // Each domain spreads over its skills.
  const algebra = one.filter((q) => q.topic === "Algebra");
  assert.equal(new Set(algebra.map((q) => q.skill)).size, 4);

  const two = pickPatternModule(mathPool, "math", "m2_easy", new Set(one.map((q) => q.key)), seeded(16));
  assert.deepEqual(
    MATH_DOMAINS.map((topic) => two.filter((q) => q.topic === topic).length),
    MODULE_PATTERN.math.map((entry) => entry.m2),
  );
  assert.ok(two.every((q) => !one.some((o) => o.key === q.key)), "Module 2 shares nothing with Module 1");
});

test("the official pattern adds up to the module sizes", () => {
  for (const section of ["reading_writing", "math"] as const) {
    const size = section === "math" ? 22 : 27;
    assert.equal(MODULE_PATTERN[section].reduce((sum, entry) => sum + entry.m1, 0), size);
    assert.equal(MODULE_PATTERN[section].reduce((sum, entry) => sum + entry.m2, 0), size);
  }
  assert.equal(MODULE_PATTERN.math.reduce((sum, entry) => sum + entry.sprM1!, 0), MATH_SPR_POSITIONS.length);
});
