// Shared enums and DTOs. Kept free of runtime dependencies so the web app can import it.

export const USER_ROLES = ["student", "staff", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["active", "blocked", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PERMISSIONS = [
  "admin:access",
  "papers:read",
  "papers:write",
  "questions:read",
  "questions:write",
  "users:read",
  "users:write",
  "reports:read",
  "reports:write",
  // Payments, revenue and payment settings: admins only (staff never see money).
  "payments:read",
  "payments:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

// Single place where roles map to permissions. Routes check permissions, never role names.
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  student: [],
  staff: ["admin:access", "papers:read", "questions:read", "reports:read"],
  admin: PERMISSIONS,
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

// Local = Pakistan (PKR plans), International = everywhere else (USD plans). Decided only by the
// country the student picks at sign-up, never by IP address.
export const USER_REGIONS = ["local", "international"] as const;
export type UserRegion = (typeof USER_REGIONS)[number];

export const USER_REGION_LABELS: Record<UserRegion, string> = {
  local: "Local (Pakistan)",
  international: "International",
};

export const LOCAL_COUNTRY_CODE = "PK";

// Free or paid access. Set by an admin for now; payments (proposal Checkpoint 4.1) will set it too.
export const USER_PLANS = ["free", "paid"] as const;
export type UserPlan = (typeof USER_PLANS)[number];

// The paid plans on the pricing page. "Till Test Day" was removed on 2026-10-16 (client: only Free,
// Monthly and 3 Months); an account that still stores it keeps its paid access (see LEGACY_PAID_PLANS).
export const PAID_PLANS = ["monthly", "three_months"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
// Plan ids no longer offered but possibly stored on older accounts.
export const LEGACY_PAID_PLANS = ["till_test_day"] as const;
export const isPaidPlan = (value: unknown): value is PaidPlan => (PAID_PLANS as readonly unknown[]).includes(value);

export const PAID_PLAN_LABELS: Record<PaidPlan, string> = {
  monthly: "Monthly",
  three_months: "3 Months",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  active: "Active",
  blocked: "Disabled",
  deleted: "Deleted",
};

// ISO 3166-1 alpha-2 codes. Names are shown with Intl.DisplayNames in the browser.
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS",
  "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE",
  "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM",
  "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC",
  "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG",
  "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS",
  "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO",
  "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

export function isCountryCode(value: string): value is CountryCode {
  return (COUNTRY_CODES as readonly string[]).includes(value);
}

export function regionForCountry(country: string): UserRegion {
  return country === LOCAL_COUNTRY_CODE ? "local" : "international";
}

export const PAPER_STATUSES =["draft", "published", "hidden"] as const;
export type PaperStatus = (typeof PAPER_STATUSES)[number];

export const SECTIONS = ["reading_writing", "math"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  reading_writing: "Reading & Writing",
  math: "Math",
};

// m1 = routing module; m2_easy / m2_hard = the two second-stage routes.
// "none" = the question is not part of a module (a question-bank paper, e.g. imported from a drill).
// "unknown" = it belongs to a module, but the source did not expose which one.
export const MODULE_TYPES = ["m1", "m2_easy", "m2_hard", "none", "unknown"] as const;
export type ModuleType = (typeof MODULE_TYPES)[number];

export const MODULE_TYPE_LABELS: Record<ModuleType, string> = {
  m1: "Module 1",
  m2_easy: "Module 2 (easier)",
  m2_hard: "Module 2 (harder)",
  none: "No module (question set)",
  unknown: "Unknown module",
};

// spr = student-produced response (grid-in).
export const QUESTION_TYPES = ["mcq", "spr", "other"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const ATTEMPT_STATUSES = ["active", "done"] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ATTEMPT_KINDS = ["drill", "mock"] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

// The modules of an adaptive mock section.
export type MockModule = "m1" | "m2_easy" | "m2_hard";

export const MOCK_MODULE_LABELS: Record<MockModule, string> = {
  m1: "Module 1",
  m2_easy: "Module 2 (easier)",
  m2_hard: "Module 2 (harder)",
};

export const MOCK_MODULES: readonly MockModule[] = ["m1", "m2_easy", "m2_hard"];

// Size and time of each module of an adaptive mock, per section (the Digital SAT format).
export const MOCK_FORMAT: Record<"math" | "reading_writing", { questionsPerModule: number; minutesPerModule: number }> = {
  math: { questionsPerModule: 22, minutesPerModule: 35 },
  reading_writing: { questionsPerModule: 27, minutesPerModule: 32 },
};

// Default share of Module 1 a student must get right to be given the harder Module 2.
// The live value is an admin setting.
export const DEFAULT_ROUTING_THRESHOLD_PERCENT = 65;

export interface AdaptiveSettings {
  routingThresholdPercent: number;
  // Build bank mocks to the official module pattern (MODULE_PATTERN). Off: one question per skill
  // in turn, as before 2026-10-30.
  officialPattern: boolean;
}

// The official make-up of a bank-built module, in the order its questions appear. Taken from the
// fourteen modules of College Board's practice tests 4–10 (paper versions, 33 Reading and Writing
// questions a module) scaled to the digital 27, and checked against the skill mix of the 7,720
// Reading and Writing questions of real digital administrations in the bank (2026-10-30, see
// docs/adaptive-testing.md). Neighbouring entries with the same `group` are mixed together and
// ordered easier to harder as one block (the official tests interleave Boundaries with Form,
// Structure, and Sense). Math is grouped by domain, not skill, because official Math modules are
// not sorted by topic: the picked questions are ordered easier to harder with the typed-answer
// questions in MATH_SPR_POSITIONS.
export interface PatternEntry {
  // Reading and Writing: a skill. Math: a domain (topic).
  match: { skill: string } | { topic: string };
  // Reading and Writing: the skill's domain, which fills in when the skill runs short.
  domain?: string;
  m1: number;
  m2: number;
  group?: string;
  // Math only: how many of the questions are typed answers (grid-ins), per module.
  sprM1?: number;
  sprM2?: number;
}

export const MODULE_PATTERN: Record<Section, readonly PatternEntry[]> = {
  reading_writing: [
    { match: { skill: "Words in Context" }, domain: "Craft and Structure", m1: 4, m2: 4 },
    { match: { skill: "Text Structure and Purpose" }, domain: "Craft and Structure", m1: 2, m2: 3 },
    // One per section in the official tests, so only Module 1 has it.
    { match: { skill: "Cross-Text Connections" }, domain: "Craft and Structure", m1: 1, m2: 0 },
    { match: { skill: "Central Ideas and Details" }, domain: "Information and Ideas", m1: 2, m2: 2 },
    // About half of them on a table or graph (COMMAND_OF_EVIDENCE_SKILL).
    { match: { skill: "Command of Evidence" }, domain: "Information and Ideas", m1: 4, m2: 4 },
    { match: { skill: "Inferences" }, domain: "Information and Ideas", m1: 2, m2: 2 },
    { match: { skill: "Boundaries" }, domain: "Standard English Conventions", m1: 3, m2: 3, group: "conventions" },
    { match: { skill: "Form, Structure, and Sense" }, domain: "Standard English Conventions", m1: 3, m2: 3, group: "conventions" },
    { match: { skill: "Transitions" }, domain: "Expression of Ideas", m1: 3, m2: 3 },
    { match: { skill: "Rhetorical Synthesis" }, domain: "Expression of Ideas", m1: 3, m2: 3 },
  ],
  // 15 / 15 / 7 / 7 over the section (College Board: 13–15, 13–15, 5–7, 5–7).
  math: [
    { match: { topic: "Algebra" }, m1: 8, m2: 7, sprM1: 2, sprM2: 2 },
    { match: { topic: "Advanced Math" }, m1: 7, m2: 8, sprM1: 2, sprM2: 2 },
    { match: { topic: "Problem-Solving and Data Analysis" }, m1: 4, m2: 3, sprM1: 1, sprM2: 1 },
    { match: { topic: "Geometry and Trigonometry" }, m1: 3, m2: 4, sprM1: 1, sprM2: 1 },
  ],
};

export const COMMAND_OF_EVIDENCE_SKILL = "Command of Evidence";

// Where a Math module's typed-answer questions sit (1-based). The official tests put them in pairs
// after each run of multiple-choice questions (paper: 6–7, 13–14, 20–21, 27 of 27).
export const MATH_SPR_POSITIONS: readonly number[] = [5, 6, 11, 12, 17, 18];

// ---------- highlights and notes (test screen) ----------

export const HIGHLIGHT_COLORS = ["yellow", "blue", "pink"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
// The parts of a question a student can mark: the passage and the question itself (Bluebook does
// not mark answer choices).
export const ANNOTATION_TARGETS = ["passage", "prompt"] as const;
export type AnnotationTarget = (typeof ANNOTATION_TARGETS)[number];
export const MAX_ANNOTATIONS_PER_QUESTION = 60;
export const MAX_NOTE_LENGTH = 500;

// A highlight: characters [start, end) of the target's text as shown on screen.
export interface Annotation {
  id: string;
  target: AnnotationTarget;
  start: number;
  end: number;
  color: HighlightColor;
  underline: boolean;
  note: string;
}

// Extended-time accommodations: every module's time limit is multiplied by this.
export const TIME_MULTIPLIERS = [1, 1.5, 2] as const;
export type TimeMultiplier = (typeof TIME_MULTIPLIERS)[number];

// Minutes of break between Reading & Writing and Math in a full test.
export const FULL_TEST_BREAK_MINUTES = 10;

// ---------- scoring ----------

export const SECTION_SCORE_MIN = 200;
export const SECTION_SCORE_MAX = 800;

// Raw-to-scaled conversion: scores[n] is the section score for n correct answers over both
// modules, so each table has (questions in the section + 1) entries. The Digital SAT scores the
// same raw count differently after the easier and the harder Module 2, hence one table per route.
export type ScoreRoute = "m2_easy" | "m2_hard";
export const SCORE_ROUTES: readonly ScoreRoute[] = ["m2_easy", "m2_hard"];
export type ConversionTables = Record<Section, Record<ScoreRoute, number[] | null>>;

export function sectionQuestionCount(section: Section): number {
  return MOCK_FORMAT[section].questionsPerModule * 2;
}

// Built-in estimate used for any route an admin has not entered a table for, so students always
// get a score. Shaped like published Digital SAT practice curves: the harder Module 2 reaches 800,
// the easier one tops out at 650. Points are (share of the section correct, section score).
const ESTIMATE_CURVES: Record<ScoreRoute, ReadonlyArray<readonly [number, number]>> = {
  m2_hard: [[0, 200], [0.25, 370], [0.4, 450], [0.5, 510], [0.6, 570], [0.7, 630], [0.8, 690], [0.9, 750], [1, 800]],
  m2_easy: [[0, 200], [0.25, 330], [0.4, 400], [0.5, 450], [0.6, 500], [0.7, 545], [0.8, 590], [0.9, 625], [1, 650]],
};

function estimateTable(section: Section, route: ScoreRoute): number[] {
  const questions = sectionQuestionCount(section);
  const curve = ESTIMATE_CURVES[route];
  return Array.from({ length: questions + 1 }, (_, correct) => {
    const share = correct / questions;
    const upper = curve.findIndex(([point]) => point >= share);
    const [x1, y1] = curve[Math.max(upper, 1)]!;
    const [x0, y0] = curve[Math.max(upper, 1) - 1]!;
    return Math.round((y0 + ((share - x0) / (x1 - x0)) * (y1 - y0)) / 10) * 10;
  });
}

export const DEFAULT_CONVERSION_TABLES: ConversionTables = {
  reading_writing: { m2_easy: estimateTable("reading_writing", "m2_easy"), m2_hard: estimateTable("reading_writing", "m2_hard") },
  math: { m2_easy: estimateTable("math", "m2_easy"), m2_hard: estimateTable("math", "m2_hard") },
};

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// Error code of the 401 a student's older device gets after the account logs in somewhere else
// (one device at a time). The web app uses it to say why the student was signed out.
export const SIGNED_IN_ELSEWHERE = "signed_in_elsewhere";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  permissions: Permission[];
  // ISO country code. null for accounts made before country was asked, and for admins made
  // from the command line.
  country: string | null;
  region: UserRegion | null;
  // Effective plan: a paid plan whose end date has passed counts as free.
  plan: UserPlan;
  // The time zone days and streaks follow (saved from the browser); null until first saved.
  timeZone: string | null;
  // When the paid plan ends (null = free, or paid with no end date).
  planExpiresAt: string | null;
}

// ---------- admin: users ----------

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  country: string | null;
  region: UserRegion | null;
  // Effective plan (see PublicUser.plan) and what was set.
  plan: UserPlan;
  paidPlan: PaidPlan | null;
  planExpiresAt: string | null;
  // Optional, given at sign-up.
  phone: string | null;
  // Deleted accounts: when, and the last day they can be restored (DELETED_RESTORE_DAYS).
  deletedAt: string | null;
  restorableUntil: string | null;
  createdAt: string;
}

// A deleted account can be restored for this many days; then it is removed for good.
export const DELETED_RESTORE_DAYS = 30;

export interface AdminUserActivity {
  drills: number;
  mocks: number;
  fullTests: number;
  completed: number;
  bestSectionScore: number | null;
  bestTotalScore: number | null;
  reports: number;
  lastActiveAt: string | null;
}

export type UserListCounts = { all: number; paid: number; free: number; blocked: number; deleted: number };

export interface PaperModule {
  key: string;
  section: Section;
  moduleNumber: 1 | 2 | null;
  moduleType: ModuleType;
  questionCount: number;
  timeLimitSeconds: number | null;
}

export interface PaperAdaptiveInfo {
  isAdaptive: boolean;
  // Where the module-2 decision is made, as observed at the source.
  routing: "server_side" | "client_side" | "unknown";
  observedRoute: ModuleType | null;
  module1Correct: number | null;
  // Stays null unless the source explicitly exposes its rule.
  routingThreshold: number | null;
}

export interface PaperSummary {
  id: string;
  title: string;
  description: string | null;
  source: string;
  sourcePaperId: string;
  status: PaperStatus;
  sections: Section[];
  modules: PaperModule[];
  adaptive: PaperAdaptiveInfo;
  questionCount: number;
  // Published by itself at this moment (ISO); null = not scheduled.
  publishAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionListItem {
  id: string;
  section: Section;
  moduleNumber: 1 | 2 | null;
  moduleType: ModuleType;
  questionNumber: number;
  questionType: QuestionType;
  difficulty: Difficulty | null;
  topic: string | null;
  skill: string | null;
  prompt: string;
  hasCorrectAnswer: boolean;
}

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

// ---------- practice (student-facing) ----------

export interface CatalogExam {
  examId: string;
  name: string;
  examDate: string | null;
  // An uploaded exam, which can also be taken as a fixed full test.
  testUploadId: string | null;
  sections: Partial<Record<Section, { paperId: string; questionCount: number }>>;
  // Kept for paid accounts (or for invite codes) and this account cannot open it (see Admin → Access).
  locked: boolean;
  lockReason: LockReason | null;
  // Admin → Access: shown first, and a label on the card.
  pinned: boolean;
  label: ContentLabel | null;
  // Free for every account (shown as "Free" to free accounts when other exams are locked).
  free: boolean;
}

// Why an exam or test is locked for this account.
export type LockReason = "paid" | "invite";

export interface CatalogTopic {
  topic: string;
  skills: string[];
}

export interface PracticeCatalog {
  exams: CatalogExam[];
  topics: Record<Section, CatalogTopic[]>;
  access: PracticeAccess;
}

export interface ModuleResult {
  module: "m1" | "m2";
  route: MockModule | null;
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  // Measured by the server from the module's start to its submission. null for a module that has
  // not finished, and for attempts made before time was recorded.
  timeUsedSeconds: number | null;
  timeLimitSeconds: number | null;
}

export interface AttemptSummary {
  id: string;
  kind: AttemptKind;
  name: string;
  section: Section;
  paperTitle: string;
  // Set when this section is part of a full test (both sections in one sitting).
  fullTestId: string | null;
  timeMultiplier: TimeMultiplier;
  // 200–800. Finished adaptive mocks only, and only once the conversion table has been entered.
  sectionScore: number | null;
  // Whole attempt, by the server's clock. null while running and for older attempts.
  timeUsedSeconds: number | null;
  // Adaptive mocks: one entry per module reached. Drills: empty.
  modules: ModuleResult[];
  // Adaptive mocks only (null for drills).
  mock: {
    currentModule: "m1" | "m2" | null;
    m2Type: "m2_easy" | "m2_hard" | null;
    // Positions of the current module run from moduleStart to moduleStart + moduleQuestionCount - 1.
    moduleStart: number;
    moduleQuestionCount: number;
    m1Correct: number | null;
    m2Correct: number | null;
    m1Total: number;
    m2Total: number;
    routingRequiredCorrect: number | null;
  } | null;
  status: AttemptStatus;
  timed: boolean;
  timeLimitSeconds: number | null;
  // Computed by the server on every response; null for untimed attempts.
  timeRemainingSeconds: number | null;
  lastPosition: number;
  total: number;
  answered: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  createdAt: string;
  completedAt: string | null;
}

export interface AttemptNavItem {
  position: number;
  answered: boolean;
  flagged: boolean;
  checked: boolean;
}

export interface QuestionChoiceView {
  key: string;
  text: string;
  viz: unknown;
}

export interface QuestionAssetView {
  kind: "image";
  url: string;
  maxWidth: number | null;
}

export interface CorrectAnswerView {
  choiceKey: string | null;
  acceptedValues: string[];
}

// The answer key is only present once the student has checked the question or ended the attempt.
export interface QuestionResult {
  correct: boolean | null;
  correctAnswer: CorrectAnswerView | null;
  explanation: string | null;
}

export interface AttemptQuestion {
  position: number;
  // Adaptive mocks only.
  module: MockModule | null;
  section: Section;
  questionType: QuestionType;
  prompt: string;
  passage: string | null;
  choices: QuestionChoiceView[];
  assets: QuestionAssetView[];
  viz: unknown;
  answer: string | null;
  flagged: boolean;
  checked: boolean;
  result: QuestionResult | null;
  // The student's highlights and notes on this question in this attempt.
  annotations: Annotation[];
}

export interface ReviewQuestion extends AttemptQuestion {
  topic: string | null;
  skill: string | null;
  difficulty: Difficulty | null;
  result: QuestionResult;
  // Time the question was on screen, measured by the server between question loads.
  timeSpentSeconds: number;
}

// ---------- full test (Reading & Writing, break, Math) ----------

export type FullTestStage = "reading_writing" | "break" | "math" | "done";

export interface FullTestSummary {
  id: string;
  name: string;
  stage: FullTestStage;
  timed: boolean;
  timeMultiplier: TimeMultiplier;
  readingWriting: AttemptSummary | null;
  math: AttemptSummary | null;
  // When the break ends (stage "break" only).
  breakEndsAt: string | null;
  // 400–1600, once both section scores exist.
  totalScore: number | null;
  createdAt: string;
  completedAt: string | null;
}

// ---------- uploaded practice tests (a fixed adaptive test from two PDFs) ----------

// Papers made from an uploaded test, and their questions, carry this source.
export const TEST_UPLOAD_SOURCE = "pdf-upload";
// ...or this one when the upload is a real exam (shown under Exams, see TEST_UPLOAD_KINDS).
export const EXAM_UPLOAD_SOURCE = "pdf-upload-exam";
export const UPLOAD_SOURCES = [TEST_UPLOAD_SOURCE, EXAM_UPLOAD_SOURCE];

// Where an uploaded test goes. "practice": Full-Length Practice Tests on Home; its questions are
// used only in that test. "exam": a real administration (e.g. the December SAT), shown under Exams
// like the bank's exams (drills, random mocks) and also takeable as a fixed full test.
export const TEST_UPLOAD_KINDS = ["practice", "exam"] as const;
export type TestUploadKind = (typeof TEST_UPLOAD_KINDS)[number];

// Every question of an uploaded test carries this tag and the per-test one. Tagged questions belong
// to their test only: drills, random mocks and the practice catalog never draw from them.
export const FULL_TEST_QUESTION_TAG = "full-test";
export const fullTestQuestionTag = (uploadId: string) => `${FULL_TEST_QUESTION_TAG}:${uploadId}`;
// Questions of an uploaded exam carry this tag (and the per-test one) instead: they are bank
// questions, but their paper is still managed on the Full tests page.
export const UPLOADED_EXAM_QUESTION_TAG = "uploaded-exam";

export const UPLOAD_SECTION_STATUSES = ["extracted", "reviewed", "failed"] as const;
export type UploadSectionStatus = (typeof UPLOAD_SECTION_STATUSES)[number];

// One question as read from the PDF and edited in review, before it is published.
export interface UploadQuestion {
  module: MockModule;
  questionNumber: number;
  questionType: "mcq" | "spr";
  difficulty: Difficulty;
  // Domain, and optionally the skill, from the question bank's own vocabulary.
  topic: string;
  skill: string | null;
  passage: string | null;
  prompt: string;
  // A–D for multiple choice; empty for a student-produced response.
  choices: { key: string; text: string }[];
  choiceKey: string | null;
  acceptedValues: string[];
  explanation: string;
}

export interface TestUploadSection {
  fileName: string;
  fileSize: number;
  status: UploadSectionStatus;
  errorMessage: string;
  warnings: string[];
  uploadedAt: string;
  reviewedAt: string | null;
  moduleCounts: Record<MockModule, number>;
  questionCount: number;
  // Only on the single-upload response.
  questions?: UploadQuestion[];
}

export interface TestUploadSummary {
  id: string;
  kind: TestUploadKind;
  title: string;
  year: number;
  // Practice tests only; an exam's number is assigned automatically and not shown.
  testNumber: number;
  // Exams only: the administration date, YYYY-MM-DD.
  examDate: string | null;
  status: "draft" | "published";
  // Published tests only: students can see and start it.
  active: boolean;
  // Published tests only: activated by itself at this moment (ISO); null = not scheduled.
  activateAt: string | null;
  readingWriting: TestUploadSection | null;
  math: TestUploadSection | null;
  // The two papers created on publish.
  paperIds: Partial<Record<Section, string>>;
  publishedAt: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

// What a student sees of an active uploaded test.
export interface PracticeTestListing {
  id: string;
  kind: TestUploadKind;
  title: string;
  year: number;
  testNumber: number;
  moduleCounts: Record<Section, Record<MockModule, number>>;
  // Kept for paid accounts (or for invite codes) and this account cannot open it.
  locked: boolean;
  lockReason: LockReason | null;
  pinned: boolean;
  label: ContentLabel | null;
  free: boolean;
}

const MAX_SPR_LENGTH = 5;
const SPR_VALUE = /^-?(\d+\.?\d*|\.\d+)(\/\d+)?$/;

// Splits a written grid-in answer ("0.5 or 1/2", "3.5, 7/2") into its accepted forms.
export function splitAcceptedValues(answer: string): string[] {
  return answer
    .split(/\s+or\s+|\s*;\s*|,\s+/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

// A student-produced response must be something the answer box lets a student type: digits, one
// decimal point or fraction bar, an optional minus, 5 characters (6 when negative).
export function sprValueProblem(value: string): string | null {
  if (!SPR_VALUE.test(value)) return `"${value}" cannot be typed in the answer box (digits, ".", "/" and "-" only)`;
  if (value.length > MAX_SPR_LENGTH + (value.startsWith("-") ? 1 : 0)) return `"${value}" is longer than the answer box allows`;
  return null;
}

// The "$…$" pieces of Math text, and whether every "$" is paired. "\$" is a literal dollar sign.
export function latexSegments(text: string): { segments: string[]; balanced: boolean; outside: string } {
  const segments: string[] = [];
  let outside = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\" && index + 1 < text.length) {
      outside += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char !== "$") {
      outside += char;
      index += 1;
      continue;
    }
    const display = text[index + 1] === "$";
    const open = display ? 2 : 1;
    let end = index + open;
    while (end < text.length) {
      if (text[end] === "\\") end += 2;
      else if (text[end] === "$" && (!display || text[end + 1] === "$")) break;
      else end += 1;
    }
    if (end >= text.length) return { segments, balanced: false, outside };
    segments.push(text.slice(index + open, end));
    index = end + open;
  }
  return { segments, balanced: true, outside };
}

// Checks one question against the upload rules. Shared by the PDF import, the review save, the
// publish step and the review screen, so all four agree. `checkLatex` returns KaTeX's message for
// a formula it cannot render, or null.
export function uploadQuestionProblems(
  question: UploadQuestion,
  section: Section,
  topics: CatalogTopic[],
  checkLatex?: (latex: string) => string | null,
): string[] {
  const problems: string[] = [];
  if (!question.prompt.trim()) problems.push("PROMPT is required");
  if (!question.explanation.trim()) problems.push("EXPLANATION is required");
  if (!DIFFICULTIES.includes(question.difficulty)) problems.push("DIFFICULTY must be EASY, MEDIUM or HARD");

  const topic = topics.find((entry) => entry.topic === question.topic);
  if (!topic) problems.push(`"${question.topic}" is not a ${SECTION_LABELS[section]} domain in the question bank`);
  else if (question.skill && !topic.skills.includes(question.skill)) problems.push(`"${question.skill}" is not a skill of ${topic.topic}`);

  if (question.questionType === "spr") {
    if (section !== "math") problems.push("GRID_IN is only allowed in Math");
    if (question.choices.some((choice) => choice.text.trim())) problems.push("a GRID_IN question has no A–D choices");
    if (question.acceptedValues.length === 0) problems.push("ANSWER is required");
    for (const value of question.acceptedValues) {
      const problem = sprValueProblem(value);
      if (problem) problems.push(problem);
    }
  } else {
    const keys = question.choices.map((choice) => choice.key).join("");
    if (keys !== "ABCD" || question.choices.some((choice) => !choice.text.trim())) {
      problems.push("choices A, B, C and D are all required (use TYPE: GRID_IN for a fill-in question)");
    }
    if (!question.choiceKey || !"ABCD".includes(question.choiceKey) || question.choiceKey.length !== 1) problems.push("ANSWER must be A, B, C or D");
  }

  if (section === "math") {
    const fields: [string, string | null][] = [
      ["PROMPT", question.prompt],
      ["PASSAGE", question.passage],
      ["EXPLANATION", question.explanation],
      ...question.choices.map((choice): [string, string] => [`choice ${choice.key}`, choice.text]),
    ];
    for (const [name, text] of fields) {
      if (!text) continue;
      const { segments, balanced } = latexSegments(text);
      if (!balanced) {
        problems.push(`${name} has a "$" with no closing "$" (write a dollar sign as \\$ inside $…$, e.g. $\\$78$)`);
        continue;
      }
      for (const latex of segments) {
        const error = checkLatex?.(latex);
        if (error) problems.push(`${name}: the formula $${latex}$ cannot be displayed (${error})`);
      }
    }
  }
  return problems;
}

// Math that was probably meant as a formula but is not inside $…$.
export function looseMathWarning(text: string): boolean {
  return /\^|\\(frac|sqrt|pi|times|le|ge|neq)\b/.test(latexSegments(text).outside);
}

// ---------- pricing (edited in Admin → Settings, shown on /pricing) ----------

export const CURRENCIES = ["PKR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

// The three plans are fixed (accounts store which one they have); their wording and prices are not.
export const PRICING_PLAN_IDS = ["free", ...PAID_PLANS] as const;
export type PricingPlanId = (typeof PRICING_PLAN_IDS)[number];

export interface PricingPlan {
  id: PricingPlanId;
  name: string;
  price: Record<Currency, string>;
  period: string;
  // "Save 22%" etc., per currency. null = no badge.
  saving: Record<Currency, string> | null;
  highlights: string[];
  popular: boolean;
}

export interface PricingComparisonRow {
  feature: string;
  free: string;
  paid: string;
}

export interface PricingContent {
  plans: PricingPlan[];
  comparison: PricingComparisonRow[];
  // One line under the plans.
  tagline: string;
  // One line under the comparison table.
  schoolsNote: string;
  // The payment terms line under the plans.
  refundPolicy: string;
}

// Plans and limits as written in the project proposal (v4.0, "Subscription plans" and "Free vs
// paid"), used until an admin saves their own.
export const DEFAULT_PRICING: PricingContent = {
  plans: [
    { id: "free", name: "Free", price: { PKR: "PKR 0", USD: "$0" }, period: "forever", saving: null, highlights: ["2 full papers", "20 drill questions a day", "Score only, no analysis"], popular: false },
    { id: "monthly", name: "Monthly", price: { PKR: "PKR 1,500", USD: "$12.99" }, period: "per month", saving: null, highlights: ["Everything unlocked", "Cancel any time"], popular: false },
    {
      id: "three_months",
      name: "3 Months",
      price: { PKR: "PKR 3,500", USD: "$29.99" },
      period: "per 3 months",
      saving: { PKR: "Save 22%", USD: "Save 23%" },
      highlights: ["Everything unlocked", "The normal prep window"],
      popular: true,
    },
  ],
  comparison: [
    { feature: "Full-length past papers", free: "2", paid: "Every paper, plus each new one" },
    { feature: "Drill questions", free: "20 per day", paid: "Unlimited" },
    { feature: "Question review with explanations", free: "Yes", paid: "Yes" },
    { feature: "Predicted SAT score", free: "Score only", paid: "Score, range and trend" },
    { feature: "Skills breakdown", free: "Top 3 per section", paid: "All topics and skills" },
    { feature: "Error pattern and timing analysis", free: "—", paid: "Yes" },
    { feature: "Mistake bank and retry queue", free: "Last 20 questions", paid: "Unlimited" },
    { feature: "Daily goals, streaks and leaderboard", free: "Yes", paid: "Yes" },
    { feature: "Streak freezes", free: "1 per month", paid: "3 per month" },
  ],
  tagline: "One hour with a tutor costs more than three months of SAT Sharks.",
  schoolsNote: "",
  refundPolicy: "All payments are final: SAT Sharks does not offer refunds.",
};

// ---------- SAT test dates (edited in Admin → SAT dates, shown on /sat-dates and the dashboard) ----------

// Days are calendar dates ("YYYY-MM-DD") with no time zone: a test day is the same date everywhere.
export interface SatTestDate {
  date: string;
  registrationDeadline: string;
  // Last day for late registration, changes and regular cancellation. null = not announced.
  lateDeadline: string | null;
  // Optional short note shown with the date, e.g. "Scores out about two weeks later". "" = none.
  note: string;
}

export interface SatDatesContent {
  dates: SatTestDate[];
}

// College Board's published 2026-27 SAT weekend dates (satsuite.collegeboard.org/sat/dates-deadlines)
// and score release days (satsuite.collegeboard.org/scores/score-release-dates), checked 2026-10-11, used until an admin saves their own. The same dates apply in Pakistan.
export const DEFAULT_SAT_DATES: SatDatesContent = {
  dates: [
    { date: "2026-10-03", registrationDeadline: "2026-09-18", lateDeadline: "2026-09-22", note: "Scores out Oct 16" },
    { date: "2026-11-07", registrationDeadline: "2026-10-23", lateDeadline: "2026-10-27", note: "Scores out Nov 20" },
    { date: "2026-12-05", registrationDeadline: "2026-11-20", lateDeadline: "2026-11-24", note: "Scores out Dec 18" },
    { date: "2027-03-06", registrationDeadline: "2027-02-19", lateDeadline: "2027-02-23", note: "" },
    { date: "2027-05-01", registrationDeadline: "2027-04-16", lateDeadline: "2027-04-20", note: "" },
    { date: "2027-06-05", registrationDeadline: "2027-05-21", lateDeadline: "2027-05-25", note: "" },
  ],
};

// ---------- access by plan (edited in Admin → Access) ----------

// "free": every account. "paid": accounts with an active paid plan (and staff/admins).
export const ACCESS_LEVELS = ["free", "paid"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

// Ways of practising that can be kept for paid accounts. Fixed tests (uploaded practice tests and
// uploaded exams taken whole) are set one by one instead, like exams.
export const ACCESS_FEATURES = ["drills", "mocks", "full_tests", "analytics"] as const;
export type AccessFeature = (typeof ACCESS_FEATURES)[number];

export const ACCESS_FEATURE_LABELS: Record<AccessFeature, { label: string; description: string }> = {
  drills: { label: "Practice drills", description: "Question sets from one exam, with answer checks" },
  mocks: { label: "Adaptive section mocks", description: "One section in two modules, drawn from the exam pool" },
  full_tests: { label: "Adaptive full tests", description: "Both sections and a break, drawn from the exam pool" },
  analytics: {
    label: "Full analytics & mistake bank",
    description: "Score range and trend, every skill, error and timing analysis, every mistake. Locked: score only, top 3 weak areas per section, last 20 mistakes",
  },
};

// An exam or uploaded test in the access rules is known by its catalog exam id. Everything uploaded
// on the Full tests page (exam or practice test) is "upload:<id>", which is also its exam id.
export const uploadAccessKey = (uploadId: string) => `upload:${uploadId}`;

// Exams and uploaded tests can also be kept for students who were given an invite code (proposal
// 4.2: "Free, Paid only or Invite code only"). Paid plans do not open invite-only content; the code
// does. Staff and admins open everything.
export const CONTENT_ACCESS_LEVELS = ["free", "paid", "invite"] as const;
export type ContentAccessLevel = (typeof CONTENT_ACCESS_LEVELS)[number];

// A label an admin puts on an exam or test card (proposal 4.2).
export const CONTENT_LABELS = ["new", "hard", "most_attempted"] as const;
export type ContentLabel = (typeof CONTENT_LABELS)[number];
export const CONTENT_LABEL_TEXT: Record<ContentLabel, string> = { new: "New", hard: "Hard", most_attempted: "Most attempted" };

export interface AccessRule {
  key: string;
  level: ContentAccessLevel;
  // Invite-only content: the code students type to open it (letters and digits, stored upper case).
  inviteCode: string | null;
  // Shown first in its list.
  pinned: boolean;
  label: ContentLabel | null;
}

export interface AccessSettings {
  features: Record<AccessFeature, AccessLevel>;
  // Exams and uploaded tests set one by one. Rules for exams that are hidden right now are kept.
  content: AccessRule[];
  // For exams and tests without a rule: those that appeared after the last save.
  newContent: AccessLevel;
  // Free accounts: drill questions per day (proposal: 20). null = no limit. Retry drills of the
  // mistake bank do not count (the mistake bank has its own free limit).
  freeDrillQuestionsPerDay: number | null;
}

// Everything open until an admin saves their own, so existing accounts lose nothing on release.
export const DEFAULT_ACCESS: AccessSettings = {
  features: { drills: "free", mocks: "free", full_tests: "free", analytics: "free" },
  content: [],
  newContent: "free",
  freeDrillQuestionsPerDay: null,
};

// The proposal's free limit, suggested on the Access page.
export const SUGGESTED_FREE_DRILL_QUESTIONS = 20;

export function contentRule(settings: AccessSettings, key: string): AccessRule {
  return settings.content.find((rule) => rule.key === key) ?? { key, level: settings.newContent, inviteCode: null, pinned: false, label: null };
}

export function contentAccessLevel(settings: AccessSettings, key: string): ContentAccessLevel {
  return contentRule(settings, key).level;
}

// One exam or uploaded test on the Access page.
export interface AccessItem {
  key: string;
  kind: "exam" | "practice";
  name: string;
  // Exams: the administration date (YYYY-MM-DD) when known.
  date: string | null;
  // Uploaded tests that are not active are not shown to students yet.
  active: boolean;
}

export interface AdminAccess {
  settings: AccessSettings;
  items: AccessItem[];
}

// What the signed-in account may use; sent with the practice catalog.
export interface PracticeAccess {
  // Paid plan, staff or admin.
  paid: boolean;
  features: Record<AccessFeature, boolean>;
  // Free accounts with a daily drill limit: questions allowed and already used today (the
  // student's own day). null = no limit.
  dailyDrill: { limit: number; used: number } | null;
}

// ---------- announcements (Admin → Announcements, shown as banners to students) ----------

// "free" / "paid" use the same rule as access: paid = an active paid plan.
export const ANNOUNCEMENT_AUDIENCES = ["all", "free", "paid"] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "All students",
  free: "Free accounts",
  paid: "Paid accounts",
};

export const ANNOUNCEMENT_TONES = ["info", "important"] as const;
export type AnnouncementTone = (typeof ANNOUNCEMENT_TONES)[number];

export interface Announcement {
  id: string;
  title: string;
  message: string;
  audience: AnnouncementAudience;
  tone: AnnouncementTone;
  // Off = kept as a draft or taken down.
  active: boolean;
  // Hidden after this moment (ISO); null = until turned off.
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- problem reports ----------

export const REPORT_REASONS = ["wrong_answer", "typo", "display", "explanation", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  wrong_answer: "The marked correct answer is wrong",
  typo: "Typo or unclear wording",
  display: "Image, graph, table or formula does not display correctly",
  explanation: "The explanation is wrong or missing",
  other: "Something else",
};

export const REPORT_STATUSES = ["pending", "resolved"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportHistoryEntry {
  action: "created" | "resolved" | "reopened";
  at: string;
  byName: string | null;
  note: string | null;
  // Resolved only: the question had been edited after the report was made.
  questionEdited: boolean;
}

export interface AdminReport {
  id: string;
  status: ReportStatus;
  reason: ReportReason;
  details: string | null;
  questionId: string;
  question: { sourceQuestionId: string; section: Section; prompt: string; paperTitle: string | null } | null;
  reporter: { id: string; name: string; email: string } | null;
  // Where the student met the question.
  context: { attemptId: string | null; attemptName: string | null; kind: AttemptKind | null; position: number | null };
  history: ReportHistoryEntry[];
  createdAt: string;
  resolvedAt: string | null;
}

// ---------- admin question bank ----------

export interface AdminQuestion {
  id: string;
  paperId: string;
  paperTitle: string | null;
  // Set when the question belongs to an uploaded practice test.
  testUploadId: string | null;
  sourceQuestionId: string;
  section: Section;
  moduleType: ModuleType;
  questionNumber: number;
  questionType: QuestionType;
  difficulty: Difficulty | null;
  topic: string | null;
  skill: string | null;
  status: PaperStatus;
  prompt: string;
  passage: string | null;
  choices: QuestionChoiceView[];
  assets: QuestionAssetView[];
  viz: unknown;
  correctAnswer: CorrectAnswerView | null;
  explanation: string | null;
}

export interface AdminStats {
  users: number;
  usersByRegion: Record<UserRegion | "unknown", number>;
  paidUsers: number;
  reports: Record<ReportStatus, number>;
  papers: Record<PaperStatus, number>;
  questions: Record<PaperStatus, number>;
  questionsBySection: Record<Section, number>;
  attempts: number;
  // "Today" is the day in Pakistan (Asia/Karachi), where the admins are.
  signups: { today: number; week: number };
  // Drills, section mocks and full tests started today.
  practiceToday: { drills: number; mocks: number; fullTests: number };
  // Money received (paid payments), this calendar month and all time, per currency.
  revenue: Record<Currency, { month: number; total: number }>;
  // Payments the admins have not looked at yet (red badge on Payments), and transfers to approve.
  payments: { unseen: number; toReview: number };
}

// ---------- Week 3: history, mistake bank, analytics, goals, streaks, leaderboard ----------

// Official pace: seconds per question (module minutes ÷ questions).
export const SECTION_PACE_SECONDS: Record<Section, number> = {
  reading_writing: Math.round((MOCK_FORMAT.reading_writing.minutesPerModule * 60) / MOCK_FORMAT.reading_writing.questionsPerModule),
  math: Math.round((MOCK_FORMAT.math.minutesPerModule * 60) / MOCK_FORMAT.math.questionsPerModule),
};

// Retry queue: a wrong question comes back after these many days, until it is answered correctly.
export const RETRY_INTERVAL_DAYS = [1, 3, 7, 16] as const;

// Practice points (leaderboards). An answer given faster than this earns nothing (random clicking).
export const MIN_SECONDS_FOR_POINTS: Record<Section, number> = { reading_writing: 10, math: 8 };
export const POINTS = { correct: 10, hardBonus: 5, wrongWithEffort: 2, dailyCap: 300 } as const;

// Streak freezes per calendar month (proposal: free 1, paid 3).
export const STREAK_FREEZES_PER_MONTH = { free: 1, paid: 3 } as const;
export const STREAK_MILESTONES = [7, 30, 100] as const;

// Free accounts with analytics kept for paid plans (Admin → Access) see this much (proposal p.10).
export const FREE_ANALYTICS = { weakAreas: 3, mistakes: 20 } as const;

export type QuestionResultKind = "correct" | "wrong" | "skipped";

// One question a student has answered (or left blank in a test), kept for good.
export interface QuestionHistoryItem {
  id: string;
  attemptId: string;
  position: number;
  attemptName: string;
  origin: AttemptOrigin;
  section: Section;
  topic: string | null;
  skill: string | null;
  difficulty: Difficulty | null;
  // Plain text, shortened.
  preview: string;
  result: QuestionResultKind;
  timeSpentSeconds: number;
  answeredAt: string;
}

export const ATTEMPT_ORIGINS = ["exam", "mock", "retry", "bank"] as const;
// exam: a drill from one exam. mock: an adaptive mock or full-test section. retry: the mistake
// retry queue. bank: a drill drawn from every exam by topic/skill.
export type AttemptOrigin = (typeof ATTEMPT_ORIGINS)[number];

export interface QuestionHistoryPage {
  items: QuestionHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TestHistoryEntry {
  kind: "full_test" | "section";
  id: string;
  // Results page: a full test's page or the section's results.
  href: string;
  name: string;
  section: Section | null;
  score: number | null;
  // Against the previous test of the same kind (full test, or the same section).
  change: number | null;
  correct: number;
  total: number;
  completedAt: string;
  // Removed from the student's lists, kept in history.
  removed: boolean;
}

export type MistakeStatus = "due" | "waiting" | "fixed";

export interface MistakeItem {
  id: string;
  section: Section;
  topic: string | null;
  skill: string | null;
  difficulty: Difficulty | null;
  preview: string;
  wrongCount: number;
  lastWrongAt: string;
  status: MistakeStatus;
  // Next time it comes back (null when fixed).
  dueAt: string | null;
  // 1–4: which of the retry intervals it is on.
  step: number;
  fixedAt: string | null;
  // Where it was last answered, to open the review.
  attemptId: string;
  position: number;
}

export interface MistakeBank {
  items: MistakeItem[];
  counts: { open: number; due: number; fixed: number; dueBySection: Record<Section, number> };
  // Free accounts with analytics locked see only the newest mistakes.
  limited: boolean;
  limit: number | null;
}

// A drill an insight recommends; started with POST /api/practice/drills/bank.
export interface DrillSuggestion {
  section: Section;
  skills: string[];
  difficulty: Difficulty | null;
  count: number;
  timed: boolean;
  label: string;
}

export interface NextStep {
  text: string;
  drill: DrillSuggestion | null;
}

export interface ScorePrediction {
  // null until at least one Reading & Writing and one Math section are scored.
  total: number | null;
  low: number | null;
  high: number | null;
  sections: Record<Section, number | null>;
  // Total after each scored section (only when both sections are known).
  trend: { date: string; score: number }[];
  // Scored sections used.
  basedOn: number;
}

export interface SkillStat {
  section: Section;
  topic: string;
  skill: string;
  answered: number;
  correct: number;
  accuracy: number;
  // Estimated scaled points a student would gain by getting this skill right on a real test.
  pointsToGain: number;
}

export const ERROR_PATTERNS = ["careless", "out_of_time", "not_known", "changed_answer", "trap"] as const;
export type ErrorPattern = (typeof ERROR_PATTERNS)[number];

export const ERROR_PATTERN_LABELS: Record<ErrorPattern, { label: string; description: string }> = {
  careless: { label: "Careless mistakes", description: "Wrong on a skill you usually get right" },
  out_of_time: { label: "Ran out of time", description: "Left blank when a timed module ended" },
  not_known: { label: "Topic not known yet", description: "Wrong on a skill you get right less than 60% of the time" },
  changed_answer: { label: "Changed a right answer", description: "You had the right answer, then changed it" },
  trap: { label: "Fell for a trap answer", description: "Picked the wrong answer most students pick" },
};

export interface ErrorPatternStat {
  pattern: ErrorPattern;
  count: number;
  share: number;
  // The skill this pattern hits most.
  topSkill: { section: Section; skill: string } | null;
}

export interface TimingStat {
  section: Section;
  paceSeconds: number;
  averageSeconds: number | null;
  answered: number;
}

export interface SlowQuestion {
  attemptId: string;
  position: number;
  section: Section;
  skill: string | null;
  seconds: number;
  overPace: number;
  correct: boolean | null;
}

export interface Analytics {
  // Paid plan, or analytics open to free accounts (Admin → Access).
  full: boolean;
  completedPapers: number;
  prediction: ScorePrediction;
  predictionStep: NextStep;
  skills: SkillStat[];
  skillSteps: Record<Section, NextStep>;
  // null when kept for paid plans.
  errors: { total: number; patterns: ErrorPatternStat[]; step: NextStep } | null;
  timing: {
    sections: TimingStat[];
    // The latest timed test: seconds per question in order.
    pace: { name: string; section: Section; paceSeconds: number; seconds: number[] } | null;
    slowest: SlowQuestion[];
    step: NextStep;
  } | null;
  // The free view only: how many skills cost this student points, and roughly how many points in all
  // (real numbers; the skills themselves are shown with a paid plan). null on the full view.
  locked: { skills: number; points: number } | null;
}

export const GOAL_TYPES = ["questions", "minutes"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

export interface EngagementSettings {
  targetScore: number | null;
  // YYYY-MM-DD; null = the next SAT date from Admin → SAT dates.
  testDate: string | null;
  goalType: GoalType;
  // null = use the suggestion.
  goalAmount: number | null;
  timeZone: string;
  showOnLeaderboard: boolean;
  streakReminders: boolean;
  weeklyEmail: boolean;
}

export interface StreakView {
  current: number;
  longest: number;
  // Today's goal already met.
  today: boolean;
  // Today not met yet and the streak would be lost at midnight (no freeze left).
  atRisk: boolean;
  freezesLeft: number;
  freezesPerMonth: number;
  // Days covered by a freeze this month.
  frozenDays: string[];
  badges: { days: number; earnedAt: string | null }[];
}

export interface EngagementSummary {
  settings: EngagementSettings;
  goal: { type: GoalType; amount: number; suggested: number; progress: number; met: boolean; reason: string };
  streak: StreakView;
  points: { today: number; week: number; total: number; dailyCap: number };
  // Last 14 days, oldest first.
  days: { day: string; questions: number; minutes: number; points: number; met: boolean }[];
  test: { date: string | null; daysLeft: number | null; fromSettings: boolean };
  predicted: number | null;
  friendCode: string;
  // Mistakes due for a retry now (sidebar badge).
  mistakesDue: number;
}

export const LEADERBOARD_SCOPES = ["global", "country", "friends"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];
export const LEADERBOARD_PERIODS = ["week", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export interface LeaderboardRow {
  rank: number;
  name: string;
  country: string | null;
  points: number;
  streak: number;
  me: boolean;
}

export interface Leaderboard {
  scope: LeaderboardScope;
  period: LeaderboardPeriod;
  // The viewer's own country (null on accounts made before sign-up asked for it).
  country: string | null;
  rows: LeaderboardRow[];
  // The student's own row when outside the list (null when hidden or without points).
  me: LeaderboardRow | null;
  friends: { id: string; name: string }[];
}

// Score-improvement card for Instagram / WhatsApp: first and best full-test totals.
export interface ShareCard {
  name: string;
  first: number | null;
  best: number | null;
  tests: number;
  streak: number;
}

// ---------- Week 4: payments, billing and the conversion set-up (proposal 4.1, 4.2) ----------

// How long each paid plan lasts, in calendar months.
export const PLAN_MONTHS: Record<PaidPlan, number> = { monthly: 1, three_months: 3 };

// Card payments go through a payment gateway (the "test" gateway exists only outside production,
// for trying the flow). Bank transfer, JazzCash and Easypaisa are paid by the student outside the
// site and approved by an admin. "referral" is a free week earned by inviting friends (no money).
export const PAYMENT_METHODS = ["card", "bank_transfer", "jazzcash", "easypaisa", "referral"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const MANUAL_PAYMENT_METHODS = ["bank_transfer", "jazzcash", "easypaisa"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const isManualMethod = (method: unknown): method is ManualPaymentMethod => (MANUAL_PAYMENT_METHODS as readonly unknown[]).includes(method);

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  jazzcash: "JazzCash",
  easypaisa: "Easypaisa",
  referral: "Friend invites",
};

// pending: a card checkout was opened and not finished. review: a transfer waiting for an admin.
// paid: the plan was given. rejected: an admin turned a transfer down. failed: the gateway refused it
// or it was abandoned.
export const PAYMENT_STATUSES = ["pending", "review", "paid", "rejected", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Not finished",
  review: "Waiting for approval",
  paid: "Paid",
  rejected: "Rejected",
  failed: "Failed",
};

export interface PaymentSummary {
  id: string;
  user: { id: string; name: string; email: string } | null;
  plan: PaidPlan;
  currency: Currency;
  // In the currency's main unit (rupees, dollars).
  amount: number;
  // Before the one-time offer, when it was used.
  listAmount: number;
  discountPercent: number;
  method: PaymentMethod;
  status: PaymentStatus;
  // The student's transaction ID / reference for a transfer, or the gateway's payment ID.
  reference: string | null;
  note: string | null;
  // Set when paid: "SS-20261019-4F2A9C".
  receiptNumber: string | null;
  // The plan period this payment paid for.
  periodStart: string | null;
  periodEnd: string | null;
  reviewNote: string | null;
  // Admins have opened the Payments page since it arrived.
  seen: boolean;
  createdAt: string;
  paidAt: string | null;
}

// "PKR 3,500" / "$29.99".
export function formatMoney(amount: number, currency: Currency): string {
  return currency === "PKR"
    ? `PKR ${Math.round(amount).toLocaleString("en-US")}`
    : `$${amount.toLocaleString("en-US", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// The price an admin typed on the pricing page ("PKR 1,500", "$12.99") as a number; null when it
// has no usable number (the plan then cannot be bought).
export function parsePrice(price: string): number | null {
  const match = /(\d[\d,]*(?:\.\d+)?)/.exec(price);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// One manual way to pay, set up in Admin → Settings → Payments.
export interface ManualMethodSettings {
  enabled: boolean;
  // Account title, number / IBAN, bank: shown to the student as written.
  instructions: string;
  currencies: Currency[];
}

export interface PaymentSettings {
  manual: Record<ManualPaymentMethod, ManualMethodSettings>;
  // Where "new payment" alerts go (e.g. the owner's Gmail). Empty = PAYMENT_ALERT_EMAIL from the
  // API's environment, if set.
  alertEmail: string;
  // One-time offer shown when a visitor leaves the pricing page without paying (proposal "exit offer").
  exitOffer: { enabled: boolean; percentOff: number; headline: string };
  // "Invite two friends, get a week of Pro free."
  referrals: { enabled: boolean };
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  manual: {
    bank_transfer: { enabled: false, instructions: "", currencies: ["PKR", "USD"] },
    jazzcash: { enabled: false, instructions: "", currencies: ["PKR"] },
    easypaisa: { enabled: false, instructions: "", currencies: ["PKR"] },
  },
  alertEmail: "",
  exitOffer: { enabled: false, percentOff: 15, headline: "Wait! Take {percent}% off your first plan" },
  referrals: { enabled: true },
};

// Friend invites: each friend who signs up with the student's link and earns this many practice
// points counts; every REFERRALS_PER_REWARD such friends give REFERRAL_REWARD_DAYS of paid access,
// at most REFERRAL_MAX_REWARDS times.
export const REFERRAL_QUALIFY_POINTS = 50;
export const REFERRALS_PER_REWARD = 2;
export const REFERRAL_REWARD_DAYS = 7;
export const REFERRAL_MAX_REWARDS = 5;

// What the checkout page shows for one plan.
export interface CheckoutOption {
  method: Exclude<PaymentMethod, "referral">;
  label: string;
  // Manual methods: where to send the money.
  instructions: string | null;
}

export interface Checkout {
  plan: PaidPlan;
  planName: string;
  currency: Currency;
  amount: number;
  listAmount: number;
  discountPercent: number;
  // When the paid period would start and end if paid now.
  periodStart: string;
  periodEnd: string;
  methods: CheckoutOption[];
  // A transfer of this account already waits for approval.
  waiting: PaymentSummary | null;
}

export interface Billing {
  plan: UserPlan;
  paidPlan: PaidPlan | null;
  planExpiresAt: string | null;
  // Off after the student cancels: no renewal reminders, the plan simply ends.
  autoRenew: boolean;
  currency: Currency | null;
  payments: PaymentSummary[];
  referrals: { code: string; joined: number; qualified: number; rewards: number; enabled: boolean };
  // The one-time exit offer, while this account can still use it.
  offer: { percentOff: number; headline: string } | null;
}

// Real numbers for the landing and pricing pages (proposal "proof from real students").
export interface PublicProof {
  // Students who answered a question in the last 15 minutes.
  practisingNow: number;
  // First and best full-test totals of students who show on the leaderboard ("Ayesha R.").
  improvements: { name: string; from: number; to: number; weeks: number }[];
}
