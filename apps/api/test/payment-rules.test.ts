import assert from "node:assert/strict";
import { test } from "node:test";
import { currencyForIpCountry, DEFAULT_ACCESS, formatMoney, parsePrice } from "@satsharks/types";
import { accessSettingsSchema, paymentSettingsSchema, registerSchema } from "@satsharks/validation";
import { accessFor, drillSize } from "../src/services/access.service";
import { startOfLocalDay } from "../src/services/engagement-rules";
import { addMonths, csvCell, discounted, extendByDays, periodFor, receiptNumber, referralRewardsDue } from "../src/services/payment-rules";

const at = (iso: string) => new Date(iso);

test("prices typed on the pricing page become amounts", () => {
  assert.equal(parsePrice("PKR 1,500"), 1500);
  assert.equal(parsePrice("$12.99"), 12.99);
  assert.equal(parsePrice("Rs. 3,500 / 3 months"), 3500);
  assert.equal(parsePrice("PKR 0"), null);
  assert.equal(parsePrice("Ask us"), null);
  assert.equal(formatMoney(3500, "PKR"), "PKR 3,500");
  assert.equal(formatMoney(29.99, "USD"), "$29.99");
  assert.equal(formatMoney(30, "USD"), "$30");
});

test("purchase currency follows the current public-IP country", () => {
  assert.equal(currencyForIpCountry("PK"), "PKR");
  assert.equal(currencyForIpCountry("pk"), "PKR");
  assert.equal(currencyForIpCountry("US"), "USD");
  assert.equal(currencyForIpCountry("AE"), "USD");
  assert.equal(currencyForIpCountry(null), "USD");
});

