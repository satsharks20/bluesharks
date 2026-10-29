import { Router } from "express";
import { bankDrillSchema, createAttemptSchema, createFullTestSchema, createMockSchema, createReportSchema, retryDrillSchema, saveAnnotationsSchema, saveAnswerSchema } from "@satsharks/validation";
import { createBankDrill, createRetryDrill } from "../controllers/student.controller";
import {
  checkQuestion,
  continueFullTest,
  createAttempt,
  createFullTest,
  createMock,
  deleteAttempt,
  deleteFullTest,
  endAttempt,
  getAttempt,
  getCatalog,
  getFullTest,
  getQuestion,
  getResult,
  listAttempts,
  listFullTests,
  listPracticeTests,
  reportQuestion,
  saveAnnotations,
  saveAnswer,
  submitModule,
} from "../controllers/practice.controller";
import { requireAuth } from "../middleware/auth";
import { practiceStartRateLimit, reportRateLimit } from "../middleware/rate-limit";
import { requireDb } from "../middleware/require-db";
import { validateBody } from "../middleware/validate";

export const practiceRouter = Router();

practiceRouter.use(requireDb, requireAuth);

practiceRouter.get("/catalog", getCatalog);
practiceRouter.get("/attempts", listAttempts);
practiceRouter.post("/attempts", practiceStartRateLimit, validateBody(createAttemptSchema), createAttempt);
practiceRouter.post("/mocks", practiceStartRateLimit, validateBody(createMockSchema), createMock);
practiceRouter.post("/drills/bank", practiceStartRateLimit, validateBody(bankDrillSchema), createBankDrill);
practiceRouter.post("/drills/retry", practiceStartRateLimit, validateBody(retryDrillSchema), createRetryDrill);
practiceRouter.get("/tests", listPracticeTests);
practiceRouter.get("/full-tests", listFullTests);
practiceRouter.post("/full-tests", practiceStartRateLimit, validateBody(createFullTestSchema), createFullTest);
practiceRouter.get("/full-tests/:id", getFullTest);
practiceRouter.post("/full-tests/:id/continue", practiceStartRateLimit, continueFullTest);
practiceRouter.delete("/full-tests/:id", deleteFullTest);
practiceRouter.get("/attempts/:id", getAttempt);
practiceRouter.delete("/attempts/:id", deleteAttempt);
practiceRouter.post("/attempts/:id/submit-module", submitModule);
practiceRouter.post("/attempts/:id/end", endAttempt);
practiceRouter.get("/attempts/:id/result", getResult);
practiceRouter.get("/attempts/:id/questions/:position", getQuestion);
practiceRouter.patch("/attempts/:id/questions/:position", validateBody(saveAnswerSchema), saveAnswer);
practiceRouter.put("/attempts/:id/questions/:position/annotations", validateBody(saveAnnotationsSchema), saveAnnotations);
practiceRouter.post("/attempts/:id/questions/:position/check", checkQuestion);
practiceRouter.post("/attempts/:id/questions/:position/report", reportRateLimit, validateBody(createReportSchema), reportQuestion);
