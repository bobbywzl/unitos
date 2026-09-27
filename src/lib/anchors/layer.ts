import { z } from "zod";
import { db } from "@/lib/db";
import { currentCores, readCollapse, type CollapseBlock } from "@/lib/collapse";
import { collapseUnits } from "@/lib/collapse-units";

// The layer an anchor points into (SPEC.md §28). The block's text is the
// default and has no name; "core" is the block's core in the collapsed view.
// The collapsed view and the whole text keep their own annotations: a core
// anchor's offsets and quote are the core's words, and it heals against the
// core the reader sees now.
export const layerSchema = z.literal("core").optional();
export type Layer = "core";

/** The blocks an anchor in `layer` resolves against, in reading order: the
    blocks themselves, or, for the core layer, every block (a unit, in a
    document with rich text) that has a core now, with the core as its
    text. */
export async function layerBlocks(
  documentId: string,
  layer: Layer | undefined | null,
): Promise<{ id: string; type: string; text: string }[]> {
  const blocks = await db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, type: true, text: true, startTime: true, endTime: true, cell: true },
  });
  if (layer !== "core") return blocks.map(({ id, type, text }) => ({ id, type, text }));
  const document = await db.document.findUnique({ where: { id: documentId }, select: { collapse: true } });
  return coreBlocks(document?.collapse ?? null, blocks);
}

/** Every block that has a core now, with the core as its text: a unit of
    the paragraph index (lib/collapse-units.ts) when the cores were written
    by units, under its first row's id. */
export function coreBlocks(collapse: unknown, blocks: CollapseBlock[]): { id: string; type: string; text: string }[] {
  const stored = readCollapse(collapse);
  const { cores } = currentCores(stored, blocks);
  return collapseUnits(blocks, stored?.richText === true)
    .filter((u) => cores[u.id] !== undefined)
    .map((u) => ({ id: u.id, type: u.type, text: cores[u.id] }));
}
