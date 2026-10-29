// Uploaded practice tests: one fixed adaptive Digital SAT test from two PDFs.
//
// Flow: upload (each PDF is read and checked during the request) → review each section → publish
// (creates one paper per section, hidden) → activate (students can sit it). Students take it
// through the ordinary full-test flow; practice.service uses the test's fixed modules instead of
// drawing questions from the bank, and routes Module 2 with the same rule as every other mock.
//
// Each upload is a practice test or an exam (`kind`, chosen at upload and changeable later). A
// practice test's questions are tagged "full-test" so drills, random mocks and the practice catalog
// never use them (see the tag filters in practice.service). An exam is a real administration: its
// papers carry exam metadata and their own source, so the catalog shows them as one exam card and
// its questions join drills and random mocks; students can also take it as a fixed full test.
import katex from "katex";
import mongoose from "mongoose";
import { contentKeyOf, PaperModel, QuestionModel, TestUploadModel, trusted, type TestUploadDoc, type TestUploadSectionDoc } from "@satsharks/db";
import {
  EXAM_UPLOAD_SOURCE,
  FULL_TEST_QUESTION_TAG,
  fullTestQuestionTag,
  looseMathWarning,
  MOCK_FORMAT,
  MOCK_MODULE_LABELS,
  MOCK_MODULES,
  SECTION_LABELS,
  SECTIONS,
  TEST_UPLOAD_SOURCE,
  UPLOADED_EXAM_QUESTION_TAG,
  uploadAccessKey,
  uploadQuestionProblems,
  type AccessItem,
  type CatalogTopic,
  type MockModule,
  type PracticeTestListing,
  type Section,
  type TestUploadKind,
  type TestUploadSection,
  type TestUploadSummary,
  type UploadQuestion,
} from "@satsharks/types";
import type { SaveUploadSectionInput, TestUploadMetaInput } from "@satsharks/validation";
import { AppError } from "../utils/app-error";
import { readPdfText } from "./pdf-text";
import { parseSectionText, type ParsedQuestion } from "./test-upload-parser";

const SECTION_FIELD = { reading_writing: "readingWriting", math: "math" } as const;
const SECTION_FILE_LABEL: Record<Section, string> = { reading_writing: "English (Reading & Writing)", math: "Math" };
const MAX_LISTED_ERRORS = 20;
// Exams are numbered from here within their year, out of the way of practice-test numbers.
const FIRST_EXAM_NUMBER = 1001;

export interface UploadedFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

// ---------- the bank's vocabulary ----------

interface Vocabulary {
  topics: CatalogTopic[];
  // Lower-cased domain or skill name → the domain and (for a skill) the skill.
  lookup: Map<string, { topic: string; skill: string | null }>;
}

// Domains and skills of the question bank, so an uploaded test uses the same names and its results
// break down like every other test. A skill filed under two domains goes to the one with more
// questions.
async function vocabulary(section: Section): Promise<Vocabulary> {
  const rows = await QuestionModel.aggregate<{ _id: { topic: string; skill: string | null }; n: number }>([
    { $match: { section, topic: { $ne: null }, tags: { $ne: FULL_TEST_QUESTION_TAG } } },
    { $group: { _id: { topic: "$topic", skill: "$skill" }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const topics: CatalogTopic[] = [];
  const lookup: Vocabulary["lookup"] = new Map();
  for (const { _id } of rows) {
    let topic = topics.find((entry) => entry.topic === _id.topic);
    if (!topic) topics.push((topic = { topic: _id.topic, skills: [] }));
    lookup.set(_id.topic.toLowerCase(), { topic: _id.topic, skill: null });
    if (_id.skill && !topic.skills.includes(_id.skill)) {
      topic.skills.push(_id.skill);
      if (!lookup.has(_id.skill.toLowerCase())) lookup.set(_id.skill.toLowerCase(), { topic: _id.topic, skill: _id.skill });
    }
  }
  topics.sort((a, b) => a.topic.localeCompare(b.topic));
  for (const topic of topics) topic.skills.sort((a, b) => a.localeCompare(b));
  return { topics, lookup };
}

// KaTeX's complaint about a formula it cannot render, or null.
function checkLatex(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: "ignore" });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, "") : "invalid formula";
  }
}

const questionLabel = (question: Pick<UploadQuestion, "module" | "questionNumber">) => `${MOCK_MODULE_LABELS[question.module]} question ${question.questionNumber}`;

