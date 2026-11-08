import type { Request, Response } from "express";
import {
  accessSettingsSchema,
  adaptiveSettingsSchema,
  adminLeaderboardQuerySchema,
  bulkResolveReportsSchema,
  bulkPaperStatusSchema,
  bulkUsersSchema,
  conversionTablesSchema,
  objectIdSchema,
  pricingContentSchema,
  paperStatusSchema,
  questionListQuerySchema,
  reopenReportSchema,
  reportListQuerySchema,
  resolveReportSchema,
  satDatesContentSchema,
  scheduleSchema,
  updateUserSchema,
  userListQuerySchema,
  leaderboardVisibilitySchema,
  type UpdateQuestionInput,
} from "@satsharks/validation";
import type { AccessItem, AdminAccess, PricingContent } from "@satsharks/types";
import { adminService } from "../services/admin.service";
import { practiceService } from "../services/practice.service";
import { testUploadService } from "../services/test-upload.service";
import { reportService } from "../services/report.service";
import { userAdminService } from "../services/user-admin.service";
import { settingsService } from "../services/settings.service";
import { adminLeaderboardService } from "../services/admin-leaderboard.service";
import { AppError } from "../utils/app-error";
import { sendOk } from "../utils/respond";

export async function getStats(_req: Request, res: Response): Promise<void> {
  sendOk(res, await adminService.stats());
}

export async function setPaperStatus(req: Request, res: Response): Promise<void> {
  const id = objectIdSchema.parse(req.params.id);
  const { status } = paperStatusSchema.parse(req.body);
  sendOk(res, await adminService.setPaperStatus(status, [id]));
}

export async function setPapersStatus(req: Request, res: Response): Promise<void> {
  const { status, ids } = bulkPaperStatusSchema.parse(req.body);
  sendOk(res, await adminService.setPaperStatus(status, ids));
}

export async function getFacets(_req: Request, res: Response): Promise<void> {
  sendOk(res, { topics: await adminService.facets() });
}

export async function listQuestions(req: Request, res: Response): Promise<void> {
  sendOk(res, await adminService.listQuestions(questionListQuerySchema.parse(req.query)));
}

export async function getQuestion(req: Request, res: Response): Promise<void> {
  sendOk(res, { question: await adminService.getQuestion(objectIdSchema.parse(req.params.id)) });
}

export async function updateQuestion(req: Request, res: Response): Promise<void> {
  const id = objectIdSchema.parse(req.params.id);
  sendOk(res, { question: await adminService.updateQuestion(id, req.body as UpdateQuestionInput) });
}

export async function uploadImage(req: Request, res: Response): Promise<void> {
  if (!req.file) throw AppError.badRequest("Choose an image");
  sendOk(res, await adminService.uploadImage(req.file), 201);
}

export async function getAdaptiveSettings(_req: Request, res: Response): Promise<void> {
  sendOk(res, await settingsService.getAdaptive());
}

export async function setAdaptiveSettings(req: Request, res: Response): Promise<void> {
  const settings = adaptiveSettingsSchema.parse(req.body);
  sendOk(res, await settingsService.setAdaptive(settings, String(req.user!._id)));
}

export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  await adminService.deleteQuestion(objectIdSchema.parse(req.params.id));
  sendOk(res, { deleted: true });
}

export async function getConversionTables(_req: Request, res: Response): Promise<void> {
  sendOk(res, await settingsService.getConversionTables());
}

export async function setConversionTables(req: Request, res: Response): Promise<void> {
  const tables = conversionTablesSchema.parse(req.body);
  sendOk(res, await settingsService.setConversionTables(tables, String(req.user!._id)));
}

export async function getPricing(_req: Request, res: Response): Promise<void> {
  sendOk(res, await settingsService.getPricing());
}

export async function setPricing(req: Request, res: Response): Promise<void> {
  const parsed = pricingContentSchema.safeParse(req.body);
  // The admin sees which field is wrong, not just "invalid request".
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues[0]?.message ?? "Check the pricing fields");
  sendOk(res, await settingsService.setPricing(parsed.data as PricingContent, String(req.user!._id)));
}

export async function getSatDates(_req: Request, res: Response): Promise<void> {
  sendOk(res, await settingsService.getSatDates());
}

export async function setSatDates(req: Request, res: Response): Promise<void> {
  const parsed = satDatesContentSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues[0]?.message ?? "Check the dates");
  sendOk(res, await settingsService.setSatDates(parsed.data, String(req.user!._id)));
}

