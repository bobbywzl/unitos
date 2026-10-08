"use client";

import { useEffect, useSyncExternalStore } from "react";
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
// the window closes — the same as an open note editor. The created note stays
// out of the section's list while the composer owns it; Save releases it,
// Cancel deletes it. Closing the tab, leaving the page, or losing power keeps
// the note: the next load reopens the composer on the local draft, with the
// note it created.
//
// A section has one composer (one session below), whatever draws it: the
// tray, the notes full page, and a section's board. A composer drawn in two
// places is one note: the words typed on the board are the words the notes
// full page shows when the board closes, and the save after the last
// keystroke runs whether or not a composer is still on screen. So closing a
// board, folding a section, or going to the tray never leaves the words in
// the local draft alone, and never saves them twice.
//
// The create carries an id chosen here (lib/notes/client-id.ts), written to
// the local draft before the create leaves: a reload while the create is on
// its way reopens the composer on the note it made, and a create sent again
// answers with that note, never a second copy. Every later save names the
// text it was made from (lib/notes/save-text.ts).

type Snapshot = {
  composing: boolean;
  draft: string;
  /** The note the composer owns, once created; null before. */
  noteId: string | null;
  /** The content the server confirmed, and the content whose save failed:
      the save state at the top of the composer reads against the draft
      (save-state.tsx). */
  confirmed: string;
  failed: string | null;
};

type Session = {
  sectionId: string;
  snap: Snapshot;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  /** The text the last save sent. */
  lastSaved: string;
  /** The note's text as the server last confirmed it: what the next save is made from. */
  base: string;
  /** The id the create carries; made once per new note. */
  createId: string | null;
  /** The saves, one after another. */
  chain: Promise<unknown>;
  /** The create in flight: Save and Cancel wait for it, so the note is never
      created twice or left behind. */
  creating: Promise<void> | null;
  /** Quotes dropped into the composer before it owns a note (lib/quote-drag.ts):
      their sources attach the moment the note exists. */
  pendingQuotes: QuoteDrag[];
  /** The save after the last keystroke. */
  timer: ReturnType<typeof setTimeout> | null;
  /** The actions and edit right of the surface drawn last. */
  actions: OutlineActions;
  canEdit: boolean;
  /** The window-closing flush, while composing. */
  unload: (() => void) | null;
  /** Offline: the create waits for the network. */
  online: (() => void) | null;
};

const EMPTY: Snapshot = { composing: false, draft: "", noteId: null, confirmed: "", failed: null };

// One session per section, for the life of the tab.
const sessions = new Map<string, Session>();

function sessionFor(sectionId: string, actions: OutlineActions, canEdit: boolean): Session {
  const found = sessions.get(sectionId);
  if (found) return found;
  const listeners = new Set<() => void>();
  const s: Session = {
    sectionId,
    snap: EMPTY,
    listeners,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    lastSaved: "",
    base: "",
    createId: null,
    chain: Promise.resolve(),
    creating: null,
    pendingQuotes: [],
    timer: null,
    actions,
    canEdit,
    unload: null,
    online: null,
  };
  sessions.set(sectionId, s);
  return s;
}

function set(s: Session, patch: Partial<Snapshot>) {
  s.snap = { ...s.snap, ...patch };
  for (const listener of s.listeners) listener();
}

const dirtyKey = (s: Session) => `compose:${s.sectionId}`;

function stopTimer(s: Session) {
  if (s.timer) {
    clearTimeout(s.timer);
    s.timer = null;
  }
  clearDirty(dirtyKey(s));
}

/** The local draft, with the keystroke. */
function persist(s: Session) {
  if (!s.snap.composing) return;
  if (!s.snap.draft.trim() && !s.snap.noteId) {
    clearComposeDraft(s.sectionId);
    return;
  }
  writeComposeDraft(s.sectionId, s.snap.draft, s.snap.noteId, s.createId ?? undefined);
}

function startComposing(s: Session, patch: Partial<Snapshot>) {
  set(s, { ...patch, composing: true });
  if (s.unload || typeof window === "undefined") return;
  const flush = () => flushOnUnload(s);
  s.unload = flush;
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", flush);
}

/** The composer reopens on the local draft, owning the note it created if
    the note is still here. */
