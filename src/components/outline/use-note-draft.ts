"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isOffline } from "@/lib/offline/queue";
import { clearDirty, markDirty } from "@/lib/save-state";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { clearNoteDraft, confirmNoteDraft, noteDraftBase, readNoteDraft, writeNoteDraft } from "@/lib/note-drafts";
import { reconcileNoteText } from "@/lib/notes/conflict";
import { conflictLabels, saveNoteText, type SavedText } from "@/lib/notes/save-text";
import { tabAccount } from "@/lib/tab-account";
import type { SaveState } from "@/components/outline/save-state";

// Auto-save for an open note editor (SPEC.md §6): while the editor is open,
// every edit saves on its own — a debounced PATCH after the last keystroke,
// and a keepalive flush when the window closes or the editor closes — so
// nothing typed is lost. The draft is also written to localStorage with the
// keystroke (lib/note-drafts.ts): the PATCH and the flush are network calls,
// and the local draft is what survives a crash, a power loss, or a lost
// connection between them. It is cleared when the server confirms the same
// content, and replayed on the next load when it is not (use-outline.ts). A
// save that waits in the offline queue is not confirmed: the draft keeps the
// words, made from the text the server has, until the queue's write lands.
// Cancel takes out the words typed in this editor: the editor goes back to
// the text it opened on, with every change another writer made meanwhile
// put back on it (another tab, a device, a collaborator, a merge into the
// note), and the close writes that text, made from the text the last save
// left, so words that landed since stay too. The tray card and the floating
// card share this hook; the draft moves between them as `initial`.
//
// Every save names the text it was made from (lib/notes/save-text.ts): the
// note's text when the editor opened, then the text each save left. The
// same note saved meanwhile from another tab or by a collaborator is put
// together with the reader's text, never saved over; the editor then shows
// the text as it was saved, and the save state says both versions were
// kept when some lines are kept twice. One save at a time per editor, so
// each save is made from the text the one before it left. A save of the
// editor's words sends the words the editor holds when the save leaves,
// never the words it held when the save was asked for: a save that waited
// behind another one sends the text that save left, with the keys typed
// since. The text a save brings back is in the editor before the next key
// lands, the caret after the reader's own words (lib/note-editable.ts), so
// every save is made from the text the editor shows. Done and the closing
// flush wait for the save on its way, then send the same way.
//
// A merge reads the notes as they are stored, and an open editor may hold
// words the auto-save has not sent yet. So every open editor registers
// itself here, and the merge (use-outline.ts) flushes the drafts of the
// notes it joins before it runs, then puts the merged text into the target's
// editor, saved and ready to keep editing (SPEC.md §6).
//
// A new Group by draws the notes anew, and the card of a note being edited
// with them (note-groups.tsx). The editor goes on in the new card: the old
// editor hands over its text, the text its saves are made from, and its
// saves still on their way, and the new one sends after them, made from the
// text they leave (carryNoteEditors). Nothing is saved at the switch, so no
// save is ever made from the tree's copy of the note, which may be older.
type DraftHandle = {
  /** The editor's text while it is open; null once it closed. */
  text: () => string | null;
  /** Save the draft now, when it differs from what was saved last. */
  flush: () => Promise<void>;
  /** Put `content` into the editor as its saved draft. */
  replace: (content: string) => void;
  /** Save `content` now, made from the text the editor's last save left. */
  save: (content: string) => Promise<SavedText>;
};
const openDrafts = new Map<string, DraftHandle>();

// Notes whose words went to a new note (lib/notes/gone.ts). The note's card
// keeps its key (use-outline.ts noteKey), so its open editor goes on as the
// new note's editor. Where a new editor opens in its place instead, the keys
// typed in between — after the server answered, before the new editor
// opened — are in the old editor alone: as it closes, it puts its text into
// the new note's local draft, which the new editor opens on, and clears its
// own. Either way nothing goes to the gone note, and no key typed is lost.
const handedOff = new Map<string, string>();
// The old editor's text exactly as it stood, by the new note: the local
// draft keeps words, and this keeps the space typed last too, which a draft
// equal to the note's text but for spaces would not bring back.
const handedText = new Map<string, string>();

