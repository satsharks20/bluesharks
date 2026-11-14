"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MOCK_FORMAT,
  MOCK_MODULE_LABELS,
  MOCK_MODULES,
  SECTIONS,
  splitAcceptedValues,
  uploadQuestionProblems,
  type CatalogTopic,
  type Difficulty,
  type MockModule,
  type Section,
  type TestUploadSummary,
  type UploadQuestion,
} from "@satsharks/types";
import { checkLatex, emptyChoices, QuestionForm, QuestionPreview, type QuestionDraft } from "@/components/question-form";
import { RequireUser } from "@/components/require-user";
import { SECTION_FILE_LABELS, sectionOf } from "@/components/test-upload-ui";
import { Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";

type Detail = { upload: TestUploadSummary; topics: Record<Section, CatalogTopic[]> };
type Item = QuestionDraft & { module: MockModule };

const toItem = (question: UploadQuestion): Item => ({
  module: question.module,
  questionType: question.questionType,
  difficulty: question.difficulty,
  topic: question.topic,
  skill: question.skill ?? "",
  passage: question.passage ?? "",
  prompt: question.prompt,
  choices: question.questionType === "mcq" ? question.choices : emptyChoices(),
  choiceKey: question.choiceKey ?? "",
  acceptedValues: question.acceptedValues.join(" or "),
  explanation: question.explanation,
});

const toUpload = (item: Item, questionNumber: number): UploadQuestion => ({
  module: item.module,
  questionNumber,
  questionType: item.questionType === "spr" ? "spr" : "mcq",
  difficulty: (item.difficulty || "medium") as Difficulty,
  topic: item.topic,
  skill: item.skill || null,
  passage: item.passage.trim() ? item.passage : null,
  prompt: item.prompt,
  choices: item.questionType === "mcq" ? item.choices.map(({ key, text }) => ({ key, text })) : [],
  choiceKey: item.questionType === "mcq" ? item.choiceKey || null : null,
  acceptedValues: item.questionType === "mcq" ? [] : splitAcceptedValues(item.acceptedValues),
  explanation: item.explanation,
});

function Review({ id, section }: { id: string; section: Section }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["admin", "test-upload", id], queryFn: () => api<Detail>(`/api/admin/test-uploads/${id}`), staleTime: Infinity });
  const [items, setItems] = useState<Item[] | null>(null);
  const [module, setModule] = useState<MockModule>("m1");
  const [current, setCurrent] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = detail.data ? sectionOf(detail.data.upload, section) : null;
  useEffect(() => {
    if (data?.questions && items === null) setItems(data.questions.map(toItem));
  }, [data, items]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const topics = detail.data?.topics[section] ?? [];
  // Problems per question (index into items), checked live with the same rules as the server.
  const problems = useMemo(() => {
    if (!items) return [];
    const numbers = new Map<MockModule, number>();
    return items.map((item) => {
      const number = (numbers.get(item.module) ?? 0) + 1;
      numbers.set(item.module, number);
      const extra = item.difficulty ? [] : ["DIFFICULTY is not set"];
      return [...extra, ...uploadQuestionProblems(toUpload(item, number), section, topics, checkLatex)];
    });
  }, [items, section, topics]);

  if (detail.isLoading) return <Spinner label="Loading questions" />;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data || !data) return <Notice tone="error">This section has not been uploaded.</Notice>;
  if (detail.data.upload.status === "published") return <Notice tone="info">This test is published. Edit its questions from the test page.</Notice>;
  if (data.status === "failed") return <Notice tone="error">This PDF failed the checks. Re-upload it from the test page.</Notice>;
  if (!items) return <Spinner label="Loading questions" />;

  const indexes = items.map((item, index) => ({ item, index })).filter((entry) => entry.item.module === module);
  const position = Math.min(current, Math.max(0, indexes.length - 1));
  const selected = indexes[position];
  const totalProblems = problems.filter((list) => list.length > 0).length;
  const moduleProblems = (target: MockModule) => items.filter((item, index) => item.module === target && problems[index]!.length > 0).length;

  const update = (index: number, draft: QuestionDraft) => {
    setItems(items.map((item, at) => (at === index ? { ...item, ...draft } : item)));
    setDirty(true);
  };

  async function save() {
    if (!items) return;
    setSaving(true);
    setError(null);
    try {
      const numbers = new Map<MockModule, number>();
      const questions = items.map((item) => {
        const number = (numbers.get(item.module) ?? 0) + 1;
        numbers.set(item.module, number);
        return toUpload(item, number);
      });
      await api(`/api/admin/test-uploads/${id}/sections/${section}`, { method: "PUT", body: { questions } });
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "test-upload", id] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "test-uploads"] });
      router.push(`/admin/tests/${id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save");
      setSaving(false);
    }
  }

  const expected = MOCK_FORMAT[section].questionsPerModule;

  return (
    <>
      <PageHeader title={`Review ${SECTION_FILE_LABELS[section]}`} subtitle={`${detail.data.upload.title} · ${items.length} questions. Fix anything that was read wrongly, then save.`} />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Modules">
        {MOCK_MODULES.map((entry) => {
          const count = items.filter((item) => item.module === entry).length;
          const flagged = moduleProblems(entry);
          return (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={module === entry}
              onClick={() => {
                setModule(entry);
                setCurrent(0);
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${module === entry ? "border-brand-500 bg-brand-500 text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}
            >
              {MOCK_MODULE_LABELS[entry]}
              <span className={`rounded-full px-1.5 text-xs ${count !== expected ? "bg-amber-100 text-amber-800" : module === entry ? "bg-white/20" : "bg-slate-100"}`} title={count !== expected ? `An official module has ${expected}` : undefined}>
                {count}
              </span>
              {flagged > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{flagged} to fix</span>}
            </button>
          );
        })}
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap gap-1.5" aria-label="Questions in this module">
          {indexes.map(({ index }, at) => {
            const bad = problems[index]!.length > 0;
            return (
              <button
                key={index}
                type="button"
                aria-current={at === position}
                aria-label={`Question ${at + 1}${bad ? ", needs fixing" : ""}`}
                onClick={() => setCurrent(at)}
                className={`h-9 w-9 cursor-pointer rounded-lg border text-sm font-bold ${
                  at === position ? `border-brand-500 bg-brand-500 text-white ${bad ? "ring-2 ring-red-500 ring-offset-1" : ""}` : bad ? "border-red-500 bg-red-50 text-red-700" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                {at + 1}
              </button>
            );
          })}
        </div>
      </Card>

      {selected && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:sticky lg:top-4 lg:self-start">
            <h2 className="mb-3 font-bold">
              Question {position + 1} as students will see it
            </h2>
            <QuestionPreview section={section} draft={selected.item} />
          </Card>
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-bold">
                {MOCK_MODULE_LABELS[module]} · Question {position + 1}
              </h2>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={position === 0} onClick={() => setCurrent(position - 1)}>
                  ← Previous
                </Button>
                <Button size="sm" variant="outline" disabled={position >= indexes.length - 1} onClick={() => setCurrent(position + 1)}>
                  Next →
                </Button>
              </div>
            </div>
            {problems[selected.index]!.length > 0 && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                <p className="font-bold">Fix before saving:</p>
                <ul className="mt-1 list-disc pl-5">
                  {problems[selected.index]!.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              </div>
            )}
            <QuestionForm section={section} draft={selected.item} onChange={(draft) => update(selected.index, draft)} topics={topics} allowTypeChange requireSkill />
          </Card>
        </div>
      )}

      <div className="sticky bottom-3 z-10 mt-6 rounded-2xl border border-slate-900 bg-white px-4 py-3 shadow-lg">
        {error && (
          <div className="mb-2 whitespace-pre-line">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {totalProblems > 0 ? (
              <span className="font-bold text-red-700">{totalProblems} question(s) need fixing before saving.</span>
            ) : (
              <span className="text-slate-700">Every question passes the checks.{dirty ? " You have unsaved changes." : ""}</span>
            )}
          </p>
          <div className="flex gap-2">
            <Link href={`/admin/tests/${id}`} className="rounded-lg border border-slate-900 px-4 py-2 text-sm font-bold hover:bg-slate-100">
              Back
            </Link>
            <Button disabled={saving || totalProblems > 0} onClick={save}>
              {saving ? "Saving…" : "Save & mark reviewed"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ReviewSectionPage() {
  const { id, section } = useParams<{ id: string; section: string }>();
  const valid = (SECTIONS as readonly string[]).includes(section);
  return (
    <RequireUser permission="papers:write">
      {() => (
        <>
          <Link href={`/admin/tests/${id}`} className="mb-4 inline-block text-sm font-bold text-brand-500 hover:underline">
            ← Back to the test
          </Link>
          {valid ? <Review id={id} section={section as Section} /> : <Notice tone="error">Unknown section.</Notice>}
        </>
      )}
    </RequireUser>
  );
}
