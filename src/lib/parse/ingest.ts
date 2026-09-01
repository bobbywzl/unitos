import { createHash } from "node:crypto";
import type { Document } from "@prisma/client";
import { db } from "@/lib/db";
import { classifyPdf } from "@/lib/handwritten/classify";
import { pageBlockText, pdfPageCount } from "@/lib/handwritten/pages";
import { parsePdf } from "@/lib/parse/pdf";
import { pruneReferences } from "@/lib/parse/references";
import { splitBlocks, splitPartCount } from "@/lib/parse/split";
import { selectCoreBlocks, structureBlocks } from "@/lib/parse/structure";
import { parseUrl } from "@/lib/parse/url";
import {
  PARSER_VERSION,
  type DocumentReference,
  type ParsedBlock,
  type ParsedDocument,
} from "@/lib/parse/types";

// Ingest progress, reported to the caller as each stage starts. A repeated stage
// updates the detail line ("148 figures · 152 equations"). Dedupe hits report
// nothing — there is no parse or save to do, the caller treats "no events" as instant.
// PDF stages: parse, save. URL stages: fetch, extract, select, structure, save.
// The upload assistant's review streams fetch, extract, review.
export type IngestStage =
  | "parse"
  | "save"
  | "fetch"
  | "extract"
  | "select"
  | "structure"
  | "review";
export type OnIngestProgress = (stage: IngestStage, detail?: string) => void;

// Upload instructions and the split choice from the upload assistant (SPEC.md §15).
// instructions is the feasible text the assistant agreed to follow; it steers
// the AI passes and never writes content.
export type IngestOptions = {
  instructions?: string;
  split?: boolean;
};

// A split part's sourceUrl carries this marker plus its part number, so parts
// stay distinct for dedupe and never re-parse (a re-parse would paste the whole
// page over one part).
export const SPLIT_URL_MARKER = "#unitos-part-";

// URL blocks pass through two model passes: the core pass separates the article
// from page chrome, then the structure pass tidies what survives (SPEC.md §2).
// References prune afterwards: a link reference whose citing blocks were
// dropped was chrome, not a citation.
async function refineUrlBlocks(
  parsed: ParsedDocument,
  onProgress?: OnIngestProgress,
  instructions?: string,
) {
  onProgress?.("select");
  const core = await selectCoreBlocks(parsed.blocks, parsed.title, instructions);
  onProgress?.("structure");
  const blocks = await structureBlocks(core, parsed.title, instructions);
  const references = pruneReferences(
    blocks,
    parsed.references ?? [],
    parsed.formalReferences ?? 0,
  );
  return { blocks, references };
}

// Each split part keeps only the references its own blocks cite.
function referencesForPart(
  blocks: ParsedBlock[],
  references: DocumentReference[],
): DocumentReference[] | undefined {
  const cited = new Set(blocks.flatMap((b) => (b.citations ?? []).map((c) => c.refId)));
  const kept = references.filter((r) => cited.has(r.id));
  return kept.length > 0 ? kept : undefined;
}

async function createDocumentWithBlocks(data: {
  title: string;
  sourceUrl?: string;
  fileHash?: string;
  fileData?: Uint8Array<ArrayBuffer>;
  blocks: ParsedBlock[];
  references?: DocumentReference[];
}) {
  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: data.title,
        sourceUrl: data.sourceUrl,
        fileHash: data.fileHash,
        fileData: data.fileData,
        parserVersion: PARSER_VERSION,
        references: data.references,
      },
    });
    await tx.block.createMany({
      data: data.blocks.map((b, i) => ({
        documentId: document.id,
        order: i,
        type: b.type,
        text: b.text,
        html: b.html,
        page: b.page,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
      })),
    });
    return document;
  });
}

// A handwritten document: no text blocks — one PAGE block per PDF page, the
// bytes kept for the page image route, Circle & ask, and conversion (SPEC.md §16).
async function createHandwrittenDocument(data: {
  title: string;
  fileHash: string;
  fileData: Uint8Array<ArrayBuffer>;
  pageCount: number;
}) {
  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: data.title,
        fileHash: data.fileHash,
        fileData: data.fileData,
        parserVersion: PARSER_VERSION,
        handwritten: true,
      },
    });
    await tx.block.createMany({ data: pageBlockRows(document.id, data.pageCount) });
    return document;
  });
}

function pageBlockRows(documentId: string, pageCount: number) {
  return Array.from({ length: pageCount }, (_, i) => ({
    documentId,
    order: i,
    type: "PAGE" as const,
    text: pageBlockText(i + 1),
    page: i + 1,
  }));
}

// Upload path. Dedupe by fileHash: a re-upload returns the existing document, no re-parse.
// Import PDF judges each PDF (SPEC.md §16): a computer-text article parses to
// text blocks; rough handwritten notes and drawings become a handwritten
// document. The caller starts conversion for a handwritten document. With
// instructions, the structure pass runs over the parsed blocks — the one
// lever paste instructions have on a PDF (§15); userId is who the
// classification records usage under.
export async function ingestPdf(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
  userId: string | null = null,
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parsePdf(bytes);
  const pageCount = await pdfPageCount(bytes);
  const kind = await classifyPdf(bytes, parsed.blocks, pageCount, userId);
  if (kind === "handwritten") {
    onProgress?.("save");
    const document = await createHandwrittenDocument({
      title: filename.replace(/\.pdf$/i, ""),
      fileHash,
      fileData: bytes,
      pageCount,
    });
    return { document, deduped: false };
  }
  const title = parsed.title ?? filename.replace(/\.pdf$/i, "");
  const blocks = opts.instructions?.trim()
    ? await structureBlocks(parsed.blocks, title, opts.instructions)
    : parsed.blocks;
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title,
    fileHash,
    fileData: bytes,
    blocks,
  });
  return { document, deduped: false };
}

