"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isImeKey } from "@/lib/ime";
import { NOTE_WRAP_GAP as GAP, announceNoteWrap, type NoteWrapSpacer } from "@/lib/note-wrap";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { NoteEditor } from "@/components/outline/note-editor";
import { useNoteDraft } from "@/components/outline/use-note-draft";
import type { FloatingEdit, OutlineActions } from "@/components/outline/use-outline";

// The floating card: a note dragged out of the tray and put over the article,
// so the note is edited against the document it is about, with the tray folded
// away (workspace.tsx folds it while a card floats). Its handle drags it (a
// drop on the tray or the rail docks it back), the corner resizes it (native
// handle), and the tray's auto-save carries on inside it (use-note-draft.ts).
//
// Wrap text, a toggle on the card remembered per browser: the card leaves the
// viewport and joins the article's scroll pane at a spot in the text, so it
// scrolls with the text, and the article's lines flow around it. The card
// measures the gap it needs and announces it (lib/note-wrap.ts); the reader
// draws it. The text keeps GAP from the card.

const WIDTH = 460;
const MARGIN = 16;
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
/** The rail's box: the drop target that docks a card while the tray is folded. */
const railRect = () => surfaceRect("sidebar");

function inRect(x: number, y: number, r: DOMRect | null): boolean {
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
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
  actions,
  onDock,
}: {
  edit: FloatingEdit;
  actions: OutlineActions;
  /** Docking opens the tray on notes, where the note's card takes the editor back. */
  onDock: () => void;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const cardRef = useRef<HTMLDivElement>(null);
  const { draft, setDraft, cancel, markSaved, getOriginal } = useNoteDraft({
    noteId: edit.id,
    original: edit.original,
    initial: edit.draft,
    active: true,
    canEdit,
  });
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
  const [grab, setGrab] = useState<{ dx: number; dy: number } | null>(edit.grab ?? null);

  function dock() {
    onDock();
    actions.dockNote(true);
  }

  function close() {
    cancel();
    actions.dockNote(false);
  }

  // Done closes the card; the content is already saved by then.
  async function done() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === getOriginal()) {
      close();
      return;
    }
    markSaved(trimmed);
    actions.dockNote(false);
    await actions.saveNote(edit.id, trimmed);
  }

  const dockRef = useRef(dock);
  useEffect(() => {
    dockRef.current = dock;
  });

  // Grabbed (by the handle, or on the way out of the tray): the card follows
  // the pointer; released over the tray or the rail, it docks.
  useEffect(() => {
    if (!grab) return;
    const onMove = (e: PointerEvent) => {
      const next = { left: e.clientX - grab.dx, top: e.clientY - grab.dy };
      const w = cardRef.current?.offsetWidth ?? width;
      if (pane) setAt(clampContent(toContent(next, pane), pane, w));
      else setPos(clampPos(next, w));
    };
    const onUp = (e: PointerEvent) => {
      setGrab(null);
      if (inRect(e.clientX, e.clientY, trayRect()) || inRect(e.clientX, e.clientY, railRect())) {
        dockRef.current();
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

  function startDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    setGrab({ dx: e.clientX - rect.left, dy: e.clientY - rect.top });
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

  const card = (
    <div
      ref={cardRef}
      data-floating-note={edit.id}
      style={
        pane
          ? { left: at.left, top: at.top, width, maxHeight: Math.round(window.innerHeight * 0.7) }
          : { left: pos.left, top: pos.top, width, maxHeight: Math.max(180, window.innerHeight - pos.top - MARGIN) }
      }
      className={`${pane ? "absolute z-20" : "fixed z-30"} flex max-w-[calc(100vw-32px)] min-h-[180px] min-w-[300px] resize flex-col overflow-hidden rounded-[20px] border border-line bg-card/95 p-3 shadow-float backdrop-blur-md ${
        grab ? "select-none" : ""
      }`}
    >
      <NoteEditor
        className="min-h-0 flex-1"
        value={draft}
        onChange={(text) => {
          setDraft(text);
          actions.floatingDraftChanged(text);
        }}
        onKeyDown={(e) => {
          if (isImeKey(e)) return;
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void done();
          if (e.key === "Escape") close();
        }}
        handle={{ onPointerDown: startDrag, title: t("reader.dragToMove"), label: t("outline.floatingTitle") }}
      />
      <div className="mt-2 flex shrink-0 items-center gap-2">
        <button
          onClick={() => void done()}
          data-track="note-save"
          className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
        >
          {t("common.done")}
        </button>
        <button
          onClick={close}
          data-track="note-cancel"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={toggleWrap}
          data-track="note-wrap"
          aria-pressed={pane !== null}
          data-tip={t("outline.wrapTextTitle")}
          className={`ml-auto rounded-full px-2.5 py-1 text-xs ${
            pane ? "bg-clay-100 font-semibold text-clay-800" : "text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          }`}
        >
          {t("outline.wrapText")}
        </button>
        <button
          onClick={dock}
          data-track="note-dock"
          data-tip={t("outline.dockBackTitle")}
          className="text-xs text-sand-600 hover:text-clay-700"
        >
          {t("outline.dockBack")}
        </button>
      </div>
    </div>
  );

  return pane ? createPortal(card, pane) : card;
}
