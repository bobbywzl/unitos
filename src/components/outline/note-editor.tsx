"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { attachNoteEditable, type NoteEditable, type StyleCommand } from "@/lib/note-editable";
import type { Patch } from "@/lib/markdown-style";
import { IMAGE_ACCEPT, imageMarkdown, refuseImage, uploadImage } from "@/lib/images";
import { hasQuoteDrag, quoteMarkdown, readQuoteDrag, type QuoteDrag } from "@/lib/quote-drag";
import { RedoIcon, UndoIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

// The note editor: the same editing functions as the document text toolbar
// (reader.tsx), applied as markdown. Format buttons rewrite the selected
// lines' markers; style buttons and colors go through the editable, which
// styles a selection or what is typed next. The text is edited as the
// document it renders to (lib/note-editable.ts): bold reads bold, a heading
// reads large, a list line carries its bullet — the same prose classes as the
// rendered note, so the two look alike.
//
// Two bars (SPEC.md §6): the tray's editor carries the core tools and a link
// to the notes full page, whose editor carries them all — the dash list, the
// checklist, the quote, and the image picker. Every typed shortcut works in
// both, and every tool's tooltip names its key or its typed shortcut.

type TextColor = "clay" | "sage" | "gold" | "plum";
const TEXT_COLORS: { tag: TextColor; dot: string; nameKey: TKey }[] = [
  { tag: "clay", dot: "var(--clay-500)", nameKey: "reader.colorClay" },
  { tag: "sage", dot: "var(--sage-600)", nameKey: "reader.colorSage" },
  { tag: "gold", dot: "#d9a54a", nameKey: "reader.colorGold" },
  { tag: "plum", dot: "#a78bfa", nameKey: "reader.colorPlum" },
];

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

// Line markers, matching the note grammar (lib/note-markup.ts): "# " headings,
// "- " and "* " bullets, "+ " dashes, "- [ ] " tasks, "N. " numbers, "> "
// quotes. Inline styles never touch them.
const LINE_MARKER = /^(\s*)(?:(?:#{1,6}|[-*+](?:\s\[[ xX]\])?|\d{1,3}[.)])\s+|>\s*)/;

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

// track names the format in click telemetry (SPEC.md §7). full: the notes
// full page only; the tray's bar leaves it out.
// No Paragraph button: Backspace at the start of a marked line drops its
// marker (lib/note-editable.ts), and that is the whole of that action.
const FORMATS: { label: string; tipKey: TKey; track: string; full?: boolean; map: (lines: string[]) => string[] }[] = [
  {
    label: "H1",
    tipKey: "outline.tipHeading1",
    track: "h1",
    map: (ls) => setLinePrefix(ls, () => "# ", /^\s*#\s/),
  },
  {
    label: "H2",
    tipKey: "outline.tipHeading2",
    track: "h2",
    map: (ls) => setLinePrefix(ls, () => "## ", /^\s*##\s/),
  },
  {
    label: "H3",
    tipKey: "outline.tipHeading3",
    track: "h3",
    map: (ls) => setLinePrefix(ls, () => "### ", /^\s*###\s/),
  },
  {
    label: "•",
    tipKey: "outline.tipBulletedList",
    track: "list",
    map: (ls) => setLinePrefix(ls, () => "- ", /^\s*[-*]\s(?!\[[ xX]\]\s)/),
  },
  {
    label: "–",
    tipKey: "outline.tipDashList",
    track: "dash",
    full: true,
    map: (ls) => setLinePrefix(ls, () => "+ ", /^\s*\+\s(?!\[[ xX]\]\s)/),
  },
  {
    label: "1.",
    tipKey: "outline.tipNumberedList",
    track: "numbered",
    map: (ls) => setLinePrefix(ls, (i) => `${i + 1}. `, /^\s*\d{1,3}[.)]\s/),
  },
  {
    label: "☐",
    tipKey: "outline.tipChecklist",
    track: "checklist",
    full: true,
    map: (ls) => setLinePrefix(ls, () => "- [ ] ", /^\s*[-*+]\s\[[ xX]\]\s/),
  },
  {
    label: "❝",
    tipKey: "outline.tipQuote",
    track: "quote",
    map: (ls) => setLinePrefix(ls, () => "> ", /^\s*>/),
  },
];

// Bold, italic, underline go through the editable: with a selection they
// style it, with a bare caret they style what is typed next. Cmd+B/I/U reach
// the same command inside the editable (lib/note-editable.ts), so the keys
// and the bar do one thing — handling them here too would toggle each press
// twice.
const STYLES: { label: string; command: StyleCommand; tipKey: TKey; track: string; cls: string }[] = [
  { label: "B", command: "bold", tipKey: "outline.tipBold", track: "bold", cls: "font-bold" },
  { label: "I", command: "italic", tipKey: "outline.tipItalic", track: "italic", cls: "italic" },
  { label: "U", command: "underline", tipKey: "outline.tipUnderline", track: "underline", cls: "underline" },
];

const indentLines = (ls: string[]) => ls.map((l) => `  ${l}`);
const outdentLines = (ls: string[]) => ls.map((l) => l.replace(/^ {1,2}/, ""));

/** The modifier key as the tooltips name it: ⌘ on a Mac, Ctrl elsewhere.
    Read after mount, so the server's markup and the browser's agree. */
function useModKey(): string {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mac) setMod("⌘");
  }, []);
  return mod;
}

function ImageIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

// Why a picked or pasted image cannot be added, in the reader's words.
const REFUSAL_KEY = {
  "not-image": "panes.dropImageOnly",
  premium: "api.imageNeedsPremium",
  "too-large": "api.imageTooLarge",
} as const satisfies Record<string, Parameters<TFunc>[0]>;

export function NoteEditor({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className = "",
  full = false,
  moreHref,
  autoFocus = true,
  title,
  onQuoteDrop,
}: {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  placeholder?: string;
  /** Extra classes on the root: a flex column, the bar above the text. Give it
      a height (min-h-0 flex-1 under a capped parent) and the text scrolls. */
  className?: string;
  /** The whole bar (the notes full page); false: the core tools (the tray). */
  full?: boolean;
  /** With the core bar: where the whole bar is — the notes full page. */
  moreHref?: string;
  /** The caret lands at the end of the text on mount. False: the title field
      takes the focus (note-title-field.tsx). */
  autoFocus?: boolean;
  /** The note's title field, drawn under the bar and over the body: the bar
      is the editor's own, so it sits at the top of the editor, and the title
      reads as the first line of what it writes (SPEC.md §6). */
  title?: React.ReactNode;
  /** A quote dragged from the reader and let go in the text
      (lib/quote-drag.ts): the quote is already in the text at the caret
      when this runs; the owner attaches its source to the note. */
  onQuoteDrop?: (drag: QuoteDrag) => void | Promise<void>;
}) {
  const t = useT();
  const mod = useModKey();
  const { premium } = useCollab();
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const core = useRef<NoteEditable | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  // Read once, on mount: whether the caret lands in the text.
  const autoFocusRef = useRef(autoFocus);
  const [imageError, setImageError] = useState<string | null>(null);
  // What the undo and redo buttons can do, read back after every edit — the
  // editable owns the history (lib/note-editable.ts) and Cmd+Z reaches it
  // there, so the buttons are the same two steps under a symbol.
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const readHistory = () => setHistory(core.current?.history() ?? { canUndo: false, canRedo: false });

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // A picked or pasted image goes into the note at the caret (SPEC.md §16):
  // refused before anything leaves the browser when the tier does not allow
  // it, stored, and inserted as its markdown on its own line.
  const insertImages = async (files: File[]) => {
    setImageError(null);
    const refusal = files.map((f) => refuseImage(f, premium)).find((r) => r !== null);
    if (refusal) {
      setImageError(t(REFUSAL_KEY[refusal]));
      return;
    }
    try {
      for (const file of files) {
        const stored = await uploadImage(file);
        core.current?.insertBlock(imageMarkdown(stored.id, file.name));
      }
      readHistory();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  };
  const insertImagesRef = useRef(insertImages);
  useEffect(() => {
    insertImagesRef.current = insertImages;
  });

  // Mount: the editable takes the text, caret at the end — on a quote note
  // the addition starts underneath the quote.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const editable = attachNoteEditable(el, {
      text: valueRef.current,
      onChange: (text) => {
        onChangeRef.current(text);
        setHistory(editable.history());
      },
      onImageFiles: (files) => void insertImagesRef.current(files),
    });
    core.current = editable;
    if (autoFocusRef.current) editable.focusEnd();
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

  /** A markdown command on the selection's lines. */
  function apply(patch: (value: string, s: number, e: number) => Patch) {
    const editable = core.current;
    if (!editable) return;
    const { start, end } = editable.getSelection();
    const next = patch(editable.getText(), start, end);
    editable.setText(next.value, { start: next.start, end: next.end });
    onChange(next.value);
  }

  function command(name: StyleCommand) {
    core.current?.toggleStyle(name);
    readHistory();
  }

  function step(back: boolean) {
    if (back) core.current?.undo();
    else core.current?.redo();
    readHistory();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const modified = e.metaKey || e.ctrlKey;
    if (e.key === "Tab" && !modified && !e.altKey) {
      e.preventDefault();
      apply((v, s, en) => mapSelectedLines(v, s, en, e.shiftKey ? outdentLines : indentLines));
      return;
    }
    onKeyDown?.(e);
  }

  // A quote dragged over the text (lib/quote-drag.ts): a caret, drawn by
  // this component and never blinking, stands where the quote would land —
  // the text position under the pointer — and the drop puts the quote there
  // on a line of its own. The caret rides the text's box; nothing else on the
  // page takes the drop.
  const bodyBox = useRef<HTMLDivElement>(null);
  const [dropCaret, setDropCaret] = useState<{ top: number; left: number; height: number } | null>(null);

  const rangeAtPoint = (x: number, y: number): Range | null => {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    let range: Range | null = null;
    if (doc.caretPositionFromPoint) {
      const at = doc.caretPositionFromPoint(x, y);
      if (at) {
        range = document.createRange();
        range.setStart(at.offsetNode, at.offset);
        range.collapse(true);
      }
    } else if (doc.caretRangeFromPoint) {
      range = doc.caretRangeFromPoint(x, y);
    }
    const el = ref.current;
    if (!el) return null;
    if (!range || !el.contains(range.startContainer)) {
      // Past the text: the end of it.
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    return range;
  };

  const showCaret = (range: Range) => {
    const box = bodyBox.current;
    if (!box) return;
    const rects = range.getClientRects();
    let rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
    if (rect.height === 0) {
      // An empty line has no glyph to measure; the line's own box does.
      const node = range.startContainer;
      const host = node instanceof Element ? node : node.parentElement;
      if (host) rect = host.getBoundingClientRect();
    }
    const at = box.getBoundingClientRect();
    setDropCaret({
      top: rect.top - at.top,
      left: rect.left - at.left,
      height: Math.max(14, rect.height),
    });
  };

  function onQuoteDragOver(e: React.DragEvent) {
    if (!onQuoteDrop || !hasQuoteDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    const range = rangeAtPoint(e.clientX, e.clientY);
    if (range) showCaret(range);
  }

  function onQuoteDragLeave(e: React.DragEvent) {
    if (!onQuoteDrop || !hasQuoteDrag(e.dataTransfer)) return;
    const to = e.relatedTarget;
    if (to instanceof Node && bodyBox.current?.contains(to)) return;
    setDropCaret(null);
  }

  function onQuoteDropped(e: React.DragEvent) {
    if (!onQuoteDrop || !hasQuoteDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropCaret(null);
    const drag = readQuoteDrag(e.dataTransfer);
    const el = ref.current;
    if (!drag || !el || !core.current) return;
    const range = rangeAtPoint(e.clientX, e.clientY);
    el.focus({ preventScroll: true });
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    core.current.insertBlock(quoteMarkdown(drag.text));
    readHistory();
    void onQuoteDrop(drag);
  }

  const keep = (e: React.MouseEvent) => e.preventDefault();
  const barButton =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800";
  const formats = full ? FORMATS : FORMATS.filter((f) => !f.full);

  return (
    <div className={`flex min-h-0 flex-col gap-1.5 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-center gap-0.5">
        <button
          type="button"
          data-track="note-undo"
          onMouseDown={keep}
          onClick={() => step(true)}
          disabled={!history.canUndo}
          aria-label={t("outline.tipUndo", { mod })}
          data-tip={t("outline.tipUndo", { mod })}
          className={`${barButton} disabled:opacity-30`}
        >
          <UndoIcon size={13} />
        </button>
        <button
          type="button"
          data-track="note-redo"
          onMouseDown={keep}
          onClick={() => step(false)}
          disabled={!history.canRedo}
          aria-label={t("outline.tipRedo", { mod })}
          data-tip={t("outline.tipRedo", { mod })}
          className={`${barButton} disabled:opacity-30`}
        >
          <RedoIcon size={13} />
        </button>
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {formats.map(({ label, tipKey, track, map }) => (
          <button
            key={label}
            type="button"
            data-track={`note-format:${track}`}
            onMouseDown={keep}
            onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, map))}
            aria-label={t(tipKey)}
            data-tip={t(tipKey)}
            className={barButton}
          >
            {label}
          </button>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-line" />
        {STYLES.map(({ label, command: name, tipKey, track, cls }) => (
          <button
            key={label}
            type="button"
            data-track={`note-style:${track}`}
            onMouseDown={keep}
            onClick={() => command(name)}
            aria-label={t(tipKey, { mod })}
            data-tip={t(tipKey, { mod })}
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
            onClick={() => command(tag)}
            data-track="note-text-color"
            aria-label={t("outline.tipColor", { color: t(nameKey) })}
            data-tip={t("outline.tipColor", { color: t(nameKey) })}
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
          aria-label={t("outline.tipOutdent")}
          data-tip={t("outline.tipOutdent")}
          className={barButton}
        >
          ⇤
        </button>
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => apply((v, s, e) => mapSelectedLines(v, s, e, indentLines))}
          data-track="note-indent"
          aria-label={t("outline.tipIndent")}
          data-tip={t("outline.tipIndent")}
          className={barButton}
        >
          ⇥
        </button>
        {full && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-line" />
            <button
              type="button"
              onMouseDown={keep}
              onClick={() => fileRef.current?.click()}
              data-track="note-image"
              aria-label={t("outline.tipImage")}
              data-tip={t("outline.tipImage")}
              className={barButton}
            >
              <ImageIcon />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT}
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) void insertImages(files);
              }}
            />
          </>
        )}
      </div>
      {!full && moreHref && (
        <Link
          href={moreHref}
          data-track="notes-full-page-tools"
          className="shrink-0 self-start text-[11px] text-sand-500 hover:text-clay-700"
        >
          {t("outline.moreOnFullPage")} →
        </Link>
      )}
      {imageError && <p className="shrink-0 text-[11px] text-red-500">{imageError}</p>}
      {title}
      <div
        ref={bodyBox}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onDragOver={onQuoteDragOver}
        onDragLeave={onQuoteDragLeave}
        onDrop={onQuoteDropped}
        data-tip={dropCaret ? t("outline.dropQuoteHere") : undefined}
      >
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
        {dropCaret && (
          <div
            aria-hidden
            className="pointer-events-none absolute w-[2px] rounded-full bg-clay-500"
            style={{ top: dropCaret.top, left: dropCaret.left, height: dropCaret.height }}
          />
        )}
      </div>
    </div>
  );
}
