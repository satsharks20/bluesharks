import mongoose from "mongoose";
import {
  ANNOTATION_TARGETS,
  HIGHLIGHT_COLORS,
  MAX_NOTE_LENGTH,
  type Annotation,
  ATTEMPT_KINDS,
  ATTEMPT_ORIGINS,
  ATTEMPT_STATUSES,
  SECTIONS,
  type AttemptKind,
  type AttemptOrigin,
  type AttemptStatus,
  TIME_MULTIPLIERS,
  type MockModule,
  type Section,
  type TimeMultiplier,
} from "@satsharks/types";

const { Schema } = mongoose;

export interface AttemptItem {
  questionId: mongoose.Types.ObjectId;
  // Adaptive mocks only: which module the question belongs to. null for drills.
  module: MockModule | null;
  // What the student entered: a choice key ("A") or the typed response. null = unanswered.
  answer: string | null;
  flagged: boolean;
  // The student used "Check" on this question, so its answer has already been revealed. Drills only.
  checked: boolean;
  // Filled in when the question is checked, when its module is submitted, or when the attempt ends.
  correct: boolean | null;
  // Seconds the question was on screen, added up by the server each time the student moves on.
  timeSpentSeconds: number;
  // Every different answer the student gave, oldest first (last 10), to spot a right answer
  // changed to a wrong one. Empty for attempts made before it was recorded.
  answers: string[];
  // Highlights and notes the student made on this question (test screen).
  annotations: Annotation[];
}

export interface AttemptDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  kind: AttemptKind;
  // Where the questions came from (see AttemptOrigin). Older attempts: derived from kind.
  origin: AttemptOrigin | null;
  name: string;
  section: Section;
  // Drill: the one paper it was drawn from. Mock: null when drawn from every exam.
  paperId: mongoose.Types.ObjectId | null;
  // Mock: the exams its question pool was restricted to. Empty = every published exam.
  paperIds: mongoose.Types.ObjectId[];
  // Mock: other exams that top up a pool the chosen ones cannot fill (an exam without Math, or too
  // few questions). Their questions are used only for what the chosen exams lack.
  extraPaperIds: mongoose.Types.ObjectId[];
  status: AttemptStatus;
  timed: boolean;
  // Extended-time accommodation (1, 1.5 or 2). Already applied to timeLimitSeconds.
  timeMultiplier: TimeMultiplier;
  // Drill: limit for the whole attempt. Mock: limit for each module.
  timeLimitSeconds: number | null;
  // Set when this mock is one section of a full test.
  fullTestId: mongoose.Types.ObjectId | null;
  // Set when the mock is a section of an uploaded practice test: its modules are that test's fixed
  // modules instead of questions drawn from the bank. paperId is then the section's paper.
  testUploadId: mongoose.Types.ObjectId | null;
  // The question on screen and since when, so its time can be added when the student moves on.
  viewPosition: number | null;
  viewStartedAt: Date | null;
  // Authoritative clock: remaining = limit - (now - start), computed on the server.
  // Drill: start of the attempt. Mock: start of the current module.
  startedAt: Date;
  lastPosition: number;
  items: AttemptItem[];

  // Adaptive mocks only.
  currentModule: "m1" | "m2" | null;
  m2Type: "m2_easy" | "m2_hard" | null;
  m1Correct: number | null;
  m2Correct: number | null;
  // The rule in force when Module 1 was submitted, kept with the attempt.
  routingThresholdPercent: number | null;
  routingRequiredCorrect: number | null;
  // Seconds from each module's start to its submission (capped at the limit when timed).
  m1TimeUsedSeconds: number | null;
  m2TimeUsedSeconds: number | null;
  // 200–800 from the conversion table for the route taken. null until the table exists.
  sectionScore: number | null;
  // Module 1 was closed by its clock running out (blanks there count as "ran out of time").
  m1TimedOut: boolean;
  // The whole attempt (or its last module) ended because the time ran out.
  timedOut: boolean;
  // The student deleted it from their lists. Kept for history and analytics (saved permanently).
  removedAt: Date | null;

  correct: number;
  incorrect: number;
  unanswered: number;
  // Whole attempt. Timed: wall clock, capped at the limit. Untimed: sum of question time.
  timeUsedSeconds: number | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const annotationSchema = new Schema<Annotation>(
  {
    id: { type: String, required: true },
    target: { type: String, enum: ANNOTATION_TARGETS, required: true },
    start: { type: Number, required: true },
    end: { type: Number, required: true },
    color: { type: String, enum: HIGHLIGHT_COLORS, default: "yellow" },
    underline: { type: Boolean, default: false },
    note: { type: String, default: "", maxlength: MAX_NOTE_LENGTH },
  },
  { _id: false },
);

