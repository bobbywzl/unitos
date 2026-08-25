import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { buildGlossary } from "@/lib/glossary";
import { serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { ingestYouTube } from "@/lib/video/ingest-youtube";
import { runTranscription } from "@/lib/video/transcription-job";
import { parseYouTubeId } from "@/lib/video/youtube";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

const MAX_PDF_BYTES = 50 * 1024 * 1024;

export async function GET() {
  const documents = await db.document.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      sourceUrl: true,
      createdAt: true,
      _count: { select: { blocks: true } },
    },
  });
  return NextResponse.json(documents);
}

const urlSchema = z.object({
  url: z.url(),
  notebookId: z.string().min(1),
});

const fileFieldsSchema = z.object({
  notebookId: z.string().min(1),
  filename: z.string().min(1),
});

// PDF upload (multipart) or URL ingestion (JSON). Both attach to the notebook.
export async function POST(req: Request) {
  const t = await serverT();
  // The parse chain (jsdom, unpdf) loads per request. Loading it with the route module
  // broke every response on Vercel; loading it here keeps GET working and turns a load
  // failure into a readable error.
  let parse: typeof import("@/lib/parse/ingest");
  try {
    parse = await import("@/lib/parse/ingest");
  } catch (err) {
    console.error("Parse module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: t("api.parsingUnavailable", { message }) },
      { status: 500 },
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: t("api.missingFile") }, { status: 400 });
    }
    const fields = fileFieldsSchema.safeParse({
      notebookId: form.get("notebookId"),
      filename: file instanceof File ? file.name : "document.pdf",
    });
    if (!fields.success) {
      return NextResponse.json({ error: t("api.validationFailed"), issues: fields.error.issues }, { status: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return NextResponse.json({ error: t("api.pdfTooLarge") }, { status: 413 });
    }
    const notebook = await db.notebook.findUnique({ where: { id: fields.data.notebookId } });
    if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
      return NextResponse.json({ error: t("api.notPdf") }, { status: 400 });
    }
    return progressResponse(async (onProgress) => {
      try {
        const { document, deduped } = await parse.ingestPdf(bytes, fields.data.filename, onProgress);
        await attachDocument(fields.data.notebookId, document.id);
        // On-ingest glossary extraction (SPEC.md §8 Phase 7). Best-effort; after() keeps it
        // alive past the response on serverless.
        if (!deduped) after(() => buildGlossary(document.id).catch(() => {}));
        return { id: document.id, title: document.title, deduped };
      } catch (err) {
        console.error("PDF ingest failed:", err);
        throw new Error(t("api.pdfParseFailed"));
      }
    });
  }

  const { data, error } = await parseBody(req, urlSchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });

  // A YouTube link is a video document, wherever it was pasted (SPEC.md §11).
  const youtubeId = parseYouTubeId(data.url);
  if (youtubeId) {
    return progressResponse(async (onProgress) => {
      const { document, deduped } = await ingestYouTube(youtubeId, onProgress);
      await attachDocument(data.notebookId, document.id);
      // Transcription starts on its own — the transcript is the point.
      // after() keeps it alive past the response on serverless; the pane
      // polls the status in.
      if (!deduped) after(() => runTranscription(document.id).catch(() => {}));
      return { id: document.id, title: document.title, deduped };
    });
  }

  return progressResponse(async (onProgress) => {
    try {
      const { document, deduped } = await parse.ingestUrl(data.url, onProgress);
      await attachDocument(data.notebookId, document.id);
      if (!deduped) after(() => buildGlossary(document.id).catch(() => {}));
      return { id: document.id, title: document.title, deduped };
    } catch (err) {
      console.error("URL ingest failed:", err);
      throw new Error(t("api.urlIngestFailed"));
    }
  });
}
