import { db } from "@/lib/db";

// Where a derivation's notes land (SPEC.md §4): the requested section, else
// the first visible section, else a new section with the default title. One
// rule for FORMALIZE notes, COMPARE, ANALYZE, and voice notes.
export async function landingSection(
  notebookId: string,
  sectionId: string | undefined,
  defaultTitle: string,
): Promise<{ id: string; title: string }> {
  let section = sectionId
    ? await db.section.findFirst({ where: { id: sectionId, notebookId, hidden: false } })
    : null;
  if (!section) {
    section = await db.section.findFirst({
      where: { notebookId, hidden: false },
      orderBy: { order: "asc" },
    });
  }
  if (!section) {
    section = await db.section.create({ data: { notebookId, title: defaultTitle, order: 0 } });
  }
  return { id: section.id, title: section.title };
}
