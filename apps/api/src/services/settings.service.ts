import { SettingModel } from "@satsharks/db";
import {
  DEFAULT_ACCESS,
  DEFAULT_CONVERSION_TABLES,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_PRICING,
  LEGACY_PAID_PLANS,
  DEFAULT_ROUTING_THRESHOLD_PERCENT,
  DEFAULT_SAT_DATES,
  type AccessSettings,
  type AdaptiveSettings,
  type ConversionTables,
  type PaymentSettings,
  type PricingContent,
  type SatDatesContent,
} from "@satsharks/types";
import { accessSettingsSchema, conversionTablesSchema, paymentSettingsSchema, pricingContentSchema, satDatesContentSchema } from "@satsharks/validation";
import { emptyConversionTables } from "./scoring";

const ADAPTIVE_KEY = "adaptive";
const SCORING_KEY = "scoring.conversionTables";
const PRICING_KEY = "pricing";
const ACCESS_KEY = "access";
const SAT_DATES_KEY = "satDates";
const PAYMENTS_KEY = "payments";

// Scores are read for every attempt in a list, so the tables are kept in memory briefly. Saving
// clears the copy at once on this instance.
const TABLES_TTL_MS = 30_000;
let tablesCache: { value: ConversionTables; expires: number } | null = null;
let accessCache: { value: AccessSettings; expires: number } | null = null;

export const settingsService = {
  async getAdaptive(): Promise<AdaptiveSettings> {
    const stored = await SettingModel.findOne({ key: ADAPTIVE_KEY }).lean();
    const value = (stored?.value ?? {}) as Partial<AdaptiveSettings>;
    return {
      routingThresholdPercent:
        typeof value.routingThresholdPercent === "number" ? value.routingThresholdPercent : DEFAULT_ROUTING_THRESHOLD_PERCENT,
      // On unless an admin turned it off (settings saved before it existed have no value).
      officialPattern: value.officialPattern !== false,
    };
  },

  // Applies to mocks whose Module 1 is submitted after the change; finished routing is never redone.
  async setAdaptive(settings: AdaptiveSettings, userId: string): Promise<AdaptiveSettings> {
    await SettingModel.updateOne({ key: ADAPTIVE_KEY }, { $set: { value: settings, updatedBy: userId } }, { upsert: true });
    return this.getAdaptive();
  },

  async getConversionTables(): Promise<ConversionTables> {
    if (tablesCache && tablesCache.expires > Date.now()) return tablesCache.value;
    const stored = await SettingModel.findOne({ key: SCORING_KEY }).lean();
    // A stored value that no longer validates (e.g. the format changed) is treated as missing.
    const parsed = conversionTablesSchema.safeParse(stored?.value);
    // A route without an entered table uses the built-in estimate, so every finished section is scored.
    const entered = parsed.success ? parsed.data : emptyConversionTables();
    const value: ConversionTables = {
      reading_writing: {
        m2_easy: entered.reading_writing.m2_easy ?? DEFAULT_CONVERSION_TABLES.reading_writing.m2_easy,
        m2_hard: entered.reading_writing.m2_hard ?? DEFAULT_CONVERSION_TABLES.reading_writing.m2_hard,
      },
      math: {
        m2_easy: entered.math.m2_easy ?? DEFAULT_CONVERSION_TABLES.math.m2_easy,
        m2_hard: entered.math.m2_hard ?? DEFAULT_CONVERSION_TABLES.math.m2_hard,
      },
    };
    tablesCache = { value, expires: Date.now() + TABLES_TTL_MS };
    return value;
  },

  // Finished attempts keep the score they were given; attempts finished before any table existed
  // are scored the next time they are read.
  async setConversionTables(tables: ConversionTables, userId: string): Promise<ConversionTables> {
    await SettingModel.updateOne({ key: SCORING_KEY }, { $set: { value: tables, updatedBy: userId } }, { upsert: true });
    tablesCache = null;
    return this.getConversionTables();
  },

  // Shown on the public pricing page. Until an admin saves their own, the proposal's plans.
  async getPricing(): Promise<PricingContent> {
    const stored = await SettingModel.findOne({ key: PRICING_KEY }).lean<{ value?: { plans?: unknown } }>();
    // Pricing saved before a plan was removed (Till Test Day, 2026-10-16) still lists it: drop it
    // so the admin's other wording and prices are kept.
    const value = stored?.value && Array.isArray(stored.value.plans)
      ? { ...stored.value, plans: stored.value.plans.filter((plan: { id?: unknown }) => !(LEGACY_PAID_PLANS as readonly unknown[]).includes(plan?.id)) }
      : stored?.value;
    const parsed = pricingContentSchema.safeParse(value);
    return parsed.success ? (parsed.data as PricingContent) : DEFAULT_PRICING;
  },

  async setPricing(pricing: PricingContent, userId: string): Promise<PricingContent> {
    await SettingModel.updateOne({ key: PRICING_KEY }, { $set: { value: pricing, updatedBy: userId } }, { upsert: true });
    return this.getPricing();
  },

  // Shown on the public SAT dates page and the dashboard countdown. Until an admin saves their own,
  // College Board's published dates.
  async getSatDates(): Promise<SatDatesContent> {
    const stored = await SettingModel.findOne({ key: SAT_DATES_KEY }).lean();
    const parsed = satDatesContentSchema.safeParse(stored?.value);
    return parsed.success ? parsed.data : DEFAULT_SAT_DATES;
  },

  async setSatDates(content: SatDatesContent, userId: string): Promise<SatDatesContent> {
    await SettingModel.updateOne({ key: SAT_DATES_KEY }, { $set: { value: content, updatedBy: userId } }, { upsert: true });
    return this.getSatDates();
  },

  // Read on every catalog load and every start, so kept in memory briefly like the tables.
  async getAccess(): Promise<AccessSettings> {
    if (accessCache && accessCache.expires > Date.now()) return accessCache.value;
    const stored = await SettingModel.findOne({ key: ACCESS_KEY }).lean();
    const parsed = accessSettingsSchema.safeParse(stored?.value);
    const value = parsed.success ? parsed.data : DEFAULT_ACCESS;
    accessCache = { value, expires: Date.now() + TABLES_TTL_MS };
    return value;
  },

  // Ways to pay, the alert email, the exit offer and friend invites (Admin → Settings → Payments).
  // Until saved: no manual ways to pay, no offer, friend invites on.
  async getPayments(): Promise<PaymentSettings> {
    const stored = await SettingModel.findOne({ key: PAYMENTS_KEY }).lean();
    const parsed = paymentSettingsSchema.safeParse(stored?.value);
    return parsed.success ? parsed.data : DEFAULT_PAYMENT_SETTINGS;
  },

  async setPayments(settings: PaymentSettings, userId: string): Promise<PaymentSettings> {
    await SettingModel.updateOne({ key: PAYMENTS_KEY }, { $set: { value: settings, updatedBy: userId } }, { upsert: true });
    return this.getPayments();
  },

  // Applies to what is started from now on; attempts already begun can always be finished.
  async setAccess(settings: AccessSettings, userId: string): Promise<AccessSettings> {
    await SettingModel.updateOne({ key: ACCESS_KEY }, { $set: { value: settings, updatedBy: userId } }, { upsert: true });
    accessCache = null;
    return this.getAccess();
  },
};
