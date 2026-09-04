"use client";

import { useEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { NoteEditor } from "@/components/outline/note-editor";
import { useNoteDraft } from "@/components/outline/use-note-draft";
import type { FloatingEdit, OutlineActions } from "@/components/outline/use-outline";

// The floating card: a note's editor taken out of the tray and put over the
// article, so the note is edited against the document it is about, with the
// tray free for other work. Its handle drags it (a drop on the tray docks it
// back), the corner resizes it (native handle), and the tray's auto-save
// carries on inside it (use-note-draft.ts).

const WIDTH = 460;
const MARGIN = 16;
// The part of the card that stays on screen when it is dragged past an edge.
const KEEP = 96;

type Pos = { left: number; top: number };

function clampPos(pos: Pos, width: number): Pos {
  return {
    left: Math.max(KEEP - width, Math.min(pos.left, window.innerWidth - KEEP)),
    top: Math.max(8, Math.min(pos.top, window.innerHeight - KEEP)),
  };
}

/** The tray's box on screen, or null while it is folded. */
function trayRect(): DOMRect | null {
  const tray = document.querySelector('[data-track-surface="tray"]');
  const rect = tray?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect : null;
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
  const [pos, setPos] = useState<Pos>(() => landing(edit, width));
  const [grab, setGrab] = useState<{ dx: number; dy: number } | null>(edit.grab ?? null);

  function dock() {
    onDock();
    actions.dockNote(true);
  }

  function close() {
    cancel();
    actions.dockNote(false);
  }

  async function save() {
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
  // the pointer; released over the tray, it docks.
  useEffect(() => {
    if (!grab) return;
    const onMove = (e: PointerEvent) => {
      setPos(
        clampPos(
          { left: e.clientX - grab.dx, top: e.clientY - grab.dy },
          cardRef.current?.offsetWidth ?? width,
        ),
      );
    };
    const onUp = (e: PointerEvent) => {
      setGrab(null);
      const tray = trayRect();
      if (
        tray &&
        e.clientX >= tray.left &&
        e.clientX <= tray.right &&
        e.clientY >= tray.top &&
        e.clientY <= tray.bottom
      ) {
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
  }, [grab, width]);

  // The window shrinks: the card stays on screen.
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, cardRef.current?.offsetWidth ?? width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [width]);

  function startDrag(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    setGrab({ dx: e.clientX - rect.left, dy: e.clientY - rect.top });
  }

  return (
    <div
      ref={cardRef}
      data-floating-note={edit.id}
      style={{
        left: pos.left,
        top: pos.top,
        width,
        maxHeight: Math.max(180, window.innerHeight - pos.top - MARGIN),
      }}
      className={`fixed z-30 flex max-w-[calc(100vw-32px)] min-h-[180px] min-w-[300px] resize flex-col overflow-hidden rounded-[20px] border border-line bg-card/95 p-3 shadow-float backdrop-blur-md ${
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
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
          if (e.key === "Escape") close();
        }}
        handle={{ onPointerDown: startDrag, title: t("reader.dragToMove"), label: t("outline.floatingTitle") }}
      />
      <div className="mt-2 flex shrink-0 items-center gap-2">
        <button
          onClick={() => void save()}
          data-track="note-save"
          className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
        >
          {t("common.save")}
        </button>
        <button
          onClick={close}
          data-track="note-cancel"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={dock}
          data-track="note-dock"
          title={t("outline.dockBackTitle")}
          className="ml-auto text-xs text-sand-600 hover:text-clay-700"
        >
          {t("outline.dockBack")}
        </button>
      </div>
    </div>
  );
}
