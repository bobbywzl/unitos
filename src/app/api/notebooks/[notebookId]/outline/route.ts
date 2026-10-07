import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { contentsEntries, headingContents } from "@/lib/contents";
import { db } from "@/lib/db";
import { outlineParts, partAt, type DocumentOutline } from "@/lib/graph/outline";
import { SKELETON_VERSION } from "@/lib/graph/skeleton";
import { projectLinks } from "@/lib/link-scope";

// One document's outline for the graph's node card (SPEC.md §13): the
// skeleton's gist and part summaries (§22), else the stored contents (§26),
// else the headings, and the part each of its links' ends sits in. Read
// only, never a model call: a document Stitch has not read has no summary,
// and nothing here builds one. The skeleton's lines are never read.

const querySchema = z.object({ documentId: z.string().min(1).max(64) });

export async function GET(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "viewer");
  if (access instanceof NextResponse) return access;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  const { documentId } = parsed.data;
  const [row] = await db.$queryRaw<
    { id: string; title: string; v: string | null; gist: string | null; parts: unknown; contents: unknown }[]
  >`
    SELECT d.id, d.title, d.skeleton->>'v' AS v, d.skeleton->>'gist' AS gist, d.skeleton->'parts' AS parts, d.contents
    FROM "Document" d
    JOIN "NotebookDocument" nd ON nd."documentId" = d.id
    WHERE nd."notebookId" = ${notebookId} AND d.id = ${documentId}
  `;
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = row.v === String(SKELETON_VERSION);
  const skeletonParts = current && Array.isArray(row.parts) ? row.parts.flatMap(partOf) : null;
  const contents = contentsEntries(row.contents);
  const named = [...new Set([...(skeletonParts ?? []).map((p) => p.blockId), ...contents.map((c) => c.blockId)])];
  const [aliveRows, links] = await Promise.all([
    named.length > 0
      ? db.block.findMany({ where: { documentId, id: { in: named } }, select: { id: true, order: true } })
      : Promise.resolve([]),
    db.docLink.findMany({
      where: { AND: [projectLinks(notebookId), { OR: [{ fromDocumentId: documentId }, { toDocumentId: documentId }] }] },
      select: { id: true, fromDocumentId: true, fromBlockId: true, toDocumentId: true, toBlockId: true },
    }),
  ]);
  const orderOf = new Map(aliveRows.map((b) => [b.id, b.order]));
  let { parts, from } = outlineParts(skeletonParts, contents, new Set(orderOf.keys()));
  if (parts.length === 0) {
    const heads = await db.block.findMany({
      where: { documentId, type: "HEADING" },
      orderBy: { order: "asc" },
      select: { id: true, type: true, text: true, html: true, order: true },
    });
    for (const h of heads) orderOf.set(h.id, h.order);
    parts = headingContents(heads, row.title).map((c) => ({ ...c, summary: null }));
    if (parts.length > 0) from = "headings";
  }
  // The part each link end in this document sits in.
  const ends = links.flatMap((l) => [
    ...(l.fromDocumentId === documentId ? [{ id: l.id, blockId: l.fromBlockId }] : []),
    ...(l.toDocumentId === documentId && l.toBlockId ? [{ id: l.id, blockId: l.toBlockId }] : []),
  ]);
  const endOrders = new Map(
    ends.length > 0 && parts.length > 0
      ? (
          await db.block.findMany({
            where: { documentId, id: { in: [...new Set(ends.map((e) => e.blockId))] } },
            select: { id: true, order: true },
          })
        ).map((b) => [b.id, b.order] as const)
      : [],
  );
  const partOrders = parts.map((p) => orderOf.get(p.blockId) ?? Number.MAX_SAFE_INTEGER);
  const linkParts: Record<string, number> = {};
  for (const end of ends) {
    const order = endOrders.get(end.blockId);
    if (order === undefined || linkParts[end.id] !== undefined) continue;
    const at = partAt(partOrders, order);
    if (at >= 0) linkParts[end.id] = at;
  }
  const outline: DocumentOutline = {
    id: row.id,
    gist: current && row.gist?.trim() ? row.gist.trim() : null,
    parts,
    from,
    linkParts,
  };
  return NextResponse.json(outline);
}

function partOf(raw: unknown): { blockId: string; title: string; summary: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const p = raw as Record<string, unknown>;
  return typeof p.blockId === "string" && typeof p.title === "string" && typeof p.summary === "string"
    ? [{ blockId: p.blockId, title: p.title, summary: p.summary }]
    : [];
}