function problemsOf(questions: UploadQuestion[], section: Section, vocab: Vocabulary): string[] {
  const errors: string[] = [];
  for (const module of MOCK_MODULES) {
    if (!questions.some((question) => question.module === module)) errors.push(`${MOCK_MODULE_LABELS[module]} has no questions.`);
  }
  for (const question of questions) {
    for (const problem of uploadQuestionProblems(question, section, vocab.topics, checkLatex)) errors.push(`${questionLabel(question)}: ${problem}.`);
  }
  return errors;
}

function warningsOf(questions: UploadQuestion[], section: Section): string[] {
  const expected = MOCK_FORMAT[section].questionsPerModule;
  const warnings = MOCK_MODULES.flatMap((module) => {
    const count = questions.filter((question) => question.module === module).length;
    return count > 0 && count !== expected
      ? [`${MOCK_MODULE_LABELS[module]} has ${count} questions; an official module has ${expected}. Scaled scores need official-size modules.`]
      : [];
  });
  if (section === "math") {
    for (const question of questions) {
      const texts = [question.prompt, question.explanation, ...question.choices.map((choice) => choice.text)];
      if (texts.some(looseMathWarning)) warnings.push(`${questionLabel(question)}: some math is outside $…$ and will show as plain text.`);
    }
  }
  return warnings;
}

function formatErrors(heading: string, errors: string[]): string {
  const listed = errors.slice(0, MAX_LISTED_ERRORS).map((error) => `• ${error}`);
  if (errors.length > MAX_LISTED_ERRORS) listed.push(`• …and ${errors.length - MAX_LISTED_ERRORS} more.`);
  return [heading, ...listed].join("\n");
}

// The other SAT Sharks site's category names (and close variants) → this bank's domain, after
// dropping a leading "SAT " and reading "&" as "and".
const CATEGORY_ALIASES: Record<string, string> = {
  algebra: "Algebra",
  "advanced math": "Advanced Math",
  "data and statistics": "Problem-Solving and Data Analysis",
  "data analysis": "Problem-Solving and Data Analysis",
  statistics: "Problem-Solving and Data Analysis",
  "problem solving and data analysis": "Problem-Solving and Data Analysis",
  geometry: "Geometry and Trigonometry",
  trigonometry: "Geometry and Trigonometry",
  "reading comprehension": "Information and Ideas",
  reading: "Information and Ideas",
  vocabulary: "Craft and Structure",
  "grammar and writing": "Standard English Conventions",
  grammar: "Standard English Conventions",
  writing: "Expression of Ideas",
};

// Reading & Writing questions use fixed wording, which names the skill. Used when the category is
// one of the broad names above, so "SAT Grammar & Writing" lands on Transitions, Boundaries, etc.
const RW_SKILL_BY_WORDING: [RegExp, string, string][] = [
  [/most logical and precise word or phrase/i, "Craft and Structure", "Words in Context"],
  [/most logical transition/i, "Expression of Ideas", "Transitions"],
  [/relevant information from the notes/i, "Expression of Ideas", "Rhetorical Synthesis"],
  [/conventions of Standard English/i, "Standard English Conventions", "Form, Structure, and Sense"],
  [/Text 2|both texts/i, "Craft and Structure", "Cross-Text Connections"],
  [/main purpose|overall structure|function of|how the second sentence|how the (?:first|last) sentence/i, "Craft and Structure", "Text Structure and Purpose"],
  [/main idea|According to the text|best describes/i, "Information and Ideas", "Central Ideas and Details"],
  [/support|illustrate|quotation|data/i, "Information and Ideas", "Command of Evidence"],
  [/conclusion|Based on the text|most logically completes/i, "Information and Ideas", "Inferences"],
];

// Choices that differ only in punctuation test sentence boundaries, not form.
const onlyPunctuationDiffers = (choices: { text: string }[]) =>
  choices.length > 1 && new Set(choices.map((choice) => choice.text.replace(/[\s.,;:—–-]+/g, "").toLowerCase())).size === 1;