function restore(s: Session, notes: NoteView[]) {
  if (!s.canEdit || s.snap.composing) return;
  const stored = readComposeDraft(s.sectionId);
  if (!stored) return;
  // The note it created: by the id the server answered with, else by the
  // id the create carried (the reload came before the answer).
  const ownedId = stored.noteId ?? stored.createId ?? null;
  const owned = ownedId ? (notes.find((n) => n.id === ownedId) ?? null) : null;
  if (!stored.content.trim() && !owned) {
    clearComposeDraft(s.sectionId);
    return;
  }
  // Not in this list (the composer's own note is not, until Save lets it
  // go): the next create carries the same id, and the server answers it
  // with the note it made, never a second one.
  s.createId = owned ? null : (stored.createId ?? stored.noteId ?? null);
  s.lastSaved = owned?.content ?? "";
  s.base = owned?.content.trim() ?? "";
  startComposing(s, {
    noteId: owned?.id ?? null,
    confirmed: owned?.content.trim() ?? "",
    failed: null,
    draft: owned && !stored.content.trim() ? owned.content : stored.content,
  });
  schedule(s);
}

function createId(s: Session): string {
  s.createId ??= newNoteId();
  return s.createId;
}

/** Save `trimmed` to the note, after the saves before it, made from the text the last one left. */
function patch(s: Session, id: string, trimmed: string): Promise<void> {
  const run = s.chain.then(async () => {
    const saved = await saveNoteText(id, trimmed, s.base);
    s.base = saved.content;
    // The note changed elsewhere: the composer shows the text as saved.
    if (saved.changed && s.snap.draft.trim() === trimmed) {
      s.lastSaved = saved.content;
      set(s, { draft: saved.content });
    }
    set(s, { confirmed: saved.content });
  });
  s.chain = run.catch(() => {});
  return run;
}

function create(s: Session, trimmed: string): Promise<void> {
  if (s.creating) return s.creating;
  const account = tabAccount();
  const id = createId(s);
  // The id is in the local draft before the create leaves.
  writeComposeDraft(s.sectionId, s.snap.draft, null, id);
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
    body: JSON.stringify({
      id,
      sectionId: s.sectionId,
      content: trimmed,
      top: true,
      documentId: s.actions.documentId ?? undefined,
    }),
  })
    .then(async (res) => {
      endWrite(res.ok);
      if (!res.ok) {
        // Not created: the next keystroke tries again; Save creates it itself.
        set(s, { failed: trimmed });
        return;
      }
      const note = (await res.json()) as { id?: unknown; content?: unknown };
      if (typeof note.id !== "string") return;
      // The note a create sent before made holds the text it was made with.
      const stored = typeof note.content === "string" ? note.content.trim() : trimmed;
      s.createId = null;
      s.lastSaved = stored;
      s.base = stored;
      set(s, { noteId: note.id, confirmed: stored });
      writeComposeDraft(s.sectionId, s.snap.draft, note.id);
      await flushQuotes(s, note.id);
      // Words typed since the create left save to the note.
      const typed = s.snap.draft.trim();
      if (typed && typed !== stored) {
        s.lastSaved = typed;
        await patch(s, note.id, typed).catch(() => set(s, { failed: typed }));
      }
    })
    .catch(() => {
      endWrite(false);
      set(s, { failed: trimmed });
    })
    .finally(() => {
      s.creating = null;
    });
  s.creating = run;
  return run;
}

async function flushQuotes(s: Session, id: string) {
  const quotes = s.pendingQuotes;
  s.pendingQuotes = [];
  for (const drag of quotes) await s.actions.attachSource(id, drag).catch(() => {});
}

/** The server save, 900 ms after the last keystroke, whether or not a
    composer is still on screen. */
function schedule(s: Session) {
  stopTimer(s);
  if (!s.snap.composing || !s.canEdit) return;
  const trimmed = s.snap.draft.trim();
  if (!trimmed || trimmed === s.lastSaved) return;
  markDirty(dirtyKey(s));
  s.timer = setTimeout(() => {
    s.timer = null;
    clearDirty(dirtyKey(s));
    saveNow(s);
  }, 900);
}

function saveNow(s: Session) {
  const trimmed = s.snap.draft.trim();
  if (!s.snap.composing || !trimmed || trimmed === s.lastSaved) return;
  const id = s.snap.noteId;
  if (id) {
    const before = s.lastSaved;
    s.lastSaved = trimmed;
    void patch(s, id, trimmed).catch(() => {
      // Failed quiet save: the next keystroke or the flush retries.
      if (s.lastSaved === trimmed) s.lastSaved = before;
      set(s, { failed: trimmed });
    });
    return;
  }
  // Offline the words wait in the local draft, and the create runs when
  // the network is back.
  if (isOffline()) {
    if (!s.online && typeof window !== "undefined") {
      const back = () => {
        window.removeEventListener("online", back);
        s.online = null;
        saveNow(s);
      };
      s.online = back;
      window.addEventListener("online", back);
    }
    return;
  }
  void create(s, trimmed);
}

/** The window closes: the words go to the note the composer owns. A note
    not created yet stays in the local draft for the next load. */
