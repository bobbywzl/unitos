"use client";

// [view2] GR-18: the graph's data loads when the graph opens, from
// GET /api/notebooks/<id>/graph, so the workspace page no longer carries it
// on every load and every sync refresh. The nodes are the page's documents
// at once; the rest lands with the fetch. The fetch runs again when the
// project's rev moves while the graph is open (a collaborator's link, the
// reader's own Accept, a Stitch answer: each bumps the rev and refreshes the
// page). A tab keeps the last answer per project, so a reopen draws at once.
// Offline, the service worker answers from the project's offline copy.

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import type { GraphData } from "@/lib/graph/data";
import type { GraphNode, RecommendedLinkView } from "@/lib/types";
import type { DocumentKind } from "@/lib/document-order";
import { CollabProvider, useCollab } from "@/components/collab/collab-context";
import { GraphOverlay } from "@/components/graph/graph-overlay";

const lastData = new Map<string, GraphData>();

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
  const [data, setData] = useState<GraphData | null>(() => lastData.get(notebookId) ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/notebooks/${notebookId}/graph`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<GraphData>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        lastData.set(notebookId, d);
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [notebookId, rev, attempt]);

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
  const edges = useMemo(() => {
    const ids = new Set(documents.map((d) => d.id));
    return (data?.edges ?? []).filter((e) => ids.has(e.a) && ids.has(e.b));
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
              fromBlockText: l.fromBlockText,
              toBlockText: l.toBlockText,
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
