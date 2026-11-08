"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { REPORT_REASON_LABELS, SECTION_LABELS, type AdminQuestion, type AdminReport } from "@satsharks/types";
import { Choices, Passage, Prompt } from "@/components/question";
import { QuestionEditor } from "@/components/question-editor";
import { canDrawViz } from "@/components/viz";
import { STATUS_BADGE } from "@/components/report-ui";
import { RequireUser } from "@/components/require-user";
import { Badge, Button, Card, Modal, Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

type ReportDetail = { report: AdminReport; question: AdminQuestion | null; related: AdminReport[] };

// The question laid out as on the student's test screen (passage beside the question for Reading &
// Writing and typed answers), with its figures (graphs, tables, images) at full size and the answer
// key marked, so the admin sees what the student reported. It reads the editor's copy of the
// question, so it follows each save.
function StudentView({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ["admin", "question", id], queryFn: () => api<{ question: AdminQuestion }>(`/api/admin/questions/${id}`) });
  const question = data?.question;
  if (!question) return null;
  const math = question.section === "math";
  const spr = question.questionType !== "mcq";
  const split = !math || spr;
  // A figure kind the site cannot draw yet: show what is stored, so the admin can still judge it.
  const undrawn = [question.viz, ...question.choices.map((choice) => choice.viz ?? null)].filter((viz) => viz != null && !canDrawViz(viz));
  // Choices with neither text nor a figure: the student saw blank options (e.g. graphs never imported).
  const empty = spr ? [] : question.choices.filter((choice) => !choice.text.trim() && choice.viz == null).map((choice) => choice.key);
  const pane = (
    <>
      <Prompt question={question} />
      {spr ? (
        <p className="mt-4 text-sm">
          <b>Accepted answers:</b> {question.correctAnswer?.acceptedValues.join(" or ") || "none set"}
        </p>
      ) : (
        <Choices question={question} selected={null} correctAnswer={question.correctAnswer} disabled />
      )}
    </>
  );
  return (
    <Card className="mb-4 p-0">
      <h2 className="border-b border-slate-900 px-5 py-3 font-bold">As the student saw it</h2>
      {empty.length > 0 && (
        <div className="px-5 pt-4">
          <Notice tone="error">
            Choice{empty.length === 1 ? "" : "s"} {empty.join(", ")} {empty.length === 1 ? "has" : "have"} no text and no picture, so the student saw blank options. The graphs (or
            pictures) for these answers were never imported. Add an image for each choice in the editor below and save.
          </Notice>
        </div>
      )}
      {split ? (
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div className="min-w-0 border-b-4 border-slate-300 px-5 py-5 lg:border-b-0 lg:border-r-4">
            {math ? <p className="text-sm text-slate-500">Typed-answer question: the student sees the answer directions here.</p> : <Passage question={question} />}
          </div>
          <div className="min-w-0 px-5 py-5">{pane}</div>
        </div>
      ) : (
        <div className="mx-auto max-w-3xl px-5 py-5">{pane}</div>
      )}
      {undrawn.length > 0 && (
        <details className="border-t border-slate-200 px-5 py-3 text-sm">
          <summary className="cursor-pointer font-bold text-amber-800">The figure&rsquo;s stored data ({undrawn.length})</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-slate-50 p-3 text-xs">{JSON.stringify(undrawn, null, 2)}</pre>
        </details>
      )}
    </Card>
  );
}

const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const ACTION_LABELS = { created: "Reported", resolved: "Resolved", reopened: "Reopened" } as const;

