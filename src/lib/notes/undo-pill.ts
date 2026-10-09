"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { NoteView } from "@/lib/types";

// The notes' Undo pill, posted from outside the notes (SPEC.md §6): a delete
// of an annotation, a comment, or a conversation asks nothing and shows the
// same pill a note's delete shows — what went, Undo, ✕, for 12 seconds;
// Ctrl+Z presses Undo. History keeps what went, so Restore works after the
// pill goes.
//
// The poster dispatches UNDO_PILL_EVENT on window with an UndoPillPost.
// `undo` runs on Undo or Ctrl+Z. `commit`, when given, runs once the pill
// goes without Undo: its 12 seconds end, ✕, the next delete or merge, the
// next post, or the page closing (so a commit's request should be
// keepalive). A pill that takes the post calls preventDefault on the event;
// postUndoPill runs `commit` at once when no pill is on the page.

export const UNDO_PILL_EVENT = "dissect:undo-pill";

export type UndoPillPost = {
  message: string;
  undo: () => void | Promise<void>;
  commit?: () => void | Promise<void>;
};

/** How long the pill offers Undo: the same as a note's delete. */
export const UNDO_PILL_MS = 12_000;

/** Post to the pill. Returns false when no pill took it: `commit` has run then. */
export function postUndoPill(post: UndoPillPost): boolean {
  if (typeof window === "undefined") return false;
  const taken = !window.dispatchEvent(new CustomEvent(UNDO_PILL_EVENT, { detail: post, cancelable: true }));
  if (!taken) void run(post.commit);
  return taken;
}

/** Delete an annotation, a comment, or a conversation (a note row of
    another kind) with the pill: the reader's marks of it fade at once, the
    server deletes it and keeps it in History, and the pill's Undo is
    History's Restore of that event — the same row, id, sources, and
    replies. A failed delete puts the marks back and throws. onBack: the
    page takes the row back after Undo (a refresh). */
export async function deleteNoteWithUndo(noteId: string, message: string, onBack?: () => void): Promise<void> {
  const tell = (name: string, id: string) => window.dispatchEvent(new CustomEvent(name, { detail: { noteId: id } }));
  tell("dissect:note-removed", noteId);
  let answer: { eventId?: unknown; notebookId?: unknown } | null;
  try {
    answer = await api<{ eventId?: unknown; notebookId?: unknown } | null>(`/api/notes/${noteId}`, "DELETE");
  } catch (err) {
    tell("dissect:note-restored", noteId);
    throw err;
  }
  const { eventId, notebookId } = answer ?? {};
  // Queued offline: no event yet, so no Undo; History has it once it lands.
  if (typeof eventId !== "string" || typeof notebookId !== "string") return;
  postUndoPill({
    message,
    undo: async () => {
      const back = await api<unknown>(`/api/notebooks/${notebookId}/history/${eventId}`, "POST");
      tellNoteBack(back, noteId);
      onBack?.();
    },
  });
}

/** A note History's Restore put back: the outline takes it at once
    (use-outline.ts), and the reader repaints its marks. */
export const NOTE_BACK_EVENT = "dissect:note-back";
export type NoteBack = { noteId: string; sectionId?: string; note?: NoteView };

/** Tell the page a restored note is back, from the restore route's answer
    (POST /api/notebooks/:id/history/:eventId answers { noteId, sectionId,
    note }): the outline puts the note in its section at once, with no wait
    for a refresh, and the reader repaints its marks. fallbackId: the note's
    id when the answer names none. Returns the note's id. */
export function tellNoteBack(answer: unknown, fallbackId?: string): string | null {
  const a = (answer ?? {}) as { noteId?: unknown; sectionId?: unknown; note?: unknown };
  const noteId = typeof a.noteId === "string" ? a.noteId : fallbackId;
  if (!noteId || typeof window === "undefined") return noteId ?? null;
  const detail: NoteBack = { noteId };
  if (typeof a.sectionId === "string") detail.sectionId = a.sectionId;
  if (isNoteView(a.note) && a.note.id === noteId) detail.note = a.note;
  window.dispatchEvent(new CustomEvent(NOTE_BACK_EVENT, { detail }));
  window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId } }));
  return noteId;
}

