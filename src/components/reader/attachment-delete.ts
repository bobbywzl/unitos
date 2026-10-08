"use client";

// Delete stored extractions (Extract) or a stored match (Match-it) with no
// ask (SPEC.md §4, §13): the notes' Undo pill takes it (postUndoPill,
// lib/notes/undo-pill.ts: 12 s, ✕, Ctrl+Z presses Undo). The rows leave the
// screen at once; the PATCH that removes them waits for the pill to go
// without Undo, and is keepalive so a page closing sends it. A page with no
// pill on it deletes at once.

import { postUndoPill } from "@/lib/notes/undo-pill";

// A delete whose pill is up is written down in sessionStorage until it lands
// or Undo takes it back: a reload while the pill shows sends the PATCH on
// pagehide, and the new page can render before it lands, so the new page
// hides those rows and sends the PATCH again (resumeDeletes). The PATCH
// filters by id, so a second send changes nothing.
const PENDING_KEY = "unitos-pending-deletes";
type Pending = { key: string; url: string; body: Record<string, unknown>; ids: string[] };

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

async function send(url: string, body: Record<string, unknown>, keepalive: boolean): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    });
    if (res.ok) return true;
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    console.error("delete", url, res.status, json?.error);
  } catch (err) {
    console.error("delete", url, err);
  }
  return false;
}

/** The ids of deletes to `url` a page before this one left pending: hide
    them; their PATCH goes again now. */
export function resumeDeletes(url: string): string[] {
  if (typeof window === "undefined") return [];
  const mine = readPending().filter((p) => p.url === url);
  for (const p of mine) {
    void send(p.url, p.body, false).then((ok) => {
      if (ok) forget(p.key);
    });
  }
  return mine.flatMap((p) => p.ids.filter((id): id is string => typeof id === "string"));
}

/** Send `body` to `url` (a PATCH that removes rows) once the pill goes
    without Undo. gone: the rows leave the screen now; back: Undo puts them
    back; failed: the PATCH did not land, the rows are back (the technical
    reason goes to the console). */
export function deleteWithUndo({
  url,
  body,
  ids,
  message,
  gone,
  back,
  failed,
}: {
  url: string;
  body: Record<string, unknown>;
  /** The rows the PATCH removes, for a page after a reload to hide. */
  ids: string[];
  message: string;
  gone: () => void;
  back: () => void;
  failed: () => void;
}): boolean {
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  writePending([...readPending(), { key, url, body, ids }]);
  gone();
  return postUndoPill({
    message,
    undo: () => {
      forget(key);
      back();
    },
    // keepalive: the pill runs commit when the page closes too.
    commit: async () => {
      const ok = await send(url, body, true);
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