// CATEGORY → this bank's domain and skill: an exact domain or skill name, or one of the aliases.
function resolveCategory(parsed: ParsedQuestion, section: Section, vocab: Vocabulary): { topic: string; skill: string | null } | null {
  const exact = vocab.lookup.get(parsed.category.trim().toLowerCase());
  if (exact) return exact;
  const key = parsed.category.trim().toLowerCase().replace(/^sat\s+/, "").replace(/&/g, "and").replace(/\s+/g, " ");
  const domain = CATEGORY_ALIASES[key];
  if (!domain || !vocab.topics.some((entry) => entry.topic === domain)) return null;
  if (section === "reading_writing") {
    const rule = RW_SKILL_BY_WORDING.find(([pattern]) => pattern.test(parsed.prompt));
    if (rule) {
      const [, topic, found] = rule;
      const skill = topic === "Standard English Conventions" && onlyPunctuationDiffers(parsed.choices) ? "Boundaries" : found;
      if (vocab.topics.find((entry) => entry.topic === topic)?.skills.includes(skill)) return { topic, skill };
    }
  }
  return { topic: domain, skill: null };
}

function toUploadQuestion(parsed: ParsedQuestion, section: Section, vocab: Vocabulary): UploadQuestion {
  const match = resolveCategory(parsed, section, vocab);
  return {
    module: parsed.module,
    questionNumber: parsed.questionNumber,
    questionType: parsed.questionType,
    difficulty: parsed.difficulty,
    // An unknown category is kept as written, so the error names it.
    topic: match?.topic ?? parsed.category,
    skill: match?.skill ?? null,
    passage: parsed.passage,
    prompt: parsed.prompt,
    choices: parsed.choices,
    choiceKey: parsed.choiceKey,
    acceptedValues: parsed.acceptedValues,
    explanation: parsed.explanation,
  };
}

// Reads one section PDF into a stored section. Never throws for a bad PDF: the section is stored
// as failed, with the reasons, so the admin can see them and re-upload just that file.
async function extractSection(file: UploadedFile, expected: Section): Promise<TestUploadSectionDoc> {
  const base = { fileName: file.originalname.slice(0, 200), fileSize: file.size, uploadedAt: new Date(), reviewedAt: null, reviewedBy: null };
  const failed = (errorMessage: string): TestUploadSectionDoc => ({ ...base, status: "failed", errorMessage, warnings: [], questions: [] });

  let text: string;
  try {
    text = await readPdfText(file.buffer);
  } catch {
    return failed("This PDF could not be read. Export it again as a text PDF (not a scan or a photo).");
  }
  if (!/QUESTION\s+\d/i.test(text)) {
    return failed("No question text was found in this PDF. It may be a scan or an image; export it from the document as a text PDF.");
  }

  const parsed = parseSectionText(text);
  const errors = [...parsed.errors];
  if (parsed.section && parsed.section !== expected) {
    errors.unshift(`This file says SECTION: ${parsed.section.toUpperCase()}, but it was uploaded as the ${SECTION_FILE_LABEL[expected]} file.`);
  }
  let questions: UploadQuestion[] = [];
  if (errors.length === 0) {
    const vocab = await vocabulary(expected);
    questions = parsed.questions.map((question) => toUploadQuestion(question, expected, vocab));
    errors.push(...groupCategoryErrors(problemsOf(questions, expected, vocab), vocab));
  }
  if (errors.length > 0) return failed(formatErrors(`The ${SECTION_FILE_LABEL[expected]} PDF does not match the required format:`, errors));
  const warnings = warningsOf(questions, expected);
  if (parsed.plainMath) {
    warnings.unshift("Math was written as plain text (e.g. x^2, $90), not LaTeX. It was converted: powers became superscripts (x²) and $ stays a dollar sign. Check fractions and roots in the review and use the equation editor where needed.");
  }
  return { ...base, status: "extracted", errorMessage: "", warnings, questions };
}

// One line per unknown category instead of one per question, with the names that do work.
function groupCategoryErrors(errors: string[], vocab: Vocabulary): string[] {
  const unknown = new Map<string, number>();
  const rest = errors.filter((error) => {
    const match = /question \d+: "(.+)" is not a .+ domain in the question bank\.$/.exec(error);
    if (!match) return true;
    unknown.set(match[1]!, (unknown.get(match[1]!) ?? 0) + 1);
    return false;
  });
  const names = vocab.topics.map((entry) => entry.topic).join(", ");
  return [...[...unknown].map(([name, count]) => `CATEGORY "${name}" (${count} question${count === 1 ? "" : "s"}) is not a domain or skill of the question bank. Use one of: ${names}, or a skill name.`), ...rest];
}

// ---------- views ----------

