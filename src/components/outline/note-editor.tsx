"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { attachNoteEditable, type NoteEditable } from "@/lib/note-editable";
import { wrapSelection, type Patch } from "@/lib/markdown-style";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The note editor: the same editing functions as the document text toolbar
// (reader.tsx), applied as markdown. Format buttons rewrite the selected
// lines' markers; style buttons wrap the selection; colors use the note style
// tags the Markdown component renders (<clay>…</clay> etc.). The text is
// edited as the document it renders to (lib/note-editable.ts): bold reads
// bold, a heading reads large, a list line carries its bullet — the same
// prose classes as the rendered note, so the two look alike.

type TextColor = "clay" | "sage" | "gold" | "plum";
const TEXT_COLORS: { tag: TextColor; dot: string; nameKey: TKey }[] = [
  { tag: "clay", dot: "var(--clay-500)", nameKey: "reader.colorClay" },
  { tag: "sage", dot: "var(--sage-600)", nameKey: "reader.colorSage" },
  { tag: "gold", dot: "#d9a54a", nameKey: "reader.colorGold" },
  { tag: "plum", dot: "#a78bfa", nameKey: "reader.colorPlum" },
];

const HUE_TAG = /^<(clay|sage|gold|plum)>([\s\S]*)<\/\1>$/;

/** One color per selection: same color toggles off, another color replaces. */
function colorSelection(value: string, s: number, e: number, tag: TextColor): Patch {
  const selected = value.slice(s, e);
  const wrapped = HUE_TAG.exec(selected);
  if (wrapped) {
    const inner = wrapped[2];
    const next =
      wrapped[1] === tag ? inner : `<${tag}>${inner}</${tag}>`;
    return { value: value.slice(0, s) + next + value.slice(e), start: s, end: s + next.length };
  }
  return wrapSelection(value, s, e, `<${tag}>`, `</${tag}>`);
}

/** Rewrite the lines the selection touches. */
function mapSelectedLines(
  value: string,
  s: number,
  e: number,
  map: (lines: string[]) => string[],
): Patch {
  const lineStart = value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", e);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const mapped = map(value.slice(lineStart, lineEnd).split("\n")).join("\n");
  return {
    value: value.slice(0, lineStart) + mapped + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + mapped.length,
  };
}

