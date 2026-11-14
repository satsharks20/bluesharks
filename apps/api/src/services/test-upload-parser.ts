// Reads the text of one section PDF of an uploaded practice test (see docs/full-test-upload.md).
//
// Strict on purpose: a test is published as a unit, so one misread answer key or a missing module
// would ship a broken exam. Any error rejects the whole file, with messages that name the module,
// the question and the line of the extracted text.
//
// PDF text extraction breaks a line at every visual wrap and adds page markers ("-- 1 of 3 --").
// Wrapped lines are joined back into paragraphs in both sections: a new paragraph starts only at a
// blank line, a list item ("•", "-", "*", "1.") or a "$$…$$" display formula. Math keeps its
// formulas intact this way: a "$…$" that wrapped onto two lines is joined again, where keeping the
// raw line breaks would split it and leave it unrenderable.
//
// Math may be written two ways. LaTeX between dollar signs, like the question bank ($x^2$, $\$78$);
// or plain text, as the other SAT Sharks site's PDFs are (x^2, $90, 3/14). A file with no LaTeX
// commands in which every "$" is a dollar amount ("$" followed by a digit) is read as plain text and
// converted (see plainMathToSite): dollar signs stay dollar signs and simple powers become
// superscripts (x^2 → x²).
import { MOCK_MODULES, MOCK_MODULE_LABELS, splitAcceptedValues, type Difficulty, type MockModule, type Section } from "@satsharks/types";

export interface ParsedQuestion {
  module: MockModule;
  questionNumber: number;
  // Near this line of the extracted text, for error messages.
  line: number;
  questionType: "mcq" | "spr";
  // As written; matched against the bank's canonical domain and skill names by the caller.
  category: string;
  skill: string;
  difficulty: Difficulty;
  passage: string | null;
  prompt: string;
  choices: { key: string; text: string }[];
  choiceKey: string | null;
  acceptedValues: string[];
  explanation: string;
}

export interface SectionParseResult {
  section: Section | null;
  questions: ParsedQuestion[];
  errors: string[];
  // Math written as plain text rather than LaTeX (converted on the way in).
  plainMath: boolean;
}

// ---------- plain-text Math ----------

// A Math file is plain text when it uses no LaTeX command and every "$" is a dollar amount.
export function isPlainMath(text: string): boolean {
  if (/\\[a-zA-Z$%{]/.test(text)) return false;
  return [...text.matchAll(/\$/g)].every((match) => /\d/.test(text[match.index + 1] ?? ""));
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "(": "⁽", ")": "⁾", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ",
  i: "ⁱ", j: "ʲ", k: "ᵏ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};

// Plain-text Math in the site's own notation: "$90" is a dollar amount (written \$ so it is not
// read as a formula), "x^2" / "(2)^t" / "x^(n+1)" become superscripts when every character has
// one, and a spaced " * " is a multiplication dot.
export function plainMathToSite(text: string): string {
  return text
    .replace(/\$/g, "\\$")
    .replace(/\^(-?\d+|[a-z]|\([0-9a-z+\-]+\))/g, (match, exponent: string) => {
      const raised = [...exponent].map((char) => SUPERSCRIPT[char]);
      return raised.every(Boolean) ? raised.join("") : match;
    })
    .replace(/ \* /g, " · ");
}

const FIELD_ORDER = ["CATEGORY", "SKILL", "DIFFICULTY", "TYPE", "PASSAGE", "PROMPT", "A", "B", "C", "D", "ANSWER", "EXPLANATION"] as const;
type Field = (typeof FIELD_ORDER)[number];
const CHOICE_KEYS = ["A", "B", "C", "D"] as const;

const FIELD = /^(SECTION|CATEGORY|SKILL|DIFFICULTY|TYPE|PASSAGE|PROMPT|A|B|C|D|ANSWER|EXPLANATION)\s*:\s*(.*)$/i;
const SECTION_LINE = /^SECTION\s*:\s*(.*)$/i;
const MODULE_START = /^MODULE\s+(1|2\s+EASY|2\s+EASIER|2\s+HARD|2\s+HARDER)\s*$/i;
const MODULE_END = /^END\s+MODULE\s*$/i;
const QUESTION_START = /^QUESTION\s+(\d{1,4})\s*$/i;
const QUESTION_END = /^END\s+QUESTION\s*$/i;
const PAGE_MARKER = /^--\s*\d+\s+of\s+\d+\s*--$/i;
const LIST_ITEM = /^([•◦▪●\-*]|\d+[.)])\s+/;
const TEXT_HEADING = /^Text\s+\d$/i;
const SECTION_VALUES: Record<string, Section> = { READING_WRITING: "reading_writing", MATH: "math" };

// "2 EASIER" must be the easier module; a plain includes("EASY") check got this wrong elsewhere.
function moduleFromHeader(value: string): MockModule {
  const normalized = value.toUpperCase().replace(/\s+/g, " ");
  if (normalized === "1") return "m1";
  return normalized.startsWith("2 EAS") ? "m2_easy" : "m2_hard";
}

function questionType(value: string): "mcq" | "spr" | null {
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!normalized || normalized === "MULTIPLE_CHOICE" || normalized === "MCQ") return "mcq";
  if (normalized === "GRID_IN" || normalized === "SPR") return "spr";
  return null;
}

