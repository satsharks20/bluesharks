// "Report a problem": students flag a question they think is wrong; staff work through the queue,
// fix the question in place and resolve the report. Reports are never deleted; every status change
// is appended to the report's history.
import {
  AttemptModel,
  PaperModel,
  ProblemReportModel,
  QuestionModel,
  trusted,
  UserModel,
  type AttemptDoc,
  type PaperDoc,
  type ProblemReportDoc,
  type QuestionDoc,
  type ReportEvent,
  type UserDoc,
} from "@satsharks/db";
import type { AdminQuestion, AdminReport, ReportStatus } from "@satsharks/types";
import type { CreateReportInput } from "@satsharks/validation";
import mongoose from "mongoose";
import { AppError } from "../utils/app-error";
import { adminService } from "./admin.service";
import { emailService } from "./email.service";
import { practiceService } from "./practice.service";

// Beyond the hourly rate limit, a ceiling on what one student can have waiting at once.
const MAX_PENDING_PER_USER = 50;

function toAdminReports(
  reports: ProblemReportDoc[],
  related: { questions: QuestionDoc[]; papers: PaperDoc[]; users: UserDoc[]; attempts: AttemptDoc[] },
): AdminReport[] {
  const questions = new Map(related.questions.map((question) => [String(question._id), question]));
  const papers = new Map(related.papers.map((paper) => [String(paper._id), paper.title]));
  const users = new Map(related.users.map((user) => [String(user._id), user]));
  const attempts = new Map(related.attempts.map((attempt) => [String(attempt._id), attempt]));

  return reports.map((report) => {
    const question = questions.get(String(report.questionId));
    const reporter = users.get(String(report.userId));
    const attempt = report.attemptId ? attempts.get(String(report.attemptId)) : undefined;
    return {
      id: String(report._id),
      status: report.status,
      reason: report.reason,
      details: report.details,
      questionId: String(report.questionId),
      question: question
        ? {
            sourceQuestionId: question.sourceQuestionId,
            section: question.section,
            prompt: question.prompt,
            paperTitle: papers.get(String(question.paperId)) ?? null,
          }
        : null,
      reporter: reporter ? { id: String(reporter._id), name: reporter.name, email: reporter.email } : null,
      context: {
        attemptId: report.attemptId ? String(report.attemptId) : null,
        attemptName: attempt?.name ?? null,
        kind: report.attemptKind,
        position: report.position,
      },
      history: report.history.map((event) => ({
        action: event.action,
        at: event.at.toISOString(),
        byName: event.by ? (users.get(String(event.by))?.name ?? null) : null,
        note: event.note,
        questionEdited: event.questionEdited,
      })),
      createdAt: report.createdAt.toISOString(),
      resolvedAt: report.resolvedAt ? report.resolvedAt.toISOString() : null,
    };
  });
}

// Loads everything the admin views show next to a set of reports, in four queries.
async function withRelated(reports: ProblemReportDoc[]): Promise<AdminReport[]> {
  const ids = <T>(values: (T | null | undefined)[]) => [...new Set(values.filter((value): value is T => value != null).map(String))];
  const questionIds = ids(reports.map((report) => report.questionId));
  const userIds = ids(reports.flatMap((report) => [report.userId, ...report.history.map((event) => event.by)]));
  const attemptIds = ids(reports.map((report) => report.attemptId));
  const [questions, users, attempts] = await Promise.all([
    QuestionModel.find({ _id: trusted({ $in: questionIds }) }).select("sourceQuestionId section prompt paperId").lean<QuestionDoc[]>(),
    UserModel.find({ _id: trusted({ $in: userIds }) }).select("name email").lean<UserDoc[]>(),
    AttemptModel.find({ _id: trusted({ $in: attemptIds }) }).select("name").lean<AttemptDoc[]>(),
  ]);
  const papers = await PaperModel.find({ _id: trusted({ $in: ids(questions.map((question) => question.paperId)) }) })
    .select("title")
    .lean<PaperDoc[]>();
  return toAdminReports(reports, { questions, papers, users, attempts });
}

