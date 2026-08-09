import { db } from "@/lib/db";

// Rewrite section orders sequentially per parent group. Run inside or after any section mutation.
export async function normalizeSectionOrders(notebookId: string) {
  const sections = await db.section.findMany({
    where: { notebookId },
    orderBy: [{ order: "asc" }],
    select: { id: true, parentId: true, order: true },
  });
  const groups = new Map<string, { id: string }[]>();
  for (const s of sections) {
    const key = s.parentId ?? "root";
    const group = groups.get(key) ?? [];
    group.push({ id: s.id });
    groups.set(key, group);
  }
  const updates = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      updates.push(db.section.update({ where: { id: group[i].id }, data: { order: i } }));
    }
  }
  await db.$transaction(updates);
}

// Rewrite note orders sequentially within a section.
export async function normalizeNoteOrders(sectionId: string) {
  const notes = await db.note.findMany({
    where: { sectionId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  await db.$transaction(
    notes.map((n, i) => db.note.update({ where: { id: n.id }, data: { order: i } })),
  );
}

// Move an item to a target index by rewriting sibling orders. `ids` is the current ordered id list.
export function movedOrder(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
  return next;
}