// The editors open when the notes were drawn anew, by note, with their text
// then: the new card of each opens its editor on that text.
const carrying = new Map<string, string>();
// The editors the old cards handed over, by note, until a new card takes one.
type Carried = {
  /** The old editor's text when it handed over. */
  text: string;
  /** Its saves, one after another: the new editor's saves go after them. */
  chain: Promise<unknown>;
  /** Its refs as they stand now: a save on its way moves them. */
  state: () => {
    draft: string;
    base: string;
    lastSaved: string;
    confirmed: string;
    queued: string | null;
    opened: string;
    original: string;
    others: OtherChange[];
  };
  /** Close it as Done would have, when no new card took it. */
  close: () => void;
};
const carried = new Map<string, Carried>();

// The close write of each editor that closed and whose write has not
// answered yet, by note: a save that must land after it (Undo on the Edit
// canceled pill) waits for it.
const closing = new Map<string, Promise<unknown>>();

/** Resolves once the note's closed editor has written its last words. */
export function afterNoteClose(noteId: string): Promise<void> {
  return (closing.get(noteId) ?? Promise.resolve()).then(() => {});
}

/** A change to the note's text that the editor did not type: from the text
    one of its saves sent to the text the save came back with, or from the
    note's text to the text a merge into it left. */
type OtherChange = { from: string; to: string };

/** The notes are about to be drawn anew (a new Group by): each open editor
    goes on in its note's new card. An editor no new card takes closes and
    saves as it would have. */
export function carryNoteEditors() {
  for (const [id, handle] of openDrafts) {
    const text = handle.text();
    if (text !== null) carrying.set(id, text);
  }
  if (carrying.size === 0) return;
  // The new cards mount in the same commit as the old ones go: by the next
  // task every editor was taken or is left.
  setTimeout(() => {
    carrying.clear();
    for (const [id, left] of carried) {
      carried.delete(id);
      left.close();
    }
  }, 0);
}

/** The text a note's new card opens its editor on, while its old editor
    hands over (carryNoteEditors); undefined otherwise. */
export function carriedNoteText(noteId: string): string | undefined {
  return carrying.get(noteId);
}

/** The editor of `from` gives way to the editor of `to` (use-outline.ts). */
export function handOffNoteDraft(from: string, to: string) {
  if (openDrafts.has(from)) handedOff.set(from, to);
}

/** Save the open drafts of these notes, so a merge reads what is on screen. */
export async function flushNoteDrafts(noteIds: string[]): Promise<void> {
  await Promise.all(noteIds.map((id) => openDrafts.get(id)?.flush()));
}

/** Put `content` into the note's open editor, as saved: the merged text takes
    the draft's place. Nothing happens when the note has no open editor. */
export function replaceNoteDraft(noteId: string, content: string) {
  openDrafts.get(noteId)?.replace(content);
}

/** The save of the note's open editor, made from the text it opened on;
    null when the note has no open editor. */
export function openDraftSave(noteId: string): ((content: string) => Promise<SavedText>) | null {
  return openDrafts.get(noteId)?.save ?? null;
}