// URL path. Dedupe by exact sourceUrl. A stale stored parse upgrades in place:
// adding the URL again must never hand back blocks from an older parser.
// With split, one long page saves as multiple documents: `document` is the
// first part, `extra` the rest. Re-adding the same URL with split dedupes to
// the existing first part; without split it saves a fresh whole document.
export async function ingestUrl(
  url: string,
  onProgress?: OnIngestProgress,
  opts: IngestOptions = {},
): Promise<{ document: Document; extra?: Document[]; deduped: boolean }> {
  const existing = await db.document.findFirst({ where: { sourceUrl: url } });
  if (existing) {
    if (existing.parserVersion < PARSER_VERSION) {
      const document = await reparseDocument(existing.id, onProgress);
      if (document) return { document, deduped: false };
    }
    return { document: existing, deduped: true };
  }
  if (opts.split) {
    const part = await db.document.findFirst({
      where: { sourceUrl: { startsWith: `${url}${SPLIT_URL_MARKER}` } },
      orderBy: { createdAt: "asc" },
    });
    if (part) return { document: part, deduped: true };
  }

  const parsed = await parseUrl(url, onProgress);
  const { blocks, references } = await refineUrlBlocks(parsed, onProgress, opts.instructions);
  const title = parsed.title ?? url;

  if (opts.split) {
    const chars = blocks.reduce((n, b) => n + b.text.length, 0);
    const parts = splitBlocks(title, blocks, splitPartCount(chars));
    if (parts.length > 1) {
      onProgress?.("save");
      const documents = [];
      for (let i = 0; i < parts.length; i++) {
        documents.push(
          await createDocumentWithBlocks({
            title: parts[i].title,
            sourceUrl: `${url}${SPLIT_URL_MARKER}${i + 1}`,
            blocks: parts[i].blocks,
            references: referencesForPart(parts[i].blocks, references),
          }),
        );
      }
      return { document: documents[0], extra: documents.slice(1), deduped: false };
    }
  }

  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title,
    sourceUrl: url,
    blocks,
    references,
  });
  return { document, deduped: false };
}

// Re-parse from stored bytes or source URL. Block ids change; anchors re-resolve by quote (SPEC.md §5).
// Video documents never re-parse: their blocks are the player and the transcript (SPEC.md §11).
// `as` flips a PDF between the two shapes (SPEC.md §16) — the escape hatch when
// Import PDF judged it wrong: "article" parses the stored bytes to text blocks;
// "handwritten" rebuilds the PAGE blocks (the caller starts conversion).
// Without `as`, a document keeps its shape.
export async function reparseDocument(
  documentId: string,
  onProgress?: OnIngestProgress,
  as?: "article" | "handwritten",
) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { video: { select: { id: true } } },
  });
  if (!document) return null;
  if (document.video) throw new Error("Video documents do not re-parse");
  // A split part holds one slice of its page; a re-parse would paste the whole
  // page over it (SPEC.md §15).
  if (document.sourceUrl?.includes(SPLIT_URL_MARKER)) {
    throw new Error("Split documents do not re-parse");
  }

  const target = as ?? (document.handwritten ? "handwritten" : "article");
  if (target === "handwritten") {
    if (!document.fileData) throw new Error("Document has no stored file");
    onProgress?.("save");
    const pageCount = await pdfPageCount(new Uint8Array(document.fileData));
    await db.$transaction(async (tx) => {
      await tx.block.deleteMany({ where: { documentId } });
      await tx.block.createMany({ data: pageBlockRows(documentId, pageCount) });
      await tx.document.update({
        where: { id: documentId },
        data: {
          handwritten: true,
          parserVersion: PARSER_VERSION,
          conversionStatus: "NONE",
          conversionError: null,
          conversionStartedAt: null,
        },
      });
    });
    return db.document.findUnique({ where: { id: documentId } });
  }

  let blocks: ParsedBlock[];
  let references: DocumentReference[] | undefined;
  if (document.fileData) {
    onProgress?.("parse");
    blocks = (await parsePdf(new Uint8Array(document.fileData))).blocks;
  } else if (document.sourceUrl) {
    const parsed = await parseUrl(document.sourceUrl, onProgress);
    ({ blocks, references } = await refineUrlBlocks(parsed, onProgress));
  } else {
    throw new Error("Document has no stored file and no source URL");
  }

  onProgress?.("save");
  await db.$transaction(async (tx) => {
    await tx.block.deleteMany({ where: { documentId } });
    await tx.block.createMany({
      data: blocks.map((b, i) => ({
        documentId,
        order: i,
        type: b.type,
        text: b.text,
        html: b.html,
        page: b.page,
        citations: b.citations,
        styles: b.styles,
        links: b.links,
      })),
    });
    await tx.document.update({
      where: { id: documentId },
      data: {
        parserVersion: PARSER_VERSION,
        references,
        handwritten: false,
        conversionStatus: "NONE",
        conversionError: null,
        conversionStartedAt: null,
      },
    });
  });
  return db.document.findUnique({ where: { id: documentId } });
}
