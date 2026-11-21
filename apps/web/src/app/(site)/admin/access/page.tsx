"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACCESS_FEATURE_LABELS,
  ACCESS_FEATURES,
  CONTENT_LABEL_TEXT,
  CONTENT_LABELS,
  contentRule,
  SUGGESTED_FREE_DRILL_QUESTIONS,
  type AccessFeature,
  type AccessItem,
  type AccessLevel,
  type AccessRule,
  type AccessSettings,
  type AdminAccess,
  type ContentAccessLevel,
  type ContentLabel,
} from "@satsharks/types";
import { RequireUser } from "@/components/require-user";
import { Badge, Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

const QUERY_KEY = ["admin", "settings", "access"];

type RuleDraft = Omit<AccessRule, "key" | "inviteCode"> & { inviteCode: string };

interface Draft {
  features: Record<AccessFeature, AccessLevel>;
  // Every listed exam and test, set explicitly.
  rules: Record<string, RuleDraft>;
  newContent: AccessLevel;
  // "" = no limit.
  drillLimit: string;
}

function toDraft(data: AdminAccess): Draft {
  return {
    features: { ...data.settings.features },
    rules: Object.fromEntries(
      data.items.map((item) => {
        const rule = contentRule(data.settings, item.key);
        return [item.key, { level: rule.level, inviteCode: rule.inviteCode ?? "", pinned: rule.pinned, label: rule.label }];
      }),
    ),
    newContent: data.settings.newContent,
    drillLimit: data.settings.freeDrillQuestionsPerDay === null ? "" : String(data.settings.freeDrillQuestionsPerDay),
  };
}

// Free (every account), paid only, or (for exams and tests) invite code only.
function LevelSwitch<T extends ContentAccessLevel>({
  value,
  onChange,
  disabled,
  label,
  levels,
}: {
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
  label: string;
  levels: readonly T[];
}) {
  const text: Record<ContentAccessLevel, string> = { free: "Free", paid: "Paid only", invite: "Invite code" };
  const active: Record<ContentAccessLevel, string> = { free: "bg-green-600 text-white", paid: "bg-brand-500 text-white", invite: "bg-amber-500 text-white" };
  return (
    <div role="group" aria-label={label} className="inline-flex flex-none gap-1 rounded-lg border border-slate-900 bg-white p-1">
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={value === level}
          disabled={disabled}
          onClick={() => onChange(level)}
          className={`min-h-9 cursor-pointer rounded-md px-3 text-xs font-bold disabled:cursor-not-allowed ${value === level ? active[level] : "text-slate-600 hover:bg-slate-100 disabled:hover:bg-transparent"}`}
        >
          {text[level]}
        </button>
      ))}
    </div>
  );
}

const small = "h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-brand-500 disabled:bg-slate-50";

