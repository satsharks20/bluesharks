import { z } from "zod";
import {
  ACCESS_FEATURES,
  ACCESS_LEVELS,
  CONTENT_ACCESS_LEVELS,
  CONTENT_LABELS,
  CURRENCIES,
  MANUAL_PAYMENT_METHODS,
  PAYMENT_STATUSES,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_TONES,
  DIFFICULTIES,
  GOAL_TYPES,
  isCountryCode,
  LEADERBOARD_PERIODS,
  LEADERBOARD_SCOPES,
  MODULE_TYPES,
  PAPER_STATUSES,
  QUESTION_TYPES,
  REPORT_REASONS,
  REPORT_STATUSES,
  SECTION_SCORE_MAX,
  SECTION_SCORE_MIN,
  SECTIONS,
  sectionQuestionCount,
  TEST_UPLOAD_KINDS,
  TIME_MULTIPLIERS,
  ANNOTATION_TARGETS,
  HIGHLIGHT_COLORS,
  MAX_ANNOTATIONS_PER_QUESTION,
  MAX_NOTE_LENGTH,
  PAID_PLANS,
  PRICING_PLAN_IDS,
  USER_PLANS,
  USER_REGIONS,
  USER_ROLES,
  USER_STATUSES,
  type AccessFeature,
  type Section,
} from "@satsharks/types";

// ---------- auth ----------

const emailSchema = z.string().trim().toLowerCase().email().max(254);
// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated.
const newPasswordSchema = z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters");

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCountryCode, "Choose your country from the list");

// Optional phone number: digits with an optional leading +, spaces and dashes allowed while typing.
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ""))
  .refine((value) => /^\+?\d{7,15}$/.test(value), "Enter a phone number like +92 300 1234567");

const optionalEmpty = (value: unknown) => (value === "" || value === null ? undefined : value);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  password: newPasswordSchema,
  country: countryCodeSchema,
  phone: z.preprocess(optionalEmpty, phoneSchema.optional()),
  // The student's own SAT date (proposal: "enters their real SAT date at sign-up"). YYYY-MM-DD.
  testDate: z.preprocess(optionalEmpty, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a test date").optional()),
  // A friend's invite code (from their link): the two become friends and the friend earns towards a free week.
  ref: z.preprocess(optionalEmpty, z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,12}$/).optional().catch(undefined)),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// The token is 32 random bytes in base64url (43 characters).
const resetTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This reset link is not valid");

export const resetTokenCheckSchema = z.object({ token: resetTokenSchema });

