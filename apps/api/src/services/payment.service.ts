// Plans, payments and billing (proposal 4.1) and the admin's payment list and alerts (4.2).
//
// A paid plan is given in exactly one place, markPaid, and only once per payment: the payment moves
// to "paid" with a guarded update first, so a double click, a retried webhook or two admins approving
// at once cannot give the plan twice. Paying while a plan runs adds the new period after its end.
//
// Prices come from the pricing page as the admin wrote them ("PKR 1,500"), so changing a price in
// Admin → Settings changes what is charged. Purchase quotes receive their currency from the
// current request's trusted IP country. The account-region helper below remains only for billing
// summaries and referral records that are not purchase quotes.
import { PaymentModel, trusted, UserModel, type PaymentDoc, type UserDoc } from "@satsharks/db";
import { createLogger, toErrorMessage } from "@satsharks/utils";
import {
  CURRENCIES,
  formatMoney,
  isManualMethod,
  MANUAL_PAYMENT_METHODS,
  PAID_PLAN_LABELS,
  parsePrice,
  PAYMENT_METHOD_LABELS,
  PLAN_MONTHS,
  REFERRAL_REWARD_DAYS,
  REFERRAL_QUALIFY_POINTS,
  type Billing,
  type Checkout,
  type CheckoutOption,
  type Currency,
  type PaidPlan,
  type PaymentSettings,
  type PaymentSummary,
} from "@satsharks/types";
import type { CardCheckoutInput, CheckoutQuery, ManualPaymentInput, PaymentListQuery } from "@satsharks/validation";
import mongoose from "mongoose";
import { env } from "../config/env";
import { AppError } from "../utils/app-error";
import { emailService } from "./email.service";
import { dayIn } from "./engagement-rules";
import { ensureFriendCode } from "./engagement.service";
import { cardGateway, isTestGatewayOn } from "./payment-gateways";
import { discounted, extendByDays, periodFor, receiptNumber, referralRewardsDue } from "./payment-rules";
import { settingsService } from "./settings.service";

const logger = createLogger("payments");
const site = () => env.CLIENT_URL.replace(/\/$/, "");
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ADMIN_TIME_ZONE = "Asia/Karachi";

type BuyerUser = Pick<UserDoc, "_id" | "name" | "email" | "role" | "region" | "plan" | "planExpiresAt"> & Partial<Pick<UserDoc, "exitOfferUsedAt" | "autoRenew">>;

const formatDay = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatMoment = (date: Date) => date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ADMIN_TIME_ZONE }) + " (Pakistan time)";

function toSummary(payment: PaymentDoc, user?: Pick<UserDoc, "_id" | "name" | "email"> | null): PaymentSummary {
  return {
    id: String(payment._id),
    user: user ? { id: String(user._id), name: user.name, email: user.email } : null,
    plan: payment.plan,
    currency: payment.currency,
    amount: payment.amount,
    listAmount: payment.listAmount,
    discountPercent: payment.discountPercent ?? 0,
    method: payment.method,
    status: payment.status,
    reference: payment.reference ?? null,
    note: payment.note ?? null,
    receiptNumber: payment.receiptNumber ?? null,
    periodStart: payment.periodStart ? payment.periodStart.toISOString() : null,
    periodEnd: payment.periodEnd ? payment.periodEnd.toISOString() : null,
    reviewNote: payment.reviewNote ?? null,
    seen: payment.seenAt != null,
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt ? payment.paidAt.toISOString() : null,
  };
}

// The currency this account pays in. Accounts without a country (made before sign-up asked) may
// choose; they are told to set their country to fix it.
function currencyFor(user: Pick<UserDoc, "region">, wanted?: Currency): Currency {
  if (user.region === "local") return "PKR";
  if (user.region === "international") return "USD";
  return wanted ?? "PKR";
}

// The one-time exit offer, while this account can still use it.
function offerFor(user: Partial<Pick<UserDoc, "exitOfferUsedAt">>, settings: PaymentSettings): PaymentSettings["exitOffer"] | null {
  return settings.exitOffer.enabled && !user.exitOfferUsedAt ? settings.exitOffer : null;
}

