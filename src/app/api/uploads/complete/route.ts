import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildGlossary } from "@/lib/glossary";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

const MAX_PDF_BYTES = 50 * 1024 * 1024;

const bodySchema = z.object({
  uploadId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  filename: z.string().min(1),
  notebookId: z.string().min(1),
});

// Assembles the chunks of a large PDF upload and ingests the result — the same
// parse, save, attach path as a direct upload to /api/documents.
export async function POST(req: Request) {
  // The parse chain (jsdom, unpdf) loads per request; see /api/documents.
  let parse: typeof import("@/lib/parse/ingest");
  try {
    parse = await import("@/lib/parse/ingest");
  } catch (err) {
    console.error("Parse module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Document parsing is unavailable: ${message}` },
      { status: 500 },
    );
  }

  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

  const chunks = await db.uploadChunk.findMany({
    where: { uploadId: data.uploadId },
    orderBy: { index: "asc" },
  });
  if (chunks.length === 0) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  }
  if (chunks.some((c, i) => c.index !== i)) {
    return NextResponse.json({ error: "Upload is missing chunks. Try again." }, { status: 400 });
  }
  const total = chunks.reduce((n, c) => n + c.data.length, 0);
  if (total > MAX_PDF_BYTES) {
    await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
    return NextResponse.json({ error: "PDF is larger than 50MB" }, { status: 413 });
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  // Chunks are staging only; the assembled bytes are in memory now.
  await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });

  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    return NextResponse.json({ error: "File is not a PDF" }, { status: 400 });
  }

  return progressResponse(async (onProgress) => {
    try {
      const { document, deduped } = await parse.ingestPdf(bytes, data.filename, onProgress);
      await attachDocument(data.notebookId, document.id);
      // On-ingest glossary extraction (SPEC.md §8 Phase 7). Best-effort; after() keeps it
      // alive past the response on serverless.
      if (!deduped) after(() => buildGlossary(document.id).catch(() => {}));
      return { id: document.id, title: document.title, deduped };
    } catch (err) {
      console.error("PDF ingest failed:", err);
      throw new Error("Could not parse this PDF");
    }
  });
}