export const resetPasswordSchema = z.object({ token: resetTokenSchema, password: newPasswordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

// ---------- normalized import shapes (what the worker produces, what MongoDB stores) ----------

export const normalizedChoiceSchema = z.object({
  key: z.string().min(1),
  text: z.string(),
  viz: z.unknown().nullable(),
});

export const normalizedAssetSchema = z.object({
  kind: z.enum(["image"]),
  url: z.string().min(1),
  maxWidth: z.number().nullable(),
});

export const normalizedCorrectAnswerSchema = z.object({
  // Set for multiple choice.
  choiceKey: z.string().nullable(),
  // Set for student-produced responses; every accepted form of the answer.
  acceptedValues: z.array(z.string()),
});

export const normalizedQuestionSchema = z.object({
  source: z.string().min(1),
  sourceQuestionId: z.string().min(1),
  section: z.enum(SECTIONS),
  moduleNumber: z.union([z.literal(1), z.literal(2)]).nullable(),
  moduleType: z.enum(MODULE_TYPES),
  questionNumber: z.number().int().positive(),
  questionType: z.enum(QUESTION_TYPES),
  difficulty: z.enum(DIFFICULTIES).nullable(),
  topic: z.string().nullable(),
  skill: z.string().nullable(),
  prompt: z.string().min(1),
  passage: z.string().nullable(),
  choices: z.array(normalizedChoiceSchema),
  correctAnswer: normalizedCorrectAnswerSchema.nullable(),
  explanation: z.string().nullable(),
  assets: z.array(normalizedAssetSchema),
  viz: z.unknown().nullable(),
  sourceMetadata: z.record(z.unknown()),
});
export type NormalizedQuestion = z.infer<typeof normalizedQuestionSchema>;

export const normalizedModuleSchema = z.object({
  key: z.string().min(1),
  section: z.enum(SECTIONS),
  moduleNumber: z.union([z.literal(1), z.literal(2)]).nullable(),
  moduleType: z.enum(MODULE_TYPES),
  questionCount: z.number().int().nonnegative(),
  timeLimitSeconds: z.number().int().positive().nullable(),
});

export const normalizedPaperSchema = z.object({
  source: z.string().min(1),
  sourcePaperId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  status: z.enum(PAPER_STATUSES),
  sections: z.array(z.enum(SECTIONS)).min(1),
  modules: z.array(normalizedModuleSchema).min(1),
  adaptive: z.object({
    isAdaptive: z.boolean(),
    routing: z.enum(["server_side", "client_side", "unknown"]),
    observedRoute: z.enum(MODULE_TYPES).nullable(),
    module1Correct: z.number().int().nonnegative().nullable(),
    routingThreshold: z.number().nullable(),
  }),
  questionCount: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()),
  sourceMetadata: z.record(z.unknown()),
});
export type NormalizedPaper = z.infer<typeof normalizedPaperSchema>;

// ---------- practice ----------

export const createAttemptSchema = z.object({
  paperId: objectIdSchema,
  topics: z.array(z.string().min(1).max(100)).max(20).default([]),
  skills: z.array(z.string().min(1).max(100)).max(40).default([]),
  difficulty: z.enum(DIFFICULTIES).nullable().default(null),
  // null = every matching question, up to the server's cap.
  limit: z.number().int().min(1).max(200).nullable().default(null),
  timed: z.boolean().default(false),
  timeMinutes: z.number().int().min(1).max(600).nullable().default(null),
  excludeAnswered: z.boolean().default(false),
  name: z.string().trim().max(80).default(""),
});
export type CreateAttemptInput = z.infer<typeof createAttemptSchema>;

export const saveAnswerSchema = z
  .object({
    answer: z.string().trim().max(200).nullable().optional(),
    flagged: z.boolean().optional(),
  })
  .refine((value) => value.answer !== undefined || value.flagged !== undefined, "Nothing to save");
export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;

// The whole list of a question's highlights and notes, replaced on every change.
export const saveAnnotationsSchema = z.object({
  annotations: z
    .array(
      z
        .object({
          id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
          target: z.enum(ANNOTATION_TARGETS),
          start: z.number().int().min(0).max(100_000),
          end: z.number().int().min(1).max(100_000),
          color: z.enum(HIGHLIGHT_COLORS),
          underline: z.boolean().default(false),
          note: z.string().max(MAX_NOTE_LENGTH).default(""),
        })
        .refine((value) => value.end > value.start, "A highlight must cover at least one character"),
    )
    .max(MAX_ANNOTATIONS_PER_QUESTION),
});
export type SaveAnnotationsInput = z.infer<typeof saveAnnotationsSchema>;

export const positionSchema = z.coerce.number().int().min(1).max(1000);

const timeMultiplierSchema = z
  .number()
  .refine((value) => (TIME_MULTIPLIERS as readonly number[]).includes(value), "Extended time must be 1, 1.5 or 2")
  .default(1);

export const createMockSchema = z.object({
  section: z.enum(SECTIONS),
  // Exams to draw from. Empty = every published exam with that section.
  paperIds: z.array(objectIdSchema).max(100).default([]),
  // The official module countdown. Off = untimed.
  timed: z.boolean().default(true),
  // Extended-time accommodation (1.5× or 2× every module).
  timeMultiplier: timeMultiplierSchema,
  name: z.string().trim().max(80).default(""),
});
export type CreateMockInput = z.infer<typeof createMockSchema>;

// Both sections in one sitting: Reading & Writing, a break, then Math.
export const createFullTestSchema = z.object({
  // Exams to draw from, per section. Empty = every published exam with that section.
  paperIds: z
    .object({
      reading_writing: z.array(objectIdSchema).max(100).default([]),
      math: z.array(objectIdSchema).max(100).default([]),
    })
    .default({}),
  // An uploaded practice test to sit instead of questions drawn from the bank (paperIds ignored).
  testUploadId: objectIdSchema.optional(),
  timed: z.boolean().default(true),
  timeMultiplier: timeMultiplierSchema,
  name: z.string().trim().max(80).default(""),
});
export type CreateFullTestInput = z.infer<typeof createFullTestSchema>;

export const adaptiveSettingsSchema = z.object({
  routingThresholdPercent: z.number().int().min(1).max(100),
  // Older admin pages send only the threshold; the pattern then stays on.
  officialPattern: z.boolean().default(true),
});

// One raw-to-scaled table: entry n is the score for n correct. Scores only go up (or stay the same)
// as the raw count rises, and the Digital SAT reports them in steps of 10.
function conversionTableSchema(section: Section) {
  const entries = sectionQuestionCount(section) + 1;
  return z
    .array(z.number().int().min(SECTION_SCORE_MIN).max(SECTION_SCORE_MAX).multipleOf(10, "Scores go up in steps of 10"))
    .length(entries, `Enter exactly ${entries} scores (0 to ${entries - 1} correct)`)
    .refine((scores) => scores.every((score, index) => index === 0 || score >= scores[index - 1]!), "Scores must never go down as more answers are correct")
    .nullable();
}

export const conversionTablesSchema = z.object({
  reading_writing: z.object({ m2_easy: conversionTableSchema("reading_writing"), m2_hard: conversionTableSchema("reading_writing") }),
  math: z.object({ m2_easy: conversionTableSchema("math"), m2_hard: conversionTableSchema("math") }),
});

// ---------- problem reports ----------

export const createReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).default(""),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