function requireStudent(user: Pick<UserDoc, "role">): void {
  if (user.role !== "student") throw AppError.forbidden("Only student accounts buy plans.");
}

// Plan, IP-derived currency, price and discount for a purchase, checked.
async function quote(user: BuyerUser, plan: PaidPlan, wantedCurrency: Currency | undefined, currency: Currency, useOffer: boolean, now: Date) {
  requireStudent(user);
  if (wantedCurrency && wantedCurrency !== currency) {
    throw AppError.badRequest(`Your location now uses ${currency} prices. Refresh checkout to see the current amount.`);
  }
  const [pricing, settings] = await Promise.all([settingsService.getPricing(), settingsService.getPayments()]);
  const pricePlan = pricing.plans.find((entry) => entry.id === plan);
  const listAmount = pricePlan ? parsePrice(pricePlan.price[currency]) : null;
  if (!pricePlan || listAmount === null) throw AppError.badRequest("This plan cannot be bought online yet. Contact LUE SAT on WhatsApp.");
  const offer = useOffer ? offerFor(user, settings) : null;
  const discountPercent = offer?.percentOff ?? 0;
  const period = periodFor({ plan: user.plan, planExpiresAt: user.planExpiresAt }, PLAN_MONTHS[plan], now);
  if (period.end === null) throw AppError.conflict("Your account already has a paid plan with no end date.");
  return { currency, planName: pricePlan.name, listAmount, amount: discounted(listAmount, discountPercent, currency), discountPercent, usedOffer: offer !== null, period, settings };
}

function methodsFor(settings: PaymentSettings, currency: Currency): CheckoutOption[] {
  const gateway = cardGateway();
  const options: CheckoutOption[] = [];
  if (gateway && gateway.currencies.includes(currency)) options.push({ method: "card", label: gateway.name === "test" ? "Card (test mode: no money is taken)" : "Card", instructions: null });
  for (const method of MANUAL_PAYMENT_METHODS) {
    const entry = settings.manual[method];
    if (entry.enabled && entry.currencies.includes(currency)) options.push({ method, label: PAYMENT_METHOD_LABELS[method], instructions: entry.instructions });
  }
  return options;
}

async function alertEmail(): Promise<string | null> {
  const settings = await settingsService.getPayments();
  return settings.alertEmail || env.PAYMENT_ALERT_EMAIL || null;
}

// The owner's "new payment" email (proposal 4.2): name, email, plan, amount, method and time. Sent
// once per payment: when a card payment goes through, or when a transfer arrives for approval.
async function sendAlert(payment: PaymentDoc, user: Pick<UserDoc, "name" | "email">): Promise<void> {
  const claimed = await PaymentModel.updateOne({ _id: payment._id, alertSentAt: null }, { $set: { alertSentAt: new Date() } });
  if (claimed.modifiedCount !== 1) return;
  const to = await alertEmail();
  if (!to) return;
  const review = payment.status === "review";
  await emailService.sendNotice(to, {
    subject: review ? `Transfer to approve: ${user.name}, ${formatMoney(payment.amount, payment.currency)}` : `New payment received: ${user.name}, ${formatMoney(payment.amount, payment.currency)}`,
    greeting: review ? "A student says they have paid by transfer. Check your account, then approve or reject it." : "A new payment was received on LUE SAT.",
    lines: [],
    rows: [
      ["Name", user.name],
      ["Email", user.email],
      ["Plan", PAID_PLAN_LABELS[payment.plan]],
      ["Amount", formatMoney(payment.amount, payment.currency) + (payment.discountPercent ? ` (${payment.discountPercent}% offer)` : "")],
      ["Method", PAYMENT_METHOD_LABELS[payment.method]],
      ...(payment.reference && review ? ([["Transaction ID", payment.reference]] as [string, string][]) : []),
      ["Time", formatMoment(payment.paidAt ?? payment.createdAt)],
    ],
    button: { label: review ? "Review it" : "Open Payments", link: `${site()}/admin/payments` },
  });
}

