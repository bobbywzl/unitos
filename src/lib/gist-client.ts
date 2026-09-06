"use client";

import { useEffect, useSyncExternalStore } from "react";
import { clipWords } from "@/lib/markdown-preview";
import { GIST_MAX_CHARS } from "@/lib/prompts/gist";

// Gists fetched this session, by note id (SPEC.md §6). A collapsed row that
// renders without a stored gist asks once for its content; the asks of one
// frame go out as one POST /api/notes/gist. Until the gist arrives the row
// shows the note's first words, cut at a word boundary — never an ellipsis.
type Entry = { content: string; gist: string };
const fetched = new Map<string, Entry>();
const asked = new Map<string, string>(); // note id → the content it was asked for
let queue: { id: string; content: string }[] = [];
let timer: number | null = null;
const listeners = new Set<() => void>();
const BATCH_MS = 80;

function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  if (batch.length === 0) return;
  void fetch("/api/notes/gist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ noteIds: batch.map((b) => b.id) }),
  })
    .then((res) => (res.ok ? (res.json() as Promise<{ gists?: Record<string, string> }>) : null))
    .then((data) => {
      if (!data?.gists) return;
      for (const { id, content } of batch) {
        const gist = data.gists[id];
        if (gist) fetched.set(id, { content, gist });
      }
      for (const l of listeners) l();
    })
    .catch(() => {});
}

function ask(id: string, content: string) {
  if (asked.get(id) === content) return;
  asked.set(id, content);
  queue.push({ id, content });
  if (timer === null) timer = window.setTimeout(flush, BATCH_MS);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The line a collapsed row shows: the stored gist, else the one fetched this
    session for this content, else the first words. wanted: the row is
    collapsed, so a missing gist is asked for. plainText is the note's text
    with the markdown taken off (lib/markdown-preview.ts). */
export function useGist(
  noteId: string,
  stored: string | null,
  plainText: string,
  wanted: boolean,
): string {
  const got = useSyncExternalStore(
    subscribe,
    () => {
      const entry = fetched.get(noteId);
      return entry && entry.content === plainText ? entry.gist : null;
    },
    () => null,
  );
  useEffect(() => {
    if (wanted && stored === null && got === null) ask(noteId, plainText);
  }, [wanted, stored, got, noteId, plainText]);
  return stored ?? got ?? clipWords(plainText, GIST_MAX_CHARS);
}
