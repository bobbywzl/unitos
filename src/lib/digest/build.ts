import type { DerivationType } from "@prisma/client";
import { db } from "@/lib/db";
import { renderBlockLines, renderReferenceLines } from "@/lib/derive/context";
import {
  distillationList,
  extractionList,
  formalizedArticle,
  type SummaryLevels,
  SUMMARY_DEPTHS,
} from "@/lib/types";
import type {
  DigestCounts,
  DigestDocument,
  DigestEdit,
  DigestLink,
  DigestNote,
  DigestParts,
  DigestQuote,
  DigestSource,
} from "@/lib/digest/types";

const QUOTE_MAX = 240; // quotes re-read in full from the document text above them
const EDIT_TEXT_MAX = 160;
const EDITS_PER_DOCUMENT = 20;

function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

// Annotation and note kinds, one name each (matches AnnotationItem kinds).
function noteKind(derivationType: DerivationType | null, color: string | null, hidden: boolean): string {
  switch (derivationType) {
    case "EXPLAIN":
      return "explanation";
    case "SIMPLIFY":
      return "simplified rewrite";
    case "SYNTHESIS":
      return "assistant conversation";
    case "DISTILL":
      return "distillation quote";
    case "FIND":
      return "video find";
    case "EXTRACT":
      return "extraction note";
    case "SUMMARIZE":
      return "summary note";
    case "ASK":
      return "range answer";
    case "COMPARE":
      return "comparison";
    case "ANALYZE":
      return "analysis";
    case "VOICE":
      return "voice note";
    default:
      return hidden ? (color ? "highlight" : "comment") : "note";
  }
}

type SpanLike = { blockId: string; start: number; end: number; quotedText?: string; caption?: string };

// Resolve a stored span against the current block text. The stored quote is
// the truth for display; orphaned means the words moved or are gone (SPEC.md §5).
function resolveQuote(span: SpanLike, blockText: Map<string, string>): DigestQuote {
  const text = blockText.get(span.blockId);
  const sliced = text?.slice(span.start, span.end) ?? null;
  const quote = span.quotedText ?? sliced ?? "";
  return {
    blockId: span.blockId,
    quote: cut(quote, QUOTE_MAX),
    caption: span.caption ?? null,
    orphaned: sliced === null || (span.quotedText != null && sliced !== span.quotedText),
  };
}

function salienceSpans(value: unknown): SpanLike[] {
  if (!Array.isArray(value)) return [];
  return (value as SpanLike[]).filter(
    (s) => s && typeof s.blockId === "string" && typeof s.start === "number" && typeof s.end === "number",
  );
}

function glossaryTerms(value: unknown): { term: string; definition: string }[] {
  if (!Array.isArray(value)) return [];
  return (value as { term?: string; definition?: string }[])
    .filter((t) => t && typeof t.term === "string" && typeof t.definition === "string")
    .map((t) => ({ term: t.term!, definition: t.definition! }));
}

