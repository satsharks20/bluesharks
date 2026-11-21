"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MOCK_MODULE_LABELS, MOCK_MODULES, SECTION_LABELS, SECTIONS, type AdminQuestion, type CatalogTopic, type Section, type TestUploadKind, type TestUploadSummary } from "@satsharks/types";
import { RequireUser } from "@/components/require-user";
import { FailureDetails, KindChoice, kindLabel, ModuleCounts, SECTION_FILE_LABELS, SectionBadge, sectionOf, TestStatusBadge, uploadSubtitle, Warnings } from "@/components/test-upload-ui";
import { Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { api, apiUpload } from "@/lib/api";
import { toPlainText } from "@/lib/rich-text";

type Detail = { upload: TestUploadSummary; topics: Record<Section, CatalogTopic[]> };
const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-brand-500";

function SectionCard({ upload, section, canWrite, onChanged }: { upload: TestUploadSummary; section: Section; canWrite: boolean; onChanged: (upload: TestUploadSummary) => void }) {
  const data = sectionOf(upload, section);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = upload.status === "draft";

  async function reupload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { upload: saved } = await apiUpload<{ upload: TestUploadSummary }>(`/api/admin/test-uploads/${upload.id}/sections/${section}/file`, form);
      onChanged(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">{SECTION_FILE_LABELS[section]}</h2>
        <SectionBadge section={data} />
      </div>
      {data ? (
        <>
          <p className="text-sm text-slate-600">
            {data.fileName} · {(data.fileSize / 1024).toFixed(0)} KB · uploaded {new Date(data.uploadedAt).toLocaleString()}
            {data.reviewedAt && <> · reviewed {new Date(data.reviewedAt).toLocaleString()}</>}
          </p>
          {data.status === "failed" ? <FailureDetails message={data.errorMessage} open /> : <ModuleCounts section={data} kind={section} />}
          <Warnings warnings={data.warnings} />
        </>
      ) : (
        <p className="text-sm text-slate-600">Not uploaded yet.</p>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {draft && (
        <div className="mt-auto flex flex-wrap gap-2">
          {data && data.status !== "failed" && (
            <Link href={`/admin/tests/${upload.id}/review/${section}`} className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-600">
              {data.status === "reviewed" ? "Review again" : "Review questions"}
            </Link>
          )}
          {canWrite && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Checking…" : data ? "Re-upload PDF" : "Upload PDF"}
            </Button>
          )}
          <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(event) => void reupload(event.target.files?.[0])} />
        </div>
      )}
    </Card>
  );
}

function DetailsForm({ upload, onSaved, onCancel }: { upload: TestUploadSummary; onSaved: (upload: TestUploadSummary) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<TestUploadKind>(upload.kind);
  const [title, setTitle] = useState(upload.title);
  const [year, setYear] = useState(String(upload.year));
  // An exam's number is assigned by the server and never shown, so switching to a practice test
  // asks for a real one.
  const [testNumber, setTestNumber] = useState(upload.kind === "exam" ? "" : String(upload.testNumber));
  const [examDate, setExamDate] = useState(upload.examDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const moving = upload.status === "published" && kind !== upload.kind;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = kind === "exam" ? { kind, title, examDate } : { kind, title, year, testNumber };
      const { upload: saved } = await api<{ upload: TestUploadSummary }>(`/api/admin/test-uploads/${upload.id}`, { method: "PATCH", body });
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save");
      setBusy(false);
    }
  }
  return (
    <Card className="mb-4 space-y-3">
      <KindChoice value={kind} onChange={setKind} disabled={busy} />
      <div className={`grid gap-3 ${kind === "exam" ? "sm:grid-cols-[2fr_1fr]" : "sm:grid-cols-[2fr_1fr_1fr]"}`}>
        <label className="text-sm font-bold">
          Title
          <input className={inputClass} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {kind === "exam" ? (
          <label className="text-sm font-bold">
            Exam date
            <input className={inputClass} type="date" min="2000-01-01" max="2099-12-31" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
          </label>
        ) : (
          <>
            <label className="text-sm font-bold">
              Year
              <input className={inputClass} type="number" value={year} onChange={(event) => setYear(event.target.value)} />
            </label>
            <label className="text-sm font-bold">
              Test number
              <input className={inputClass} type="number" value={testNumber} onChange={(event) => setTestNumber(event.target.value)} />
            </label>
          </>
        )}
      </div>
      {moving && (
        <Notice tone="info">
          {kind === "exam"
            ? "Saving moves this test to Exams: its questions will also appear in drills and random mocks. Students' past results are kept."
            : "Saving moves this test to Full-Length Practice Tests: its questions leave drills and random mocks. Students' past results are kept."}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !title.trim() || (kind === "exam" ? !examDate : !testNumber)} onClick={save}>
          Save
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

// The published questions, module by module, each linking to the question editor (images, fixes).
function PublishedQuestions({ upload }: { upload: TestUploadSummary }) {
  const [section, setSection] = useState<Section>("reading_writing");
  const paperId = upload.paperIds[section];
  const questions = useQuery({
    queryKey: ["admin", "questions", "paper", paperId],
    enabled: !!paperId,
    queryFn: () => api<{ questions: AdminQuestion[] }>(`/api/admin/questions?paperId=${paperId}&pageSize=100`),
  });
  const all = questions.data?.questions ?? [];

  return (
    <Card className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">Questions</h2>
        <div className="flex gap-1 rounded-lg border border-slate-900 p-1">
          {SECTIONS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={section === entry}
              onClick={() => setSection(entry)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-bold ${section === entry ? "bg-brand-500 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {SECTION_LABELS[entry]}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-600">Open a question to fix its text or answer, or to add a graph or image. Changes reach students straight away.</p>
      {questions.isLoading && <Spinner label="Loading questions" />}
      {questions.error && <Notice tone="error">{questions.error.message}</Notice>}
      {MOCK_MODULES.map((module) => {
        const inModule = all.filter((question) => question.moduleType === module).sort((a, b) => a.questionNumber - b.questionNumber);
        return (
          <section key={module} className="mb-4">
            <h3 className="mb-1 text-sm font-bold">
              {MOCK_MODULE_LABELS[module]} ({inModule.length})
            </h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {inModule.map((question) => (
                <li key={question.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-6 flex-none text-right font-bold tabular-nums">{question.questionNumber}</span>
                  <span className="min-w-0 flex-1 truncate" title={toPlainText(question.prompt)}>
                    {toPlainText(question.prompt)}
                  </span>
                  {question.assets.length > 0 && <span className="text-xs text-slate-500">image</span>}
                  <span className="flex-none text-xs uppercase text-slate-500">{question.questionType}</span>
                  <Link href={`/admin/questions/${question.id}`} className="flex-none font-bold text-brand-500 hover:underline">
                    Edit
                  </Link>
                </li>
              ))}
              {inModule.length === 0 && !questions.isLoading && <li className="px-3 py-2 text-sm text-red-700">No questions. The test cannot be activated.</li>}
            </ul>
          </section>
        );
      })}
    </Card>
  );
}

// Activate a published test by itself at a chosen moment (proposal 4.2 "schedule a paper").
function ScheduleActivation({ upload, busy, onSave }: { upload: TestUploadSummary; busy: boolean; onSave: (at: string | null) => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(9, 0, 0, 0);
  const [value, setValue] = useState(local(upload.activateAt ? new Date(upload.activateAt) : tomorrow));
  return (
    <div className="flex w-full flex-wrap items-end gap-2 border-t border-slate-200 pt-3 text-sm">
      <label className="text-xs font-bold">
        Or activate it by itself at
        <input type="datetime-local" className="mt-1 block h-9 rounded-lg border border-slate-300 px-2 text-sm" value={value} min={local(new Date())} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Button size="sm" variant="outline" disabled={busy || !value} onClick={() => onSave(new Date(value).toISOString())}>
        {upload.activateAt ? "Change schedule" : "Schedule"}
      </Button>
      {upload.activateAt && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onSave(null)}>
            Remove schedule
          </Button>
          <span className="text-xs font-bold text-brand-600">
            Activates {new Date(upload.activateAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </span>
        </>
      )}
    </div>
  );
}

function TestDetail({ id, canWrite }: { id: string; canWrite: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["admin", "test-upload", id], queryFn: () => api<Detail>(`/api/admin/test-uploads/${id}`) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "delete" | null>(null);
  const [editing, setEditing] = useState(false);

  if (detail.isLoading) return <Spinner label="Loading test" />;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data) return null;
  const { upload } = detail.data;

  // Responses carry the summary only (no question bodies), so the page reloads the test.
  const changed = async (_saved?: TestUploadSummary) => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "test-upload", id] });
    await queryClient.invalidateQueries({ queryKey: ["admin", "test-uploads"] });
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const remove = () =>
    run(async () => {
      await api(`/api/admin/test-uploads/${id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["admin", "test-uploads"] });
      router.replace("/admin/tests");
    });

  const bothReviewed = SECTIONS.every((section) => sectionOf(upload, section)?.status === "reviewed");

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <TestStatusBadge upload={upload} />
        <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-bold text-slate-700">{kindLabel(upload.kind)}</span>
        <span className="text-sm text-slate-600">
          {uploadSubtitle(upload)}
          {upload.publishedAt && <> · published {new Date(upload.publishedAt).toLocaleDateString()}</>}
        </span>
        {canWrite && !editing && (
          <button type="button" className="cursor-pointer text-sm font-bold text-brand-500 hover:underline" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </div>
      <PageHeader title={upload.title} />
      {editing && (
        <DetailsForm
          upload={upload}
          onCancel={() => setEditing(false)}
          onSaved={async (saved) => {
            setEditing(false);
            await changed(saved);
          }}
        />
      )}

      {error && (
        <div className="mb-4 whitespace-pre-line">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {upload.status === "draft" ? (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-bold">Publish</p>
            <p className="text-slate-600">
              {bothReviewed
                ? "Both sections are reviewed. Publishing creates the test hidden from students; you can then add images and activate it."
                : "Review and save both sections first."}
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {confirm === "publish" ? (
                <>
                  <Button disabled={busy} onClick={() => run(async () => changed((await api<{ upload: TestUploadSummary }>(`/api/admin/test-uploads/${id}/publish`, { method: "POST" })).upload))}>
                    {busy ? "Publishing…" : "Yes, publish"}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button disabled={busy || !bothReviewed} onClick={() => setConfirm("publish")}>
                  Publish test
                </Button>
              )}
              {confirm === "delete" ? (
                <>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={remove}
                  >
                    Yes, delete
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setConfirm("delete")}>
                  Delete
                </Button>
              )}
            </div>
          )}
        </Card>
      ) : (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-bold">{upload.active ? "Students can see and take this test." : "Hidden from students."}</p>
            <p className="text-slate-600">
              {upload.active
                ? "Deactivating hides it from new sittings; students already in it can finish."
                : "Add any graphs or images below, then activate. Every module must have questions with answers."}
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant={upload.active ? "outline" : "primary"}
                disabled={busy}
                onClick={() => run(async () => changed((await api<{ upload: TestUploadSummary }>(`/api/admin/test-uploads/${id}/active`, { method: "POST", body: { active: !upload.active } })).upload))}
              >
                {busy ? "Saving…" : upload.active ? "Deactivate" : "Activate"}
              </Button>
              {confirm === "delete" ? (
                <>
                  <Button variant="danger" disabled={busy} onClick={remove}>
                    {busy ? "Deleting…" : "Yes, delete test"}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="danger" disabled={busy} onClick={() => setConfirm("delete")}>
                  Delete test
                </Button>
              )}
            </div>
          )}
          {confirm === "delete" && (
            <p className="basis-full text-sm font-semibold text-red-700">
              This removes the test from Admin and from new student starts. Existing student attempts and results are preserved.
            </p>
          )}
          {canWrite && !upload.active && (
            <ScheduleActivation
              upload={upload}
              busy={busy}
              onSave={(at) => run(async () => changed((await api<{ upload: TestUploadSummary }>(`/api/admin/test-uploads/${id}/schedule`, { method: "PUT", body: { at } })).upload))}
            />
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <SectionCard key={section} upload={upload} section={section} canWrite={canWrite} onChanged={(saved) => void changed(saved)} />
        ))}
      </div>

      {upload.status === "published" && <PublishedQuestions upload={upload} />}
    </>
  );
}

export default function AdminTestPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireUser permission="papers:read">
      {(user) => (
        <>
          <Link href="/admin/tests" className="mb-4 inline-block text-sm font-bold text-brand-500 hover:underline">
            ← Full tests
          </Link>
          <TestDetail id={id} canWrite={user.permissions.includes("papers:write")} />
        </>
      )}
    </RequireUser>
  );
}
