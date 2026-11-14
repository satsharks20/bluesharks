import assert from "node:assert/strict";
import { test } from "node:test";
import katex from "katex";
import { latexSegments, splitAcceptedValues, uploadQuestionProblems, type CatalogTopic, type UploadQuestion } from "@satsharks/types";
import { isPlainMath, parseSectionText, plainMathToSite, reflow } from "../src/services/test-upload-parser";

const mcq = (n: number, extra = "") => `QUESTION ${n}
CATEGORY: Algebra
SKILL: Linear equations in one variable
DIFFICULTY: MEDIUM${extra}
PROMPT: If $3x + 7 = 22$, what is the
value of $x$?
A: $3$
B: $5$
C: $7$
D: $15$
ANSWER: b
EXPLANATION: Subtract $7$ from both sides,
then divide by $3$.
END QUESTION`;

const gridIn = (n: number) => `QUESTION ${n}
CATEGORY: Algebra
SKILL: Linear equations in one variable
DIFFICULTY: HARD
TYPE: GRID_IN
PROMPT: What is the value of $\\frac{1}{2}$?
ANSWER: 0.5 or 1/2
EXPLANATION: One half is $0.5$.
END QUESTION`;

const mathModule = (header: string, count: number) =>
  [header, ...Array.from({ length: count }, (_, i) => (i === 1 ? gridIn(i + 1) : mcq(i + 1))), "END MODULE"].join("\n");

const mathDocument = ["SAT Sharks Test 1 — Math", "SECTION: MATH", mathModule("MODULE 1", 22), "-- 1 of 9 --", mathModule("MODULE 2 EASY", 22), mathModule("MODULE 2 HARDER", 22)].join("\n");

test("a valid Math file gives every module in order, with formulas joined across wrapped lines", () => {
  const result = parseSectionText(mathDocument);
  assert.deepEqual(result.errors, []);
  assert.equal(result.section, "math");
  assert.deepEqual(
    ["m1", "m2_easy", "m2_hard"].map((module) => result.questions.filter((q) => q.module === module).length),
    [22, 22, 22],
  );
  const first = result.questions[0]!;
  assert.equal(first.prompt, "If $3x + 7 = 22$, what is the value of $x$?");
  assert.equal(first.choiceKey, "B");
  assert.equal(first.category, "Algebra");
  assert.equal(first.skill, "Linear equations in one variable");
  assert.equal(first.difficulty, "medium");
  assert.equal(first.explanation, "Subtract $7$ from both sides, then divide by $3$.");
  const grid = result.questions[1]!;
  assert.equal(grid.questionType, "spr");
  assert.deepEqual(grid.choices, []);
  assert.deepEqual(grid.acceptedValues, ["0.5", "1/2"]);
});

test("MODULE 2 EASIER is the easier module and HARDER the harder one", () => {
  const doc = ["SECTION: MATH", mathModule("MODULE 1", 1), mathModule("MODULE 2 EASIER", 1), mathModule("MODULE 2 HARDER", 2)].join("\n");
  const result = parseSectionText(doc);
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions.filter((q) => q.module === "m2_easy").length, 1);
  assert.equal(result.questions.filter((q) => q.module === "m2_hard").length, 2);
});

const rwQuestion = (n: number) => `QUESTION ${n}
CATEGORY: Information and Ideas
SKILL: Central Ideas and Details
DIFFICULTY: EASY
PASSAGE: Text 1
The following text is adapted from a
novel. The narrator walks

through the old town, which cost $5 to enter.
• first note
• second note
PROMPT: Which choice best states the main
idea of the text?
A: Choice one
B: Choice two
that wraps
C: Choice three
D: Choice four
ANSWER: a
EXPLANATION: Choice A states
the central claim.
END QUESTION`;

const rwModule = (header: string, count: number) => [header, ...Array.from({ length: count }, (_, i) => rwQuestion(i + 1)), "END MODULE"].join("\n");

test("Reading & Writing keeps passage and prompt apart and re-joins wrapped prose", () => {
  const result = parseSectionText(["SECTION: READING_WRITING", rwModule("MODULE 1", 27), rwModule("MODULE 2 EASY", 27), rwModule("MODULE 2 HARD", 26)].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.section, "reading_writing");
  const first = result.questions[0]!;
  // A blank line (a paragraph gap in the PDF) and list items start new paragraphs.
  assert.equal(first.passage, "Text 1\nThe following text is adapted from a novel. The narrator walks\nthrough the old town, which cost $5 to enter.\n• first note\n• second note");
  assert.equal(first.prompt, "Which choice best states the main idea of the text?");
  assert.equal(first.choices[1]!.text, "Choice two that wraps");
  assert.equal(first.choiceKey, "A");
  assert.equal(first.explanation, "Choice A states the central claim.");
});

