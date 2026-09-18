import { db } from "@/lib/db";
import type { GeneratedDocumentView, GraphEdge, GraphNode, RecommendedLinkView } from "@/lib/types";

// The graph's data (SPEC.md §13, §22): the nodes, the edges, the recommended
// links, and the generated documents Stitch wrote for the project.

/** Every generated document of the project, newest first (SPEC.md §22):
    the attached documents that carry a Stitch command. */
export async function listGenerated(notebookId: string): Promise<GeneratedDocumentView[]> {
  const rows = await db.notebookDocument.findMany({
    where: { notebookId, document: { generatedCommand: { not: null } } },
    orderBy: { document: { createdAt: "desc" } },
    select: {
      document: {
        select: {
          id: true,
          title: true,
          generatedCommand: true,
          createdAt: true,
          _count: { select: { blocks: true } },
        },
      },
    },
  });
  return rows.map(({ document: g }) => ({
    id: g.id,
    title: g.title,
    command: g.generatedCommand,
    createdAt: g.createdAt.toISOString(),
    blockCount: g._count.blocks,
  }));
}

/** The graph among a set of documents: nodes, one edge per linked pair, and
    the recommended links awaiting Accept (SPEC.md §13). */
export async function documentsGraph(
  documents: { id: string; title: string; hasVideo: boolean }[],
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; recommended: RecommendedLinkView[] }> {
  const ids = documents.map((d) => d.id);
  const [links, recommendedRows] = await Promise.all([
    db.docLink.findMany({
      where: { fromDocumentId: { in: ids }, toDocumentId: { in: ids } },
      orderBy: [{ recommended: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        fromDocumentId: true,
        toDocumentId: true,
        fromBlockId: true,
        toBlockId: true,
        recommended: true,
        reason: true,
        quotedText: true,
        toQuotedText: true,
      },
    }),
    db.docLink.findMany({
      where: { recommended: true, fromDocumentId: { in: ids }, toDocumentId: { in: ids } },
      orderBy: { createdAt: "desc" },
      include: {
        fromDocument: { select: { title: true } },
        toDocument: { select: { title: true } },
        replies: { orderBy: { createdAt: "asc" } },
      },
    }),
  ]);
  // The block each end's quote sits in: the passage an expanded link shows
  // around the quote (SPEC.md §13). A block a re-parse replaced is gone
  // until the reader opens the document and the link heals; the end then
  // shows its quote alone.
  const blockIds = [
    ...new Set(
      [...links, ...recommendedRows].flatMap((l) => [l.fromBlockId, l.toBlockId ?? ""]).filter(Boolean),
    ),
  ];
  const blockText = new Map(
    blockIds.length > 0
      ? (await db.block.findMany({ where: { id: { in: blockIds } }, select: { id: true, text: true } })).map(
          (b) => [b.id, b.text] as const,
        )
      : [],
  );
  const titleOf = new Map(documents.map((d) => [d.id, d.title]));
  const nodes: GraphNode[] = documents.map((d) => ({ id: d.id, title: d.title, hasVideo: d.hasVideo }));
  const edgeByPair = new Map<string, GraphEdge>();
  for (const link of links) {
    if (link.fromDocumentId === link.toDocumentId) continue;
    const [a, b] = [link.fromDocumentId, link.toDocumentId].sort();
    const edge = edgeByPair.get(`${a}|${b}`) ?? { a, b, accepted: 0, recommended: 0, links: [] };
    if (link.recommended) edge.recommended++;
    else edge.accepted++;
    edge.links.push({
      id: link.id,
      fromDocumentId: link.fromDocumentId,
      fromTitle: titleOf.get(link.fromDocumentId) ?? "",
      toDocumentId: link.toDocumentId,
      toTitle: titleOf.get(link.toDocumentId) ?? "",
      quotedText: link.quotedText,
      toQuotedText: link.toQuotedText,
      fromBlockText: blockText.get(link.fromBlockId) ?? null,
      toBlockText: link.toBlockId ? (blockText.get(link.toBlockId) ?? null) : null,
      reason: link.reason,
      recommended: link.recommended,
    });
    edgeByPair.set(`${a}|${b}`, edge);
  }
  const recommended: RecommendedLinkView[] = recommendedRows.map((link) => ({
    id: link.id,
    fromDocumentId: link.fromDocumentId,
    fromTitle: link.fromDocument.title,
    toDocumentId: link.toDocumentId,
    toTitle: link.toDocument.title,
    quotedText: link.quotedText,
    toQuotedText: link.toQuotedText,
    fromBlockText: blockText.get(link.fromBlockId) ?? null,
    toBlockText: link.toBlockId ? (blockText.get(link.toBlockId) ?? null) : null,
    reason: link.reason,
    createdById: link.createdById,
    replies: link.replies.map((r) => ({
      id: r.id,
      content: r.content,
      userId: r.userId,
      resolvedById: r.resolvedById,
      createdAt: r.createdAt.toISOString(),
    })),
  }));
  return { nodes, edges: [...edgeByPair.values()], recommended };
}
