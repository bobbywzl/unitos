import { Prisma } from "@prisma/client";

// A document's blocks stand in Block.order. A Contents entry and a footnote
// number point at their block by that order (Block.links targetOrder), so
// when blocks shift, the links follow them: a new block, a restored one,
// and a moved one each call this with the shift they made.

/** Every link span of the document that points at an order, pointed at
    `moved(order)`. */
export async function followOrders(
  tx: Prisma.TransactionClient,
  documentId: string,
  moved: (order: number) => number,
): Promise<void> {
  const rows = await tx.block.findMany({ where: { documentId, links: { not: Prisma.DbNull } }, select: { id: true, links: true } });
  for (const row of rows) {
    if (!Array.isArray(row.links)) continue;
    let changed = false;
    const links = row.links.map((span) => {
      if (!span || typeof span !== "object" || Array.isArray(span) || typeof span.targetOrder !== "number") return span;
      const to = moved(span.targetOrder);
      if (to === span.targetOrder) return span;
      changed = true;
      return { ...span, targetOrder: to };
    });
    if (changed) await tx.block.update({ where: { id: row.id }, data: { links: links as Prisma.InputJsonValue } });
  }
}
