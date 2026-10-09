import { contentsEntries, headingContents } from "@/lib/contents";
import { db } from "@/lib/db";
import { outlineParts } from "@/lib/graph/outline";
import { SKELETON_VERSION } from "@/lib/graph/skeleton";

// Every document's part titles at once, for the graph's Documents list
// (SPEC.md §13; GET .../outline?parts=titles): the node card's rule — the
// skeleton's parts, else the stored contents, else the headings — with no
// summaries and no link parts. Read only, never a model call: three queries
// for the whole project, whatever its size.

export type PartTitle = { blockId: string; title: string; level: 1 | 2 };
export type ProjectPartTitles = { documents: Record<string, PartTitle[]> };

export async function projectPartTitles(notebookId: string): Promise<ProjectPartTitles> {
  const rows = await db.$queryRaw<{ id: string; title: string; v: string | null; parts: unknown; contents: unknown }[]>`
    SELECT d.id, d.title, d.skeleton->>'v' AS v,
      (SELECT jsonb_agg(jsonb_build_object('blockId', p->'blockId', 'title', p->'title', 'summary', ''))
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(d.skeleton->'parts') = 'array' THEN d.skeleton->'parts' ELSE '[]'::jsonb END) p
      ) AS parts,
      d.contents
    FROM "Document" d
    JOIN "NotebookDocument" nd ON nd."documentId" = d.id
    WHERE nd."notebookId" = ${notebookId}
  `;
  const named = rows.map((row) => {
    const current = row.v === String(SKELETON_VERSION);
    const skeletonParts = current && Array.isArray(row.parts) ? row.parts.flatMap(partOf) : null;
    return { row, skeletonParts, contents: contentsEntries(row.contents) };
  });
  const ids = [...new Set(named.flatMap((n) => [...(n.skeletonParts ?? []).map((p) => p.blockId), ...n.contents.map((c) => c.blockId)]))];
  const alive = new Set(
    ids.length > 0 ? (await db.block.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((b) => b.id) : [],
  );
  const documents: Record<string, PartTitle[]> = {};
  const bare: string[] = [];
  for (const n of named) {
    const { parts } = outlineParts(n.skeletonParts, n.contents, alive);
    if (parts.length > 0) documents[n.row.id] = parts.map(({ blockId, title, level }) => ({ blockId, title, level }));
    else bare.push(n.row.id);
  }
  if (bare.length > 0) {
    const heads = await db.block.findMany({
      where: { documentId: { in: bare }, type: "HEADING" },
      orderBy: { order: "asc" },
      select: { id: true, documentId: true, type: true, text: true, html: true, order: true },
    });
    const titleOf = new Map(rows.map((r) => [r.id, r.title]));
    for (const id of bare) {
      const own = heads.filter((h) => h.documentId === id);
      documents[id] = headingContents(own, titleOf.get(id)).map(({ blockId, title, level }) => ({ blockId, title, level }));
    }
  }
  return { documents };
}

function partOf(raw: unknown): { blockId: string; title: string; summary: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const p = raw as Record<string, unknown>;
  return typeof p.blockId === "string" && typeof p.title === "string" ? [{ blockId: p.blockId, title: p.title, summary: "" }] : [];
}
