import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveDocumentSources } from "@/lib/anchors/resolve";
import { db } from "@/lib/db";
import type { NotebookView, SectionView } from "@/lib/types";
import { NotebookTitle } from "@/components/notebook-title";
import { Outline } from "@/components/outline/outline";
import type { Highlight } from "@/components/reader/block-view";
import { DocumentBar } from "@/components/reader/document-bar";
import { Reader } from "@/components/reader/reader";
import { ReaderInteractions } from "@/components/reader/reader-interactions";

export const dynamic = "force-dynamic";

// Split view: reader left, notes drawer right (SPEC.md §6).
export default async function NotebookPage(props: {
  params: Promise<{ notebookId: string }>;
  searchParams: Promise<{ doc?: string; src?: string }>;
}) {
  const { notebookId } = await props.params;
  const { doc } = await props.searchParams;

  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      documents: { include: { document: { select: { id: true, title: true } } } },
      sections: {
        orderBy: { order: "asc" },
        include: {
          notes: {
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

  const attached = notebook.documents.map((nd) => nd.document);
  const activeId = doc && attached.some((d) => d.id === doc) ? doc : (attached[0]?.id ?? null);
  const activeDocument = activeId
    ? await db.document.findUnique({
        where: { id: activeId },
        include: { blocks: { orderBy: { order: "asc" } } },
      })
    : null;

  // Resolve anchors for the open document, then paint only this notebook's notes.
  // Chip orphan state comes from this resolution, not the (earlier) notebook query.
  const notebookNoteIds = new Set(notebook.sections.flatMap((s) => s.notes.map((n) => n.id)));
  const highlightsByBlock = new Map<string, Highlight[]>();
  const resolutionById = new Map<string, { orphaned: boolean }>();
  if (activeDocument) {
    const resolved = await resolveDocumentSources(activeDocument.id);
    for (const r of resolved) {
      resolutionById.set(r.id, { orphaned: r.orphaned });
      if (r.orphaned || !notebookNoteIds.has(r.noteId)) continue;
      const list = highlightsByBlock.get(r.blockId) ?? [];
      list.push({ sourceId: r.id, start: r.start, end: r.end });
      highlightsByBlock.set(r.blockId, list);
    }
  }

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
        orphaned: resolutionById.get(src.id)?.orphaned ?? src.orphaned,
      })),
    })),
    children: [],
  });
  const byParent = new Map<string | null, SectionView[]>();
  for (const s of notebook.sections) {
    const list = byParent.get(s.parentId) ?? [];
    list.push(toView(s));
    byParent.set(s.parentId, list);
  }
  const top = byParent.get(null) ?? [];
  for (const s of top) s.children = byParent.get(s.id) ?? [];
  const view: NotebookView = { id: notebook.id, title: notebook.title, sections: top };

  const sectionChoices = top.flatMap((s) => [
    { id: s.id, label: s.title },
    ...s.children.map((c) => ({ id: c.id, label: `${s.title} / ${c.title}` })),
  ]);

  return (
    <div className="grid h-screen grid-rows-[auto_1fr]">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-white">
          ← Notebooks
        </Link>
        <NotebookTitle id={notebook.id} title={notebook.title} />
        <Link
          href={`/n/${notebook.id}/notes`}
          className="ml-auto text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
        >
          Notes full page
        </Link>
      </header>

      <div className="grid min-h-0 grid-cols-[1fr_380px]">
        <div className="flex min-h-0 flex-col">
          <DocumentBar
            notebookId={notebook.id}
            documents={attached}
            activeId={activeDocument?.id ?? null}
          />
          {activeDocument ? (
            <ReaderInteractions documentId={activeDocument.id} sectionChoices={sectionChoices}>
              <Reader
                title={activeDocument.title}
                blocks={activeDocument.blocks}
                highlightsByBlock={highlightsByBlock}
              />
            </ReaderInteractions>
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-neutral-500">
                No document open. Upload a PDF or add a URL to start reading.
              </p>
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
          <Outline notebook={view} />
        </aside>
      </div>
    </div>
  );
}
