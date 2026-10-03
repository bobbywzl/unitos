"use client";

import { useRouter } from "next/navigation";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SourceChip } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { Highlight } from "@/components/highlight";
import { ChevronDownIcon, ChevronRightIcon, CommentIcon, LocateIcon, PencilIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { markdownPreview } from "@/lib/markdown-preview";
import { useGist } from "@/lib/gist-client";
import { useMergeTarget, type HandleProps } from "@/components/sortable";
import { quoteLanded, useNoteDrop } from "@/components/use-note-drop";
import { referenceMarkdownForDrop } from "@/components/outline/reference-drop";
import { quoteMarkdown } from "@/lib/quote-drag";
import { useAnnotationSide } from "@/components/outline/annotation-side";
import { imageMarkdown } from "@/lib/images";
import { linkMarkdown } from "@/lib/note-links";
import { setTaskChecked } from "@/lib/note-markup";
import { appendToBody, bodyLineOffset, editDraft, splitNote } from "@/lib/note-title";
import { searchHit } from "@/lib/search-hits";
import type { CardDragEndDetail } from "@/lib/card-drag";
import { useCardDropTarget } from "@/components/outline/use-card-drop";
import { ThinkingIndicator } from "@/components/thinking";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteHistory } from "@/components/outline/note-history";
import { NoteId } from "@/components/outline/note-id";
import { NoteTitleField, focusBodyEditor, useNoteParts } from "@/components/outline/note-title-field";
import { SaveStateLabel } from "@/components/outline/save-state";
import { useNoteDraft } from "@/components/outline/use-note-draft";
import { NoteAssistant } from "@/components/outline/note-assistant";
import { WordLine } from "@/components/outline/word-line";
import { NOTE_ABSORBED_EVENT, type OutlineActions } from "@/components/outline/use-outline";

/** The nearest ancestor that scrolls: the tray's panel. Null on the notes full page, where the window scrolls. */
function scrollPane(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

/** Where the card renders: the 352px tray drawer (design 1a), the 760px notes
    full page column (design 2b), or one pane of the compare view, which draws
    the surface around the card itself. */
type Variant = "tray" | "page" | "pane";

// One padding per variant, the same in every state — open, collapsed, editing —
// so the note keeps its shape when the editor opens and when Done closes it.
const PADDING: Record<Variant, string> = {
  tray: "p-3.5",
  page: "px-[18px] py-4",
  pane: "px-5 py-4",
};

function PinIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" fill="none" strokeWidth="2" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </svg>
  );
}

function TickIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AnchorIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="3" />
      <path d="M12 22V8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

// One note. Every state shares one structure: the header row — collapse
// chevron and id at the left; edit, jump, pin, and select at the right — then
// the title, the body, and the actions. Collapsed, the header row is the whole
// card: the id and the title, or the gist when the note has no title.
//
// A note has two modes (SPEC.md §6):
// - Draggable, the default: a hold anywhere on the card picks the note up
//   (components/hold-sensor.ts) — to reorder it, to move it to another
//   section, to hold it over another note until the ring closes and merge
//   the two, or, in the tray, to drop it on the article and float it there.
// - Editing: the pencil opens the editor in place — the title field and the
//   body's editor at the same size. The editor keeps the press (a press in a
//   text field never drags, lib/hold-drag.ts, and neither do its bar and
//   its buttons); a hold on the header row still picks the note up, and the
//   card still takes every drop: an annotation or a quote lands in the
//   draft, a note held over it joins it once its draft is saved
//   (use-note-draft.ts).
export function NoteCard({
  note,
  actions,
  handle,
  variant = "page",
  search,
  nudge,
}: {
  note: NoteView;
  actions: OutlineActions;
  /** The board's drag listeners: with them, a hold anywhere on the card drags it. */
  handle?: HandleProps;
  variant?: Variant;
  /** The search the note was found by: the note shows whole and the matches light up. */
  search?: string;
  /** The onboarding nudge's target: the first note of the tray. */
  nudge?: boolean;
}) {
  // The card is drawn again only when what it shows changes: a selection, a
  // collapse, or a press on one card of a board leaves the other cards alone
  // (a notes full page of 135 notes took 200 ms to draw them all on a click).
  const commands = useCommands(actions);
  return (
    <NoteCardBody
      note={note}
      commands={commands}
      notebookId={actions.notebookId}
      focusedPending={actions.focusedPendingId === note.id}
      floating={actions.floating?.id === note.id}
      selected={actions.selected.has(note.id)}
      merging={actions.merging.has(note.id)}
      collapsedInView={actions.isCollapsed(note.id)}
      viewExpanded={actions.notesView === "expanded"}
      editRequest={actions.editRequest?.id === note.id ? actions.editRequest : null}
      draggableHandle={Boolean(handle)}
      listeners={handle?.listeners}
      variant={variant}
      search={search}
      nudge={nudge}
    />
  );
}

