"use client";

import { useState } from "react";
import { MOCK_FORMAT, MOCK_MODULE_LABELS, MOCK_MODULES, TEST_UPLOAD_KINDS, type Section, type TestUploadKind, type TestUploadSection, type TestUploadSummary } from "@satsharks/types";
import { Badge } from "./ui";

// Pieces shared by the uploaded-test list and the test page.

export const SECTION_FILE_LABELS: Record<Section, string> = { reading_writing: "English (Reading & Writing)", math: "Math" };
export const sectionOf = (upload: TestUploadSummary, section: Section) => (section === "math" ? upload.math : upload.readingWriting);

const KIND_TEXT: Record<TestUploadKind, { label: string; help: string }> = {
  practice: {
    label: "Practice test",
    help: "Shown under Full-Length Practice Tests. Its questions are used only in this test.",
  },
  exam: {
    label: "Exam",
    help: "A real SAT administration. Shown under Exams with the past exams: students start it like the other exams, and its questions join drills and random mocks.",
  },
};

export const kindLabel = (kind: TestUploadKind) => KIND_TEXT[kind].label;

// "Exam · 6 Dec 2026" or "2026 · Test 23".
export function uploadSubtitle(upload: Pick<TestUploadSummary, "kind" | "year" | "testNumber" | "examDate">): string {
  if (upload.kind === "exam" && upload.examDate) {
    const date = new Date(`${upload.examDate}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    return `Exam · ${date}`;
  }
  return `${upload.year} · Test ${upload.testNumber}`;
}

// Where the test goes: Full-Length Practice Tests or Exams.
export function KindChoice({ value, onChange, disabled }: { value: TestUploadKind; onChange: (kind: TestUploadKind) => void; disabled?: boolean }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-bold">Add to</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {TEST_UPLOAD_KINDS.map((kind) => (
          <label
            key={kind}
            className={`flex cursor-pointer gap-2.5 rounded-lg border p-3 text-sm ${value === kind ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500/20" : "border-slate-300 bg-white hover:bg-slate-50"}`}
          >
            <input type="radio" name="kind" className="mt-0.5 h-4 w-4 flex-none accent-brand-500" checked={value === kind} disabled={disabled} onChange={() => onChange(kind)} />
            <span>
              <span className="block font-bold">{kind === "exam" ? "Exams" : "Practice tests"}</span>
              <span className="mt-0.5 block text-xs text-slate-600">{KIND_TEXT[kind].help}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TestStatusBadge({ upload }: { upload: TestUploadSummary }) {
  if (upload.status === "draft") return <Badge tone="amber">Draft</Badge>;
  return upload.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>;
}

export function SectionBadge({ section }: { section: TestUploadSection | null }) {
  if (!section) return <Badge tone="neutral">Not uploaded</Badge>;
  if (section.status === "failed") return <Badge tone="red">Failed</Badge>;
  if (section.status === "reviewed") return <Badge tone="green">Reviewed</Badge>;
  return <Badge tone="brand">Needs review</Badge>;
}

// Questions per module; a count that is not the official module size is marked.
export function ModuleCounts({ section, kind }: { section: TestUploadSection; kind: Section }) {
  const expected = MOCK_FORMAT[kind].questionsPerModule;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
      {MOCK_MODULES.map((module) => {
        const count = section.moduleCounts[module];
        return (
          <li key={module} className={count !== expected ? "font-bold text-amber-700" : ""} title={count !== expected ? `An official module has ${expected}` : undefined}>
            {MOCK_MODULE_LABELS[module]}: {count}
          </li>
        );
      })}
    </ul>
  );
}

// Why a section failed, folded by default because the list can be long.
export function FailureDetails({ message, open: startOpen = false }: { message: string; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const lines = message.split("\n");
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <button type="button" className="cursor-pointer font-bold underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Why it failed"} ({Math.max(1, lines.length - 1)} problem{lines.length - 1 === 1 ? "" : "s"})
      </button>
      {open && <p className="mt-2 whitespace-pre-line leading-6">{message}</p>}
    </div>
  );
}

export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      {warnings.map((warning) => (
        <li key={warning}>⚠ {warning}</li>
      ))}
    </ul>
  );
}
