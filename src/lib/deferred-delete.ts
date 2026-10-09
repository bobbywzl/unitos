"use client";

// A delete the reader starts asks nothing (SPEC.md §6): what it removes
// leaves the screen at once and the notes' Undo pill takes it (postUndoPill,
// lib/notes/undo-pill.ts: 12 s, ✕, Ctrl+Z presses Undo). The request that
// removes it waits for the pill to go without Undo, and is keepalive so a
// page closing sends it. A page with no pill on it deletes at once. Used by
// stored extractions and matches (a PATCH on the attachment or the project)
// and by annotations and conversations (DELETE /api/notes/:id, which keeps
// the note for History's Restore).

import { api, ApiError } from "@/lib/api";
import { postUndoPill } from "@/lib/notes/undo-pill";
import { isOffline, isServerError } from "@/lib/offline/queue";

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

/** landed: the server took it; queued: it waits in the offline queue and
    lands when the server is back; failed: refused. */
type Sent = "landed" | "queued" | "failed";

async function send(p: Omit<Pending, "key" | "ids">, keepalive: boolean): Promise<Sent> {
  const { url, method, body } = p;
  let reached = !isOffline();
  try {
    if (reached) {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
        keepalive,
      });
      // A DELETE of a row already gone has nothing left to do.
      if (res.ok || (method === "DELETE" && res.status === 404)) return "landed";
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      console.error("delete", url, res.status, json?.error);
      // A server that is down or busy (a 5xx) is no answer: the delete
      // waits in the queue as it does with no network.
      if (!isServerError(res.status)) return "failed";
      reached = false;
    }
  } catch (err) {
    reached = false;
    console.error("delete", url, err);
  }
  if (reached) return "failed";
  // No network, or the server failing: the delete goes in the offline queue,
  // as a delete from the Annotations tab does (lib/api.ts,
  // lib/offline/queue.ts), and lands when the server is back; the row stays
  // hidden. The PATCH of a match or an extraction is taken too (it removes
  // by id, so a second send changes nothing). A write the queue does not
  // take (no offline work on this account) fails as before.
  try {
    const answer = await api<{ queued?: boolean } | null>(url, method, body ?? undefined, { queue: true });
    return answer?.queued === true ? "queued" : "landed";
  } catch (err) {
    if (method === "DELETE" && err instanceof ApiError && err.status === 404) return "landed";
    console.error("delete", url, err);
    return "failed";
  }
}

/** The ids of deletes a page before this one left pending, to the urls
    `match` takes: hide them; their request goes again now. */
export function resumeDeletes(match: (url: string) => boolean): string[] {
  if (typeof window === "undefined") return [];
  const mine = readPending().filter((p) => match(p.url));
  for (const p of mine) {
    // Queued again: the queue holds it once (it drops a write it holds
    // already), and the next page still hides the rows until it lands.
    void send(p, false).then((sent) => {
      if (sent === "landed") forget(p.key);
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
      const sent = await send({ url, method, body }, true);
      // Queued: the rows stay hidden, here and after a reload, until it lands.
      if (sent === "queued") return;
      forget(key);
      if (sent === "landed") return;
      back();
      failed();
    },
  });
}