/** What a card runs on the outline: the commands of its buttons and drops. */
type NoteCommands = Pick<
  OutlineActions,
  | "attachSource"
  | "attachAnnotationSources"
  | "mergeNotes"
  | "toggleCollapsed"
  | "saveNote"
  | "stopMerge"
  | "setPinned"
  | "toggleSelect"
  | "dockNote"
  | "acceptNote"
  | "rejectNote"
  | "removeNotes"
>;

/** The outline's commands as one object for the card's life, each calling
    the latest outline's own: a new outline on every change would draw every
    card again. They run from events and effects, never while drawing. */
function useCommands(actions: OutlineActions): NoteCommands {
  const latest = useRef(actions);
  useLayoutEffect(() => {
    latest.current = actions;
  });
  return useMemo<NoteCommands>(
    () => ({
      attachSource: (...args) => latest.current.attachSource(...args),
      attachAnnotationSources: (...args) => latest.current.attachAnnotationSources(...args),
      mergeNotes: (...args) => latest.current.mergeNotes(...args),
      toggleCollapsed: (...args) => latest.current.toggleCollapsed(...args),
      saveNote: (...args) => latest.current.saveNote(...args),
      stopMerge: (...args) => latest.current.stopMerge(...args),
      setPinned: (...args) => latest.current.setPinned(...args),
      toggleSelect: (...args) => latest.current.toggleSelect(...args),
      dockNote: (...args) => latest.current.dockNote(...args),
      acceptNote: (...args) => latest.current.acceptNote(...args),
      rejectNote: (...args) => latest.current.rejectNote(...args),
      removeNotes: (...args) => latest.current.removeNotes(...args),
    }),
    [],
  );
}

// Expand all on a notes full page of 135 notes drew every body in one frame:
// 260 ms before the press showed anything. Under Expand all, a card in view
// or near it opens at once and a card out of view opens a few frames later,
// the nearest first, CARDS_A_FRAME a frame. In the folded view, a card
// opened by its chevron shows whole at once, wherever it is.
const NEAR_PX = 300;
const CARDS_A_FRAME = 10;
type StagedCard = { distance: number; open: () => void };
let stagedCards: StagedCard[] = [];
let stagedFrame = 0;

function openStagedCards() {
  stagedFrame = 0;
  for (const card of stagedCards.splice(0, CARDS_A_FRAME)) card.open();
  if (stagedCards.length > 0) stagedFrame = requestAnimationFrame(openStagedCards);
}

// A folded card forgets that it was open, so the next Expand all opens it
// in its turn again: all together, a moment after the fold has shown.
let foldedCards: (() => void)[] = [];
let foldedTimer = 0;

function forgetLater(forget: () => void): () => void {
  foldedCards.push(forget);
  if (!foldedTimer) {
    foldedTimer = window.setTimeout(() => {
      foldedTimer = 0;
      const now = foldedCards;
      foldedCards = [];
      for (const f of now) f();
    }, 300);
  }
  return () => {
    foldedCards = foldedCards.filter((f) => f !== forget);
  };
}

function stageCard(distance: number, open: () => void): () => void {
  const card = { distance, open };
  stagedCards.push(card);
  stagedCards.sort((a, b) => a.distance - b.distance);
  if (!stagedFrame) stagedFrame = requestAnimationFrame(openStagedCards);
  return () => {
    stagedCards = stagedCards.filter((c) => c !== card);
  };
}

/** Whether the card shows whole: it folds at once; it opens at once when
    it is in view or the view does not expand every card, and else when its
    turn comes. */
