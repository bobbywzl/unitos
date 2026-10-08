"use client";

// Add to note (SPEC.md §13, VIEW4-03): every passage the graph shows — a
// Find result, a link's two passages, a node card's part — has Add to note,
// which puts it in one new note docked at the foot of the side list, and the
// graph stays open. The composer shows each quote with its document and ✕,
// the section (by default the one the reader last wrote in, as Note on this
// link), and a box for the reader's own words. Save note writes one note,
// accepted (the reader picked every quote; nothing is AI-written), each
// quote a source (POST /api/notes with quotes; the server re-finds each by
// the anchor ladder). The quotes, the words, and the section are kept in the
// browser for the account and the project (lib/note-drafts.ts) until the
// server, or the offline queue, has the note: closing the graph, a reload, or
// a failed save never loses them. Discard drops them, after a confirm.

import { ACTION, ACTION_ACCEPT, ACTION_NOTE, ACTION_NOTE_IN } from "./graph-ui";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { MAX_NOTE_QUOTES } from "@/lib/anchors/note-quotes-limit";
import { gatherDraftKey, readGatherDraft, writeGatherDraft, type GatherDraftQuote } from "@/lib/note-drafts";
import { refreshWhenOnline } from "@/lib/offline/queue";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { clipWords } from "@/lib/markdown-preview";
import { useCollab } from "@/components/collab/collab-context";
import { ChevronDownIcon, NotesIcon, SparkleIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useGraphNotes } from "@/components/graph/graph-notes";
import { announceSavedLine, onOtherSavedLine } from "@/components/graph/saved-line"; // [ui5]

export type GatherQuote = GatherDraftQuote;

// graph-overlay.tsx's WIDE: under it the dock sits at bottom-16 and an open
// Stitch box closes the side list.
const WIDE = 1000;

const keyOf = (q: GatherQuote) => `${q.documentId}:${q.blockId ?? ""}:${q.whole ? "" : q.text}`;

