"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MOCK_FORMAT,
  SCORE_ROUTES,
  SECTION_LABELS,
  SECTION_SCORE_MAX,
  SECTION_SCORE_MIN,
  SECTIONS,
  sectionQuestionCount,
  type AdaptiveSettings,
  type ConversionTables,
  type ScoreRoute,
  type Section,
} from "@satsharks/types";
import { Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { PaymentSettingsCard } from "@/components/payment-settings";
import { PricingSettingsCard } from "@/components/pricing-settings";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";

const ROUTE_LABELS: Record<ScoreRoute, string> = { m2_easy: "After the easier Module 2", m2_hard: "After the harder Module 2" };

// The share of Module 1 a student must get right to be given the harder Module 2.
function AdaptiveSettingsCard({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["admin", "settings", "adaptive"], queryFn: () => api<AdaptiveSettings>("/api/admin/settings/adaptive") });
  const [value, setValue] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const current = settings.data?.routingThresholdPercent;
  const shown = value ?? (current !== undefined ? String(current) : "");
  const percent = Number(shown);
  const valid = Number.isInteger(percent) && percent >= 1 && percent <= 100;
  const need = (size: number) => Math.ceil((size * percent) / 100);

  async function save(body: AdaptiveSettings, done: string) {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api<AdaptiveSettings>("/api/admin/settings/adaptive", { method: "PUT", body });
      queryClient.setQueryData(["admin", "settings", "adaptive"], saved);
      setValue(null);
      setMessage({ tone: "info", text: done });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="font-bold">Adaptive routing</h2>
      <p className="mt-1 text-sm text-slate-600">Share of Module 1 a student must get right to be given the harder Module 2.</p>
      <div className="mt-3 flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={100}
          value={shown}
          disabled={!canWrite || settings.isLoading}
          onChange={(event) => setValue(event.target.value)}
          aria-label="Routing threshold in percent"
          className="h-10 w-24 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500"
        />
        <span className="text-sm font-bold">%</span>
        {canWrite && (
          <Button
            size="sm"
            disabled={saving || !valid || percent === current}
            onClick={() => save({ routingThresholdPercent: percent, officialPattern: settings.data?.officialPattern ?? true }, "Saved. Applies to mocks whose Module 1 is submitted from now on.")}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {valid && (
        <p className="mt-2 text-xs text-slate-600">
          Math: {need(MOCK_FORMAT.math.questionsPerModule)} of {MOCK_FORMAT.math.questionsPerModule} · Reading &amp; Writing: {need(MOCK_FORMAT.reading_writing.questionsPerModule)} of{" "}
          {MOCK_FORMAT.reading_writing.questionsPerModule}
        </p>
      )}
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 border-t border-slate-200 pt-4 text-sm">
        <input
          type="checkbox"
          checked={settings.data?.officialPattern ?? true}
          disabled={!canWrite || saving || !settings.data}
          onChange={(event) =>
            save(
              { routingThresholdPercent: current ?? percent, officialPattern: event.target.checked },
              event.target.checked ? "Saved. New mocks follow the official question pattern." : "Saved. New mocks take one question per skill in turn.",
            )
          }
          className="mt-0.5 h-4 w-4 accent-brand-500"
        />
        <span>
          <span className="font-bold">Official question pattern</span>
          <span className="mt-0.5 block text-slate-600">
            Every mock module has the same make-up and order as the official SAT: Reading &amp; Writing from Words in Context to Rhetorical Synthesis with a fixed number of
            each, Math with fixed counts per domain and typed answers in fixed places. Off: one question per skill in turn.
          </span>
        </span>
      </label>
      {message && (
        <div className="mt-2">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
    </Card>
  );
}

type Drafts = Record<Section, Record<ScoreRoute, string>>;

const toText = (table: number[] | null) => (table ? table.join(", ") : "");

// Checks one table as typed. Returns the scores, null for "no table", or an error.
function parseTable(text: string, section: Section): { scores: number[] | null; error: string | null } {
  if (text.trim() === "") return { scores: null, error: null };
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const scores = parts.map(Number);
  const expected = sectionQuestionCount(section) + 1;
  if (scores.some((score) => !Number.isInteger(score))) return { scores: null, error: "Only whole numbers, separated by commas or spaces." };
  if (scores.length !== expected) return { scores: null, error: `${scores.length} scores entered; ${expected} are needed (0 to ${expected - 1} correct).` };
  if (scores.some((score) => score < SECTION_SCORE_MIN || score > SECTION_SCORE_MAX)) return { scores: null, error: `Every score must be between ${SECTION_SCORE_MIN} and ${SECTION_SCORE_MAX}.` };
  if (scores.some((score) => score % 10 !== 0)) return { scores: null, error: "Scores go up in steps of 10." };
  const drop = scores.findIndex((score, index) => index > 0 && score < scores[index - 1]!);
  if (drop > 0) return { scores: null, error: `The score falls at ${drop} correct (${scores[drop - 1]} → ${scores[drop]}). Scores must never go down.` };
  return { scores, error: null };
}

function ConversionTablesCard({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const tables = useQuery({ queryKey: ["admin", "settings", "scoring"], queryFn: () => api<ConversionTables>("/api/admin/settings/scoring") });
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (tables.data && drafts === null) {
      setDrafts({
        reading_writing: { m2_easy: toText(tables.data.reading_writing.m2_easy), m2_hard: toText(tables.data.reading_writing.m2_hard) },
        math: { m2_easy: toText(tables.data.math.m2_easy), m2_hard: toText(tables.data.math.m2_hard) },
      });
    }
  }, [tables.data, drafts]);

  if (tables.isLoading || !drafts) return <Card>{tables.error ? <Notice tone="error">{tables.error.message}</Notice> : <Spinner label="Loading conversion tables" />}</Card>;

  const parsed = Object.fromEntries(
    SECTIONS.map((section) => [section, Object.fromEntries(SCORE_ROUTES.map((route) => [route, parseTable(drafts[section][route], section)]))]),
  ) as Record<Section, Record<ScoreRoute, ReturnType<typeof parseTable>>>;
  const hasError = SECTIONS.some((section) => SCORE_ROUTES.some((route) => parsed[section][route].error));
  const missing = SECTIONS.flatMap((section) => SCORE_ROUTES.filter((route) => !parsed[section][route].scores && !parsed[section][route].error).map((route) => `${SECTION_LABELS[section]} (${route === "m2_easy" ? "easier" : "harder"})`));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const body = Object.fromEntries(SECTIONS.map((section) => [section, Object.fromEntries(SCORE_ROUTES.map((route) => [route, parsed[section][route].scores]))]));
      const saved = await api<ConversionTables>("/api/admin/settings/scoring", { method: "PUT", body });
      queryClient.setQueryData(["admin", "settings", "scoring"], saved);
      setMessage({ tone: "info", text: "Saved. New results use these tables; finished mocks without a score get one the next time they are opened." });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h2 className="font-bold">Score conversion tables</h2>
      <p className="mt-1 text-sm text-slate-600">
        Section scores (200–800) are read from these tables using the number of correct answers over both modules. The total score (400–1600) is the two section scores added together.
        Enter one score per raw count, starting at 0 correct, separated by commas or spaces. Until SAT Sharks enters its own, a built-in estimate (shown here) is used; edit and save to replace it. A table left empty goes back to the estimate.
      </p>
      {missing.length > 0 && (
        <div className="mt-3">
          <Notice tone="info">Not entered yet: {missing.join(", ")}.</Notice>
        </div>
      )}
      <fieldset disabled={!canWrite || saving} className="mt-4 grid gap-4 xl:grid-cols-2">
        {SECTIONS.map((section) =>
          SCORE_ROUTES.map((route) => {
            const result = parsed[section][route];
            const count = sectionQuestionCount(section);
            return (
              <label key={`${section}-${route}`} className="block text-xs font-bold">
                {SECTION_LABELS[section]} · {ROUTE_LABELS[route]} <span className="font-normal text-slate-500">({count + 1} scores: 0–{count} correct)</span>
                <textarea
                  rows={3}
                  value={drafts[section][route]}
                  onChange={(event) => setDrafts({ ...drafts, [section]: { ...drafts[section], [route]: event.target.value } })}
                  placeholder={`e.g. 200, 200, 210, … , ${SECTION_SCORE_MAX}`}
                  aria-invalid={result.error ? true : undefined}
                  className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 font-mono text-xs font-normal outline-none focus:border-brand-500 ${result.error ? "border-red-500" : "border-slate-300"}`}
                />
                {result.error ? (
                  <span className="mt-1 block font-medium text-red-700">{result.error}</span>
                ) : result.scores ? (
                  <span className="mt-1 block font-normal text-slate-600">
                    0 correct → {result.scores[0]} · {Math.floor(count / 2)} correct → {result.scores[Math.floor(count / 2)]} · {count} correct → {result.scores[count]}
                  </span>
                ) : (
                  <span className="mt-1 block font-normal text-slate-500">Empty: the built-in estimate is used for this route.</span>
                )}
              </label>
            );
          }),
        )}
      </fieldset>
      {message && (
        <div className="mt-3">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      {canWrite ? (
        <Button className="mt-4" disabled={saving || hasError} onClick={save}>
          {saving ? "Saving…" : "Save conversion tables"}
        </Button>
      ) : (
        <p className="mt-3 text-sm text-slate-600">Your account can view these settings but not change them.</p>
      )}
    </Card>
  );
}

export default function AdminSettingsPage() {
  const { data: user } = useMe();
  const canWrite = user?.permissions.includes("papers:write") ?? false;
  const payments = user?.permissions.includes("payments:read") ?? false;
  return (
    <>
      <PageHeader title="Settings" subtitle="Adaptive routing and scoring for mocks and full tests, the plans on the pricing page, and payments." />
      <div className="grid gap-4">
        <div className="max-w-xl">
          <AdaptiveSettingsCard canWrite={canWrite} />
        </div>
        <ConversionTablesCard canWrite={canWrite} />
        <PricingSettingsCard canWrite={canWrite} />
        {payments && <PaymentSettingsCard canWrite={user?.permissions.includes("payments:write") ?? false} />}
      </div>
    </>
  );
}
