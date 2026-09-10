import { db } from "@/lib/db";
import type {
  GeneratedDocumentView,
  GraphEdge,
  GraphNode,
  MultiUploadSummary,
  MultiUploadView,
  RecommendedLinkView,
} from "@/lib/types";

// The multi upload page's data (SPEC.md §22): the members in order, the
// generated documents newest first, and the graph among the members — the
// same node, edge, and recommended-link shapes the project graph draws
// (SPEC.md §13), scoped to the members.

export async function loadMultiUpload(multiId: string): Promise<MultiUploadView | null> {
  const multi = await db.multiUpload.findUnique({
    where: { id: multiId },
    include: {
      members: {
        orderBy: { order: "asc" },
        include: {
          document: {
            select: {
              id: true,
              title: true,
              sourceUrl: true,
              video: { select: { id: true } },
              _count: { select: { blocks: true } },
            },
          },
        },
      },
      generated: {
        orderBy: { createdAt: "desc" },
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
  if (!multi) return null;
  return {
    id: multi.id,
    notebookId: multi.notebookId,
    title: multi.title,
    createdAt: multi.createdAt.toISOString(),
    members: multi.members.map((m) => ({
      id: m.document.id,
      title: m.document.title,
      hasVideo: m.document.video !== null,
      blockCount: m.document._count.blocks,
      sourceUrl: m.document.sourceUrl,
      order: m.order,
    })),
    generated: multi.generated.map(
      (g): GeneratedDocumentView => ({
        id: g.id,
        title: g.title,
        command: g.generatedCommand,
        createdAt: g.createdAt.toISOString(),
        blockCount: g._count.blocks,
      }),
    ),
  };
}

/** Every multi upload of a project, newest first, for the document bar. */
export async function listMultiUploads(notebookId: string): Promise<MultiUploadSummary[]> {
  const rows = await db.multiUpload.findMany({
    where: { notebookId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, _count: { select: { members: true } } },
  });
  return rows.map((r) => ({ id: r.id, title: r.title, memberCount: r._count.members }));
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
      toDocumentId: link.toDocumentId,
      quotedText: link.quotedText,
      toQuotedText: link.toQuotedText,
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
