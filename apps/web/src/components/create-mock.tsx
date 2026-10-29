"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FULL_TEST_BREAK_MINUTES,
  MOCK_FORMAT,
  SECTION_LABELS,
  TIME_MULTIPLIERS,
  type AttemptSummary,
  type FullTestSummary,
  type PracticeCatalog,
  type Section,
  type TimeMultiplier,
} from "@satsharks/types";
import { api } from "@/lib/api";
import { Modal, Notice } from "./ui";

const option = (active: boolean) =>
  `min-h-[40px] cursor-pointer rounded-[8px] border px-3.5 py-2 text-left text-[13px] font-bold transition-colors ${
    active ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500/20" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
  }`;

// A single adaptive section, or both sections in one sitting (Reading & Writing, break, Math).
type Mode = Section | "full";
const MODES: { id: Mode; label: string }[] = [
  { id: "full", label: "Full Test" },
  { id: "math", label: "Math" },
  { id: "reading_writing", label: "Reading & Writing" },
];
// Reading & Writing comes first on the real test.
const sectionsOf = (mode: Mode): Section[] => (mode === "full" ? ["reading_writing", "math"] : [mode]);

// A full test and a single-section mock are set separately in Admin → Access.
const modeOpen = (catalog: PracticeCatalog, mode: Mode) => (mode === "full" ? catalog.access.features.full_tests : catalog.access.features.mocks);
// Opens on the first mode this account can start: its kind of mock is open, and so is an exam for
// every section of it.
const usableMode = (catalog: PracticeCatalog) =>
  MODES.find((entry) => modeOpen(catalog, entry.id) && sectionsOf(entry.id).every((section) => catalog.exams.some((exam) => !exam.locked && exam.sections[section])))?.id ?? "full";