test("a Math passage opens the question text, since Math shows no separate passage", () => {
  const question = mcq(1, "\nPASSAGE: A table shows the data.");
  const result = parseSectionText(["SECTION: MATH", "MODULE 1", question, "END MODULE", mathModule("MODULE 2 EASY", 1), mathModule("MODULE 2 HARD", 1)].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions[0]!.passage, null);
  assert.ok(result.questions[0]!.prompt.startsWith("A table shows the data.\nIf $3x"));
});

test("reflow keeps a display formula on its own line and never splits a formula", () => {
  assert.equal(reflow(["Solve the system:", "$$2x + y = 7$$", "Then find", "the value of $x +", "y$."]), "Solve the system:\n$$2x + y = 7$$\nThen find the value of $x + y$.");
  assert.equal(reflow(["$$\\frac{a}{b}", "= 3$$", "next"]), "$$\\frac{a}{b} = 3$$\nnext");
});

test("page markers and invisible characters are ignored", () => {
  const doc = mathDocument.replace("SECTION: MATH", "SECTION: MA​TH").replace("END MODULE", "-- 2 of 9 --\nEND MODULE");
  assert.deepEqual(parseSectionText(doc).errors, []);
});

const errorsFor = (doc: string) => parseSectionText(doc).errors.join("\n");

test("broken files are rejected whole, with the reason", () => {
  assert.match(errorsFor(mathModule("MODULE 1", 2)), /SECTION: READING_WRITING or SECTION: MATH is missing/);
  assert.match(errorsFor(["SECTION: MATH", mathModule("MODULE 1", 2)].join("\n")), /Module 2 \(easier\) is missing/);
  assert.match(errorsFor(["SECTION: MATH", mathModule("MODULE 1", 2), mathModule("MODULE 1", 2)].join("\n")), /Module 1 appears more than once/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", mcq(1), mcq(3), "END MODULE"].join("\n")), /must be consecutive/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", mcq(2), "END MODULE"].join("\n")), /must start at 1/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", mcq(1).replace("END QUESTION", ""), mcq(2), "END MODULE"].join("\n")), /question 1 \(near line \d+\): END QUESTION is missing/);
  assert.match(errorsFor(["SECTION: MATH", mcq(1)].join("\n")), /is outside a module/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", mcq(1).replace("DIFFICULTY: MEDIUM", "DIFFICULTY: MEDIUM\nSECTION: MATH"), "END MODULE"].join("\n")), /SECTION goes once at the top/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", mcq(1).replace("SKILL: Linear equations in one variable\nDIFFICULTY: MEDIUM", "DIFFICULTY: MEDIUM\nSKILL: Linear equations in one variable"), "END MODULE"].join("\n")), /out of order/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", gridIn(1).replace("TYPE: GRID_IN", "TYPE: ESSAY"), "END MODULE"].join("\n")), /TYPE must be MULTIPLE_CHOICE or GRID_IN/);
  assert.match(errorsFor(["SECTION: MATH", "MODULE 1", mcq(1).replace("DIFFICULTY: MEDIUM", "DIFFICULTY: TOUGH"), "END MODULE"].join("\n")), /DIFFICULTY must be/);
  assert.match(errorsFor(["SECTION: ENGLISH", mathModule("MODULE 1", 1)].join("\n")), /SECTION must be READING_WRITING or MATH/);
  assert.equal(parseSectionText(mathDocument.replace("CATEGORY: Algebra", "CATEGORY:")).questions.length, 0);
  assert.match(errorsFor(mathDocument.replace(/SKILL: Linear equations in one variable\n/, "")), /SKILL is required/);
});

// ---------- question rules (shared by the PDF import, the review screen and publishing) ----------

const topics: CatalogTopic[] = [
  { topic: "Algebra", skills: ["Linear equations in one variable"] },
  { topic: "Information and Ideas", skills: ["Central Ideas and Details"] },
];
const checkLatex = (latex: string) => {
  try {
    katex.renderToString(latex, { throwOnError: true });
    return null;
  } catch (error) {
    return (error as Error).message;
  }
};
const base: UploadQuestion = {
  module: "m1",
  questionNumber: 1,
  questionType: "mcq",
  difficulty: "medium",
  topic: "Algebra",
  skill: "Linear equations in one variable",
  passage: null,
  prompt: "What is $x$?",
  choices: ["A", "B", "C", "D"].map((key) => ({ key, text: `$${key.charCodeAt(0)}$` })),
  choiceKey: "B",
  acceptedValues: [],
  explanation: "Because.",
};
const problems = (patch: Partial<UploadQuestion>, section: "math" | "reading_writing" = "math") => uploadQuestionProblems({ ...base, ...patch }, section, topics, checkLatex).join("\n");