function isNoteView(value: unknown): value is NoteView {
  const n = value as Partial<NoteView> | null;
  return (
    !!n &&
    typeof n.id === "string" &&
    typeof n.content === "string" &&
    typeof n.status === "string" &&
    typeof n.order === "number" &&
    typeof n.updatedAt === "string" &&
    Array.isArray(n.sources) &&
    Array.isArray(n.replies)
  );
}

/** The pill's words for a deleted annotation, by its kind. */
export function deletedKey(kind: string): "outline.highlightDeleted" | "outline.commentDeleted" | "outline.conversationDeleted" | "outline.annotationDeleted" {
  if (kind === "highlight") return "outline.highlightDeleted";
  if (kind === "comment") return "outline.commentDeleted";
  if (kind === "assistant") return "outline.conversationDeleted";
  return "outline.annotationDeleted";
}

function run(fn: (() => void | Promise<void>) | undefined) {
  return Promise.resolve()
    .then(() => fn?.())
    .catch((err: unknown) => console.error(err));
}

function isPost(value: unknown): value is UndoPillPost {
  const post = value as Partial<UndoPillPost> | null;
  return (
    !!post &&
    typeof post.message === "string" &&
    typeof post.undo === "function" &&
    (post.commit === undefined || typeof post.commit === "function")
  );
}

/** The posted pill a page draws (use-outline.ts, the annotations full page).
    onPost: a post arrived; the page's own pills give way to it. */
export function usePostedUndo(onPost?: () => void) {
  const [posted, setPosted] = useState<UndoPillPost | null>(null);
  const waiting = useRef<{ post: UndoPillPost; timer: ReturnType<typeof setTimeout> } | null>(null);
  const onPostRef = useRef(onPost);
  useEffect(() => {
    onPostRef.current = onPost;
  });
  const take = useCallback(() => {
    const w = waiting.current;
    if (!w) return null;
    waiting.current = null;
    clearTimeout(w.timer);
    setPosted(null);
    return w.post;
  }, []);
  /** The pill goes without Undo: the post's commit runs. */
  const settle = useCallback(() => {
    const post = take();
    if (post) void run(post.commit);
  }, [take]);
  const undo = useCallback(() => {
    const post = take();
    if (post) void run(post.undo);
  }, [take]);
  useEffect(() => {
    const onEvent = (e: Event) => {
      if (e.defaultPrevented) return;
      const post = (e as CustomEvent<unknown>).detail;
      if (!isPost(post)) return;
      e.preventDefault();
      settle();
      onPostRef.current?.();
      waiting.current = { post, timer: setTimeout(settle, UNDO_PILL_MS) };
      setPosted(post);
    };
    const onHide = () => settle();
    window.addEventListener(UNDO_PILL_EVENT, onEvent);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener(UNDO_PILL_EVENT, onEvent);
      window.removeEventListener("pagehide", onHide);
      settle();
    };
  }, [settle]);
  return { posted, undoPosted: undo, settlePosted: settle };
}

/** The notes this tab deleted and has not taken back (dissect:note-removed,
    dissect:note-restored): a list hides their rows at once, as the reader
    fades their marks, without waiting for the refresh. */
export function useRemovedNotes(): ReadonlySet<string> {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const idOf = (e: Event) => (e as CustomEvent<{ noteId?: unknown } | null>).detail?.noteId;
    const onRemoved = (e: Event) => {
      const id = idOf(e);
      if (typeof id === "string") setRemoved((prev) => new Set(prev).add(id));
    };
    const onRestored = (e: Event) => {
      const id = idOf(e);
      if (typeof id !== "string") return;
      setRemoved((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };
    window.addEventListener("dissect:note-removed", onRemoved);
    window.addEventListener("dissect:note-restored", onRestored);
    return () => {
      window.removeEventListener("dissect:note-removed", onRemoved);
      window.removeEventListener("dissect:note-restored", onRestored);
    };
  }, []);
  return removed;
}
