"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Annotation, AttemptNavItem, AttemptQuestion, AttemptSummary, HighlightColor } from "@satsharks/types";
import { addAnnotation, AnnotationMenu, AnnotationRegion, highlightsSupported, NoteEditor, quoteOf, type SelectionInfo } from "@/components/annotations";
import { Choices, Passage, Prompt, ResponseInput } from "@/components/question";
import { CalculatorDock } from "@/components/calculator-dock";
import { DraggablePanel } from "@/components/draggable-panel";
import { ReferenceSheet } from "@/components/reference-sheet";
import { RequireUser } from "@/components/require-user";
import { ReportProblemDialog } from "@/components/report-ui";
import { Button, Modal, Notice, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/format";

type AttemptState = { attempt: AttemptSummary; navigation: AttemptNavItem[] };

// Where a finished attempt goes: a section of a full test returns to the full test (break or total
// score); anything else shows its own results.
const doneUrl = (attempt: Pick<AttemptSummary, "id" | "fullTestId">) => (attempt.fullTestId ? `/full-tests/${attempt.fullTestId}` : `/practice/${attempt.id}/results`);

// Footer buttons: smaller on phones so Back, Next and Check fit beside the question menu.
const footerButton =
  "cursor-pointer rounded-full bg-brand-500 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:py-2.5";

const ICONS = {
  calculator: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="2" />
      <path d="M8 6.5h8M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5h.01M8.5 18h.01M12 18h3.5" />
    </>
  ),
  reference: <path d="M4 7l6 10M10 7L4 17M14 9c0-1.4 1-2.3 2.3-2.3 1.2 0 2.2.8 2.2 2 0 2-4.5 3.3-4.5 5.3h4.7" />,
  annotate: (
    <>
      <path d="M14.5 4.5l5 5L10 19H5v-5z" />
      <path d="M12.5 6.5l5 5M4 21h16" />
    </>
  ),
  exit: <path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9" />,
} as const;

