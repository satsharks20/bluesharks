import { createHash } from "node:crypto";
import mongoose from "mongoose";
import {
  DIFFICULTIES,
  MODULE_TYPES,
  PAPER_STATUSES,
  QUESTION_TYPES,
  SECTIONS,
  type Difficulty,
  type ModuleType,
  type PaperStatus,
  type QuestionType,
  type Section,
} from "@satsharks/types";

const { Schema } = mongoose;

export interface QuestionChoice {
  key: string;
  text: string;
  viz?: unknown;
}

export interface QuestionAsset {
  kind: "image";
  url: string;
  maxWidth: number | null;
  // Set once the file has been copied to our own storage; `url` then points at our copy.
  sourceUrl?: string | null;
}

export interface QuestionCorrectAnswer {
  choiceKey: string | null;
  acceptedValues: string[];
}

export interface QuestionDoc {
  _id: mongoose.Types.ObjectId;
  paperId: mongoose.Types.ObjectId;
  source: string;
  sourceQuestionId: string;
  section: Section;
  moduleNumber: 1 | 2 | null;
  moduleType: ModuleType;
  questionNumber: number;
  questionType: QuestionType;
  // null = the source did not provide it. Never guessed.
  difficulty: Difficulty | null;
  topic: string | null;
  skill: string | null;
  prompt: string;
  passage: string | null;
  choices: QuestionChoice[];
  correctAnswer: QuestionCorrectAnswer | null;
  explanation: string | null;
  assets: QuestionAsset[];
  viz?: unknown;
  sourceMetadata: Record<string, unknown>;
  status: PaperStatus;
  // "full-test" and "full-test:<upload id>" on questions of an uploaded practice test, which only
  // that test may use.
  tags: string[];
  // Fingerprint of what the student sees (contentKeyOf). The source reuses questions across exam
  // dates under different ids; equal keys are one question to a student. null until backfilled.
  contentKey?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Text, figures and images of a question, with markup, case, spacing, punctuation and the source's
// "[bluebooky.com]" labels left out, hashed. Two questions with the same key look the same.
export function contentKeyOf(question: Pick<QuestionDoc, "prompt" | "passage" | "choices" | "assets"> & { viz?: unknown }): string {
  const text = (value: string | null | undefined) =>
    (value ?? "")
      .toLowerCase()
      .replace(/bluebooky\.com/g, "")
      .replace(/[^a-z0-9]+/g, "");
  const figure = (value: unknown) => (value == null ? "" : text(JSON.stringify(value)));
  const parts = [
    text(question.passage),
    text(question.prompt),
    figure(question.viz),
    ...question.choices.map((choice) => `${text(choice.text)}${figure(choice.viz)}`),
    ...question.assets.map((asset) => asset.url),
  ];
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

const choiceSchema = new Schema<QuestionChoice>(
  {
    key: { type: String, required: true },
    text: { type: String, default: "" },
    viz: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const assetSchema = new Schema<QuestionAsset>(
  {
    kind: { type: String, enum: ["image"], required: true },
    url: { type: String, required: true },
    maxWidth: { type: Number, default: null },
    sourceUrl: { type: String, default: null },
  },
  { _id: false },
);

const correctAnswerSchema = new Schema<QuestionCorrectAnswer>(
  {
    choiceKey: { type: String, default: null },
    acceptedValues: { type: [String], default: [] },
  },
  { _id: false },
);

const questionSchema = new Schema<QuestionDoc>(
  {
    paperId: { type: Schema.Types.ObjectId, ref: "Paper", required: true },
    source: { type: String, required: true },
    sourceQuestionId: { type: String, required: true },
    section: { type: String, enum: SECTIONS, required: true },
    moduleNumber: { type: Number, enum: [1, 2, null], default: null },
    moduleType: { type: String, enum: MODULE_TYPES, required: true },
    questionNumber: { type: Number, required: true, min: 1 },
    questionType: { type: String, enum: QUESTION_TYPES, required: true },
    difficulty: { type: String, enum: [...DIFFICULTIES, null], default: null },
    topic: { type: String, default: null },
    skill: { type: String, default: null },
    prompt: { type: String, required: true },
    passage: { type: String, default: null },
    choices: { type: [choiceSchema], default: [] },
    // select:false keeps answers out of every query unless explicitly requested,
    // so a future student-facing endpoint cannot leak them by accident.
    correctAnswer: { type: correctAnswerSchema, default: null, select: false },
    explanation: { type: String, default: null, select: false },
    assets: { type: [assetSchema], default: [] },
    viz: { type: Schema.Types.Mixed, default: null },
    sourceMetadata: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: PAPER_STATUSES, default: "draft" },
    tags: { type: [String], default: [] },
    contentKey: { type: String, default: null },
  },
  { timestamps: true, minimize: false },
);

// Stable identity of an imported question: makes the importer an upsert, not an insert.
questionSchema.index({ paperId: 1, moduleType: 1, sourceQuestionId: 1 }, { unique: true });
// Reading a paper in order.
questionSchema.index({ paperId: 1, section: 1, moduleNumber: 1, questionNumber: 1 });
// Question bank filters.
questionSchema.index({ status: 1, section: 1, difficulty: 1 });
questionSchema.index({ status: 1, topic: 1, skill: 1 });
questionSchema.index({ tags: 1 });
// Finding the same source question across papers.
questionSchema.index({ source: 1, sourceQuestionId: 1 });

export const QuestionModel =
  (mongoose.models.Question as mongoose.Model<QuestionDoc> | undefined) ??
  mongoose.model<QuestionDoc>("Question", questionSchema);
