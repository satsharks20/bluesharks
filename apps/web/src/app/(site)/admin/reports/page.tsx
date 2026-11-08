"use client";

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { REPORT_REASON_LABELS, SECTION_LABELS, type AdminReport, type ReportStatus } from "@satsharks/types";
import { STATUS_BADGE } from "@/components/report-ui";
import { RequireUser } from "@/components/require-user";
import { Badge, Button, Card, Modal, Notice, PageHeader, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { toPlainText } from "@/lib/rich-text";

type ReportList = { reports: AdminReport[]; total: number; page: number; pageSize: number; counts: Record<ReportStatus, number> };

const PAGE_SIZE = 25;

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Reports({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReportStatus | "">("pending");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolveAll, setResolveAll] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const params = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) });
  const list = useQuery({
    queryKey: ["admin", "reports", params.toString()],
    queryFn: () => api<ReportList>(`/api/admin/reports?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const counts = list.data?.counts;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const choose = (next: ReportStatus | "") => {
    setStatus(next);
    setPage(1);
    setSelected(new Set());
    setResolveAll(false);
  };
  const pendingOnPage = list.data?.reports.filter((report) => report.status === "pending") ?? [];
  const selectedCount = resolveAll ? (counts?.pending ?? 0) : selected.size;

  function toggle(id: string) {
    setResolveAll(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function resolveBatch() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ resolved: number }>("/api/admin/reports/resolve", {
        method: "POST",
        body: resolveAll ? { allPending: true, note: note.trim(), notify } : { ids: [...selected], note: note.trim(), notify },
      });
      setDialog(false);
      setSelected(new Set());
      setResolveAll(false);
      setNote("");
      setNotify(false);
      setMessage({ tone: "info", text: `${result.resolved.toLocaleString()} report${result.resolved === 1 ? "" : "s"} resolved.` });
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "Could not resolve the reports" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Problem reports" subtitle="Questions students have flagged. Open a report to fix the question and resolve it." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Toggle active={status === "pending"} onClick={() => choose("pending")}>Pending{counts ? ` (${counts.pending})` : ""}</Toggle>
        <Toggle active={status === "resolved"} onClick={() => choose("resolved")}>Resolved{counts ? ` (${counts.resolved})` : ""}</Toggle>
        <Toggle active={status === ""} onClick={() => choose("")}>All{counts ? ` (${counts.pending + counts.resolved})` : ""}</Toggle>
        {canWrite && (counts?.pending ?? 0) > 0 && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setResolveAll(true);
                setSelected(new Set());
              }}
            >
              Select all pending ({counts!.pending.toLocaleString()})
            </Button>
            <Button
              onClick={() => {
                setResolveAll(true);
                setSelected(new Set());
                setDialog(true);
              }}
            >
              Resolve all pending ({counts!.pending.toLocaleString()})
            </Button>
          </span>
        )}
      </div>

      {message && <div className="mb-4"><Notice tone={message.tone}>{message.text}</Notice></div>}

      {canWrite && selectedCount > 0 && (
        <div className="sticky top-2 z-30 mb-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-brand-500 bg-brand-50 px-4 py-3 shadow-sm">
          <span className="text-sm font-bold">
            {resolveAll ? `All ${selectedCount.toLocaleString()} pending reports selected` : `${selectedCount.toLocaleString()} report${selectedCount === 1 ? "" : "s"} selected`}
          </span>
          <span className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setDialog(true)}>Resolve selected</Button>
            <Button size="sm" variant="outline" onClick={() => (setSelected(new Set()), setResolveAll(false))}>Clear selection</Button>
          </span>
        </div>
      )}

      {canWrite && pendingOnPage.length > 0 && !resolveAll && (
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={pendingOnPage.every((report) => selected.has(report.id))}
            onChange={() => {
              const allChecked = pendingOnPage.every((report) => selected.has(report.id));
              setSelected((current) => {
                const next = new Set(current);
                for (const report of pendingOnPage) allChecked ? next.delete(report.id) : next.add(report.id);
                return next;
              });
            }}
            className="h-4 w-4 accent-brand-500"
          />
          Select pending reports on this page
        </label>
      )}

      {list.error && <Notice tone="error">{list.error.message}</Notice>}
      {list.data && list.data.reports.length === 0 && (
        <Notice tone="info">{status === "pending" ? "No reports are waiting. Nice." : "No reports here yet."}</Notice>
      )}

      <div className={`space-y-3 ${list.isFetching ? "opacity-60" : ""}`}>
        {list.data?.reports.map((report) => (
          <div key={report.id} className={`flex rounded-2xl border border-slate-900 bg-white transition hover:bg-slate-50 ${selected.has(report.id) ? "bg-brand-50" : ""}`}>
            {canWrite && report.status === "pending" && (
              <label className="flex cursor-pointer items-start px-4 py-5">
                <input
                  type="checkbox"
                  checked={resolveAll || selected.has(report.id)}
                  disabled={resolveAll}
                  onChange={() => toggle(report.id)}
                  className="h-4 w-4 accent-brand-500 disabled:cursor-not-allowed"
                  aria-label={`Select ${REPORT_REASON_LABELS[report.reason]}`}
                />
              </label>
            )}
            <Link href={`/admin/reports/${report.id}`} className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_BADGE[report.status].tone}>{STATUS_BADGE[report.status].label}</Badge>
              <span className="text-sm font-bold">{REPORT_REASON_LABELS[report.reason]}</span>
              <span className="ml-auto text-xs text-slate-500">{formatDate(report.createdAt)}</span>
            </div>
            {report.details && <p className="mt-2 line-clamp-2 text-sm text-slate-700">&ldquo;{report.details}&rdquo;</p>}
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              {report.question ? (
                <>
                  <p className="line-clamp-2 text-slate-800">{toPlainText(report.question.prompt)}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    #{report.question.sourceQuestionId} · {SECTION_LABELS[report.question.section]} · {report.question.paperTitle?.split(" — ")[0] ?? "No paper"}
                  </p>
                </>
              ) : (
                <p className="text-slate-500">This question has been deleted.</p>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Reported by {report.reporter ? `${report.reporter.name} (${report.reporter.email})` : "a deleted account"}
              {report.context.attemptName && ` · in “${report.context.attemptName}”`}
            </p>
            </Link>
          </div>
        ))}
      </div>

      {list.data && list.data.total > PAGE_SIZE && (
        <Card className="mt-4 flex items-center justify-between gap-3 py-3 text-sm">
          <span>
            Page <b>{page}</b> of <b>{pages}</b>
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </span>
        </Card>
      )}

      {dialog && (
        <Modal title={`Resolve ${selectedCount.toLocaleString()} report${selectedCount === 1 ? "" : "s"}?`} onClose={() => !busy && setDialog(false)}>
          <p className="text-sm text-slate-700">They move to Resolved together. Each report keeps its history and can be reopened later.</p>
          <label className="mt-4 block text-xs font-bold">
            Note (optional, saved on each report)
            <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-brand-500" placeholder="e.g. Checked and fixed in the latest question update" />
          </label>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
            Tell each student their report was handled
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setDialog(false)}>Cancel</Button>
            <Button disabled={busy || selectedCount === 0} onClick={resolveBatch}>{busy ? "Resolving…" : `Resolve ${selectedCount.toLocaleString()} report${selectedCount === 1 ? "" : "s"}`}</Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function AdminReportsPage() {
  return <RequireUser permission="reports:read">{(user) => <Reports canWrite={user.permissions.includes("reports:write")} />}</RequireUser>;
}