// Build one corpus's digest parts from the database: every document in full,
// every note, annotation, distillation, extraction, summary, salience span,
// link, and edit (SPEC.md §7).
export async function buildDigest(
  notebookId: string,
): Promise<{ parts: DigestParts; counts: DigestCounts; owner: string } | null> {
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          parent: { select: { title: true } },
          notes: {
            where: { status: { not: "REJECTED" } },
            orderBy: { order: "asc" },
            include: { sources: { include: { document: { select: { title: true } } } } },
          },
        },
      },
      documents: {
        orderBy: { document: { createdAt: "asc" } },
        include: {
          document: {
            include: {
              blocks: {
                orderBy: { order: "asc" },
                select: { id: true, type: true, text: true, startTime: true, endTime: true },
              },
              video: true,
            },
          },
        },
      },
    },
  });
  if (!notebook) return null;

  const documentIds = notebook.documents.map((a) => a.documentId);
  const [links, edits] = await Promise.all([
    documentIds.length > 0
      ? db.docLink.findMany({
          where: { fromDocumentId: { in: documentIds } },
          orderBy: { createdAt: "asc" },
          include: { toDocument: { select: { title: true } } },
        })
      : [],
    documentIds.length > 0
      ? db.blockEdit.findMany({
          where: { documentId: { in: documentIds } },
          orderBy: { createdAt: "desc" },
          take: 400,
        })
      : [],
  ]);

  const toDigestNote = (
    n: (typeof notebook.sections)[number]["notes"][number],
    section: (typeof notebook.sections)[number],
  ): DigestNote => ({
    id: n.id,
    section: section.hidden ? "Annotations" : section.title,
    hidden: section.hidden,
    status: n.status === "PENDING" ? "PENDING" : "ACCEPTED",
    kind: noteKind(n.derivationType, n.color, section.hidden),
    color: n.color,
    content: n.content,
    sources: n.sources.map(
      (src): DigestSource => ({
        documentId: src.documentId,
        documentTitle: src.document.title,
        quote: cut(src.quotedText, QUOTE_MAX),
        orphaned: src.orphaned,
        startTime: src.startTime,
        endTime: src.endTime,
      }),
    ),
  });

  // Visible-section notes stay at corpus level (a note can cite many
  // documents); annotations group under the document their anchor cites.
  const notes: DigestNote[] = [];
  const annotationsByDocument = new Map<string, DigestNote[]>();
  const looseAnnotations: DigestNote[] = [];
  const attached = new Set(documentIds);
  for (const section of notebook.sections) {
    for (const n of section.notes) {
      const digestNote = toDigestNote(n, section);
      if (!section.hidden) {
        notes.push(digestNote);
        continue;
      }
      const anchor = digestNote.sources.find((s) => attached.has(s.documentId));
      if (!anchor) {
        looseAnnotations.push(digestNote);
        continue;
      }
      const list = annotationsByDocument.get(anchor.documentId) ?? [];
      list.push(digestNote);
      annotationsByDocument.set(anchor.documentId, list);
    }
  }

  const sections = notebook.sections
    .filter((s) => !s.hidden)
    .map((s) => `${s.parent ? `${s.parent.title} / ` : ""}${s.title}`);

  let blockCount = 0;
  const documents: DigestDocument[] = notebook.documents.map((attachment) => {
    const d = attachment.document;
    blockCount += d.blocks.length;
    const blockText = new Map(d.blocks.map((b) => [b.id, b.text]));
    const referenceLines = renderReferenceLines(d.references);
    const text = [renderBlockLines(d.blocks), ...(referenceLines.length > 0 ? ["", ...referenceLines] : [])]
      .join("\n")
      .trim();

    const distillations = distillationList(attachment.distillations).map((di) => ({
      id: di.id,
      question: di.question,
      createdAt: di.createdAt,
      quotes: di.quotes.map((quote) => resolveQuote(quote, blockText)),
    }));
    const extractions = extractionList(attachment.extractions).map((ex, i) => ({
      label: `E${i + 1}`,
      origin: resolveQuote(ex.origin, blockText),
      passages: ex.spans.map((span) => resolveQuote(span, blockText)),
    }));
    const summaryLevels = (attachment.summaries ?? {}) as SummaryLevels;
    const summaries = SUMMARY_DEPTHS.filter((depth) => summaryLevels[depth]).map((depth) => ({
      depth,
      text: summaryLevels[depth]!,
    }));
    const salience = salienceSpans(attachment.salience).map((span) => resolveQuote(span, blockText));
    const formalized = formalizedArticle(attachment.formalized);

    const documentLinks: DigestLink[] = links
      .filter((l) => l.fromDocumentId === d.id)
      .map((l) => ({
        quote: cut(l.quotedText, QUOTE_MAX),
        toDocumentId: l.toDocumentId,
        toTitle: l.toDocument.title,
        toQuote: l.toQuotedText ? cut(l.toQuotedText, QUOTE_MAX) : null,
      }));
    const documentEdits: DigestEdit[] = edits
      .filter((e) => e.documentId === d.id)
      .slice(0, EDITS_PER_DOCUMENT)
      .map((e) => ({
        kind: e.kind,
        blockId: e.blockId,
        before: e.before ? cut(e.before, EDIT_TEXT_MAX) : null,
        after: e.after ? cut(e.after, EDIT_TEXT_MAX) : null,
        at: e.createdAt.toISOString(),
      }));

    return {
      id: d.id,
      title: d.title,
      sourceUrl: d.sourceUrl,
      video: d.video
        ? {
            kind: d.video.kind,
            youtubeId: d.video.youtubeId,
            duration: d.video.duration,
            transcriptStatus: d.video.transcriptStatus,
          }
        : null,
      chars: text.length,
      text,
      glossary: glossaryTerms(d.glossary),
      annotations: annotationsByDocument.get(d.id) ?? [],
      distillations,
      extractions,
      summaries,
      salience,
      formalized: formalized ? { title: formalized.title, markdown: formalized.markdown } : null,
      links: documentLinks,
      edits: documentEdits,
    };
  });

  const parts: DigestParts = {
    corpusId: notebook.id,
    corpusTitle: notebook.title,
    sections,
    notes,
    looseAnnotations,
    documents,
  };
  const counts: DigestCounts = {
    documents: documents.length,
    blocks: blockCount,
    notes: notes.length,
    annotations: documents.reduce((a, d) => a + d.annotations.length, 0) + looseAnnotations.length,
    distillations: documents.reduce((a, d) => a + d.distillations.length, 0),
    extractions: documents.reduce((a, d) => a + d.extractions.length, 0),
    summaries: documents.reduce((a, d) => a + d.summaries.length, 0),
    salience: documents.reduce((a, d) => a + d.salience.length, 0),
    links: documents.reduce((a, d) => a + d.links.length, 0),
    edits: documents.reduce((a, d) => a + d.edits.length, 0),
  };
  return { parts, counts, owner: notebook.userId };
}