type GatherValue = {
  quotes: GatherQuote[];
  content: string;
  sectionId: string | null;
  has: (q: GatherQuote) => boolean;
  /** Adds the quote, or removes it when it is in the note already. */
  toggle: (q: GatherQuote) => void;
  remove: (q: GatherQuote) => void;
  setContent: (text: string) => void;
  setSectionId: (id: string) => void;
  clear: () => void;
  /** After a save: drops what was sent, keeps what came after (REV5-04). */
  settle: (sent: GatherSent) => void;
  full: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const GatherContext = createContext<GatherValue | null>(null);

export function useNoteGather(): GatherValue | null {
  return useContext(GatherContext);
}

type Draft = { content: string; sectionId: string | null; quotes: GatherQuote[] };
const EMPTY: Draft = { content: "", sectionId: null, quotes: [] };

/** What a save sent (REV5-04): the quotes' keys and the words as typed. */
export type GatherSent = { keys: Set<string>; content: string };

/** The words to keep after a save: none when they are still what was sent;
    what was typed after them when they start with it; else all of them. */
function wordsAfter(content: string, sent: string): string {
  if (!sent.trim()) return content;
  if (content === sent) return "";
  return content.startsWith(sent) ? content.slice(sent.length).trimStart() : content;
}

/** Words changed in another tab since this tab last read them (REV5-03):
    the words typed here win when they hold the other tab's, the other tab's
    when they hold these; else both are kept, the other tab's first. */
function mergeWords(stored: string, seen: string, typed: string): string {
  if (stored === seen || typed.includes(stored)) return typed;
  if (stored.includes(typed)) return stored;
  return `${stored}\n\n${typed}`;
}

export function NoteGatherProvider({ notebookId, children }: { notebookId: string; children: React.ReactNode }) {
  const { myId, canEdit } = useCollab();
  // The graph renders in the browser only, so the draft is read at once.
  const [draft, setDraft] = useState<Draft>(() =>
    typeof window === "undefined" ? EMPTY : (readGatherDraft(myId, notebookId) ?? EMPTY),
  );
  // This tab's draft as of the last change, for the next change: a change is
  // worked out once, outside a state updater, which React may run twice.
  const current = useRef(draft);
  const [open, setOpen] = useState(true);
  // Another tab's change lands here (REV5-03): the stored draft is the one draft.
  useEffect(() => {
    const key = gatherDraftKey(myId, notebookId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key && e.key !== null) return;
      const stored = readGatherDraft(myId, notebookId);
      current.current = stored ? { content: stored.content, sectionId: stored.sectionId, quotes: stored.quotes } : EMPTY;
      setDraft(current.current);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [myId, notebookId]);
  // Each change reads the stored draft first and applies itself to it, so a
  // change in one tab never writes over what another tab added (REV5-03).
  // Storage blocked: the stored draft reads null, and this tab's own goes on.
  // Words another tab changed that this tab has not seen are merged, never
  // written over (mergeWords).
  const update = useCallback(
    (next: (d: Draft, prev: Draft, storedWords: string) => Draft) => {
      const prev = current.current;
      const stored = readGatherDraft(myId, notebookId);
      const storedWords = stored ? stored.content : prev.content;
      const base = stored
        ? { content: mergeWords(storedWords, prev.content, prev.content), sectionId: stored.sectionId, quotes: stored.quotes }
        : prev;
      const d = next(base, prev, storedWords);
      writeGatherDraft(myId, notebookId, d);
      current.current = d;
      setDraft(d);
    },
    [myId, notebookId],
  );
  const value = useMemo<GatherValue | null>(() => {
    if (!canEdit) return null;
    const keys = new Set(draft.quotes.map(keyOf));
    return {
      ...draft,
      has: (q) => keys.has(keyOf(q)),
      toggle: (q) => {
        setOpen(true);
        update((d) =>
          d.quotes.some((x) => keyOf(x) === keyOf(q))
            ? { ...d, quotes: d.quotes.filter((x) => keyOf(x) !== keyOf(q)) }
            : d.quotes.length >= MAX_NOTE_QUOTES
              ? d
              : { ...d, quotes: [...d.quotes, q] },
        );
      },
      remove: (q) => update((d) => ({ ...d, quotes: d.quotes.filter((x) => keyOf(x) !== keyOf(q)) })),
      setContent: (text) => update((d, prev, storedWords) => ({ ...d, content: mergeWords(storedWords, prev.content, text) })),
      setSectionId: (id) => update((d) => ({ ...d, sectionId: id })),
      clear: () => update(() => EMPTY),
      settle: (sent) =>
        update((d) => {
          const quotes = d.quotes.filter((q) => !sent.keys.has(keyOf(q)));
          const content = wordsAfter(d.content, sent.content);
          return { content, quotes, sectionId: content || quotes.length > 0 ? d.sectionId : null };
        }),
      full: draft.quotes.length >= MAX_NOTE_QUOTES,
      open,
      setOpen,
    };
  }, [canEdit, draft, update, open]);
  return <GatherContext.Provider value={value}>{children}</GatherContext.Provider>;
}

/** Add to note on a passage: in the note already, it reads In the note, and a
    second press takes the quote out. Nothing for a viewer. */
export function AddToNote({ quote, className = "" }: { quote: GatherQuote; className?: string }) {
  const t = useT();
  const gather = useNoteGather();
  if (!gather) return null;
  const inNote = gather.has(quote);
  const blocked = !inNote && gather.full;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        gather.toggle(quote);
      }}
      onKeyDown={(e) => {
        // [lists7] WALK7-07: the focus stays on the button for the next Add,
        // and a typed character goes on into the new note's words.
        // An input method's first key ("Process") only moves the focus there.
        const ime = e.key === "Process";
        if (!ime && (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey)) return;
        const words = document.querySelector<HTMLTextAreaElement>("textarea[data-graph-note-gather-words]");
        if (!words) return;
        if (ime) {
          words.focus();
          return;
        }
        e.preventDefault();
        words.focus();
        gather.setContent(gather.content + e.key);
      }}
      disabled={blocked}
      aria-pressed={inNote}
      data-track={inNote ? "graph-note-gather-remove" : "graph-note-gather-add"}
      data-graph-add-to-note={inNote ? "in" : "out"}
      data-tip={blocked ? t("graphCover.composerFull", { n: MAX_NOTE_QUOTES }) : t(inNote ? "graphCover.addedToNoteTitle" : "graphCover.addToNoteTitle")}
      className={`${inNote ? ACTION_NOTE_IN : ACTION_NOTE} ${className}`}
    >
      <NotesIcon size={11} />
      {t(inNote ? "graphCover.addedToNote" : "graphCover.addToNote")}
    </button>
  );
}

