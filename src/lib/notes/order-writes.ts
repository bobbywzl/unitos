import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// A note's place in its section is not an edit of the note (SPEC.md §6):
// Last edited ranks notes by `updatedAt`, so a reorder, a move, a pin, a
// merge, a delete, or a restore that shifts the notes around it must leave
// every note's time as it was. Prisma stamps `updatedAt` on every update, so
// these writes go in raw SQL, which sets `order` alone. Only the rows whose
// place changes are written.

/** The notes take places 0, 1, 2… in the order given. */
export function writeNoteOrders(ids: string[]): Prisma.PrismaPromise<number> {
  const orders = ids.map((_, i) => i);
  return db.$executeRaw`
    UPDATE "Note" AS n SET "order" = x.ord
    FROM unnest(${ids}::text[], ${orders}::int[]) AS x(id, ord)
    WHERE n."id" = x.id AND n."order" IS DISTINCT FROM x.ord`;
}

/** The notes of the section at `from` and after it move down one place. */
export function shiftNoteOrders(
  sectionId: string,
  from: number,
  client: Pick<Prisma.TransactionClient, "$executeRaw"> = db,
): Prisma.PrismaPromise<number> {
  return client.$executeRaw`
    UPDATE "Note" SET "order" = "order" + 1 WHERE "sectionId" = ${sectionId} AND "order" >= ${from}`;
}
