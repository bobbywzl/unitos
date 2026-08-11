import { Logo } from "@/components/logo";
import { notFound } from "next/navigation";
import { matchInText } from "@/lib/anchors/match";
import { resolveDocumentSources } from "@/lib/anchors/resolve";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import type {
  AnnotationItem,
  EditItem,
  LinkIn,
  LinkOut,
  NotebookView,
  SectionView,
} from "@/lib/types";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AnnotationsPanel } from "@/components/panels/annotations-panel";
import { EditsPanel } from "@/components/panels/edits-panel";
import { ReaderInteractions } from "@/components/reader/reader-interactions";
import { Workspace } from "@/components/reader/workspace";

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
  // A note's color rides along so manual highlights paint in their chosen hue.
  const noteById = new Map(notebook.sections.flatMap((s) => s.notes).map((n) => [n.id, n]));
  const annotationNoteIds = new Set(
    notebook.sections.filter((s) => s.hidden).flatMap((s) => s.notes.map((n) => n.id)),
  );
  const anchorHighlights: Record<
    string,
    { sourceId: string; start: number; end: number; color: string | null; annotation: boolean }[]
  > = {};
  const resolutionById = new Map<string, { orphaned: boolean }>();
  if (activeDocument) {
    const resolved = await resolveDocumentSources(activeDocument.id);
    for (const r of resolved) {
      resolutionById.set(r.id, { orphaned: r.orphaned });
      if (r.orphaned || !noteById.has(r.noteId)) continue;
      const list = anchorHighlights[r.blockId] ?? [];
      list.push({
        sourceId: r.id,
        start: r.start,
        end: r.end,
        color: noteById.get(r.noteId)?.color ?? null,
        annotation: annotationNoteIds.has(r.noteId),
      });
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

  // Annotations anchored in the open document, for the Annotations tab:
  // manual highlights (color), comments, and EXPLAIN output — all notes in the
  // hidden Annotations section with a source in this document.
  const annotations: AnnotationItem[] = activeDocument
    ? notebook.sections
        .filter((s) => s.hidden)
        .flatMap((s) => s.notes)
        .map((n): AnnotationItem | null => {
          const source = n.sources.find((src) => src.documentId === activeDocument.id);
          if (!source) return null;
          const kind =
            n.derivationType === "EXPLAIN"
              ? ("explain" as const)
              : n.color
                ? ("highlight" as const)
                : ("comment" as const);
          return {
            id: n.id,
            kind,
            content: n.content,
            color: n.color,
            sourceId: source.id,
            quotedText: source.quotedText,
            orphaned: resolutionById.get(source.id)?.orphaned ?? source.orphaned,
          };
        })
        .filter((a): a is AnnotationItem => a !== null)
    : [];

  // Cross-document links for the open document: outgoing ranges paint as
  // hyperlinks in the text (healed like anchors); both directions list in the
  // Annotations tab.
  const linksByBlock: Record<
    string,
    { linkId: string; start: number; end: number; toDocumentId: string; toTitle: string }[]
  > = {};
  const linksOut: LinkOut[] = [];
  const linksIn: LinkIn[] = [];
  if (activeDocument) {
    const [outgoing, incoming] = await Promise.all([
      db.docLink.findMany({
        where: { fromDocumentId: activeDocument.id },
        orderBy: { createdAt: "desc" },
        include: { toDocument: { select: { title: true } } },
      }),
      db.docLink.findMany({
        where: { toDocumentId: activeDocument.id },
        orderBy: { createdAt: "desc" },
        include: { fromDocument: { select: { title: true } } },
      }),
    ]);
    const blockById = new Map(activeDocument.blocks.map((b) => [b.id, b]));
    const attachedIds = new Set(attached.map((d) => d.id));
    for (const link of outgoing) {
      // Same ladder as resolveDocumentSources: stored offsets, re-find in the
      // stored block, re-find across all blocks (re-parse gives new block ids).
      // Rebinds are written back so links self-heal like note anchors.
      const selector = { quotedText: link.quotedText, prefix: link.prefix, suffix: link.suffix };
      const stored = blockById.get(link.fromBlockId);
      let resolved: { blockId: string; start: number; end: number } | null = null;
      if (stored && stored.text.slice(link.startOffset, link.endOffset) === link.quotedText) {
        resolved = { blockId: link.fromBlockId, start: link.startOffset, end: link.endOffset };
      } else if (stored) {
        const hit = matchInText(stored.text, selector);
        if (hit) resolved = { blockId: stored.id, ...hit };
      }
      if (!resolved) {
        for (const block of activeDocument.blocks) {
          if (stored && block.id === stored.id) continue;
          const hit = matchInText(block.text, selector);
          if (hit) {
            resolved = { blockId: block.id, ...hit };
            break;
          }
        }
      }
      const detached = !attachedIds.has(link.toDocumentId);
      linksOut.push({
        id: link.id,
        toDocumentId: link.toDocumentId,
        toTitle: link.toDocument.title,
        quotedText: link.quotedText,
        orphaned: resolved === null,
        detached,
      });
      if (!resolved) continue;
      if (
        resolved.blockId !== link.fromBlockId ||
        resolved.start !== link.startOffset ||
        resolved.end !== link.endOffset
      ) {
        await db.docLink.update({
          where: { id: link.id },
          data: {
            fromBlockId: resolved.blockId,
            startOffset: resolved.start,
            endOffset: resolved.end,
          },
        });
      }
      // A link to a detached document would fall back to the first attached
      // document on click — list it in the panel, do not paint it as a link.
      if (detached) continue;
      const list = linksByBlock[resolved.blockId] ?? [];
      list.push({
        linkId: link.id,
        start: resolved.start,
        end: resolved.end,
        toDocumentId: link.toDocumentId,
        toTitle: link.toDocument.title,
      });
      linksByBlock[resolved.blockId] = list;
    }
    for (const link of incoming) {
      linksIn.push({
        id: link.id,
        fromDocumentId: link.fromDocumentId,
        fromTitle: link.fromDocument.title,
        quotedText: link.quotedText,
      });
    }
  }

  // Edit history for the open document, newest first.
  const edits: EditItem[] = activeDocument
    ? (
        await db.blockEdit.findMany({
          where: { documentId: activeDocument.id },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      ).map((e) => ({
        id: e.id,
        kind: e.kind as EditItem["kind"],
        blockId: e.blockId,
        before: e.before,
        after: e.after,
        meta: e.meta as EditItem["meta"],
        createdAt: e.createdAt.toISOString(),
      }))
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
    <Workspace
      notebook={view}
      documents={attached}
      activeDocumentId={activeDocument?.id ?? null}
      profile={{
        initial: profileValues,
        hasOverride: override !== null,
        autoOpen: onboard === "1" && profileValues === null,
      }}
      assistant={
        <AssistantPanel notebookId={notebook.id} documentId={activeDocument?.id ?? null} />
      }
      annotationsPanel={
        <AnnotationsPanel
          notebookId={notebook.id}
          documentId={activeDocument?.id ?? null}
          annotations={annotations}
          linksOut={linksOut}
          linksIn={linksIn}
        />
      }
      editsPanel={<EditsPanel edits={edits} />}
      annotationCount={annotations.length + linksOut.length + linksIn.length}
      reader={
        activeDocument ? (
          <div className="flex h-full min-h-0 flex-col">
            <ReaderInteractions
              documentId={activeDocument.id}
              notebookId={notebook.id}
              sectionChoices={sectionChoices}
              attachedDocuments={attached}
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
              linksByBlock={linksByBlock}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-5">
            <Logo size={140} className="text-sand-400" />
            <p className="max-w-sm text-center text-sm text-sand-600">
              No document open. Upload a PDF, drop one here, or add a URL to start reading.
            </p>
          </div>
        )
      }
    />
  );
}
