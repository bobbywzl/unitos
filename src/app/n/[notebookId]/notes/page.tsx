import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { NotebookView, SectionView } from "@/lib/types";
import { ArrowLeftIcon } from "@/components/icons";
import { ExportMenu } from "@/components/export-menu";
import { Outline } from "@/components/outline/outline";

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
    <main className="mx-auto w-[760px] max-w-full px-6 pt-6 pb-24">
      <header className="mb-[34px] flex items-center gap-2">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={15} />
          Works
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={`/n/${notebook.id}`}
            className="rounded-full border border-line px-4 py-1.5 text-[13px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            Reader
          </Link>
          <ExportMenu notebookId={notebook.id} />
        </div>
      </header>
      <Outline notebook={view} />
    </main>
  );
}
