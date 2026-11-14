"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SECTIONS, type TestUploadKind, type TestUploadSummary } from "@satsharks/types";
import { RequireUser } from "@/components/require-user";
import { KindChoice, kindLabel, ModuleCounts, SECTION_FILE_LABELS, SectionBadge, sectionOf, TestStatusBadge, uploadSubtitle } from "@/components/test-upload-ui";
import { Button, Card, Modal, Notice, PageHeader, Spinner } from "@/components/ui";
import { api, apiUpload } from "@/lib/api";

const inputClass = "mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-brand-500";

function FormatHelp() {
  return (
    <Card className="mb-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl text-sm text-slate-700">
          <h2 className="mb-1 text-base font-bold text-black">How uploading works</h2>
          <p>
            A test is two PDFs: English and Math, each with <b>Module 1</b>, <b>Module 2 Easy</b> and <b>Module 2 Hard</b>. Students who answer at least the routing
            threshold of Module 1 correctly (Settings, now 65%) get the hard Module 2. Each PDF is checked as soon as it is uploaded; then you review the questions,
            publish, add any images, and activate.
          </p>
          <p className="mt-2">
            When uploading, choose where the test goes: <b>Practice tests</b> (Full-Length Practice Tests on the student home; its questions stay in that test) or{" "}
            <b>Exams</b> for a real SAT administration (listed with the past exams by its date; students can drill it or take it as a full test, and its
            questions join random mocks).
          </p>
          <p className="mt-2">
            Every question must include a bank <b>CATEGORY</b> (domain) and an exact <b>SKILL</b>, for example <i>Algebra</i> with <i>Linear equations in one variable</i>.
            Missing or mismatched labels are rejected before review, so a blank skill never reaches a new upload. Math can be plain text (<code className="rounded bg-slate-100 px-1">x^2</code>,{" "}
            <code className="rounded bg-slate-100 px-1">$90</code>) or LaTeX like the rest of the bank (<code className="rounded bg-slate-100 px-1">$x^2 + 3x$</code>,{" "}
            <code className="rounded bg-slate-100 px-1">$\$78$</code>).
          </p>
        </div>
        <div className="flex flex-none flex-col gap-2 text-sm font-bold">
          <a href="/full-test/format.html" target="_blank" rel="noreferrer" className="text-brand-500 hover:underline">
            Format guide and printable builder →
          </a>
          <a href="/full-test/sample-math.pdf" download className="text-brand-500 hover:underline">
            Sample Math PDF
          </a>
          <a href="/full-test/sample-english.pdf" download className="text-brand-500 hover:underline">
            Sample English PDF
          </a>
        </div>
      </div>
    </Card>
  );
}

function UploadDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<TestUploadKind>("practice");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [testNumber, setTestNumber] = useState("");
  const [examDate, setExamDate] = useState("");
  const [files, setFiles] = useState<{ readingWriting?: File; math?: File }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("title", title);
      if (kind === "exam") {
        form.append("examDate", examDate);
      } else {
        form.append("year", year);
        form.append("testNumber", testNumber);
      }
      if (files.readingWriting) form.append("readingWriting", files.readingWriting);
      if (files.math) form.append("math", files.math);
      const { upload } = await apiUpload<{ upload: TestUploadSummary }>("/api/admin/test-uploads", form);
      await queryClient.invalidateQueries({ queryKey: ["admin", "test-uploads"] });
      router.push(`/admin/tests/${upload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload");
      setBusy(false);
    }
  }

  const fileField = (key: "readingWriting" | "math", label: string) => (
    <label className="block text-sm font-bold">
      {label}
      <input
        type="file"
        accept="application/pdf,.pdf"
        disabled={busy}
        onChange={(event) => setFiles((current) => ({ ...current, [key]: event.target.files?.[0] }))}
        className="mt-1 block w-full cursor-pointer rounded-lg border border-slate-300 bg-white text-sm font-normal file:mr-3 file:cursor-pointer file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:font-bold"
      />
    </label>
  );

  return (
    <Modal title="Upload a test" onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <KindChoice value={kind} onChange={setKind} disabled={busy} />
        <label className="block text-sm font-bold">
          Title
          <input
            className={inputClass}
            value={title}
            maxLength={120}
            required
            onChange={(event) => setTitle(event.target.value)}
            placeholder={kind === "exam" ? "e.g. SAT December 05, 2026 Administration" : "e.g. LUE SAT Practice Test 1"}
          />
        </label>
        {kind === "exam" ? (
          <label className="block text-sm font-bold">
            Exam date
            <input className={inputClass} type="date" min="2000-01-01" max="2099-12-31" required value={examDate} onChange={(event) => setExamDate(event.target.value)} />
            <span className="mt-1 block text-xs font-normal text-slate-600">Students filter exams by its year and season.</span>
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-bold">
              Year
              <input className={inputClass} type="number" min={2000} max={2100} required value={year} onChange={(event) => setYear(event.target.value)} />
            </label>
            <label className="block text-sm font-bold">
              Test number
              <input className={inputClass} type="number" min={1} required value={testNumber} onChange={(event) => setTestNumber(event.target.value)} />
            </label>
          </div>
        )}
        {fileField("readingWriting", "English (Reading & Writing) PDF")}
        {fileField("math", "Math PDF")}
        <p className="text-xs text-slate-600">Each PDF is checked straight away. You can upload one now and the other later, and re-upload a section that failed.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || (!files.readingWriting && !files.math)}>
            {busy ? "Checking the PDFs…" : "Upload"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Tests({ canWrite }: { canWrite: boolean }) {
  const uploads = useQuery({ queryKey: ["admin", "test-uploads"], queryFn: () => api<{ uploads: TestUploadSummary[] }>("/api/admin/test-uploads") });
  const [uploading, setUploading] = useState(false);
  const list = uploads.data?.uploads ?? [];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Full tests"
          subtitle="Fixed adaptive tests uploaded as PDFs: practice tests (their questions stay in their own test) and real SAT exams"
        />
        {canWrite && <Button onClick={() => setUploading(true)}>Upload test</Button>}
      </div>
      <FormatHelp />

      <Card className="p-0">
        <h2 className="border-b border-slate-900 px-5 py-4 font-bold">Uploaded tests ({list.length})</h2>
        {uploads.isLoading && (
          <div className="px-5">
            <Spinner label="Loading tests" />
          </div>
        )}
        {uploads.error && (
          <div className="p-4">
            <Notice tone="error">{uploads.error.message}</Notice>
          </div>
        )}
        {uploads.data && list.length === 0 && <p className="px-5 py-6 text-sm text-slate-600">No tests yet. Upload the two PDFs of a test to start.</p>}
        <ul className="divide-y divide-slate-200">
          {list.map((upload) => (
            <li key={upload.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.2fr_1fr_1fr_auto] md:items-start">
              <div>
                <Link href={`/admin/tests/${upload.id}`} className="font-bold text-brand-500 hover:underline">
                  {upload.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <TestStatusBadge upload={upload} />
                  <span className="rounded-full border border-slate-300 px-2 py-0.5 font-bold text-slate-700">{kindLabel(upload.kind)}</span>
                  <span>{uploadSubtitle(upload)}</span>
                </div>
              </div>
              {SECTIONS.map((section) => {
                const data = sectionOf(upload, section);
                return (
                  <div key={section} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold">{SECTION_FILE_LABELS[section].split(" ")[0]}</span>
                      <SectionBadge section={data} />
                      {data && data.status !== "failed" && <span className="text-xs text-slate-600">{data.questionCount} questions</span>}
                    </div>
                    {data && data.status !== "failed" && <ModuleCounts section={data} kind={section} />}
                    {data && data.warnings.length > 0 && <p className="text-xs font-bold text-amber-700">{data.warnings.length} warning(s)</p>}
                  </div>
                );
              })}
              <Link href={`/admin/tests/${upload.id}`} className="self-center text-sm font-bold text-brand-500 hover:underline md:justify-self-end">
                Open →
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      {uploading && <UploadDialog onClose={() => setUploading(false)} />}
    </>
  );
}

export default function AdminTestsPage() {
  return <RequireUser permission="papers:read">{(user) => <Tests canWrite={user.permissions.includes("papers:write")} />}</RequireUser>;
}
