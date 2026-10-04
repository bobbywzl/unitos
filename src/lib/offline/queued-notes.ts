"use client";

import { useEffect, useState } from "react";
import { WRITES, tx } from "@/lib/offline/db";
import { QUEUE_SYNCED_EVENT, subscribeQueue, type QueuedWrite } from "@/lib/offline/queue";
import type { NoteView, SectionView } from "@/lib/types";

// Notes saved offline, drawn in the notes while they wait (SPEC.md §17). A
// note write that queued has no answer from the server, so the notes would
// show nothing of it until the queue syncs, and a reader who sees no note
// types it again. The queue itself is read instead: a queued create (it
// carries its id, lib/api.ts) is drawn in its section, a queued edit puts its
// text on the note, a queued delete takes the note away; each such note is
// marked as waiting to sync (`queued`). The marks go when the queue drains
// and the refresh brings the server's copy. Read from IndexedDB, so a reload
// while offline still draws them.

const NOTE_PATH = /^\/api\/notes(?:\/([^/]+))?$/;
// A note that just left the queue stays drawn this long, unmarked, while the
// refresh that brings the server's copy is on its way.
const LANDING_MS = 30_000;

export type QueuedCreated = { note: NoteView; sectionId: string; top: boolean };

function isNoteWrite(record: QueuedWrite): boolean {
  return NOTE_PATH.test(record.path) && (record.method !== "POST" || record.path === "/api/notes");
}

async function readNoteWrites(): Promise<QueuedWrite[]> {
  try {
    const all = await tx<QueuedWrite[]>(WRITES, "readonly", (s) => s.getAll() as IDBRequest<QueuedWrite[]>);
    return all.filter(isNoteWrite);
  } catch {
    return [];
  }
}

function field(body: unknown, key: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;
}

/** The notes the queued creates make, by id. */
function createdNotes(writes: QueuedWrite[]): Map<string, QueuedCreated> {
  const made = new Map<string, QueuedCreated>();
  for (const w of writes) {
    if (w.method !== "POST") continue;
    const id = field(w.body, "id");
    const sectionId = field(w.body, "sectionId");
    const content = field(w.body, "content");
    if (typeof id !== "string" || typeof sectionId !== "string" || typeof content !== "string") continue;
    const source = field(w.body, "source");
    const sourceDoc = field(source, "documentId");
    const documentId = field(w.body, "documentId");
    const pending = field(w.body, "pending") === true || (field(w.body, "origin") ?? "assistant") !== "assistant";
    made.set(id, {
      sectionId,
      top: field(w.body, "top") === true,
      note: {
        id,
        content,
        gist: null,
        status: pending ? "PENDING" : "ACCEPTED",
        derivationType: null,
        pinned: false,
        order: 0,
        createdById: null,
        updatedAt: new Date(w.queuedAt).toISOString(),
        createdAt: new Date(w.queuedAt).toISOString(),
        documentId: typeof sourceDoc === "string" ? sourceDoc : typeof documentId === "string" ? documentId : null,
        sources: [],
        replies: [],
        queued: true,
      },
    });
  }
  return made;
}

/** The tree with the queued note writes drawn in it. `landed`: notes whose
    create just synced, drawn unmarked until the tree has them. */
export function overlayQueuedNotes(
  sections: SectionView[],
  writes: QueuedWrite[],
  landed: ReadonlyMap<string, QueuedCreated> = new Map(),
): SectionView[] {
  if (writes.length === 0 && landed.size === 0) return sections;
  const created = createdNotes(writes);
  // The text each queued edit leaves, in queue order; null = deleted.
  const texts = new Map<string, string | null>();
  for (const w of writes) {
    const id = NOTE_PATH.exec(w.path)?.[1];
    if (!id) continue;
    if (w.method === "DELETE") {
      texts.set(id, null);
      continue;
    }
    const content = field(w.body, "content");
    const append = field(w.body, "append");
    if (typeof content === "string") texts.set(id, content);
    else if (typeof append === "string") {
      // Appended to the text the note holds then: kept as the words to add.
      const before = texts.get(id);
      texts.set(id, before === undefined ? `\u0000${append}` : before === null ? null : `${before.replace(/\n+$/, "")}\n\n${append}`);
    }
  }
  const textOf = (note: NoteView): NoteView | null => {
    if (!texts.has(note.id)) return note;
    const text = texts.get(note.id) ?? null;
    if (text === null) return null;
    const content = text.startsWith("\u0000")
      ? (() => {
          const head = note.content.replace(/\n+$/, "");
          const words = text.slice(1);
          return head ? `${head}\n\n${words}` : words;
        })()
      : text;
    return { ...note, content, queued: true };
  };
  const shown = new Set<string>();
  const walk = (s: SectionView): SectionView => {
    const notes = s.notes.flatMap((n) => {
      shown.add(n.id);
      const next = textOf(n);
      return next ? [next] : [];
    });
    const extra = (made: Map<string, QueuedCreated> | ReadonlyMap<string, QueuedCreated>) =>
      [...made.values()].filter((c) => c.sectionId === s.id && !s.notes.some((n) => n.id === c.note.id));
    const top: NoteView[] = [];
    const end: NoteView[] = [];
    for (const c of [...extra(landed), ...extra(created)]) {
      const note = textOf(c.note);
      if (!note) continue;
      (c.top ? top : end).push(note);
    }
    return { ...s, notes: [...top.reverse(), ...notes, ...end], children: s.children.map(walk) };
  };
  return sections.map(walk);
}

/** The queued note writes, read again whenever the queue changes; and the
    notes whose create just synced, until the refresh brings them. */
export function useQueuedNoteWrites(): { writes: QueuedWrite[]; landed: ReadonlyMap<string, QueuedCreated> } {
  const [state, setState] = useState<{ writes: QueuedWrite[]; landed: ReadonlyMap<string, QueuedCreated> }>({
    writes: [],
    landed: new Map(),
  });
  useEffect(() => {
    let alive = true;
    const read = () =>
      void readNoteWrites().then((writes) => {
        if (!alive) return;
        setState((prev) => {
          const now = createdNotes(writes);
          const landed = new Map<string, QueuedCreated>();
          // A create that left the queue: drawn until the refresh lands.
          for (const [id, c] of createdNotes(prev.writes)) {
            if (!now.has(id)) landed.set(id, { ...c, note: { ...c.note, queued: false } });
          }
          for (const [id, c] of prev.landed) if (!now.has(id) && !landed.has(id)) landed.set(id, c);
          if (prev.writes.length === 0 && writes.length === 0 && landed.size === prev.landed.size) return prev;
          return { writes, landed };
        });
      });
    read();
    const stop = subscribeQueue(read);
    // The refresh after a sync brings the server's copies; a note that did not
    // come back (the server refused it) is not drawn past LANDING_MS.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSynced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setState((prev) => ({ ...prev, landed: new Map() })), LANDING_MS);
    };
    window.addEventListener(QUEUE_SYNCED_EVENT, onSynced);
    return () => {
      alive = false;
      stop();
      if (timer) clearTimeout(timer);
      window.removeEventListener(QUEUE_SYNCED_EVENT, onSynced);
    };
  }, []);
  return state;
}
