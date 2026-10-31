"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ERROR_PATTERN_LABELS, SECTION_LABELS, SECTIONS, type Analytics, type NextStep, type Section } from "@satsharks/types";
import { ColumnChart, LineChart, Meter } from "@/components/charts";
import { UnlockButton } from "@/components/plan-lock";
import { Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useStartDrill } from "@/lib/engagement";
import { formatShortDuration } from "@/lib/format";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Every chart ends with one next step and a button that starts the matching drill.
function Step({ step, drills }: { step: NextStep; drills: ReturnType<typeof useStartDrill> }) {
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-brand-500 bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-slate-800">
        <span className="font-bold text-brand-700">Next step: </span>
        {step.text}
      </p>
      {step.drill && (
        <Button className="flex-none" disabled={drills.busy !== null} onClick={() => drills.start(step.drill!)}>
          {drills.busy === step.drill.label ? "Starting…" : step.drill.label}
        </Button>
      )}
    </div>
  );
}

function Locked({ what }: { what: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">{what}</p>
      <UnlockButton />
    </div>
  );
}

function Prediction({ data, drills }: { data: Analytics; drills: ReturnType<typeof useStartDrill> }) {
  const { prediction } = data;
  return (
    <Card>
      <h2 className="font-bold">Predicted SAT score</h2>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[52px] font-bold leading-none tracking-tight">{prediction.total ?? "–"}</div>
          {prediction.low !== null && (
            <div className="mt-1 text-sm text-slate-600">
              Likely range {prediction.low}–{prediction.high}
            </div>
          )}
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-slate-500">Reading and Writing</dt>
            <dd className="text-lg font-bold">{prediction.sections.reading_writing ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Math</dt>
            <dd className="text-lg font-bold">{prediction.sections.math ?? "–"}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        From your last scored sections ({prediction.basedOn} so far), newest counting most. It moves at most 50 points per test.
      </p>
      {data.full && prediction.trend.length > 1 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-bold">Trend</h3>
          <LineChart
            points={prediction.trend.map((point) => ({ label: shortDate(point.date), value: point.score }))}
            min={Math.max(400, Math.min(...prediction.trend.map((point) => point.score)) - 100)}
            max={Math.min(1600, Math.max(...prediction.trend.map((point) => point.score)) + 100)}
            caption="Predicted score after each scored section"
            valueLabel="Predicted"
          />
        </div>
      )}
      {!data.full && prediction.total !== null && <Locked what="Paid plans show the likely range and how your predicted score has moved." />}
      <Step step={data.predictionStep} drills={drills} />
    </Card>
  );
}

function Skills({ data, drills }: { data: Analytics; drills: ReturnType<typeof useStartDrill> }) {
  // Starts on the first listed section, so a student with answers in only one never opens on an empty list.
  const [section, setSection] = useState<Section>(data.skills[0]?.section ?? SECTIONS[0]);
  const skills = data.skills.filter((skill) => skill.section === section);

  return (
    <Card>
      <h2 className="font-bold">Skills breakdown</h2>
      <p className="mt-1 text-sm text-slate-600">Sorted by the points each skill could add to a real test (an estimate from how often it appears and how often you miss it).</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:inline-grid sm:grid-cols-[repeat(2,minmax(170px,auto))]">
        {SECTIONS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-pressed={section === entry}
            onClick={() => setSection(entry)}
            className={`min-h-[42px] cursor-pointer rounded-[8px] border px-3 text-[13px] font-bold sm:text-sm ${
              section === entry ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            }`}
          >
            {SECTION_LABELS[entry]}
          </button>
        ))}
      </div>
      {skills.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No {SECTION_LABELS[section]} answers yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200">
          {skills.map((skill) => (
            <li key={`${skill.section}-${skill.skill}`} className="grid gap-2 py-3 sm:grid-cols-[1fr_180px_90px] sm:items-center">
              <div className="min-w-0">
                <p className="text-sm font-bold">{skill.skill}</p>
                <p className="text-xs text-slate-500">
                  {skill.topic} · {skill.correct}/{skill.answered} right
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Meter value={skill.accuracy} label={`${skill.skill} accuracy`} />
                <span className="w-10 flex-none text-right text-xs font-bold tabular-nums">{Math.round(skill.accuracy * 100)}%</span>
              </div>
              <div className="text-sm font-bold tabular-nums sm:text-right">+{skill.pointsToGain} pts</div>
            </li>
          ))}
        </ul>
      )}
      {!data.full && skills.length > 0 && <Locked what="The free plan shows your 3 weakest areas in each section. Paid plans show every topic and skill." />}
      <Step step={data.skillSteps[section]} drills={drills} />
    </Card>
  );
}