// Line markers, matching the reader's conventions: "# " headings, "- " lists,
// "N. " numbered lists, "> " quotes stay untouched by inline styles.
const LINE_MARKER = /^(\s*)(?:#{1,6}|-|\d{1,3}[.)])\s+/;

function setLinePrefix(lines: string[], prefix: (i: number) => string, active: RegExp): string[] {
  const bodies = lines.map((l) => l.replace(LINE_MARKER, "$1"));
  const allActive = lines.every((l) => l.trim() === "" || active.test(l));
  if (allActive) return bodies;
  let n = 0;
  return bodies.map((l) => {
    const indent = /^\s*/.exec(l)![0];
    const body = l.slice(indent.length);
    if (!body) return l;
    return `${indent}${prefix(n++)}${body}`;
  });
}

// track names the format in click telemetry (SPEC.md §7).
const FORMATS: { label: string; titleKey: TKey; track: string; map: (lines: string[]) => string[] }[] = [
  {
    label: "¶",
    titleKey: "panes.formatParagraph",
    track: "paragraph",
    map: (ls) => ls.map((l) => l.replace(LINE_MARKER, "$1")),
  },
  {
    label: "H1",
    titleKey: "panes.formatHeading1",
    track: "h1",
    map: (ls) => setLinePrefix(ls, () => "# ", /^\s*#\s/),
  },
  {
    label: "H2",
    titleKey: "panes.formatHeading2",
    track: "h2",
    map: (ls) => setLinePrefix(ls, () => "## ", /^\s*##\s/),
  },
  {
    label: "H3",
    titleKey: "panes.formatHeading3",
    track: "h3",
    map: (ls) => setLinePrefix(ls, () => "### ", /^\s*###\s/),
  },
  {
    label: "•",
    titleKey: "panes.formatBulletedList",
    track: "list",
    map: (ls) => setLinePrefix(ls, () => "- ", /^\s*-\s/),
  },
  {
    label: "1.",
    titleKey: "panes.formatNumberedList",
    track: "numbered",
    map: (ls) => setLinePrefix(ls, (i) => `${i + 1}. `, /^\s*\d{1,3}[.)]\s/),
  },
];

// Bold, italic, underline are the browser's own editing commands: with a
// selection they style it, with a bare caret they style what is typed next.
// The editor reads the result back. Cmd+B/I/U reach the same command inside
// the editable (lib/note-editable.ts), so the keys and the bar do one thing —
// handling them here too would toggle each press twice.
const STYLES: { label: string; command: "bold" | "italic" | "underline"; titleKey: TKey; track: string; cls: string }[] = [
  { label: "B", command: "bold", titleKey: "panes.bold", track: "bold", cls: "font-bold" },
  { label: "I", command: "italic", titleKey: "panes.italic", track: "italic", cls: "italic" },
  { label: "U", command: "underline", titleKey: "panes.underline", track: "underline", cls: "underline" },
];

const indentLines = (ls: string[]) => ls.map((l) => `  ${l}`);
const outdentLines = (ls: string[]) => ls.map((l) => l.replace(/^ {1,2}/, ""));

function GripIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
      <circle cx="2.5" cy="2.5" r="1.4" />
      <circle cx="7.5" cy="2.5" r="1.4" />
      <circle cx="2.5" cy="7" r="1.4" />
      <circle cx="7.5" cy="7" r="1.4" />
      <circle cx="2.5" cy="11.5" r="1.4" />
      <circle cx="7.5" cy="11.5" r="1.4" />
    </svg>
  );
}

export function NoteEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className = "",
  handle,
}: {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  placeholder?: string;
  /** Extra classes on the root: a flex column, the bar above the text. Give it
      a height (min-h-0 flex-1 under a capped parent) and the text scrolls. */
  className?: string;
  /** When set, a slim row above the bar — a grip and a label — is the drag
      handle: pointerdown on it goes here. */
  handle?: { onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void; title: string; label: string };
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const core = useRef<NoteEditable | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Mount: the editable takes the text, caret at the end — on a quote note
  // the addition starts underneath the quote.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const editable = attachNoteEditable(el, {
      text: valueRef.current,
      onChange: (text) => onChangeRef.current(text),
    });
    core.current = editable;
    editable.focusEnd();
    return () => {
      editable.destroy();
      core.current = null;
    };
  }, []);

  // The value changed outside the editable (Cancel restores it): paint it.
  // After the user's own edits the value already matches, and nothing moves.
  useLayoutEffect(() => {
    valueRef.current = value;
    core.current?.setText(value);
  }, [value]);

  /** A markdown command on the selection. rangeOnly: nothing happens on a bare caret. */
  function apply(patch: (value: string, s: number, e: number) => Patch, rangeOnly = false) {
    const editable = core.current;
    if (!editable) return;
    const { start, end } = editable.getSelection();
    if (rangeOnly && start === end) {
      editable.setText(editable.getText(), { start, end });
      return;
    }
    const next = patch(editable.getText(), start, end);
    editable.setText(next.value, { start: next.start, end: next.end });
    onChange(next.value);
  }

  function command(name: "bold" | "italic" | "underline") {
    core.current?.toggleStyle(name);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      apply((v, s, en) => mapSelectedLines(v, s, en, e.shiftKey ? outdentLines : indentLines));
      return;
    }
    onKeyDown?.(e);
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();
  const barButton =
    "rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800";

  return (
    <div className={`flex min-h-0 flex-col gap-1.5 ${className}`}>
      {handle && (
        <div
          onPointerDown={handle.onPointerDown}
          style={{ touchAction: "pan-y" }}
          data-tip={handle.title}
          className="flex shrink-0 cursor-grab items-center gap-1.5 text-[11px] font-bold tracking-[0.08em] text-sand-500 uppercase select-none active:cursor-grabbing"
        >
          <span className="flex text-sand-400">
            <GripIcon />
          </span>
          {handle.label}
        </div>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-0.5">
        {FORMATS.map(({ label, titleKey, track, map }) => (
          <button
            key={label}
            type="button"
            data-track={`note-format:${track}`}
            onMouseDown={keep}
            onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, map))}
            data-tip={t(titleKey)}
            className={barButton}
          >
            {label}
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {STYLES.map(({ label, command: name, titleKey, track, cls }) => (
          <button
            key={label}
            type="button"
            data-track={`note-style:${track}`}
            onMouseDown={keep}
            onClick={() => command(name)}
            data-tip={t(titleKey)}
            className={`${barButton} ${cls}`}
          >
            {label}
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {TEXT_COLORS.map(({ tag, dot, nameKey }) => (
          <button
            key={tag}
            type="button"
            onMouseDown={keep}
            onClick={() => apply((v, s, e) => colorSelection(v, s, e, tag), true)}
            data-track="note-text-color"
            aria-label={t("panes.textColorIn", { color: t(nameKey) })}
            data-tip={t("panes.textColorIn", { color: t(nameKey) })}
            className="mx-0.5 size-[13px] rounded-full transition-transform hover:scale-110"
            style={{ background: dot }}
          />
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, outdentLines))}
          data-track="note-outdent"
          data-tip={t("panes.outdentLine")}
          className={barButton}
        >
          ⇤
        </button>
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, indentLines))}
          data-track="note-indent"
          data-tip={t("panes.indentLine")}
          className={barButton}
        >
          ⇥
        </button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder ?? t("outline.noteText")}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onKeyDown={handleKeyDown}
        className="note-doc prose prose-sm max-w-none prose-p:my-1.5 prose-headings:my-2 prose-ul:my-1.5 prose-ol:my-1.5 min-h-[4.5em] min-w-0 flex-1 overflow-y-auto outline-none"
      />
    </div>
  );
}
