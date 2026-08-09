import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { NotebookView, SectionView } from "@/lib/types";
import { Outline } from "@/components/outline/outline";
import { NotebookTitle } from "@/components/notebook-title";

export const dynamic = "force-dynamic";

export default async function NotesPage(props: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await props.params;
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          notes: {
            where: { status: { not: "REJECTED" } },
            orderBy: { order: "asc" },
            include: {
              sources: { include: { document: { select: { id: true, title: true } } } },
            },
          },
        },
      },
    },
  });
  if (!notebook) notFound();

  const toView = (s: (typeof notebook.sections)[number]): SectionView => ({
    id: s.id,
    title: s.title,
    order: s.order,
    parentId: s.parentId,
    notes: s.notes.map((n) => ({
      id: n.id,
      content: n.content,
      status: n.status,
      derivationType: n.derivationType,
      order: n.order,
      sources: n.sources.map((src) => ({
        id: src.id,
        documentId: src.documentId,
        documentTitle: src.document.title,
        quotedText: src.quotedText,
        orphaned: src.orphaned,
      })),
    })),
    children: [],
  });

  const byParent = new Map<string | null, SectionView[]>();
  for (const s of notebook.sections) {
    if (s.hidden) continue; // Annotations section stays out of the outline
    const view = toView(s);
    const list = byParent.get(s.parentId) ?? [];
    list.push(view);
    byParent.set(s.parentId, list);
  }
  const top = byParent.get(null) ?? [];
  for (const s of top) s.children = byParent.get(s.id) ?? [];

  const view: NotebookView = { id: notebook.id, title: notebook.title, sections: top };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-8 flex items-center gap-3">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
          ← Notebooks
        </Link>
        <NotebookTitle id={notebook.id} title={notebook.title} />
      </header>
      <Outline notebook={view} />
    </main>
  );
}