export function CreateMock({ catalog, onClose }: { catalog: PracticeCatalog; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>(() => usableMode(catalog));
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [timed, setTimed] = useState(true);
  const [multiplier, setMultiplier] = useState<TimeMultiplier>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(() => sectionsOf(mode), [mode]);
  // Exams that have questions in any section of this mode can be part of the pool. For a free
  // account, "All Exams" means the exams open to it (the server applies the same rule).
  const inMode = useMemo(() => catalog.exams.filter((exam) => sections.some((section) => exam.sections[section])), [catalog, sections]);
  const exams = useMemo(() => inMode.filter((exam) => !exam.locked), [inMode]);
  const lockedCount = inMode.length - exams.length;
  const open = modeOpen(catalog, mode);
  const chosen = selected.length === 0 ? exams : exams.filter((exam) => selected.includes(exam.examId));
  const pools = sections.map((section) => {
    const needed = MOCK_FORMAT[section].questionsPerModule * 2;
    const size = chosen.reduce((sum, exam) => sum + (exam.sections[section]?.questionCount ?? 0), 0);
    const paperIds = selected.length === 0 ? [] : chosen.map((exam) => exam.sections[section]?.paperId).filter((id): id is string => !!id);
    // Chosen exams too small (or without this section at all) are topped up by the server from the
    // account's other open exams; only when those cannot fill it either is the test refused.
    const available = exams.reduce((sum, exam) => sum + (exam.sections[section]?.questionCount ?? 0), 0);
    return { section, needed, size, paperIds, toppedUp: size < needed && available >= needed };
  });
  const short = pools.filter((pool) => pool.size < pool.needed && !pool.toppedUp);
  const totalQuestions = pools.reduce((sum, pool) => sum + pool.needed, 0);
  const totalMinutes = sections.reduce((sum, section) => sum + MOCK_FORMAT[section].minutesPerModule * 2, 0) * multiplier;

  const toggle = (examId: string) => setSelected((list) => (list.includes(examId) ? list.filter((id) => id !== examId) : [...list, examId]));
  const changeMode = (next: Mode) => {
    setMode(next);
    setSelected([]);
  };

  async function start() {
    setSubmitting(true);
    setError(null);
    try {
      const common = { timed, timeMultiplier: timed ? multiplier : 1, name: name.trim() };
      if (mode === "full") {
        const paperIds = Object.fromEntries(pools.map((pool) => [pool.section, pool.paperIds]));
        const { fullTest } = await api<{ fullTest: FullTestSummary }>("/api/practice/full-tests", { method: "POST", body: { ...common, paperIds } });
        await queryClient.invalidateQueries({ queryKey: ["practice"] });
        router.push(`/practice/${fullTest.readingWriting!.id}`);
      } else {
        const { attempt } = await api<{ attempt: AttemptSummary }>("/api/practice/mocks", { method: "POST", body: { ...common, section: mode, paperIds: pools[0]!.paperIds } });
        await queryClient.invalidateQueries({ queryKey: ["practice"] });
        router.push(`/practice/${attempt.id}`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the test");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Start Adaptive Mock Exam" onClose={onClose} wide>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <div>
            <span className="mb-2 block text-sm font-bold">What to take</span>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={mode === entry.id}
                  onClick={() => changeMode(entry.id)}
                  className={`min-h-[42px] cursor-pointer rounded-[8px] border px-2 text-[13px] font-bold sm:text-sm ${
                    mode === entry.id ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  {entry.label}
                  {!modeOpen(catalog, entry.id) && <span className="ml-1 font-normal opacity-80">(Paid)</span>}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-600">
              {mode === "full"
                ? `Reading and Writing, a ${FULL_TEST_BREAK_MINUTES}-minute break, then Math. Gives a total score out of 1600.`
                : `One section in two modules. Gives a ${SECTION_LABELS[mode]} score out of 800.`}
            </p>
          </div>

          {!open && (
            <Notice tone="info">
              {mode === "full" ? "Full tests are" : "Single-section mocks are"} available on the paid plans.{" "}
              <Link href="/pricing" className="font-bold text-brand-500 hover:underline">
                See plans
              </Link>
            </Notice>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold">Exam Question Pool</span>
              <span className="text-xs font-bold text-brand-500">
                {selected.length === 0 ? (lockedCount > 0 ? "All open exams selected" : "All exams selected") : `${selected.length} selected`}
              </span>
            </div>
            {lockedCount > 0 && (
              <p className="-mt-1 mb-2 text-xs text-slate-600">
                {lockedCount} more {lockedCount === 1 ? "exam opens" : "exams open"} with a{" "}
                <Link href="/pricing" className="font-bold text-brand-500 hover:underline">
                  paid plan
                </Link>
                .
              </p>
            )}
            {exams.length === 0 ? (
              <Notice tone="info">{lockedCount > 0 ? "No exam open on your plan has questions for this test." : "No published exams have questions for this test yet."}</Notice>
            ) : (
              <div className="grid max-h-[290px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                <button type="button" aria-pressed={selected.length === 0} onClick={() => setSelected([])} className={option(selected.length === 0)}>
                  {lockedCount > 0 ? "All Open Exams" : "All Exams"}
                </button>
                {exams.map((exam) => (
                  <button
                    key={exam.examId}
                    type="button"
                    aria-pressed={selected.includes(exam.examId)}
                    onClick={() => toggle(exam.examId)}
                    className={`${option(selected.includes(exam.examId))} truncate`}
                    title={exam.name}
                  >
                    {exam.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-slate-300 bg-slate-50 p-4 sm:p-5">
          <dl className="space-y-2 rounded-lg border border-slate-300 bg-white p-4 text-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Format</div>
            <div className="flex justify-between gap-3">
              <dt className="font-semibold">Questions</dt>
              <dd className="text-right">{totalQuestions}</dd>
            </div>
            {sections.map((section) => (
              <div key={section} className="flex justify-between gap-3 text-slate-600">
                <dt>{SECTION_LABELS[section]}</dt>
                <dd className="text-right">
                  2 × {MOCK_FORMAT[section].questionsPerModule} questions, {timed ? `${MOCK_FORMAT[section].minutesPerModule * multiplier} min each` : "untimed"}
                </dd>
              </div>
            ))}
            {timed && (
              <div className="flex justify-between gap-3">
                <dt className="font-semibold">Total time</dt>
                <dd className="text-right">
                  {totalMinutes} minutes{mode === "full" ? ` + ${FULL_TEST_BREAK_MINUTES}-min break` : ""}
                </dd>
              </div>
            )}
            {/* Pool sizes: premium accounts only (client, 2026-10-30). A topped-up pool is not shown:
                students are not told that an exam lacks a section's questions (client). */}
            {catalog.access.paid &&
              pools
                .filter((pool) => !pool.toppedUp)
                .map((pool) => (
                  <div key={pool.section} className="flex justify-between gap-3">
                    <dt className="font-semibold">{mode === "full" ? `${SECTION_LABELS[pool.section]} pool` : "Questions in pool"}</dt>
                    <dd className={pool.size < pool.needed ? "font-bold text-red-700" : ""}>{pool.size.toLocaleString()}</dd>
                  </div>
                ))}
          </dl>

          <label className="block text-sm font-bold">
            Title (optional)
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder={mode === "full" ? "e.g. Practice test 1" : `e.g. ${SECTION_LABELS[mode]} mock 1`}
              className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </label>

          <label className="flex h-11 cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">
            Official Countdown
            <input type="checkbox" checked={timed} onChange={(event) => setTimed(event.target.checked)} className="h-4 w-4 accent-brand-500" />
          </label>

          {timed && (
            <fieldset>
              <legend className="mb-1.5 text-sm font-bold">Time accommodation</legend>
              <div className="grid grid-cols-3 gap-2">
                {TIME_MULTIPLIERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={multiplier === value}
                    onClick={() => setMultiplier(value)}
                    className={`min-h-10 cursor-pointer rounded-lg border text-[13px] font-bold ${
                      multiplier === value ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500/20" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {value === 1 ? "Standard" : `${value}× time`}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-600">For students approved for extended time. Every module&apos;s timer is multiplied.</p>
            </fieldset>
          )}

          <p className="text-xs text-slate-600">Module 2 adapts to your Module 1 result. A submitted module cannot be reopened.</p>
          {short.length > 0 && exams.length > 0 && (
            <Notice tone="error">
              {short.map((pool) => (catalog.access.paid ? `${SECTION_LABELS[pool.section]} needs ${pool.needed} questions; these exams have ${pool.size}.` : `These exams do not have enough ${SECTION_LABELS[pool.section]} questions.`)).join(" ")} Choose more exams.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          <button
            type="button"
            disabled={submitting || !open || exams.length === 0 || short.length > 0}
            onClick={start}
            className="h-[44px] w-full cursor-pointer rounded-[10px] bg-brand-500 text-[14px] font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Starting…" : mode === "full" ? "Start Full Test" : `Start ${SECTION_LABELS[mode]} Mock`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