function toSection(section: TestUploadSectionDoc | null, withQuestions: boolean): TestUploadSection | null {
  if (!section) return null;
  const moduleCounts = Object.fromEntries(MOCK_MODULES.map((module) => [module, section.questions.filter((q) => q.module === module).length])) as Record<MockModule, number>;
  return {
    fileName: section.fileName,
    fileSize: section.fileSize,
    status: section.status,
    errorMessage: section.errorMessage,
    warnings: section.warnings,
    uploadedAt: section.uploadedAt.toISOString(),
    reviewedAt: section.reviewedAt ? section.reviewedAt.toISOString() : null,
    moduleCounts,
    questionCount: section.questions.length,
    ...(withQuestions ? { questions: section.questions } : {}),
  };
}

function toSummary(upload: TestUploadDoc, withQuestions = false, uploaderName: string | null = null): TestUploadSummary {
  const paperIds: TestUploadSummary["paperIds"] = {};
  for (const section of SECTIONS) if (upload.paperIds?.[section]) paperIds[section] = String(upload.paperIds[section]);
  return {
    id: String(upload._id),
    kind: kindOf(upload),
    title: upload.title,
    year: upload.year,
    testNumber: upload.testNumber,
    examDate: upload.examDate ?? null,
    status: upload.status,
    active: upload.active,
    activateAt: upload.activateAt ? upload.activateAt.toISOString() : null,
    readingWriting: toSection(upload.readingWriting, withQuestions),
    math: toSection(upload.math, withQuestions),
    paperIds,
    publishedAt: upload.publishedAt ? upload.publishedAt.toISOString() : null,
    uploadedBy: uploaderName,
    createdAt: upload.createdAt.toISOString(),
  };
}

async function loadUpload(id: string): Promise<TestUploadDoc> {
  const upload = await TestUploadModel.findById(id).lean<TestUploadDoc>();
  if (!upload) throw AppError.notFound("Test not found");
  return upload;
}

function assertDraft(upload: TestUploadDoc): void {
  if (upload.status === "published") throw AppError.conflict("This test is already published. Edit its questions in the question bank.");
}

async function assertFree(year: number, testNumber: number, exceptId?: mongoose.Types.ObjectId): Promise<void> {
  const filter: Record<string, unknown> = { year, testNumber };
  if (exceptId) filter._id = trusted({ $ne: exceptId });
  const taken = await TestUploadModel.findOne(filter).select("title").lean<Pick<TestUploadDoc, "title">>();
  if (taken) throw AppError.conflict(`Test ${testNumber} of ${year} is already used by "${taken.title}". Choose a different test number.`);
}

const kindOf = (upload: Pick<TestUploadDoc, "kind">): TestUploadKind => upload.kind ?? "practice";

interface UploadMeta {
  kind: TestUploadKind;
  title: string;
  year: number;
  testNumber: number;
  examDate: string | null;
}

// The stored details for the form's input. An exam's year is its date's; it keeps its number while
// the year stays the same, otherwise it takes the next free exam number of that year.
async function resolveMeta(input: TestUploadMetaInput, current?: TestUploadDoc): Promise<UploadMeta> {
  if (input.kind === "exam") {
    const examDate = input.examDate!;
    const year = Number(examDate.slice(0, 4));
    let testNumber = current?.testNumber;
    if (!current || current.year !== year) {
      const last = await TestUploadModel.findOne({ year }).sort({ testNumber: -1 }).select("testNumber").lean<Pick<TestUploadDoc, "testNumber">>();
      testNumber = Math.max(FIRST_EXAM_NUMBER - 1, last?.testNumber ?? 0) + 1;
    }
    return { kind: "exam", title: input.title, year, testNumber: testNumber!, examDate };
  }
  await assertFree(input.year!, input.testNumber!, current?._id);
  return { kind: "practice", title: input.title, year: input.year!, testNumber: input.testNumber!, examDate: null };
}

// Where an upload's papers and questions show up. A practice test's are kept out of the catalog,
// drills and random mocks; an exam's papers are grouped into one exam card by the catalog.
function placement(upload: TestUploadDoc) {
  const id = String(upload._id);
  if (kindOf(upload) === "exam") {
    return {
      source: EXAM_UPLOAD_SOURCE,
      tags: [UPLOADED_EXAM_QUESTION_TAG, fullTestQuestionTag(id)],
      sourceMetadata: { examId: `upload:${id}`, examName: upload.title, examDate: upload.examDate ?? null },
      description: `Uploaded exam (${upload.examDate}).`,
    };
  }
  return {
    source: TEST_UPLOAD_SOURCE,
    tags: [FULL_TEST_QUESTION_TAG, fullTestQuestionTag(id)],
    sourceMetadata: {},
    description: `Uploaded practice test ${upload.testNumber} (${upload.year}).`,
  };
}

