"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isImeKey } from "@/lib/ime";
import { skipsDrag, watchHold } from "@/lib/hold-drag";
import { NOTE_WRAP_GAP as GAP, announceNoteWrap, type NoteWrapSpacer } from "@/lib/note-wrap";
import type { CardDragEndDetail } from "@/lib/card-drag";
import { imageMarkdown } from "@/lib/images";
import { linkMarkdown } from "@/lib/note-links";
import { editDraft, splitNote } from "@/lib/note-title";
import type { NoteView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PencilIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteId } from "@/components/outline/note-id";
import { NoteTitleField, focusBodyEditor, useNoteParts } from "@/components/outline/note-title-field";
import { SaveStateLabel } from "@/components/outline/save-state";
import { useNoteDrop } from "@/components/use-note-drop";
import { annotationReferenceMarkdown } from "@/lib/annotation-reference";
import { quoteMarkdown } from "@/lib/quote-drag";
import { useCardDropTarget } from "@/components/outline/use-card-drop";
import { useNoteDraft } from "@/components/outline/use-note-draft";
import type { FloatingEdit, OutlineActions } from "@/components/outline/use-outline";

// The floating card: a note dragged out of the tray and put over the article,
// so the note is read and edited against the document it is about, with the
// tray folded away (workspace.tsx folds it while a card floats). The card has
// the note's two modes, and only ever one of them (SPEC.md §6):
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
// Wrap text, a toggle on the card remembered per browser: the card leaves the
// viewport and joins the article's scroll pane at a spot in the text, so it
// scrolls with the text, and the article's lines flow around it. The card
// measures the gap it needs and announces it (lib/note-wrap.ts); the reader
// draws it. The text keeps GAP from the card.

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
// Less room than this beside the card and the text skips below it instead.
const MIN_BESIDE = 200;
const WRAP_STORE = "unitos-note-wrap";

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

function readWrapPreference(): boolean {
  try {
    return localStorage.getItem(WRAP_STORE) === "1";
  } catch {
    return false;
  }
}

