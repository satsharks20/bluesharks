"use client";

import {
  DIFFICULTIES,
  splitAcceptedValues,
  type CatalogTopic,
  type CorrectAnswerView,
  type Difficulty,
  type QuestionAssetView,
  type QuestionType,
  type Section,
} from "@satsharks/types";
import katex from "katex";
import type { ReactNode } from "react";
import { RichText } from "@/lib/rich-text";
import { MathTextField } from "./math-input";
import { Choices, Passage, Prompt, type QuestionContent } from "./question";

// The editable parts of a question, shared by the question-bank editor and the review screen of
// uploaded tests, so both edit questions the same way and show the same preview.
export interface QuestionDraft {
  questionType: QuestionType;
  difficulty: Difficulty | "";
  topic: string;
  skill: string;
  passage: string;
  prompt: string;
  // `viz`: a figure in the choice (drawn from the bank, or an image set in the editor).
  choices: { key: string; text: string; viz?: unknown }[];
  choiceKey: string;
  // As typed, e.g. "0.5 or 1/2".
  acceptedValues: string;
  explanation: string;
}

export const CHOICE_KEYS = ["A", "B", "C", "D"] as const;

export const emptyChoices = () => CHOICE_KEYS.map((key) => ({ key, text: "" }));

export function draftAnswer(draft: QuestionDraft): CorrectAnswerView | null {
  if (draft.questionType === "mcq") return draft.choiceKey ? { choiceKey: draft.choiceKey, acceptedValues: [] } : null;
  const accepted = splitAcceptedValues(draft.acceptedValues);
  return accepted.length > 0 ? { choiceKey: null, acceptedValues: accepted } : null;
}

// KaTeX's message for a formula it cannot draw, or null. Same check as the server's.
export function checkLatex(latex: string): string | null {
  try {
    katex.renderToString(latex, { throwOnError: true, strict: "ignore" });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.replace(/^KaTeX parse error:\s*/, "") : "invalid formula";
  }
}

const inputClass = "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500";
const label = "block text-xs font-bold uppercase tracking-wide text-slate-600";