async function sendReceipt(payment: PaymentDoc, user: Pick<UserDoc, "name" | "email">): Promise<void> {
  await emailService.sendNotice(user.email, {
    subject: `Your LUE SAT receipt ${payment.receiptNumber ?? ""}`.trim(),
    greeting: `Hi ${firstName(user.name)},`,
    lines: [
      payment.method === "referral"
        ? `Thanks for inviting your friends! You have ${REFERRAL_REWARD_DAYS} days of the paid plan, free.`
        : "Thank you for your payment. Your account is upgraded and everything is unlocked.",
    ],
    rows: [
      ["Receipt", payment.receiptNumber ?? "—"],
      ["Plan", payment.method === "referral" ? `Free week (friend invites)` : PAID_PLAN_LABELS[payment.plan]],
      ["Amount", formatMoney(payment.amount, payment.currency)],
      ["Paid with", PAYMENT_METHOD_LABELS[payment.method]],
      ["Paid on", formatDay(payment.paidAt ?? new Date())],
      ...(payment.periodEnd ? ([["Access until", formatDay(payment.periodEnd)]] as [string, string][]) : []),
    ],
    button: { label: "Open your billing page", link: `${site()}/billing` },
    footer: "All payments are final. You can cancel renewal any time on your billing page; your plan then simply ends on its end date.",
  });
}

async function loadUser(id: mongoose.Types.ObjectId | string): Promise<UserDoc> {
  const user = await UserModel.findById(id).lean<UserDoc>();
  if (!user) throw AppError.notFound("User not found");
  return user;
}

