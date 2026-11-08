"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminLeaderboard, AdminLeaderboardRow, LeaderboardPeriod } from "@satsharks/types";
import { RequireUser } from "@/components/require-user";
import { Badge, Button, Card, Modal, Notice, PageHeader, Toggle } from "@/components/ui";
import { countryLabel } from "@/components/user-badges";
import { api } from "@/lib/api";
import { countryOptions } from "@/lib/countries";

const PAGE_SIZE = 25;
const controlClass = "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500";
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");
const percentage = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);

function FastFlag({ row }: { row: AdminLeaderboardRow }) {
  if (!row.veryFastAnswers) return null;
  return (
    <span title={`${row.fastAnswers.toLocaleString()} answers (${Math.round(row.fastAnswerRate * 100)}%) were faster than the minimum reading time`}>
      <Badge tone="red">Very fast answers</Badge>
    </span>
  );
}

function BoardStatus({ shown }: { shown: boolean }) {
  return <Badge tone={shown ? "green" : "neutral"}>{shown ? "Shown" : "Hidden"}</Badge>;
}

type Action = { kind: "visibility" | "reset"; row: AdminLeaderboardRow };

function Actions({ row, canWrite, onDone }: { row: AdminLeaderboardRow; canWrite: boolean; onDone: (text: string) => void }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "visibility") {
        const shown = !action.row.showOnLeaderboard;
        await api(`/api/admin/leaderboard/${action.row.id}/visibility`, { method: "PATCH", body: { shown } });
        onDone(`${action.row.name} is now ${shown ? "shown on" : "hidden from"} student leaderboards.`);
      } else {
        const { removed } = await api<{ removed: number }>(`/api/admin/leaderboard/${action.row.id}/reset-week`, { method: "POST" });
        onDone(`${removed.toLocaleString()} point${removed === 1 ? "" : "s"} removed from ${action.row.name}'s current week.`);
      }
      setAction(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "leaderboard"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the leaderboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="inline-flex flex-wrap justify-end gap-1.5">
        <Link href={`/admin/users/${row.id}`} className="rounded-lg border border-slate-900 px-3 py-1.5 text-xs font-bold hover:bg-slate-100">View</Link>
        {canWrite && (
          <>
            <button type="button" onClick={() => setAction({ kind: "visibility", row })} className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100">
              {row.showOnLeaderboard ? "Hide" : "Show"}
            </button>
            <button type="button" onClick={() => setAction({ kind: "reset", row })} className="cursor-pointer rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">
              Reset week
            </button>
          </>
        )}
      </span>
      {action && (
        <Modal title={action.kind === "reset" ? "Reset this week's points?" : action.row.showOnLeaderboard ? "Hide this student?" : "Show this student?"} onClose={() => !busy && setAction(null)}>
          <p className="text-sm text-slate-700">
            {action.kind === "reset"
              ? `${action.row.name}'s points for the current week will be removed. Their answer history stays intact.`
              : action.row.showOnLeaderboard
                ? `${action.row.name} will disappear from all student leaderboards. They remain visible here and can be shown again.`
                : `${action.row.name} will be allowed to appear on student leaderboards again.`}
          </p>
          {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
            <Button variant={action.kind === "reset" || action.row.showOnLeaderboard ? "danger" : "primary"} disabled={busy} onClick={apply}>
              {busy ? "Saving…" : action.kind === "reset" ? "Reset points" : action.row.showOnLeaderboard ? "Hide student" : "Show student"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Leaderboard({ canWrite }: { canWrite: boolean }) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [country, setCountry] = useState("");
  const [plan, setPlan] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [countries] = useState(() => countryOptions());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const params = new URLSearchParams({ period, country, plan, search, page: String(page), pageSize: String(PAGE_SIZE) });
  const exportParams = new URLSearchParams({ period, country, plan, search });
  const list = useQuery({
    queryKey: ["admin", "leaderboard", params.toString()],
    queryFn: () => api<AdminLeaderboard>(`/api/admin/leaderboard?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const resetPage = () => setPage(1);

  return (
    <>
      <PageHeader title="Leaderboard" subtitle="The same practice ranking students see, with full details and moderation controls for admins." />
      {message && <div className="mb-4"><Notice tone="info">{message}</Notice></div>}

      <Card className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-2 self-end">
          <Toggle active={period === "week"} onClick={() => (setPeriod("week"), resetPage())}>This week</Toggle>
          <Toggle active={period === "all"} onClick={() => (setPeriod("all"), resetPage())}>All time</Toggle>
        </div>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-bold">
          Search
          <input className={controlClass} value={searchInput} maxLength={100} onChange={(event) => setSearchInput(event.target.value)} placeholder="Student name or email" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          Country
          <select className={controlClass} value={country} onChange={(event) => (setCountry(event.target.value), resetPage())}>
            <option value="">All countries</option>
            {countries.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          Plan
          <select className={controlClass} value={plan} onChange={(event) => (setPlan(event.target.value), resetPage())}>
            <option value="">Paid and free</option>
            <option value="paid">Paid</option>
            <option value="free">Free</option>
          </select>
        </label>
        <a href={`/api/admin/leaderboard/export?${exportParams.toString()}`} download className="flex h-10 items-center rounded-lg border border-slate-900 bg-white px-4 text-sm font-bold hover:bg-slate-100">Export CSV</a>
      </Card>

      {list.error && <Notice tone="error">{list.error.message}</Notice>}
      {list.data?.rows.length === 0 && <Notice tone="info">No students match these filters.</Notice>}

      {list.data && list.data.rows.length > 0 && (
        <Card className={`p-0 ${list.isFetching ? "opacity-60" : ""}`}>
          <ul className="divide-y divide-slate-200 lg:hidden">
            {list.data.rows.map((row) => (
              <li key={row.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-100 text-sm font-bold">{row.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-bold">{row.name}</span><FastFlag row={row} /></div>
                    <p className="truncate text-sm text-slate-600">{row.email}</p>
                    <p className="mt-1 text-xs text-slate-500">{countryLabel(row.country)} · <span className="capitalize">{row.plan}</span> · last active {formatDate(row.lastActiveAt)}</p>
                  </div>
                  <BoardStatus shown={row.showOnLeaderboard} />
                </div>
                <dl className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-3 text-center text-xs">
                  <div><dt className="text-slate-500">Points</dt><dd className="font-bold">{row.points.toLocaleString()}</dd></div>
                  <div><dt className="text-slate-500">Questions</dt><dd className="font-bold">{row.questions.toLocaleString()}</dd></div>
                  <div><dt className="text-slate-500">Accuracy</dt><dd className="font-bold">{percentage(row.accuracy)}</dd></div>
                  <div><dt className="text-slate-500">Streak</dt><dd className="font-bold">{row.streak} d</dd></div>
                </dl>
                <div className="mt-3 text-right"><Actions row={row} canWrite={canWrite} onDone={setMessage} /></div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-900 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-3">#</th><th className="px-3 py-3">Student</th><th className="px-3 py-3">Plan</th><th className="px-3 py-3 text-right">Points</th>
                  <th className="px-3 py-3 text-right">Questions</th><th className="px-3 py-3 text-right">Accuracy</th><th className="px-3 py-3 text-right">Streak</th>
                  <th className="px-3 py-3">Last active</th><th className="px-3 py-3">On board</th><th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {list.data.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-3 font-bold">{row.rank}</td>
                    <td className="max-w-xs px-3 py-3"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-bold">{row.name}</span><FastFlag row={row} /></div><div className="truncate text-xs text-slate-500">{row.email} · {countryLabel(row.country)}</div></td>
                    <td className="px-3 py-3 capitalize">{row.plan}</td><td className="px-3 py-3 text-right font-bold">{row.points.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right">{row.questions.toLocaleString()}</td><td className="px-3 py-3 text-right">{percentage(row.accuracy)}</td>
                    <td className="px-3 py-3 text-right">{row.streak} d</td><td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">{formatDate(row.lastActiveAt)}</td>
                    <td className="px-3 py-3"><BoardStatus shown={row.showOnLeaderboard} /></td><td className="px-4 py-3 text-right"><Actions row={row} canWrite={canWrite} onDone={setMessage} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-slate-900 px-4 py-3 text-sm">
            <span>{list.data.total.toLocaleString()} student{list.data.total === 1 ? "" : "s"} · page <b>{page}</b> of <b>{pages}</b></span>
            <span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></span>
          </div>
        </Card>
      )}
    </>
  );
}

export default function AdminLeaderboardPage() {
  return <RequireUser permission="users:read">{(user) => <Leaderboard canWrite={user.permissions.includes("users:write")} />}</RequireUser>;
}
