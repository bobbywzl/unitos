"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isImeKey } from "@/lib/ime";
import { skipsDrag, watchHold } from "@/lib/hold-drag";
import {
  NOTE_WRAP_GAP as GAP,
  NOTE_WRAP_MIN_BESIDE as MIN_BESIDE,
  announceNoteWrap,
  type NoteWrapSpacer,
} from "@/lib/note-wrap";
import type { CardDragEndDetail } from "@/lib/card-drag";
import { imageMarkdown } from "@/lib/images";
import { linkMarkdown } from "@/lib/note-links";
import { markdownPreview } from "@/lib/markdown-preview";
import { editDraft, gistAsTitle, splitNote } from "@/lib/note-title";
import type { NoteView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PencilIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteId } from "@/components/outline/note-id";
import { NoteTitleField, focusBodyEditor, useNoteParts } from "@/components/outline/note-title-field";
import { SaveStateLabel } from "@/components/outline/save-state";
import { quoteLanded, useNoteDrop } from "@/components/use-note-drop";
import { referenceMarkdownForDrop } from "@/components/outline/reference-drop";
import { quoteMarkdown, type QuoteDrag } from "@/lib/quote-drag";
import { useCardDropTarget } from "@/components/outline/use-card-drop";
import { useNoteDraft } from "@/components/outline/use-note-draft";
import { NoteAssistant } from "@/components/outline/note-assistant";
import type { FloatingEdit, OutlineActions } from "@/components/outline/use-outline";

// A floating card: a note dragged out of the tray and put over the article,
// so the note is read and edited against the document it is about, with the
// tray folded away (workspace.tsx folds it as a card lands). Several notes
// can float at once, one card each. The card has the note's two modes, and
// only ever one of them (SPEC.md §6):
// - Draggable, the default: the note rendered — its title, its body, its
//   sources — and a hold anywhere on the card lifts it and moves it. A drop
//   on the tray or the rail docks it back.
// - Editing: the pencil opens the editor in the card — the title field and
//   the body's editor — with the tray's auto-save (use-note-draft.ts). Done
//   and Cancel return to the draggable mode; nothing drags meanwhile.
// The corner resizes the card (native handle) in both modes.
//
// The card takes drops (SPEC.md §6): a note from the notes tray held over it
// until the ring closes, or an annotation from the Annotations tab dropped on
// it, joins its text into the note. A note merged in is consumed; an
// annotation is copied, so its mark stays in the article. A link or an image
// dropped on the card goes into the note.
//
// The card covers no word of the document (SPEC.md §6). It stands in the
// document's scroll pane at a spot in the text, so it scrolls with the text.
// - Over an article, the article's lines flow around it: the card measures
//   the gap it needs and announces it (lib/note-wrap.ts), and the reader
//   draws it. The text keeps GAP from the card.
// - Over a page of the page editor, the page's lines are set by the page and
//   cannot flow, so the card stands beside the page, in the room the page
//   leaves when it moves to the pane's left (frame.css), clear of the page
//   editor's own cards where the pane has the room.
// As it lands, a card that would lie on the text moves to the free room
// beside the column when the pane has it, so the text keeps its full width.
// With no document open the card stays over the workspace.

const WIDTH = 460;
const MARGIN = 16;

/** The width a floating card opens at: WIDTH, or what the window leaves. */
export function floatingWidth(): number {
  return Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
}

/** Where a card dragged out lands: whole on screen. `left` is where the
    pointer would put it; the card shifts in from the edge when it would hang
    off. */
export function landingLeft(left: number): number {
  return Math.max(MARGIN, Math.min(left, window.innerWidth - floatingWidth() - MARGIN));
}
// The part of the card that stays on screen when it is dragged past an edge.
const KEEP = 96;
// The narrowest a card is drawn (the class's min-w).
const MIN_WIDTH = 300;
// How long a card that just landed follows the text under it while the
// tray folds and the article settles (a card over the workspace, with no
// document open).
const FOLLOW_MS = 1200;
// How long the column takes to settle after a card lands: the tray folds
// and the column moves to the pane's left (globals.css, 0.35s).
const SETTLE_MS = 420;
// How long after it lands a card takes its place again as the pane settles:
// the tray folds in steps (workspace.tsx), and the pane widens with each.
const LANDING_MS = 2500;
// A card beside the column stands this far from the text: past the wrap's
// own gap, so the article draws no gap for it.
const BESIDE = GAP + 2;
// The card pressed last, or landed last, stands over the other cards.
const FRONT_EVENT = "dissect:note-front";

type Pos = { left: number; top: number };

function clampPos(pos: Pos, width: number): Pos {
  return {
    left: Math.max(KEEP - width, Math.min(pos.left, window.innerWidth - KEEP)),
    top: Math.max(8, Math.min(pos.top, window.innerHeight - KEEP)),
  };
}

/** A wrapped card stays whole inside the pane's content: no sideways scroll for the pane. */
function clampContent(pos: Pos, pane: HTMLElement, width: number): Pos {
  return {
    left: Math.max(0, Math.min(pos.left, pane.clientWidth - width)),
    top: Math.max(8, Math.min(pos.top, Math.max(8, pane.scrollHeight - KEEP))),
  };
}

function surfaceRect(surface: string): DOMRect | null {
  const el = document.querySelector(`[data-track-surface="${surface}"]`);
  const rect = el?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect : null;
}

