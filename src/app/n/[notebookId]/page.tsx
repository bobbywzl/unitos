import { Logo } from "@/components/logo";
import { notFound } from "next/navigation";
import { matchInText } from "@/lib/anchors/match";
import { hasContext } from "@/lib/derive/context";
import { editedRanges } from "@/lib/diff";
import { documentReferences } from "@/lib/parse/types";
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
  SummaryLevels,
} from "@/lib/types";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AnnotationsPanel } from "@/components/panels/annotations-panel";
import { EditsPanel } from "@/components/panels/edits-panel";
import { ReaderInteractions } from "@/components/reader/reader-interactions";
import { ReaderPanes, type ReaderViewKind } from "@/components/reader/reader-panes";
import { Workspace } from "@/components/reader/workspace";
import { VideoPane } from "@/components/video/video-pane";
import {
  parseRegion,
  type TranscriptLine,
  type VideoAnnotationItem,
  type VideoInfo,
} from "@/lib/video/types";

export const dynamic = "force-dynamic";

type SalienceSpan = {
  blockId: string;
  start: number;
  end: number;
  quotedText: string;
  prefix: string;
  suffix: string;
};

// Split view: reader left, notes drawer right (SPEC.md §6). The reader itself
// shows one document (Normal) or two panes (Side by Side, Top and Bottom);
// every pane carries the full tool set.
export default async function NotebookPage(props: {
  params: Promise<{ notebookId: string }>;
  searchParams: Promise<{ doc?: string; doc2?: string; view?: string; src?: string }>;
}) {
  const { notebookId } = await props.params;
  const { doc, doc2, view: viewParam } = await props.searchParams;

  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      documents: {
        include: {
          document: {
            select: { id: true, title: true, sourceUrl: true, parserVersion: true, fileHash: true },
          },
        },
      },
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

  const attached = notebook.documents.map((nd) => ({
    id: nd.document.id,
    title: nd.document.title,
    sourceUrl: nd.document.sourceUrl,
    parserVersion: nd.document.parserVersion,
    hasFile: nd.document.fileHash !== null,
  }));
  const activeId = doc && attached.some((d) => d.id === doc) ? doc : (attached[0]?.id ?? null);
  // The reader view is a per-visit choice carried in the URL; a fresh open is Normal.
  const readerView: ReaderViewKind =
    viewParam === "side" || viewParam === "stack" ? viewParam : "normal";
  const paneTwoId =
    readerView !== "normal" && activeId
      ? doc2 && attached.some((d) => d.id === doc2)
        ? doc2
        : (attached.find((d) => d.id !== activeId)?.id ?? activeId)
      : null;

  const noteById = new Map(notebook.sections.flatMap((s) => s.notes).map((n) => [n.id, n]));
  const annotationNoteIds = new Set(
    notebook.sections.filter((s) => s.hidden).flatMap((s) => s.notes.map((n) => n.id)),
  );
  // Anchor resolution across every open pane; note chips read orphan state here.
  const resolutionById = new Map<string, { orphaned: boolean }>();
  const attachedIds = new Set(attached.map((d) => d.id));

  // ── One pane's data: everything the reader needs for one document ─────────
  async function paneData(documentId: string) {
    const document = await db.document.findUnique({
      where: { id: documentId },
      include: { blocks: { orderBy: { order: "asc" } }, video: true },
    });
    if (!document) return null;
    const blockById = new Map(document.blocks.map((b) => [b.id, b]));
    // Video anchors are time ranges, not text spans: they skip the text
    // highlight painting and render on the player overlay (SPEC.md §11).
    const sourceById = new Map(
      notebook!.sections
        .flatMap((s) => s.notes)
        .flatMap((n) => n.sources)
        .map((src) => [src.id, src]),
    );

    // Resolve anchors, then paint only this notebook's notes. A note's color
    // rides along so manual highlights paint in their chosen hue.
    const anchorHighlights: Record<
      string,
      {
        sourceId: string;
        start: number;
        end: number;
        color: string | null;
        annotation: boolean;
        comment: boolean;
      }[]
    > = {};
    const resolved = await resolveDocumentSources(document.id);
    for (const r of resolved) {
      resolutionById.set(r.id, { orphaned: r.orphaned });
      if (r.orphaned || !noteById.has(r.noteId)) continue;
      if (sourceById.get(r.id)?.startTime != null) continue;
      const list = anchorHighlights[r.blockId] ?? [];
      const note = noteById.get(r.noteId);
      list.push({
        sourceId: r.id,
        start: r.start,
        end: r.end,
        color: note?.color ?? null,
        annotation: annotationNoteIds.has(r.noteId),
        // Comment annotation: a comment icon renders beside the text.
        comment:
          annotationNoteIds.has(r.noteId) && note?.derivationType == null && note?.color == null,
      });
      anchorHighlights[r.blockId] = list;
    }

    // Stored summaries and salience live on the attachment (SPEC.md §4).
    const attachment = notebook!.documents.find((d) => d.documentId === document.id);
    const summaries = (attachment?.summaries as SummaryLevels | null) ?? {};
    const salienceByBlock: Record<string, { start: number; end: number }[]> = {};
    const salienceSpans = (attachment?.salience as SalienceSpan[] | null) ?? null;
    const hasSalience = Boolean(salienceSpans && Array.isArray(salienceSpans));
    if (salienceSpans && Array.isArray(salienceSpans)) {
      for (const span of salienceSpans) {
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

    // Glossary hover terms: first occurrence per term per listed block.
    const termsByBlock: Record<string, { start: number; end: number; definition: string }[]> = {};
    const glossary = (document.glossary ?? null) as
      | { term: string; definition: string; blockIds: string[] }[]
      | null;
    if (glossary && Array.isArray(glossary)) {
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

    // Annotations anchored in this document: highlights, comments, EXPLAIN,
    // SIMPLIFY — all notes in the hidden Annotations section with a source here.
    const annotations: AnnotationItem[] = notebook!.sections
      .filter((s) => s.hidden)
      .flatMap((s) => s.notes)
      .map((n): AnnotationItem | null => {
        const source = n.sources.find((src) => src.documentId === document.id);
        if (!source) return null;
        const kind =
          n.derivationType === "EXPLAIN"
            ? ("explain" as const)
            : n.derivationType === "SIMPLIFY"
              ? ("simplify" as const)
              : n.derivationType === "SYNTHESIS"
                ? ("assistant" as const)
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
      .filter((a): a is AnnotationItem => a !== null);

    // Stored EXPLAIN, SIMPLIFY, comment, and assistant conversation content by
    // source id: clicking the mark reopens the card with this content.
    const annotationBubbles = Object.fromEntries(
      annotations
        .filter(
          (a) =>
            (a.kind === "explain" ||
              a.kind === "simplify" ||
              a.kind === "comment" ||
              a.kind === "assistant") &&
            a.sourceId,
        )
        .map((a) => [
          a.sourceId as string,
          {
            kind: a.kind as "explain" | "simplify" | "comment" | "assistant",
            content: a.content,
            noteId: a.id,
          },
        ]),
    );

    // Highlights and comments by source id, for the on-mark edit controls.
    const annotationsBySource: Record<
      string,
      {
        noteId: string;
        kind: "highlight" | "comment";
        color: string | null;
        content: string;
        quotedText: string | null;
      }
    > = {};
    for (const a of annotations) {
      if ((a.kind === "highlight" || a.kind === "comment") && a.sourceId) {
        annotationsBySource[a.sourceId] = {
          noteId: a.id,
          kind: a.kind,
          color: a.color,
          content: a.content,
          quotedText: a.quotedText,
        };
      }
    }

    // Links touching this document: outgoing ranges and incoming two-ended
    // ranges paint as hyperlinks (healed like anchors); both directions list
    // in the Annotations tab. Same-document links paint both ends.
    const linksByBlock: Record<
      string,
      { linkId: string; start: number; end: number; href: string; title: string }[]
    > = {};
    const linksOut: LinkOut[] = [];
    const linksIn: LinkIn[] = [];
    const [outgoing, incoming] = await Promise.all([
      db.docLink.findMany({
        where: { fromDocumentId: document.id },
        orderBy: { createdAt: "desc" },
        include: { toDocument: { select: { title: true } } },
      }),
      db.docLink.findMany({
        where: { toDocumentId: document.id },
        orderBy: { createdAt: "desc" },
        include: { fromDocument: { select: { title: true } } },
      }),
    ]);
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
        for (const block of document.blocks) {
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
        targetQuotedText: link.toQuotedText,
        orphaned: resolved === null,
        targetOrphaned: link.toOrphaned,
        detached,
      });
      if (!resolved) {
        // Orphan flags write back, so both ends report honestly (SPEC.md §5).
        if (!link.fromOrphaned) {
          await db.docLink.update({ where: { id: link.id }, data: { fromOrphaned: true } });
        }
        continue;
      }
      if (
        resolved.blockId !== link.fromBlockId ||
        resolved.start !== link.startOffset ||
        resolved.end !== link.endOffset ||
        link.fromOrphaned
      ) {
        await db.docLink.update({
          where: { id: link.id },
          data: {
            fromBlockId: resolved.blockId,
            startOffset: resolved.start,
            endOffset: resolved.end,
            fromOrphaned: false,
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
        href: link.toQuotedText
          ? `/n/${notebookId}?doc=${link.toDocumentId}&link=${link.id}`
          : `/n/${notebookId}?doc=${link.toDocumentId}`,
        title: link.toDocument.title,
      });
      linksByBlock[resolved.blockId] = list;
    }
    for (const link of incoming) {
      const twoEnded =
        link.toQuotedText !== null &&
        link.toBlockId !== null &&
        link.toStartOffset !== null &&
        link.toEndOffset !== null;
      let resolved: { blockId: string; start: number; end: number } | null = null;
      if (twoEnded) {
        const selector = {
          quotedText: link.toQuotedText!,
          prefix: link.toPrefix ?? "",
          suffix: link.toSuffix ?? "",
        };
        const stored = blockById.get(link.toBlockId!);
        if (
          stored &&
          stored.text.slice(link.toStartOffset!, link.toEndOffset!) === link.toQuotedText
        ) {
          resolved = { blockId: link.toBlockId!, start: link.toStartOffset!, end: link.toEndOffset! };
        } else if (stored) {
          const hit = matchInText(stored.text, selector);
          if (hit) resolved = { blockId: stored.id, ...hit };
        }
        if (!resolved) {
          for (const block of document.blocks) {
            if (block.id === link.toBlockId) continue;
            const hit = matchInText(block.text, selector);
            if (hit) {
              resolved = { blockId: block.id, ...hit };
              break;
            }
          }
        }
      }
      // A same-document link already listed under outgoing is not listed again.
      if (link.fromDocumentId !== document.id) {
        linksIn.push({
          id: link.id,
          fromDocumentId: link.fromDocumentId,
          fromTitle: link.fromDocument.title,
          quotedText: link.quotedText,
          hereQuotedText: link.toQuotedText,
          orphaned: twoEnded && resolved === null,
          fromOrphaned: link.fromOrphaned,
        });
      }
      if (!twoEnded) continue;
      if (!resolved) {
        // Orphan flags write back, so both ends report honestly (SPEC.md §5).
        if (!link.toOrphaned) {
          await db.docLink.update({ where: { id: link.id }, data: { toOrphaned: true } });
        }
        continue;
      }
      if (
        resolved.blockId !== link.toBlockId ||
        resolved.start !== link.toStartOffset ||
        resolved.end !== link.toEndOffset ||
        link.toOrphaned
      ) {
        await db.docLink.update({
          where: { id: link.id },
          data: {
            toBlockId: resolved.blockId,
            toStartOffset: resolved.start,
            toEndOffset: resolved.end,
            toOrphaned: false,
          },
        });
      }
      const list = linksByBlock[resolved.blockId] ?? [];
      list.push({
        linkId: link.id,
        start: resolved.start,
        end: resolved.end,
        href: `/n/${notebookId}?doc=${link.fromDocumentId}&link=${link.id}`,
        title: link.fromDocument.title,
      });
      linksByBlock[resolved.blockId] = list;
    }

    // Edited-vs-original coloring: spans of each block that differ from the
    // text as first parsed render in the edited color.
    const editedByBlock: Record<string, { start: number; end: number }[]> = {};
    for (const b of document.blocks) {
      if (b.originalText === null || b.originalText === b.text) continue;
      const ranges = editedRanges(b.originalText, b.text);
      if (ranges.length > 0) editedByBlock[b.id] = ranges;
    }

    // Inline styles (bold/italic): decoration spans healed like salience.
    type StyleSpan = { start: number; end: number; style: string; quotedText: string };
    const stylesByBlock: Record<
      string,
      { start: number; end: number; style: "bold" | "italic" | "underline" }[]
    > = {};
    for (const b of document.blocks) {
      const spans = (Array.isArray(b.styles) ? b.styles : []) as unknown as StyleSpan[];
      for (const span of spans) {
        if (span.style !== "bold" && span.style !== "italic") continue;
        let hit: { start: number; end: number } | null = null;
        if (b.text.slice(span.start, span.end) === span.quotedText) {
          hit = { start: span.start, end: span.end };
        } else {
          hit = matchInText(b.text, { quotedText: span.quotedText, prefix: "", suffix: "" });
        }
        if (!hit) continue;
        const list = stylesByBlock[b.id] ?? [];
        list.push({ start: hit.start, end: hit.end, style: span.style });
        stylesByBlock[b.id] = list;
      }
    }

    // References and each block's citation spans — healed like styles.
    type CitationJson = { start: number; end: number; refId: string; quotedText: string };
    const references = documentReferences(document.references);
    const referenceIds = new Set(references.map((r) => r.id));
    const citationsByBlock: Record<string, { start: number; end: number; referenceId: string }[]> =
      {};
    if (references.length > 0) {
      for (const b of document.blocks) {
        const spans = (Array.isArray(b.citations) ? b.citations : []) as unknown as CitationJson[];
        for (const span of spans) {
          if (!referenceIds.has(span.refId)) continue;
          let hit: { start: number; end: number } | null = null;
          if (b.text.slice(span.start, span.end) === span.quotedText) {
            hit = { start: span.start, end: span.end };
          } else {
            hit = matchInText(b.text, { quotedText: span.quotedText, prefix: "", suffix: "" });
          }
          if (!hit) continue;
          const list = citationsByBlock[b.id] ?? [];
          list.push({ start: hit.start, end: hit.end, referenceId: span.refId });
          citationsByBlock[b.id] = list;
        }
      }
    }

    // ── Video documents (SPEC.md §11) ───────────────────────────────────────
    // The pane needs the stored video, the transcript lines, every annotation
    // with a time anchor, and a seek time per time source for chip jumps.
    const video: VideoInfo | null = document.video
      ? {
          mimeType: document.video.mimeType,
          size: document.video.size,
          duration: document.video.duration,
          width: document.video.width,
          height: document.video.height,
          transcriptStatus: document.video.transcriptStatus,
          transcriptError: document.video.transcriptError,
        }
      : null;
    const transcript: TranscriptLine[] = document.blocks
      .filter((b) => b.type === "TRANSCRIPT" && b.startTime !== null && b.endTime !== null)
      .map((b) => ({ id: b.id, text: b.text, startTime: b.startTime!, endTime: b.endTime! }));
    const videoAnnotations: VideoAnnotationItem[] = notebook!.sections
      .filter((s) => s.hidden)
      .flatMap((s) => s.notes)
      .flatMap((n) =>
        n.sources
          .filter((src) => src.documentId === document.id && src.startTime !== null)
          .map((src) => ({
            noteId: n.id,
            sourceId: src.id,
            kind: n.derivationType === "EXPLAIN" ? ("explain" as const) : ("comment" as const),
            content: n.content,
            startTime: src.startTime!,
            endTime: src.endTime ?? src.startTime! + 4,
            region: parseRegion(src.region),
          })),
      )
      .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
    const videoSeekBySource: Record<string, number> = {};
    for (const src of sourceById.values()) {
      if (src.documentId === document.id && src.startTime !== null) {
        videoSeekBySource[src.id] = src.startTime;
      }
    }

    return {
      document,
      summaries,
      anchorHighlights,
      annotations,
      annotationBubbles,
      annotationsBySource,
      salienceByBlock,
      hasSalience,
      termsByBlock,
      linksByBlock,
      linksOut,
      linksIn,
      editedByBlock,
      stylesByBlock,
      citationsByBlock,
      references,
      video,
      transcript,
      videoAnnotations,
      videoSeekBySource,
    };
  }

  const paneOne = activeId ? await paneData(activeId) : null;
  const paneTwo =
    paneTwoId === null ? null : paneTwoId === activeId ? paneOne : await paneData(paneTwoId);

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

  // Edit history for the open document, newest first.
  const edits: EditItem[] = paneOne
    ? (
        await db.blockEdit.findMany({
          where: { documentId: paneOne.document.id },
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

  // Context for the Context tab: notebook override wins over the global context
  // (SPEC.md §3). Same ladder as loadProfile.
  const globalProfile = await db.readerProfile.findUnique({ where: { userId: USER_ID } });
  const override = notebook.profile as {
    background?: string;
    purpose?: string;
    application?: string;
  } | null;
  const hasOverride = hasContext(override);
  const contextValues = hasOverride
    ? {
        background: override?.background ?? "",
        purpose: override?.purpose ?? "",
        application: override?.application ?? "",
      }
    : globalProfile
      ? {
          background: globalProfile.background,
          purpose: globalProfile.purpose,
          application: globalProfile.application,
        }
      : null;

  const paneNode = (pane: NonNullable<typeof paneOne>, key: string) => (
    <div key={key} className="flex h-full min-h-0 flex-col">
      {pane.video ? (
        <VideoPane
          notebookId={notebook.id}
          documentId={pane.document.id}
          title={pane.document.title}
          video={pane.video}
          transcript={pane.transcript}
          annotations={pane.videoAnnotations}
          seekBySource={pane.videoSeekBySource}
        />
      ) : (
        <ReaderInteractions
          documentId={pane.document.id}
          notebookId={notebook.id}
          sectionChoices={sectionChoices}
          attachedDocuments={attached}
          title={pane.document.title}
          blocks={pane.document.blocks.map((b) => ({
            id: b.id,
            type: b.type,
            text: b.text,
            html: b.html,
          }))}
          anchorHighlights={pane.anchorHighlights}
          annotationsBySource={pane.annotationsBySource}
          annotationBubbles={pane.annotationBubbles}
          salienceByBlock={pane.salienceByBlock}
          hasSalience={pane.hasSalience}
          termsByBlock={pane.termsByBlock}
          linksByBlock={pane.linksByBlock}
          editedByBlock={pane.editedByBlock}
          stylesByBlock={pane.stylesByBlock}
          citationsByBlock={pane.citationsByBlock}
          references={pane.references}
          font={pane.document.font}
        />
      )}
    </div>
  );

  return (
    <Workspace
      notebook={view}
      documents={attached}
      activeDocumentId={paneOne?.document.id ?? null}
      context={{
        initial: contextValues,
        hasOverride,
        isSet: hasContext(contextValues),
      }}
      assistant={
        <AssistantPanel
          key={paneOne?.document.id ?? "none"}
          notebookId={notebook.id}
          documentId={paneOne?.document.id ?? null}
          summaries={paneOne?.summaries ?? {}}
        />
      }
      annotationsPanel={
        <AnnotationsPanel
          notebookId={notebook.id}
          documentId={paneOne?.document.id ?? null}
          annotations={paneOne?.annotations ?? []}
          linksOut={paneOne?.linksOut ?? []}
          linksIn={paneOne?.linksIn ?? []}
        />
      }
      editsPanel={
        <EditsPanel
          edits={edits}
          liveBlockIds={paneOne?.document.blocks.map((b) => b.id) ?? []}
        />
      }
      annotationCount={
        (paneOne?.annotations.length ?? 0) +
        (paneOne?.linksOut.length ?? 0) +
        (paneOne?.linksIn.length ?? 0)
      }
      reader={
        paneOne ? (
          <ReaderPanes
            notebookId={notebook.id}
            view={readerView}
            paneOneId={paneOne.document.id}
            paneTwoId={paneTwo?.document.id ?? null}
            documents={attached.map((d) => ({ id: d.id, title: d.title }))}
            paneOne={paneNode(paneOne, `one:${paneOne.document.id}`)}
            paneTwo={paneTwo ? paneNode(paneTwo, `two:${paneTwo.document.id}`) : null}
          />
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