function useStagedOpen(open: boolean, staged: boolean, ref: React.RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open || !shown) return;
    return forgetLater(() => setShown(false));
  }, [open, shown]);
  const waiting = open && !shown;
  useLayoutEffect(() => {
    if (!waiting) return;
    const r = staged ? ref.current?.getBoundingClientRect() : undefined;
    const distance = r ? Math.max(0, r.top - window.innerHeight, -r.bottom) : 0;
    if (distance <= NEAR_PX) {
      setShown(true);
      return;
    }
    return stageCard(distance, () => setShown(true));
  }, [waiting, staged, ref]);
  return open && shown;
}

const NoteCardBody = memo(function NoteCardBody({
  note,
  commands,
  notebookId,
  focusedPending,
  floating,
  selected: isSelected,
  merging,
  collapsedInView,
  viewExpanded,
  editRequest,
  draggableHandle,
  listeners,
  variant,
  search,
  nudge,
}: {
  note: NoteView;
  commands: NoteCommands;
  notebookId: string;
  /** The keyboard queue's pending note. */
  focusedPending: boolean;
  /** This note is out in the floating card (floating-note-editor.tsx). */
  floating: boolean;
  /** Selected on the ticker. */
  selected: boolean;
  /** The AI is writing the note that takes this one and the merged notes'
      place (the ticker's Merge with AI). The card blooms as the merge
      starts and settles as the text lands (globals.css .note-absorb /
      .note-merging / .note-merged). */
  merging: boolean;
  /** The notes view folds this note to one line. */
  collapsedInView: boolean;
  /** The notes view shows every note whole (Expand all). */
  viewExpanded: boolean;
  /** Open the editor: the keyboard queue's `e`, or the floating card docking. */
  editRequest: { id: string; draft?: string } | null;
  draggableHandle: boolean;
  listeners: HandleProps["listeners"];
  variant: Variant;
  search?: string;
  nudge?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit, premium, shared, people } = useCollab();
  // The notes full page: an annotation reference opens the annotation beside
  // the note (annotation-side.tsx). Elsewhere it opens the reader.
  const annotationSide = useAnnotationSide();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  // The note's own history, open under the note (note-history.tsx).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [handledEdit, setHandledEdit] = useState<{ id: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const mergeTarget = useMergeTarget();
  const pending = note.status === "PENDING";
  const focused = pending && focusedPending;
  const tray = variant === "tray";
  const pane = variant === "pane";
  // The ticker: accepted notes can be selected for bulk delete, merge, pin, and compare.
  const selectable = note.status === "ACCEPTED" && canEdit && !pane;
  // The dragged card covers this one: the ring says a hold here merges them.
  const isMergeTarget = mergeTarget === note.id && note.status === "ACCEPTED";
  // The note's title and body (SPEC.md §6, lib/note-title.ts).
  const parts = useMemo(() => splitNote(note.content), [note.content]);
  // The search the note was found by: the note shows whole, and the words
  // the search found light up (lib/search-hits.ts).
  const searching = Boolean(search?.trim());
  const hit = searchHit(search);

  // An annotation dragged out of the Annotations tab, or off its card over the
  // article, lands here as an annotation reference at the end of the note
  // (lib/annotation-reference.ts), and it stays painted in the article
  // (SPEC.md §6). A highlight held in the reader's text lands as a quote at
  // the end of the note, its anchor a source (lib/card-drag.ts). A note the
  // reader cannot edit, and one not accepted yet, take no drop: the merge is
  // for the notes being kept.
  const takesDrop = canEdit && note.status === "ACCEPTED" && !floating;
  async function takeDrop(end: CardDragEndDetail) {
    if (!takesDrop) return;
    try {
      const { drag } = end;
      if (drag.kind === "quote") {
        if (!drag.quote) return;
        quoteLanded();
        await addToNote(quoteMarkdown(drag.quote.text));
        await commands.attachSource(note.id, drag.quote);
        return;
      }
      if (drag.kind === "annotation") {
        if (!drag.reference) return;
        await addToNote(await referenceMarkdownForDrop(notebookId, drag.reference, t));
        // The quote it landed points back to the reader: the annotation's
        // anchors become sources of the note.
        if (drag.reference.quote) await commands.attachAnnotationSources(note.id, drag.reference.annotationId);
        return;
      }
      await commands.mergeNotes(note.id, drag.ids, "join");
    } catch (err) {
      setDropError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }
  const cardDrop = useCardDropTarget(note.id, (end) => void takeDrop(end), takesDrop);
  const [wasMerging, setWasMerging] = useState(false);
  const [merged, setMerged] = useState(false);
  if (merging !== wasMerging) {
    setWasMerging(merging);
    setMerged(!merging);
  }
  useEffect(() => {
    if (!merged) return;
    const timer = setTimeout(() => setMerged(false), 500);
    return () => clearTimeout(timer);
  }, [merged]);
  // This note took other notes in (a join): it blooms once as they land.
  const [absorbed, setAbsorbed] = useState(false);
  useEffect(() => {
    const onAbsorbed = (e: Event) => {
      if ((e as CustomEvent<{ noteId: string }>).detail.noteId === note.id) setAbsorbed(true);
    };
    window.addEventListener(NOTE_ABSORBED_EVENT, onAbsorbed);
    return () => window.removeEventListener(NOTE_ABSORBED_EVENT, onAbsorbed);
  }, [note.id]);
  useEffect(() => {
    if (!absorbed) return;
    const timer = setTimeout(() => setAbsorbed(false), 600);
    return () => clearTimeout(timer);
  }, [absorbed]);

  // Accepted notes collapse to one line; pending notes are read before they are
  // accepted, a compare pane exists to show the note whole, and a search shows
  // every note it found whole.
  const foldable = note.status === "ACCEPTED" && !pane;
  const collapsed = !useStagedOpen(!(foldable && !searching && collapsedInView), viewExpanded, cardRef);
  // The collapsed row's line (SPEC.md §6): the note's title; without one,
  // the gist, its first words until the gist arrives. The floating
  // placeholder shows the same line.
  const preview = useMemo(() => markdownPreview(note.content), [note.content]);
  const gist = useGist(note.id, note.gist, preview, (collapsed || floating) && !parts.title);
  const line = parts.title || gist;
  // The source the card jumps to: the reader opens on the document and
  // flashes the quote — the exact position the note came from.
  const jumpSource = note.sources.find((s) => !s.orphaned) ?? null;

  // A jump to this note (an issue card, the workspace's show-note choreography)
  // opens a collapsed note, so the jump lands on the note whole.
  useEffect(() => {
    if (!collapsed) return;
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ noteId: string }>).detail.noteId === note.id) commands.toggleCollapsed(note.id);
    };
    window.addEventListener("dissect:open-note", onOpen);
    return () => window.removeEventListener("dissect:open-note", onOpen);
  }, [collapsed, note.id, commands]);

  // Auto-save while the editor is open (SPEC.md §6); Cancel restores the
  // content from before this edit.
  const { draft, setDraft, cancel: cancelDraft, markSaved, confirmSaved, saveState, getOriginal } = useNoteDraft({
    noteId: note.id,
    original: note.content,
    initial: note.content,
    active: editing,
    canEdit,
  });
  // The draft as the editor holds it: the title field and the body's editor
  // each edit their own part (note-title-field.tsx).
  const { parts: edit, setTitle: editTitle, setBody: editBody } = useNoteParts(draft, setDraft);

  // Keyboard queue: `e` on the focused pending note opens the editor; the
  // floating card docking reopens it on the card's draft. Adjust-during-render;
  // each request is a new object.
  if (editRequest && handledEdit !== editRequest) {
    setHandledEdit(editRequest);
    if (!floating) {
      setDraft(editRequest.draft ?? editDraft(note.content));
      setEditing(true);
    }
  }

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  // The editor shows as much of the note as it can (SPEC.md §6): the card
  // grows with the text, capped at the height of the pane it scrolls in, and
  // past the cap the text scrolls inside the card while the bar and the
  // buttons stay. The pane is the tray's panel; on the notes full page it is
  // the window.
  const editCardRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!editing) return;
    const card = editCardRef.current;
    if (!card) return;
    const measure = () => {
      const pane = scrollPane(card);
      setLimit(pane ? pane.clientHeight - 8 : window.innerHeight - 48);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      setLimit(null);
    };
  }, [editing]);
  // Sized: the whole card comes into view.
  const sized = editing && limit !== null;
  useEffect(() => {
    if (sized) editCardRef.current?.scrollIntoView({ block: "nearest" });
  }, [sized]);

  // After Done or Cancel the caret goes back to the note's pencil, where
  // the edit began, not to whatever control comes first in the card.
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    cardRef.current?.querySelector<HTMLElement>('[data-track="note-edit"]')?.focus({ preventScroll: true });
  }, [editing]);

  function cancel() {
    cancelDraft();
    refocus.current = true;
    setEditing(false);
  }

  // Done closes the editor; the content is already saved by then.
  async function done() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === getOriginal()) {
      cancel();
      return;
    }
    markSaved(trimmed);
    refocus.current = true;
    setEditing(false);
    await commands.saveNote(note.id, trimmed);
    confirmSaved(trimmed);
  }

  function openEditor() {
    setDraft(editDraft(note.content));
    setEditing(true);
  }

  // An image or a link dropped on the note goes into the note (SPEC.md §6,
  // §16): into the draft while the editor is open, else added and saved.
  async function addToNote(markdown: string) {
    setDropError(null);
    if (editing) {
      const base = edit.body.replace(/\s+$/, "");
      editBody(base ? `${base}\n\n${markdown}\n` : `${markdown}\n`);
      return;
    }
    await commands.saveNote(note.id, appendToBody(note.content, markdown));
  }
  const noteDrop = useNoteDrop({
    premium,
    enabled: canEdit && !floating,
    t,
    onError: setDropError,
    onImages: (images) => addToNote(images.map((i) => imageMarkdown(i.id, i.name)).join("\n\n")),
    onLinks: (links) => addToNote(links.map(linkMarkdown).join("\n\n")),
    // A quote dropped on the card outside its editor: added at the end, its
    // source attached, so it points back (lib/quote-drag.ts). Inside the
    // editor the text takes the drop itself, at the caret.
    onQuote: async (drag) => {
      quoteLanded();
      await addToNote(quoteMarkdown(drag.text));
      await commands.attachSource(note.id, drag);
    },
  });
  const dropRing = noteDrop.over ? " outline-2 outline-dashed outline-clay-400" : "";
  const dropTip =
    noteDrop.over === "images"
      ? t("panes.dropImageIntoNote")
      : noteDrop.over === "links"
        ? t("outline.dropLinkIntoNote")
        : noteDrop.over === "quote"
          ? t("outline.dropQuoteIntoNote")
          : undefined;

  // The chips under the note: only the sources no quote in the body points
  // back to (lib/notes/quote-sources.ts); a quote carries its own source.
  const collapseLabel = collapsed ? t("outline.expandNote") : t("outline.collapseNote");
  // Who wrote the note, on a shared project (SPEC.md §12): every note says
  // it, one's own included, so a collaborator reads the author at a glance.
  const author = shared && note.createdById ? people[note.createdById] : undefined;

  // Jump to the source: the reader opens on the document and flashes the
  // quote — the link between note and quote works both ways.
  function jumpTo(source: SourceChip) {
    window.getSelection()?.removeAllRanges();
    router.push(`/n/${notebookId}?doc=${source.documentId}&src=${source.id}`);
    // Already on that document with ?src set: the push changes nothing, so
    // flash the mark directly.
    window.dispatchEvent(
      new CustomEvent("dissect:flash-source", { detail: { sourceId: source.id } }),
    );
  }

  // Draggable mode: the board's listeners on the whole card, so a hold
  // anywhere picks the note up — while editing, a hold on the header row,
  // since the editor's fields, its bar, and its buttons keep their press.
  // Never while the AI is merging into it, never while it floats, and never
  // for a viewer.
  const draggable = draggableHandle && canEdit && !merging && !floating;
  const dragProps = draggable
    ? {
        ...(listeners ?? {}),
        // The browser's own drag of a link or a picture in the note would
        // take the hold.
        onDragStart: (e: React.DragEvent) => e.preventDefault(),
        style: { touchAction: "pan-y" as const },
      }
    : {};

  // The header row, the same in every state: collapse chevron and id at the
  // left; edit, jump, pin, and select at the right. Collapsed, the title (or
  // the gist) and the source count sit between them.
  const header = (
    <div className="flex min-h-[18px] items-center gap-1.5">
      {foldable && !editing && !merging && (
        <button
          onClick={() => commands.toggleCollapsed(note.id)}
          data-track="note-collapse"
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          data-tip={collapseLabel}
          className="-ml-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-sand-400 hover:bg-clay-100 hover:text-clay-800"
        >
          {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
        </button>
      )}
      <NoteId id={note.id} />
      {/* The AI is writing the note that takes this one and the merged notes'
          place (SPEC.md §6). It takes the row: the line is about to be
          rewritten, and every control here acts on a note still being
          written. */}
      {merging && (
        <ThinkingIndicator
          label={t("outline.merging")}
          className="min-w-0 flex-1 text-[11px]"
          onStop={() => commands.stopMerge(note.id)}
          stopTitle={t("outline.mergeStopTitle")}
        />
      )}
      {/* The line ends at the last whole word that fits (word-line.tsx):
          the row can be narrower than the gist's budget beside a source
          count. A press opens the note whole. */}
      {collapsed && !merging && (
        <button
          onClick={() => commands.toggleCollapsed(note.id)}
          data-track="note-collapse"
          data-tip={t("outline.expandNote")}
          className={`note-merging-under min-w-0 flex-1 text-left text-[13px] leading-[18px] hover:text-clay-800 ${
            parts.title ? "font-semibold text-ink" : "text-sand-800"
          }`}
        >
          <WordLine text={line} />
        </button>
      )}
      {collapsed && note.sources.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500"
          data-tip={note.sources.map((s) => s.documentTitle).join(", ")}
        >
          <AnchorIcon />
          {note.sources.length}
        </span>
      )}
      {collapsed && note.replies.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500"
          data-tip={t("outline.repliesTitle", { n: note.replies.length })}
        >
          <CommentIcon size={11} />
          {note.replies.length}
        </span>
      )}
      {collapsed && author && <PersonBadge person={author} size={14} />}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* The save state, while editing (SPEC.md §6). */}
        {editing && <SaveStateLabel state={saveState} />}
        {canEdit && !editing && !merging && (
          <button
            onClick={openEditor}
            data-track="note-edit"
            aria-label={t("outline.editTitle")}
            data-tip={t("outline.editTitle")}
            // The pencil is the note's main action, so it is the big one in
            // the row: a filled 28px button with a 16px pencil (SPEC.md §6).
            className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-clay-800 hover:bg-clay-200"
          >
            <PencilIcon size={16} />
          </button>
        )}
        {jumpSource && !editing && !merging && (
          <button
            onClick={() => jumpTo(jumpSource)}
            data-track="note-jump"
            aria-label={t("panels.jumpToAnchor")}
            data-tip={t("panels.jumpToAnchor")}
            className="flex size-[18px] items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            <LocateIcon size={11} />
          </button>
        )}
        {note.pinned && !merging && (
          <button
            onClick={() => canEdit && void commands.setPinned(note.id, false)}
            data-track="note-unpin"
            data-tip={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
            aria-label={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
            className="text-clay hover:text-clay-600"
          >
            <PinIcon />
          </button>
        )}
        {selectable && !editing && !merging && (
          <button
            onClick={() => commands.toggleSelect(note.id)}
            data-track="note-select"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={t("outline.selectNote")}
            data-tip={t(tray ? "outline.selectNoteTitle" : "outline.selectNoteTitleCompare")}
            className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${
              isSelected
                ? "border-clay bg-clay text-clay-fg opacity-100"
                : "border-sand-400 bg-card text-transparent opacity-50 hover:border-clay-500 hover:opacity-100"
            }`}
          >
            <TickIcon />
          </button>
        )}
      </span>
    </div>
  );

  if (floating) {
    return (
      <div
        data-note-id={note.id}
        className="rounded-2xl border border-dashed border-clay-300 bg-card/60 p-3.5 text-[13px]"
      >
        <div className="flex items-center gap-2">
          <span className="text-sand-600">{t("outline.floatingLabel")}</span>
          <button
            onClick={() => commands.dockNote(true)}
            data-track="note-dock"
            data-tip={t("outline.dockBackTitle")}
            className="ml-auto shrink-0 text-xs text-sand-600 hover:text-clay-700"
          >
            {t("outline.dockBack")}
          </button>
        </div>
        <p className={`mt-1 leading-[18px] ${parts.title ? "font-semibold text-ink" : "text-sand-500"}`}>
          <WordLine text={line} />
        </p>
      </div>
    );
  }

  if (editing) {
    // The editing card takes the same drops as the card at rest (SPEC.md
    // §6): an annotation or a quote lands in the draft (addToNote), a note
    // joins once the draft is saved (use-outline.ts mergeNotes). The ring
    // turns sage while a card is held over it. The same hold drags it, on
    // the header row.
    return (
      <div
        ref={editCardRef}
        data-note-id={note.id}
        data-note-editing=""
        data-note-drop-target={takesDrop ? note.id : undefined}
        {...noteDrop.handlers}
        {...dragProps}
        style={{ ...(draggable ? { touchAction: "pan-y" as const } : {}), ...(limit !== null ? { maxHeight: limit } : {}) }}
        data-tip={
          dropTip ??
          (cardDrop.over
            ? t(
                cardDrop.drag?.kind === "annotation"
                  ? "outline.dropAnnotation"
                  : cardDrop.drag?.kind === "quote"
                    ? "outline.dropQuoteIntoNote"
                    : "outline.dropNote",
              )
            : isMergeTarget
              ? t("outline.holdToMerge")
              : undefined)
        }
        className={`flex flex-col ${pane ? "outline-2 -outline-offset-2" : "rounded-2xl bg-card shadow-soft outline-2"} ${
          cardDrop.over || isMergeTarget ? "outline-sage-500" : "outline-clay-400"
        } ${PADDING[variant]}${dropRing}`}
      >
        {header}
        {dropError && <p className="mt-1 text-[11px] text-red-500">{dropError}</p>}
        {/* The bar, then the title field, then the body (SPEC.md §6). */}
        <NoteEditor
          className="mt-2 min-h-0 flex-1"
          value={edit.body}
          onChange={editBody}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void done();
            if (e.key === "Escape") cancel();
          }}
          full={!tray}
          moreHref={tray ? `/n/${notebookId}/notes` : undefined}
          onQuoteDrop={(drag) => commands.attachSource(note.id, drag)}
          title={
            <NoteTitleField
              value={edit.title}
              onChange={editTitle}
              onEnter={() => focusBodyEditor(editCardRef.current)}
              onEscape={cancel}
              className="shrink-0"
            />
          }
        />
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <button
            data-no-drag
            onClick={() => void done()}
            data-track="note-save"
            className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          >
            {t("common.done")}
          </button>
          <button
            data-no-drag
            onClick={cancel}
            data-track="note-cancel"
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
        </div>
        {/* The note's assistant (SPEC.md §6), docked at the bottom: a change
            it proposes lands in the draft on Apply. */}
        {canEdit && <NoteAssistant noteId={note.id} draft={draft} onApply={setDraft} className="mt-2.5" />}
      </div>
    );
  }

  // Pending notes are outlined when focused and dimmed when they are further down
  // the queue, so the one the keyboard acts on is unmistakable (design 1a).
  const surface = [
    "group/note relative",
    pane ? "" : "rounded-2xl bg-card shadow-soft",
    PADDING[variant],
    focused ? "outline-2 outline-clay-400" : "",
    pending && !focused ? (tray ? "opacity-82" : "opacity-85") : "",
    isMergeTarget ? "outline-2 outline-sage-500" : isSelected ? "outline-2 outline-clay-300" : "",
    merging ? "note-merging note-absorb" : "",
    absorbed ? "note-absorb note-merged" : merged ? "note-merged" : "",
    noteDrop.over ? "outline-2 outline-dashed outline-clay-400" : "",
    cardDrop.over ? "outline-2 outline-sage-500" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Double-click the card opens its editor (SPEC.md §6). Clicks on controls
  // and text selection inside fields stay theirs.
  function editOnDoubleClick(e: React.MouseEvent) {
    if ((e.target as Element).closest("button, a, textarea, input, select")) return;
    if (canEdit) openEditor();
  }

  // The body's line a checklist item is on, counted in the whole note: the
  // title and its blank line come before the body.
  const lineOffset = bodyLineOffset(note.content);

  return (
    <div
      ref={cardRef}
      data-note-id={note.id}
      data-note-drop-target={takesDrop ? note.id : undefined}
      // The onboarding nudges on the first note (components/nudges.tsx): a
      // ghost card slides onto the note below and joins it, then one slides
      // out of the tray onto the article.
      data-nudge={nudge && draggable ? "merge float" : undefined}
      onDoubleClick={editOnDoubleClick}
      {...noteDrop.handlers}
      {...dragProps}
      className={surface}
      data-tip={
        dropTip ??
        (cardDrop.over
          ? t(
              cardDrop.drag?.kind === "annotation"
                ? "outline.dropAnnotation"
                : cardDrop.drag?.kind === "quote"
                  ? "outline.dropQuoteIntoNote"
                  : "outline.dropNote",
            )
          : isMergeTarget
            ? t("outline.holdToMerge")
            : draggable
              ? t(tray ? "outline.holdToDrag" : "outline.holdToDragPage")
              : undefined)
      }
    >
      {header}
      {dropError && <p className="mt-1 text-[11px] text-red-500">{dropError}</p>}

      {!collapsed && (
        <div className="note-body mt-1.5">
          {parts.title && (
            <h3 className="note-title mb-1">
              <Highlight text={parts.title} needle={hit} />
            </h3>
          )}
          {/* A checklist item's box ticks without opening the editor. */}
          {parts.body.trim() !== "" && (
            <Markdown
              breaks
              highlight={hit}
              sources={note.sources}
              notebookId={notebookId}
              onAnnotationReference={annotationSide ? annotationSide.open : undefined}
              onToggleTask={
                canEdit
                  ? (line, checked) =>
                      void commands.saveNote(note.id, setTaskChecked(note.content, line + lineOffset, checked))
                  : undefined
              }
            >
              {parts.body}
            </Markdown>
          )}
          {author && (
            <div className="mt-1.5">
              <span className="inline-flex max-w-40 items-center gap-1 text-[11px] text-sand-600" data-tip={author.name}>
                <PersonBadge person={author} size={15} />
                <span className="truncate">{author.name}</span>
              </span>
            </div>
          )}
          <ReplyThread target={{ noteId: note.id }} replies={note.replies} />
        </div>
      )}

      {collapsed || (pending && !canEdit) ? null : pending ? (
        // Tray: buttons on their own row (design 1a). Page: Accept pushed right
        // (design 2b). No source chips: the header's jump button reaches the
        // source, and a quote in the note carries its own.
        <div className={`${tray ? "mt-3" : "mt-2.5"} flex flex-wrap items-center gap-2`}>
          <button
            onClick={() => void commands.acceptNote(note.id)}
            data-track="note-accept"
            className={`rounded-full bg-sage-600 px-3.5 py-1.5 text-xs font-semibold text-sage-fg hover:bg-sage-700 ${tray ? "" : "ml-auto"}`}
            data-tip={t("outline.acceptTitle")}
          >
            {t("common.accept")}
          </button>
          <button
            onClick={() => void commands.rejectNote(note.id)}
            data-track="note-reject"
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            data-tip={t("outline.rejectTitle")}
          >
            {t("common.reject")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(note.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            data-track="note-copy"
            className="text-xs text-sand-600 hover:text-clay-700"
            data-tip={t("outline.copyTitle")}
          >
            {copied ? t("outline.copied") : t("outline.copy")}
          </button>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            data-track="note-history"
            aria-expanded={historyOpen}
            data-tip={t("outline.historyTitle")}
            className={`text-xs hover:text-clay-700 ${historyOpen ? "text-clay-700" : "text-sand-600"}`}
          >
            {t("outline.history")}
          </button>
          {canEdit && (
            <button
              // No confirm: the note leaves at once, and the Undo pill offers
              // it back (SPEC.md §6).
              onClick={() => commands.removeNotes([note.id])}
              data-track="note-delete"
              data-tip={t("outline.deleteNoteTitle")}
              className="text-xs text-red-500 hover:text-red-700"
            >
              {t("common.delete")}
            </button>
          )}
        </div>
      )}
      {historyOpen && !collapsed && note.status === "ACCEPTED" && (
        <NoteHistory
          noteId={note.id}
          content={note.content}
          updatedAt={note.updatedAt}
          onRestore={canEdit ? (content) => commands.saveNote(note.id, content) : undefined}
        />
      )}
    </div>
  );
});
