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

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { MAX_NOTE_QUOTES } from "@/lib/anchors/note-quotes-limit";
import { readGatherDraft, writeGatherDraft, type GatherDraftQuote } from "@/lib/note-drafts";
import { refreshWhenOnline } from "@/lib/offline/queue";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { clipWords } from "@/lib/markdown-preview";
import { useCollab } from "@/components/collab/collab-context";
import { ChevronDownIcon, NotesIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { useGraphNotes } from "@/components/graph/graph-notes";
import { announceSavedLine, onOtherSavedLine } from "@/components/graph/saved-line"; // [ui5]

export type GatherQuote = GatherDraftQuote;

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
  full: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
};

const GatherContext = createContext<GatherValue | null>(null);

export function useNoteGather(): GatherValue | null {
  return useContext(GatherContext);
}

export function NoteGatherProvider({ notebookId, children }: { notebookId: string; children: React.ReactNode }) {
  const { myId, canEdit } = useCollab();
  // The graph renders in the browser only, so the draft is read at once.
  const [draft, setDraft] = useState(() =>
    typeof window === "undefined"
      ? { content: "", sectionId: null as string | null, quotes: [] as GatherQuote[] }
      : (readGatherDraft(myId, notebookId) ?? { content: "", sectionId: null, quotes: [] }),
  );
  const [open, setOpen] = useState(true);
  const update = useCallback(
    (next: (d: typeof draft) => typeof draft) =>
      setDraft((prev) => {
        const d = next(prev);
        writeGatherDraft(myId, notebookId, d);
        return d;
      }),
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
      setContent: (text) => update((d) => ({ ...d, content: text })),
      setSectionId: (id) => update((d) => ({ ...d, sectionId: id })),
      clear: () => update(() => ({ content: "", sectionId: null, quotes: [] })),
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
      disabled={blocked}
      aria-pressed={inNote}
      data-track={inNote ? "graph-note-gather-remove" : "graph-note-gather-add"}
      data-graph-add-to-note={inNote ? "in" : "out"}
      data-tip={blocked ? t("graphCover.composerFull", { n: MAX_NOTE_QUOTES }) : t(inNote ? "graphCover.addedToNoteTitle" : "graphCover.addToNoteTitle")}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold disabled:opacity-40 ${
        inNote ? "border-sage-400 bg-sage-100 text-sage-800" : "border-line bg-card text-sand-700 hover:bg-sage-100 hover:text-sage-800"
      } ${className}`}
    >
      <NotesIcon size={10} />
      {t(inNote ? "graphCover.addedToNote" : "graphCover.addToNote")}
    </button>
  );
}

/** The new note, docked at the foot of the side list: shown while it holds
    quotes or words, or just after a save. It tells the dialog its height
    (--graph-gather-h), so the side list ends above it. */
export function NoteGatherDock({ notebookId, onOpenDocument }: { notebookId: string; onOpenDocument: () => void }) {
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
  const drafting = Boolean(gather && (gather.quotes.length > 0 || gather.content));
  // A new quote after a save starts the next note: the saved line gives way.
  const savedLine = saved !== null && !drafting;
  const shown = drafting || savedLine;

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

  async function save() {
    if (!gather || !chosen || busy || gather.quotes.length === 0) return;
    setBusy(true);
    setError(null);
    const words = gather.content.trim();
    try {
      const note = await api<{ id: string; content: string } | { queued: true }>("/api/notes", "POST", {
        sectionId: chosen.id,
        ...(words ? { content: words } : {}),
        quotes: gather.quotes.map((q) => ({
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
      gather.clear();
      refreshWhenOnline(router);
    } catch (err) {
      // The draft stays in the browser: the quotes and the words are kept.
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  const frame =
    "graph-note-gather menu-in absolute z-20 flex flex-col gap-1.5 rounded-[20px] border border-sage-300 bg-card/95 p-3 shadow-float backdrop-blur-md right-3 bottom-3 w-[400px] max-w-[calc(100vw-24px)] max-[999px]:bottom-16";

  if (saved && savedLine) {
    return (
      <div ref={ref} data-graph-note-gather="saved" className={frame}>
        <p
          data-graph-note-gather-saved={savedId ?? ""}
          className="flex items-center gap-1.5 text-[12px] text-sage-700"
        >
          <NotesIcon size={12} />
          <span className="min-w-0 flex-1">
            {savedId ? t("graphCover.composerSaved", { section: saved.section }) : t("graphCover.composerQueued", { section: saved.section })}
          </span>
          {savedId && (
            <button
              onClick={() => ctx.showSaved(savedId) /* [ui5] VIEW5-10 */}
              data-track="graph-note-gather-show"
              className="rounded-full bg-sage-100 px-2 py-0.5 text-[11px] font-semibold text-sage-800 hover:bg-sage-200"
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
      </div>
    );
  }

  return (
    <div ref={ref} data-graph-note-gather={gather.open ? "open" : "folded"} data-track-surface="graph-note-gather" className={frame}>
      <div className="flex items-center gap-2">
        <NotesIcon size={13} />
        <p className="min-w-0 flex-1 truncate text-[12.5px]">
          <span className="font-semibold text-ink">{t("graphCover.composerTitle")}</span>
          <span data-graph-note-gather-summary className="text-sand-600"> · {summary}</span>
        </p>
        <button
          onClick={() => gather.setOpen(!gather.open)}
          aria-expanded={gather.open}
          aria-label={t(gather.open ? "graphCover.composerFold" : "graphCover.composerUnfold")}
          data-tip={t(gather.open ? "graphCover.composerFold" : "graphCover.composerUnfold")}
          data-track="graph-note-gather-fold"
          className="flex size-6 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          <ChevronDownIcon size={13} className={gather.open ? "" : "rotate-180"} />
        </button>
      </div>
      {gather.open && (
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
              }}
              data-track="graph-note-gather-discard"
              className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-sand-700 hover:bg-clay-100"
            >
              {t("graphCover.composerDiscard")}
            </button>
            <button
              type="submit"
              data-track="graph-note-gather-save"
              disabled={gather.quotes.length === 0 || !chosen || busy}
              className="rounded-full bg-sage-600 px-3 py-0.5 text-[11px] font-semibold text-sage-fg hover:bg-sage-700 disabled:opacity-40"
            >
              {busy ? t("graphCover.composerSaving") : t("graphCover.composerSave")}
            </button>
          </span>
        </form>
      )}
    </div>
  );
}