function storeWrapPreference(on: boolean) {
  try {
    localStorage.setItem(WRAP_STORE, on ? "1" : "0");
  } catch {
    // storage unavailable: the choice lasts the session
  }
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
    actions.floatingDraftChanged(next);
  });
  // The note as it reads in the draggable mode.
  const shown = splitNote(content);
  // The width is set once; after that the corner handle owns the card's size.
  const [width] = useState(() => Math.min(WIDTH, window.innerWidth - 2 * MARGIN));
  // Over the article: the card's place on screen.
  const [pos, setPos] = useState<Pos>(() => landing(edit, width));
  // Wrap text: the pane the card joined, and its place in that pane's content.
  const [pane, setPane] = useState<HTMLElement | null>(() => {
    if (!readWrapPreference()) return null;
    const start = landing(edit, width);
    return findPane(start.left + width / 2, start.top + 40);
  });
  const [at, setAt] = useState<Pos>(() => {
    const start = landing(edit, width);
    const p = readWrapPreference() ? findPane(start.left + width / 2, start.top + 40) : null;
    return p ? clampContent(toContent(start, p), p, width) : start;
  });
  // Lifted by a hold: where the pointer sits inside the card while it moves.
  const [grab, setGrab] = useState<{ dx: number; dy: number } | null>(null);
  // The lifted card is over the sidebar: let go, and the note goes back
  // into the tray. The card says so meanwhile.
  const [overSidebar, setOverSidebar] = useState(false);

  // The note is gone (deleted elsewhere): the card closes.
  const gone = note === null;
  useEffect(() => {
    if (gone) actions.dockNote(false);
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
      actions.floatingDraftChanged(next);
      return;
    }
    const base = shown.body.replace(/\s+$/, "");
    const body = base ? `${base}\n\n${markdown}` : markdown;
    await actions.saveNote(edit.id, shown.title ? `# ${shown.title}\n\n${body}` : body);
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
          await addToNote(quoteMarkdown(quote.text));
          if (note) await actions.attachSource(note.id, quote);
        } else if (reference) {
          await addToNote(annotationReferenceMarkdown(actions.notebookId, reference));
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
        actions.floatingDraftChanged(merged.content);
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
    actions.dockNote(editing);
  }

  function close() {
    cancel();
    actions.dockNote(false);
  }

  function openEditor() {
    if (!canEdit) return;
    setDraft(editDraft(content));
    setEditing(true);
  }

  // Cancel: the draft goes back; the card returns to its draggable mode.
  function cancelEdit() {
    cancel();
    setEditing(false);
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
    await actions.saveNote(edit.id, trimmed);
    confirmSaved(trimmed);
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

  // The window shrinks: a card over the article stays on screen.
  useEffect(() => {
    if (pane) return;
    const onResize = () => setPos((p) => clampPos(p, cardRef.current?.offsetWidth ?? width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [width, pane]);

  // Wrap text: measure the gap and announce it when it changes — after a
  // move, a resize of the card, or a reflow of the article (the tray folding,
  // the window resizing, the gap itself landing). The same gap is not sent twice.
  const lastGap = useRef("");
  useEffect(() => {
    const card = cardRef.current;
    if (!pane || !card) {
      if (lastGap.current) {
        lastGap.current = "";
        announceNoteWrap(null);
      }
      return;
    }
    const measure = () => {
      const spacer = measureWrap(edit.id, card, pane);
      const key = JSON.stringify(spacer);
      if (key === lastGap.current) return;
      lastGap.current = key;
      announceNoteWrap(spacer);
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
  }, [pane, at, edit.id]);

  // The card leaves: the gap closes.
  useEffect(() => () => announceNoteWrap(null), []);

  const noteDrop = useNoteDrop({
    premium,
    enabled: canEdit,
    t,
    onError: setDropError,
    onImages: (images) => addToNote(images.map((i) => imageMarkdown(i.id, i.name)).join("\n\n")),
    onLinks: (links) => addToNote(links.map(linkMarkdown).join("\n\n")),
    onQuote: async (drag) => {
      await addToNote(quoteMarkdown(drag.text));
      if (note) await actions.attachSource(note.id, drag);
    },
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

  // Wrap on: the card keeps its place on screen while it joins the pane's
  // content. Wrap off: it keeps its place while it returns to the viewport.
  function toggleWrap() {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (pane) {
      setPos(clampPos({ left: rect.left, top: rect.top }, rect.width));
      setPane(null);
      storeWrapPreference(false);
      return;
    }
    const next = findPane(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!next) return;
    setAt(clampContent(toContent({ left: rect.left, top: rect.top }, next), next, rect.width));
    setPane(next);
    storeWrapPreference(true);
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
      style={
        pane
          ? { left: at.left, top: at.top, width, maxHeight: Math.round(window.innerHeight * 0.7) }
          : { left: pos.left, top: pos.top, width, maxHeight: Math.max(180, window.innerHeight - pos.top - MARGIN) }
      }
      {...noteDrop.handlers}
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
      className={`${pane ? "absolute z-20" : "fixed z-30"} flex max-w-[calc(100vw-32px)] min-h-[180px] min-w-[300px] resize flex-col overflow-hidden rounded-[20px] border border-line bg-card/95 p-3 shadow-float backdrop-blur-md ${
        grab ? "note-lifted select-none" : ""
      }${overSidebar ? " note-docking" : ""}${noteDrop.over ? " outline-2 outline-dashed outline-clay-400" : ""}${
        cardDrop.over ? " outline-2 outline-sage-500" : ""
      }${merging ? " note-absorb" : ""}`}
    >
      {dropError && <p className="mb-1 shrink-0 text-[11px] text-red-500">{dropError}</p>}
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
              if (e.key === "Escape") cancelEdit();
            }}
            moreHref={`/n/${actions.notebookId}/notes`}
            onQuoteDrop={(drag) => (note ? actions.attachSource(note.id, drag) : undefined)}
            title={
              <NoteTitleField
                value={parts.title}
                onChange={(title) => {
                  setTitle(title);
                }}
                onEnter={() => focusBodyEditor(cardRef.current)}
                onEscape={cancelEdit}
                className="shrink-0"
              />
            }
          />
        </div>
      ) : (
        <div className="note-body min-h-0 flex-1 overflow-y-auto">
          {shown.title && <h3 className="note-title mb-1">{shown.title}</h3>}
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
        <div className="mt-2 flex shrink-0 items-center gap-2">
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
        </div>
      ) : (
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleWrap}
            data-track="note-wrap"
            data-no-drag
            aria-pressed={pane !== null}
            data-tip={t("outline.wrapTextTitle")}
            className={`rounded-full px-2.5 py-1 text-xs ${
              pane ? "bg-clay-100 font-semibold text-clay-800" : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            }`}
          >
            {t("outline.wrapText")}
          </button>
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
