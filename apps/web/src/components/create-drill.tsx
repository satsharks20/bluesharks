"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SECTION_LABELS, type AttemptSummary, type Difficulty, type PracticeCatalog, type Section } from "@satsharks/types";
import { api } from "@/lib/api";
import { Button, Modal, Notice, Toggle } from "./ui";

const LIMITS = [10, 25, 50] as const;
const DIFFICULTY_OPTIONS: { id: Difficulty | null; label: string }[] = [
  { id: null, label: "All Difficulties" },
  { id: "easy", label: "Easy" },
  { id: "hard", label: "Hard" },
];
const SKILLS_PER_PAGE = 6;
// The exam choice that draws from every open exam (drill mode by topic and skill).
const ALL_EXAMS = "__all__";
const BANK_MAX = 100;

const fieldLabel = "mb-2 block text-sm font-bold";
const inputClass = "h-10 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500";

export function CreateDrill({ catalog, initialExamId, onClose }: { catalog: PracticeCatalog; initialExamId?: string; onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Exams kept for paid plans are not offered to a free account.
  const exams = useMemo(() => catalog.exams.filter((exam) => !exam.locked), [catalog]);
  const firstExam = exams.find((exam) => exam.examId === initialExamId) ?? exams[0];
  const [examId, setExamId] = useState(initialExamId === ALL_EXAMS ? ALL_EXAMS : (firstExam?.examId ?? ""));
  const allExams = examId === ALL_EXAMS;
  // Sections offered with "All exams": those any open exam has.
  const anyExam = useMemo(
    () => ({ sections: { math: exams.some((entry) => entry.sections.math) ? { paperId: "", questionCount: 0 } : undefined, reading_writing: exams.some((entry) => entry.sections.reading_writing) ? { paperId: "", questionCount: 0 } : undefined } }),
    [exams],
  );
  const exam = allExams ? anyExam : exams.find((entry) => entry.examId === examId);
  const [section, setSection] = useState<Section>(firstExam?.sections.math ? "math" : "reading_writing");
  const [topics, setTopics] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillPage, setSkillPage] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [limit, setLimit] = useState<number | null>(25);
  const [custom, setCustom] = useState(false);
  const [timed, setTimed] = useState(false);
  const [minutes, setMinutes] = useState(30);
  const [excludeAnswered, setExcludeAnswered] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An exam may have only one of the two sections.
  useEffect(() => {
    if (exam && !exam.sections[section]) setSection(exam.sections.math ? "math" : "reading_writing");
  }, [exam, section]);

  const sectionTopics = catalog.topics[section];
  // Skills offered are those of the selected domains, or all of them when none is selected.
  const availableSkills = useMemo(
    // A few source questions file a skill under a second domain, so the same skill can appear twice.
    () => [...new Set(sectionTopics.filter((entry) => topics.length === 0 || topics.includes(entry.topic)).flatMap((entry) => entry.skills))],
    [sectionTopics, topics],
  );
  const pageCount = Math.max(1, Math.ceil(availableSkills.length / SKILLS_PER_PAGE));
  const page = Math.min(skillPage, pageCount - 1);
  const target = exam?.sections[section];
  const bankLimit = Math.min(limit ?? BANK_MAX, BANK_MAX);

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const changeSection = (next: Section) => {
    setSection(next);
    setTopics([]);
    setSkills([]);
    setSkillPage(0);
  };

  async function start() {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      // Only send skills that are still offered under the current domain selection.
      const chosenSkills = skills.filter((skill) => availableSkills.includes(skill));
      const common = { topics, skills: chosenSkills, difficulty, timed, timeMinutes: timed ? minutes : null, excludeAnswered, name: name.trim() };
      const { attempt } = allExams
        ? await api<{ attempt: AttemptSummary }>("/api/practice/drills/bank", { method: "POST", body: { ...common, section, count: bankLimit } })
        : await api<{ attempt: AttemptSummary }>("/api/practice/attempts", { method: "POST", body: { ...common, paperId: target.paperId, limit } });
      await queryClient.invalidateQueries({ queryKey: ["practice", "attempts"] });
      router.push(`/practice/${attempt.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the drill");
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Create Practice Drill" onClose={onClose} wide>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <div>
            <label htmlFor="drill-exam" className={fieldLabel}>
              Exam
            </label>
            <select id="drill-exam" value={examId} onChange={(event) => setExamId(event.target.value)} className={inputClass}>
              {exams.length > 1 && <option value={ALL_EXAMS}>All exams (by topic and skill)</option>}
              {exams.map((entry) => (
                <option key={entry.examId} value={entry.examId}>
                  {entry.name}
                </option>
              ))}
            </select>
            {exams.length < catalog.exams.length && (
              <p className="mt-1.5 text-xs text-slate-600">
                {catalog.exams.length - exams.length} more {catalog.exams.length - exams.length === 1 ? "exam opens" : "exams open"} with a{" "}
                <Link href="/pricing" className="font-bold text-brand-500 hover:underline">
                  paid plan
                </Link>
                .
              </p>
            )}
          </div>

          <div>
            <span className={fieldLabel}>Target Section</span>
            <div className="grid grid-cols-2 gap-2">
              {(["math", "reading_writing"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  disabled={!exam?.sections[entry]}
                  onClick={() => changeSection(entry)}
                  className={`h-10 cursor-pointer rounded-lg border text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 ${
                    section === entry ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100"
                  }`}
                >
                  {entry === "math" ? "Math Section" : "Reading & Writing"}
                  {/* Question counts: premium accounts only (client, 2026-10-30). */}
                  {allExams ? "" : exam?.sections[entry] ? (catalog.access.paid ? ` (${exam.sections[entry]!.questionCount})` : "") : " (none)"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold">Target Domains (Optional)</span>
              {topics.length > 0 && (
                <button type="button" onClick={() => setTopics([])} className="cursor-pointer text-xs font-bold text-slate-500 hover:underline">
                  Clear ({topics.length})
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {sectionTopics.map((entry) => (
                <Toggle key={entry.topic} active={topics.includes(entry.topic)} onClick={() => setTopics(toggle(topics, entry.topic))}>
                  {entry.topic}
                </Toggle>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold">
                Target Skills (Optional) <span className="font-normal text-slate-500">({skills.length} selected)</span>
              </span>
              {skills.length > 0 && (
                <button type="button" onClick={() => setSkills([])} className="cursor-pointer text-xs font-bold text-slate-500 hover:underline">
                  Clear
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {availableSkills.slice(page * SKILLS_PER_PAGE, (page + 1) * SKILLS_PER_PAGE).map((skill) => (
                <Toggle key={skill} active={skills.includes(skill)} onClick={() => setSkills(toggle(skills, skill))} className="font-semibold">
                  {skill}
                </Toggle>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="mt-2 flex items-center justify-between text-xs">
                <span>
                  Page <b>{page + 1}</b> of <b>{pageCount}</b>
                </span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setSkillPage(page - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setSkillPage(page + 1)}>
                    Next
                  </Button>
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5 rounded-xl border border-slate-300 bg-slate-50 p-5">
          <div>
            <span className={fieldLabel}>Difficulty Level (Optional)</span>
            <div className="grid grid-cols-3 gap-2">
              {DIFFICULTY_OPTIONS.map((option) => (
                <Toggle key={option.label} active={difficulty === option.id} onClick={() => setDifficulty(option.id)} className="text-center">
                  {option.label}
                </Toggle>
              ))}
            </div>
          </div>

          <div>
            <span className={fieldLabel}>Question Limit</span>
            <div className="grid grid-cols-4 gap-2">
              {LIMITS.map((value) => (
                <Toggle key={value} active={!custom && limit === value} onClick={() => (setCustom(false), setLimit(value))} className="text-center">
                  {value} Qs
                </Toggle>
              ))}
              <Toggle active={custom} onClick={() => setCustom(true)} className="text-center">
                Custom
              </Toggle>
            </div>
            {custom && (
              <input
                type="number"
                min={1}
                max={200}
                value={limit ?? ""}
                onChange={(event) => {
                  const value = parseInt(event.target.value, 10);
                  setLimit(Number.isNaN(value) ? null : Math.min(200, Math.max(1, value)));
                }}
                placeholder="1 to 200"
                aria-label="Custom question count"
                className={`${inputClass} mt-2 bg-white`}
              />
            )}
          </div>

          <div>
            <span className={fieldLabel}>Countdown Timer</span>
            <label className="flex h-10 cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">
              Enable Timer
              <input type="checkbox" checked={timed} onChange={(event) => setTimed(event.target.checked)} className="h-4 w-4 accent-brand-500" />
            </label>
            {timed && (
              <label className="mt-2 block text-xs font-semibold text-slate-600">
                Time Limit (Minutes)
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={minutes}
                  onChange={(event) => setMinutes(Math.min(600, Math.max(1, parseInt(event.target.value, 10) || 1)))}
                  className={`${inputClass} mt-1 bg-white`}
                />
              </label>
            )}
          </div>

          <label className="flex h-10 cursor-pointer items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold">
            Exclude Answered Qs
            <input type="checkbox" checked={excludeAnswered} onChange={(event) => setExcludeAnswered(event.target.checked)} className="h-4 w-4 accent-brand-500" />
          </label>

          <div>
            <label htmlFor="drill-name" className={fieldLabel}>
              Drill Title (Optional)
            </label>
            <input id="drill-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="e.g. Algebra practice" className={`${inputClass} bg-white`} />
          </div>

          {catalog.access.dailyDrill && (
            <Notice tone="info">
              Free plan: {Math.max(0, catalog.access.dailyDrill.limit - catalog.access.dailyDrill.used)} of {catalog.access.dailyDrill.limit} drill questions left today. A longer
              drill is cut to what is left.{" "}
              <a href="/pricing" className="font-bold text-brand-500 hover:underline">
                Unlimited drills
              </a>
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <Button className="w-full" disabled={submitting || !target || (custom && limit === null)} onClick={start}>
            {submitting ? "Starting…" : `Start Drill (${allExams ? bankLimit : (limit ?? "All")} Qs, ${SECTION_LABELS[section]})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