const itemSchema = new Schema<AttemptItem>(
  {
    questionId: { type: Schema.Types.ObjectId, ref: "Question", required: true },
    module: { type: String, enum: ["m1", "m2_easy", "m2_hard", null], default: null },
    answer: { type: String, default: null, maxlength: 200 },
    flagged: { type: Boolean, default: false },
    checked: { type: Boolean, default: false },
    correct: { type: Boolean, default: null },
    timeSpentSeconds: { type: Number, default: 0 },
    answers: { type: [String], default: [] },
    annotations: { type: [annotationSchema], default: [] },
  },
  { _id: false },
);

const attemptSchema = new Schema<AttemptDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ATTEMPT_KINDS, default: "drill" },
    origin: { type: String, enum: [...ATTEMPT_ORIGINS, null], default: null },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    section: { type: String, enum: SECTIONS, required: true },
    paperId: { type: Schema.Types.ObjectId, ref: "Paper", default: null },
    paperIds: { type: [Schema.Types.ObjectId], ref: "Paper", default: [] },
    extraPaperIds: { type: [Schema.Types.ObjectId], ref: "Paper", default: [] },
    status: { type: String, enum: ATTEMPT_STATUSES, default: "active" },
    timed: { type: Boolean, default: false },
    timeMultiplier: { type: Number, enum: TIME_MULTIPLIERS, default: 1 },
    timeLimitSeconds: { type: Number, default: null },
    fullTestId: { type: Schema.Types.ObjectId, ref: "FullTest", default: null },
    testUploadId: { type: Schema.Types.ObjectId, ref: "TestUpload", default: null },
    viewPosition: { type: Number, default: null },
    viewStartedAt: { type: Date, default: null },
    startedAt: { type: Date, default: () => new Date() },
    lastPosition: { type: Number, default: 1 },
    items: { type: [itemSchema], default: [] },
    currentModule: { type: String, enum: ["m1", "m2", null], default: null },
    m2Type: { type: String, enum: ["m2_easy", "m2_hard", null], default: null },
    m1Correct: { type: Number, default: null },
    m2Correct: { type: Number, default: null },
    routingThresholdPercent: { type: Number, default: null },
    routingRequiredCorrect: { type: Number, default: null },
    m1TimeUsedSeconds: { type: Number, default: null },
    m2TimeUsedSeconds: { type: Number, default: null },
    sectionScore: { type: Number, default: null },
    m1TimedOut: { type: Boolean, default: false },
    timedOut: { type: Boolean, default: false },
    removedAt: { type: Date, default: null },
    correct: { type: Number, default: 0 },
    incorrect: { type: Number, default: 0 },
    unanswered: { type: Number, default: 0 },
    timeUsedSeconds: { type: Number, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// A student's attempts, newest first, optionally by status.
attemptSchema.index({ userId: 1, status: 1, createdAt: -1 });
// A full test has at most one attempt per section, even if "continue" is sent twice. Partial (not
// sparse): every other attempt stores fullTestId: null and must stay out of the unique index.
attemptSchema.index(
  { fullTestId: 1, section: 1 },
  { unique: true, partialFilterExpression: { fullTestId: { $type: "objectId" } } },
);

export const AttemptModel =
  (mongoose.models.Attempt as mongoose.Model<AttemptDoc> | undefined) ??
  mongoose.model<AttemptDoc>("Attempt", attemptSchema);