test("months are calendar months; the 31st becomes the last day of a shorter month", () => {
  assert.equal(addMonths(at("2026-01-31T10:00:00Z"), 1).toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(addMonths(at("2028-01-31T10:00:00Z"), 1).toISOString(), "2028-02-29T10:00:00.000Z");
  assert.equal(addMonths(at("2026-11-15T00:00:00Z"), 3).toISOString(), "2027-02-15T00:00:00.000Z");
});

test("a payment's period starts now, or after a plan that is still running", () => {
  const now = at("2026-10-19T12:00:00Z");
  assert.deepEqual(periodFor({ plan: "free", planExpiresAt: null }, 1, now), { start: now, end: at("2026-11-19T12:00:00Z") });
  // Renewing early keeps the days left.
  const running = at("2026-10-25T00:00:00Z");
  assert.deepEqual(periodFor({ plan: "paid", planExpiresAt: running }, 3, now), { start: running, end: at("2027-01-25T00:00:00Z") });
  // An expired plan counts from now.
  assert.deepEqual(periodFor({ plan: "paid", planExpiresAt: at("2026-10-01T00:00:00Z") }, 1, now).start, now);
  // Paid with no end date (given by an admin) stays without one.
  assert.equal(periodFor({ plan: "paid", planExpiresAt: null }, 1, now).end, null);
  assert.equal(extendByDays({ plan: "free", planExpiresAt: null }, 7, now)!.toISOString(), "2026-10-26T12:00:00.000Z");
  assert.equal(extendByDays({ plan: "paid", planExpiresAt: running }, 7, now)!.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(extendByDays({ plan: "paid", planExpiresAt: null }, 7, now), null);
});

test("offers round to whole rupees and to cents", () => {
  assert.equal(discounted(3500, 15, "PKR"), 2975);
  assert.equal(discounted(1499, 15, "PKR"), 1274);
  assert.equal(discounted(29.99, 15, "USD"), 25.49);
  assert.equal(discounted(12.99, 0, "USD"), 12.99);
});

test("receipt numbers, friend-invite weeks and CSV cells", () => {
  assert.equal(receiptNumber("6713a0c2f1e4b3a2c94f2a9c", at("2026-10-19T08:00:00Z")), "SS-20261019-4F2A9C");
  assert.equal(referralRewardsDue(0, 0), 0);
  assert.equal(referralRewardsDue(1, 0), 0);
  assert.equal(referralRewardsDue(2, 0), 1);
  assert.equal(referralRewardsDue(5, 1), 1);
  assert.equal(referralRewardsDue(40, 0), 5);
  assert.equal(referralRewardsDue(40, 5), 0);
  assert.equal(csvCell('Ali "the Shark"'), '"Ali ""the Shark"""');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell(null), "");
});

test("the local day starts at local midnight", () => {
  // 01:30 in Karachi (UTC+5) on Oct 19 = 20:30 UTC on Oct 18.
  assert.equal(startOfLocalDay(at("2026-10-18T20:30:00Z"), "Asia/Karachi").toISOString(), "2026-10-18T19:00:00.000Z");
  assert.equal(startOfLocalDay(at("2026-10-19T23:59:00Z"), "UTC").toISOString(), "2026-10-19T00:00:00.000Z");
  // New York on the day clocks go back (Nov 1 2026): midnight is still EDT (UTC−4).
  assert.equal(startOfLocalDay(at("2026-11-01T15:00:00Z"), "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
});

test("invite-only content opens with its code, not with a paid plan; the daily drill limit cuts drills", () => {
  const settings = accessSettingsSchema.parse({
    ...DEFAULT_ACCESS,
    content: [
      { key: "exam-a", level: "invite", inviteCode: "SCHOOL-1" },
      { key: "exam-b", level: "paid", pinned: true, label: "hard" },
      { key: "exam-c", level: "free" },
    ],
    freeDrillQuestionsPerDay: 20,
  });
  const free = accessFor({ role: "student", plan: "free", planExpiresAt: null }, settings, 15);
  assert.equal(free.lockReason("exam-a"), "invite");
  assert.equal(free.lockReason("exam-b"), "paid");
  assert.equal(free.content("exam-c"), true);
  assert.deepEqual(free.summary.dailyDrill, { limit: 20, used: 15 });
  assert.equal(drillSize(free, 10), 5);
  assert.throws(() => drillSize(accessFor({ role: "student", plan: "free", planExpiresAt: null }, settings, 20), 10), /drill questions a day/);

  const paid = accessFor({ role: "student", plan: "paid", planExpiresAt: null }, settings, 99);
  assert.equal(paid.lockReason("exam-a"), "invite");
  assert.equal(paid.content("exam-b"), true);
  assert.equal(drillSize(paid, 50), 50);
  const invited = accessFor({ role: "student", plan: "free", planExpiresAt: null, inviteKeys: ["exam-a"] }, settings);
  assert.equal(invited.content("exam-a"), true);
  assert.equal(accessFor({ role: "staff", plan: "free", planExpiresAt: null }, settings).content("exam-a"), true);
  assert.deepEqual([paid.rule("exam-b").pinned, paid.rule("exam-b").label], [true, "hard"]);

  // An invite-only rule needs a code, and two rules cannot share one.
  assert.equal(accessSettingsSchema.safeParse({ ...DEFAULT_ACCESS, content: [{ key: "x", level: "invite" }] }).success, false);
  assert.equal(
    accessSettingsSchema.safeParse({ ...DEFAULT_ACCESS, content: [{ key: "x", level: "invite", inviteCode: "ABCD" }, { key: "y", level: "invite", inviteCode: "abcd" }] }).success,
    false,
  );
  // Settings saved before Week 4 still read.
  assert.equal(accessSettingsSchema.parse({ features: DEFAULT_ACCESS.features, content: [{ key: "x", level: "paid" }], newContent: "free" }).freeDrillQuestionsPerDay, null);
});

test("sign-up takes an optional phone, test date and invite code", () => {
  const base = { name: "Ayesha Rehman", email: "a@example.com", password: "password-123", country: "PK" };
  const parsed = registerSchema.parse({ ...base, phone: "+92 300 123-4567", testDate: "2026-12-05", ref: "ab3defgh" });
  assert.deepEqual([parsed.phone, parsed.testDate, parsed.ref], ["+923001234567", "2026-12-05", "AB3DEFGH"]);
  assert.deepEqual(registerSchema.parse({ ...base, phone: "", testDate: "" }).phone, undefined);
  assert.equal(registerSchema.safeParse({ ...base, phone: "12" }).success, false);
  // A broken invite code never blocks a sign-up.
  assert.equal(registerSchema.parse({ ...base, ref: "!!" }).ref, undefined);
});

test("payment settings need account details for every way to pay that is on", () => {
  const valid = {
    manual: {
      bank_transfer: { enabled: true, instructions: "Meezan Bank, SAT Sharks, PK00 MEZN 0000 0000 0000", currencies: ["PKR"] },
      jazzcash: { enabled: false, instructions: "", currencies: ["PKR"] },
      easypaisa: { enabled: false, instructions: "", currencies: ["PKR"] },
    },
    alertEmail: "Owner@Gmail.com",
    exitOffer: { enabled: true, percentOff: 15, headline: "Take {percent}% off" },
    referrals: { enabled: true },
  };
  assert.equal(paymentSettingsSchema.parse(valid).alertEmail, "owner@gmail.com");
  assert.equal(paymentSettingsSchema.safeParse({ ...valid, manual: { ...valid.manual, jazzcash: { enabled: true, instructions: "", currencies: ["PKR"] } } }).success, false);
  assert.equal(paymentSettingsSchema.safeParse({ ...valid, exitOffer: { ...valid.exitOffer, percentOff: 80 } }).success, false);
});
