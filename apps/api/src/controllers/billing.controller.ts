import type { Request, Response } from "express";
import type { UserDoc } from "@satsharks/db";
import {
  autoRenewSchema,
  cardCheckoutSchema,
  checkoutQuerySchema,
  manualPaymentSchema,
  objectIdSchema,
  paymentListQuerySchema,
  paymentReviewSchema,
  paymentSettingsSchema,
  redeemInviteSchema,
} from "@satsharks/validation";
import { UserModel } from "@satsharks/db";
import { contentRule, currencyForIpCountry, type Currency, type PaymentSettings } from "@satsharks/types";
import { env } from "../config/env";
import { paymentService } from "../services/payment.service";
import { practiceService } from "../services/practice.service";
import { publicService } from "../services/public.service";
import { settingsService } from "../services/settings.service";
import { testUploadService } from "../services/test-upload.service";
import { AppError } from "../utils/app-error";
import { clientCountry } from "../utils/client-ip";
import { sendOk } from "../utils/respond";

function me(req: Request): UserDoc {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}

// Deployed purchases require the country that Vercel derived from the current public IP and
// forwarded through the signed web proxy. PKR is allowed only for a positively verified Pakistan
// country. Local runs without PROXY_SECRET have no trusted location, so they fail closed to USD
// instead of silently reusing the account country.
function purchaseCurrency(req: Request): Currency {
  const country = clientCountry(req);
  if (country) return currencyForIpCountry(country);
  if (env.PROXY_SECRET) throw AppError.badRequest("We could not verify your current location. Open checkout from the LUE SAT website and try again.");
  return "USD";
}

// The admin sees which field is wrong, not just "invalid request".
function parse<T>(result: { success: true; data: T } | { success: false; error: { issues: { message: string }[] } }, fallback: string): T {
  if (!result.success) throw AppError.badRequest(result.error.issues[0]?.message ?? fallback);
  return result.data;
}

// ---------- students ----------

export async function getBilling(req: Request, res: Response): Promise<void> {
  sendOk(res, await paymentService.billing(me(req)));
}

export async function getCheckout(req: Request, res: Response): Promise<void> {
  sendOk(res, await paymentService.checkout(me(req), checkoutQuerySchema.parse(req.query), purchaseCurrency(req)));
}

export async function submitManualPayment(req: Request, res: Response): Promise<void> {
  const input = parse(manualPaymentSchema.safeParse(req.body), "Check the payment details");
  sendOk(res, { payment: await paymentService.submitManual(me(req), input, purchaseCurrency(req)) }, 201);
}

export async function startCardPayment(req: Request, res: Response): Promise<void> {
  sendOk(res, await paymentService.startCard(me(req), cardCheckoutSchema.parse(req.body), purchaseCurrency(req)));
}

export async function completeTestPayment(req: Request, res: Response): Promise<void> {
  const outcome = (req.body as { outcome?: unknown })?.outcome === "failed" ? "failed" : "paid";
  sendOk(res, { payment: await paymentService.completeTestPayment(me(req), objectIdSchema.parse(req.params.id), outcome) });
}

export async function setAutoRenew(req: Request, res: Response): Promise<void> {
  const { autoRenew } = autoRenewSchema.parse(req.body);
  await paymentService.setAutoRenew(me(req), autoRenew);
  sendOk(res, { autoRenew });
}

export async function getReceipt(req: Request, res: Response): Promise<void> {
  sendOk(res, { payment: await paymentService.receipt(me(req), objectIdSchema.parse(req.params.id)) });
}

// An invite code opens the invite-only exam or test it belongs to (Admin → Access).
export async function redeemInvite(req: Request, res: Response): Promise<void> {
  const { code } = parse(redeemInviteSchema.safeParse(req.body), "Check the invite code");
  const settings = await settingsService.getAccess();
  const rule = settings.content.find((entry) => entry.level === "invite" && entry.inviteCode === code);
  if (!rule) throw AppError.notFound("That invite code is not valid. Check it and try again.");
  const user = me(req);
  await UserModel.updateOne({ _id: user._id }, { $addToSet: { inviteKeys: rule.key } });
  const [exams, uploads] = await Promise.all([practiceService.catalogExams(), testUploadService.listPublished()]);
  const name = exams.find((exam) => exam.examId === rule.key)?.name ?? uploads.find((item) => item.key === rule.key)?.name ?? "The exam";
  sendOk(res, { key: rule.key, name, alreadyOpen: contentRule(settings, rule.key).level !== "invite" || (user.inviteKeys ?? []).includes(rule.key) });
}

// ---------- public ----------

export async function getProof(_req: Request, res: Response): Promise<void> {
  // Real numbers, the same for everyone: cacheable for a minute.
  res.setHeader("Cache-Control", "public, max-age=60");
  sendOk(res, await publicService.proof());
}

// The exit offer and whether friend invites are on, for the pricing page (no account needed).
export async function getOffers(_req: Request, res: Response): Promise<void> {
  const settings = await settingsService.getPayments();
  sendOk(res, { exitOffer: settings.exitOffer.enabled ? { percentOff: settings.exitOffer.percentOff, headline: settings.exitOffer.headline } : null });
}

// ---------- admin ----------

export async function listPayments(req: Request, res: Response): Promise<void> {
  sendOk(res, await paymentService.list(paymentListQuerySchema.parse(req.query)));
}

export async function markPaymentsSeen(_req: Request, res: Response): Promise<void> {
  sendOk(res, await paymentService.markAllSeen());
}

export async function reviewPayment(req: Request, res: Response): Promise<void> {
  const { decision, note } = paymentReviewSchema.parse(req.body);
  sendOk(res, { payment: await paymentService.review(String(me(req)._id), objectIdSchema.parse(req.params.id), decision, note) });
}

export async function getAdminReceipt(req: Request, res: Response): Promise<void> {
  sendOk(res, { payment: await paymentService.receipt(me(req), objectIdSchema.parse(req.params.id), true) });
}

export async function getUserPayments(req: Request, res: Response): Promise<void> {
  sendOk(res, { payments: await paymentService.forUser(objectIdSchema.parse(req.params.id)) });
}

export async function getPaymentSettings(_req: Request, res: Response): Promise<void> {
  sendOk(res, await settingsService.getPayments());
}

export async function setPaymentSettings(req: Request, res: Response): Promise<void> {
  const settings = parse(paymentSettingsSchema.safeParse(req.body), "Check the payment settings");
  sendOk(res, await settingsService.setPayments(settings as PaymentSettings, String(me(req)._id)));
}