/** The tray's box on screen, or null while it is folded. Folded, the tray's
    column is inert and clips the tray to nothing; the tray's own box keeps its
    width, so the column is what says whether the tray is there. */
function trayRect(): DOMRect | null {
  const tray = document.querySelector('[data-track-surface="tray"]');
  if (!tray || tray.closest(".tray-column")?.hasAttribute("inert")) return null;
  const rect = tray.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}
/** The rail's box: the sidebar's column of buttons at the right edge. */
const railRect = () => surfaceRect("sidebar");

function inRect(x: number, y: number, r: DOMRect | null): boolean {
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Whether a point is in the sidebar (SPEC.md §6): the card dragged in here
    and let go goes back into the tray. On md and up the sidebar is the right
    column — the rail, and the tray when it is open — taken at its full
    height, so the whole right edge takes the drop, not the rail's 52px
    alone. Below md the rail is a bar along the bottom and the tray a sheet
    over it: their own boxes take the drop. */
function inSidebar(x: number, y: number): boolean {
  const rail = railRect();
  const tray = trayRect();
  if (!rail && !tray) return false;
  const column = rail ? rail.height > rail.width : true;
  if (!column) return inRect(x, y, rail) || inRect(x, y, tray);
  const left = Math.min(rail?.left ?? Infinity, tray?.left ?? Infinity);
  return x >= left && y >= 0 && y <= window.innerHeight;
}

/** Where the card lands: where the drag left it, else beside the tray. */
function landing(edit: FloatingEdit, width: number): Pos {
  if (edit.left !== undefined && edit.top !== undefined) {
    return clampPos({ left: edit.left, top: edit.top }, width);
  }
  const tray = trayRect();
  const edge = tray ? tray.left : window.innerWidth - 52;
  return clampPos({ left: edge - width - 24, top: 96 }, width);
}

/** The reader pane under a point, else the first pane. Null when no article is open. */
function findPane(x: number, y: number): HTMLElement | null {
  const panes = Array.from(document.querySelectorAll<HTMLElement>("[data-reader-root]"));
  return panes.find((p) => inRect(x, y, p.getBoundingClientRect())) ?? panes[0] ?? null;
}

/** A place on screen → the same place inside the pane's scrolled content. */
function toContent(pos: Pos, pane: HTMLElement): Pos {
  const r = pane.getBoundingClientRect();
  return { left: pos.left - r.left + pane.scrollLeft, top: pos.top - r.top + pane.scrollTop };
}

/** The text column a card must keep clear of, in the pane's content: an
    article's text (its lines flow around the card), or the page editor's
    page (its lines cannot flow). Null when the pane shows neither. */
function textColumn(pane: HTMLElement): { left: number; right: number; flows: boolean } | null {
  const origin = pane.getBoundingClientRect().left - pane.scrollLeft;
  const article = pane.querySelector<HTMLElement>("article.reader-prose");
  if (article) {
    const a = article.getBoundingClientRect();
    const style = getComputedStyle(article);
    return {
      left: a.left + parseFloat(style.paddingLeft) - origin,
      right: a.right - parseFloat(style.paddingRight) - origin,
      flows: true,
    };
  }
  const page = pane.querySelector<HTMLElement>("[data-docs-page]");
  if (!page) return null;
  const r = page.getBoundingClientRect();
  return { left: r.left - origin, right: r.right - origin, flows: false };
}

/** The cards the reader's tools stand beside the column: the page editor's
    column of comments and suggestions, and the tool cards and comment cards
    beside an article. They stand over a floating note (SPEC.md §6), so a
    note keeps clear of them. */
const PANE_CARDS =
  "[data-comment-card], [data-suggestion-card], [data-side-card], [data-log-card], [data-annotation-card]";

/** The pane's cards that stand level with the card, right of the column's
    left edge, in the pane's content: their right edge and their lowest
    bottom; null when none does. */
function cardsLevel(
  pane: HTMLElement,
  columnLeft: number,
  top: number,
  height: number,
): { right: number; bottom: number } | null {
  const paneRect = pane.getBoundingClientRect();
  const y0 = top - pane.scrollTop + paneRect.top;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of pane.querySelectorAll<HTMLElement>(PANE_CARDS)) {
    if (el.closest("[data-floating-note]")) continue;
    const r = el.getBoundingClientRect();
    const left = r.left - paneRect.left + pane.scrollLeft;
    if (r.width === 0 || r.bottom <= y0 || r.top >= y0 + height || left < columnLeft) continue;
    right = Math.max(right, left + r.width);
    bottom = Math.max(bottom, r.bottom - paneRect.top + pane.scrollTop);
  }
  return right === -Infinity ? null : { right, bottom };
}
const cardsRight = (pane: HTMLElement, columnLeft: number, top: number, height: number) =>
  cardsLevel(pane, columnLeft, top, height)?.right ?? null;

// A note with no room past the pane's cards goes under them, when that is
// no further down than this.
const UNDER_CARDS_MAX = 480;

/** Where a card stands clear of the text column and of the pane's cards,
    and how wide: beside the column, in the free room on its right, past the
    pane's cards level with it when the pane has room for both. Null when
    the card is clear already, or the pane has no room for it (an article's
    lines then flow around the card where it is). text: false leaves a card
    on an article's text where the reader put it, and moves it only off the
    pane's cards. */
