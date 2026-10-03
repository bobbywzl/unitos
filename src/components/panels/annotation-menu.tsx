"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { setCommentResolved } from "@/lib/annotations/resolve";
import { isImeKey } from "@/lib/ime";
import type { AnnotationItem, NoteView, SectionView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { ChevronLeftIcon, MoreIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { shortNoteId } from "@/components/outline/note-id";
import { flatSections, menuRowClass as item, NotePicker } from "@/components/reader/note-picker";
import { jumpToAnnotation } from "@/components/panels/annotation-card";

// The menu on every annotation card (SPEC.md §6): the three dots at the
// right of the header open it, collapsed or not. It puts the annotation into
// notes without a drag — New note makes a note of it, in a section the
// reader picks; Add to a note joins its text into a note the reader picks —
// and carries Jump, Delete, and a resolved comment's Reopen, so a collapsed
// card has every action in reach. Either way the annotation stays where it
// is, still painted in the article: a note gets its own copy of the text
// and the anchors. The notes list is the NotePicker (reader/note-picker.tsx),
// the same list the reader's Add to notes draws.

type Mode = "menu" | "sections" | "notes";

export function AnnotationMenu({
  annotation,
  notebookId,
  documentId,
  sections,
  onDelete,
}: {
  annotation: AnnotationItem;
  notebookId: string;
  documentId: string | null;
  /** The project's sections with their notes: where the annotation can go. */
  sections: SectionView[];
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useT();
  const router = useRouter();
  const { canEdit } = useCollab();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the last action did, shown under the header for a moment.
  const [done, setDone] = useState<string | null>(null);
  // A resolved comment has no mark to jump to (SPEC.md §29).
  const canJump = Boolean(annotation.sourceId) && !annotation.orphaned && !annotation.resolved && documentId !== null;
  const flat = flatSections(sections);

  function close() {
    setOpen(false);
    setMode("menu");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), 3500);
    return () => clearTimeout(timer);
  }, [done]);

  async function run(action: () => Promise<string>) {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const message = await action();
      close();
      setDone(message);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setWorking(false);
    }
  }

  /** New note: a note of the annotation's text and anchors, in this section. */
  function newNote(sectionId: string, label: string) {
    void run(async () => {
      const note = await api<{ id?: string }>("/api/notes", "POST", { sectionId, fromAnnotationId: annotation.id });
      return t("panels.annotationNoteMade", { id: note?.id ? shortNoteId(note.id) : "", section: label });
    });
  }

  /** Add to a note: the annotation's text joins the note, its anchors become the note's. */
  function addTo(note: NoteView) {
    void run(async () => {
      await api("/api/notes/merge", "POST", { targetId: note.id, sourceIds: [annotation.id], mode: "join" });
      return t("panels.annotationNoteAdded", { id: shortNoteId(note.id) });
    });
  }

  /** Reopen: the resolved comment paints again; its card moving back under
      Comments says so. */
  function reopen() {
    void run(async () => {
      await setCommentResolved(annotation.id, false);
      return "";
    });
  }

  function jump() {
    close();
    if (annotation.sourceId && documentId) jumpToAnnotation(router, notebookId, documentId, annotation.sourceId);
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        data-track="annotation-menu"
        data-no-drag
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("panels.annotationMenu")}
        data-tip={t("panels.annotationMenuTitle")}
        className="flex size-[22px] items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
      >
        <MoreIcon size={14} />
      </button>
      {done && !open && (
        <span className="absolute top-full right-0 z-20 mt-1 rounded-full bg-sage-600 px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-sage-fg shadow-soft">
          {done}
        </span>
      )}
      {open && (
        <div
          role="menu"
          className="menu-in absolute top-full right-0 z-30 mt-1 w-64 rounded-2xl border border-line bg-card p-1.5 shadow-float"
        >
          {mode !== "menu" && (
            <button
              type="button"
              onClick={() => setMode("menu")}
              className={`${item} text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase`}
            >
              <ChevronLeftIcon size={12} />
              {mode === "sections" ? t("panels.annotationPickSection") : t("panels.annotationPickNote")}
            </button>
          )}
          {error && <p className="px-2.5 py-1 text-[11px] text-red-500">{error}</p>}

          {mode === "menu" && (
            <>
              {canEdit && annotation.resolved && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={working}
                  onClick={reopen}
                  data-track="comment-reopen"
                  data-tip={t("panels.reopenCommentTitle")}
                  className={item}
                >
                  {t("common.reopen")}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={flat.length === 0 || working}
                  onClick={() => {
                    // One section: no choice to make.
                    if (flat.length === 1) newNote(flat[0].id, flat[0].label);
                    else setMode("sections");
                  }}
                  data-track="annotation-new-note"
                  data-tip={t("panels.annotationNewNoteTitle")}
                  className={item}
                >
                  {t("panels.annotationNewNote")}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={working}
                  onClick={() => setMode("notes")}
                  data-track="annotation-add-to-note"
                  data-tip={t("panels.annotationAddToNoteTitle")}
                  className={item}
                >
                  {t("panels.annotationAddToNote")}
                </button>
              )}
              {canJump && (
                <button type="button" role="menuitem" onClick={jump} data-track="annotation-jump" className={item}>
                  {t("panels.jumpToAnchor")}
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={working}
                  onClick={() => {
                    close();
                    void onDelete(annotation.id);
                  }}
                  data-track="annotation-delete"
                  data-tip={t("panels.deleteAnnotationTitle")}
                  className={`${item} text-red-500 hover:text-red-700`}
                >
                  {t("common.delete")}
                </button>
              )}
            </>
          )}

          {mode === "sections" && (
            <div className="max-h-64 overflow-y-auto">
              {flat.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="menuitem"
                  disabled={working}
                  onClick={() => newNote(s.id, s.label)}
                  data-track="annotation-new-note-section"
                  className={item}
                >
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span className="text-[11px] text-sand-500">{s.notes.length || ""}</span>
                </button>
              ))}
            </div>
          )}

          {mode === "notes" && (
            <NotePicker
              sections={sections}
              onPick={addTo}
              onEscape={() => setMode("menu")}
              disabled={working}
              track="annotation-add-to-note-pick"
            />
          )}
        </div>
      )}
    </div>
  );
}
