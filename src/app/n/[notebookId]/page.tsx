import Link from "next/link";
import { Logo } from "@/components/logo";
import { notFound } from "next/navigation";
import { matchInText } from "@/lib/anchors/match";
import { resolveDocumentSources } from "@/lib/anchors/resolve";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import type { NotebookView, SectionView } from "@/lib/types";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DrawerTabs } from "@/components/drawer-tabs";
import { NotebookTitle } from "@/components/notebook-title";
import { Outline } from "@/components/outline/outline";
import { ProfileDialog } from "@/components/profile-dialog";
import { AnnotationRail } from "@/components/reader/annotation-rail";
import { DocumentBar } from "@/components/reader/document-bar";
import { ReaderInteractions } from "@/components/reader/reader-interactions";

export const dynamic = "force-dynamic";

type SalienceSpan = {
  blockId: string;
  start: number;
  end: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

// Split view: reader left, notes drawer right (SPEC.md §6).
export default async function NotebookPage(props: {
  params: Promise<{ notebookId: string }>;
  searchParams: Promise<{ doc?: string; src?: string; onboard?: string }>;
}) {
  const { notebookId } = await props.params;
  const { doc, onboard } = await props.searchParams;

  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      documents: { include: { document: { select: { id: true, title: true } } } },
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
  const anchorHighlights: Record<string, { sourceId: string; start: number; end: number }[]> = {};
  const resolutionById = new Map<string, { orphaned: boolean }>();
  if (activeDocument) {
    const resolved = await resolveDocumentSources(activeDocument.id);
    for (const r of resolved) {
      resolutionById.set(r.id, { orphaned: r.orphaned });
      if (r.orphaned || !notebookNoteIds.has(r.noteId)) continue;
      const list = anchorHighlights[r.blockId] ?? [];
      list.push({ sourceId: r.id, start: r.start, end: r.end });
      anchorHighlights[r.blockId] = list;
    }
  }

  // Salience overlay spans, healed against current block text at render time.
  const salienceByBlock: Record<string, { start: number; end: number }[]> = {};
  let hasSalience = false;
  if (activeDocument) {
    const nd = notebook.documents.find((d) => d.documentId === activeDocument.id);
    const spans = (nd?.salience as SalienceSpan[] | null) ?? null;
    if (spans && Array.isArray(spans)) {
      hasSalience = true;
      const blockById = new Map(activeDocument.blocks.map((b) => [b.id, b]));
      for (const span of spans) {
        const block = blockById.get(span.blockId);
        let hit: { start: number; end: number } | null = null;
        if (block && block.text.slice(span.start, span.end) === span.quotedText) {
          hit = { start: span.start, end: span.end };
        } else if (block) {
          hit = matchInText(block.text, span);
        }
        if (!hit) continue;
        const list = salienceByBlock[span.blockId] ?? [];
        list.push(hit);
        salienceByBlock[span.blockId] = list;
      }
    }
  }

  // Glossary hover terms: first occurrence per term per listed block (SPEC.md §8 Phase 7).
  const termsByBlock: Record<string, { start: number; end: number; definition: string }[]> = {};
  if (activeDocument) {
    const glossaryDoc = await db.document.findUnique({
      where: { id: activeDocument.id },
      select: { glossary: true },
    });
    const glossary = (glossaryDoc?.glossary ?? null) as
      | { term: string; definition: string; blockIds: string[] }[]
      | null;
    if (glossary && Array.isArray(glossary)) {
      const blockById = new Map(activeDocument.blocks.map((b) => [b.id, b]));
      for (const entry of glossary) {
        for (const blockId of entry.blockIds) {
          const block = blockById.get(blockId);
          if (!block) continue;
          const idx = block.text.toLowerCase().indexOf(entry.term.toLowerCase());
          if (idx === -1) continue;
          const list = termsByBlock[blockId] ?? [];
          list.push({ start: idx, end: idx + entry.term.length, definition: entry.definition });
          termsByBlock[blockId] = list;
        }
      }
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
    if (s.hidden) continue; // Annotations section: rail only, not the outline
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

  // EXPLAIN annotations anchored in the open document, for the rail.
  const annotations = activeDocument
    ? notebook.sections
        .filter((s) => s.hidden)
        .flatMap((s) => s.notes)
        .filter((n) => n.derivationType === "EXPLAIN")
        .map((n) => {
          const source = n.sources.find((src) => src.documentId === activeDocument.id);
          if (!source) return null;
          return {
            id: n.id,
            content: n.content,
            sourceId: source.id,
            orphaned: resolutionById.get(source.id)?.orphaned ?? source.orphaned,
          };
        })
        .filter((a) => a !== null)
    : [];

  // Reader profile: notebook override wins over the global profile (SPEC.md §3).
  const globalProfile = await db.readerProfile.findUnique({ where: { userId: USER_ID } });
  const override = notebook.profile as {
    background: string;
    purpose: string;
    application: string;
  } | null;
  const profileValues = override
    ? override
    : globalProfile
      ? {
          background: globalProfile.background,
          purpose: globalProfile.purpose,
          application: globalProfile.application,
        }
      : null;

  return (
    <div className="grid h-screen grid-rows-[auto_1fr]">
      <header className="flex items-center gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
        >
          <Logo size={24} />
          <span>Notebooks</span>
        </Link>
        <NotebookTitle id={notebook.id} title={notebook.title} />
        <div className="ml-auto flex items-center gap-3">
          <ProfileDialog
            notebookId={notebook.id}
            initial={profileValues}
            hasOverride={override !== null}
            autoOpen={onboard === "1" && profileValues === null}
          />
          <Link
            href={`/n/${notebook.id}/notes`}
            className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
          >
            Notes full page
          </Link>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[1fr_380px]">
        <div className="flex min-h-0 flex-col">
          <DocumentBar
            notebookId={notebook.id}
            documents={attached}
            activeId={activeDocument?.id ?? null}
          />
          {activeDocument ? (
            <>
              <AnnotationRail
                notebookId={notebook.id}
                documentId={activeDocument.id}
                annotations={annotations}
              />
              <ReaderInteractions
                documentId={activeDocument.id}
                notebookId={notebook.id}
                sectionChoices={sectionChoices}
                title={activeDocument.title}
                blocks={activeDocument.blocks.map((b) => ({
                  id: b.id,
                  type: b.type,
                  text: b.text,
                  html: b.html,
                }))}
                anchorHighlights={anchorHighlights}
                salienceByBlock={salienceByBlock}
                hasSalience={hasSalience}
                termsByBlock={termsByBlock}
              />
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <Logo size={140} />
              <p className="text-sm text-neutral-500">
                No document open. Upload a PDF or add a URL to start reading.
              </p>
            </div>
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-neutral-200 p-4 dark:border-neutral-800">
          <DrawerTabs
            notes={<Outline notebook={view} />}
            assistant={
              <AssistantPanel notebookId={notebook.id} documentId={activeDocument?.id ?? null} />
            }
          />
        </aside>
      </div>
    </div>
  );
}