export function useNoteDraft({
  noteId,
  original,
  initial,
  active,
  canEdit,
}: {
  noteId: string;
  /** The content before this edit — what Cancel restores. Read when the editor opens. */
  original: string;
  /** The draft the editor opens with. */
  initial: string;
  /** True while the editor is open. */
  active: boolean;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(draft);
  const lastSavedRef = useRef(original);
  // Kept from the moment the editor opens: a sync refresh mid-edit replaces
  // the note's content with the auto-saved draft, and Cancel must still
  // restore what was there before.
  const originalRef = useRef(original);
  // The content the server confirmed, and the content whose save failed: the
  // save state at the top of the card reads against the draft (save-state.tsx).
  const [confirmed, setConfirmed] = useState(original.trim());
  const [failed, setFailed] = useState<string | null>(null);
  // The saved text that kept two versions of some lines: the save state says
  // so until the reader's next save.
  const [both, setBoth] = useState<string | null>(null);
  // The text the next save is made from: the note's text when the editor
  // opened, then the text each save left (lib/notes/save-text.ts).
  const baseRef = useRef(original.trim());
  // The note's text as the server had it when the editor opened: the
  // sources of the quotes the sitting removed go when it closes, read
  // against this text (SPEC.md §6). Until then every save keeps them, so a
  // quote deleted and brought back (Ctrl+Z, Cancel) keeps its source.
  const openedRef = useRef(original.trim());
  // The text of the save on its way, if any: the closing flush is made from it.
  const sendingRef = useRef<string | null>(null);
  // The saves of this editor, one after another.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // The text of the last save that waits in the offline queue: the save
  // state reads Waiting to sync, not Saved, until the queue syncs.
  const [queued, setQueued] = useState<string | null>(null);
  const queuedRef = useRef<string | null>(null);
  // The note's text as the server last confirmed it: what the local draft is
  // made from. A queued save moves the next save's base (baseRef), never
  // this, so a draft replayed after a reload is made from the server's text.
  const confirmedRef = useRef(original.trim());
  // Words a local draft kept that the server never confirmed, put into the
  // editor as it opens: until the editor shows them, no keystroke writes
  // the local draft, so the kept words are never written over.
  const adoptingRef = useRef<string | null>(null);
  // The changes other writers made to the note while the editor was open,
  // in order: Cancel puts them back on the text the editor opened on, so
  // it takes out only the words typed here (SPEC.md §6).
  const othersRef = useRef<OtherChange[]>([]);
  // Cancel was pressed: the close writes the text Cancel left, as its own
  // History entry, and keeps the sources until it names which go.
  const canceledRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    lastSavedRef.current = original;
    originalRef.current = original;
    baseRef.current = original.trim();
    confirmedRef.current = original.trim();
    queuedRef.current = null;
    openedRef.current = original.trim();
    adoptingRef.current = null;
    othersRef.current = [];
    canceledRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConfirmed(original.trim());
    setFailed(null);
    setBoth(null);
    setQueued(null);
    // The same note's editor in the card this one replaced (a new Group by):
    // its text, the text its saves are made from, and its saves on their way.
    const carry = canEdit ? carried.get(noteId) : undefined;
    if (carry) {
      // Taken; the note stays carrying until the switch is over, so an
      // editor that mounts twice (React's strict mode) takes it again.
      carried.delete(noteId);
      const adopt = () => {
        const was = carry.state();
        lastSavedRef.current = was.lastSaved;
        baseRef.current = was.base;
        confirmedRef.current = was.confirmed;
        queuedRef.current = was.queued;
        openedRef.current = was.opened;
        originalRef.current = was.original;
        othersRef.current = [...was.others];
        if (was.queued !== null && !isOffline()) setFailed(was.queued);
        else {
          setQueued(was.queued);
          setConfirmed(was.base);
        }
      };
      adopt();
      draftRef.current = carry.text;
      setDraft(carry.text);
      // Once the old editor's saves answered: the text they left. A save
      // that came back with the note changed elsewhere moved the old
      // editor's text; the keys typed here since go on top of it.
      chainRef.current = carry.chain.then(() => {
        adopt();
        const left = carry.state().draft.trim();
        const handed = carry.text.trim();
        if (left === handed) return;
        const typed = draftRef.current.trim();
        const next = typed === handed ? left : reconcileNoteText(handed, left, typed, conflictLabels()).text;
        draftRef.current = next;
        flushSync(() => setDraft(next));
      });
      return;
    }
    // The editor of a gone note gave way to this one (handOffNoteDraft): the
    // same text, spaces and all, when it holds no word the note lacks.
    const handed = handedText.get(noteId);
    handedText.delete(noteId);
    if (canEdit && handed !== undefined && handed.trim() === original.trim()) {
      draftRef.current = handed;
      setDraft(handed);
      return;
    }
    // A local draft that holds words the server never confirmed (a save that
    // failed, then a reload): the editor opens on those words, marked Not
    // saved, and saves them made from the text they were made from — never
    // the note's old text with the words gone (SPEC.md §6). The notes show
    // the same words on the card (use-outline.ts).
    const kept = readNoteDraft(noteId);
    if (canEdit && kept && kept.base !== undefined && kept.content.trim() && kept.content.trim() !== kept.base.trim()) {
      // The note's text as the server has it: the card shows the kept words
      // in its place, so the draft's base stands for it then.
      const stored = original.trim() === kept.content.trim() ? kept.base : original;
      const base = (noteDraftBase(kept, stored) ?? stored).trim();
      lastSavedRef.current = base;
      baseRef.current = base;
      confirmedRef.current = base;
      openedRef.current = base;
      originalRef.current = kept.content;
      setConfirmed(base);
      setFailed(kept.content.trim());
      adoptingRef.current = kept.content;
      draftRef.current = kept.content;
      setDraft(kept.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** Save `content` after the saves before it; the editor takes the saved text. */
  const save = useCallback(
    (content: string): Promise<SavedText> => {
      // The editor's own words: the save sends the editor's words as they
      // stand when it leaves. Other words (a quote put on the text the card
      // shows): made from the text of the save on its way, else the last
      // one, and put together with whatever the saves before it left.
      const drafted = content === draftRef.current.trim();
      const from = sendingRef.current ?? baseRef.current;
      const run = chainRef.current.then(async (): Promise<SavedText> => {
        const trimmed = drafted
          ? draftRef.current.trim() || content
          : from === baseRef.current
            ? content
            : reconcileNoteText(from, baseRef.current, content, conflictLabels()).text;
        if (lastSavedRef.current === content) lastSavedRef.current = trimmed;
        // The text the server has: nothing to send. The same text as a save
        // that waits in the offline queue is queued already: one queued
        // write per text (Done after the auto-save), never a second one made
        // from the first.
        if (baseRef.current === trimmed) {
          return { content: trimmed, changed: false, conflict: false, ...(queuedRef.current === trimmed ? { queued: true } : {}) };
        }
        sendingRef.current = trimmed;
        try {
          const saved = await saveNoteText(noteId, trimmed, baseRef.current, { keepSources: true });
          baseRef.current = saved.content;
          queuedRef.current = saved.queued ? saved.content : null;
          setQueued(saved.queued ? saved.content : null);
          const local = readNoteDraft(noteId);
          if (saved.queued) {
            // Not on the server yet: the local draft keeps the words, made
            // from the server's text, and names the queued text, so a reload
            // finds the words whether or not the queue landed meanwhile.
            writeNoteDraft(noteId, local?.content ?? trimmed, confirmedRef.current, saved.content);
          } else {
            confirmedRef.current = saved.content;
            confirmNoteDraft(noteId, content);
            confirmNoteDraft(noteId, trimmed);
            confirmNoteDraft(noteId, saved.content);
            // Words typed since stay in the local draft, made from this save now.
            const left = readNoteDraft(noteId);
            if (left) writeNoteDraft(noteId, left.content, saved.content);
          }
          if (saved.changed) {
            // The note changed elsewhere: the editor shows the text as saved,
            // with what the reader typed since put on top of it — painted
            // now, before another key reaches the editor, so the next save is
            // made from it.
            othersRef.current.push({ from: trimmed, to: saved.content });
            const typed = draftRef.current;
            const next =
              typed.trim() === trimmed ? saved.content : reconcileNoteText(trimmed, saved.content, typed.trim(), conflictLabels()).text;
            if (lastSavedRef.current === trimmed) lastSavedRef.current = saved.content;
            draftRef.current = next;
            flushSync(() => setDraft(next));
          }
          // Queued with the browser online: the server did not take the
          // words (an error, a dropped connection). The queue tries again;
          // until it lands the editor reads Not saved, not Waiting to sync.
          if (saved.queued && !isOffline()) {
            setQueued(null);
            setFailed(saved.content);
          } else setConfirmed(saved.content);
          setBoth(saved.conflict ? saved.content : null);
          return saved;
        } finally {
          sendingRef.current = null;
        }
      });
      chainRef.current = run.catch(() => {});
      return run;
    },
    [noteId],
  );

  useEffect(() => {
    draftRef.current = draft;
    if (!active || !canEdit) return;
    if (adoptingRef.current !== null) {
      if (draft.trim() !== adoptingRef.current.trim()) return;
      adoptingRef.current = null;
    }
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    // The local draft first: synchronous, so it is there whatever happens
    // next. Made from the server's text; a save on its way or in the offline
    // queue is named, so a reload knows which text the server holds.
    writeNoteDraft(noteId, draft, confirmedRef.current, sendingRef.current ?? queuedRef.current);
    // The save indicator reads Saving… from the keystroke; the save itself
    // counts from the moment it starts.
    markDirty(noteId);
    const timer = setTimeout(() => {
      clearDirty(noteId);
      const before = lastSavedRef.current;
      lastSavedRef.current = trimmed;
      void save(trimmed).catch(() => {
          // Failed quiet save: the next keystroke or the flush retries, and
          // the local draft replays on the next load.
          if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
          setFailed(trimmed);
        });
    }, 900);
    return () => {
      clearTimeout(timer);
      clearDirty(noteId);
    };
  }, [draft, active, canEdit, noteId, save]);

  useEffect(() => {
    if (!active || !canEdit) return;
    let open = true;
    const handle: DraftHandle = {
      text: () => (open ? draftRef.current : null),
      async flush() {
        const trimmed = draftRef.current.trim();
        if (!trimmed || trimmed === lastSavedRef.current) return;
        const before = lastSavedRef.current;
        lastSavedRef.current = trimmed;
        try {
          await save(trimmed);
        } catch (err) {
          if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
          setFailed(trimmed);
          throw err;
        }
      },
      replace(content) {
        // A merge into the note: not typed here, so Cancel keeps it.
        if (content.trim() !== baseRef.current) othersRef.current.push({ from: baseRef.current, to: content.trim() });
        draftRef.current = content;
        lastSavedRef.current = content.trim();
        baseRef.current = content.trim();
        confirmedRef.current = content.trim();
        queuedRef.current = null;
        setDraft(content);
        confirmNoteDraft(noteId, content.trim());
        setConfirmed(content.trim());
        setFailed(null);
      },
      save,
    };
    openDrafts.set(noteId, handle);
    return () => {
      open = false;
      // A closed editor whose saves are still on their way stays the note's
      // one sender until they answer: the notes' retry leaves the note to
      // it, and a save asked for meanwhile goes after them. Read after this
      // commit's other cleanups, so the close write counts among them.
      void Promise.resolve()
        .then(() => chainRef.current)
        .then(() => {
          if (openDrafts.get(noteId) === handle) openDrafts.delete(noteId);
        });
    };
  }, [active, canEdit, noteId, save]);

  useEffect(() => {
    if (!active || !canEdit) return;
    // The same editor goes on for the new note (its card kept its key): its
    // text is the one on screen, and nothing waits to be handed to it.
    handedText.delete(noteId);
    const send = (body: Record<string, unknown>, confirm: string | null) => {
      const account = tabAccount();
      // The local draft stays: a keepalive request cannot report back, so the
      // next load checks the server and clears or replays it.
      return fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify(body),
      })
        .then((res) => {
          if (res.ok && confirm !== null) confirmNoteDraft(noteId, confirm);
        })
        .catch(() => {});
    };
    // The window closes: the words go now. With no save on its way, the
    // sources of the quotes the sitting removed go in the same write; with
    // one on its way they stay (a source kept is never a loss).
    const flush = () => {
      const trimmed = draftRef.current.trim();
      const idle = sendingRef.current === null;
      const prune = idle && lastSavedRef.current.trim() !== openedRef.current ? { pruneSourcesFrom: openedRef.current } : {};
      if (!trimmed || trimmed === lastSavedRef.current) {
        if ("pruneSourcesFrom" in prune) void send(prune, null);
        return;
      }
      lastSavedRef.current = trimmed;
      // Made from the save on its way, else the last one; the tab is going
      // away and cannot read a 409, so the route puts the texts together.
      void send(
        { content: trimmed, baseContent: sendingRef.current ?? baseRef.current, onConflict: "keep", keepSources: true, ...prune },
        trimmed,
      );
    };
    // The editor closes: the last words save after the saves before them,
    // and the sources of the quotes the sitting removed go with them. The
    // words sent are the ones the editor holds once those saves answered:
    // the text they brought back, with the reader's words on top. After
    // Cancel, the words are the text Cancel left: made from the text the
    // last save left, so the route keeps words that landed since, and the
    // sources stay but those of quotes the opened text had and the note no
    // longer has. Its History entry is its own, so the text before Cancel
    // stays a version.
    const close = () => {
      const trimmed = draftRef.current.trim();
      const typed = Boolean(trimmed) && trimmed !== lastSavedRef.current;
      if (typed) lastSavedRef.current = trimmed;
      else if (lastSavedRef.current.trim() === openedRef.current) return;
      const opened = openedRef.current;
      const canceled = canceledRef.current;
      const write = chainRef.current.then(() => {
        const words = draftRef.current.trim() || trimmed;
        if (typed) lastSavedRef.current = words;
        const changed = typed && words !== baseRef.current;
        if (!changed && lastSavedRef.current.trim() === opened) return;
        return send(
          changed
            ? {
                content: words,
                baseContent: baseRef.current,
                onConflict: "keep",
                pruneSourcesFrom: opened,
                ...(canceled ? { keepSources: true, newEdit: true } : {}),
              }
            : { pruneSourcesFrom: opened },
          changed ? words : null,
        );
      });
      const done = write.catch(() => {});
      chainRef.current = done;
      closing.set(noteId, done);
      void done.then(() => {
        if (closing.get(noteId) === done) closing.delete(noteId);
      });
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      // A new Group by: the note's new card takes this editor over, and
      // closes it only when no new card does (carryNoteEditors).
      if (carrying.has(noteId) && !carried.has(noteId)) {
        carried.set(noteId, {
          text: draftRef.current,
          chain: chainRef.current,
          state: () => ({
            draft: draftRef.current,
            base: baseRef.current,
            lastSaved: lastSavedRef.current,
            confirmed: confirmedRef.current,
            queued: queuedRef.current,
            opened: openedRef.current,
            original: originalRef.current,
            others: othersRef.current,
          }),
          close,
        });
        return;
      }
      const to = handedOff.get(noteId);
      if (to !== undefined) {
        handedOff.delete(noteId);
        const text = draftRef.current;
        const target = readNoteDraft(to);
        if (text.trim()) {
          writeNoteDraft(to, text, target?.base ?? lastSavedRef.current);
          handedText.set(to, text);
        }
        clearNoteDraft(noteId);
        return;
      }
      close();
    };
  }, [active, canEdit, noteId]);

  /** Cancel: the draft goes back to the text the editor opened on, with
      every other writer's change since put back on it; the close writes it.
      Returns that text. */
  function cancel(): string {
    let back = originalRef.current;
    for (const { from, to } of othersRef.current) back = reconcileNoteText(from, to, back.trim(), conflictLabels()).text;
    canceledRef.current = true;
    draftRef.current = back;
    setDraft(back);
    // The user gave the edit up: the local draft must not replay it.
    clearNoteDraft(noteId);
    // Offline the close cannot land now: the local draft holds the text
    // Cancel left until it does. Online the close lands at once; a draft
    // replayed after it would be made from a text the note no longer has.
    if (isOffline() && lastSavedRef.current !== back.trim()) writeNoteDraft(noteId, back, baseRef.current);
    return back;
  }

  /** Save: the caller writes `content` itself, so the flush must not write the draft again. */
  function markSaved(content: string) {
    draftRef.current = draft;
    lastSavedRef.current = content;
  }

  /** The caller's own save landed: the local draft holding `content` is done. */
  function confirmSaved(content: string) {
    confirmNoteDraft(noteId, content);
    setConfirmed(content.trim());
  }

  const trimmed = draft.trim();
  const saveState: SaveState =
    !trimmed || trimmed === confirmed
      ? trimmed && trimmed === both
        ? "both"
        : trimmed && trimmed === queued
          ? "offline"
          : "saved"
      : trimmed === failed
        ? "failed"
        : "saving";

  return { draft, setDraft, cancel, markSaved, confirmSaved, saveState, getOriginal: () => originalRef.current };
}