function besideColumn(
  pane: HTMLElement,
  at: Pos,
  width: number,
  height: number,
  text = true,
): { left: number; width: number } | null {
  const column = textColumn(pane);
  if (!column) return null;
  const cards = cardsRight(pane, column.left, at.top, height);
  const onText = at.left < column.right + BESIDE && at.left + width > column.left - BESIDE;
  const onCards = cards !== null && at.left < cards + MARGIN && at.left + width > column.left;
  if (!(onText && (text || !column.flows)) && !onCards) return null;
  const end = pane.clientWidth - MARGIN;
  for (const from of [cards === null ? null : cards - BESIDE + MARGIN, column.right]) {
    if (from === null) continue;
    const left = Math.max(at.left, from + BESIDE);
    const room = end - (from + BESIDE);
    if (room >= width) return { left: Math.min(left, end - width), width };
    // A page's lines cannot flow: a narrower card beside the page beats a
    // card on its words.
    if (!column.flows && room >= MIN_WIDTH) return { left: from + BESIDE, width: Math.floor(room) };
    // An article's card that only met the pane's cards stays where it is
    // when there is no room past them.
    if (column.flows && !onText) return null;
  }
  return null;
}

/** The other floating cards of the pane, in the pane's content. */
function otherCards(pane: HTMLElement, id: string): { left: number; top: number; right: number; bottom: number }[] {
  const origin = pane.getBoundingClientRect();
  return Array.from(pane.querySelectorAll<HTMLElement>("[data-floating-note]"))
    .filter((el) => el.dataset.floatingNote !== id)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const left = r.left - origin.left + pane.scrollLeft;
      const top = r.top - origin.top + pane.scrollTop;
      return { left, top, right: left + r.width, bottom: top + r.height };
    });
}

/** The gap the article needs around the card, from both boxes on screen. Null:
    the card sits beside the text, or above all of it. */
function measureWrap(id: string, card: HTMLElement, pane: HTMLElement): NoteWrapSpacer | null {
  const article = pane.querySelector<HTMLElement>("article.reader-prose");
  if (!article) return null;
  const a = article.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const style = getComputedStyle(article);
  const textLeft = a.left + parseFloat(style.paddingLeft);
  const textRight = a.right - parseFloat(style.paddingRight);
  const contentTop = a.top + parseFloat(style.paddingTop);
  const textWidth = textRight - textLeft;
  if (textWidth <= 0) return null;
  if (c.right + GAP <= textLeft || c.left - GAP >= textRight) return null;
  // The spacers sit at the article's content top, so the gap is measured from
  // there: the card's top edge less its margin, and its whole height plus both
  // margins. A card that starts above the article keeps the part that overlaps.
  const top = Math.max(contentTop, c.top - GAP);
  const bottom = c.bottom + GAP;
  const height = bottom - top;
  if (height <= 0) return null;
  // The side whose gap is narrower keeps more text beside the card. Too little
  // room left beside it and the gap takes the whole column: the text skips below.
  const fromRight = textRight - (c.left - GAP);
  const fromLeft = c.right + GAP - textLeft;
  const side: "left" | "right" = fromRight <= fromLeft ? "right" : "left";
  let width = Math.min(textWidth, side === "right" ? fromRight : fromLeft);
  if (textWidth - width < MIN_BESIDE) width = textWidth;
  return {
    id,
    side,
    width: Math.round(width),
    offset: Math.round(top - contentTop),
    height: Math.round(height),
    column: Math.round(textWidth),
  };
}