function ToolButton({ label, icon, onClick, active }: { label: string; icon: keyof typeof ICONS; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex min-h-11 min-w-11 cursor-pointer flex-col items-center justify-center rounded px-1.5 py-1 text-xs font-medium hover:bg-slate-100 sm:px-2 ${active ? "bg-slate-100" : ""}`}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[icon]}
      </svg>
      {/* Icons only on phones, where three labelled tools do not fit beside the title and timer. */}
      <span className={`sr-only sm:not-sr-only ${active ? "border-b-2 border-slate-900" : ""}`}>{label}</span>
    </button>
  );
}

// How to type an answer. Written for SAT Sharks; the entry rules follow the Digital SAT.
function SprDirections() {
  return (
    <div className="question-text text-[0.95rem]">
      <p className="font-bold">How to enter your answer</p>
      <ul>
        <li>
          Type <b>one</b> answer, even if more than one would be correct.
        </li>
        <li>
          The box holds <b>5 characters</b>, or <b>6</b> when the answer is negative (the minus sign counts).
        </li>
        <li>
          A <b>fraction</b> too long for the box can be typed as a decimal instead.
        </li>
        <li>
          A <b>decimal</b> too long for the box can be cut off or rounded so that it fills the box.
        </li>
        <li>
          Write a <b>mixed number</b> as an improper fraction or a decimal: one and a half is 3/2 or 1.5.
        </li>
        <li>
          Leave out <b>symbols</b> such as %, commas and $.
        </li>
      </ul>
    </div>
  );
}

function TestScreen({ attemptId, userName }: { attemptId: string; userName: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const attemptQuery = useQuery({
    queryKey: ["practice", "attempt", attemptId],
    queryFn: () => api<AttemptState>(`/api/practice/attempts/${attemptId}`),
    // The server owns the clock and the saved answers: always start from its state.
    staleTime: 0,
    gcTime: 0,
  });

  // The attempt as last reported by the server (replaced when a mock moves to Module 2).
  const [attempt, setAttempt] = useState<AttemptSummary | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [navigation, setNavigation] = useState<AttemptNavItem[]>([]);
  const [question, setQuestion] = useState<AttemptQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [timerHidden, setTimerHidden] = useState(false);
  const [eliminationMode, setEliminationMode] = useState(false);
  const [eliminated, setEliminated] = useState<Record<number, string[]>>({});
  const [panel, setPanel] = useState<"navigator" | "directions" | "finish" | null>(null);
  // The reference sheet is a separate floating window, so it can stay open alongside other panels.
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  // Loaded on first use and then only hidden, so closing it keeps the student's work (Bluebook).
  const [calculatorUsed, setCalculatorUsed] = useState(false);
  const [moduleNotice, setModuleNotice] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  // Highlights & Notes: the toolbar at a selection or highlight, and the open note.
  const [menu, setMenu] = useState<{ rect: DOMRect; selection?: SelectionInfo; id?: string } | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [canHighlight, setCanHighlight] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  // Highlight saves reach the server one at a time, in order, so the last change wins.
  const annotationSaves = useRef<Promise<unknown>>(Promise.resolve());
  const ending = useRef(false);
  // The typed answer last saved for the current question, to avoid saving unchanged text.
  const savedAnswer = useRef("");
  // Questions of this module already loaded (or loaded ahead), by position, as last shown. Moving to
  // one shows it at once; the server is still asked, which records the view, and its reply replaces
  // what is shown unless the student has already changed something.
  const loaded = useRef(new Map<number, AttemptQuestion>());
  const edits = useRef({ touched: false });
  // Opening questions reaches the server one at a time, in the order the student moved: two at once
  // could land in either order and leave the server timing the wrong question.
  const views = useRef<Promise<unknown>>(Promise.resolve());

  // Applies a server snapshot: navigation, clock, and where to resume inside the current module.
  const applyState = useCallback(
    (state: AttemptState, resumeAt?: number) => {
      const loaded = state.attempt;
      if (loaded.status === "done") {
        router.replace(doneUrl(loaded));
        return;
      }
      const start = loaded.mock?.moduleStart ?? 1;
      const count = loaded.mock?.moduleQuestionCount ?? loaded.total;
      setAttempt(loaded);
      setNavigation(state.navigation);
      setSecondsLeft(loaded.timeRemainingSeconds);
      setPosition(Math.min(Math.max(start, resumeAt ?? loaded.lastPosition), start + count - 1));
    },
    [attemptId, router],
  );

  useEffect(() => setCanHighlight(highlightsSupported()), []);
  useEffect(() => {
    setMenu(null);
    setNoteId(null);
  }, [position]);

  // Initialise from the server once.
  useEffect(() => {
    if (attemptQuery.data && attempt === null) applyState(attemptQuery.data);
  }, [attemptQuery.data, attempt, applyState]);

  // Load the question whenever the position changes, then the next one ahead of time.
  const lastPosition = attempt ? (attempt.mock?.moduleStart ?? 1) + (attempt.mock?.moduleQuestionCount ?? attempt.total) - 1 : 0;
  useEffect(() => {
    if (position === null) return;
    let cancelled = false;
    const mine = { touched: false };
    edits.current = mine;
    const show = (next: AttemptQuestion) => {
      setQuestion(next);
      setAnswer(next.answer ?? "");
      savedAnswer.current = next.answer ?? "";
    };
    const known = loaded.current.get(position);
    if (known) show(known);
    setLoadingQuestion(!known);
    setError(null);
    // Asked for even when known: opening a question is what times it on the server. Skipped if the
    // student has already moved on before its turn came.
    const view = views.current.then(() => (cancelled ? null : api<{ question: AttemptQuestion }>(`/api/practice/attempts/${attemptId}/questions/${position}`)));
    views.current = view.catch(() => undefined);
    view
      .then((reply) => {
        if (!reply || mine.touched) return;
        const fresh = reply.question;
        loaded.current.set(position, fresh);
        if (cancelled) return;
        show(fresh);
        const ahead = position + 1;
        if (ahead <= lastPosition && !loaded.current.has(ahead)) {
          api<{ question: AttemptQuestion }>(`/api/practice/attempts/${attemptId}/questions/${ahead}?peek=1`)
            .then(({ question: next }) => !loaded.current.has(ahead) && loaded.current.set(ahead, next))
            .catch(() => undefined);
        }
      })
      .catch((caught: Error) => !cancelled && setError(caught.message))
      .finally(() => !cancelled && setLoadingQuestion(false));
    return () => {
      cancelled = true;
    };
  }, [attemptId, position, lastPosition]);

  // The student changed the question on screen: keep it for coming back, and stop a late reply
  // from the server from replacing it.
  const remember = useCallback((next: AttemptQuestion) => {
    edits.current.touched = true;
    loaded.current.set(next.position, next);
  }, []);

  const isMock = attempt?.kind === "mock";
  const inModuleOne = isMock && attempt?.mock?.currentModule === "m1";

  const finish = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    try {
      const { attempt: ended } = await api<{ attempt: AttemptSummary }>(`/api/practice/attempts/${attemptId}/end`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["practice"] });
      router.replace(doneUrl(ended));
    } catch (caught) {
      ending.current = false;
      setBusy(false);
      setError(caught instanceof Error ? caught.message : "Could not submit");
    }
  }, [attemptId, queryClient, router]);

  // Mock: closes Module 1. The server grades it and builds Module 2 from the score.
  const submitModule = useCallback(async () => {
    if (ending.current) return;
    ending.current = true;
    setBusy(true);
    setPanel(null);
    setQuestion(null);
    try {
      const state = await api<AttemptState>(`/api/practice/attempts/${attemptId}/submit-module`, { method: "POST" });
      setEliminated({});
      loaded.current.clear();
      applyState(state, state.attempt.mock?.moduleStart);
      setModuleNotice("Module 1 is submitted. Module 2 has started.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit Module 1");
    } finally {
      ending.current = false;
      setBusy(false);
    }
  }, [attemptId, applyState]);

  // Countdown. The server enforces the limit; this only displays it and moves on when it runs out.
  const timed = secondsLeft !== null;
  useEffect(() => {
    if (!timed) return;
    const interval = setInterval(() => setSecondsLeft((value) => (value === null ? null : Math.max(0, value - 1))), 1000);
    return () => clearInterval(interval);
  }, [timed]);
  useEffect(() => {
    if (secondsLeft !== 0) return;
    void (inModuleOne ? submitModule() : finish());
  }, [secondsLeft, inModuleOne, submitModule, finish]);

  useEffect(() => {
    if (!moduleNotice) return;
    const timer = setTimeout(() => setModuleNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [moduleNotice]);

  const save = useCallback(
    async (body: { answer?: string | null; flagged?: boolean }, at: number) => {
      try {
        const { item } = await api<{ item: AttemptNavItem }>(`/api/practice/attempts/${attemptId}/questions/${at}`, { method: "PATCH", body });
        setNavigation((items) => items.map((entry) => (entry.position === item.position ? item : entry)));
        setError(null);
        return true;
      } catch (caught) {
        setError(`Your answer was not saved: ${caught instanceof Error ? caught.message : "connection problem"}. Check your connection and select it again.`);
        return false;
      }
    },
    [attemptId],
  );

  // Typed answers are saved when leaving the field or the question.
  const commitTyped = useCallback(async () => {
    if (!question || question.questionType === "mcq" || question.checked || answer === savedAnswer.current) return true;
    const ok = await save({ answer: answer === "" ? null : answer }, question.position);
    if (ok) {
      savedAnswer.current = answer;
      remember({ ...question, answer: answer === "" ? null : answer });
    }
    return ok;
  }, [question, answer, save, remember]);

  const moduleStart = attempt?.mock?.moduleStart ?? 1;
  const moduleCount = attempt?.mock?.moduleQuestionCount ?? attempt?.total ?? 0;
  const moduleEnd = moduleStart + moduleCount - 1;

  const goTo = useCallback(
    async (next: number) => {
      if (next < moduleStart || next > moduleEnd || next === position) return;
      await commitTyped();
      setPanel(null);
      setPosition(next);
    },
    [moduleStart, moduleEnd, position, commitTyped],
  );

  if (attemptQuery.error) return <div className="p-8"><Notice tone="error">{attemptQuery.error.message}</Notice></div>;
  if (!attempt || position === null) {
    return <div className="p-8"><Spinner label={busy ? "Preparing Module 2" : "Loading"} /></div>;
  }

  const math = attempt.section === "math";
  const sectionName = math ? "Math" : "Reading and Writing";
  const moduleNumber = attempt.mock?.currentModule === "m2" ? 2 : 1;
  const title = isMock ? `${sectionName}: Module ${moduleNumber}` : `Section: ${sectionName}`;
  const label = (at: number) => at - moduleStart + 1;
  const current = navigation.find((entry) => entry.position === position);
  const locked = question?.checked ?? false;
  const isSpr = question?.questionType === "spr";
  const split = question ? !math || isSpr : false;
  const crossed = new Set(eliminated[position] ?? []);
  const unanswered = navigation.filter((entry) => !entry.answered).length;
  const endLabel = isMock ? (inModuleOne ? "Submit Module 1" : "Finish Mock") : "Finish Drill";

  async function selectChoice(key: string) {
    if (!question || locked) return;
    const previous = answer;
    setAnswer(key);
    remember({ ...question, answer: key });
    if (!(await save({ answer: key }, question.position))) {
      setAnswer(previous);
      remember({ ...question, answer: previous || null });
    }
  }

  // Typed text is kept for coming back only once saved (commitTyped), so unsaved text is never
  // taken for saved.
  function typeAnswer(value: string) {
    edits.current.touched = true;
    setAnswer(value);
  }

  // Highlights & Notes: shows the change at once, keeps it for coming back, saves it in order.
  function saveAnnotations(next: Annotation[]) {
    if (!question) return;
    const updated = { ...question, annotations: next };
    setQuestion(updated);
    remember(updated);
    const at = question.position;
    const write = annotationSaves.current.then(() =>
      api(`/api/practice/attempts/${attemptId}/questions/${at}/annotations`, { method: "PUT", body: { annotations: next } }).catch((caught: Error) =>
        setError(`Your highlight was not saved: ${caught.message}`),
      ),
    );
    annotationSaves.current = write;
  }

  const annotations = question?.annotations ?? [];
  const menuAnnotation = menu?.id ? (annotations.find((annotation) => annotation.id === menu.id) ?? null) : null;
  const noteAnnotation = noteId ? (annotations.find((annotation) => annotation.id === noteId) ?? null) : null;

  // A colour or underline on a fresh selection makes a highlight; on a highlight it changes it.
  function styleHighlight(change: { color?: HighlightColor; underline?: boolean }, thenNote = false) {
    if (menu?.selection) {
      const { list, id } = addAnnotation(annotations, menu.selection, change.color ?? "yellow", change.underline ?? false);
      if (!id) {
        setError("This question has as many highlights as it can hold. Delete one to add another.");
        return;
      }
      saveAnnotations(list);
      window.getSelection()?.removeAllRanges();
      setMenu(thenNote ? null : { rect: menu.rect, id });
      if (thenNote) setNoteId(id);
      return;
    }
    if (!menuAnnotation) return;
    saveAnnotations(annotations.map((annotation) => (annotation.id === menuAnnotation.id ? { ...annotation, ...change } : annotation)));
    if (thenNote) {
      setMenu(null);
      setNoteId(menuAnnotation.id);
    }
  }

  // The header button: highlights the current selection, or explains how.
  function highlightButton() {
    if (!canHighlight) {
      setModuleNotice("This browser cannot show highlights. Update it (or use Chrome, Edge, Safari or Firefox) to use Highlights & Notes.");
      return;
    }
    if (menu?.selection) styleHighlight({ color: "yellow" });
    else setModuleNotice("Select words in the passage or the question, then pick a colour, underline them or add a note.");
  }

  const region = (target: "passage" | "prompt", children: ReactNode) => (
    <AnnotationRegion
      target={target}
      annotations={annotations.filter((annotation) => annotation.target === target)}
      activeId={menu?.id ?? noteId}
      enabled={canHighlight}
      onSelect={(selection) => selection && setMenu({ rect: selection.rect, selection })}
      onOpen={(id, rect) => setMenu({ rect, id })}
    >
      {children}
    </AnnotationRegion>
  );

  async function toggleFlag() {
    if (!current) return;
    const flagged = !current.flagged;
    setNavigation((items) => items.map((entry) => (entry.position === position ? { ...entry, flagged } : entry)));
    if (!(await save({ flagged }, position!))) {
      setNavigation((items) => items.map((entry) => (entry.position === position ? { ...entry, flagged: !flagged } : entry)));
    }
  }

  async function check() {
    if (!question) return;
    setBusy(true);
    try {
      if (!(await commitTyped())) return;
      const { question: checked } = await api<{ question: AttemptQuestion }>(`/api/practice/attempts/${attemptId}/questions/${question.position}/check`, { method: "POST" });
      setQuestion(checked);
      remember(checked);
      setNavigation((items) => items.map((entry) => (entry.position === checked.position ? { ...entry, checked: true, answered: true } : entry)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check the answer");
    } finally {
      setBusy(false);
    }
  }

  const questionPane = question && (
    <div>
      <div className="flex items-center gap-3 bg-slate-100">
        <span className="flex h-9 min-w-9 items-center justify-center bg-slate-900 px-1 text-base font-bold text-white">{label(question.position)}</span>
        <button type="button" onClick={toggleFlag} aria-pressed={current?.flagged ?? false} className="flex cursor-pointer items-center gap-1.5 text-sm font-medium">
          <span aria-hidden className={current?.flagged ? "text-red-600" : "text-slate-700"}>
            {current?.flagged ? "⚑" : "⚐"}
          </span>
          <span className={current?.flagged ? "font-bold" : ""}>Mark for Review</span>
        </button>
        <button
          type="button"
          onClick={() => setReporting(true)}
          title="Report a problem with this question"
          className={`flex min-h-9 cursor-pointer items-center gap-1 px-1 text-sm font-medium text-slate-700 hover:text-black ${isSpr ? "ml-auto mr-2" : ""}`}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span className="hidden sm:inline">Report</span>
          <span className="sr-only sm:hidden">Report a problem</span>
        </button>
        {!isSpr && (
          <button
            type="button"
            onClick={() => setEliminationMode((value) => !value)}
            aria-pressed={eliminationMode}
            title="Cross out answer choices"
            className={`ml-auto mr-2 cursor-pointer rounded border px-1.5 text-xs font-bold line-through ${eliminationMode ? "border-brand-500 bg-brand-500 text-white" : "border-slate-900 bg-white"}`}
          >
            ABC
          </button>
        )}
      </div>
      <div className="test-rule mb-4" />
      {region("prompt", <Prompt question={question} />)}
      {isSpr ? (
        <ResponseInput
          value={answer}
          onChange={typeAnswer}
          onCommit={() => void commitTyped()}
          disabled={locked}
          correctAnswer={question.result?.correctAnswer}
          correct={question.result?.correct}
        />
      ) : (
        <Choices
          question={question}
          selected={answer || null}
          onSelect={locked ? undefined : selectChoice}
          eliminationMode={eliminationMode && !locked}
          eliminated={crossed}
          onToggleEliminate={(key) =>
            setEliminated((all) => {
              const list = all[position!] ?? [];
              return { ...all, [position!]: list.includes(key) ? list.filter((item) => item !== key) : [...list, key] };
            })
          }
          correctAnswer={question.result?.correctAnswer}
          disabled={locked}
        />
      )}
      {question.result && (
        <div className={`mt-4 rounded-lg border px-4 py-3 text-sm font-bold ${question.result.correct ? "border-green-600 bg-green-50 text-green-800" : "border-red-600 bg-red-50 text-red-800"}`}>
          {question.result.correct ? "Correct." : "Incorrect."}
          {question.result.explanation && <p className="mt-1 font-normal text-slate-800">{question.result.explanation}</p>}
        </div>
      )}
    </div>
  );

  return (
    <div ref={screenRef} className="flex h-screen flex-col bg-white">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 sm:px-8">
        <div className="min-w-0">
          <h1 className="text-sm font-bold leading-tight sm:text-lg">{title}</h1>
          <button type="button" onClick={() => setPanel(panel === "directions" ? null : "directions")} className="cursor-pointer text-sm font-medium">
            Directions ▾
          </button>
        </div>
        <div className="text-center">
          {timed ? (
            <>
              <div className={`text-lg font-bold tabular-nums sm:text-xl ${secondsLeft! <= 300 ? "text-red-600" : ""}`} aria-live="off">
                {timerHidden ? "⏱" : formatClock(secondsLeft!)}
              </div>
              <button type="button" onClick={() => setTimerHidden((value) => !value)} className="cursor-pointer rounded-full border border-slate-900 px-3 text-xs font-bold">
                {timerHidden ? "Show" : "Hide"}
              </button>
              {attempt.timeMultiplier !== 1 && <div className="mt-0.5 text-[11px] font-bold text-brand-600">{attempt.timeMultiplier}× time</div>}
            </>
          ) : (
            <span className="text-sm font-medium text-slate-500">Untimed</span>
          )}
        </div>
        <div className="flex items-center justify-end gap-0.5 sm:gap-1">
          <ToolButton label="Highlights & Notes" icon="annotate" onClick={highlightButton} active={!!menu || !!noteId} />
          {math && <ToolButton label="Calculator" icon="calculator" onClick={() => (setCalculatorUsed(true), setCalculatorOpen((open) => !open))} active={calculatorOpen} />}
          {math && <ToolButton label="Reference" icon="reference" onClick={() => setReferenceOpen((open) => !open)} active={referenceOpen} />}
          <ToolButton
            label="Exit"
            icon="exit"
            onClick={async () => {
              await commitTyped();
              router.push("/dashboard");
            }}
          />
        </div>
      </header>
      <div className="test-rule" />

      {/* With the calculator open the question moves over beside it (Bluebook), never under it. */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {calculatorUsed && <CalculatorDock open={calculatorOpen} onClose={() => setCalculatorOpen(false)} />}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto lg:h-full lg:overflow-hidden" onScrollCapture={() => menu && setMenu(null)}>
        {(error || moduleNotice) && (
          <div className="mx-auto max-w-3xl space-y-2 px-4 pt-3">
            {moduleNotice && <Notice tone="info">{moduleNotice}</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
          </div>
        )}
        {loadingQuestion || !question ? (
          <div className="mx-auto max-w-3xl px-4">{!error && <Spinner label="Loading question" />}</div>
        ) : split ? (
          <div className="grid grid-cols-1 lg:h-full lg:grid-cols-2">
            <div className="border-b-4 border-slate-300 px-4 py-5 sm:px-10 sm:py-6 lg:overflow-y-auto lg:border-b-0 lg:border-r-4">{math ? <SprDirections /> : region("passage", <Passage question={question} />)}</div>
            <div className="px-4 py-5 sm:px-10 sm:py-6 lg:overflow-y-auto">{questionPane}</div>
          </div>
        ) : (
          <div className="px-4 py-5 sm:px-5 sm:py-6 lg:h-full lg:overflow-y-auto">
            <div className="mx-auto max-w-3xl">{questionPane}</div>
          </div>
        )}
        </div>
      </main>

      <div className="test-rule" />
      <footer className="relative flex items-center gap-2 px-3 py-2.5 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:px-8 sm:py-3">
        <span className="hidden truncate text-lg font-semibold sm:block">{userName}</span>
        <button
          type="button"
          onClick={() => setPanel(panel === "navigator" ? null : "navigator")}
          aria-expanded={panel === "navigator"}
          className="min-h-10 flex-none cursor-pointer whitespace-nowrap rounded-md bg-slate-900 px-3 py-2 text-sm font-bold text-white sm:px-4"
        >
          <span className="hidden sm:inline">Question </span>
          {label(position)} of {moduleCount} {panel === "navigator" ? "▾" : "▴"}
        </button>
        <div className="ml-auto flex justify-end gap-1.5 sm:gap-2">
          {!isMock && (
            <button type="button" className={footerButton} disabled={busy || locked || answer === "" || !question} onClick={check}>
              Check
            </button>
          )}
          <button type="button" className={footerButton} disabled={position <= moduleStart} onClick={() => goTo(position - 1)}>
            Back
          </button>
          {position < moduleEnd ? (
            <button type="button" className={footerButton} onClick={() => goTo(position + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className={footerButton} disabled={busy} onClick={async () => (await commitTyped(), setPanel("finish"))}>
              {isMock ? (inModuleOne ? "Submit" : "Finish") : "Finish"}
            </button>
          )}
        </div>

        {panel === "navigator" && (
          <div className="absolute bottom-full left-1/2 z-40 mb-3 w-[min(94vw,500px)] -translate-x-1/2 rounded-xl border border-slate-900 bg-white p-4 shadow-xl sm:p-5">
            <div className="flex items-center justify-between">
              <h2 className="mx-auto text-base font-bold">{title} Questions</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="Close" className="cursor-pointer text-lg">
                ✕
              </button>
            </div>
            <div className="my-3 flex justify-center gap-4 border-b border-slate-300 pb-3 text-xs">
              <span>📍 Current</span>
              <span>
                <span className="mr-1 inline-block h-3 w-3 border border-dashed border-slate-900 align-middle" />
                Unanswered
              </span>
              <span>
                <span className="text-red-600">⚑</span> For Review
              </span>
            </div>
            <div className="grid max-h-[45vh] grid-cols-6 gap-2 overflow-y-auto pt-2 sm:max-h-56 sm:grid-cols-10">
              {navigation.map((entry) => (
                <button
                  key={entry.position}
                  type="button"
                  onClick={() => goTo(entry.position)}
                  aria-label={`Question ${label(entry.position)}${entry.answered ? ", answered" : ", unanswered"}${entry.flagged ? ", marked for review" : ""}`}
                  className={`relative flex h-10 cursor-pointer items-center justify-center text-sm font-bold sm:h-8 ${
                    entry.answered ? "bg-brand-500 text-white" : "border border-dashed border-slate-900 text-brand-500"
                  } ${entry.position === position ? "outline outline-2 outline-offset-2 outline-slate-900" : ""}`}
                >
                  {label(entry.position)}
                  {entry.flagged && <span className="absolute -right-1 -top-2 text-xs text-red-600">⚑</span>}
                </button>
              ))}
            </div>
            <div className="mt-4 text-center">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPanel("finish")}>
                {endLabel}
              </Button>
            </div>
          </div>
        )}
      </footer>

      {/* Floating and draggable, so the question stays visible and usable while it is open. */}
      {referenceOpen && (
        <DraggablePanel title="Reference" onClose={() => setReferenceOpen(false)}>
          <ReferenceSheet />
        </DraggablePanel>
      )}
      {menu && question && (
        <AnnotationMenu
          rect={menu.rect}
          current={menuAnnotation}
          onColor={(color) => styleHighlight({ color })}
          onUnderline={() => styleHighlight({ underline: !(menuAnnotation?.underline ?? false) })}
          onNote={() => styleHighlight({}, true)}
          onDelete={() => {
            if (menuAnnotation) saveAnnotations(annotations.filter((annotation) => annotation.id !== menuAnnotation.id));
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {noteAnnotation && (
        <NoteEditor
          key={noteAnnotation.id}
          annotation={noteAnnotation}
          quote={quoteOf(screenRef.current, noteAnnotation)}
          onSave={(note) => {
            saveAnnotations(annotations.map((annotation) => (annotation.id === noteAnnotation.id ? { ...annotation, note } : annotation)));
            setNoteId(null);
          }}
          onDeleteNote={() => {
            saveAnnotations(annotations.map((annotation) => (annotation.id === noteAnnotation.id ? { ...annotation, note: "" } : annotation)));
            setNoteId(null);
          }}
          onClose={() => setNoteId(null)}
        />
      )}
      {reporting && question && (
        <ReportProblemDialog attemptId={attemptId} position={question.position} questionLabel={`question ${label(question.position)}`} onClose={() => setReporting(false)} />
      )}
      {panel === "directions" && (
        <Modal title="Directions" onClose={() => setPanel(null)}>
          <div className="question-text text-[0.95rem]">
            {math ? (
              <>
                <p>This section tests a range of math skills. You may use the calculator on every question.</p>
                <p>Unless a question says otherwise, every variable and expression stands for a real number, figures are drawn to scale and lie in a plane, and a function is defined for every real number it can take.</p>
                <p>Multiple-choice questions have exactly one correct answer. For the others, type your answer in the box.</p>
              </>
            ) : (
              <>
                <p>This section tests reading and writing skills. Each question comes with one or two short passages, which may include a table or graph.</p>
                <p>Read the passage and the question, then pick the best of the four choices. Each question has a single best answer.</p>
              </>
            )}
            {isMock && (
              <p>
                This is an adaptive mock. Module 2 is harder or easier depending on how you do in Module 1. Once a module is submitted, you cannot go back to it.
              </p>
            )}
          </div>
        </Modal>
      )}
      {panel === "finish" && (
        <Modal title={isMock ? (inModuleOne ? "Submit Module 1?" : "Finish this mock?") : "Finish this drill?"} onClose={() => !busy && setPanel(null)}>
          <p className="text-sm">
            {unanswered > 0 ? (
              <>
                You have <b>{unanswered}</b> unanswered question{unanswered === 1 ? "" : "s"} in this {isMock ? "module" : "drill"}.{" "}
              </>
            ) : (
              <>You have answered every question in this {isMock ? "module" : "drill"}. </>
            )}
            {inModuleOne ? "Once you submit Module 1 you cannot return to it. Module 2 starts straight away." : "After you finish, answers cannot be changed."}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPanel(null)}>
              Keep working
            </Button>
            <Button disabled={busy} onClick={inModuleOne ? submitModule : finish}>
              {busy ? "Submitting…" : inModuleOne ? "Submit Module 1" : "Finish and see results"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function TestPage() {
  const { id } = useParams<{ id: string }>();
  return <RequireUser studentOnly>{(user) => <TestScreen attemptId={id} userName={user.name} />}</RequireUser>;
}
