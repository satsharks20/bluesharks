import express, { Router } from "express";
import { updateQuestionSchema } from "@satsharks/validation";
import { getPaper, listPapers } from "../controllers/admin-paper.controller";
import {
  deleteQuestion,
  getAccess,
  getAdaptiveSettings,
  getConversionTables,
  getFacets,
  getPricing,
  getQuestion,
  getReport,
  getStats,
  getUser,
  listQuestions,
  listReports,
  listUsers,
  purgeDeletedUsers,
  bulkUsers,
  exportUsers,
  setPaperSchedule,
  reopenReport,
  resolveReport,
  resolveReports,
  listAdminLeaderboard,
  exportAdminLeaderboard,
  setLeaderboardVisibility,
  resetLeaderboardWeek,
  setAccess,
  setAdaptiveSettings,
  setConversionTables,
  updateUser,
  setPapersStatus,
  setPaperStatus,
  setPricing,
  setSatDates,
  getSatDates,
  updateQuestion,
  uploadImage,
} from "../controllers/admin.controller";
import {
  createTestUpload,
  deleteTestUpload,
  getTestUpload,
  listTestUploads,
  publishTestUpload,
  replaceTestUploadSection,
  saveTestUploadSection,
  scheduleTestUpload,
  setTestUploadActive,
  updateTestUpload,
} from "../controllers/test-upload.controller";
import { createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement } from "../controllers/announcement.controller";
import {
  getAdminReceipt,
  getPaymentSettings,
  getUserPayments,
  listPayments,
  markPaymentsSeen,
  reviewPayment,
  setPaymentSettings,
} from "../controllers/billing.controller";
import { requireAuth, requirePermission } from "../middleware/auth";
import { imageUpload, testPdfUpload } from "../middleware/upload";
import { requireDb } from "../middleware/require-db";
import { validateBody } from "../middleware/validate";

export const adminRouter = Router();

adminRouter.use(requireDb, requireAuth, requirePermission("admin:access"));
// A reviewed section of an uploaded test (up to ~80 questions with passages) is one request. Read only
// after the sign-in check above; app.ts skips its 100 kB parser for this path (LARGE_BODY_PATH).
adminRouter.use("/test-uploads", express.json({ limit: "2mb" }));

adminRouter.get("/stats", getStats);

adminRouter.get("/settings/adaptive", getAdaptiveSettings);
adminRouter.put("/settings/adaptive", requirePermission("papers:write"), setAdaptiveSettings);
adminRouter.get("/settings/scoring", getConversionTables);
adminRouter.put("/settings/scoring", requirePermission("papers:write"), setConversionTables);
adminRouter.get("/settings/pricing", getPricing);
adminRouter.put("/settings/pricing", requirePermission("papers:write"), setPricing);
adminRouter.get("/settings/sat-dates", getSatDates);
adminRouter.put("/settings/sat-dates", requirePermission("papers:write"), setSatDates);
adminRouter.get("/settings/access", requirePermission("papers:read"), getAccess);
adminRouter.put("/settings/access", requirePermission("papers:write"), setAccess);

adminRouter.get("/announcements", listAnnouncements);
adminRouter.post("/announcements", requirePermission("papers:write"), createAnnouncement);
adminRouter.put("/announcements/:id", requirePermission("papers:write"), updateAnnouncement);
adminRouter.delete("/announcements/:id", requirePermission("papers:write"), deleteAnnouncement);

adminRouter.get("/users", requirePermission("users:read"), listUsers);
adminRouter.get("/users/export", requirePermission("users:read"), exportUsers);
adminRouter.delete("/users/deleted", requirePermission("users:write"), purgeDeletedUsers);
adminRouter.post("/users/bulk", requirePermission("users:write"), bulkUsers);
adminRouter.get("/users/:id", requirePermission("users:read"), getUser);
adminRouter.get("/users/:id/payments", requirePermission("payments:read"), getUserPayments);

