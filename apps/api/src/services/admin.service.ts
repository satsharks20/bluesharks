import { createHash } from "node:crypto";
import { AssetModel, AttemptModel, contentKeyOf, FullTestModel, PaperModel, ProblemReportModel, QuestionModel, trusted, UserModel, type PaperDoc, type QuestionDoc } from "@satsharks/db";
import {
  FULL_TEST_QUESTION_TAG,
  PAPER_STATUSES,
  UPLOAD_SOURCES,
  UPLOADED_EXAM_QUESTION_TAG,
  SECTIONS,
  type AdminQuestion,
  type AdminStats,
  type CatalogTopic,
  type PaperStatus,
  type Section,
  type UserRegion,
} from "@satsharks/types";
import type { QuestionListQuery, UpdateQuestionInput } from "@satsharks/validation";
import { AppError } from "../utils/app-error";
import { startOfLocalDay } from "./engagement-rules";
import { paymentService } from "./payment.service";
import { invalidateCatalog } from "./practice.service";
import { userAdminService, visible } from "./user-admin.service";

// "Today" on the admin dashboard is the day in Pakistan.
const ADMIN_TIME_ZONE = "Asia/Karachi";

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ASSET_URL = /^\/api\/assets\/([a-f0-9]{32}\.(?:svg|png|jpg|webp))$/;

// New image URLs on a question must be images stored here (uploaded through /admin/assets).
async function requireUploaded(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  const keys = urls.map((url) => ASSET_URL.exec(url)?.[1]);
  const named = keys.filter((key): key is string => !!key);
  const stored = new Set((await AssetModel.find({ key: trusted({ $in: named }) }).select("key").lean<{ key: string }[]>()).map((asset) => asset.key));
  if (keys.some((key) => !key || !stored.has(key))) throw AppError.badRequest("Upload the image again; it was not found");
}

// The URL of an image set as an answer choice's figure, or null for any other figure.
const choiceImage = (viz: unknown): string | null =>
  typeof viz === "object" && viz !== null && (viz as { type?: unknown }).type === "image" && typeof (viz as { url?: unknown }).url === "string" ? (viz as { url: string }).url : null;

// The image type from the file's first bytes; the browser's claimed type is not trusted.
function imageType(data: Buffer): { ext: "png" | "jpg" | "webp"; contentType: string } | null {
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", contentType: "image/png" };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: "jpg", contentType: "image/jpeg" };
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", contentType: "image/webp" };
  return null;
}

function toAdminQuestion(question: QuestionDoc, paperTitle: string | null): AdminQuestion {
  return {
    id: String(question._id),
    paperId: String(question.paperId),
    paperTitle,
    testUploadId: typeof question.sourceMetadata?.testUploadId === "string" ? question.sourceMetadata.testUploadId : null,
    sourceQuestionId: question.sourceQuestionId,
    section: question.section,
    moduleType: question.moduleType,
    questionNumber: question.questionNumber,
    questionType: question.questionType,
    difficulty: question.difficulty,
    topic: question.topic,
    skill: question.skill,
    status: question.status,
    prompt: question.prompt,
    passage: question.passage,
    choices: question.choices.map((choice) => ({ key: choice.key, text: choice.text, viz: choice.viz ?? null })),
    assets: question.assets.map((asset) => ({ kind: asset.kind, url: asset.url, maxWidth: asset.maxWidth })),
    viz: question.viz ?? null,
    correctAnswer: question.correctAnswer ?? null,
    explanation: question.explanation ?? null,
  };
}