const paperTitle = (upload: TestUploadDoc, section: Section) => `${upload.title} — ${SECTION_LABELS[section]}`;

// After a published test's details change: paper titles, and where its papers and questions show up.
async function placePapers(upload: TestUploadDoc): Promise<void> {
  const { source, tags, sourceMetadata, description } = placement(upload);
  const paperIds = SECTIONS.map((section) => upload.paperIds[section]).filter((id): id is mongoose.Types.ObjectId => id !== null);
  for (const section of SECTIONS) {
    if (upload.paperIds[section]) {
      await PaperModel.updateOne({ _id: upload.paperIds[section] }, { $set: { title: paperTitle(upload, section), source, sourceMetadata, description } });
    }
  }
  await QuestionModel.updateMany({ paperId: trusted({ $in: paperIds }) }, { $set: { source, tags } });
}

// Numbers questions 1..n inside each module, in the order they were sent, and drops fields that do
// not belong to the question type.
function normalizeReviewed(input: SaveUploadSectionInput["questions"]): UploadQuestion[] {
  const counters = new Map<MockModule, number>();
  return input.map((question) => {
    const number = (counters.get(question.module) ?? 0) + 1;
    counters.set(question.module, number);
    const mcq = question.questionType === "mcq";
    return {
      module: question.module,
      questionNumber: number,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      skill: question.skill || null,
      passage: question.passage?.trim() ? question.passage.trim() : null,
      prompt: question.prompt.trim(),
      choices: mcq ? ["A", "B", "C", "D"].map((key, index) => ({ key, text: (question.choices[index]?.text ?? "").trim() })) : [],
      choiceKey: mcq ? (question.choiceKey ?? "").toUpperCase() || null : null,
      acceptedValues: mcq ? [] : question.acceptedValues.filter(Boolean),
      explanation: question.explanation.trim(),
    };
  });
}

// ---------- publishing ----------

const moduleNumberOf = (module: MockModule) => (module === "m1" ? 1 : 2);

async function publish(upload: TestUploadDoc): Promise<TestUploadDoc> {
  const id = String(upload._id);
  const { source, tags, sourceMetadata, description } = placement(upload);
  const paperIds = { reading_writing: new mongoose.Types.ObjectId(), math: new mongoose.Types.ObjectId() };
  const papers = SECTIONS.map((section) => {
    const questions = upload[SECTION_FIELD[section]]!.questions;
    return {
      _id: paperIds[section],
      title: paperTitle(upload, section),
      description,
      source,
      // Unique with the source, so a second publish of the same upload cannot create papers too.
      sourcePaperId: `${id}:${section}`,
      // Hidden until the admin activates the test.
      status: "hidden" as const,
      sections: [section],
      modules: MOCK_MODULES.map((module) => ({
        key: `${section}-${module}`,
        section,
        moduleNumber: moduleNumberOf(module),
        moduleType: module,
        questionCount: questions.filter((question) => question.module === module).length,
        timeLimitSeconds: MOCK_FORMAT[section].minutesPerModule * 60,
      })),
      adaptive: { isAdaptive: true, routing: "server_side" as const, observedRoute: null, module1Correct: null, routingThreshold: null },
      questionCount: questions.length,
      metadata: { testUploadId: id, year: upload.year, testNumber: upload.testNumber },
      sourceMetadata,
    };
  });
  const questionDocs = SECTIONS.flatMap((section) =>
    upload[SECTION_FIELD[section]]!.questions.map((question) => ({
      paperId: paperIds[section],
      source,
      sourceQuestionId: `${question.module}-${question.questionNumber}`,
      section,
      moduleNumber: moduleNumberOf(question.module),
      moduleType: question.module,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      difficulty: question.difficulty,
      topic: question.topic,
      skill: question.skill,
      prompt: question.prompt,
      passage: question.passage,
      choices: question.choices.map((choice) => ({ key: choice.key, text: choice.text, viz: null })),
      correctAnswer: { choiceKey: question.choiceKey, acceptedValues: question.acceptedValues },
      explanation: question.explanation,
      assets: [],
      viz: null,
      sourceMetadata: { testUploadId: id },
      status: "hidden" as const,
      tags,
    })),
  ).map((doc) => ({ ...doc, contentKey: contentKeyOf(doc) }));

  // No transaction (Atlas free tier): papers first, so a concurrent publish fails on their unique
  // key before inserting anything; on any later failure everything this call created is removed.
  try {
    await PaperModel.insertMany(papers);
  } catch (error) {
    if ((error as { code?: unknown }).code === 11000) throw AppError.conflict("This test is already being published.");
    throw error;
  }
  try {
    await QuestionModel.insertMany(questionDocs);
    const published = await TestUploadModel.findOneAndUpdate(
      { _id: upload._id, status: "draft" },
      { $set: { status: "published", active: false, paperIds, publishedAt: new Date() } },
      { new: true },
    ).lean<TestUploadDoc>();
    if (!published) throw AppError.conflict("This test was changed while it was being published. Try again.");
    return published;
  } catch (error) {
    await QuestionModel.deleteMany({ paperId: trusted({ $in: Object.values(paperIds) }) });
    await PaperModel.deleteMany({ _id: trusted({ $in: Object.values(paperIds) }) });
    throw error;
  }
}

