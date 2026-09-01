import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authEnabled, currentUser } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";
import { parseDriveFileId } from "@/lib/drive/types";
import { currentLang, serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { ingestMediaUrl } from "@/lib/video/ingest-media-url";
import { ingestYouTube } from "@/lib/video/ingest-youtube";
import { runTranscription } from "@/lib/video/transcription-job";
import { isMediaUrl } from "@/lib/video/types";
import { parseYouTubeId } from "@/lib/video/youtube";
import { parseBody } from "@/lib/validate";

// A split add parses one very long page and saves several documents; the AI
// passes on such a page need the headroom.
export const maxDuration = 300;

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

// instructions: the feasible upload instructions from the upload assistant's
// check, threaded into the AI passes. split: save one very long page as
// multiple documents (SPEC.md §15). The upload assistant's box sends both; a
// multi-page add sends one request per page.
const urlSchema = z.object({
  url: z.url(),
  notebookId: z.string().min(1),
  instructions: z.string().max(2_000).default(""),
  split: z.boolean().default(false),
});

// pages and convert are the PDF directives from the instruction check
// (SPEC.md §16), "1"/"0" as form fields.
const fileFieldsSchema = z.object({
  notebookId: z.string().min(1),
  filename: z.string().min(1),
  instructions: z.string().max(2_000),
  pages: z.enum(["0", "1"]).default("0"),
  convert: z.enum(["0", "1"]).default("1"),
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
      instructions: form.get("instructions") ?? "",
      pages: form.get("pages") ?? "0",
      convert: form.get("convert") ?? "1",
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
          {
            instructions: fields.data.instructions.trim() || undefined,
            pages: fields.data.pages === "1",
            convert: fields.data.convert === "1",
          },
          user?.id ?? null,
        );
        await attachDocument(fields.data.notebookId, document.id);
        await bumpNotebook(fields.data.notebookId);
        if (!deduped && document.handwritten && document.conversionStatus === "NONE") {
          // A handwritten document (SPEC.md §16): conversion starts on its own
          // — the text is the point. Glossary and the recommended-links scan
          // follow it, so they read the converted text. conversionStatus OFF =
          // the reader said not to convert; nothing starts.
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
        } else if (!document.handwritten || document.conversionStatus === "READY") {
          // On-ingest glossary extraction (SPEC.md §8 Phase 7). Best-effort; after() keeps it
          // alive past the response on serverless. A handwritten document
          // without converted text has nothing to read — both scans skip.
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

  // A Google Drive link is not a readable page (sign-in wall); the Drive
  // import is the path for it (SPEC.md §14). The client routes these itself —
  // this answers direct calls with the same direction instead of a parse
  // failure.
  if (parseDriveFileId(data.url)) {
    return NextResponse.json({ error: t("api.driveLinkUseDrive") }, { status: 400 });
  }

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
      const { document, extra, deduped } = await parse.ingestUrl(data.url, onProgress, {
        instructions: data.instructions.trim() || undefined,
        split: data.split,
      });
      // A split add saves several documents; every one attaches, gets its
      // glossary, and gets its recommended-links scan, like any document.
      const documents = [document, ...(extra ?? [])];
      for (const doc of documents) {
        await attachDocument(data.notebookId, doc.id);
        if (!deduped) after(() => buildGlossary(doc.id, user?.id ?? null).catch(() => {}));
        after(() =>
          buildConnections(data.notebookId, doc.id, user?.id ?? null, lang).catch(() => {}),
        );
      }
      await bumpNotebook(data.notebookId);
      return {
        id: document.id,
        title: document.title,
        deduped,
        ...(documents.length > 1
          ? { documents: documents.map((d) => ({ id: d.id, title: d.title })) }
          : {}),
      };
    } catch (err) {
      console.error("URL ingest failed:", err);
      throw new Error(t("api.urlIngestFailed"));
    }
  });
}