adminRouter.get("/payments", requirePermission("payments:read"), listPayments);
adminRouter.post("/payments/seen", requirePermission("payments:read"), markPaymentsSeen);
adminRouter.get("/payments/:id/receipt", requirePermission("payments:read"), getAdminReceipt);
adminRouter.post("/payments/:id/review", requirePermission("payments:write"), reviewPayment);
adminRouter.get("/settings/payments", requirePermission("payments:read"), getPaymentSettings);
adminRouter.put("/settings/payments", requirePermission("payments:write"), setPaymentSettings);
adminRouter.patch("/users/:id", requirePermission("users:write"), updateUser);

adminRouter.get("/reports", requirePermission("reports:read"), listReports);
adminRouter.post("/reports/resolve", requirePermission("reports:write"), resolveReports);
adminRouter.get("/reports/:id", requirePermission("reports:read"), getReport);
adminRouter.post("/reports/:id/resolve", requirePermission("reports:write"), resolveReport);
adminRouter.post("/reports/:id/reopen", requirePermission("reports:write"), reopenReport);

adminRouter.get("/leaderboard", requirePermission("users:read"), listAdminLeaderboard);
adminRouter.get("/leaderboard/export", requirePermission("users:read"), exportAdminLeaderboard);
adminRouter.patch("/leaderboard/:id/visibility", requirePermission("users:write"), setLeaderboardVisibility);
adminRouter.post("/leaderboard/:id/reset-week", requirePermission("users:write"), resetLeaderboardWeek);

adminRouter.get("/papers", requirePermission("papers:read"), listPapers);
adminRouter.post("/papers/status", requirePermission("papers:write"), setPapersStatus);
adminRouter.get("/papers/:id", requirePermission("papers:read"), getPaper);
adminRouter.patch("/papers/:id/status", requirePermission("papers:write"), setPaperStatus);
adminRouter.put("/papers/:id/schedule", requirePermission("papers:write"), setPaperSchedule);

adminRouter.get("/questions", requirePermission("questions:read"), listQuestions);
adminRouter.get("/questions/facets", requirePermission("questions:read"), getFacets);
adminRouter.get("/questions/:id", requirePermission("questions:read"), getQuestion);
adminRouter.patch("/questions/:id", requirePermission("questions:write"), validateBody(updateQuestionSchema), updateQuestion);
adminRouter.delete("/questions/:id", requirePermission("questions:write"), deleteQuestion);
adminRouter.post("/assets", requirePermission("questions:write"), imageUpload.single("image"), uploadImage);

// Uploaded practice tests (two PDFs → review → publish → activate).
adminRouter.get("/test-uploads", requirePermission("papers:read"), listTestUploads);
adminRouter.post(
  "/test-uploads",
  requirePermission("papers:write"),
  testPdfUpload.fields([
    { name: "readingWriting", maxCount: 1 },
    { name: "math", maxCount: 1 },
  ]),
  createTestUpload,
);
adminRouter.get("/test-uploads/:id", requirePermission("papers:read"), getTestUpload);
adminRouter.patch("/test-uploads/:id", requirePermission("papers:write"), updateTestUpload);
adminRouter.post("/test-uploads/:id/sections/:section/file", requirePermission("papers:write"), testPdfUpload.single("file"), replaceTestUploadSection);
adminRouter.put("/test-uploads/:id/sections/:section", requirePermission("papers:write"), saveTestUploadSection);
adminRouter.post("/test-uploads/:id/publish", requirePermission("papers:write"), publishTestUpload);
adminRouter.post("/test-uploads/:id/active", requirePermission("papers:write"), setTestUploadActive);
adminRouter.put("/test-uploads/:id/schedule", requirePermission("papers:write"), scheduleTestUpload);
adminRouter.delete("/test-uploads/:id", requirePermission("papers:write"), deleteTestUpload);