// Access by plan, and everything it can apply to: the catalog's exams (as students see them) and
// every published uploaded test (exams among them may be inactive, so not in the catalog).
export async function getAccess(_req: Request, res: Response): Promise<void> {
  const [settings, exams, uploads] = await Promise.all([settingsService.getAccess(), practiceService.catalogExams(), testUploadService.listPublished()]);
  const uploadKeys = new Set(uploads.map((item) => item.key));
  const items: AccessItem[] = [
    ...exams
      .filter((exam) => !uploadKeys.has(exam.examId))
      .map((exam): AccessItem => ({ key: exam.examId, kind: "exam", name: exam.name, date: exam.examDate, active: true })),
    ...uploads,
  ];
  sendOk(res, { settings, items } satisfies AdminAccess);
}

export async function setAccess(req: Request, res: Response): Promise<void> {
  const parsed = accessSettingsSchema.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.issues[0]?.message ?? "Check the access settings");
  sendOk(res, await settingsService.setAccess(parsed.data, String(req.user!._id)));
}

export async function listReports(req: Request, res: Response): Promise<void> {
  sendOk(res, await reportService.list(reportListQuerySchema.parse(req.query)));
}

export async function getReport(req: Request, res: Response): Promise<void> {
  sendOk(res, await reportService.get(objectIdSchema.parse(req.params.id)));
}

export async function resolveReport(req: Request, res: Response): Promise<void> {
  const input = resolveReportSchema.parse(req.body);
  sendOk(res, await reportService.resolve(objectIdSchema.parse(req.params.id), String(req.user!._id), input));
}

export async function resolveReports(req: Request, res: Response): Promise<void> {
  sendOk(res, await reportService.resolveMany(String(req.user!._id), bulkResolveReportsSchema.parse(req.body)));
}

export async function reopenReport(req: Request, res: Response): Promise<void> {
  const { note } = reopenReportSchema.parse(req.body);
  await reportService.reopen(objectIdSchema.parse(req.params.id), String(req.user!._id), note);
  sendOk(res, { reopened: true });
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  sendOk(res, await userAdminService.list(userListQuerySchema.parse(req.query)));
}

export async function getUser(req: Request, res: Response): Promise<void> {
  sendOk(res, await userAdminService.get(objectIdSchema.parse(req.params.id)));
}

export async function purgeDeletedUsers(_req: Request, res: Response): Promise<void> {
  sendOk(res, await userAdminService.purgeDeleted());
}

export async function bulkUsers(req: Request, res: Response): Promise<void> {
  sendOk(res, await userAdminService.bulk(String(req.user!._id), bulkUsersSchema.parse(req.body)));
}

// Users list as CSV with the page's filters (proposal 4.2 "export the list as CSV").
export async function exportUsers(req: Request, res: Response): Promise<void> {
  const csv = await userAdminService.exportCsv(userListQuerySchema.parse({ ...req.query, page: 1, pageSize: 100 }));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="lue-sat-users-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
}

export async function listAdminLeaderboard(req: Request, res: Response): Promise<void> {
  sendOk(res, await adminLeaderboardService.list(adminLeaderboardQuerySchema.parse(req.query)));
}

export async function exportAdminLeaderboard(req: Request, res: Response): Promise<void> {
  const query = adminLeaderboardQuerySchema.parse({ ...req.query, page: 1, pageSize: 100 });
  const csv = await adminLeaderboardService.exportCsv(query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="lue-sat-leaderboard-${query.period}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(csv);
}

export async function setLeaderboardVisibility(req: Request, res: Response): Promise<void> {
  const { shown } = leaderboardVisibilitySchema.parse(req.body);
  sendOk(res, await adminLeaderboardService.setVisibility(objectIdSchema.parse(req.params.id), shown));
}

export async function resetLeaderboardWeek(req: Request, res: Response): Promise<void> {
  sendOk(res, await adminLeaderboardService.resetWeek(objectIdSchema.parse(req.params.id)));
}

export async function setPaperSchedule(req: Request, res: Response): Promise<void> {
  const { at } = scheduleSchema.parse(req.body);
  sendOk(res, await adminService.setPaperSchedule(objectIdSchema.parse(req.params.id), at ? new Date(at) : null));
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const input = updateUserSchema.parse(req.body);
  sendOk(res, { user: await userAdminService.update(objectIdSchema.parse(req.params.id), String(req.user!._id), input) });
}