const dollarPairs = (line: string) => (line.replace(/\\\$/g, "").match(/\$\$/g) ?? []).length;

// Joins wrapped lines back into paragraphs (see the file comment).
export function reflow(lines: string[]): string {
  const paragraphs: string[] = [];
  let current = "";
  // Inside an unfinished "$$…$$": nothing breaks the paragraph until it closes.
  let inDisplay = false;
  const close = () => {
    if (current) paragraphs.push(current);
    current = "";
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (!inDisplay) close();
      continue;
    }
    if (!inDisplay && (LIST_ITEM.test(line) || line.startsWith("$$"))) close();
    // "Text 1" / "Text 2" over paired passages is a heading line of its own.
    if (!inDisplay && TEXT_HEADING.test(line)) {
      close();
      paragraphs.push(line);
      continue;
    }
    current = current ? `${current} ${line}` : line;
    if (dollarPairs(line) % 2 === 1) inDisplay = !inDisplay;
    // A display formula is a paragraph of its own: text after it starts a new one.
    if (!inDisplay && current.startsWith("$$") && line.endsWith("$$")) close();
  }
  close();
  return paragraphs.join("\n");
}

const singleLine = (lines: string[]) => lines.map((line) => line.trim()).filter(Boolean).join(" ");
const stripEmoji = (text: string) => text.replace(/\p{Extended_Pictographic}️?/gu, "");

interface Block {
  module: MockModule;
  number: number;
  line: number;
  lines: string[];
  ended: boolean;
}