async function tellStudents(userIds: string[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const id of userIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const users = await UserModel.find({ _id: trusted({ $in: [...counts.keys()] }), status: trusted({ $ne: "deleted" }) })
    .select("name email")
    .lean<UserDoc[]>();
  await Promise.all(
    users.map((user) => {
      const count = counts.get(String(user._id)) ?? 1;
      return emailService.sendNotice(user.email, {
        subject: count === 1 ? "Your problem report was handled" : "Your problem reports were handled",
        greeting: `Hi ${user.name},`,
        lines: [
          count === 1
            ? "The problem report you sent about a practice question has been reviewed and handled."
            : `${count} problem reports you sent about practice questions have been reviewed and handled.`,
          "Thank you for helping us improve LUE SAT.",
        ],
      });
    }),
  );
}

async function resolveTargets(targets: ProblemReportDoc[], adminId: string, note: string, notify: boolean): Promise<number> {
  const questionIds = [...new Set(targets.map((target) => String(target.questionId)))];
  const questions = await QuestionModel.find({ _id: trusted({ $in: questionIds }) })
    .select("updatedAt")
    .lean<(QuestionDoc & { updatedAt: Date })[]>();
  const updated = new Map(questions.map((question) => [String(question._id), question.updatedAt]));
  const now = new Date();
  const resolvedUserIds: string[] = [];

  // A bounded batch keeps a large "resolve all" request from opening thousands of database
  // operations at once, while each status check still makes concurrent admins safe.
  for (let offset = 0; offset < targets.length; offset += 50) {
    const batch = targets.slice(offset, offset + 50);
    const results = await Promise.all(
      batch.map((target) => {
        const event: ReportEvent = {
          action: "resolved",
          at: now,
          by: new mongoose.Types.ObjectId(adminId),
          note: note || null,
          questionEdited: (updated.get(String(target.questionId))?.getTime() ?? 0) > target.createdAt.getTime(),
        };
        return ProblemReportModel.findOneAndUpdate(
          { _id: target._id, status: "pending" },
          { $set: { status: "resolved", resolvedAt: now, resolvedBy: event.by }, $push: { history: event } },
          { new: true },
        )
          .select("userId")
          .lean<ProblemReportDoc | null>();
      }),
    );
    for (const result of results) if (result) resolvedUserIds.push(String(result.userId));
  }

  if (notify && resolvedUserIds.length > 0) await tellStudents(resolvedUserIds);
  return resolvedUserIds.length;
}

export const reportService = {
  async create(userId: string, attemptId: string, position: number, input: CreateReportInput): Promise<{ id: string }> {
    const { attempt, item } = await practiceService.locateQuestion(userId, attemptId, position);
    const question = await QuestionModel.findById(item.questionId).select("paperId section").lean<QuestionDoc>();
    if (!question) throw AppError.notFound("This question is no longer available");

    const pending = await ProblemReportModel.countDocuments({ userId, status: "pending" });
    if (pending >= MAX_PENDING_PER_USER) throw AppError.conflict("You have many reports waiting for review. Please try again once some are resolved.");

    try {
      const report = await ProblemReportModel.create({
        questionId: question._id,
        paperId: question.paperId ?? null,
        section: question.section,
        userId,
        attemptId: attempt._id,
        attemptKind: attempt.kind,
        position,
        reason: input.reason,
        details: input.details || null,
        status: "pending",
        history: [{ action: "created", at: new Date(), by: new mongoose.Types.ObjectId(userId), note: null, questionEdited: false }],
      });
      return { id: String(report._id) };
    } catch (error) {
      // The unique index allows one pending report per student per question.
      if ((error as { code?: unknown }).code === 11000) {
        throw AppError.conflict("You have already reported this question. We will look into it.");
      }
      throw error;
    }
  },

  async list(query: { status?: ReportStatus; page: number; pageSize: number }): Promise<{
    reports: AdminReport[];
    total: number;
    page: number;
    pageSize: number;
    counts: Record<ReportStatus, number>;
  }> {
    const filter = query.status ? { status: query.status } : {};
    const [reports, total, pending, resolved] = await Promise.all([
      ProblemReportModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<ProblemReportDoc[]>(),
      ProblemReportModel.countDocuments(filter),
      ProblemReportModel.countDocuments({ status: "pending" }),
      ProblemReportModel.countDocuments({ status: "resolved" }),
    ]);
    return { reports: await withRelated(reports), total, page: query.page, pageSize: query.pageSize, counts: { pending, resolved } };
  },

  // One report with its question (full, with the answer key) and the other reports on that question.
  async get(id: string): Promise<{ report: AdminReport; question: AdminQuestion | null; related: AdminReport[] }> {
    const report = await ProblemReportModel.findById(id).lean<ProblemReportDoc>();
    if (!report) throw AppError.notFound("Report not found");
    const others = await ProblemReportModel.find({ questionId: report.questionId, _id: trusted({ $ne: report._id }) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean<ProblemReportDoc[]>();
    const [view, ...related] = await withRelated([report, ...others]);
    const question = await adminService.getQuestion(String(report.questionId)).catch((error: unknown) => {
      // The question may have been deleted since; the report stays readable.
      if (error instanceof AppError && error.status === 404) return null;
      throw error;
    });
    return { report: view!, question, related };
  },

  // Pending → resolved. The status check is part of the write, so a double click (or two admins at
  // once) resolves it once and the second request is told it was already done.
  async resolve(id: string, adminId: string, input: { note: string; includeSameQuestion: boolean; notify: boolean }): Promise<{ resolved: number }> {
    const report = await ProblemReportModel.findById(id).lean<ProblemReportDoc>();
    if (!report) throw AppError.notFound("Report not found");
    if (report.status !== "pending") throw AppError.conflict("This report has already been resolved");

    const targets = input.includeSameQuestion
      ? await ProblemReportModel.find({ questionId: report.questionId, status: "pending" }).lean<ProblemReportDoc[]>()
      : [report];
    const resolved = await resolveTargets(targets, adminId, input.note, input.notify);
    if (resolved === 0) throw AppError.conflict("This report has already been resolved");
    return { resolved };
  },

  async resolveMany(
    adminId: string,
    input: { ids?: string[]; allPending?: boolean; note: string; notify: boolean },
  ): Promise<{ resolved: number }> {
    const filter = input.allPending ? { status: "pending" } : { _id: trusted({ $in: input.ids ?? [] }), status: "pending" };
    const targets = await ProblemReportModel.find(filter).sort({ createdAt: 1 }).lean<ProblemReportDoc[]>();
    if (targets.length === 0) throw AppError.conflict("The selected reports have already been resolved");
    const resolved = await resolveTargets(targets, adminId, input.note, input.notify);
    if (resolved === 0) throw AppError.conflict("The selected reports have already been resolved");
    return { resolved };
  },

  async reopen(id: string, adminId: string, note: string): Promise<void> {
    const report = await ProblemReportModel.findById(id).select("userId questionId status").lean<ProblemReportDoc>();
    if (!report) throw AppError.notFound("Report not found");
    if (report.status !== "resolved") throw AppError.conflict("This report is already pending");
    try {
      const result = await ProblemReportModel.updateOne(
        { _id: report._id, status: "resolved" },
        {
          $set: { status: "pending", resolvedAt: null, resolvedBy: null },
          $push: { history: { action: "reopened", at: new Date(), by: new mongoose.Types.ObjectId(adminId), note: note || null, questionEdited: false } },
        },
      );
      if (result.modifiedCount === 0) throw AppError.conflict("This report is already pending");
    } catch (error) {
      // The same student has a newer pending report on this question.
      if ((error as { code?: unknown }).code === 11000) {
        throw AppError.conflict("The same student has a newer pending report on this question; work on that one instead.");
      }
      throw error;
    }
  },

  async counts(): Promise<Record<ReportStatus, number>> {
    const [pending, resolved] = await Promise.all([
      ProblemReportModel.countDocuments({ status: "pending" }),
      ProblemReportModel.countDocuments({ status: "resolved" }),
    ]);
    return { pending, resolved };
  },
};
