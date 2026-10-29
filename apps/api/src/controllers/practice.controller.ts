import type { Request, Response } from "express";
import {
  objectIdSchema,
  positionSchema,
  type CreateAttemptInput,
  type CreateFullTestInput,
  type CreateMockInput,
  type CreateReportInput,
  type SaveAnnotationsInput,
  type SaveAnswerInput,
} from "@satsharks/validation";
import { userAccess } from "../services/access.service";
import { practiceService } from "../services/practice.service";
import { reportService } from "../services/report.service";
import { AppError } from "../utils/app-error";
import { sendOk } from "../utils/respond";

function userId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return String(req.user._id);
}
const attemptId = (req: Request) => objectIdSchema.parse(req.params.id);
const position = (req: Request) => positionSchema.parse(req.params.position);

// What this account's plan opens (Admin → Access).
function access(req: Request) {
  if (!req.user) throw AppError.unauthorized();
  return userAccess(req.user);
}

export async function getCatalog(req: Request, res: Response): Promise<void> {
  sendOk(res, await practiceService.catalog(await access(req)));
}

export async function listPracticeTests(req: Request, res: Response): Promise<void> {
  sendOk(res, { tests: await practiceService.practiceTests(await access(req)) });
}

export async function createAttempt(req: Request, res: Response): Promise<void> {
  sendOk(res, { attempt: await practiceService.createAttempt(userId(req), req.body as CreateAttemptInput, await access(req)) }, 201);
}

export async function listAttempts(req: Request, res: Response): Promise<void> {
  sendOk(res, { attempts: await practiceService.listAttempts(userId(req)) });
}

export async function getAttempt(req: Request, res: Response): Promise<void> {
  sendOk(res, await practiceService.getAttempt(userId(req), attemptId(req)));
}

export async function getQuestion(req: Request, res: Response): Promise<void> {
  sendOk(res, { question: await practiceService.getQuestion(userId(req), attemptId(req), position(req), req.query.peek === "1") });
}

export async function saveAnswer(req: Request, res: Response): Promise<void> {
  sendOk(res, { item: await practiceService.saveAnswer(userId(req), attemptId(req), position(req), req.body as SaveAnswerInput) });
}

export async function saveAnnotations(req: Request, res: Response): Promise<void> {
  sendOk(res, { annotations: await practiceService.saveAnnotations(userId(req), attemptId(req), position(req), req.body as SaveAnnotationsInput) });
}

export async function checkQuestion(req: Request, res: Response): Promise<void> {
  sendOk(res, { question: await practiceService.checkQuestion(userId(req), attemptId(req), position(req)) });
}

export async function createMock(req: Request, res: Response): Promise<void> {
  sendOk(res, { attempt: await practiceService.createMock(userId(req), req.body as CreateMockInput, await access(req)) }, 201);
}

export async function submitModule(req: Request, res: Response): Promise<void> {
  sendOk(res, await practiceService.submitModule(userId(req), attemptId(req)));
}

export async function endAttempt(req: Request, res: Response): Promise<void> {
  sendOk(res, { attempt: await practiceService.endAttempt(userId(req), attemptId(req)) });
}

export async function getResult(req: Request, res: Response): Promise<void> {
  sendOk(res, await practiceService.getResult(userId(req), attemptId(req)));
}

const fullTestId = (req: Request) => objectIdSchema.parse(req.params.id);

export async function createFullTest(req: Request, res: Response): Promise<void> {
  sendOk(res, { fullTest: await practiceService.createFullTest(userId(req), req.body as CreateFullTestInput, await access(req)) }, 201);
}

export async function listFullTests(req: Request, res: Response): Promise<void> {
  sendOk(res, { fullTests: await practiceService.listFullTests(userId(req)) });
}

export async function getFullTest(req: Request, res: Response): Promise<void> {
  sendOk(res, { fullTest: await practiceService.getFullTest(userId(req), fullTestId(req)) });
}

export async function continueFullTest(req: Request, res: Response): Promise<void> {
  sendOk(res, { fullTest: await practiceService.continueFullTest(userId(req), fullTestId(req), await access(req)) });
}

export async function reportQuestion(req: Request, res: Response): Promise<void> {
  sendOk(res, await reportService.create(userId(req), attemptId(req), position(req), req.body as CreateReportInput), 201);
}

export async function deleteAttempt(req: Request, res: Response): Promise<void> {
  await practiceService.deleteAttempt(userId(req), attemptId(req));
  sendOk(res, { deleted: true });
}

export async function deleteFullTest(req: Request, res: Response): Promise<void> {
  await practiceService.deleteFullTest(userId(req), fullTestId(req));
  sendOk(res, { deleted: true });
}
