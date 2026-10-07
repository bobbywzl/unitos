"use client";

// [view2] GR-18: the graph's data loads when the graph opens, from
// GET /api/notebooks/<id>/graph, so the workspace page no longer carries it
// on every load and every sync refresh. The nodes are the page's documents
// at once; the rest lands with the fetch. The fetch runs again when the
// project's rev moves while the graph is open (a collaborator's link, the
// reader's own Accept, a Stitch answer: each bumps the rev and refreshes the
// page). A tab keeps the last answer per project, so a reopen draws at once.
// Offline, the service worker answers from the project's offline copy.
// COST3-04: each refetch sends the last answer's ETag, and a 304 (nothing the
// graph shows changed) keeps the last answer. COST3-03: the answer has no
// link titles (put back here from the nodes) and no provenance links until
// some part of the graph asks for them (provenance-want.ts).

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import type { GraphData } from "@/lib/graph/data";
import type { GraphEdge, GraphNode, RecommendedLinkView } from "@/lib/types";
import type { DocumentKind } from "@/lib/document-order";
import { CollabProvider, useCollab } from "@/components/collab/collab-context";
import { GraphOverlay } from "@/components/graph/graph-overlay";
import { clearLinkPassages } from "@/components/graph/link-passages";
import { useProvenanceWanted } from "@/components/graph/provenance-want";

const lastData = new Map<string, { data: GraphData; etag: string | null; provenance: boolean }>();

type OverlayProps = ComponentProps<typeof GraphOverlay>;

export function GraphOverlayLoader({
  notebookId,
  rev,
  documents,
  ...rest
}: Omit<OverlayProps, "nodes" | "edges" | "recommended" | "generated" | "linkScansLeft" | "gists" | "loading" | "loadFailed"> & {
  rev: number;
  documents: { id: string; title: string; hasVideo: boolean; kind?: DocumentKind }[];
}) {
  const collab = useCollab();
  const [data, setData] = useState<GraphData | null>(() => lastData.get(notebookId)?.data ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // An answer without the provenance links is fetched again with them when
  // asked; one with them serves until the next rev move, which fetches the
  // lighter answer when nothing asks any more.
  const wanted = useProvenanceWanted();
  const fetchedAt = useRef<string | null>(null);
  useEffect(() => {
    const kept = lastData.get(notebookId);
    const at = `${notebookId}|${rev}|${attempt}`;
    if (!wanted && kept?.provenance && fetchedAt.current === at) return;
    const provenance = wanted;
    const controller = new AbortController();
    const etag = kept && kept.provenance === provenance ? kept.etag : null;
    fetch(`/api/notebooks/${notebookId}/graph${provenance ? "?provenance=1" : ""}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: etag ? { "If-None-Match": etag } : {},
    })
      .then(async (r) => {
        if (r.status === 304 && kept) {
          fetchedAt.current = at;
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as GraphData;
        lastData.set(notebookId, { data: d, etag: r.headers.get("etag"), provenance: d.provenance });
        clearLinkPassages(notebookId);
        fetchedAt.current = at;
        setData(d);
      })
      .then(() => setFailed(false))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [notebookId, rev, attempt, wanted]);

  const nodes = useMemo<GraphNode[]>(
    () =>
      documents.map((d) => ({
        id: d.id,
        title: d.title,
        hasVideo: d.hasVideo,
        ...(d.kind ? { kind: d.kind } : {}),
        ...(data ? { blockCount: data.blockCounts[d.id] ?? 0 } : {}),
      })),
    [documents, data],
  );
  // Only the page's documents: a document added since the last fetch draws
  // its curves on the next one.
  // Each link's titles come from the nodes (the route leaves them out).
  const edges = useMemo<GraphEdge[]>(() => {
    const titleOf = new Map(documents.map((d) => [d.id, d.title]));
    return (data?.edges ?? [])
      .filter((e) => titleOf.has(e.a) && titleOf.has(e.b))
      .map((e) => ({
        ...e,
        links: e.links.map((l) => ({
          ...l,
          fromTitle: titleOf.get(l.fromDocumentId) ?? "",
          toTitle: titleOf.get(l.toDocumentId) ?? "",
        })),
      }));
  }, [data, documents]);
  const recommended = useMemo<RecommendedLinkView[]>(() => {
    const byId = new Map(edges.flatMap((e) => e.links).map((l) => [l.id, l]));
    return (data?.recommendedIds ?? []).flatMap((id) => {
      const l = byId.get(id);
      return l
        ? [
            {
              id: l.id,
              fromDocumentId: l.fromDocumentId,
              fromTitle: l.fromTitle,
              toDocumentId: l.toDocumentId,
              toTitle: l.toTitle,
              quotedText: l.quotedText,
              toQuotedText: l.toQuotedText,
              reason: l.reason,
              createdById: l.createdById ?? null,
              replies: l.replies ?? [],
              ...(l.crossAccount ? { crossAccount: l.crossAccount } : {}),
            },
          ]
        : [];
    });
  }, [data, edges]);
  // The people who made the graph's links and replied on them, for their badges.
  const scoped = useMemo(
    () => (data ? { ...collab, people: { ...data.people, ...collab.people } } : collab),
    [collab, data],
  );

  return (
    <CollabProvider value={scoped}>
      <GraphOverlay
        {...rest}
        notebookId={notebookId}
        nodes={nodes}
        edges={edges}
        recommended={recommended}
        generated={data?.generated ?? []}
        linkScansLeft={data?.linkScansLeft ?? 0}
        gists={data?.gists}
        loading={data === null && !failed}
        loadFailed={data === null && failed ? () => setAttempt((n) => n + 1) : undefined}
      />
    </CollabProvider>
  );
}
