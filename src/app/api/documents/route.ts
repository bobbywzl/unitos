import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authEnabled, currentUser } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";
import { currentLang, serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { ingestMediaUrl } from "@/lib/video/ingest-media-url";
import { ingestYouTube } from "@/lib/video/ingest-youtube";
import { runTranscription } from "@/lib/video/transcription-job";
import { isMediaUrl } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

const MAX_PDF_BYTES = 50 * 1024 * 1024;

// The library: the documents attached to corpora the reader can open.
export async function GET() {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const documents = await db.document.findMany({
    where: authEnabled()
      ? {
          notebooks: {
            some: {
              notebook: {
                OR: [
                  { userId: user.id },
                  { collaborators: { some: { email: user.email } } },
                ],
              },
            },
          },
        }
      : undefined,
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
  const user = await currentUser();
  const t = await serverT();
  // Captured now: the after() scans below outlive the request and its cookies.
  const lang = await currentLang();
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
    const access = await notebookAccess(fields.data.notebookId, "editor");
    if (access instanceof NextResponse) return access;

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
      return NextResponse.json({ error: t("api.notPdf") }, { status: 400 });
    }
    return progressResponse(async (onProgress) => {
      try {
        const { document, deduped } = await parse.ingestPdf(
          bytes,
          fields.data.filename,
          onProgress,
          user?.id ?? null,
        );
        await attachDocument(fields.data.notebookId, document.id);
        await bumpNotebook(fields.data.notebookId);
        if (!deduped && document.handwritten) {
          // A handwritten document (SPEC.md §14): conversion starts on its own
          // — the text is the point. Glossary and the recommended-links scan
          // follow it, so they read the converted text.
          after(() =>
            runConversion(document.id, user?.id ?? null)
              .then((r) =>
                r.ok ? buildGlossary(document.id, user?.id ?? null).catch(() => {}) : undefined,
              )
              .then(() =>
                buildConnections(fields.data.notebookId, document.id, user?.id ?? null, lang),
              )
              .catch(() => {}),
          );
        } else {
          // On-ingest glossary extraction (SPEC.md §8 Phase 7). Best-effort; after() keeps it
          // alive past the response on serverless.
          if (!deduped) after(() => buildGlossary(document.id, user?.id ?? null).catch(() => {}));
          // Recommended links (SPEC.md §13): scan the document against the corpus.
          after(() =>
            buildConnections(fields.data.notebookId, document.id, user?.id ?? null, lang).catch(
              () => {},
            ),
          );
        }
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
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  // A YouTube link is a video document, wherever it was pasted (SPEC.md §11).
  const youtubeId = parseYouTubeId(data.url);
  if (youtubeId) {
    return progressResponse(async (onProgress) => {
      let ingested: Awaited<ReturnType<typeof ingestYouTube>>;
      try {
        ingested = await ingestYouTube(youtubeId, onProgress);
      } catch (err) {
        console.error("YouTube ingest failed:", err);
        throw new Error(t("api.youtubeUnavailable"));
      }
      const { document, deduped } = ingested;
      await attachDocument(data.notebookId, document.id);
      await bumpNotebook(data.notebookId);
      // Transcription starts on its own — the transcript is the point.
      // after() keeps it alive past the response on serverless; the pane
      // polls the status in. Recommended links scan once the transcript is
      // there — the transcript is the text the scan reads.
      if (!deduped) {
        after(() =>
          runTranscription(document.id)
            .then(() => buildConnections(data.notebookId, document.id, user?.id ?? null, lang))
            .catch(() => {}),
        );
      } else {
        after(() =>
          buildConnections(data.notebookId, document.id, user?.id ?? null, lang).catch(() => {}),
        );
      }
      return { id: document.id, title: document.title, deduped };
    });
  }

  // A direct video or audio file link is a media document too (SPEC.md §11):
  // the bytes download and store like an uploaded file, transcription starts.
  if (isMediaUrl(data.url)) {
    return progressResponse(async (onProgress) => {
      let ingested: Awaited<ReturnType<typeof ingestMediaUrl>>;
      try {
        ingested = await ingestMediaUrl(data.url, t, onProgress);
      } catch (err) {
        console.error("Media URL ingest failed:", err);
        throw err instanceof Error ? err : new Error(t("api.mediaUnavailable"));
      }
      const { document, deduped } = ingested;
      await attachDocument(data.notebookId, document.id);
      await bumpNotebook(data.notebookId);
      // Transcription starts on its own — the transcript is the point. The
      // recommended-links scan follows it, so it reads the transcript.
      if (!deduped) {
        after(() =>
          runTranscription(document.id)
            .then(() => buildConnections(data.notebookId, document.id, user?.id ?? null, lang))
            .catch(() => {}),
        );
      } else {
        after(() =>
          buildConnections(data.notebookId, document.id, user?.id ?? null, lang).catch(() => {}),
        );
      }
      return { id: document.id, title: document.title, deduped };
    });
  }

  return progressResponse(async (onProgress) => {
    try {
      const { document, deduped } = await parse.ingestUrl(data.url, onProgress);
      await attachDocument(data.notebookId, document.id);
      await bumpNotebook(data.notebookId);
      if (!deduped) after(() => buildGlossary(document.id, user?.id ?? null).catch(() => {}));
      after(() =>
        buildConnections(data.notebookId, document.id, user?.id ?? null, lang).catch(() => {}),
      );
      return { id: document.id, title: document.title, deduped };
    } catch (err) {
      console.error("URL ingest failed:", err);
      throw new Error(t("api.urlIngestFailed"));
    }
  });
}