export function parseSectionText(text: string): SectionParseResult {
  // Invisible format characters (zero-width spaces, BOM, soft hyphens) left by PDF extraction
  // would otherwise break label matching.
  const lines = text.replace(/\r/g, "").replace(/ /g, " ").replace(/\p{Cf}/gu, "").split("\n");
  const errors: string[] = [];
  let section: Section | null = null;
  let sectionDeclared = false;
  const seen = new Set<MockModule>();
  let currentModule: MockModule | null = null;
  let block: Block | null = null;
  const blocks: Block[] = [];
  const label = (module: MockModule) => MOCK_MODULE_LABELS[module];

  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (PAGE_MARKER.test(line)) return;
    const moduleStart = MODULE_START.exec(line);
    const moduleEnd = MODULE_END.test(line);
    const questionStart = QUESTION_START.exec(line);

    // A new block or module boundary while a question is open: its END QUESTION is missing. The
    // block is kept so the rest of it is still checked.
    if (block && (moduleStart || moduleEnd || questionStart)) {
      blocks.push(block);
      block = null;
    }
    if (moduleStart) {
      if (currentModule) errors.push(`${label(currentModule)}: END MODULE is missing before line ${lineNumber}.`);
      const module = moduleFromHeader(moduleStart[1]!);
      if (seen.has(module)) errors.push(`${label(module)} appears more than once (line ${lineNumber}).`);
      seen.add(module);
      currentModule = module;
      return;
    }
    if (moduleEnd) {
      if (!currentModule) errors.push(`Line ${lineNumber}: END MODULE without a MODULE line before it.`);
      currentModule = null;
      return;
    }
    if (questionStart) {
      if (!currentModule) {
        errors.push(`Line ${lineNumber}: QUESTION ${questionStart[1]} is outside a module. Put it between a MODULE line and END MODULE.`);
        return;
      }
      block = { module: currentModule, number: Number(questionStart[1]), line: lineNumber, lines: [], ended: false };
      return;
    }
    if (QUESTION_END.test(line)) {
      if (block) {
        block.ended = true;
        blocks.push(block);
        block = null;
      }
      return;
    }
    if (block) {
      block.lines.push(raw);
      return;
    }
    // Outside a question only the SECTION line means anything; titles and notes are ignored.
    const sectionLine = SECTION_LINE.exec(line);
    if (!sectionLine) return;
    if (sectionDeclared) {
      errors.push(`Line ${lineNumber}: SECTION appears more than once. Declare it once at the top.`);
      return;
    }
    if (seen.size > 0) errors.push(`Line ${lineNumber}: SECTION must come before MODULE 1.`);
    sectionDeclared = true;
    section = SECTION_VALUES[sectionLine[1]!.trim().toUpperCase()] ?? null;
    if (!section) errors.push(`Line ${lineNumber}: SECTION must be READING_WRITING or MATH.`);
  });
  if (block) blocks.push(block);
  if (currentModule) errors.push(`${label(currentModule)}: END MODULE is missing.`);
  if (!sectionDeclared) errors.push("SECTION: READING_WRITING or SECTION: MATH is missing at the top of the file.");
  for (const module of MOCK_MODULES) {
    if (!seen.has(module)) errors.push(`${label(module)} is missing. Every section needs MODULE 1, MODULE 2 EASY and MODULE 2 HARD.`);
  }

  const isMath = (section ?? "math") === "math";
  const plainMath = isMath && isPlainMath(text);
  const math = (value: string) => (plainMath ? plainMathToSite(value) : value);
  const questions: ParsedQuestion[] = [];

  for (const module of MOCK_MODULES) {
    const moduleBlocks = blocks.filter((entry) => entry.module === module);
    if (seen.has(module) && moduleBlocks.length === 0) errors.push(`${label(module)} has no questions.`);

    moduleBlocks.forEach((entry, position) => {
      const prefix = `${label(module)} question ${entry.number} (near line ${entry.line})`;
      const problems: string[] = [];
      if (!entry.ended) problems.push("END QUESTION is missing");
      if (position === 0 && entry.number !== 1) problems.push("numbering must start at 1 in every module");
      else if (position > 0 && entry.number !== moduleBlocks[position - 1]!.number + 1) problems.push("question numbers must be consecutive");

      const values = new Map<Field, string[]>();
      const order: Field[] = [];
      let active: Field | null = null;
      for (const raw of entry.lines) {
        const match = FIELD.exec(raw.trim());
        if (!match) {
          if (active) values.get(active)!.push(raw);
          else if (raw.trim()) problems.push(`text before the first field: "${raw.trim().slice(0, 40)}"`);
          continue;
        }
        const field = match[1]!.toUpperCase();
        if (field === "SECTION") {
          problems.push("SECTION goes once at the top of the file, not inside a question");
          active = null;
          continue;
        }
        active = field as Field;
        if (values.has(active)) problems.push(`${active} appears more than once`);
        else {
          values.set(active, [match[2]!]);
          order.push(active);
        }
      }
      const expected = FIELD_ORDER.filter((field) => order.includes(field));
      if (order.some((field, index) => field !== expected[index])) problems.push("fields are out of order; follow the template order exactly");

      const raw = (field: Field) => values.get(field) ?? [];
      const type = questionType(singleLine(raw("TYPE")));
      if (!type) problems.push("TYPE must be MULTIPLE_CHOICE or GRID_IN");
      const resolved = type ?? "mcq";
      const passage = reflow(raw("PASSAGE"));
      const prompt = reflow(raw("PROMPT"));
      const answer = singleLine(raw("ANSWER"));
      const difficulty = singleLine(raw("DIFFICULTY")).toLowerCase();
      const hasChoices = CHOICE_KEYS.some((key) => values.has(key));

      if (!values.has("CATEGORY") || !singleLine(raw("CATEGORY"))) problems.push("CATEGORY is required");
      if (!values.has("SKILL") || !singleLine(raw("SKILL"))) problems.push("SKILL is required");
      if (!["easy", "medium", "hard"].includes(difficulty)) problems.push("DIFFICULTY must be EASY, MEDIUM or HARD");

      if (problems.length > 0) {
        errors.push(...[...new Set(problems)].map((problem) => `${prefix}: ${problem}.`));
        return;
      }
      questions.push({
        module,
        questionNumber: entry.number,
        line: entry.line,
        questionType: resolved,
        category: singleLine(raw("CATEGORY")),
        skill: singleLine(raw("SKILL")),
        difficulty: difficulty as Difficulty,
        // Math shows no separate passage, so a Math PASSAGE opens the question text instead.
        passage: isMath ? null : passage || null,
        prompt: math(isMath && passage ? `${passage}\n${prompt}` : prompt),
        choices: resolved === "spr" && !hasChoices ? [] : CHOICE_KEYS.map((key) => ({ key, text: math(reflow(raw(key)).replace(/\n/g, " ")) })),
        choiceKey: resolved === "mcq" ? answer.toUpperCase() : null,
        acceptedValues: resolved === "spr" ? splitAcceptedValues(answer) : [],
        explanation: math(stripEmoji(reflow(raw("EXPLANATION")))),
      });
    });
  }

  return { section, questions: errors.length === 0 ? questions : [], errors, plainMath };
}
