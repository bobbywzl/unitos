import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { parsePdf } from "@/lib/parse/pdf";
import { pruneReferences } from "@/lib/parse/references";
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
export type IngestStage = "parse" | "save" | "fetch" | "extract" | "select" | "structure";
export type OnIngestProgress = (stage: IngestStage, detail?: string) => void;

// URL blocks pass through two model passes: the core pass separates the article
// from page chrome, then the structure pass tidies what survives (SPEC.md §2).
// References prune afterwards: a link reference whose citing blocks were
// dropped was chrome, not a citation.
async function refineUrlBlocks(parsed: ParsedDocument, onProgress?: OnIngestProgress) {
  onProgress?.("select");
  const core = await selectCoreBlocks(parsed.blocks, parsed.title);
  onProgress?.("structure");
  const blocks = await structureBlocks(core, parsed.title);
  const references = pruneReferences(
    blocks,
    parsed.references ?? [],
    parsed.formalReferences ?? 0,
  );
  return { blocks, references };
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
        citations: b.citations,
        styles: b.styles,
        links: b.links,
      })),
    });
    return document;
  });
}

// Upload path. Dedupe by fileHash: a re-upload returns the existing document, no re-parse.
export async function ingestPdf(
  bytes: Uint8Array<ArrayBuffer>,
  filename: string,
  onProgress?: OnIngestProgress,
) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  onProgress?.("parse");
  const parsed = await parsePdf(bytes);
  const title = parsed.title ?? filename.replace(/\.pdf$/i, "");
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title,
    fileHash,
    fileData: bytes,
    blocks: parsed.blocks,
  });
  return { document, deduped: false };
}

// URL path. Dedupe by exact sourceUrl. A stale stored parse upgrades in place:
// adding the URL again must never hand back blocks from an older parser.
export async function ingestUrl(url: string, onProgress?: OnIngestProgress) {
  const existing = await db.document.findFirst({ where: { sourceUrl: url } });
  if (existing) {
    if (existing.parserVersion < PARSER_VERSION) {
      const document = await reparseDocument(existing.id, onProgress);
      if (document) return { document, deduped: false };
    }
    return { document: existing, deduped: true };
  }

  const parsed = await parseUrl(url, onProgress);
  const { blocks, references } = await refineUrlBlocks(parsed, onProgress);
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title: parsed.title ?? url,
    sourceUrl: url,
    blocks,
    references,
  });
  return { document, deduped: false };
}

// Re-parse from stored bytes or source URL. Block ids change; anchors re-resolve by quote (SPEC.md §5).
// Video documents never re-parse: their blocks are the player and the transcript (SPEC.md §11).
export async function reparseDocument(documentId: string, onProgress?: OnIngestProgress) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { video: { select: { id: true } } },
  });
  if (!document) return null;
  if (document.video) throw new Error("Video documents do not re-parse");

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
        citations: b.citations,
        styles: b.styles,
        links: b.links,
      })),
    });
    await tx.document.update({
      where: { id: documentId },
      data: { parserVersion: PARSER_VERSION, references },
    });
  });
  return db.document.findUnique({ where: { id: documentId } });
}
