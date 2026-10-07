import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { peopleByIds } from "@/lib/collab";
import { linkScanRunsLeft } from "@/lib/connect";
import { documentsGraph, listGenerated } from "@/lib/graph/view";
import { SKELETON_VERSION } from "@/lib/graph/skeleton";
import type { Person } from "@/lib/person";
import type { GeneratedDocumentView, GraphEdge, GraphEdgeLink } from "@/lib/types";

// The graph's data, loaded when the graph opens (GET /api/notebooks/<id>/
// graph, SPEC.md §13): the workspace page no longer carries it, so a page
// load and every sync refresh skip it. The nodes are the page's documents;
// this adds what the graph alone reads: each document's length and gist,
// the edges with their links, the recommended links (ids into the edges'
// links, so none ships twice), the generated documents, the runs of
// Recommend links left, and the people who made the links and replied.
// What it leaves out (COST3-03): each link's titles (the nodes carry them;
// graph-data.tsx puts them back), each end's whole block (the link panel
// reads it when the link opens, graph/passages), and a generated document's
// provenance links unless asked (?provenance=1): the edges count them, and
// the graph lists them only while the provenance switch is on or a card
// that holds them is open.

/** A link as the route sends it: no titles, no block texts. */
export type GraphWireLink = Omit<GraphEdgeLink, "fromTitle" | "toTitle" | "fromBlockText" | "toBlockText">;
export type GraphWireEdge = Omit<GraphEdge, "links"> & { links: GraphWireLink[] };

export type GraphData = {
  blockCounts: Record<string, number>;
  /** The skeleton's gist per document; a document without one is absent. */
  gists: Record<string, string>;
  edges: GraphWireEdge[];
  /** The edges' links hold the provenance links (?provenance=1). Without
      it, an edge's provenance links are its `provenance` count alone. */
  provenance: boolean;
  /** The recommended links, newest first: ids into edges[].links. */
  recommendedIds: string[];
  generated: GeneratedDocumentView[];
  linkScansLeft: number;
  people: Record<string, Person>;
};

/** Each document's gist, read from the stored skeleton without its lines,
    in id order so the body (and its ETag) is the same while nothing changes. */
export async function documentGists(notebookId: string): Promise<Record<string, string>> {
  const rows = await db.$queryRaw<{ id: string; gist: string | null }[]>`
    SELECT d.id, d.skeleton->>'gist' AS gist
    FROM "Document" d
    JOIN "NotebookDocument" nd ON nd."documentId" = d.id
    WHERE nd."notebookId" = ${notebookId}
      AND jsonb_typeof(d.skeleton) = 'object'
      AND (d.skeleton->>'v') = ${String(SKELETON_VERSION)}
    ORDER BY d.id
  `;
  return Object.fromEntries(rows.filter((r) => r.gist && r.gist.trim()).map((r) => [r.id, r.gist!.trim()]));
}

/** viewer: the account asking. A link with no project shared across
    accounts carries crossAccount for it (SPEC.md §13), so the graph hides
    the changes the viewer may not make. */
export async function graphData(
  notebookId: string,
  viewer: User,
  { provenance = false }: { provenance?: boolean } = {},
): Promise<GraphData> {
  const attached = await db.notebookDocument.findMany({
    where: { notebookId },
    orderBy: { document: { createdAt: "asc" } },
    select: { document: { select: { id: true, title: true, generatedCommand: true, video: { select: { id: true } } } } },
  });
  // A generated document's kind tells its provenance links apart (SPEC.md
  // §22); the nodes' other kinds come from the page.
  const documents = attached.map(({ document: d }) => ({
    id: d.id,
    title: d.title,
    hasVideo: d.video !== null,
    ...(d.generatedCommand !== null ? { kind: "generated" as const } : {}),
  }));
  const [graph, generated, linkScansLeft, gists] = await Promise.all([
    documentsGraph(documents, notebookId, viewer),
    listGenerated(notebookId),
    linkScanRunsLeft(viewer.id),
    documentGists(notebookId),
  ]);
  const edges: GraphWireEdge[] = graph.edges.map((e) => ({
    ...e,
    links: e.links
      .filter((l) => provenance || !l.provenance)
      .map((l): GraphWireLink => {
        const wire: GraphWireLink & { fromTitle?: string; toTitle?: string } = { ...l };
        delete wire.fromTitle;
        delete wire.toTitle;
        return wire;
      }),
  }));
  const authorIds = new Set<string>();
  for (const e of edges) {
    for (const l of e.links) {
      if (l.createdById) authorIds.add(l.createdById);
      for (const r of l.replies ?? []) authorIds.add(r.userId);
    }
  }
  return {
    blockCounts: Object.fromEntries(graph.nodes.map((n) => [n.id, n.blockCount ?? 0])),
    gists,
    edges,
    provenance,
    recommendedIds: graph.recommended.map((r) => r.id),
    generated,
    linkScansLeft,
    people: await peopleByIds(authorIds),
  };
}
