import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { parsePdf } from "@/lib/parse/pdf";
import { structureBlocks } from "@/lib/parse/structure";
import { parseUrl } from "@/lib/parse/url";
import type { ParsedBlock } from "@/lib/parse/types";

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

// URL path. Dedupe by exact sourceUrl.
export async function ingestUrl(url: string, onProgress?: OnIngestProgress) {
  const existing = await db.document.findFirst({ where: { sourceUrl: url } });
  if (existing) return { document: existing, deduped: true };

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
export async function reparseDocument(documentId: string) {
  const document = await db.document.findUnique({ where: { id: documentId } });
  if (!document) return null;

  let blocks: ParsedBlock[];
  if (document.fileData) {
    blocks = (await parsePdf(new Uint8Array(document.fileData))).blocks;
  } else if (document.sourceUrl) {
    const parsed = await parseUrl(document.sourceUrl);
    blocks = await structureBlocks(parsed.blocks, parsed.title);
  } else {
    throw new Error("Document has no stored file and no source URL");
  }

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
  });
  return db.document.findUnique({ where: { id: documentId } });
}
