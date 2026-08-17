import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { parsePdf } from "@/lib/parse/pdf";
import { structureBlocks } from "@/lib/parse/structure";
import { parseUrl } from "@/lib/parse/url";
import { PARSER_VERSION, type ParsedBlock } from "@/lib/parse/types";

// Ingest progress, reported to the caller as each stage starts. A repeated stage
// updates the detail line ("148 figures · 152 equations"). Dedupe hits report
// nothing — there is no parse or save to do, the caller treats "no events" as instant.
// PDF stages: parse, save. URL stages: fetch, extract, structure, save.
export type IngestStage = "parse" | "save" | "fetch" | "extract" | "structure";
export type OnIngestProgress = (stage: IngestStage, detail?: string) => void;

async function createDocumentWithBlocks(data: {
  title: string;
  sourceUrl?: string;
  fileHash?: string;
  fileData?: Uint8Array<ArrayBuffer>;
  blocks: ParsedBlock[];
}) {
  return db.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        title: data.title,
        sourceUrl: data.sourceUrl,
        fileHash: data.fileHash,
        fileData: data.fileData,
        parserVersion: PARSER_VERSION,
      },
    });
    await tx.block.createMany({
      data: data.blocks.map((b, i) => ({
        documentId: document.id,
        order: i,
        type: b.type,
        text: b.text,
        html: b.html,
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
  onProgress?.("structure");
  const blocks = await structureBlocks(parsed.blocks, parsed.title);
  onProgress?.("save");
  const document = await createDocumentWithBlocks({
    title: parsed.title ?? url,
    sourceUrl: url,
    blocks,
  });
  return { document, deduped: false };
}

// Re-parse from stored bytes or source URL. Block ids change; anchors re-resolve by quote (SPEC.md §5).
export async function reparseDocument(documentId: string, onProgress?: OnIngestProgress) {
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return null;

  let blocks: ParsedBlock[];
  if (document.fileData) {
    onProgress?.("parse");
    blocks = (await parsePdf(new Uint8Array(document.fileData))).blocks;
  } else if (document.sourceUrl) {
    const parsed = await parseUrl(document.sourceUrl, onProgress);
    onProgress?.("structure");
    blocks = await structureBlocks(parsed.blocks, parsed.title);
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
      })),
    });
    await tx.document.update({
      where: { id: documentId },
      data: { parserVersion: PARSER_VERSION },
    });
  });
  return db.document.findUnique({ where: { id: documentId } });
}