// The six modules as published, read from the questions themselves (an admin may have deleted some
// in the question bank since).
async function liveModuleCounts(upload: TestUploadDoc): Promise<Record<Section, Record<MockModule, number>>> {
  const ids = SECTIONS.map((section) => upload.paperIds[section]).filter((id): id is mongoose.Types.ObjectId => id !== null);
  const rows = await QuestionModel.aggregate<{ _id: { paperId: mongoose.Types.ObjectId; module: MockModule }; n: number }>([
    { $match: { paperId: { $in: ids } } },
    { $group: { _id: { paperId: "$paperId", module: "$moduleType" }, n: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(SECTIONS.map((section) => [section, { m1: 0, m2_easy: 0, m2_hard: 0 }])) as Record<Section, Record<MockModule, number>>;
  for (const row of rows) {
    const section = SECTIONS.find((entry) => String(upload.paperIds[entry]) === String(row._id.paperId));
    if (section && row._id.module in counts[section]) counts[section][row._id.module] = row.n;
  }
  return counts;
}

// ---------- service ----------

export const testUploadService = {
  async list(): Promise<TestUploadSummary[]> {
    // Question bodies are not needed for the list; only the module counts are shown.
    const uploads = await TestUploadModel.find()
      .select("-readingWriting.questions.prompt -readingWriting.questions.passage -readingWriting.questions.explanation -readingWriting.questions.choices -math.questions.prompt -math.questions.passage -math.questions.explanation -math.questions.choices")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<TestUploadDoc[]>();
    return uploads.map((upload) => toSummary(upload));
  },

  async get(id: string): Promise<{ upload: TestUploadSummary; topics: Record<Section, CatalogTopic[]> }> {
    const upload = await loadUpload(id);
    const [rw, math] = await Promise.all([vocabulary("reading_writing"), vocabulary("math")]);
    return { upload: toSummary(upload, true), topics: { reading_writing: rw.topics, math: math.topics } };
  },

  async create(input: TestUploadMetaInput, files: Partial<Record<Section, UploadedFile>>, userId: string): Promise<TestUploadSummary> {
    if (!files.reading_writing && !files.math) throw AppError.badRequest("Choose the English PDF, the Math PDF, or both.");
    const meta = await resolveMeta(input);
    const [readingWriting, math] = await Promise.all([
      files.reading_writing ? extractSection(files.reading_writing, "reading_writing") : null,
      files.math ? extractSection(files.math, "math") : null,
    ]);
    try {
      const upload = await TestUploadModel.create({ ...meta, readingWriting, math, uploadedBy: userId });
      return toSummary(upload.toObject());
    } catch (error) {
      // Two uploads with the same year and number at once: the unique index let one through.
      if ((error as { code?: unknown }).code === 11000) throw AppError.conflict(`Test ${meta.testNumber} of ${meta.year} already exists. Choose a different test number.`);
      throw error;
    }
  },

  // Title, number or date, and whether it is a practice test or an exam. On a published test the
  // papers and questions follow at once (students see the paper titles; the kind moves the test
  // between Full-Length Practice Tests and Exams).
  async update(id: string, input: TestUploadMetaInput): Promise<TestUploadSummary> {
    const upload = await loadUpload(id);
    const meta = await resolveMeta(input, upload);
    let saved: TestUploadDoc | null;
    try {
      saved = await TestUploadModel.findByIdAndUpdate(upload._id, { $set: meta }, { new: true }).lean<TestUploadDoc>();
    } catch (error) {
      if ((error as { code?: unknown }).code === 11000) throw AppError.conflict(`Test ${meta.testNumber} of ${meta.year} already exists. Choose a different test number.`);
      throw error;
    }
    if (!saved) throw AppError.notFound("Test not found");
    if (saved.status === "published") await placePapers(saved);
    return toSummary(saved);
  },

  async replaceSection(id: string, section: Section, file: UploadedFile): Promise<TestUploadSummary> {
    const upload = await loadUpload(id);
    assertDraft(upload);
    const extracted = await extractSection(file, section);
    const saved = await TestUploadModel.findOneAndUpdate({ _id: upload._id, status: "draft" }, { $set: { [SECTION_FIELD[section]]: extracted } }, { new: true }).lean<TestUploadDoc>();
    if (!saved) throw AppError.conflict("This test was published meanwhile.");
    return toSummary(saved);
  },

  async saveReview(id: string, section: Section, input: SaveUploadSectionInput, userId: string): Promise<TestUploadSummary> {
    const upload = await loadUpload(id);
    assertDraft(upload);
    const current = upload[SECTION_FIELD[section]];
    if (!current || current.status === "failed") throw AppError.badRequest(`Upload a valid ${SECTION_FILE_LABEL[section]} PDF first.`);

    const vocab = await vocabulary(section);
    const questions = normalizeReviewed(input.questions);
    const errors = problemsOf(questions, section, vocab);
    if (errors.length > 0) throw AppError.badRequest(formatErrors("Fix these questions before saving:", errors));

    const field = SECTION_FIELD[section];
    const saved = await TestUploadModel.findOneAndUpdate(
      { _id: upload._id, status: "draft" },
      {
        $set: {
          [`${field}.status`]: "reviewed",
          [`${field}.errorMessage`]: "",
          [`${field}.warnings`]: warningsOf(questions, section),
          [`${field}.questions`]: questions,
          [`${field}.reviewedAt`]: new Date(),
          [`${field}.reviewedBy`]: new mongoose.Types.ObjectId(userId),
        },
      },
      { new: true },
    ).lean<TestUploadDoc>();
    if (!saved) throw AppError.conflict("This test was published meanwhile.");
    return toSummary(saved, true);
  },

  async publish(id: string): Promise<TestUploadSummary> {
    const upload = await loadUpload(id);
    if (upload.status === "published") throw AppError.conflict("This test has already been published.");
    const notReviewed = SECTIONS.filter((section) => upload[SECTION_FIELD[section]]?.status !== "reviewed");
    if (notReviewed.length > 0) {
      throw AppError.badRequest(`Review and save ${notReviewed.map((section) => SECTION_FILE_LABEL[section]).join(" and ")} before publishing.`);
    }
    // Checked again: the bank's domains may have changed since the review.
    const errors: string[] = [];
    for (const section of SECTIONS) {
      const vocab = await vocabulary(section);
      errors.push(...problemsOf(upload[SECTION_FIELD[section]]!.questions, section, vocab).map((error) => `${SECTION_FILE_LABEL[section]}: ${error}`));
    }
    if (errors.length > 0) throw AppError.badRequest(formatErrors("Fix these questions before publishing:", errors));
    return toSummary(await publish(upload));
  },

  // Students can sit an active test. A test is only activated when all six modules have questions
  // with answer keys, so nobody is ever routed into an empty module.
  async setActive(id: string, active: boolean): Promise<TestUploadSummary> {
    const upload = await loadUpload(id);
    if (upload.status !== "published") throw AppError.badRequest("Publish the test before activating it.");
    if (active) {
      const counts = await liveModuleCounts(upload);
      const empty = SECTIONS.flatMap((section) => MOCK_MODULES.filter((module) => counts[section][module] === 0).map((module) => `${SECTION_LABELS[section]} ${MOCK_MODULE_LABELS[module]}`));
      if (empty.length > 0) throw AppError.badRequest(`Every module needs questions before the test can be activated. Empty: ${empty.join(", ")}.`);
      const paperIds = SECTIONS.map((section) => upload.paperIds[section]);
      const unanswered = await QuestionModel.countDocuments({ paperId: trusted({ $in: paperIds }), correctAnswer: null });
      if (unanswered > 0) throw AppError.badRequest(`${unanswered} question(s) have no correct answer. Set them in the question bank first.`);
    }
    const status = active ? "published" : "hidden";
    const paperIds = SECTIONS.map((section) => upload.paperIds[section]);
    await PaperModel.updateMany({ _id: trusted({ $in: paperIds }) }, { $set: { status } });
    await QuestionModel.updateMany({ paperId: trusted({ $in: paperIds }) }, { $set: { status } });
    // Turning a test on or off by hand replaces any schedule.
    const saved = await TestUploadModel.findByIdAndUpdate(upload._id, { $set: { active, activateAt: null } }, { new: true }).lean<TestUploadDoc>();
    return toSummary(saved!);
  },

  // Activates a published, inactive test by itself at `at` (proposal 4.2 "schedule a paper"). The
  // module checks run then; a test that fails them stays off, its schedule is cleared and the reason logged.
  async setSchedule(id: string, at: Date | null): Promise<TestUploadSummary> {
    const upload = await loadUpload(id);
    if (at) {
      if (upload.status !== "published") throw AppError.badRequest("Publish the test before scheduling it.");
      if (upload.active) throw AppError.badRequest("This test is already active.");
      if (at.getTime() <= Date.now()) throw AppError.badRequest("Choose a time in the future.");
    }
    const saved = await TestUploadModel.findByIdAndUpdate(upload._id, { $set: { activateAt: at } }, { new: true }).lean<TestUploadDoc>();
    return toSummary(saved!);
  },

  // Called by the scheduler: activates the tests whose time has come. Returns how many.
  async activateDue(now: Date): Promise<{ activated: number; failed: string[] }> {
    const due = await TestUploadModel.find({ status: "published", active: false, activateAt: trusted({ $ne: null, $lte: now }) }).select("_id title").lean<TestUploadDoc[]>();
    let activated = 0;
    const failed: string[] = [];
    for (const upload of due) {
      try {
        await this.setActive(String(upload._id), true);
        activated += 1;
      } catch (error) {
        failed.push(`${upload.title}: ${error instanceof Error ? error.message : String(error)}`);
        // Not retried every minute: the admin sees the test is still off and fixes it.
        await TestUploadModel.updateOne({ _id: upload._id }, { $set: { activateAt: null } });
      }
    }
    return { activated, failed };
  },

  // Only a draft can be deleted. A published test may already have student attempts, which keep
  // pointing at its questions; it is deactivated instead.
  async remove(id: string): Promise<void> {
    const upload = await loadUpload(id);
    if (upload.status === "published") throw AppError.conflict("A published test cannot be deleted because students' results use it. Deactivate it instead.");
    await TestUploadModel.deleteOne({ _id: upload._id, status: "draft" });
  },

  // ---------- students ----------

  // Published tests for Admin → Access (uploaded exams that are not active are not in the catalog).
  async listPublished(): Promise<AccessItem[]> {
    const uploads = await TestUploadModel.find({ status: "published" })
      .select("kind title examDate active")
      .sort({ year: -1, testNumber: -1 })
      .lean<TestUploadDoc[]>();
    return uploads.map((upload) => ({
      key: uploadAccessKey(String(upload._id)),
      kind: kindOf(upload) === "exam" ? "exam" : "practice",
      name: upload.title,
      date: upload.examDate ?? null,
      active: upload.active,
    }));
  },

  // The locks are added per account by practice.service.
  async listActive(): Promise<Omit<PracticeTestListing, "locked" | "lockReason" | "pinned" | "label" | "free">[]> {
    const uploads = await TestUploadModel.find({ status: "published", active: true })
      .select("kind title year testNumber paperIds status")
      .sort({ year: -1, testNumber: -1 })
      .lean<TestUploadDoc[]>();
    return Promise.all(
      uploads.map(async (upload) => ({
        id: String(upload._id),
        kind: kindOf(upload),
        title: upload.title,
        year: upload.year,
        testNumber: upload.testNumber,
        moduleCounts: await liveModuleCounts(upload),
      })),
    );
  },

  // The paper a student's section of this test is built from. Starting needs an active test;
  // continuing one already begun (after the break) does not, so deactivating never strands anyone.
  async sectionPaper(id: string, section: Section, requireActive: boolean): Promise<{ upload: TestUploadDoc; paperId: mongoose.Types.ObjectId }> {
    const upload = await TestUploadModel.findById(id).select("title status active paperIds").lean<TestUploadDoc>();
    if (!upload || upload.status !== "published" || (requireActive && !upload.active)) throw AppError.notFound("That practice test is not available");
    const paperId = upload.paperIds[section];
    if (!paperId) throw AppError.notFound("That practice test is not available");
    return { upload, paperId };
  },
};
