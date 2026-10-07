"use client";

import { useEffect, useState } from "react";
import type { LinkPassages } from "@/lib/graph/view";

// The passage each end of a link sits in, read when the link opens
// (COST3-03): GET .../graph/passages?linkId=. The quote shows at once; the
// words around it land with the answer. A tab keeps each answer until the
// graph's data changes (graph-data.tsx clears it), so a reopen draws at once.
// Offline, the service worker answers from the project's offline copy, which
// keeps every link's passages.

export type EndPassages = { from: string | null; to: string | null };

const kept = new Map<string, EndPassages>();

export function clearLinkPassages(notebookId: string): void {
  for (const key of kept.keys()) if (key.startsWith(`${notebookId}:`)) kept.delete(key);
}

function endsOf(data: LinkPassages, linkId: string): EndPassages | null {
  const ends = data.links[linkId];
  if (!ends) return null;
  return { from: data.blocks[ends[0]] ?? null, to: ends[1] ? (data.blocks[ends[1]] ?? null) : null };
}

// One call per link at a time: the link panel's passages and its notes on
// the link (LinkNotes) read the same answer.
const inflight = new Map<string, Promise<EndPassages | null>>();

function passagesOf(notebookId: string, linkId: string, key: string): Promise<EndPassages | null> {
  const running = inflight.get(key);
  if (running) return running;
  const call = fetch(`/api/notebooks/${notebookId}/graph/passages?linkId=${encodeURIComponent(linkId)}`)
    .then((r) => (r.ok ? (r.json() as Promise<LinkPassages>) : null))
    .then((data) => {
      const ends = data ? endsOf(data, linkId) : null;
      if (ends) kept.set(key, ends);
      return ends;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, call);
  return call;
}

/** The link's two passages: given (a link that carries them), kept, or
    fetched. Null until they land; null for good when the call fails, and
    each end then shows its quote alone. */
export function useLinkPassages(
  notebookId: string | undefined,
  link: { id: string; fromBlockText?: string | null; toBlockText?: string | null },
): EndPassages | null {
  const given = link.fromBlockText !== undefined ? { from: link.fromBlockText, to: link.toBlockText ?? null } : null;
  const key = `${notebookId ?? ""}:${link.id}`;
  const [state, setState] = useState<{ key: string; ends: EndPassages | null }>(() => ({ key, ends: kept.get(key) ?? null }));
  if (state.key !== key) setState({ key, ends: kept.get(key) ?? null });
  const need = !given && notebookId !== undefined && !kept.has(key);
  useEffect(() => {
    if (!need || !notebookId) return;
    let live = true;
    passagesOf(notebookId, link.id, key).then((ends) => {
      if (live && ends) setState({ key, ends });
    });
    return () => {
      live = false;
    };
  }, [need, notebookId, link.id, key]);
  return given ?? (state.key === key ? state.ends : null);
}
