"use client";

// Highlights & Notes on the test screen, as in Bluebook: select text in the passage or the question,
// pick a colour, underline it or add a note. Saved per question with the attempt, so it is still
// there after moving between questions, leaving the test or reloading.
//
// Highlights are painted with the CSS Custom Highlight API (::highlight), so the question's markup
// (math, tables, figures) is never changed. A highlight is stored as character offsets into the
// text of its region (passage or question) as rendered, which is the same on every load.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { HIGHLIGHT_COLORS, MAX_ANNOTATIONS_PER_QUESTION, MAX_NOTE_LENGTH, type Annotation, type AnnotationTarget, type HighlightColor } from "@satsharks/types";

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): { highlights: HighlightRegistry; Highlight: HighlightCtor } | null {
  if (typeof window === "undefined") return null;
  const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Highlight = (window as unknown as { Highlight?: HighlightCtor }).Highlight;
  return highlights && Highlight ? { highlights, Highlight } : null;
}

export const highlightsSupported = () => registry() !== null;

// Names used in globals.css (::highlight(...)).
const PAINTS = [...HIGHLIGHT_COLORS.map((color) => `sat-${color}`), "sat-underline", "sat-note", "sat-active"] as const;

// Every region on screen adds its ranges here; the registry is rebuilt from all of them.
const regions = new Map<string, Map<string, Range[]>>();

function repaint() {
  const found = registry();
  if (!found) return;
  for (const name of PAINTS) {
    const ranges = [...regions.values()].flatMap((paints) => paints.get(name) ?? []);
    if (ranges.length === 0) found.highlights.delete(name);
    else found.highlights.set(name, new found.Highlight(...ranges));
  }
}

// Characters before (node, offset) inside root.
function offsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

// The DOM range for characters [start, end) of root's text, or null if the text is shorter.
function rangeOf(root: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let position = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node as Text).data.length;
    if (!started && start < position + length) {
      range.setStart(node, start - position);
      started = true;
    }
    if (started && end <= position + length) {
      range.setEnd(node, end - position);
      return range;
    }
    position += length;
  }
  return null;
}

// The character under a screen point (for clicking on a highlight).
function offsetAtPoint(root: Node, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position && root.contains(position.offsetNode)) return offsetOf(root, position.offsetNode, position.offset);
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range && root.contains(range.startContainer)) return offsetOf(root, range.startContainer, range.startOffset);
  return null;
}

export interface SelectionInfo {
  target: AnnotationTarget;
  start: number;
  end: number;
  rect: DOMRect;
}

// One markable region (the passage or the question). Paints its highlights and reports a new
// selection or a click on an existing highlight.
export function AnnotationRegion({
  target,
  annotations,
  activeId,
  enabled,
  onSelect,
  onOpen,
  children,
}: {
  target: AnnotationTarget;
  annotations: Annotation[];
  activeId: string | null;
  enabled: boolean;
  onSelect: (selection: SelectionInfo | null) => void;
  onOpen: (id: string, rect: DOMRect) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const regionId = useRef(`${target}-${Math.random().toString(36).slice(2)}`).current;

  // Re-measured after every render: the text nodes may have been replaced.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !enabled) {
      regions.delete(regionId);
      repaint();
      return;
    }
    const paints = new Map<string, Range[]>();
    const add = (name: string, range: Range) => paints.set(name, [...(paints.get(name) ?? []), range]);
    for (const annotation of annotations) {
      const range = rangeOf(root, annotation.start, annotation.end);
      if (!range) continue;
      add(`sat-${annotation.color}`, range);
      if (annotation.underline) add("sat-underline", range);
      else if (annotation.note) add("sat-note", range);
      if (annotation.id === activeId) add("sat-active", range);
    }
    regions.set(regionId, paints);
    repaint();
  });
  useEffect(
    () => () => {
      regions.delete(regionId);
      repaint();
    },
    [regionId],
  );

  // A finished selection inside this region opens the menu; a plain click on a highlight opens it.
  const check = useCallback(
    (event?: { clientX: number; clientY: number }) => {
      const root = ref.current;
      const selection = window.getSelection();
      if (!root || !enabled || !selection) return;
      if (selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;
        let start = offsetOf(root, range.startContainer, range.startOffset);
        let end = offsetOf(root, range.endContainer, range.endOffset);
        // Leading and trailing spaces are not part of what the student meant to mark.
        const text = range.toString();
        start += text.length - text.trimStart().length;
        end -= text.length - text.trimEnd().length;
        if (end > start) onSelect({ target, start, end, rect: range.getBoundingClientRect() });
        return;
      }
      if (!event) return;
      const at = offsetAtPoint(root, event.clientX, event.clientY);
      const hit = at === null ? undefined : annotations.find((annotation) => at >= annotation.start && at < annotation.end);
      if (hit) {
        const range = rangeOf(root, hit.start, hit.end);
        onOpen(hit.id, range?.getBoundingClientRect() ?? new DOMRect(event.clientX, event.clientY, 0, 0));
      }
    },
    [annotations, enabled, onOpen, onSelect, target],
  );

  // Phones select by pressing and dragging handles: wait until the selection stops changing.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => check(), 400);
    };
    document.addEventListener("selectionchange", changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
    };
  }, [check, enabled]);

  return (
    <div ref={ref} data-annotation-target={target} onMouseUp={(event) => check(event)}>
      {children}
    </div>
  );
}

