import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { requestDriveToken } from "@/lib/drive/request-token";
import { classifyDriveFile } from "@/lib/drive/types";
import {
  driveDownloadUrl,
  driveFetchUrl,
  fetchDriveFile,
  fetchDriveMetadata,
  fetchDrivePdf,
  fetchExported,
  fetchExportedPdf,
} from "@/lib/drive/fetch";
import { runConversion } from "@/lib/handwritten/convert";
import { renderPageImages, renderSlidePictures } from "@/lib/handwritten/page-images";
import { SHEETS_MIME_TYPE, SLIDES_MIME_TYPE } from "@/lib/office-file";
import { serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { describeIngestError } from "@/lib/parse/ingest-error";
import { ingestMediaUrl } from "@/lib/video/ingest-media-url";
import { runTranscription } from "@/lib/video/transcription-job";
import { parseBody } from "@/lib/validate";

// Google Drive upload (SPEC.md §14): the client holds a short-lived Drive
// OAuth token (per-visit grant, or minted from the linked account's refresh
// token) and the file the reader picked; this route spends the token once,
// immediately, and never stores it. A request without a bearer token mints one
// from the linked grant — the pasted-Drive-link path. What the token reaches
// (the stored grant, or the configured access a per-visit grant asked for)
// picks the message when Drive refuses a file. Same budget as
// /api/documents, which downloads media URLs under the same ceiling.
export const maxDuration = 120;

// name and mimeType come from the picker; a pasted link sends the fileId
// alone and the facts come from Drive metadata. instructions, pages, and
// convert are the upload assistant's check output (SPEC.md §15, §16), same as
// every other PDF add path.
const bodySchema = z.object({
  notebookId: z.string().min(1),
  fileId: z.string().min(1),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  pages: z.boolean().default(false),
  convert: z.boolean().default(true),
});

export async function POST(req: Request) {
  const user = await currentUser();
  const t = await serverT();
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const { token, grant } = await requestDriveToken(req, user);
  if (!token) return NextResponse.json({ error: t("api.driveTokenMissing") }, { status: 401 });

  let name = data.name;
  let mimeType = data.mimeType;
  if (!name || !mimeType) {
    try {
      ({ name, mimeType } = await fetchDriveMetadata(data.fileId, token, grant, t));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("api.driveFetchFailed");
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const kind = classifyDriveFile(mimeType, name);
  if (kind === "unsupported") {
    return NextResponse.json({ error: t("api.driveUnsupportedType") }, { status: 400 });
  }

  // Video and audio: the same download-and-store path a direct media link
  // uses (SPEC.md §11), just with a bearer token on the request.
  if (kind === "media") {
    const mediaName = name;
    return progressResponse(async (onProgress) => {
      const { document, deduped } = await ingestMediaUrl(driveDownloadUrl(data.fileId), t, onProgress, {
        headers: { Authorization: `Bearer ${token}` },
        fetchUrl: driveFetchUrl(data.fileId),
        // The download URL's own path is the Drive file id, not a name —
        // pass the picked file's real name, extension stripped like the
        // chunked video upload path titles a document (/api/uploads/complete).
        title: mediaName.replace(/\.[a-z0-9]+$/i, ""),
      });
      await attachDocument(data.notebookId, document.id);
      await bumpNotebook(data.notebookId);
      // Transcription starts on its own — the transcript is the point. The
      // recommended-links scan follows it, so it reads the transcript.
      if (!deduped) after(() => runTranscription(document.id).catch(() => {}));
      return { id: document.id, title: document.title, deduped };
    });
  }

  // The parse chain (jsdom, unpdf) loads per request; see /api/documents
  // for why it cannot load with the route module.
  let parse: typeof import("@/lib/parse/ingest");
  try {
    parse = await import("@/lib/parse/ingest");
  } catch (err) {
    console.error("Parse module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: t("api.parsingUnavailable", { message }) }, { status: 500 });
  }

  // Slides and sheets (SPEC.md §27): a Google Slides file arrives as Drive's
  // .pptx export plus its PDF export — the pictures the reader draws over
  // the replicas — and a Google Sheets file as Drive's .xlsx export; a
  // .pptx or .xlsx/.csv sitting in Drive downloads as it is. Each ingests
  // exactly like the same file uploaded.
  if (kind === "slides" || kind === "sheets" || kind === "slides-file" || kind === "sheets-file") {
    const fileName = name;
    const fileId = data.fileId;
    return progressResponse(async (onProgress) => {
      onProgress("fetch");
      try {
        if (kind === "slides" || kind === "slides-file") {
          const bytes =
            kind === "slides"
              ? await fetchExported(fileId, token, grant, t, SLIDES_MIME_TYPE)
              : await fetchDriveFile(fileId, token, grant, t);
          // The pictures are a bonus: a failed PDF export leaves the replicas.
          let picture: Uint8Array<ArrayBuffer> | undefined;
          if (kind === "slides") {
            try {
              picture = await fetchExportedPdf(fileId, token, grant, t);
            } catch (err) {
              console.warn("[drive] slides PDF export failed:", err);
            }
          }
          const { document, deduped } = await parse.ingestSlides(
            bytes,
            kind === "slides" ? `${fileName}.pptx` : fileName,
            onProgress,
            { picture },
            user?.id ?? null,
          );
          await attachDocument(data.notebookId, document.id);
          await bumpNotebook(data.notebookId);
          if (!deduped) {
            const pdf = picture;
            if (pdf) after(() => renderSlidePictures(document.id, pdf).catch(() => {}));
            after(() => refreshSkeleton(document.id, user?.id ?? null).catch(() => {}));
          }
          return { id: document.id, title: document.title, deduped };
        }
        const bytes =
          kind === "sheets"
            ? await fetchExported(fileId, token, grant, t, SHEETS_MIME_TYPE)
            : await fetchDriveFile(fileId, token, grant, t);
        const { document, deduped } = await parse.ingestSheets(
          bytes,
          kind === "sheets" ? `${fileName}.xlsx` : fileName,
          onProgress,
        );
        await attachDocument(data.notebookId, document.id);
        await bumpNotebook(data.notebookId);
        if (!deduped) after(() => refreshSkeleton(document.id, user?.id ?? null).catch(() => {}));
        return { id: document.id, title: document.title, deduped };
      } catch (err) {
        console.error("Drive slides/sheets ingest failed:", err);
        throw new Error(describeIngestError(err, t, "pdf"));
      }
    });
  }

  // kind is "pdf" or "export" — both end up as PDF bytes, ingested the one
  // way this app reads a PDF.
  const pdfName = name;
  return progressResponse(async (onProgress) => {
    onProgress("fetch");
    const bytes =
      kind === "export"
        ? await fetchExportedPdf(data.fileId, token, grant, t)
        : await fetchDrivePdf(data.fileId, token, grant, t);
    const filename = kind === "export" ? `${pdfName}.pdf` : pdfName;
    let ingested: Awaited<ReturnType<typeof parse.ingestPdf>>;
    try {
      ingested = await parse.ingestPdf(
        bytes,
        filename,
        onProgress,
        { pages: data.pages, convert: data.convert },
        user?.id ?? null,
      );
    } catch (err) {
      console.error("Drive PDF ingest failed:", err);
      throw new Error(describeIngestError(err, t, "pdf"));
    }
    const { document, deduped } = ingested;
    await attachDocument(data.notebookId, document.id);
    await bumpNotebook(data.notebookId);
    // The skeleton builds after the response (SPEC.md §22); a handwritten
    // document's waits for its conversion.
    if (!deduped && !document.handwritten) after(() => refreshSkeleton(document.id, user?.id ?? null).catch(() => {}));
    if (!deduped && document.handwritten) {
      // The pages render and store after the response (SPEC.md §16); the
      // reader loads them as they land, and the page image route renders
      // any page still missing on request.
      after(() => renderPageImages(document.id).catch(() => {}));
    }
    if (!deduped && document.handwritten && document.conversionStatus === "NONE") {
      // A handwritten document (SPEC.md §16): conversion starts on its own —
      // the text is the point. Glossary and the recommended-links scan follow
      // it, so they read the converted text. conversionStatus OFF = the
      // reader said not to convert; nothing starts.
      after(() => runConversion(document.id, user?.id ?? null).catch(() => {}));
    }
    return { id: document.id, title: document.title, deduped };
  });
}