/** The new note, docked at the foot of the side list: shown while it holds
    quotes or words, or just after a save. It tells the dialog its height
    (--graph-gather-h), so the side list ends above it. Where the Stitch box
    would cover it, it sits above the box; under WIDE it folds there to its
    header line, whose unfold folds the box (WALK5-12). */
export function NoteGatherDock({
  notebookId,
  onOpenDocument,
  onWritePage,
  boxOpen = false,
  onFoldBox,
}: {
  notebookId: string;
  onOpenDocument: () => void;
  /** Write a page from these (VIEW5-05): pick the quotes' documents and put
      a write-a-page command in the Stitch box. Nothing is sent. Editors only. */
  onWritePage?: (documentIds: string[], command: string) => void;
  /** The Stitch box is open (its fold), and how to fold it. */
  boxOpen?: boolean;
  onFoldBox?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const gather = useNoteGather();
  const ctx = useGraphNotes();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<
    | { noteId: string; section: string }
    | { queued: { sectionId: string; content: string; at: number }; section: string }
    | null
  >(null);
  // [ui5] WALK5-14: one saved line at a time on the graph.
  useEffect(() => (saved ? onOtherSavedLine("gather", () => setSaved(null)) : undefined), [saved]);
  const ref = useRef<HTMLDivElement>(null);
  // One save at a time: a second ⌘↵ before the first answers does nothing (REV5-04).
  const saving = useRef(false);
  const drafting = Boolean(gather && (gather.quotes.length > 0 || gather.content));
  // A new quote after a save, or words kept from during it, start the next
  // note: the saved line moves into its composer.
  const savedLine = saved !== null && !drafting;
  const shown = drafting || savedLine;
  // How far the dock sits above the dialog's foot to clear the Stitch box, 0
  // when the box does not reach it (WALK5-12).
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    const dialog = el?.closest<HTMLElement>(".graph-overlay");
    const slot = dialog?.querySelector<HTMLElement>("[data-stitch-slot]");
    if (!el || !dialog || !slot) {
      setLift(0);
      return;
    }
    const measure = () => {
      const box = (slot.firstElementChild ?? slot).getBoundingClientRect();
      const frame = dialog.getBoundingClientRect();
      const dock = el.getBoundingClientRect();
      const base = window.innerWidth < WIDE ? 64 : 12; // bottom-16 / bottom-3
      const across = box.width > 0 && box.left < dock.right && box.right > dock.left;
      const reaches = box.height > 0 && box.top < frame.bottom - base;
      setLift(across && reaches ? Math.round(frame.bottom - box.top + 8) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [shown, boxOpen]);
  const compact = lift > 0 && typeof window !== "undefined" && window.innerWidth < WIDE;

  useLayoutEffect(() => {
    const el = ref.current;
    const dialog = el?.closest<HTMLElement>(".graph-overlay");
    if (!el || !dialog) return;
    const observer = new ResizeObserver(() => dialog.style.setProperty("--graph-gather-h", `${Math.round(el.getBoundingClientRect().height)}px`));
    observer.observe(el);
    dialog.setAttribute("data-gather", "");
    return () => {
      observer.disconnect();
      dialog.removeAttribute("data-gather");
      dialog.style.removeProperty("--graph-gather-h");
    };
  }, [shown, savedLine]);

  if (!gather || !ctx || !shown) return null;
  const choices = ctx.sectionChoices;
  const chosen = choices.find((c) => c.id === gather.sectionId) ?? choices.find((c) => c.id === ctx.defaultSectionId) ?? choices[0];
  const docCount = new Set(gather.quotes.map((q) => q.documentId)).size;
  const summary = t("graphCover.composerQuotes", {
    n: gather.quotes.length,
    s: gather.quotes.length === 1 ? "" : "s",
    d: docCount,
    ds: docCount === 1 ? "" : "s",
  });
  const savedId = !saved
    ? null
    : "noteId" in saved
      ? saved.noteId
      : ctx.findNote(saved.queued.sectionId, saved.queued.content, saved.queued.at);

  // Write a page from these (VIEW5-05): the command, each quote with its
  // document, then the reader's words. The draft is kept.
  function writePage(quotes: GatherQuote[], content: string) {
    if (!onWritePage || !ctx || quotes.length === 0) return;
    const lines = quotes.map((q, i) => `${i + 1}. "${clipWords(q.text, 300)}" (${ctx.titleOf.get(q.documentId) ?? ""})`);
    const words = content.trim();
    onWritePage(
      [...new Set(quotes.map((q) => q.documentId))],
      [t("graphCover.composerWritePageCommand"), ...lines, ...(words ? [words] : [])].join("\n"),
    );
  }

  async function save() {
    if (!gather || !chosen || saving.current || gather.quotes.length === 0) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    // What is sent: only this leaves the draft when the save answers. Words
    // typed and quotes added meanwhile stay as the next note (REV5-04).
    const sentQuotes = gather.quotes;
    const sentContent = gather.content;
    const words = sentContent.trim();
    try {
      const note = await api<{ id: string; content: string } | { queued: true }>("/api/notes", "POST", {
        sectionId: chosen.id,
        ...(words ? { content: words } : {}),
        quotes: sentQuotes.map((q) => ({
          documentId: q.documentId,
          ...(q.blockId ? { blockId: q.blockId } : {}),
          ...(q.whole ? {} : { quotedText: q.text }),
        })),
      });
      // The server has the note, or the offline queue does: the draft goes.
      announceSavedLine("gather"); // [ui5] WALK5-14
      setSaved(
        "queued" in note
          ? { queued: { sectionId: chosen.id, content: words, at: Date.now() }, section: chosen.label }
          : { noteId: note.id, section: chosen.label },
      );
      gather.settle({ keys: new Set(sentQuotes.map(keyOf)), content: sentContent });
      refreshWhenOnline(router);
    } catch (err) {
      // The draft stays in the browser: the quotes and the words are kept.
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  // Write a page from these: an icon in the header row, beside the fold, so
  // the composer gains no row (VIEW5-05).
  const writePageButton =
    onWritePage && gather.quotes.length > 0 && !compact ? (
      <button
        type="button"
        onClick={() => writePage(gather.quotes, gather.content)}
        data-track="graph-note-gather-write-page"
        aria-label={t("graphCover.composerWritePage")}
        data-tip={`${t("graphCover.composerWritePage")}. ${t("graphCover.composerWritePageTitle")}`}
        className="flex size-6 items-center justify-center rounded-full text-[var(--kind-assistant)] hover:bg-[color-mix(in_srgb,var(--kind-assistant)_10%,transparent)]"
      >
        <SparkleIcon size={13} />
      </button>
    ) : null;

  // The saved line: alone after a save, or at the head of the next note's
  // composer when words or quotes came after the ones sent.
  const savedRow = saved ? (
    <p data-graph-note-gather-saved={savedId ?? ""} role="status" className="flex items-center gap-1.5 text-[12px] text-sage-700">
      <NotesIcon size={12} />
      <span className="min-w-0 flex-1">
        {savedId ? t("graphCover.composerSaved", { section: saved.section }) : t("graphCover.composerQueued", { section: saved.section })}
      </span>
      {savedId && (
        <button
          onClick={() => ctx.showSaved(savedId) /* [ui5] VIEW5-10 */}
          data-track="graph-note-gather-show"
          className={ACTION_NOTE_IN}
        >
          {t("graphCover.composerShow")}
        </button>
      )}
      <button
        onClick={() => setSaved(null)}
        aria-label={t("common.close")}
        data-tip={t("common.close")}
        className="flex size-6 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
      >
        ✕
      </button>
    </p>
  ) : null;

  const frame =
    "graph-note-gather menu-in absolute z-20 flex flex-col gap-1.5 rounded-[20px] border border-sage-300 bg-card/95 p-3 shadow-float backdrop-blur-md right-3 bottom-3 w-[400px] max-w-[calc(100vw-24px)] max-[999px]:bottom-16";
  const place = lift > 0 ? { bottom: lift } : undefined;

  if (saved && savedLine) {
    return (
      <div ref={ref} data-graph-note-gather="saved" className={frame} style={place}>
        {savedRow}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-graph-note-gather={gather.open && !compact ? "open" : "folded"}
      data-graph-note-gather-lift={lift > 0 ? lift : undefined}
      data-track-surface="graph-note-gather"
      className={frame}
      style={place}
    >
      {!compact && savedRow}
      <div className="flex items-center gap-2">
        <NotesIcon size={13} />
        <p className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-semibold text-ink">{t("graphCover.composerTitle")}</span>
          <span data-graph-note-gather-summary className="text-sand-600"> · {summary}</span>
        </p>
        {writePageButton}
        <button
          onClick={() => {
            // Folded over the Stitch box: unfolding folds the box (WALK5-12).
            if (compact) {
              gather.setOpen(true);
              onFoldBox?.();
            } else gather.setOpen(!gather.open);
          }}
          aria-expanded={gather.open && !compact}
          aria-label={t(gather.open && !compact ? "graphCover.composerFold" : "graphCover.composerUnfold")}
          data-tip={t(gather.open && !compact ? "graphCover.composerFold" : "graphCover.composerUnfold")}
          data-track="graph-note-gather-fold"
          className="flex size-6 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          <ChevronDownIcon size={13} className={gather.open && !compact ? "" : "rotate-180"} />
        </button>
      </div>
      {gather.open && !compact && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-1.5"
        >
          {choices.length === 0 ? (
            <p className="text-[11px] text-sand-600">{t("graphCover.composerNoSection")}</p>
          ) : (
            <label className="flex items-center gap-1.5 text-[11px] text-sand-600">
              {t("graphCover.composerSection")}
              <select
                value={chosen?.id ?? ""}
                onChange={(e) => gather.setSectionId(e.target.value)}
                data-track="graph-note-gather-section"
                className="min-w-0 flex-1 rounded-full border border-line bg-card px-2 py-0.5 text-[11.5px] text-ink"
              >
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ul data-graph-note-gather-quotes className="flex max-h-[168px] flex-col gap-1 overflow-y-auto overscroll-contain">
            {gather.quotes.map((q) => (
              <li key={keyOf(q)} data-graph-note-gather-quote={q.documentId} className="flex items-start gap-1.5 rounded-xl bg-sand-100 px-2 py-1">
                <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-sand-700">
                  <button
                    type="button"
                    onClick={() => {
                      router.push(`/n/${notebookId}?doc=${q.documentId}${q.blockId ? `&block=${q.blockId}` : ""}`);
                      onOpenDocument();
                    }}
                    data-tip={t("graphCover.composerOpenQuote")}
                    className="mr-1 inline-block max-w-40 truncate rounded-full bg-sand-200 px-1.5 align-bottom text-[10.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                  >
                    {ctx.titleOf.get(q.documentId) ?? ""}
                  </button>
                  {q.whole ? <span className="font-semibold">¶ {q.text}</span> : clipWords(q.text, 140)}
                </span>
                <button
                  type="button"
                  onClick={() => gather.remove(q)}
                  aria-label={t("graphCover.composerRemove")}
                  data-tip={t("graphCover.composerRemove")}
                  data-track="graph-note-gather-quote-remove"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <textarea
            value={gather.content}
            onChange={(e) => gather.setContent(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (ime.isImeEnter(e) || isImeKey(e)) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void save();
              }
            }}
            placeholder={t("graphCover.composerPlaceholder")}
            aria-label={t("graphCover.composerPlaceholder")}
            rows={2}
            data-graph-note-gather-words
            className="resize-none rounded-xl bg-sand-100 px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-sand-500"
          />
          <span className="flex items-center justify-end gap-1.5">
            {error && (
              <span role="alert" className="mr-auto text-[11px] text-red-500">
                {error}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(t("graphCover.composerDiscardConfirm"))) return;
                gather.clear();
                setError(null);
                setSaved(null);
              }}
              data-track="graph-note-gather-discard"
              className={ACTION}
            >
              {t("graphCover.composerDiscard")}
            </button>
            <button
              type="submit"
              data-track="graph-note-gather-save"
              disabled={gather.quotes.length === 0 || !chosen || busy}
              className={ACTION_ACCEPT}
            >
              {busy ? t("graphCover.composerSaving") : t("graphCover.composerSave")}
            </button>
          </span>
        </form>
      )}
    </div>
  );
}