function ReportView({ id, canResolve, canEditQuestion }: { id: string; canResolve: boolean; canEditQuestion: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["admin", "report", id], queryFn: () => api<ReportDetail>(`/api/admin/reports/${id}`) });
  // Resolving cannot be undone without reopening, so it is confirmed in a dialog first.
  const [dialog, setDialog] = useState<"resolve" | "reopen" | null>(null);
  const [note, setNote] = useState("");
  const [includeSameQuestion, setIncludeSameQuestion] = useState(true);
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [editedThisVisit, setEditedThisVisit] = useState(false);

  if (isLoading) return <Spinner label="Loading report" />;
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!data) return null;
  const { report, question, related } = data;
  const otherPending = related.filter((entry) => entry.status === "pending").length;

  async function act() {
    setBusy(true);
    setMessage(null);
    try {
      if (dialog === "resolve") {
        const { resolved } = await api<{ resolved: number }>(`/api/admin/reports/${id}/resolve`, { method: "POST", body: { note: note.trim(), includeSameQuestion, notify } });
        setMessage({ tone: "info", text: resolved > 1 ? `${resolved} reports resolved.` : "Report resolved." });
      } else {
        await api(`/api/admin/reports/${id}/reopen`, { method: "POST", body: { note: note.trim() } });
        setMessage({ tone: "info", text: "Report reopened." });
      }
      setDialog(null);
      setNote("");
      setNotify(false);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "Could not update the report" });
      setDialog(null);
      // Someone else may have changed it: show the current state.
      await queryClient.invalidateQueries({ queryKey: ["admin", "report", id] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href="/admin/reports" className="mb-3 inline-block text-sm font-bold text-brand-500 hover:underline">
        ← Problem reports
      </Link>
      <PageHeader title={REPORT_REASON_LABELS[report.reason]} subtitle={`Reported ${formatDate(report.createdAt)}`} />
      {question && <StudentView id={question.id} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_BADGE[report.status].tone}>{STATUS_BADGE[report.status].label}</Badge>
              {report.question && <Badge>{SECTION_LABELS[report.question.section]}</Badge>}
            </div>
            <h2 className="mt-3 text-sm font-bold text-slate-500">What the student wrote</h2>
            <p className="mt-1 whitespace-pre-wrap text-[15px]">{report.details ?? <span className="text-slate-500">No details given.</span>}</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Student</dt>
              <dd className="min-w-0 break-words">{report.reporter ? `${report.reporter.name} · ${report.reporter.email}` : "Deleted account"}</dd>
              <dt className="text-slate-500">Seen in</dt>
              <dd>
                {report.context.attemptName ?? "—"}
                {report.context.kind && <span className="text-slate-500"> ({report.context.kind === "mock" ? "mock" : "drill"}, position {report.context.position})</span>}
              </dd>
              <dt className="text-slate-500">Question</dt>
              <dd>{report.question ? `#${report.question.sourceQuestionId} · ${report.question.paperTitle?.split(" — ")[0] ?? "No paper"}` : "Deleted"}</dd>
            </dl>

            {message && (
              <div className="mt-4">
                <Notice tone={message.tone}>{message.text}</Notice>
              </div>
            )}
            {canResolve && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                {report.status === "pending" ? (
                  <>
                    <p className="mb-3 text-sm text-slate-600">
                      {editedThisVisit ? "The question has been saved. Resolve the report when you are done." : "Fix the question on the right if needed, then resolve the report."}
                    </p>
                    <Button className="w-full sm:w-auto" disabled={busy} onClick={() => setDialog("resolve")}>
                      Resolve report
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={() => setDialog("reopen")}>
                    Reopen report
                  </Button>
                )}
              </div>
            )}
          </Card>

          <Card>
            <h2 className="font-bold">History</h2>
            <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
              {report.history.map((event, index) => (
                <li key={index} className="relative text-sm">
                  <span aria-hidden className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-brand-500" />
                  <p className="font-bold">
                    {ACTION_LABELS[event.action]}
                    {event.byName && <span className="font-normal text-slate-600"> by {event.byName}</span>}
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(event.at)}</p>
                  {event.action === "resolved" && <p className="text-xs text-slate-600">{event.questionEdited ? "The question had been edited." : "Resolved without changing the question."}</p>}
                  {event.note && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-slate-700">{event.note}</p>}
                </li>
              ))}
            </ol>
          </Card>

          {related.length > 0 && (
            <Card>
              <h2 className="font-bold">Other reports on this question ({related.length})</h2>
              <ul className="mt-2 divide-y divide-slate-200 text-sm">
                {related.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 py-2">
                    <Badge tone={STATUS_BADGE[entry.status].tone}>{STATUS_BADGE[entry.status].label}</Badge>
                    <Link href={`/admin/reports/${entry.id}`} className="font-medium text-brand-600 hover:underline">
                      {REPORT_REASON_LABELS[entry.reason]}
                    </Link>
                    <span className="ml-auto text-xs text-slate-500">{formatDate(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {question ? (
            <QuestionEditor
              id={question.id}
              canWrite={canEditQuestion}
              onSaved={() => setEditedThisVisit(true)}
              onDeleted={() => void queryClient.invalidateQueries({ queryKey: ["admin", "report", id] })}
              header={() => <h2 className="mb-3 text-lg font-bold">Reported question</h2>}
            />
          ) : (
            <Notice tone="info">The reported question has been deleted. You can still resolve the report.</Notice>
          )}
        </div>
      </div>

      {dialog && (
        <Modal title={dialog === "resolve" ? "Resolve this report?" : "Reopen this report?"} onClose={() => !busy && setDialog(null)}>
          <p className="text-sm text-slate-700">
            {dialog === "resolve"
              ? "The report moves to Resolved. Its history is kept and it can be reopened later."
              : "The report moves back to Pending so it can be worked on again."}
          </p>
          <label className="mt-4 block text-xs font-bold">
            Note (optional, visible to admins)
            <textarea
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={dialog === "resolve" ? "e.g. Corrected the answer key from B to C" : "Why it needs another look"}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-brand-500"
            />
          </label>
          {dialog === "resolve" && otherPending > 0 && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={includeSameQuestion} onChange={(event) => setIncludeSameQuestion(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
              Also resolve the {otherPending} other pending report{otherPending === 1 ? "" : "s"} on this question
            </label>
          )}
          {dialog === "resolve" && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-500" />
              Tell each student their report was handled
            </label>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={act}>
              {busy ? "Saving…" : dialog === "resolve" ? "Resolve" : "Reopen"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function AdminReportPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireUser permission="reports:read">
      {(user) => <ReportView id={id} canResolve={user.permissions.includes("reports:write")} canEditQuestion={user.permissions.includes("questions:write")} />}
    </RequireUser>
  );
}
