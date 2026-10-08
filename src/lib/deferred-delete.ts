"use client";

// A delete the reader starts asks nothing (SPEC.md §6): what it removes
// leaves the screen at once and the notes' Undo pill takes it (postUndoPill,
// lib/notes/undo-pill.ts: 12 s, ✕, Ctrl+Z presses Undo). The request that
// removes it waits for the pill to go without Undo, and is keepalive so a
// page closing sends it. A page with no pill on it deletes at once. Used by
// stored extractions and matches (a PATCH on the attachment or the project)
// and by annotations and conversations (DELETE /api/notes/:id, which keeps
// the note for History's Restore).

import { postUndoPill } from "@/lib/notes/undo-pill";

// A delete whose pill is up is written down in sessionStorage until it lands
// or Undo takes it back: a reload while the pill shows sends the request on
// pagehide, and the new page can render before it lands, so the new page
// hides those rows and sends the request again (resumeDeletes). A second
// send changes nothing: the PATCH filters by id, and a DELETE of a row
// already gone answers 404.
const PENDING_KEY = "unitos-pending-deletes";
type Method = "PATCH" | "DELETE";
type Pending = { key: string; url: string; method: Method; body: Record<string, unknown> | null; ids: string[] };

function readPending(): Pending[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (p): p is Pending =>
            !!p &&
            typeof p === "object" &&
            typeof (p as Pending).key === "string" &&
            typeof (p as Pending).url === "string" &&
            ((p as Pending).method === "PATCH" || (p as Pending).method === "DELETE") &&
            Array.isArray((p as Pending).ids),
        )
      : [];
  } catch {
    return [];
  }
}

function writePending(list: Pending[]) {
  try {
    if (list.length === 0) sessionStorage.removeItem(PENDING_KEY);
    else sessionStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the pill's own commit still runs.
  }
}

function forget(key: string) {
  writePending(readPending().filter((p) => p.key !== key));
}

async function send(p: Omit<Pending, "key" | "ids">, keepalive: boolean): Promise<boolean> {
  const { url, method, body } = p;
  try {
    const res = await fetch(url, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      keepalive,
    });
    // A DELETE of a row already gone has nothing left to do.
    if (res.ok || (method === "DELETE" && res.status === 404)) return true;
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    console.error("delete", url, res.status, json?.error);
  } catch (err) {
    console.error("delete", url, err);
  }
  return false;
}

/** The ids of deletes a page before this one left pending, to the urls
    `match` takes: hide them; their request goes again now. */
export function resumeDeletes(match: (url: string) => boolean): string[] {
  if (typeof window === "undefined") return [];
  const mine = readPending().filter((p) => match(p.url));
  for (const p of mine) {
    void send(p, false).then((ok) => {
      if (ok) forget(p.key);
    });
  }
  return mine.flatMap((p) => p.ids.filter((id): id is string => typeof id === "string"));
}

/** Send the request (a PATCH with `body` that removes rows, or a DELETE)
    once the pill goes without Undo. gone: the rows leave the screen now;
    back: Undo puts them back; failed: the request did not land, the rows
    are back (the technical reason goes to the console). */
export function deleteWithUndo({
  url,
  method = "PATCH",
  body = null,
  ids,
  message,
  gone,
  back,
  failed,
}: {
  url: string;
  method?: Method;
  body?: Record<string, unknown> | null;
  /** The rows the PATCH removes, for a page after a reload to hide. */
  ids: string[];
  message: string;
  gone: () => void;
  back: () => void;
  failed: () => void;
}): boolean {
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  writePending([...readPending(), { key, url, method, body, ids }]);
  gone();
  return postUndoPill({
    message,
    undo: () => {
      forget(key);
      back();
    },
    // keepalive: the pill runs commit when the page closes too.
    commit: async () => {
      const ok = await send({ url, method, body }, true);
      if (ok) {
        forget(key);
        return;
      }
      forget(key);
      back();
      failed();
    },
  });
}