test("a correct question has no problems", () => {
  assert.equal(problems({}), "");
  assert.equal(problems({ questionType: "spr", choices: [], choiceKey: null, acceptedValues: ["-3/4", "-0.75"] }), "");
  assert.equal(problems({ prompt: "It costs $\\$78$." }), "");
});

test("question rules catch what students would trip over", () => {
  assert.match(problems({ prompt: "It costs $78 to enter." }), /no closing "\$"/);
  assert.match(problems({ prompt: "Find $\\frac{1}{2$." }), /cannot be displayed/);
  assert.match(problems({ topic: "SAT Algebra" }), /not a Math domain/);
  assert.match(problems({ skill: null }), /SKILL is required/);
  assert.match(problems({ skill: "Central Ideas and Details" }), /is not a skill of Algebra/);
  assert.match(problems({ choiceKey: "E" }), /ANSWER must be A, B, C or D/);
  assert.match(problems({ choices: base.choices.slice(0, 3) }), /choices A, B, C and D are all required/);
  assert.match(problems({ questionType: "spr", choices: [], choiceKey: null, acceptedValues: ["x = 5"] }), /cannot be typed/);
  assert.match(problems({ questionType: "spr", choices: [], choiceKey: null, acceptedValues: ["123456"] }), /longer than the answer box/);
  assert.match(problems({ questionType: "spr", choices: [], choiceKey: null, acceptedValues: [] }), /ANSWER is required/);
  assert.match(problems({ questionType: "spr", choices: [], choiceKey: null, acceptedValues: ["5"], topic: "Information and Ideas", skill: "Central Ideas and Details" }, "reading_writing"), /GRID_IN is only allowed in Math/);
  assert.match(problems({ explanation: " " }), /EXPLANATION is required/);
  // Reading & Writing does not use LaTeX, so a dollar amount there is fine.
  assert.equal(problems({ topic: "Information and Ideas", skill: "Central Ideas and Details", prompt: "It costs $78." }, "reading_writing"), "");
});

test("grid-in answers split on 'or', semicolons and comma-space, but not inside a number", () => {
  assert.deepEqual(splitAcceptedValues("0.5 or 1/2"), ["0.5", "1/2"]);
  assert.deepEqual(splitAcceptedValues("3.5, 7/2; 3.50"), ["3.5", "7/2", "3.50"]);
  assert.deepEqual(splitAcceptedValues("1,000"), ["1,000"]);
});

test("latexSegments treats \\$ as a literal dollar sign", () => {
  assert.deepEqual(latexSegments("from $\\$78$ to $\\$81$ and $$x^2$$").segments, ["\\$78", "\\$81", "x^2"]);
  assert.equal(latexSegments("costs $5").balanced, false);
});

// ---------- plain-text Math (the other SAT Sharks site's PDFs) ----------

test("a Math file with no LaTeX and only dollar amounts is read as plain text", () => {
  assert.equal(isPlainMath("A fee of $90 plus $24. If x^2 = 9, what is x?"), true);
  assert.equal(isPlainMath("What is x^2 - 3x + 2 = 0?"), true);
  assert.equal(isPlainMath("If $3x + 7 = 22$, what is $x$?"), false);
  assert.equal(isPlainMath(String.raw`It costs $\$78$.`), false);
  assert.equal(isPlainMath(String.raw`What is \frac{1}{2}?`), false);
});

test("plain-text Math keeps dollar signs and turns simple powers into superscripts", () => {
  assert.equal(plainMathToSite("A fee of $90 plus $24 per month"), String.raw`A fee of \$90 plus \$24 per month`);
  assert.equal(plainMathToSite("f(x) = 3x^2 - 3x + 6"), "f(x) = 3x² - 3x + 6");
  assert.equal(plainMathToSite("If (x^4)^3 * x^7 = x^n"), "If (x⁴)³ · x⁷ = xⁿ");
  assert.equal(plainMathToSite("300(2)^t and πr^2h and x^(n+1) and x^-2"), "300(2)ᵗ and πr²h and x⁽ⁿ⁺¹⁾ and x⁻²");
  // No superscript for "q": left as written rather than half-converted.
  assert.equal(plainMathToSite("x^q"), "x^q");
});

test("a plain-text Math file parses with the conversion applied and passes the question rules", () => {
  const doc = mathDocument.replaceAll("$", "").replace("If 3x + 7 = 22,", "A fee of $90. If 3x^2 + 7 = 22,").replace(/\\frac\{1\}\{2\}/g, "1/2");
  const result = parseSectionText(doc);
  assert.deepEqual(result.errors, []);
  assert.equal(result.plainMath, true);
  assert.equal(result.questions[0]!.prompt, String.raw`A fee of \$90. If 3x² + 7 = 22, what is the value of x?`);
  assert.equal(problems({ prompt: result.questions[0]!.prompt, choices: result.questions[0]!.choices }), "");
});
