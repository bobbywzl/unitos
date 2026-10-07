import { db } from "@/lib/db";
import { peopleByIds } from "@/lib/collab";
import { linkScanRunsLeft } from "@/lib/connect";
import { documentsGraph, listGenerated } from "@/lib/graph/view";
import { SKELETON_VERSION } from "@/lib/graph/skeleton";
import type { Person } from "@/lib/person";
import type { GeneratedDocumentView, GraphEdge } from "@/lib/types";

// The graph's data, loaded when the graph opens (GET /api/notebooks/<id>/
// graph, SPEC.md §13): the workspace page no longer carries it, so a page
// load and every sync refresh skip it. The nodes are the page's documents;
// this adds what the graph alone reads: each document's length and gist,
// the edges with their links, the recommended links (ids into the edges'
// links, so none ships twice), the generated documents, the runs of
// Recommend links left, and the people who made the links and replied.

export type GraphData = {
  blockCounts: Record<string, number>;
  /** The skeleton's gist per document; a document without one is absent. */
  gists: Record<string, string>;
  edges: GraphEdge[];
  /** The recommended links, newest first: ids into edges[].links. */
  recommendedIds: string[];
  generated: GeneratedDocumentView[];
  linkScansLeft: number;
  people: Record<string, Person>;
};

/** Each document's gist, read from the stored skeleton without its lines. */
export async function documentGists(notebookId: string): Promise<Record<string, string>> {
  const rows = await db.$queryRaw<{ id: string; gist: string | null }[]>`
    SELECT d.id, d.skeleton->>'gist' AS gist
    FROM "Document" d
    JOIN "NotebookDocument" nd ON nd."documentId" = d.id
    WHERE nd."notebookId" = ${notebookId}
      AND jsonb_typeof(d.skeleton) = 'object'
      AND (d.skeleton->>'v') = ${String(SKELETON_VERSION)}
  `;
  return Object.fromEntries(rows.filter((r) => r.gist && r.gist.trim()).map((r) => [r.id, r.gist!.trim()]));
}

export async function graphData(notebookId: string, userId: string | null): Promise<GraphData> {
  const attached = await db.notebookDocument.findMany({
    where: { notebookId },
    orderBy: { document: { createdAt: "asc" } },
    select: { document: { select: { id: true, title: true, video: { select: { id: true } } } } },
  });
  const documents = attached.map(({ document: d }) => ({ id: d.id, title: d.title, hasVideo: d.video !== null }));
  const [graph, generated, linkScansLeft, gists] = await Promise.all([
    documentsGraph(documents, notebookId),
    listGenerated(notebookId),
    linkScanRunsLeft(userId),
    documentGists(notebookId),
  ]);
  const authorIds = new Set<string>();
  for (const e of graph.edges) {
    for (const l of e.links) {
      if (l.createdById) authorIds.add(l.createdById);
      for (const r of l.replies ?? []) authorIds.add(r.userId);
    }
  }
  return {
    blockCounts: Object.fromEntries(graph.nodes.map((n) => [n.id, n.blockCount ?? 0])),
    gists,
    edges: graph.edges,
    recommendedIds: graph.recommended.map((r) => r.id),
    generated,
    linkScansLeft,
    people: await peopleByIds(authorIds),
  };
}
