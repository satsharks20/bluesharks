"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FULL_TEST_BREAK_MINUTES, MOCK_FORMAT, SECTION_LABELS, SECTIONS, TIME_MULTIPLIERS, type FullTestSummary, type PracticeTestListing, type TimeMultiplier } from "@satsharks/types";
import { api } from "@/lib/api";
import { ContentPills, LockedAction, PaidBadge } from "./plan-lock";
import { Modal, Notice } from "./ui";

const heading = "text-[20px] font-bold tracking-tight text-black sm:text-[22px]";
const total = (test: PracticeTestListing, section: (typeof SECTIONS)[number]) => test.moduleCounts[section].m1 + test.moduleCounts[section].m2_easy;

// Starting a fixed practice test (or an uploaded exam taken whole): the same choices as a full
// adaptive mock, without the exam pool.
export function StartPracticeTest({ test, onClose }: { test: PracticeTestListing; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [timed, setTimed] = useState(true);
  const [multiplier, setMultiplier] = useState<TimeMultiplier>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minutes = SECTIONS.reduce((sum, section) => sum + MOCK_FORMAT[section].minutesPerModule * 2, 0) * multiplier;

  async function start() {
    setSubmitting(true);
    setError(null);
    try {
      const { fullTest } = await api<{ fullTest: FullTestSummary }>("/api/practice/full-tests", {
        method: "POST",
        body: { testUploadId: test.id, timed, timeMultiplier: timed ? multiplier : 1 },
      });
      await queryClient.invalidateQueries({ queryKey: ["practice"] });
      router.push(`/practice/${fullTest.readingWriting!.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the test");
      setSubmitting(false);
    }
  }

  return (
    <Modal title={test.title} onClose={onClose}>
      <div className="space-y-4">
        <dl className="space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-4 text-sm">
          {SECTIONS.map((section) => (
            <div key={section} className="flex justify-between gap-3">
              <dt className="font-semibold">{SECTION_LABELS[section]}</dt>
              <dd className="text-right">
                2 modules, {total(test, section)} questions{timed ? `, ${MOCK_FORMAT[section].minutesPerModule * multiplier} min each` : ""}
              </dd>
            </div>
          ))}
          {timed && (
            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
              <dt className="font-semibold">Total time</dt>
              <dd>
                {minutes} minutes + {FULL_TEST_BREAK_MINUTES}-min break
              </dd>
            </div>
          )}
        </dl>
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
          </fieldset>
        )}
        <p className="text-xs text-slate-600">
          Reading and Writing, a {FULL_TEST_BREAK_MINUTES}-minute break, then Math. Module 2 of each section adapts to your Module 1 result. A submitted module cannot be reopened.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <button
          type="button"
          disabled={submitting}
          onClick={start}
          className="h-[44px] w-full cursor-pointer rounded-[10px] bg-brand-500 text-[14px] font-bold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Start Test"}
        </button>
      </div>
    </Modal>
  );
}

// Active uploaded tests, practice tests and exams alike (exams are shown on their exam card).
export const usePracticeTests = () => useQuery({ queryKey: ["practice", "tests"], queryFn: () => api<{ tests: PracticeTestListing[] }>("/api/practice/tests") });

// Fixed full-length tests published by SAT Sharks. Hidden when there are none. Question counts are
// for premium accounts only (client, 2026-10-30).
export function PracticeTests({ showFree = false, showCounts = false }: { showFree?: boolean; showCounts?: boolean }) {
  const tests = usePracticeTests();
  const [starting, setStarting] = useState<PracticeTestListing | null>(null);
  const list = tests.data?.tests.filter((test) => test.kind === "practice") ?? [];
  if (list.length === 0) return null;

  return (
    <section>
      <h2 className={`${heading} mb-1`}>Full-Length Practice Tests</h2>
      <p className="mb-3.5 text-sm font-medium text-slate-600">Complete adaptive tests </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {list.map((test) => (
          <div key={test.id} className="flex flex-col justify-between gap-4 rounded-[14px] border border-black bg-white p-4 text-black sm:p-5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="whitespace-nowrap rounded-full border border-brand-500 bg-white px-2.5 py-0.5 text-[11px] font-bold text-brand-500">Test {test.testNumber}</span>
                <span className="whitespace-nowrap rounded-full border border-black bg-white px-2.5 py-0.5 text-[11px] font-bold">{test.year}</span>
              </div>
              <h3 className="flex min-h-[44px] items-center text-[18px] font-bold leading-snug tracking-tight">{test.title}</h3>
              <ContentPills label={test.label} pinned={test.pinned} free={test.free} showFree={showFree} />
              {showCounts && (
                <p className="text-xs text-slate-600">
                  RW: {total(test, "reading_writing")} · Math: {total(test, "math")} questions
                </p>
              )}
              {test.locked && (
                <span>
                  <PaidBadge reason={test.lockReason ?? "paid"} />
                </span>
              )}
            </div>
            {test.locked ? (
              <LockedAction reason={test.lockReason ?? "paid"} className="w-full" />
            ) : (
              <button
                type="button"
                onClick={() => setStarting(test)}
                className="flex h-[42px] w-full cursor-pointer items-center justify-center rounded-[10px] bg-brand-500 text-[14px] font-bold text-white hover:opacity-90"
              >
                Start Test
              </button>
            )}
          </div>
        ))}
      </div>
      {starting && <StartPracticeTest test={starting} onClose={() => setStarting(null)} />}
    </section>
  );
}
