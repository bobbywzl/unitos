"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { clearComposeDraft, readComposeDraft, writeComposeDraft } from "@/lib/note-drafts";
import { isOffline } from "@/lib/offline/queue";
import { tabAccount } from "@/lib/tab-account";
import type { NoteView } from "@/lib/types";
import type { SaveState } from "@/components/outline/save-state";
import type { OutlineActions } from "@/components/outline/use-outline";

// Auto-save for a section's composer (SPEC.md §6): a new note being written.
// The draft is written to localStorage with the keystroke (lib/note-drafts.ts).
// After the last keystroke the composer creates the note on the server, then
// every later edit saves to it — a debounced PATCH, and a keepalive flush when
// the window or the composer closes — the same as an open note editor. The
// created note stays out of the section's list while the composer owns it;
// Save releases it, Cancel deletes it. Closing the tab, leaving the page, or
// losing power keeps the note: the next load reopens the composer on the local
// draft, with the note it created. The tray and the notes full page share this
// hook.
export function useNoteCompose({
  sectionId,
  notes,
  actions,
  canEdit,
}: {
  sectionId: string;
  /** The section's notes: the composer hides the note it owns from them. */
  notes: NoteView[];
  actions: OutlineActions;
  canEdit: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const noteIdRef = useRef<string | null>(null);
  const lastSavedRef = useRef("");
  // The create in flight: Save and Cancel wait for it, so the note is never
  // created twice or left behind.
  const creatingRef = useRef<Promise<void> | null>(null);
  // The content the server confirmed, and the content whose save failed: the
  // save state at the top of the composer reads against the draft (save-state.tsx).
  const [confirmed, setConfirmed] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  // Restored on mount: the composer reopens on the local draft, owning the
  // note it created if the note is still here.
  useEffect(() => {
    if (!canEdit) return;
    const stored = readComposeDraft(sectionId);
    if (!stored) return;
    const owned = stored.noteId ? notes.find((n) => n.id === stored.noteId) ?? null : null;
    if (!stored.content.trim() && !owned) {
      clearComposeDraft(sectionId);
      return;
    }
    noteIdRef.current = owned?.id ?? null;
    lastSavedRef.current = owned?.content ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNoteId(owned?.id ?? null);
    setConfirmed(owned?.content.trim() ?? "");
    setDraft(owned && !stored.content.trim() ? owned.content : stored.content);
    setComposing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The local draft, with the keystroke.
  useEffect(() => {
    draftRef.current = draft;
    if (!composing) return;
    if (!draft.trim() && !noteId) {
      clearComposeDraft(sectionId);
      return;
    }
    writeComposeDraft(sectionId, draft, noteId);
  }, [draft, noteId, composing, sectionId]);

  function create(trimmed: string): Promise<void> {
    if (creatingRef.current) return creatingRef.current;
    const account = tabAccount();
    // A plain fetch, not api(): a create that queues offline returns no id,
    // and the composer must never own a note it cannot name.
    const run = fetch("/api/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(account ? { [ACCOUNT_HEADER]: account } : {}),
      },
      body: JSON.stringify({ sectionId, content: trimmed, top: true }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const note = (await res.json()) as { id?: unknown };
        if (typeof note.id !== "string") return;
        noteIdRef.current = note.id;
        lastSavedRef.current = trimmed;
        writeComposeDraft(sectionId, draftRef.current, note.id);
        setNoteId(note.id);
        setConfirmed(trimmed);
      })
      .catch(() => {
        // Not created: the next keystroke tries again; Save creates it itself.
        setFailed(trimmed);
      })
      .finally(() => {
        creatingRef.current = null;
      });
    creatingRef.current = run;
    return run;
  }

  // The server save, after the last keystroke.
  useEffect(() => {
    if (!composing || !canEdit) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      const id = noteIdRef.current;
      if (id) {
        const before = lastSavedRef.current;
        lastSavedRef.current = trimmed;
        void api(`/api/notes/${id}`, "PATCH", { content: trimmed })
          .then(() => setConfirmed(trimmed))
          .catch(() => {
            // Failed quiet save: the next keystroke or the flush retries.
            if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
            setFailed(trimmed);
          });
        return;
      }
      if (isOffline()) return;
      void create(trimmed);
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, composing, canEdit, sectionId]);

  // The flush: the window closes, the page changes, or the composer unmounts
  // (a collapsed section). A note not created yet stays in the local draft.
  useEffect(() => {
    if (!composing || !canEdit) return;
    const flush = () => {
      const id = noteIdRef.current;
      const trimmed = draftRef.current.trim();
      if (!id || !trimmed || trimmed === lastSavedRef.current) return;
      lastSavedRef.current = trimmed;
      const account = tabAccount();
      void fetch(`/api/notes/${id}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify({ content: trimmed }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [composing, canEdit]);

  function reset() {
    clearComposeDraft(sectionId);
    noteIdRef.current = null;
    lastSavedRef.current = "";
    draftRef.current = "";
    setNoteId(null);
    setDraft("");
    setConfirmed("");
    setFailed(null);
    setComposing(false);
  }

  function open() {
    setComposing(true);
  }

  /** Save: the note is written whole and released to the section's list. */
  async function save() {
    const trimmed = draftRef.current.trim();
    if (!trimmed) return;
    if (creatingRef.current) await creatingRef.current;
    const id = noteIdRef.current;
    if (id) {
      lastSavedRef.current = trimmed;
      await actions.saveNote(id, trimmed);
    } else {
      await actions.addNote(sectionId, trimmed);
    }
    reset();
  }

  /** Cancel: the draft is dropped, and the note the composer created is deleted. */
  async function cancel() {
    if (creatingRef.current) await creatingRef.current;
    const id = noteIdRef.current;
    reset();
    if (id) await actions.deleteNote(id).catch(() => {});
  }

  /** Escape: a note with text is kept (Save); an empty one is dropped (Cancel). */
  function escape() {
    if (draftRef.current.trim()) void save();
    else void cancel();
  }

  const trimmed = draft.trim();
  // Null while the composer is empty and owns nothing: there is nothing to save yet.
  const saveState: SaveState | null =
    !trimmed && !noteId ? null : trimmed === confirmed ? "saved" : trimmed === failed ? "failed" : "saving";

  return {
    composing,
    draft,
    setDraft,
    saveState,
    open,
    save,
    cancel,
    escape,
    /** The section's notes without the one the composer owns. */
    visibleNotes: noteId ? notes.filter((n) => n.id !== noteId) : notes,
  };
}
