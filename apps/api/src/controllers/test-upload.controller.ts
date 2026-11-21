import type { Request, Response } from "express";
import {
  objectIdSchema,
  saveUploadSectionSchema,
  scheduleSchema,
  testUploadActiveSchema,
  testUploadMetaSchema,
  uploadSectionParamSchema,
} from "@satsharks/validation";
import { invalidateCatalog } from "../services/practice.service";
import { testUploadService, type UploadedFile } from "../services/test-upload.service";
import { AppError } from "../utils/app-error";
import { sendOk } from "../utils/respond";

const uploadId = (req: Request) => objectIdSchema.parse(req.params.id);
const userId = (req: Request) => String(req.user!._id);

export async function listTestUploads(_req: Request, res: Response): Promise<void> {
  sendOk(res, { uploads: await testUploadService.list() });
}

export async function getTestUpload(req: Request, res: Response): Promise<void> {
  sendOk(res, await testUploadService.get(uploadId(req)));
}

export async function createTestUpload(req: Request, res: Response): Promise<void> {
  const meta = testUploadMetaSchema.parse(req.body);
  const files = (req.files ?? {}) as Record<string, UploadedFile[] | undefined>;
  const upload = await testUploadService.create(meta, { reading_writing: files.readingWriting?.[0], math: files.math?.[0] }, userId(req));
  sendOk(res, { upload }, 201);
}

// Both can move an uploaded exam into or out of the Exams list.
export async function updateTestUpload(req: Request, res: Response): Promise<void> {
  const upload = await testUploadService.update(uploadId(req), testUploadMetaSchema.parse(req.body));
  invalidateCatalog();
  sendOk(res, { upload });
}

export async function replaceTestUploadSection(req: Request, res: Response): Promise<void> {
  const section = uploadSectionParamSchema.parse(req.params.section);
  if (!req.file) throw AppError.badRequest("Choose a PDF file");
  sendOk(res, { upload: await testUploadService.replaceSection(uploadId(req), section, req.file) });
}

export async function saveTestUploadSection(req: Request, res: Response): Promise<void> {
  const section = uploadSectionParamSchema.parse(req.params.section);
  sendOk(res, { upload: await testUploadService.saveReview(uploadId(req), section, saveUploadSectionSchema.parse(req.body), userId(req)) });
}

export async function publishTestUpload(req: Request, res: Response): Promise<void> {
  sendOk(res, { upload: await testUploadService.publish(uploadId(req)) });
}

export async function setTestUploadActive(req: Request, res: Response): Promise<void> {
  const { active } = testUploadActiveSchema.parse(req.body);
  const upload = await testUploadService.setActive(uploadId(req), active);
  invalidateCatalog();
  sendOk(res, { upload });
}

export async function deleteTestUpload(req: Request, res: Response): Promise<void> {
  await testUploadService.remove(uploadId(req));
  invalidateCatalog();
  sendOk(res, { deleted: true });
}

// Activate a published test by itself at a date and time (proposal 4.2); null clears the schedule.
export async function scheduleTestUpload(req: Request, res: Response): Promise<void> {
  const { at } = scheduleSchema.parse(req.body);
  sendOk(res, { upload: await testUploadService.setSchedule(uploadId(req), at ? new Date(at) : null) });
}
