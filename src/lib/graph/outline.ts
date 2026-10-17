import type { ContentsEntry } from "@/lib/contents";

// What a document is about, for the graph's node card (SPEC.md §13): read
// from what is stored, never a model call. The parts come from the
// skeleton (its part summaries, SPEC.md §22), else the stored contents
// (§26), else the headings; a part the skeleton names whose block is gone
// drops. Pure: the routes read the rows.

export type OutlinePart = { blockId: string; title: string; summary: string | null; level: 1 | 2 };
export type OutlineSource = "skeleton" | "contents" | "headings" | "none";

/** One document's outline: its gist (null without a skeleton), its parts,
    where the parts came from, and, for each link of the project with an end
    in this document, the index of the part that end sits in. */
export type DocumentOutline = {
  id: string;
  gist: string | null;
  parts: OutlinePart[];
  from: OutlineSource;
  linkParts: Record<string, number>;
};

/** The skeleton's parts (levels from the stored contents), else the stored
    contents. Empty when neither has a part: the caller reads the headings. */
export function outlineParts(
  skeletonParts: { blockId: string; title: string; summary: string }[] | null,
  contents: ContentsEntry[],
  alive: Set<string>,
): { parts: OutlinePart[]; from: OutlineSource } {
  const levels = new Map(contents.map((c) => [c.blockId, c.level]));
  const fromSkeleton = (skeletonParts ?? [])
    .filter((p) => alive.has(p.blockId))
    .map((p) => ({ blockId: p.blockId, title: p.title, summary: p.summary.trim() || null, level: levels.get(p.blockId) ?? 1 }));
  if (fromSkeleton.length > 0) return { parts: fromSkeleton, from: "skeleton" };
  const stored = contents.filter((c) => alive.has(c.blockId)).map((c) => ({ ...c, summary: null }));
  if (stored.length > 0) return { parts: stored, from: "contents" };
  return { parts: [], from: "none" };
}

/** The part a block sits in: the last part that starts at or before the
    block's order. partOrders: each part's start order, in reading order.
    -1 when the block comes before every part. */
export function partAt(partOrders: number[], order: number): number {
  let at = -1;
  for (let i = 0; i < partOrders.length; i++) {
    if (partOrders[i] <= order) at = i;
    else break;
  }
  return at;
}
