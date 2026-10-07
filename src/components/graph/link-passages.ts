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
    const controller = new AbortController();
    fetch(`/api/notebooks/${notebookId}/graph/passages?linkId=${encodeURIComponent(link.id)}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<LinkPassages>) : null))
      .then((data) => {
        const ends = data ? endsOf(data, link.id) : null;
        if (!ends) return;
        kept.set(key, ends);
        setState({ key, ends });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [need, notebookId, link.id, key]);
  return given ?? (state.key === key ? state.ends : null);
}