async function countBy<T extends string>(model: typeof PaperModel | typeof QuestionModel, field: string, keys: readonly T[]) {
  const rows = await (model as typeof QuestionModel).aggregate<{ _id: T; n: number }>([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const row of rows) if (row._id in result) result[row._id] = row.n;
  return result;
}

export const adminService = {
  async stats(): Promise<AdminStats> {
    const [users, regions, papers, questions, questionsBySection, attempts, pendingReports, resolvedReports] = await Promise.all([
      // Hidden developer accounts are not counted (see UserDoc.hidden).
      UserModel.countDocuments(visible()),
      UserModel.aggregate<{ _id: UserRegion | null; n: number }>([{ $match: { hidden: { $ne: true } } }, { $group: { _id: "$region", n: { $sum: 1 } } }]),
      countBy(PaperModel, "status", PAPER_STATUSES),
      countBy(QuestionModel, "status", PAPER_STATUSES),
      countBy(QuestionModel, "section", SECTIONS),
      AttemptModel.estimatedDocumentCount(),
      ProblemReportModel.countDocuments({ status: "pending" }),
      ProblemReportModel.countDocuments({ status: "resolved" }),
    ]);
    const now = new Date();
    const today = startOfLocalDay(now, ADMIN_TIME_ZONE);
    const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
    const [paidUsers, signupsToday, signupsWeek, drillsToday, mocksToday, fullTestsToday, revenue, payments] = await Promise.all([
      userAdminService.paidCount(),
      UserModel.countDocuments({ ...visible(), role: "student", createdAt: trusted({ $gte: today }) }),
      UserModel.countDocuments({ ...visible(), role: "student", createdAt: trusted({ $gte: weekAgo }) }),
      AttemptModel.countDocuments({ kind: "drill", createdAt: trusted({ $gte: today }) }),
      AttemptModel.countDocuments({ kind: "mock", fullTestId: null, createdAt: trusted({ $gte: today }) }),
      FullTestModel.countDocuments({ createdAt: trusted({ $gte: today }) }),
      paymentService.revenue(now),
      paymentService.counts(),
    ]);
    const usersByRegion: AdminStats["usersByRegion"] = { local: 0, international: 0, unknown: 0 };
    for (const row of regions) usersByRegion[row._id ?? "unknown"] += row.n;
    return {
      users,
      usersByRegion,
      paidUsers,
      reports: { pending: pendingReports, resolved: resolvedReports },
      papers,
      questions,
      questionsBySection,
      attempts,
      signups: { today: signupsToday, week: signupsWeek },
      practiceToday: { drills: drillsToday, mocks: mocksToday, fullTests: fullTestsToday },
      revenue,
      payments,
    };
  },

  // A paper's questions always share its status: students only ever query published questions.
  // Uploaded practice tests are left out: they are shown or hidden only by activating them on their
  // own page, where the six modules are checked first.
  async setPaperStatus(status: PaperStatus, ids?: string[]): Promise<{ papers: number; questions: number }> {
    if (ids && (await PaperModel.exists({ _id: trusted({ $in: ids }), source: trusted({ $in: UPLOAD_SOURCES }) }))) {
      throw AppError.badRequest("This paper belongs to an uploaded test. Activate or deactivate the test under Full tests.");
    }
    const paperFilter = ids ? { _id: trusted({ $in: ids }) } : { source: trusted({ $nin: UPLOAD_SOURCES }) };
    const questionFilter = ids ? { paperId: trusted({ $in: ids }) } : { tags: trusted({ $nin: [FULL_TEST_QUESTION_TAG, UPLOADED_EXAM_QUESTION_TAG] }) };
    // A paper published or hidden by hand loses any schedule.
    const papers = await PaperModel.updateMany(paperFilter, { $set: { status, publishAt: null } });
    if (ids && papers.matchedCount === 0) throw AppError.notFound("Paper not found");
    const questions = await QuestionModel.updateMany(questionFilter, { $set: { status } });
    invalidateCatalog();
    return { papers: papers.matchedCount, questions: questions.matchedCount };
  },

  // Publishes a draft or hidden paper by itself at `at` (proposal 4.2); null clears the schedule.
  async setPaperSchedule(id: string, at: Date | null): Promise<{ publishAt: string | null }> {
    const paper = await PaperModel.findById(id).select("status source").lean<PaperDoc>();
    if (!paper) throw AppError.notFound("Paper not found");
    if ((UPLOAD_SOURCES as string[]).includes(paper.source)) throw AppError.badRequest("This paper belongs to an uploaded test. Schedule the test under Full tests.");
    if (at && paper.status === "published") throw AppError.badRequest("This paper is already published.");
    if (at && at.getTime() <= Date.now()) throw AppError.badRequest("Choose a time in the future.");
    await PaperModel.updateOne({ _id: id }, { $set: { publishAt: at } });
    return { publishAt: at ? at.toISOString() : null };
  },

  // Called by the scheduler: publishes the papers whose time has come.
  async publishDue(now: Date): Promise<number> {
    const due = await PaperModel.find({ status: trusted({ $ne: "published" }), publishAt: trusted({ $ne: null, $lte: now }), source: trusted({ $nin: UPLOAD_SOURCES }) })
      .select("_id")
      .lean<PaperDoc[]>();
    if (due.length === 0) return 0;
    const result = await this.setPaperStatus("published", due.map((paper) => String(paper._id)));
    return result.papers;
  },

  // Topic and skill values present in the bank, for the filter dropdowns.
  async facets(): Promise<Record<Section, CatalogTopic[]>> {
    const rows = await QuestionModel.aggregate<{ _id: { section: Section; topic: string | null; skill: string | null } }>([
      { $group: { _id: { section: "$section", topic: "$topic", skill: "$skill" } } },
    ]);
    const facets = Object.fromEntries(SECTIONS.map((section) => [section, [] as CatalogTopic[]])) as Record<Section, CatalogTopic[]>;
    for (const { _id } of rows) {
      if (!_id.topic) continue;
      let topic = facets[_id.section].find((entry) => entry.topic === _id.topic);
      if (!topic) facets[_id.section].push((topic = { topic: _id.topic, skills: [] }));
      if (_id.skill && !topic.skills.includes(_id.skill)) topic.skills.push(_id.skill);
    }
    for (const section of SECTIONS) {
      facets[section].sort((a, b) => a.topic.localeCompare(b.topic));
      for (const topic of facets[section]) topic.skills.sort((a, b) => a.localeCompare(b));
    }
    return facets;
  },

  async listQuestions(query: QuestionListQuery): Promise<{ questions: AdminQuestion[]; total: number; page: number; pageSize: number }> {
    const filter: Record<string, unknown> = {};
    if (query.section) filter.section = query.section;
    if (query.status) filter.status = query.status;
    if (query.topic) filter.topic = query.topic;
    if (query.skill) filter.skill = query.skill;
    if (query.paperId) filter.paperId = query.paperId;
    if (query.difficulty) filter.difficulty = query.difficulty === "none" ? null : query.difficulty;
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), "i");
      // Searches the question text, the passage and the source ID.
      filter.$or = trusted([{ prompt: pattern }, { passage: pattern }, { sourceQuestionId: query.search }]);
    }

    const [total, questions] = await Promise.all([
      QuestionModel.countDocuments(filter),
      QuestionModel.find(filter)
        .select("+correctAnswer +explanation")
        .sort({ paperId: 1, questionNumber: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<QuestionDoc[]>(),
    ]);
    const papers = await PaperModel.find({ _id: trusted({ $in: [...new Set(questions.map((q) => String(q.paperId)))] }) })
      .select("title")
      .lean<PaperDoc[]>();
    const titles = new Map(papers.map((paper) => [String(paper._id), paper.title]));
    return {
      questions: questions.map((question) => toAdminQuestion(question, titles.get(String(question.paperId)) ?? null)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  },

  async getQuestion(id: string): Promise<AdminQuestion> {
    const question = await QuestionModel.findById(id).select("+correctAnswer +explanation").lean<QuestionDoc>();
    if (!question) throw AppError.notFound("Question not found");
    const paper = await PaperModel.findById(question.paperId).select("title").lean<PaperDoc>();
    return toAdminQuestion(question, paper?.title ?? null);
  },

  async updateQuestion(id: string, input: UpdateQuestionInput): Promise<AdminQuestion> {
    const question = await QuestionModel.findById(id).select("+correctAnswer").lean<QuestionDoc>();
    if (!question) throw AppError.notFound("Question not found");
    const { choices: choiceInput, assets: assetInput, ...rest } = input;
    const set: Record<string, unknown> = { ...rest };

    const questionType = input.questionType ?? question.questionType;
    let choices = question.choices;
    if (questionType !== "mcq") {
      choices = [];
    } else if (choiceInput) {
      // Texts come from the editor; a figure drawn inside a choice stays with its key, unless the
      // editor sets or removes an image for that choice.
      const figures = new Map(question.choices.map((choice) => [choice.key, choice.viz ?? null]));
      const imageUrls = choiceInput.map((choice) => choice.image).filter((url): url is string => !!url && !question.choices.some((old) => choiceImage(old.viz) === url));
      await requireUploaded(imageUrls);
      choices = choiceInput.map((choice) => {
        const old = figures.get(choice.key) ?? null;
        const viz = choice.image === undefined ? old : choice.image === null ? (choiceImage(old) ? null : old) : { type: "image", url: choice.image };
        return { key: choice.key, text: choice.text, viz };
      });
    }
    if (questionType === "mcq" && choices.length < 2) throw AppError.badRequest("A multiple-choice question needs at least two choices");
    const empty = choices.filter((choice) => !choice.text.trim() && !choice.viz).map((choice) => choice.key);
    if (questionType === "mcq" && empty.length > 0) {
      throw AppError.badRequest(`Choice ${empty.join(", ")} ${empty.length === 1 ? "is" : "are"} empty: type the answer or add an image for ${empty.length === 1 ? "it" : "each"}`);
    }
    if (choiceInput || input.questionType) set.choices = choices;

    const key = input.correctAnswer === undefined ? question.correctAnswer : input.correctAnswer;
    if (key && questionType === "mcq" && !choices.some((choice) => choice.key === key.choiceKey)) {
      throw AppError.badRequest("The correct answer must be one of the question's choices");
    }
    if (key && questionType !== "mcq" && key.acceptedValues.length === 0) {
      throw AppError.badRequest("Enter at least one accepted answer");
    }
    if (input.questionType && input.questionType !== question.questionType && input.correctAnswer === undefined) {
      throw AppError.badRequest("Set the correct answer for the new question type");
    }

    if (assetInput) {
      const current = new Set(question.assets.map((asset) => asset.url));
      await requireUploaded(assetInput.map((asset) => asset.url).filter((url) => !current.has(url)));
      const sources = new Map(question.assets.map((asset) => [asset.url, asset.sourceUrl ?? null]));
      set.assets = assetInput.map((asset) => ({ kind: "image", url: asset.url, maxWidth: asset.maxWidth, sourceUrl: sources.get(asset.url) ?? null }));
    }

    // The fingerprint follows what students see, so an edited question stops matching its old twin.
    set.contentKey = contentKeyOf({
      prompt: (set.prompt as string | undefined) ?? question.prompt,
      passage: set.passage !== undefined ? (set.passage as string | null) : question.passage,
      choices: (set.choices as QuestionDoc["choices"] | undefined) ?? question.choices,
      assets: (set.assets as QuestionDoc["assets"] | undefined) ?? question.assets,
      viz: set.viz !== undefined ? set.viz : question.viz,
    });
    await QuestionModel.updateOne({ _id: id }, { $set: set });
    invalidateCatalog();
    return this.getQuestion(id);
  },

  // A question image uploaded from the editor. Stored like the copied source images (content
  // addressed, so the same file twice is stored once) and attached when the question is saved.
  async uploadImage(file: { buffer: Buffer; size: number }): Promise<{ url: string }> {
    const type = imageType(file.buffer);
    if (!type) throw AppError.badRequest("Use a PNG, JPEG or WebP image");
    const key = `${createHash("sha256").update(file.buffer).digest("hex").slice(0, 32)}.${type.ext}`;
    if (!(await AssetModel.exists({ key }))) {
      try {
        await AssetModel.create({ key, sourceUrl: `upload:${key}`, contentType: type.contentType, size: file.size, data: file.buffer });
      } catch (error) {
        // The same image uploaded twice at once.
        if ((error as { code?: unknown }).code !== 11000) throw error;
      }
    }
    return { url: `/api/assets/${key}` };
  },

  async deleteQuestion(id: string): Promise<void> {
    const question = await QuestionModel.findByIdAndDelete(id).lean<QuestionDoc>();
    if (!question) throw AppError.notFound("Question not found");
    // Keep the paper's counts true.
    const remaining = await QuestionModel.countDocuments({ paperId: question.paperId, moduleType: question.moduleType });
    await PaperModel.updateOne(
      { _id: question.paperId },
      { $inc: { questionCount: -1 }, $set: { "modules.$[module].questionCount": remaining } },
      { arrayFilters: [{ "module.moduleType": question.moduleType, "module.section": question.section }] },
    );
    invalidateCatalog();
  },
};
