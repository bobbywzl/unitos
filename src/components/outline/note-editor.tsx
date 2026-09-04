"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The note editor: the same editing functions as the document text toolbar
// (reader.tsx), applied as markdown. Format buttons rewrite the selected
// lines' markers; style buttons wrap the selection; colors use the note style
// tags the Markdown component renders (<clay>…</clay> etc.).

type TextColor = "clay" | "sage" | "gold" | "plum";
const TEXT_COLORS: { tag: TextColor; dot: string; nameKey: TKey }[] = [
  { tag: "clay", dot: "var(--clay-500)", nameKey: "reader.colorClay" },
  { tag: "sage", dot: "var(--sage-600)", nameKey: "reader.colorSage" },
  { tag: "gold", dot: "#d9a54a", nameKey: "reader.colorGold" },
  { tag: "plum", dot: "#a78bfa", nameKey: "reader.colorPlum" },
];

const HUE_TAG = /^<(clay|sage|gold|plum)>([\s\S]*)<\/\1>$/;

type Patch = { value: string; start: number; end: number };

/** Wrap the selection in markers, or unwrap when already wrapped. */
function wrapSelection(value: string, s: number, e: number, before: string, after: string): Patch {
  const selected = value.slice(s, e);
  if (
    selected.length >= before.length + after.length &&
    selected.startsWith(before) &&
    selected.endsWith(after)
  ) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { value: value.slice(0, s) + inner + value.slice(e), start: s, end: s + inner.length };
  }
  if (value.slice(Math.max(0, s - before.length), s) === before && value.slice(e, e + after.length) === after) {
    return {
      value: value.slice(0, s - before.length) + selected + value.slice(e + after.length),
      start: s - before.length,
      end: s - before.length + selected.length,
    };
  }
  return {
    value: value.slice(0, s) + before + selected + after + value.slice(e),
    start: s + before.length,
    end: s + before.length + selected.length,
  };
}

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

const WRAPS: { label: string; titleKey: TKey; track: string; before: string; after: string; cls: string }[] = [
  { label: "B", titleKey: "panes.bold", track: "bold", before: "**", after: "**", cls: "font-bold" },
  { label: "I", titleKey: "panes.italic", track: "italic", before: "*", after: "*", cls: "italic" },
  { label: "U", titleKey: "panes.underline", track: "underline", before: "<u>", after: "</u>", cls: "underline" },
];

const indentLines = (ls: string[]) => ls.map((l) => `  ${l}`);
const outdentLines = (ls: string[]) => ls.map((l) => l.replace(/^ {1,2}/, ""));

export function NoteEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLTextAreaElement>(null);

  // Open with the caret at the end: on a quote note the addition starts
  // underneath the quote.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  function apply(patch: (value: string, s: number, e: number) => Patch) {
    const el = ref.current;
    if (!el) return;
    const next = patch(el.value, el.selectionStart, el.selectionEnd);
    onChange(next.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.start, next.end);
    });
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();
  const barButton =
    "rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-0.5">
        {FORMATS.map(({ label, titleKey, track, map }) => (
          <button
            key={label}
            type="button"
            data-track={`note-format:${track}`}
            onMouseDown={keep}
            onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, map))}
            title={t(titleKey)}
            className={barButton}
          >
            {label}
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {WRAPS.map(({ label, titleKey, track, before, after, cls }) => (
          <button
            key={label}
            type="button"
            data-track={`note-style:${track}`}
            onMouseDown={keep}
            onClick={() => apply((v, s, e) => wrapSelection(v, s, e, before, after))}
            title={t(titleKey)}
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
            onClick={() => apply((v, s, e) => colorSelection(v, s, e, tag))}
            data-track="note-text-color"
            aria-label={t("panes.textColorIn", { color: t(nameKey) })}
            title={t("panes.textColorIn", { color: t(nameKey) })}
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
          title={t("panes.outdentLine")}
          className={barButton}
        >
          ⇤
        </button>
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, indentLines))}
          data-track="note-indent"
          title={t("panes.indentLine")}
          className={barButton}
        >
          ⇥
        </button>
      </div>
      {/* The textarea grows with the text: an invisible copy of the text sits
          in the same grid cell and sets the height, so every line the note
          has is on screen while it is edited — no inner scroll, no drag to
          resize — and the editor is as tall as the note it replaces. Both
          take note-text (globals.css), the display's size and line height. */}
      <div className="grid">
        <div
          aria-hidden
          className="note-text invisible col-start-1 row-start-1 min-h-[3lh] break-words whitespace-pre-wrap"
        >
          {value}
          {"\n"}
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          className="note-text col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-sand-500"
        />
      </div>
    </div>
  );
}