export const paymentService = {
  async checkout(user: BuyerUser, query: CheckoutQuery, currency: Currency): Promise<Checkout> {
    const now = new Date();
    const q = await quote(user, query.plan, query.currency, currency, query.offer, now);
    const waiting = await PaymentModel.findOne({ userId: user._id, status: "review" }).sort({ createdAt: -1 }).lean<PaymentDoc>();
    return {
      plan: query.plan,
      planName: q.planName,
      currency: q.currency,
      amount: q.amount,
      listAmount: q.listAmount,
      discountPercent: q.discountPercent,
      periodStart: q.period.start.toISOString(),
      periodEnd: q.period.end!.toISOString(),
      methods: methodsFor(q.settings, q.currency),
      waiting: waiting ? toSummary(waiting) : null,
    };
  },

  // A bank transfer, JazzCash or Easypaisa payment the student made outside the site, for an admin to
  // approve. One may wait at a time; a transaction ID is accepted once.
  async submitManual(user: BuyerUser, input: ManualPaymentInput, currency: Currency): Promise<PaymentSummary> {
    const now = new Date();
    const q = await quote(user, input.plan, input.currency, currency, input.offer, now);
    const method = q.settings.manual[input.method];
    if (!method.enabled || !method.currencies.includes(q.currency)) throw AppError.badRequest(`${PAYMENT_METHOD_LABELS[input.method]} is not available for ${q.currency} payments.`);
    if (await PaymentModel.exists({ userId: user._id, status: "review" })) {
      throw AppError.conflict("A payment of yours is already waiting for approval. We will email you when it is checked.");
    }
    const duplicate = await PaymentModel.exists({ method: input.method, reference: new RegExp(`^${escapeRegex(input.reference)}$`, "i"), status: trusted({ $in: ["review", "paid"] }) });
    if (duplicate) throw AppError.conflict("This transaction ID has already been sent. Check it, or contact LUE SAT on WhatsApp.");
    const payment = await PaymentModel.create({
      userId: user._id,
      plan: input.plan,
      currency: q.currency,
      amount: q.amount,
      listAmount: q.listAmount,
      discountPercent: q.discountPercent,
      usedOffer: q.usedOffer,
      method: input.method,
      status: "review",
      reference: input.reference,
      note: input.note || null,
    });
    const doc = payment.toObject();
    void sendAlert(doc, user).catch((error) => logger.error("Payment alert failed", { error: toErrorMessage(error) }));
    return toSummary(doc);
  },

  // Opens the card gateway's checkout. The plan is given when the gateway confirms the payment.
  async startCard(user: BuyerUser, input: CardCheckoutInput, currency: Currency): Promise<{ redirectUrl: string }> {
    const gateway = cardGateway();
    if (!gateway) throw AppError.badRequest("Card payments are not available yet. Pay by transfer, or contact LUE SAT on WhatsApp.");
    const q = await quote(user, input.plan, input.currency, currency, input.offer, new Date());
    if (!gateway.currencies.includes(q.currency)) throw AppError.badRequest(`Card payments in ${q.currency} are not available yet.`);
    const payment = await PaymentModel.create({
      userId: user._id,
      plan: input.plan,
      currency: q.currency,
      amount: q.amount,
      listAmount: q.listAmount,
      discountPercent: q.discountPercent,
      usedOffer: q.usedOffer,
      method: "card",
      status: "pending",
      gateway: gateway.name,
      // The real payment never reaches the admins' list as "new" until it is paid.
      seenAt: new Date(),
    });
    const checkout = await gateway.createCheckout({
      paymentId: String(payment._id),
      amount: q.amount,
      currency: q.currency,
      description: `LUE SAT ${q.planName}`,
      customer: { name: user.name, email: user.email },
      returnUrl: `${site()}/billing?payment=${payment._id}`,
    });
    await PaymentModel.updateOne({ _id: payment._id }, { $set: { reference: checkout.reference } });
    return { redirectUrl: checkout.redirectUrl };
  },

  // The test gateway's "Pay" button (never in production).
  async completeTestPayment(user: Pick<UserDoc, "_id">, paymentId: string, outcome: "paid" | "failed"): Promise<PaymentSummary> {
    if (!isTestGatewayOn()) throw AppError.notFound("Not found");
    const payment = await PaymentModel.findOne({ _id: paymentId, userId: user._id, gateway: "test" }).lean<PaymentDoc>();
    if (!payment) throw AppError.notFound("Payment not found");
    if (outcome === "failed") {
      await PaymentModel.updateOne({ _id: payment._id, status: "pending" }, { $set: { status: "failed" } });
      return toSummary((await PaymentModel.findById(payment._id).lean<PaymentDoc>())!);
    }
    return toSummary(await this.markPaid(paymentId));
  },

  // Gives the plan for a payment, once: from "pending" (gateway) or "review" (approved transfer).
  // Calling it again for a paid payment returns it unchanged.
  async markPaid(paymentId: string, extra: { reviewedBy?: string; reviewNote?: string } = {}): Promise<PaymentDoc> {
    const now = new Date();
    const claimed = await PaymentModel.findOneAndUpdate(
      { _id: paymentId, status: trusted({ $in: ["pending", "review"] }) },
      {
        $set: {
          status: "paid",
          paidAt: now,
          ...(extra.reviewedBy ? { reviewedBy: new mongoose.Types.ObjectId(extra.reviewedBy), reviewedAt: now, reviewNote: extra.reviewNote || null } : {}),
        },
      },
      { new: true },
    ).lean<PaymentDoc>();
    if (!claimed) {
      const existing = await PaymentModel.findById(paymentId).lean<PaymentDoc>();
      if (!existing) throw AppError.notFound("Payment not found");
      if (existing.status === "paid") return existing;
      throw AppError.conflict(`This payment is ${existing.status} and cannot be marked paid.`);
    }
    const user = await loadUser(claimed.userId);
    // Re-read now: the plan may have changed since the checkout (another payment, an admin).
    const period = periodFor({ plan: user.plan, planExpiresAt: user.planExpiresAt }, PLAN_MONTHS[claimed.plan], now);
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: {
          plan: "paid",
          paidPlan: claimed.plan,
          planExpiresAt: period.end,
          autoRenew: true,
          ...(claimed.usedOffer ? { exitOfferUsedAt: now } : {}),
        },
      },
    );
    const paid = (await PaymentModel.findByIdAndUpdate(
      claimed._id,
      { $set: { periodStart: period.start, periodEnd: period.end, receiptNumber: receiptNumber(String(claimed._id), now), ...(claimed.method === "card" ? { seenAt: null } : {}) } },
      { new: true },
    ).lean<PaymentDoc>())!;
    void sendReceipt(paid, user).catch((error) => logger.error("Receipt failed", { error: toErrorMessage(error) }));
    if (paid.method === "card") void sendAlert(paid, user).catch((error) => logger.error("Payment alert failed", { error: toErrorMessage(error) }));
    logger.info("Plan given", { paymentId: String(paid._id), plan: paid.plan, until: period.end?.toISOString() ?? null });
    return paid;
  },

  // An admin approves (plan given, receipt sent) or rejects (the student is told why) a transfer.
  async review(adminId: string, id: string, decision: "approve" | "reject", note: string): Promise<PaymentSummary> {
    const payment = await PaymentModel.findById(id).lean<PaymentDoc>();
    if (!payment) throw AppError.notFound("Payment not found");
    if (!isManualMethod(payment.method)) throw AppError.badRequest("Only transfers are approved by hand.");
    if (payment.status !== "review") throw AppError.conflict(`This payment is already ${payment.status === "paid" ? "approved" : payment.status}.`);
    if (decision === "approve") {
      const paid = await this.markPaid(id, { reviewedBy: adminId, reviewNote: note });
      return toSummary(paid, await UserModel.findById(paid.userId).select("name email").lean<UserDoc>());
    }
    const rejected = await PaymentModel.findOneAndUpdate(
      { _id: id, status: "review" },
      { $set: { status: "rejected", reviewedBy: new mongoose.Types.ObjectId(adminId), reviewedAt: new Date(), reviewNote: note || null } },
      { new: true },
    ).lean<PaymentDoc>();
    if (!rejected) throw AppError.conflict("This payment was just reviewed by someone else.");
    const user = await UserModel.findById(rejected.userId).select("name email").lean<UserDoc>();
    if (user) {
      void emailService
        .sendNotice(user.email, {
          subject: "Your LUE SAT payment could not be confirmed",
          greeting: `Hi ${firstName(user.name)},`,
          lines: [
            `We could not find your ${PAYMENT_METHOD_LABELS[rejected.method]} payment of ${formatMoney(rejected.amount, rejected.currency)} (transaction ID ${rejected.reference ?? "—"}).`,
            ...(note ? [`Note from LUE SAT: ${note}`] : []),
            "If you did pay, send the transaction ID again from your billing page or message us on WhatsApp, and we will sort it out.",
          ],
          button: { label: "Open your billing page", link: `${site()}/billing` },
        })
        .catch(() => undefined);
    }
    return toSummary(rejected, user);
  },

  async billing(user: UserDoc): Promise<Billing> {
    const [payments, settings, code, joined, qualified] = await Promise.all([
      PaymentModel.find({ userId: user._id, status: trusted({ $ne: "pending" }) }).sort({ createdAt: -1 }).limit(50).lean<PaymentDoc[]>(),
      settingsService.getPayments(),
      ensureFriendCode(user),
      UserModel.countDocuments({ referredBy: user._id }),
      UserModel.countDocuments({ referredBy: user._id, referralQualifiedAt: trusted({ $ne: null }) }),
    ]);
    const offer = offerFor(user, settings);
    const now = new Date();
    const paidNow = user.plan === "paid" && (!user.planExpiresAt || user.planExpiresAt > now);
    return {
      plan: paidNow ? "paid" : "free",
      paidPlan: paidNow && user.paidPlan && user.paidPlan in PLAN_MONTHS ? (user.paidPlan as PaidPlan) : null,
      planExpiresAt: paidNow && user.planExpiresAt ? user.planExpiresAt.toISOString() : null,
      autoRenew: user.autoRenew !== false,
      currency: user.region ? currencyFor(user) : null,
      payments: payments.map((payment) => toSummary(payment)),
      referrals: { code, joined, qualified, rewards: user.referralRewards ?? 0, enabled: settings.referrals.enabled },
      offer: offer ? { percentOff: offer.percentOff, headline: offer.headline } : null,
    };
  },

  // "Cancel" (proposal: one-click cancel): no renewal reminders; the plan ends on its end date. No
  // money is ever taken automatically by the payment methods in use now.
  async setAutoRenew(user: Pick<UserDoc, "_id">, autoRenew: boolean): Promise<void> {
    await UserModel.updateOne({ _id: user._id }, { $set: { autoRenew } });
  },

  // `anyAccount`: the admin route (payments:read); otherwise only the account's own receipts.
  async receipt(user: Pick<UserDoc, "_id">, id: string, anyAccount = false): Promise<PaymentSummary> {
    const payment = await PaymentModel.findById(id).lean<PaymentDoc>();
    if (!payment || (!anyAccount && String(payment.userId) !== String(user._id))) throw AppError.notFound("Receipt not found");
    if (payment.status !== "paid") throw AppError.notFound("Receipt not found");
    return toSummary(payment, await UserModel.findById(payment.userId).select("name email").lean<UserDoc>());
  },

  // ---------- admin ----------

  async list(query: PaymentListQuery): Promise<{ payments: PaymentSummary[]; total: number; page: number; pageSize: number }> {
    const and: Record<string, unknown>[] = [];
    // Card checkouts that were never finished are not payments.
    and.push(query.status ? { status: query.status } : { status: trusted({ $ne: "pending" }) });
    if (query.currency) and.push({ currency: query.currency });
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), "i");
      const users = await UserModel.find({ $or: trusted([{ name: pattern }, { email: pattern }, { phone: pattern }]) }).select("_id").limit(500).lean<UserDoc[]>();
      and.push({ $or: trusted([{ userId: trusted({ $in: users.map((user) => user._id) }) }, { reference: pattern }, { receiptNumber: pattern }]) });
    }
    const filter = { $and: trusted(and) };
    const [payments, total] = await Promise.all([
      PaymentModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<PaymentDoc[]>(),
      PaymentModel.countDocuments(filter),
    ]);
    const users = await UserModel.find({ _id: trusted({ $in: payments.map((payment) => payment.userId) }) }).select("name email").lean<UserDoc[]>();
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return { payments: payments.map((payment) => toSummary(payment, byId.get(String(payment.userId)) ?? null)), total, page: query.page, pageSize: query.pageSize };
  },

  // Opening the Payments page clears the red badge.
  async markAllSeen(): Promise<{ seen: number }> {
    const result = await PaymentModel.updateMany({ seenAt: null, status: trusted({ $ne: "pending" }) }, { $set: { seenAt: new Date() } });
    return { seen: result.modifiedCount };
  },

  async forUser(userId: string): Promise<PaymentSummary[]> {
    const payments = await PaymentModel.find({ userId, status: trusted({ $ne: "pending" }) }).sort({ createdAt: -1 }).limit(100).lean<PaymentDoc[]>();
    return payments.map((payment) => toSummary(payment));
  },

  async counts(): Promise<{ unseen: number; toReview: number }> {
    const [unseen, toReview] = await Promise.all([
      PaymentModel.countDocuments({ seenAt: null, status: trusted({ $ne: "pending" }) }),
      PaymentModel.countDocuments({ status: "review" }),
    ]);
    return { unseen, toReview };
  },

  // Money received, this month (Pakistan time) and all time. Free weeks are not money.
  async revenue(now = new Date()): Promise<Record<Currency, { month: number; total: number }>> {
    const monthStart = new Date(`${dayIn(now, ADMIN_TIME_ZONE).slice(0, 7)}-01T00:00:00+05:00`);
    // Aggregation pipelines are not sanitized: values are fixed strings and a Date.
    const rows = await PaymentModel.aggregate<{ _id: Currency; total: number; month: number }>([
      { $match: { status: "paid", method: { $ne: "referral" } } },
      { $group: { _id: "$currency", total: { $sum: "$amount" }, month: { $sum: { $cond: [{ $gte: ["$paidAt", monthStart] }, "$amount", 0] } } } },
    ]);
    const result = Object.fromEntries(CURRENCIES.map((currency) => [currency, { month: 0, total: 0 }])) as Record<Currency, { month: number; total: number }>;
    for (const row of rows) if (row._id in result) result[row._id] = { month: Math.round(row.month * 100) / 100, total: Math.round(row.total * 100) / 100 };
    return result;
  },

  // ---------- friend invites (run by the scheduler) ----------

  // Friends who signed up with a student's link count once they have practised a little
  // (REFERRAL_QUALIFY_POINTS); every two give the inviter a free week (at most a few times).
  async processReferrals(now = new Date()): Promise<{ qualified: number; rewarded: number }> {
    const settings = await settingsService.getPayments();
    const ready = await UserModel.find({
      referredBy: trusted({ $ne: null }),
      referralQualifiedAt: null,
      status: "active",
      totalPoints: trusted({ $gte: REFERRAL_QUALIFY_POINTS }),
    })
      .select("_id referredBy")
      .limit(1000)
      .lean<UserDoc[]>();
    let qualified = 0;
    const inviters = new Set<string>();
    for (const friend of ready) {
      const done = await UserModel.updateOne({ _id: friend._id, referralQualifiedAt: null }, { $set: { referralQualifiedAt: now } });
      if (done.modifiedCount === 1) {
        qualified += 1;
        inviters.add(String(friend.referredBy));
      }
    }
    let rewarded = 0;
    if (!settings.referrals.enabled) return { qualified, rewarded };
    for (const inviterId of inviters) {
      const inviter = await UserModel.findOne({ _id: inviterId, role: "student", status: "active" }).lean<UserDoc>();
      if (!inviter) continue;
      const count = await UserModel.countDocuments({ referredBy: inviter._id, referralQualifiedAt: trusted({ $ne: null }) });
      const given = inviter.referralRewards ?? 0;
      const due = referralRewardsDue(count, given);
      for (let index = 0; index < due; index += 1) {
        // Claim the reward first, so two runs never give the same week twice.
        const claim = await UserModel.updateOne({ _id: inviter._id, referralRewards: given + index }, { $inc: { referralRewards: 1 } });
        if (claim.modifiedCount !== 1) break;
        const current = (await UserModel.findById(inviter._id).lean<UserDoc>())!;
        const live = current.plan === "paid" && (!current.planExpiresAt || current.planExpiresAt > now);
        const end = extendByDays({ plan: live ? "paid" : "free", planExpiresAt: current.planExpiresAt }, REFERRAL_REWARD_DAYS, now);
        if (end) await UserModel.updateOne({ _id: inviter._id }, { $set: { plan: "paid", planExpiresAt: end, ...(live ? {} : { paidPlan: null }) } });
        const payment = await PaymentModel.create({
          userId: inviter._id,
          plan: live && current.paidPlan && current.paidPlan in PLAN_MONTHS ? current.paidPlan : "monthly",
          currency: currencyFor(current),
          amount: 0,
          listAmount: 0,
          method: "referral",
          status: "paid",
          paidAt: now,
          periodStart: live && current.planExpiresAt ? current.planExpiresAt : now,
          periodEnd: end,
          receiptNumber: null,
          // Not money: no badge, no alert.
          seenAt: now,
          alertSentAt: now,
        });
        await PaymentModel.updateOne({ _id: payment._id }, { $set: { receiptNumber: receiptNumber(String(payment._id), now) } });
        void sendReceipt({ ...payment.toObject(), receiptNumber: receiptNumber(String(payment._id), now) }, inviter).catch(() => undefined);
        rewarded += 1;
      }
    }
    return { qualified, rewarded };
  },
};