const SWATCH: Record<HighlightColor, string> = { yellow: "#fde68a", blue: "#bfdbfe", pink: "#fbcfe8" };
const COLOR_NAMES: Record<HighlightColor, string> = { yellow: "Yellow", blue: "Blue", pink: "Pink" };

// The small toolbar shown at a selection or a highlight: colours, underline, note, delete.
export function AnnotationMenu({
  rect,
  current,
  onColor,
  onUnderline,
  onNote,
  onDelete,
  onClose,
}: {
  rect: DOMRect;
  current: Annotation | null;
  onColor: (color: HighlightColor) => void;
  onUnderline: () => void;
  onNote: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const width = current ? 248 : 212;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  // Below the words when above them would cover the test screen's header.
  const above = rect.top > 140;
  const top = above ? rect.top - 52 : rect.bottom + 10;
  const button = "flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100";

  return (
    <div
      role="toolbar"
      aria-label="Highlights and notes"
      // Keep the selection: a press on the toolbar must not clear it before the click lands.
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-slate-900 bg-white p-1 shadow-lg"
      style={{ left, top, width }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button key={color} type="button" title={`${COLOR_NAMES[color]} highlight`} aria-label={`${COLOR_NAMES[color]} highlight`} aria-pressed={current?.color === color} onClick={() => onColor(color)} className={button}>
          <span className={`block h-5 w-5 rounded-full border ${current?.color === color ? "border-2 border-slate-900" : "border-slate-400"}`} style={{ background: SWATCH[color] }} />
        </button>
      ))}
      <span className="mx-0.5 h-6 w-px bg-slate-300" />
      <button type="button" title="Underline" aria-label="Underline" aria-pressed={current?.underline ?? false} onClick={onUnderline} className={`${button} ${current?.underline ? "bg-slate-200" : ""}`}>
        <span className="text-base font-bold underline">U</span>
      </button>
      <button type="button" title={current?.note ? "Edit note" : "Add a note"} aria-label={current?.note ? "Edit note" : "Add a note"} onClick={onNote} className={button}>
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M8 9h8M8 12h5" />
        </svg>
      </button>
      {current && (
        <button type="button" title="Delete highlight" aria-label="Delete highlight" onClick={onDelete} className={button}>
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10 11v5M14 11v5" />
          </svg>
        </button>
      )}
    </div>
  );
}

// The note of one highlight: the marked words and a text box (Bluebook's note panel).
export function NoteEditor({ annotation, quote, onSave, onDeleteNote, onClose }: { annotation: Annotation; quote: string; onSave: (note: string) => void; onDeleteNote: () => void; onClose: () => void }) {
  const [text, setText] = useState(annotation.note);
  return (
    <div className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md rounded-xl border border-slate-900 bg-white p-4 shadow-xl" role="dialog" aria-label="Note">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Note</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-lg leading-none">
          ✕
        </button>
      </div>
      <p className="mt-2 line-clamp-2 border-l-4 pl-2 text-sm italic text-slate-700" style={{ borderColor: SWATCH[annotation.color] }}>
        {quote}
      </p>
      <textarea
        autoFocus
        value={text}
        maxLength={MAX_NOTE_LENGTH}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder="Type a note to yourself"
        className="mt-3 w-full resize-none rounded-lg border border-slate-300 p-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
      <div className="mt-1 text-right text-[11px] text-slate-500">
        {text.length}/{MAX_NOTE_LENGTH}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        {annotation.note && (
          <button type="button" onClick={onDeleteNote} className="cursor-pointer rounded-full border border-slate-900 px-4 py-1.5 text-sm font-bold">
            Delete note
          </button>
        )}
        <button type="button" onClick={() => onSave(text.trim())} className="cursor-pointer rounded-full bg-brand-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-600">
          Save
        </button>
      </div>
    </div>
  );
}

// ---------- editing the list ----------

const newId = () => Math.random().toString(36).slice(2, 12);

// Adds a highlight; one overlapping others on the same text replaces them (their notes are kept).
export function addAnnotation(list: Annotation[], selection: Omit<SelectionInfo, "rect">, color: HighlightColor, underline: boolean): { list: Annotation[]; id: string } {
  const overlapping = list.filter((annotation) => annotation.target === selection.target && annotation.start < selection.end && selection.start < annotation.end);
  const start = Math.min(selection.start, ...overlapping.map((annotation) => annotation.start));
  const end = Math.max(selection.end, ...overlapping.map((annotation) => annotation.end));
  const note = overlapping
    .map((annotation) => annotation.note)
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_NOTE_LENGTH);
  const id = newId();
  const kept = list.filter((annotation) => !overlapping.includes(annotation));
  if (kept.length >= MAX_ANNOTATIONS_PER_QUESTION) return { list, id: "" };
  return { list: [...kept, { id, target: selection.target, start, end, color, underline: underline || overlapping.some((annotation) => annotation.underline), note }], id };
}

// The words a highlight covers, for the note panel.
export function quoteOf(container: HTMLElement | null, annotation: Annotation): string {
  const region = container?.querySelector(`[data-annotation-target="${annotation.target}"]`);
  if (!region) return "";
  return rangeOf(region, annotation.start, annotation.end)?.toString() ?? "";
}