function Errors({ data, drills }: { data: Analytics; drills: ReturnType<typeof useStartDrill> }) {
  return (
    <Card>
      <h2 className="font-bold">Error patterns</h2>
      <p className="mt-1 text-sm text-slate-600">Why you lose points, from your recent wrong and blank answers.</p>
      {!data.errors ? (
        <Locked what="Paid plans show why you lose points: careless mistakes, running out of time, unknown topics, changed answers and trap answers." />
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {data.errors.patterns.map((pattern) => (
              <li key={pattern.pattern}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-bold">{ERROR_PATTERN_LABELS[pattern.pattern].label}</span>
                  <span className="tabular-nums text-slate-700">
                    {pattern.count} · {Math.round(pattern.share * 100)}%
                  </span>
                </div>
                <div className="mt-1">
                  <Meter value={pattern.share} label={ERROR_PATTERN_LABELS[pattern.pattern].label} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {ERROR_PATTERN_LABELS[pattern.pattern].description}
                  {pattern.topSkill && pattern.count > 0 && ` · most often in ${pattern.topSkill.skill}`}
                </p>
              </li>
            ))}
          </ul>
          <Step step={data.errors.step} drills={drills} />
        </>
      )}
    </Card>
  );
}

function Timing({ data, drills }: { data: Analytics; drills: ReturnType<typeof useStartDrill> }) {
  const timing = data.timing;
  return (
    <Card>
      <h2 className="font-bold">Timing</h2>
      {!timing ? (
        <Locked what="Paid plans show your pace per question and the questions where you lose the most time." />
      ) : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {timing.sections.map((section) => (
              <div key={section.section} className="rounded-xl border border-slate-300 p-4">
                <p className="text-sm font-bold">{SECTION_LABELS[section.section]}</p>
                <p className="mt-1 text-2xl font-bold">{section.averageSeconds !== null ? formatShortDuration(section.averageSeconds) : "–"}</p>
                <p className="text-xs text-slate-500">
                  a question on average · official pace {formatShortDuration(section.paceSeconds)}
                  {section.averageSeconds !== null && section.averageSeconds > section.paceSeconds && " · slower than the test allows"}
                </p>
              </div>
            ))}
          </div>
          {timing.pace && (
            <div className="mt-4">
              <h3 className="text-sm font-bold">Pace in your latest timed test</h3>
              <p className="mb-2 text-xs text-slate-500">{timing.pace.name}: seconds on each question</p>
              <ColumnChart
                columns={timing.pace.seconds.map((seconds, index) => ({ label: String(index + 1), value: seconds, detail: `Question ${index + 1}` }))}
                reference={{ value: timing.pace.paceSeconds, label: `Pace ${timing.pace.paceSeconds}s` }}
                caption="Seconds on each question in the latest timed test"
                valueLabel="Seconds"
              />
            </div>
          )}
          {timing.slowest.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold">Where you lost the most time</h3>
              <ul className="mt-2 divide-y divide-slate-200 text-sm">
                {timing.slowest.map((question) => (
                  <li key={`${question.attemptId}-${question.position}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      {question.skill ?? SECTION_LABELS[question.section]} · {formatShortDuration(question.seconds)}{" "}
                      <span className="text-slate-500">(+{formatShortDuration(question.overPace)} over pace{question.correct === false ? ", wrong" : ""})</span>
                    </span>
                    <Link href={`/practice/${question.attemptId}/results?q=${question.position}`} className="flex-none font-bold text-brand-500 hover:underline">
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Step step={timing.step} drills={drills} />
        </>
      )}
    </Card>
  );
}

export default function AnalyticsPage() {
  const analytics = useQuery({ queryKey: ["student", "analytics"], queryFn: () => api<Analytics>("/api/student/analytics") });
  const drills = useStartDrill();
  const data = analytics.data;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Where your points go, and what to practise next." />
      {analytics.isLoading && <Spinner label="Working out your analytics" />}
      {analytics.error && <Notice tone="error">{analytics.error.message}</Notice>}
      {drills.error && (
        <div className="mb-4">
          <Notice tone="error">{drills.error}</Notice>
        </div>
      )}
      {data && (
        <div className="grid grid-cols-1 gap-4">
          {data.completedPapers < 2 && (
            <Notice tone="info">
              Your analytics fill in as you practise. They are most useful after 2 finished tests ({data.completedPapers} so far).
            </Notice>
          )}
          <Prediction data={data} drills={drills} />
          <Skills data={data} drills={drills} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Errors data={data} drills={drills} />
            <Timing data={data} drills={drills} />
          </div>
        </div>
      )}
    </>
  );
}