function ItemList({
  title,
  description,
  items,
  rules,
  canWrite,
  onChange,
}: {
  title: string;
  description: string;
  items: AccessItem[];
  rules: Record<string, RuleDraft>;
  canWrite: boolean;
  onChange: (keys: string[], patch: Partial<RuleDraft>) => void;
}) {
  const [search, setSearch] = useState("");
  const shown = items.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));
  const free = items.filter((item) => rules[item.key]?.level === "free").length;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-900 px-5 py-4">
        <div>
          <h2 className="font-bold">
            {title} <span className="font-normal text-slate-600">({free} of {items.length} free)</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">{description}</p>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label={`Search ${title.toLowerCase()}`}
              className="h-9 w-40 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500"
            />
            {canWrite && (
              <>
                <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={() => onChange(shown.map((item) => item.key), { level: "free" })}>
                  {search ? "Shown" : "All"} free
                </Button>
                <Button size="sm" variant="outline" disabled={shown.length === 0} onClick={() => onChange(shown.map((item) => item.key), { level: "paid" })}>
                  {search ? "Shown" : "All"} paid only
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {items.length === 0 && <p className="px-5 py-6 text-sm text-slate-600">Nothing published yet.</p>}
      {items.length > 0 && shown.length === 0 && <p className="px-5 py-6 text-sm text-slate-600">Nothing matches &ldquo;{search}&rdquo;.</p>}
      <ul className="divide-y divide-slate-200">
        {shown.map((item) => {
          const rule = rules[item.key] ?? { level: "free", inviteCode: "", pinned: false, label: null };
          return (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
              <div className="min-w-0">
                <p className="font-bold">{item.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  {item.date && <span>{item.date}</span>}
                  {item.key.startsWith("upload:") && item.kind === "exam" && <span>Uploaded exam</span>}
                  {!item.active && <Badge tone="amber">Not active</Badge>}
                  {rule.pinned && <Badge tone="brand">Pinned</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <input type="checkbox" className="h-4 w-4 accent-brand-500" disabled={!canWrite} checked={rule.pinned} onChange={(event) => onChange([item.key], { pinned: event.target.checked })} />
                  Pin to top
                </label>
                <select
                  aria-label={`Label for ${item.name}`}
                  className={small}
                  disabled={!canWrite}
                  value={rule.label ?? ""}
                  onChange={(event) => onChange([item.key], { label: (event.target.value || null) as ContentLabel | null })}
                >
                  <option value="">No label</option>
                  {CONTENT_LABELS.map((label) => (
                    <option key={label} value={label}>
                      {CONTENT_LABEL_TEXT[label]}
                    </option>
                  ))}
                </select>
                <LevelSwitch
                  label={`Access to ${item.name}`}
                  levels={["free", "paid", "invite"] as const}
                  value={rule.level}
                  disabled={!canWrite}
                  onChange={(level) => onChange([item.key], { level })}
                />
                {rule.level === "invite" && (
                  <input
                    aria-label={`Invite code for ${item.name}`}
                    className={`${small} w-36 font-mono uppercase`}
                    disabled={!canWrite}
                    value={rule.inviteCode}
                    maxLength={24}
                    placeholder="e.g. SCHOOL-2026"
                    onChange={(event) => onChange([item.key], { inviteCode: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Access({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: () => api<AdminAccess>("/api/admin/settings/access") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (query.data && draft === null) setDraft(toDraft(query.data));
  }, [query.data, draft]);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const exams = items.filter((item) => item.kind === "exam");
  const practice = items.filter((item) => item.kind === "practice");

  if (query.isLoading || !draft) return query.error ? <Notice tone="error">{query.error.message}</Notice> : <Spinner label="Loading access settings" />;

  const change = (next: Draft) => {
    setDraft(next);
    setDirty(true);
    setMessage(null);
  };
  const setRules = (keys: string[], patch: Partial<RuleDraft>) =>
    change({
      ...draft,
      rules: { ...draft.rules, ...Object.fromEntries(keys.map((key) => [key, { ...(draft.rules[key] ?? { level: "free", inviteCode: "", pinned: false, label: null }), ...patch }])) },
    });

  async function save() {
    if (!draft || !query.data) return;
    const limit = draft.drillLimit.trim() === "" ? null : Number(draft.drillLimit);
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
      setMessage({ tone: "error", text: "The daily drill limit is a whole number from 1 to 1000, or empty for no limit." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const listed = new Set(items.map((item) => item.key));
      const body: AccessSettings = {
        features: draft.features,
        content: [
          // Rules for exams that are hidden right now are kept for when they come back.
          ...query.data.settings.content.filter((rule) => !listed.has(rule.key)),
          ...items.map((item): AccessRule => {
            const rule = draft.rules[item.key] ?? { level: draft.newContent, inviteCode: "", pinned: false, label: null };
            return { key: item.key, level: rule.level, inviteCode: rule.level === "invite" ? rule.inviteCode.trim() || null : null, pinned: rule.pinned, label: rule.label };
          }),
        ],
        newContent: draft.newContent,
        freeDrillQuestionsPerDay: limit,
      };
      const settings = await api<AccessSettings>("/api/admin/settings/access", { method: "PUT", body });
      const data = { settings, items };
      queryClient.setQueryData(QUERY_KEY, data);
      setDraft(toDraft(data));
      setDirty(false);
      setMessage({ tone: "info", text: "Saved. Applies to what students start from now on; tests already started can still be finished." });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 pb-4">
      <Notice tone="info">
        <b>Free</b> opens it to every account. <b>Paid only</b> keeps it for accounts with an active paid plan; free accounts see it locked, with a link to the pricing page.{" "}
        <b>Invite code</b> opens it only to students who type its code on their Home page (a school or a class, for example), whatever their plan. Staff and admins can open
        everything. <b>Pin to top</b> lists it first; a <b>label</b> (New, Hard, Most attempted) shows on its card.
      </Notice>

      <Card>
        <h2 className="font-bold">Ways of practising</h2>
        <ul className="mt-3 divide-y divide-slate-200">
          {ACCESS_FEATURES.map((feature) => (
            <li key={feature} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div>
                <p className="font-bold">{ACCESS_FEATURE_LABELS[feature].label}</p>
                <p className="text-xs text-slate-600">{ACCESS_FEATURE_LABELS[feature].description}</p>
              </div>
              <LevelSwitch
                label={`Access to ${ACCESS_FEATURE_LABELS[feature].label}`}
                levels={["free", "paid"] as const}
                value={draft.features[feature]}
                disabled={!canWrite}
                onChange={(level) => change({ ...draft, features: { ...draft.features, [feature]: level } })}
              />
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div>
              <p className="font-bold">Free accounts: drill questions a day</p>
              <p className="text-xs text-slate-600">
                Counted on each student&apos;s own day; mistake-bank retries do not count. Empty = no limit. The proposal suggests {SUGGESTED_FREE_DRILL_QUESTIONS}.
              </p>
            </div>
            <input
              type="number"
              min={1}
              max={1000}
              inputMode="numeric"
              aria-label="Drill questions a day for free accounts"
              placeholder="No limit"
              disabled={!canWrite}
              value={draft.drillLimit}
              onChange={(event) => change({ ...draft, drillLimit: event.target.value })}
              className="h-10 w-28 rounded-lg border border-slate-900 bg-white px-3 text-sm outline-none focus:border-brand-500"
            />
          </li>
        </ul>
        <p className="mt-2 text-xs text-slate-600">
          A free account&apos;s adaptive mock with &ldquo;All exams&rdquo; draws only from the exams open to it. Full-length practice tests are set one by one below.
        </p>
      </Card>

      <ItemList
        title="Exams"
        description="Start Exam drills and the adaptive mock pool, including uploaded or fetched exams."
        items={exams}
        rules={draft.rules}
        canWrite={canWrite}
        onChange={setRules}
      />
      <ItemList title="Full-Length Practice Tests" description="Uploaded practice tests on the student Home page." items={practice} rules={draft.rules} canWrite={canWrite} onChange={setRules} />

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-bold">Exams and tests added later</h2>
          <p className="mt-0.5 text-xs text-slate-600">Anything published after this page was last saved starts with this setting.</p>
        </div>
        <LevelSwitch
          label="Access to exams and tests added later"
          levels={["free", "paid"] as const}
          value={draft.newContent}
          disabled={!canWrite}
          onChange={(level) => change({ ...draft, newContent: level })}
        />
      </Card>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {canWrite ? (
        // Pinned to the bottom of the screen only while there is something to save.
        <div className={`${dirty ? "sticky bottom-0 z-10 shadow-lg" : ""} flex flex-wrap items-center justify-end gap-3 rounded-xl border border-slate-900 bg-white px-4 py-3`}>
          <span className="mr-auto text-sm text-slate-600">{dirty ? "You have unsaved changes." : "All changes saved."}</span>
          {dirty && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                setDraft(toDraft(query.data!));
                setDirty(false);
                setMessage(null);
              }}
            >
              Discard
            </Button>
          )}
          <Button disabled={saving || !dirty} onClick={save}>
            {saving ? "Saving…" : "Save access"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-slate-600">Your account can view these settings but not change them.</p>
      )}
    </div>
  );
}

export default function AdminAccessPage() {
  return (
    <RequireUser permission="papers:read">
      {(user) => (
        <>
          <PageHeader title="Access" subtitle="Choose what free accounts can open, which exams need an invite code, and what is pinned or labelled." />
          <Access canWrite={user.permissions.includes("papers:write")} />
        </>
      )}
    </RequireUser>
  );
}
