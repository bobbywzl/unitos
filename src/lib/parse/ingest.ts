import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { parsePdf } from "@/lib/parse/pdf";
import { parseUrl } from "@/lib/parse/url";
import type { ParsedBlock } from "@/lib/parse/types";

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
export async function ingestPdf(bytes: Uint8Array<ArrayBuffer>, filename: string) {
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const existing = await db.document.findUnique({ where: { fileHash } });
  if (existing) return { document: existing, deduped: true };

  const parsed = await parsePdf(bytes);
  const title = parsed.title ?? filename.replace(/\.pdf$/i, "");
  const document = await createDocumentWithBlocks({
    title,
    fileHash,
    fileData: bytes,
    blocks: parsed.blocks,
  });
  return { document, deduped: false };
}

// URL path. Dedupe by exact sourceUrl.
export async function ingestUrl(url: string) {
  const existing = await db.document.findFirst({ where: { sourceUrl: url } });
  if (existing) return { document: existing, deduped: true };

  const parsed = await parseUrl(url);
  const document = await createDocumentWithBlocks({
    title: parsed.title ?? url,
    sourceUrl: url,
    blocks: parsed.blocks,
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
    blocks = (await parseUrl(document.sourceUrl)).blocks;
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

export async function attachDocument(notebookId: string, documentId: string) {
  await db.notebookDocument.upsert({
    where: { notebookId_documentId: { notebookId, documentId } },
    update: {},
    create: { notebookId, documentId },
  });
}