export function QuestionForm({
  section,
  draft,
  onChange,
  topics,
  allowTypeChange,
  requireSkill = false,
  choiceExtra,
}: {
  section: Section;
  draft: QuestionDraft;
  onChange: (draft: QuestionDraft) => void;
  topics: CatalogTopic[];
  // Switching between multiple choice and grid-in (Math only).
  allowTypeChange: boolean;
  // Uploaded tests require an analytics skill before review can be completed.
  requireSkill?: boolean;
  // Shown under each answer option (the question bank editor's choice image).
  choiceExtra?: (index: number) => ReactNode;
}) {
  const math = section === "math";
  const set = (patch: Partial<QuestionDraft>) => onChange({ ...draft, ...patch });
  const skills = topics.find((entry) => entry.topic === draft.topic)?.skills ?? [];
  const topicKnown = draft.topic === "" || topics.some((entry) => entry.topic === draft.topic);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <label className={label}>
          Difficulty
          <select className={`${inputClass} mt-1 font-normal normal-case capitalize`} value={draft.difficulty} onChange={(event) => set({ difficulty: event.target.value as Difficulty | "" })}>
            <option value="">Not set</option>
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Domain
          <select className={`${inputClass} mt-1 font-normal normal-case`} value={draft.topic} onChange={(event) => set({ topic: event.target.value, skill: "" })}>
            <option value="">Not set</option>
            {!topicKnown && <option value={draft.topic}>{draft.topic} (not in the bank)</option>}
            {topics.map((entry) => (
              <option key={entry.topic} value={entry.topic}>
                {entry.topic}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          Skill{requireSkill ? " *" : ""}
          <select
            className={`${inputClass} mt-1 font-normal normal-case ${requireSkill && !draft.skill ? "border-red-500" : ""}`}
            value={draft.skill}
            required={requireSkill}
            aria-invalid={requireSkill && !draft.skill}
            onChange={(event) => set({ skill: event.target.value })}
          >
            <option value="" disabled={requireSkill}>
              {requireSkill ? "Select a skill" : "Not set"}
            </option>
            {draft.skill && !skills.includes(draft.skill) && <option value={draft.skill}>{draft.skill}</option>}
            {skills.map((skill) => (
              <option key={skill} value={skill}>
                {skill}
              </option>
            ))}
          </select>
          {requireSkill && !draft.skill && <span className="mt-1 block text-xs font-normal text-red-700">Choose the exact skill used for analytics and drills.</span>}
        </label>
      </div>

      {!math && (
        <div>
          <span className={label}>Passage</span>
          <div className="mt-1">
            <MathTextField math={false} rows={7} value={draft.passage} onChange={(passage) => set({ passage })} aria-label="Passage" />
          </div>
          <p className="mt-1 text-xs text-slate-500">**bold**, *italic*, __underline__, ____ for a blank, &quot;- &quot; at the start of a line for a bullet.</p>
        </div>
      )}

      <div>
        <span className={label}>Question text *</span>
        <div className="mt-1">
          <MathTextField math={math} rows={math ? 5 : 2} value={draft.prompt} onChange={(prompt) => set({ prompt })} aria-label="Question text" invalid={draft.prompt.trim() === ""} />
        </div>
        {math && <p className="mt-1 text-xs text-slate-500">Formulas go between $ signs, e.g. $x^2 + 3x$. Write a dollar amount as $\$78$. A new line starts a new paragraph.</p>}
      </div>

      {allowTypeChange && math && (
        <label className={label}>
          Question type
          <select
            className={`${inputClass} mt-1 block font-normal normal-case sm:w-72`}
            value={draft.questionType}
            onChange={(event) => {
              const questionType = event.target.value as QuestionType;
              set(questionType === "mcq" ? { questionType, choices: draft.choices.length ? draft.choices : emptyChoices() } : { questionType, choiceKey: "" });
            }}
          >
            <option value="mcq">Multiple choice (A–D)</option>
            <option value="spr">Student-produced response (grid-in)</option>
          </select>
        </label>
      )}

      {draft.questionType === "mcq" ? (
        <fieldset>
          <legend className={label}>Answer options * — choose the correct one</legend>
          <div className="mt-2 space-y-3">
            {draft.choices.map((choice, index) => {
              const correct = draft.choiceKey === choice.key;
              return (
                <div key={choice.key} className="flex items-start gap-2">
                  <span className={`mt-1.5 flex h-7 w-7 flex-none items-center justify-center rounded-full border text-sm font-bold ${correct ? "border-green-600 bg-green-600 text-white" : "border-slate-900"}`}>{choice.key}</span>
                  <div className="min-w-0 flex-1">
                    <MathTextField
                      math={math}
                      multiline={false}
                      value={choice.text}
                      aria-label={`Choice ${choice.key}`}
                      invalid={choice.text.trim() === "" && choice.viz == null}
                      onChange={(text) => set({ choices: draft.choices.map((entry, position) => (position === index ? { ...entry, text } : entry)) })}
                    />
                    {choiceExtra?.(index)}
                  </div>
                  <button
                    type="button"
                    aria-pressed={correct}
                    onClick={() => set({ choiceKey: choice.key })}
                    className={`mt-1 h-8 w-[4.5rem] flex-none cursor-pointer rounded-lg px-3 text-xs font-bold ${correct ? "bg-green-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                  >
                    {correct ? "Correct" : "Set"}
                  </button>
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <label className={label}>
          Accepted answers *
          <input className={`${inputClass} mt-1 font-normal normal-case`} value={draft.acceptedValues} onChange={(event) => set({ acceptedValues: event.target.value })} placeholder="e.g. 0.5 or 1/2" />
          <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
            Every form a student may type, separated by &quot;or&quot;. Students can type digits, &quot;.&quot;, &quot;/&quot; and &quot;-&quot; only (5 characters, 6 if negative).
          </span>
        </label>
      )}

      <div>
        <span className={label}>Explanation</span>
        <div className="mt-1">
          <MathTextField math={math} rows={3} value={draft.explanation} onChange={(explanation) => set({ explanation })} aria-label="Explanation" placeholder="Shown to students after they answer" />
        </div>
      </div>
    </div>
  );
}

// The question as a student will see it, updated while it is edited.
export function QuestionPreview({ section, draft, assets = [], viz = null }: { section: Section; draft: QuestionDraft; assets?: QuestionAssetView[]; viz?: unknown }) {
  const content: QuestionContent = {
    section,
    questionType: draft.questionType,
    prompt: draft.prompt,
    passage: draft.passage.trim() ? draft.passage : null,
    choices: draft.questionType === "mcq" ? draft.choices.map((choice) => ({ ...choice, viz: choice.viz ?? null })) : [],
    assets,
    viz,
  };
  const answer = draftAnswer(draft);
  return (
    <div>
      {section !== "math" && <Passage question={content} />}
      <div className={section !== "math" ? "mt-4 border-t border-slate-300 pt-4" : ""}>
        <Prompt question={content} />
      </div>
      {draft.questionType === "mcq" ? (
        <Choices question={content} selected={null} correctAnswer={answer} disabled />
      ) : (
        <p className="mt-4 text-sm">
          <b>Accepted answers:</b> {answer ? answer.acceptedValues.join(" or ") : "none set"}
        </p>
      )}
      {draft.explanation.trim() && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Explanation</div>
          <RichText text={draft.explanation} math={section === "math"} />
        </div>
      )}
    </div>
  );
}