export function FloatingNoteEditor({
  edit,
  note,
  actions,
  onDock,
}: {
  edit: FloatingEdit;
  /** The note as the project holds it; null once it is gone (deleted elsewhere). */
  note: NoteView | null;
  actions: OutlineActions;
  /** Docking opens the tray on notes, where the note's card takes the note back. */
  onDock: () => void;
}) {
  const t = useT();
  const { canEdit, premium } = useCollab();
  const cardRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(Boolean(edit.editing) && canEdit);
  const [dropError, setDropError] = useState<string | null>(null);
  const content = note?.content ?? edit.original;
  const { draft, setDraft, cancel, markSaved, confirmSaved, saveState, getOriginal } = useNoteDraft({
    noteId: edit.id,
    original: content,
    initial: edit.draft,
    active: editing,
    canEdit,
  });
  // The draft as the editor holds it: the title field and the body's editor
  // each edit their own part (note-title-field.tsx).
  const { parts, setTitle, setBody } = useNoteParts(draft, (next) => {
    setDraft(next);
    // The draft as typed, so docking can carry it (use-outline.ts).
    actions.floatingDraftChanged(edit.id, next);
  });
  // The note as it reads in the draggable mode.
  const shown = splitNote(content);
  // With no title of its own, the note's gist is its title (SPEC.md §6).
  const shownTitle = shown.title || gistAsTitle(note?.gist, markdownPreview(content));
  // The width is set as the card lands (and narrowed to stand beside a
  // page); after that the corner handle owns the card's size.
  const [width, setWidth] = useState(() => Math.min(WIDTH, window.innerWidth - 2 * MARGIN));
  // With no document open: the card's place on screen.
  const [pos, setPos] = useState<Pos>(() => landing(edit, width));
  // The pane the card stands in, and its place in that pane's content.
  const [pane, setPane] = useState<HTMLElement | null>(() => {
    const start = landing(edit, width);
    return findPane(start.left + width / 2, start.top + 40);
  });
  const [at, setAt] = useState<Pos>(() => {
    const start = landing(edit, width);
    const p = findPane(start.left + width / 2, start.top + 40);
    return p ? clampContent(toContent(start, p), p, width) : start;
  });
  // The card slides to its place beside the column (below).
  const [sliding, setSliding] = useState(false);
  // The card pressed last, or landed last, stands over the other cards.
  const [front, setFront] = useState(true);
  useEffect(() => {
    const onFront = (e: Event) => setFront((e as CustomEvent<string>).detail === edit.id);
    window.addEventListener(FRONT_EVENT, onFront);
    window.dispatchEvent(new CustomEvent(FRONT_EVENT, { detail: edit.id }));
    return () => window.removeEventListener(FRONT_EVENT, onFront);
  }, [edit.id]);
  // Lifted by a hold: where the pointer sits inside the card while it moves.
  const [grab, setGrab] = useState<{ dx: number; dy: number } | null>(null);
  // The lifted card is over the sidebar: let go, and the note goes back
  // into the tray. The card says so meanwhile.
  const [overSidebar, setOverSidebar] = useState(false);

  // The note is gone (deleted elsewhere): the card closes.
  const gone = note === null;
  useEffect(() => {
    if (gone) actions.dockNote(edit.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);

  // An image or a link dropped on the card goes into the note, like a drop
  // on its tray card (SPEC.md §6, §16): into the draft while editing, else
  // added and saved.
  async function addToNote(markdown: string) {
    setDropError(null);
    if (editing) {
      const base = parts.body.replace(/\s+$/, "");
      const next = base ? `${base}\n\n${markdown}\n` : `${markdown}\n`;
      setBody(next);
      actions.floatingDraftChanged(edit.id, next);
      return;
    }
    const base = shown.body.replace(/\s+$/, "");
    const body = base ? `${base}\n\n${markdown}` : markdown;
    await actions.saveNote(edit.id, shown.title ? `# ${shown.title}\n\n${body}` : body);
  }

  // Sources a quote dropped into the open editor attached in this sitting:
  // Cancel takes the quote's words back out, so it gives them up too.
  const sitting = useRef<string[]>([]);

  // A quote dropped on the card: into the draft while editing, its source
  // attached at once; else its words and its source in one write. The
  // selection and its toolbar go as the quote lands, as on a tray card.
  async function addQuote(drag: QuoteDrag) {
    quoteLanded();
    if (editing || !note) {
      await addToNote(quoteMarkdown(drag.text));
      if (note) sitting.current.push(...(await actions.attachSource(note.id, drag)));
      return;
    }
    setDropError(null);
    await actions.appendQuote(note.id, quoteMarkdown(drag.text), drag);
  }

  // A note dropped on the card joins its text into the note (SPEC.md §6).
  // The card's own words are saved first, so the merge reads what is on
  // screen; while editing, the merged text then takes the draft's place,
  // saved and ready to keep editing. An annotation dropped on the card lands
  // as an annotation reference at the end of the note
  // (lib/annotation-reference.ts); a highlight held in the reader's text
  // lands as a quote at the end, its anchor a source (lib/card-drag.ts).
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  async function takeDrop(end: CardDragEndDetail) {
    if (!canEdit || merging) return;
    setMergeError(null);
    if (end.drag.kind === "quote" || end.drag.kind === "annotation") {
      const { quote, reference } = end.drag;
      try {
        if (end.drag.kind === "quote" && quote) {
          await addQuote(quote);
        } else if (reference) {
          const markdown = await referenceMarkdownForDrop(actions.notebookId, reference, t);
          // The quote it landed points back to the reader: the annotation's
          // anchors become sources of the note, in the same write as the
          // reference when the note is not open.
          if (note && reference.quote && !editing) {
            await actions.appendAnnotation(note.id, markdown, reference.annotationId);
          } else {
            await addToNote(markdown);
            if (note && reference.quote) await actions.attachAnnotationSources(note.id, reference.annotationId);
          }
        }
      } catch (err) {
        setMergeError(err instanceof Error ? err.message : t("common.requestFailed"));
      }
      return;
    }
    setMerging(true);
    try {
      const current = draft.trim();
      if (editing && current && current !== getOriginal()) {
        markSaved(current);
        await actions.saveNote(edit.id, current);
        confirmSaved(current);
      }
      const merged = await actions.mergeNotes(edit.id, end.drag.ids, "join");
      if (!merged) {
        // The merge never ran: this note is not one that takes a drop — a note
        // still pending goes through Accept first. Saying so beats a drop that
        // looks taken and changes nothing.
        setMergeError(t("api.mergeAcceptedOnly"));
      } else if (editing) {
        markSaved(merged.content);
        setDraft(merged.content);
        actions.floatingDraftChanged(edit.id, merged.content);
        confirmSaved(merged.content);
      }
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setMerging(false);
    }
  }
  const cardDrop = useCardDropTarget(edit.id, (end) => void takeDrop(end), canEdit);

  function dock() {
    onDock();
    actions.dockNote(edit.id, editing);
  }

  // Back to the tray, from the editing row: the words typed stay, as Done
  // keeps them.
  function close() {
    void done();
    actions.dockNote(edit.id, false);
  }

  function openEditor() {
    if (!canEdit) return;
    setDraft(editDraft(content));
    setEditing(true);
  }

  // Cancel: the draft goes back; the card returns to its draggable mode.
  function cancelEdit() {
    // The pill offers the typed words back (SPEC.md §6).
    const typed = draft.trim();
    const back = cancel();
    if (note && typed && typed !== back.trim()) actions.editCanceled(note.id, typed, back);
    setEditing(false);
    const ids = sitting.current;
    sitting.current = [];
    if (note && ids.length > 0) void actions.dropSources(note.id, ids).catch(() => {});
  }

  // Done: the content is already saved by then; the card returns to its
  // draggable mode and stays where it is.
  async function done() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === getOriginal()) {
      cancelEdit();
      return;
    }
    markSaved(trimmed);
    setEditing(false);
    sitting.current = [];
    try {
      await actions.saveNote(edit.id, trimmed);
      confirmSaved(trimmed);
    } catch (err) {
      // The words stay on the card, marked Not saved (use-outline.ts), and
      // the local draft keeps them for the next load.
      setDropError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  const dockRef = useRef(dock);
  useEffect(() => {
    dockRef.current = dock;
  });

  // Lifted (by a hold anywhere on the card): the card follows the pointer;
  // dragged into the sidebar and let go, it docks — the note goes back into
  // the tray (SPEC.md §6).
  useEffect(() => {
    if (!grab) return;
    const onMove = (e: PointerEvent) => {
      const next = { left: e.clientX - grab.dx, top: e.clientY - grab.dy };
      const w = cardRef.current?.offsetWidth ?? width;
      if (pane) setAt(clampContent(toContent(next, pane), pane, w));
      else setPos(clampPos(next, w));
      setOverSidebar(inSidebar(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      setGrab(null);
      setOverSidebar(false);
      if (inSidebar(e.clientX, e.clientY)) {
        dockRef.current();
        return;
      }
      // Released over the article: the card settles whole on screen. A drag
      // may leave it hanging off the window's edge; a card the reader cannot
      // see whole is lost.
      if (!pane) setPos((p) => ({ left: landingLeft(p.left), top: p.top }));
      // Released on a page of the page editor: its lines cannot flow around
      // the card, so the card goes beside the page.
      else {
        const w = cardRef.current?.offsetWidth ?? width;
        const next = clampContent(toContent({ left: e.clientX - grab.dx, top: e.clientY - grab.dy }, pane), pane, w);
        home.current = next.left;
        wanted.current = { ...next, width: wanted.current.width };
        settleRef.current("clear", next);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [grab, width, pane]);

  // Where the reader left the card: the place it goes back to when the pane
  // widens again after narrowing under it (the tray opened and folded).
  const home = useRef<number | null>(null);
  // Where the reader let the card go, and the width it had: what its place
  // is worked out from, again each time the pane settles a step further.
  const wanted = useRef({ ...at, width });
  // The width a place gave the card (narrowed to stand beside a page); the
  // corner handle's own width is any other.
  const fitted = useRef<number | null>(null);
  // Until then the card takes its place again as the pane settles; a press
  // on the card ends it.
  const landingUntil = useRef(0);
  const slideTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(slideTimer.current), []);

  // The card takes a place where it covers no word and no other card
  // (SPEC.md §6). "land": as it lands. First the free room beside the
  // column, when the pane has it and the card lies on the text
  // (besideColumn), so the text keeps its full width; when another card
  // stands there, the spot the reader let it go at, where an article's
  // lines flow around it; else under the card it would lie on. "clear": a
  // card let go, a pane that narrowed, or one of the pane's cards opening
  // on it: a card on a page of the page editor goes beside the page, and a
  // card under one of the pane's cards moves past it; a card the reader put
  // on an article's text stays there. `from`: where the card would stand;
  // unset, where it stands.
  function settle(mode: "land" | "clear", from?: Pos) {
    const card = cardRef.current;
    if (!pane || !card) return;
    // The width the reader gave the card (the corner handle, below); a
    // width a place gave it may widen again.
    const w = wanted.current.width;
    const h = card.offsetHeight;
    const dropped = from ?? at;
    const column = textColumn(pane);
    const place = besideColumn(pane, dropped, w, h, mode === "land");
    let next = place ? { left: place.left, top: dropped.top } : dropped;
    // Clear of the text where it stands: a card a place narrowed takes back
    // the width the pane now has room for.
    let nextWidth = place
      ? place.width
      : Math.max(Math.min(card.offsetWidth, w), Math.min(w, pane.clientWidth - MARGIN - next.left));
    if (mode === "land") {
      const others = otherCards(pane, edit.id);
      const hit = (pos: Pos, width: number) =>
        others.find((o) => pos.left < o.right && pos.left + width > o.left && pos.top < o.bottom && pos.top + h > o.top);
      const taken = hit(next, nextWidth);
      if (taken) {
        const end = pane.clientWidth - MARGIN;
        const room = end - (taken.right + 12);
        if (column?.flows && !hit(dropped, w)) {
          // Another card stands beside the column: the card stays where the
          // reader let it go, and the article's lines flow around it.
          next = dropped;
          nextWidth = w;
        } else if (room >= (column?.flows ? w : MIN_WIDTH) && !hit({ left: taken.right + 12, top: next.top }, Math.min(w, room))) {
          // Room on the other card's right: beside it.
          next = { left: taken.right + 12, top: next.top };
          nextWidth = Math.min(w, Math.floor(room));
        } else {
          // Under the card it would lie on.
          for (let i = 0; i < others.length; i++) {
            const under = hit(next, nextWidth);
            if (!under) break;
            next = { left: next.left, top: under.bottom + 12 };
          }
        }
      }
    }
    // No room past the pane's cards (a comment beside a page in a narrow
    // pane): the note goes under the cards it would lie on, when they end
    // near; a column full of cards leaves it where it is.
    if (column) {
      let top = next.top;
      for (let i = 0; i < 6; i++) {
        const level = cardsLevel(pane, column.left, top, h);
        if (!level || next.left >= level.right + MARGIN) break;
        top = level.bottom + 12;
      }
      if (top !== next.top && top - next.top <= UNDER_CARDS_MAX) next = { left: next.left, top };
    }
    next = clampContent(next, pane, nextWidth);
    home.current = next.left;
    if (next.left === at.left && next.top === at.top && nextWidth === card.offsetWidth) return;
    setSliding(true);
    if (nextWidth !== card.offsetWidth) {
      // The corner handle wrote the card's size: the new width takes its place.
      card.style.width = `${nextWidth}px`;
      fitted.current = nextWidth;
      setWidth(nextWidth);
    }
    setAt(next);
    // One slide at a time: a new place while the card slides takes the wait
    // over, so the slide ends once, after the last one.
    window.clearTimeout(slideTimer.current);
    slideTimer.current = window.setTimeout(() => {
      setSliding(false);
      // A card that landed under the pane's foot comes into view.
      if (mode === "land") card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      // Past the slide's own 300 ms, so the gap is measured where the card stops.
    }, 380);
  }
  const settleRef = useRef(settle);
  useEffect(() => {
    settleRef.current = settle;
  });

  // As the card lands the tray folds (workspace.tsx) and the column moves to
  // the pane's left: once both have settled, the card takes its place
  // beside the column. A hold on the card first keeps it where the reader
  // puts it.
  useEffect(() => {
    if (!pane) return;
    landingUntil.current = performance.now() + LANDING_MS;
    const timer = window.setTimeout(() => settleRef.current("land", wanted.current), SETTLE_MS);
    const stop = () => {
      landingUntil.current = 0;
      window.clearTimeout(timer);
    };
    cardRef.current?.addEventListener("pointerdown", stop, { once: true });
    return stop;
    // Once, as the card lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pane the card stands in went (the document closed, the view
  // changed): the card moves to the pane that is there now, at its place on
  // screen, else over the workspace. A pane that opens under a card over the
  // workspace takes it.
  useEffect(() => {
    const check = () => {
      if (pane?.isConnected) return;
      const rect = cardRef.current?.getBoundingClientRect();
      const spot = rect && rect.width > 0 ? { left: rect.left, top: rect.top } : pos;
      const next = findPane(spot.left + width / 2, spot.top + 40);
      if (next === pane) return;
      if (next) setAt(clampContent(toContent(spot, next), next, width));
      else setPos(clampPos(spot, width));
      setPane(next);
    };
    const timer = window.setInterval(check, 500);
    return () => window.clearInterval(timer);
  }, [pane, pos, width]);

  // The pane narrows (the tray opens, the window shrinks): the card stays
  // whole inside it. The pane widens again: the card goes back to where the
  // reader left it. On a page of the page editor it then keeps beside the
  // page.
  const atRef = useRef(at);
  useEffect(() => {
    atRef.current = at;
  }, [at]);
  useEffect(() => {
    if (!pane) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Still landing: the pane settled a step further, and the card takes
        // its place from where the reader let it go.
        if (performance.now() < landingUntil.current) {
          settleRef.current("land", wanted.current);
          return;
        }
        const p = atRef.current;
        const next = clampContent({ left: home.current ?? p.left, top: p.top }, pane, cardRef.current?.offsetWidth ?? width);
        const kept = home.current;
        settleRef.current("clear", next);
        home.current = kept;
      });
    });
    observer.observe(pane);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pane, width]);

  // One of the pane's cards opens, moves, or closes (a comment, a tool
  // card, a suggestion): a note it would lie on moves past it. Not while
  // the reader holds the note.
  const grabbed = useRef(false);
  useEffect(() => {
    grabbed.current = grab !== null;
  }, [grab]);
  useEffect(() => {
    if (!pane) return;
    let timer = 0;
    // Only a change to one of the pane's cards counts: the document's own
    // changes (typing in the page editor, a mark painted) are not looked at.
    const aCard = (r: MutationRecord) => {
      const target = r.target instanceof Element ? r.target : r.target.parentElement;
      if (!target || target.closest("[data-floating-note]")) return false;
      if (r.type === "attributes") return target.matches(PANE_CARDS);
      for (const list of [r.addedNodes, r.removedNodes]) {
        for (const node of list) {
          if (node instanceof Element && (node.matches(PANE_CARDS) || node.querySelector(PANE_CARDS))) return true;
        }
      }
      return false;
    };
    const observer = new MutationObserver((records) => {
      if (!records.some(aCard)) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!grabbed.current && performance.now() >= landingUntil.current) settleRef.current("clear");
      }, 250);
    });
    observer.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-placed", "data-side-card"] });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [pane]);

  // With no document open the card is over the workspace. The tray folds as
  // the card lands (workspace.tsx); for a moment after the landing the card
  // follows the block of text it was let go over. A hold on the card ends it.
  useLayoutEffect(() => {
    if (pane) return;
    const card = cardRef.current?.getBoundingClientRect();
    if (!card) return;
    const block = document
      .elementsFromPoint(card.left + 24, card.top + 12)
      .map((el) => el.closest<HTMLElement>("[data-reader-root] [data-block-id]"))
      .find((el): el is HTMLElement => el !== null && !cardRef.current?.contains(el));
    if (!block) return;
    let last = block.getBoundingClientRect();
    let frame = 0;
    const until = performance.now() + FOLLOW_MS;
    const follow = () => {
      if (performance.now() > until || !block.isConnected) return;
      const now = block.getBoundingClientRect();
      // The column widens as the tray folds: the block moves across, and
      // its lines rewrap, so it moves up or down too.
      if (now.left !== last.left || now.top !== last.top) {
        const dx = now.left - last.left;
        const dy = now.top - last.top;
        last = now;
        setPos((p) => clampPos({ left: p.left + dx, top: p.top + dy }, cardRef.current?.offsetWidth ?? width));
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    const stop = () => cancelAnimationFrame(frame);
    cardRef.current?.addEventListener("pointerdown", stop, { once: true });
    return stop;
    // Once, as the card lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The window shrinks: a card over the article stays on screen.
  useEffect(() => {
    if (pane) return;
    const onResize = () => setPos((p) => clampPos(p, cardRef.current?.offsetWidth ?? width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [width, pane]);

  // The article's lines flow around the card: measure the gap and announce
  // it when it changes — after a move, a resize of the card, or a reflow of
  // the article (the tray folding, the window resizing, the gap itself
  // landing). The same gap is not sent twice.
  const lastGap = useRef("");
  useEffect(() => {
    const card = cardRef.current;
    if (!pane || !card) {
      if (lastGap.current) {
        lastGap.current = "";
        announceNoteWrap(edit.id, null);
      }
      return;
    }
    const measure = () => {
      const spacer = measureWrap(edit.id, card, pane);
      const key = JSON.stringify(spacer);
      if (key === lastGap.current) return;
      lastGap.current = key;
      announceNoteWrap(edit.id, spacer);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    const article = pane.querySelector("article");
    if (article) observer.observe(article);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
    // sliding: the card's box is where `at` says only once its slide ends.
  }, [pane, at, edit.id, sliding]);

  // The card leaves: its gap closes.
  useEffect(() => () => announceNoteWrap(edit.id, null), [edit.id]);

  const noteDrop = useNoteDrop({
    premium,
    enabled: canEdit,
    t,
    onError: setDropError,
    onImages: (images) => addToNote(images.map((i) => imageMarkdown(i.id, i.name)).join("\n\n")),
    onLinks: (links) => addToNote(links.map(linkMarkdown).join("\n\n")),
    onQuote: (drag) => addQuote(drag),
  });

  // Hold to drag (lib/hold-drag.ts): in the draggable mode a hold anywhere
  // on the card — not on a control that keeps its press — lifts it.
  function startHold(e: React.PointerEvent) {
    if (editing || e.button !== 0 || skipsDrag(e.target)) return;
    watchHold(e, (at) => {
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;
      setGrab({ dx: at.x - rect.left, dy: at.y - rect.top });
    });
  }

  const dropTip =
    noteDrop.over === "images"
      ? t("panes.dropImageIntoNote")
      : noteDrop.over === "links"
        ? t("outline.dropLinkIntoNote")
        : undefined;
  const pill = "rounded-full px-2.5 py-1 text-xs text-sand-600 hover:bg-clay-100 hover:text-clay-800";

  const card = (
    <div
      ref={cardRef}
      data-floating-note={edit.id}
      // The card stands in the reader's pane and is no part of the document:
      // a press or a selection in it is the note's, never the reader's
      // (reader-interactions.tsx skips [data-anchor-skip]).
      data-anchor-skip=""
      style={
        pane
          ? { left: at.left, top: at.top, width, maxHeight: Math.round(window.innerHeight * 0.7) }
          : { left: pos.left, top: pos.top, width, maxHeight: Math.max(180, window.innerHeight - pos.top - MARGIN) }
      }
      {...noteDrop.handlers}
      // A press brings the card over the other floating cards.
      onPointerDownCapture={() => {
        if (!front) window.dispatchEvent(new CustomEvent(FRONT_EVENT, { detail: edit.id }));
      }}
      // The corner handle let go: the width the reader set is the card's
      // width from then on.
      onPointerUp={() => {
        const now = cardRef.current?.offsetWidth;
        if (!now || grab || now === (fitted.current ?? wanted.current.width)) return;
        wanted.current.width = now;
        fitted.current = null;
      }}
      onPointerDown={editing ? undefined : startHold}
      // Double-click opens the editor (SPEC.md §6); a control keeps its click.
      onDoubleClick={
        editing
          ? undefined
          : (e) => {
              if (skipsDrag(e.target) || (e.target as Element).closest("button, a")) return;
              openEditor();
            }
      }
      // The browser's own drag of a link or a picture in the note would take
      // the hold.
      onDragStart={editing ? undefined : (e) => e.preventDefault()}
      data-note-drop-target={canEdit ? edit.id : undefined}
      data-tip={
        dropTip ??
        (cardDrop.drag && canEdit
          ? t(
              cardDrop.drag.kind === "annotation"
                ? "outline.dropAnnotation"
                : cardDrop.drag.kind === "quote"
                  ? "outline.dropQuoteIntoNote"
                  : "outline.dropNote",
            )
          : editing
            ? undefined
            : t("outline.holdToMoveCard"))
      }
      // The card sits over the article, under the reader's tools (TOOL_LAYER,
      // z-40 in reader-interactions.tsx): a selection's toolbar and the cards
      // it opens come out on top of the note, never under it.
      className={`${pane ? (front ? "absolute z-[21]" : "absolute z-20") : "fixed z-30"} flex max-w-[calc(100vw-32px)] min-h-[180px] min-w-[300px] resize flex-col overflow-hidden rounded-[20px] border border-line bg-card/95 p-3 shadow-float backdrop-blur-md ${
        grab ? "note-lifted select-none" : sliding ? "motion-safe:transition-[left,top,width] motion-safe:duration-300" : ""
      }${overSidebar ? " note-docking" : ""}${noteDrop.over ? " outline-2 outline-dashed outline-clay-400" : ""}${
        cardDrop.over ? " outline-2 outline-sage-500" : ""
      }${merging ? " note-absorb" : ""}`}
    >
      {dropError && <p className="mb-1 shrink-0 text-[11px] text-red-500">{dropError}</p>}
      {noteDrop.reading && (
        <p className="mb-1 shrink-0 text-[11px] text-sand-600">{t("api.imageReading", { name: noteDrop.reading })}</p>
      )}
      {mergeError && <p className="mb-1 shrink-0 text-[11px] text-red-500">{mergeError}</p>}
      {/* Over the sidebar: one line says what letting go does. */}
      {overSidebar && (
        <p className="mb-1 shrink-0 text-[11px] font-semibold text-sage-700">{t("outline.dropToDock")}</p>
      )}
      {/* The header row: the note's id at the left; the save state while
          editing, else the pencil, at the right (SPEC.md §6). */}
      <div className="mb-1 flex shrink-0 items-center gap-1.5">
        <NoteId id={edit.id} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {editing ? (
            <SaveStateLabel state={saveState} />
          ) : (
            canEdit && (
              <button
                onClick={openEditor}
                data-track="note-edit"
                data-no-drag
                aria-label={t("outline.editTitle")}
                data-tip={t("outline.editTitle")}
                className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-clay-800 hover:bg-clay-200"
              >
                <PencilIcon size={16} />
              </button>
            )
          )}
        </span>
      </div>

      {editing ? (
        <div data-note-editing="" className="flex min-h-0 flex-1 flex-col">
          <NoteEditor
            className="min-h-0 flex-1"
            value={parts.body}
            onChange={(text) => {
              setBody(text);
            }}
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void done();
              // Escape closes the editor keeping the words, as Done does.
              if (e.key === "Escape") void done();
            }}
            onQuoteDrop={(drag) =>
              note
                ? actions.attachSource(note.id, drag).then((ids) => {
                    sitting.current.push(...ids);
                  })
                : undefined
            }
            title={
              <NoteTitleField
                value={parts.title}
                onChange={(title) => {
                  setTitle(title);
                }}
                onEnter={() => focusBodyEditor(cardRef.current)}
                onEscape={() => void done()}
                className="shrink-0"
              />
            }
          />
        </div>
      ) : (
        <div className="note-body min-h-0 flex-1 overflow-y-auto">
          {shownTitle && <h3 className="note-title mb-1">{shownTitle}</h3>}
          {shown.body.trim() !== "" && (
            <Markdown breaks sources={note?.sources} notebookId={actions.notebookId}>
              {shown.body}
            </Markdown>
          )}
        </div>
      )}

      {/* A card is being dragged onto this one: one line says what the drop
          does. The drop itself is the merge. */}
      {cardDrop.drag && canEdit ? (
        <div className="mt-2 flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] font-semibold text-sage-700">
            {t(
              cardDrop.drag.kind === "annotation"
                ? "outline.dropAnnotation"
                : cardDrop.drag.kind === "quote"
                  ? "outline.dropQuoteIntoNote"
                  : "outline.dropNote",
            )}
          </span>
        </div>
      ) : editing ? (
        // Done, Cancel, Back to the tray, and the note's assistant (SPEC.md
        // §6) on one row; opened, the assistant's panel takes a row of its own.
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={() => void done()}
            data-track="note-save"
            className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          >
            {t("common.done")}
          </button>
          <button
            onClick={cancelEdit}
            data-track="note-cancel"
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={close}
            data-track="note-close"
            data-tip={t("outline.dockBackTitle")}
            className={`ml-auto ${pill}`}
          >
            {t("outline.dockBack")}
          </button>
          {note && canEdit && (
            <NoteAssistant
              notebookId={actions.notebookId}
              noteId={note.id}
              draft={draft}
              onApply={(next) => {
                setDraft(next);
                actions.floatingDraftChanged(edit.id, next);
              }}
              className="[&.flex-col]:mt-0.5 [&.flex-col]:basis-full"
            />
          )}
        </div>
      ) : (
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <button
            onClick={dock}
            data-track="note-dock"
            data-no-drag
            data-tip={t("outline.dockBackTitle")}
            className={`ml-auto ${pill}`}
          >
            {t("outline.dockBack")}
          </button>
        </div>
      )}
    </div>
  );

  return pane ? createPortal(card, pane) : card;
}
