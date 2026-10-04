"use client";

import { useEffect, useRef, useState } from "react";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { clearComposeDraft, readComposeDraft, writeComposeDraft } from "@/lib/note-drafts";
import { newNoteId } from "@/lib/notes/client-id";
import { saveNoteText } from "@/lib/notes/save-text";
import { isOffline } from "@/lib/offline/queue";
import { beginWrite, clearDirty, endWrite, markDirty } from "@/lib/save-state";
import { tabAccount } from "@/lib/tab-account";
import type { QuoteDrag } from "@/lib/quote-drag";
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
//
// The create carries an id chosen here (lib/notes/client-id.ts), written to
// the local draft before the create leaves: a reload while the create is on
// its way reopens the composer on the note it made, and a create sent again
// answers with that note, never a second copy. Every later save names the
// text it was made from (lib/notes/save-text.ts).
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
  // The note's text as the server last confirmed it: what the next save is made from.
  const baseRef = useRef("");
  // The id the create carries; made once per new note.
  const createIdRef = useRef<string | null>(null);
  // The saves, one after another.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // The create in flight: Save and Cancel wait for it, so the note is never
  // created twice or left behind.
  const creatingRef = useRef<Promise<void> | null>(null);
  // Quotes dropped into the composer before it owns a note (lib/quote-drag.ts):
  // their sources attach the moment the note exists.
  const pendingQuotesRef = useRef<QuoteDrag[]>([]);
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
    // The note it created: by the id the server answered with, else by the
    // id the create carried (the reload came before the answer).
    const ownedId = stored.noteId ?? stored.createId ?? null;
    const owned = ownedId ? notes.find((n) => n.id === ownedId) ?? null : null;
    if (!stored.content.trim() && !owned) {
      clearComposeDraft(sectionId);
      return;
    }
    noteIdRef.current = owned?.id ?? null;
    // Not here yet: the next create carries the same id.
    createIdRef.current = owned ? null : (stored.createId ?? null);
    lastSavedRef.current = owned?.content ?? "";
    baseRef.current = owned?.content.trim() ?? "";
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
    writeComposeDraft(sectionId, draft, noteId, createIdRef.current ?? undefined);
  }, [draft, noteId, composing, sectionId]);

  function createId(): string {
    createIdRef.current ??= newNoteId();
    return createIdRef.current;
  }

  /** Save `trimmed` to the note, after the saves before it, made from the text the last one left. */
  function patch(id: string, trimmed: string): Promise<void> {
    const run = chainRef.current.then(async () => {
      const saved = await saveNoteText(id, trimmed, baseRef.current);
      baseRef.current = saved.content;
      // The note changed elsewhere: the composer shows the text as saved.
      if (saved.changed && draftRef.current.trim() === trimmed) {
        lastSavedRef.current = saved.content;
        draftRef.current = saved.content;
        setDraft(saved.content);
      }
      setConfirmed(saved.content);
    });
    chainRef.current = run.catch(() => {});
    return run;
  }

  function create(trimmed: string): Promise<void> {
    if (creatingRef.current) return creatingRef.current;
    const account = tabAccount();
    const id = createId();
    // The id is in the local draft before the create leaves.
    writeComposeDraft(sectionId, draftRef.current, null, id);
    // A plain fetch, not api(): a create that queues offline returns no id,
    // and the composer must never own a note it cannot name. It counts in
    // the save indicator like every write.
    beginWrite();
    const run = fetch("/api/notes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(account ? { [ACCOUNT_HEADER]: account } : {}),
      },
      // The note is written in the open document (SPEC.md §6): the tray's
      // composer names it; the notes full page's names none.
      body: JSON.stringify({ id, sectionId, content: trimmed, top: true, documentId: actions.documentId ?? undefined }),
    })
      .then(async (res) => {
        endWrite(res.ok);
        if (!res.ok) return;
        const note = (await res.json()) as { id?: unknown; content?: unknown };
        if (typeof note.id !== "string") return;
        // The note a create sent before made holds the text it was made with.
        const stored = typeof note.content === "string" ? note.content.trim() : trimmed;
        noteIdRef.current = note.id;
        createIdRef.current = null;
        lastSavedRef.current = stored;
        baseRef.current = stored;
        writeComposeDraft(sectionId, draftRef.current, note.id);
        setNoteId(note.id);
        setConfirmed(stored);
        await flushQuotes(note.id);
        // Words typed since the create left save to the note.
        const typed = draftRef.current.trim();
        if (typed && typed !== stored) {
          lastSavedRef.current = typed;
          await patch(note.id, typed).catch(() => setFailed(typed));
        }
      })
      .catch(() => {
        // Not created: the next keystroke tries again; Save creates it itself.
        endWrite(false);
        setFailed(trimmed);
      })
      .finally(() => {
        creatingRef.current = null;
      });
    creatingRef.current = run;
    return run;
  }

  async function flushQuotes(id: string) {
    const quotes = pendingQuotesRef.current;
    pendingQuotesRef.current = [];
    for (const drag of quotes) await actions.attachSource(id, drag).catch(() => {});
  }

  /** A quote dropped into the composer: its source attaches to the note the
      composer owns, or waits for the one it creates. */
  async function attachQuote(drag: QuoteDrag) {
    if (creatingRef.current) await creatingRef.current;
    const id = noteIdRef.current;
    if (id) await actions.attachSource(id, drag);
    else pendingQuotesRef.current.push(drag);
  }

  // The server save, after the last keystroke.
  useEffect(() => {
    if (!composing || !canEdit) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    markDirty(`compose:${sectionId}`);
    const timer = setTimeout(() => {
      clearDirty(`compose:${sectionId}`);
      const id = noteIdRef.current;
      if (id) {
        const before = lastSavedRef.current;
        lastSavedRef.current = trimmed;
        void patch(id, trimmed)
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
    return () => {
      clearTimeout(timer);
      clearDirty(`compose:${sectionId}`);
    };
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
        // The tab is going away and cannot read a 409: the route puts the
        // texts together (lib/notes/conflict.ts).
        body: JSON.stringify({ content: trimmed, baseContent: baseRef.current, onConflict: "keep" }),
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
    pendingQuotesRef.current = [];
    clearComposeDraft(sectionId);
    noteIdRef.current = null;
    createIdRef.current = null;
    lastSavedRef.current = "";
    baseRef.current = "";
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
    // Not created yet: create it here (its quotes attach), then the save
    // that lists it. Offline the create queues instead, with its id.
    if (!noteIdRef.current && !isOffline()) await create(trimmed);
    const id = noteIdRef.current;
    if (id) {
      lastSavedRef.current = trimmed;
      await chainRef.current;
      await actions.saveNote(id, trimmed, baseRef.current);
    } else {
      await actions.addNote(sectionId, trimmed, createId());
    }
    reset();
  }

  /** Cancel: the draft is dropped, and the note the composer created is deleted. */
  async function cancel() {
    if (creatingRef.current) await creatingRef.current;
    // A create whose answer never came may still have made the note: its id names it.
    const id = noteIdRef.current ?? createIdRef.current;
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
    attachQuote,
    /** The section's notes without the one the composer owns. */
    visibleNotes: noteId ? notes.filter((n) => n.id !== noteId) : notes,
  };
}