function flushOnUnload(s: Session) {
  const id = s.snap.noteId;
  const trimmed = s.snap.draft.trim();
  if (!id || !trimmed || trimmed === s.lastSaved) return;
  s.lastSaved = trimmed;
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
    body: JSON.stringify({ content: trimmed, baseContent: s.base, onConflict: "keep" }),
  }).catch(() => {});
}

function reset(s: Session) {
  stopTimer(s);
  if (s.unload) {
    window.removeEventListener("pagehide", s.unload);
    window.removeEventListener("beforeunload", s.unload);
    s.unload = null;
  }
  if (s.online) {
    window.removeEventListener("online", s.online);
    s.online = null;
  }
  s.pendingQuotes = [];
  clearComposeDraft(s.sectionId);
  s.createId = null;
  s.lastSaved = "";
  s.base = "";
  set(s, EMPTY);
}

function setDraft(s: Session, next: string) {
  set(s, { draft: next });
  persist(s);
  schedule(s);
}

/** + Note: the composer opens on the section's local draft when it has one
    (words a closed tab left), else empty. An empty composer never clears a
    draft it did not open on. */
function open(s: Session, notes: NoteView[]) {
  if (s.snap.composing) return;
  restore(s, notes);
  if (!s.snap.composing) startComposing(s, { draft: "", noteId: null, confirmed: "", failed: null });
}

/** A quote dropped into the composer: its source attaches to the note the
    composer owns, or waits for the one it creates. */
async function attachQuote(s: Session, drag: QuoteDrag) {
  if (s.creating) await s.creating;
  const id = s.snap.noteId;
  if (id) await s.actions.attachSource(id, drag);
  else s.pendingQuotes.push(drag);
}

/** Save: the note is written whole and released to the section's list. */
async function save(s: Session) {
  const trimmed = s.snap.draft.trim();
  if (!trimmed) return;
  stopTimer(s);
  if (s.creating) await s.creating;
  // Not created yet: create it here (its quotes attach), then the save
  // that lists it. Offline the create queues instead, with its id.
  if (!s.snap.noteId && !isOffline()) await create(s, trimmed);
  const id = s.snap.noteId;
  if (id) {
    s.lastSaved = trimmed;
    await s.chain;
    await s.actions.saveNote(id, trimmed, s.base);
  } else {
    await s.actions.addNote(s.sectionId, trimmed, createId(s));
  }
  reset(s);
}

/** Cancel: the draft is dropped, and the note the composer created is
    deleted — with Undo when it holds words: they are saved first, and the
    pill gives the note back with them. */
async function cancel(s: Session) {
  const typed = s.snap.draft.trim();
  if (s.creating) await s.creating;
  // A create whose answer never came may still have made the note: its id names it.
  const owned = s.snap.noteId;
  const id = owned ?? s.createId;
  const actions = s.actions;
  if (id && typed && owned !== null) {
    await s.chain;
    if (typed !== s.lastSaved) await actions.saveNote(id, typed, s.base).catch(() => {});
  }
  reset(s);
  if (!id) return;
  if (typed) actions.removeNotes([id], true);
  else await actions.deleteNote(id).catch(() => {});
}

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
  const s = sessionFor(sectionId, actions, canEdit);
  const snap = useSyncExternalStore(
    s.subscribe,
    () => s.snap,
    () => EMPTY,
  );

  // The surface drawn last lends the session its actions.
  useEffect(() => {
    s.actions = actions;
    s.canEdit = canEdit;
  });

  // On mount: the composer reopens on the local draft, unless the section's
  // composer is open already (on another surface, or before this one
  // remounted), which this surface then draws as it is.
  useEffect(() => {
    s.canEdit = canEdit;
    if (canEdit) restore(s, notes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const trimmed = snap.draft.trim();
  // Null while the composer is empty and owns nothing: there is nothing to save yet.
  const saveState: SaveState | null =
    !trimmed && !snap.noteId
      ? null
      : trimmed === snap.confirmed
        ? "saved"
        : trimmed === snap.failed
          ? "failed"
          : "saving";

  return {
    composing: snap.composing,
    draft: snap.draft,
    setDraft: (next: string) => setDraft(s, next),
    saveState,
    open: () => open(s, notes),
    save: () => save(s),
    cancel: () => cancel(s),
    /** Escape: a note with text is kept (Save); an empty one is dropped (Cancel). */
    escape: () => {
      if (s.snap.draft.trim()) void save(s);
      else void cancel(s);
    },
    attachQuote: (drag: QuoteDrag) => attachQuote(s, drag),
    /** The note the composer owns, once created; null before. */
    noteId: snap.noteId,
    /** The section's notes without the one the composer owns. */
    visibleNotes: snap.noteId ? notes.filter((n) => n.id !== snap.noteId) : notes,
  };
}