export const reportListQuerySchema = z.object({
  status: z.preprocess((value) => (value === "" ? undefined : value), z.enum(REPORT_STATUSES).optional()),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const resolveReportSchema = z.object({
  note: z.string().trim().max(1000).default(""),
  // Also close every other pending report about the same question.
  includeSameQuestion: z.boolean().default(false),
});

export const reopenReportSchema = z.object({ note: z.string().trim().max(1000).default("") });

// ---------- admin ----------

export const paperStatusSchema = z.object({ status: z.enum(PAPER_STATUSES) });

export const bulkPaperStatusSchema = z.object({
  status: z.enum(PAPER_STATUSES),
  // Omit to apply to every paper.
  ids: z.array(objectIdSchema).min(1).max(500).optional(),
});

const optionalFilter = z.preprocess((value) => (value === "" ? undefined : value), z.string().max(100).optional());

export const questionListQuerySchema = z.object({
  section: z.preprocess((value) => (value === "" ? undefined : value), z.enum(SECTIONS).optional()),
  status: z.preprocess((value) => (value === "" ? undefined : value), z.enum(PAPER_STATUSES).optional()),
  // "none" selects questions with no difficulty.
  difficulty: z.preprocess((value) => (value === "" ? undefined : value), z.enum([...DIFFICULTIES, "none"]).optional()),
  topic: optionalFilter,
  skill: optionalFilter,
  paperId: z.preprocess((value) => (value === "" ? undefined : value), objectIdSchema.optional()),
  search: optionalFilter,
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type QuestionListQuery = z.infer<typeof questionListQuerySchema>;

export const updateQuestionSchema = z
  .object({
    difficulty: z.enum(DIFFICULTIES).nullable(),
    topic: z.string().trim().max(100).nullable(),
    skill: z.string().trim().max(100).nullable(),
    prompt: z.string().trim().min(1).max(20000),
    passage: z.string().max(20000).nullable(),
    explanation: z.string().max(20000).nullable(),
    correctAnswer: normalizedCorrectAnswerSchema.nullable(),
    // Multiple choice or student-produced response. Changing it needs matching choices and answer.
    questionType: z.enum(["mcq", "spr"]),
    // Choice texts in order. A figure drawn inside a choice is kept by its key. `image`: an image
    // for the choice (e.g. one of four graphs), by URL like `assets`; null removes it; left out keeps it.
    choices: z
      .array(z.object({ key: z.string().trim().min(1).max(2), text: z.string().max(4000), image: z.string().max(300).nullable().optional() }))
      .max(6),
    // Images, by URL: ones the question already has or ones uploaded through /admin/assets.
    assets: z.array(z.object({ url: z.string().max(300), maxWidth: z.number().int().min(40).max(1200).nullable() })).max(5),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

// ---------- admin: uploaded practice tests ----------

// Multipart form fields arrive as strings. A practice test needs a year and a test number; an exam
// needs its date (its year comes from the date, its number is assigned by the server).
export const testUploadMetaSchema = z
  .object({
    kind: z.enum(TEST_UPLOAD_KINDS).default("practice"),
    title: z.string().trim().min(1, "Enter a title").max(120),
    year: z.coerce.number().int("Year must be a whole number").min(2000, "Year must be 2000–2100").max(2100, "Year must be 2000–2100").optional(),
    testNumber: z.coerce.number().int("Test number must be a whole number").min(1, "Test number must be 1 or more").max(100000).optional(),
    examDate: z
      .string()
      .regex(/^(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Enter the exam date")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "exam") {
      if (!value.examDate) ctx.addIssue({ code: "custom", path: ["examDate"], message: "Enter the exam date" });
      return;
    }
    if (value.year === undefined) ctx.addIssue({ code: "custom", path: ["year"], message: "Enter the year" });
    if (value.testNumber === undefined) ctx.addIssue({ code: "custom", path: ["testNumber"], message: "Enter the test number" });
  });
export type TestUploadMetaInput = z.infer<typeof testUploadMetaSchema>;

export const uploadSectionParamSchema = z.enum(SECTIONS);

const uploadQuestionSchema = z.object({
  module: z.enum(["m1", "m2_easy", "m2_hard"]),
  questionType: z.enum(["mcq", "spr"]),
  difficulty: z.enum(DIFFICULTIES),
  topic: z.string().trim().max(100),
  skill: z.string().trim().max(100).nullable(),
  passage: z.string().max(20000).nullable(),
  prompt: z.string().max(20000),
  choices: z.array(z.object({ key: z.string().max(1), text: z.string().max(4000) })).max(4),
  choiceKey: z.string().max(1).nullable(),
  acceptedValues: z.array(z.string().trim().max(20)).max(10),
  explanation: z.string().max(20000),
});

// The reviewed questions of one section, in order; they are renumbered per module on save.
export const saveUploadSectionSchema = z.object({ questions: z.array(uploadQuestionSchema).min(1).max(300) });
export type SaveUploadSectionInput = z.infer<typeof saveUploadSectionSchema>;

export const testUploadActiveSchema = z.object({ active: z.boolean() });

// ---------- admin: pricing ----------

const shortText = (max: number) => z.string().trim().min(1, "Fill in every field").max(max);
const perCurrency = (max: number) => z.object({ PKR: shortText(max), USD: shortText(max) });

// The three plans, in their fixed order; only their wording and prices change.
export const pricingContentSchema = z.object({
  plans: z
    .array(
      z.object({
        id: z.enum(PRICING_PLAN_IDS),
        name: shortText(40),
        price: perCurrency(30),
        period: shortText(40),
        saving: perCurrency(30).nullable(),
        highlights: z.array(shortText(120)).min(1, "Give every plan at least one point").max(8),
        popular: z.boolean(),
      }),
    )
    .length(PRICING_PLAN_IDS.length)
    .refine((plans) => plans.every((plan, index) => plan.id === PRICING_PLAN_IDS[index]), "The plans must stay in their fixed order")
    .refine((plans) => plans.filter((plan) => plan.popular).length <= 1, "Mark at most one plan as most popular"),
  comparison: z.array(z.object({ feature: shortText(80), free: shortText(60), paid: shortText(60) })).max(20),
  tagline: z.string().trim().max(200),
  schoolsNote: z.string().trim().max(200),
  refundPolicy: z.string().trim().max(200),
});

// ---------- admin: SAT test dates ----------

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter dates as YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), "That date does not exist");

// Saved in date order, one entry per test day, each deadline before its test day.
export const satDatesContentSchema = z.object({
  dates: z
    .array(
      z
        .object({
          date: calendarDay,
          registrationDeadline: calendarDay,
          lateDeadline: calendarDay.nullable(),
          note: z.string().trim().max(160),
        })
        .refine((entry) => entry.registrationDeadline < entry.date, { message: "The registration deadline must be before the test day" })
        .refine((entry) => entry.lateDeadline === null || (entry.lateDeadline >= entry.registrationDeadline && entry.lateDeadline < entry.date), {
          message: "The late deadline must be between the registration deadline and the test day",
        }),
    )
    .max(40)
    .refine((dates) => new Set(dates.map((entry) => entry.date)).size === dates.length, "Each test day can be listed only once")
    .transform((dates) => [...dates].sort((a, b) => a.date.localeCompare(b.date))),
});

// ---------- admin: access by plan ----------

const accessLevelSchema = z.enum(ACCESS_LEVELS);

// A feature added later (e.g. "analytics") is missing from settings saved before it existed: it is
// read as free rather than throwing the whole saved setting away.
const featureLevelSchema = accessLevelSchema.default("free");

// Invite codes: 4–24 letters, digits or dashes, compared without case.
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{4,24}$/, "Invite codes are 4 to 24 letters, digits or dashes");

// Rules saved before invite codes, pins and labels existed have only key and level.
const contentRuleSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    level: z.enum(CONTENT_ACCESS_LEVELS),
    inviteCode: inviteCodeSchema.nullable().default(null),
    pinned: z.boolean().default(false),
    label: z.enum(CONTENT_LABELS).nullable().default(null),
  })
  .refine((rule) => rule.level !== "invite" || rule.inviteCode !== null, { message: "Give every invite-only exam or test an invite code" });

export const accessSettingsSchema = z.object({
  features: z.object(Object.fromEntries(ACCESS_FEATURES.map((feature) => [feature, featureLevelSchema])) as Record<AccessFeature, typeof featureLevelSchema>),
  content: z
    .array(contentRuleSchema)
    .max(2000)
    .refine((rules) => new Set(rules.map((rule) => rule.key)).size === rules.length, "Each exam may appear only once")
    .refine((rules) => {
      const codes = rules.filter((rule) => rule.level === "invite").map((rule) => rule.inviteCode);
      return new Set(codes).size === codes.length;
    }, "Each invite-only exam or test needs its own invite code"),
  newContent: accessLevelSchema,
  freeDrillQuestionsPerDay: z.number().int().min(1, "Allow at least 1 drill question a day, or leave it empty").max(1000).nullable().default(null),
});

export const redeemInviteSchema = z.object({ code: inviteCodeSchema });

// ---------- admin: announcements ----------

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(120),
  message: z.string().trim().min(1, "Enter the message").max(2000),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  tone: z.enum(ANNOUNCEMENT_TONES),
  active: z.boolean(),
  endsAt: z.string().datetime({ message: "Choose a valid end time" }).nullable(),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

// ---------- admin: users ----------

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const userListQuerySchema = z.object({
  search: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  // "paid" / "free" use the effective plan (an expired paid plan counts as free).
  plan: z.preprocess(emptyToUndefined, z.enum(USER_PLANS).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(USER_STATUSES).optional()),
  region: z.preprocess(emptyToUndefined, z.enum([...USER_REGIONS, "unknown"]).optional()),
  role: z.preprocess(emptyToUndefined, z.enum(USER_ROLES).optional()),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const updateUserSchema = z
  .object({
    plan: z.enum(USER_PLANS),
    paidPlan: z.enum(PAID_PLANS).nullable(),
    // ISO date (YYYY-MM-DD); null = no end date.
    planExpiresAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31")
      .nullable(),
    status: z.enum(USER_STATUSES),
    role: z.enum(USER_ROLES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// One action on many users from Admin → Users: the ticked accounts (`ids`), or every account that
// matches the list's filters (`filter`, "select all N").
export const BULK_USER_ACTIONS = ["delete", "restore", "purge"] as const;
export type BulkUserAction = (typeof BULK_USER_ACTIONS)[number];
export const bulkUsersSchema = z
  .object({
    action: z.enum(BULK_USER_ACTIONS),
    ids: z.array(objectIdSchema).min(1).max(500).optional(),
    filter: userListQuerySchema.omit({ page: true, pageSize: true }).optional(),
  })
  .refine((value) => (value.ids ? !value.filter : !!value.filter), "Send either the ticked accounts or the filters");
export type BulkUsersInput = z.infer<typeof bulkUsersSchema>;

// ---------- Week 3: history, mistakes, drills from the whole bank, goals, leaderboard ----------

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-05");

// A drill drawn from every exam the account can open, by topic/skill (drill mode, insight buttons).
export const bankDrillSchema = z.object({
  section: z.enum(SECTIONS),
  topics: z.array(z.string().min(1).max(100)).max(20).default([]),
  skills: z.array(z.string().min(1).max(100)).max(40).default([]),
  difficulty: z.enum(DIFFICULTIES).nullable().default(null),
  count: z.number().int().min(1).max(100).default(20),
  timed: z.boolean().default(false),
  timeMinutes: z.number().int().min(1).max(600).nullable().default(null),
  excludeAnswered: z.boolean().default(false),
  name: z.string().trim().max(80).default(""),
});
export type BankDrillInput = z.infer<typeof bankDrillSchema>;

// Retry the mistakes that are due, one section at a time.
export const retryDrillSchema = z.object({
  section: z.enum(SECTIONS),
  count: z.number().int().min(1).max(50).default(20),
});
export type RetryDrillInput = z.infer<typeof retryDrillSchema>;

export const questionHistoryQuerySchema = z.object({
  result: z.preprocess(emptyToUndefined, z.enum(["correct", "wrong", "skipped"]).optional()),
  section: z.preprocess(emptyToUndefined, z.enum(SECTIONS).optional()),
  topic: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  difficulty: z.preprocess(emptyToUndefined, z.enum(DIFFICULTIES).optional()),
  from: z.preprocess(emptyToUndefined, dayString.optional()),
  to: z.preprocess(emptyToUndefined, dayString.optional()),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type QuestionHistoryQuery = z.infer<typeof questionHistoryQuerySchema>;

export const mistakeQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(["open", "due", "fixed"]).optional()),
  section: z.preprocess(emptyToUndefined, z.enum(SECTIONS).optional()),
});
export type MistakeQuery = z.infer<typeof mistakeQuerySchema>;

// IANA time zone, checked by Intl (an unknown zone throws).
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");

export const engagementSettingsSchema = z
  .object({
    targetScore: z.number().int().min(400).max(1600).nullable(),
    testDate: dayString.nullable(),
    goalType: z.enum(GOAL_TYPES),
    goalAmount: z.number().int().min(5).max(300).nullable(),
    timeZone: timeZoneSchema,
    showOnLeaderboard: z.boolean(),
    streakReminders: z.boolean(),
    weeklyEmail: z.boolean(),
  })
  .partial()
  .refine((value) => value.targetScore == null || value.targetScore % 10 === 0, "SAT scores go up in steps of 10");
export type EngagementSettingsInput = z.infer<typeof engagementSettingsSchema>;

export const leaderboardQuerySchema = z.object({
  scope: z.enum(LEADERBOARD_SCOPES).default("global"),
  period: z.enum(LEADERBOARD_PERIODS).default("week"),
});

// Accounts made before sign-up asked for a country add it once (for the "My country" board).
export const setCountrySchema = z.object({ country: countryCodeSchema });

export const friendCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,10}$/, "Friend codes are 6 to 10 letters and numbers"),
});

// ---------- Week 4: scheduling, payments, billing ----------

// A moment (ISO date-time) to publish a paper or activate a test by itself; null clears it.
export const scheduleSchema = z.object({ at: z.string().datetime({ offset: true, message: "Choose a valid date and time" }).nullable() });

const paidPlanSchema = z.enum(PAID_PLANS);

export const checkoutQuerySchema = z.object({
  plan: paidPlanSchema,
  currency: z.enum(CURRENCIES).optional(),
  // Use the one-time exit offer if this account still has it.
  offer: z.preprocess((value) => value === "1" || value === "true" || value === true, z.boolean()).default(false),
});
export type CheckoutQuery = z.infer<typeof checkoutQuerySchema>;

// A transfer the student has made outside the site, sent for approval.
export const manualPaymentSchema = z.object({
  plan: paidPlanSchema,
  currency: z.enum(CURRENCIES),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: z.string().trim().min(4, "Enter the transaction ID or reference from your receipt").max(80),
  note: z.string().trim().max(500).default(""),
  offer: z.boolean().default(false),
});
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;

export const cardCheckoutSchema = z.object({ plan: paidPlanSchema, currency: z.enum(CURRENCIES), offer: z.boolean().default(false) });
export type CardCheckoutInput = z.infer<typeof cardCheckoutSchema>;

export const autoRenewSchema = z.object({ autoRenew: z.boolean() });

export const paymentReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).default(""),
});

export const paymentListQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, z.enum(PAYMENT_STATUSES).optional()),
  currency: z.preprocess(emptyToUndefined, z.enum(CURRENCIES).optional()),
  search: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

const manualMethodSchema = z.object({
  enabled: z.boolean(),
  instructions: z.string().trim().max(600),
  currencies: z.array(z.enum(CURRENCIES)).min(1, "Choose at least one currency for each way to pay"),
});

export const paymentSettingsSchema = z
  .object({
    manual: z.object(Object.fromEntries(MANUAL_PAYMENT_METHODS.map((method) => [method, manualMethodSchema])) as Record<(typeof MANUAL_PAYMENT_METHODS)[number], typeof manualMethodSchema>),
    alertEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid alert email").max(254)]),
    exitOffer: z.object({
      enabled: z.boolean(),
      percentOff: z.number().int().min(5, "The offer is 5% to 50% off").max(50, "The offer is 5% to 50% off"),
      headline: z.string().trim().min(1, "Write the offer's headline").max(120),
    }),
    referrals: z.object({ enabled: z.boolean() }),
  })
  .refine((settings) => Object.values(settings.manual).every((method) => !method.enabled || method.instructions.length >= 10), {
    message: "Write the account details for every way to pay that is turned on",
  });
