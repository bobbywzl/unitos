import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { DuplicateDocumentError } from "@/lib/documents/duplicate-answer";
import { assertNotDuplicate, duplicateAnswer } from "@/lib/documents/duplicates";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { requestDriveToken } from "@/lib/drive/request-token";
import { classifyDriveFile, type DriveAccess } from "@/lib/drive/types";
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
import { renderUploadedSlidePictures } from "@/lib/handwritten/slide-pictures";
import { SHEETS_MIME_TYPE, SLIDES_MIME_TYPE, WORD_MIME_TYPE } from "@/lib/office-file";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import { describeIngestError } from "@/lib/parse/ingest-error";
import { ingestMediaUrl } from "@/lib/video/ingest-media-url";
import { runTranscription } from "@/lib/video/transcription-job";
import { parseBody } from "@/lib/validate";
import { pageRangesSchema } from "@/lib/pdf-pages";

// Google Drive upload (SPEC.md §14): the client holds a short-lived Drive
// OAuth token (per-visit grant, or minted from the linked account's refresh
// token) and the file the reader picked; this route spends the token once,
// immediately, and never stores it. A request without a bearer token mints one
// from the linked grant — the pasted-Drive-link path. What the token reaches
// (the stored grant, or the configured access a per-visit grant asked for)
// picks the message when Drive refuses a file. Same budget as
// /api/documents, which downloads media URLs under the same ceiling and reads
// a scan's pages inside the add (SPEC.md §16).
export const maxDuration = 300;

// name and mimeType come from the picker; a pasted link sends the fileId
// alone and the facts come from Drive metadata. instructions, pages, and
// convert are the upload assistant's check output (SPEC.md §15, §16), same as
// every other PDF add path. pdfPages: a PDF's pages the reader chose (§15).
const bodySchema = z.object({
  // The folder of the project the new document lands in (SPEC.md §6).
  folderId: z.string().min(1).nullable().optional(),
  notebookId: z.string().min(1),
  fileId: z.string().min(1),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  pages: z.boolean().default(false),
  convert: z.boolean().default(true),
  pdfPages: pageRangesSchema.optional(),
  // The reader said Add again to the ask a repeat add answers with
  // (lib/documents/duplicates.ts): a media file's before its download (409),
  // any other file's once its bytes are here (the stream's last line).
  confirmDuplicate: z.boolean().default(false),
});

/** The hash a stored file keeps (Document.fileHash). */
function hashOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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
    const repeat = await duplicateAnswer(
      access.user,
      data.notebookId,
      { url: driveDownloadUrl(data.fileId) },
      data.confirmDuplicate,
      t,
    );
    if (repeat) return repeat;
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
      await attachDocument(data.notebookId, document.id, data.folderId);
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
    // A file the account already has asks first (SPEC.md §15), once its
    // bytes are here: Drive gives no key before the download.
    const askFirst = (bytes: Uint8Array) =>
      assertNotDuplicate(access.user, data.notebookId, { fileHash: hashOf(bytes) }, data.confirmDuplicate, t);
    return progressResponse(async (onProgress) => {
      onProgress("fetch");
      try {
        if (kind === "slides" || kind === "slides-file") {
          const bytes =
            kind === "slides"
              ? await fetchExported(fileId, token, grant, t, SLIDES_MIME_TYPE)
              : await fetchDriveFile(fileId, token, grant, t);
          await askFirst(bytes);
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
          await attachDocument(data.notebookId, document.id, data.folderId);
          await bumpNotebook(data.notebookId);
          if (!deduped) {
            const pdf = picture;
            // Drive's PDF export draws the pictures; a .pptx from Drive, or
            // a failed export, gets them the way an upload does (SPEC.md §27).
            if (pdf) after(() => renderSlidePictures(document.id, pdf).catch(() => {}));
            else {
              const deck = bytes;
              after(() => renderUploadedSlidePictures(document.id, deck).catch((err) => console.warn("[slides] pictures failed:", err)));
            }
            after(() => refreshSkeleton(document.id, user?.id ?? null).catch(() => {}));
          }
          return { id: document.id, title: document.title, deduped };
        }
        const bytes =
          kind === "sheets"
            ? await fetchExported(fileId, token, grant, t, SHEETS_MIME_TYPE)
            : await fetchDriveFile(fileId, token, grant, t);
        await askFirst(bytes);
        const { document, deduped } = await parse.ingestSheets(
          bytes,
          kind === "sheets" ? `${fileName}.xlsx` : fileName,
          onProgress,
          {},
          user?.id ?? null,
        );
        await attachDocument(data.notebookId, document.id, data.folderId);
        await bumpNotebook(data.notebookId);
        if (!deduped) after(() => refreshSkeleton(document.id, user?.id ?? null).catch(() => {}));
        return { id: document.id, title: document.title, deduped };
      } catch (err) {
        if (err instanceof DuplicateDocumentError) throw err;
        console.error("Drive slides/sheets ingest failed:", err);
        throw new Error(describeIngestError(err, t, "file"));
      }
    });
  }

  // kind is "docx", "docx-file", "pdf", or "export".
  const fileName = name;
  return progressResponse(async (onProgress) => {
    onProgress("fetch");
    // A Word file (SPEC.md §30): a .docx in Drive downloads as it is, and a
    // Google Doc arrives as Drive's .docx export; the Word parser reads
    // either from the file's own structure. A Google Doc whose .docx export
    // fails — Drive refuses it, or the parser cannot read it — reads from
    // Drive's PDF export below.
    if (kind === "docx" || kind === "docx-file") {
      const word = await driveWordFile(kind, data.fileId, token, grant, t, parse);
      if (word) await assertNotDuplicate(access.user, data.notebookId, { fileHash: hashOf(word) }, data.confirmDuplicate, t);
      let ingested: Awaited<ReturnType<typeof parse.ingestDocx>> | null = null;
      if (word) {
        try {
          ingested = await parse.ingestDocx(word, kind === "docx" ? `${fileName}.docx` : fileName, onProgress, {}, user?.id ?? null);
        } catch (err) {
          if (kind === "docx-file") {
            console.error("Drive Word ingest failed:", err);
            throw new Error(describeIngestError(err, t, "file"));
          }
          console.warn("[drive] Google Doc's .docx export did not parse, reading its PDF export:", err);
        }
      }
      if (ingested) {
        const { document, deduped } = ingested;
        await attachDocument(data.notebookId, document.id, data.folderId);
        await bumpNotebook(data.notebookId);
        // The skeleton builds after the response (SPEC.md §22).
        if (!deduped) after(() => refreshSkeleton(document.id, user?.id ?? null).catch(() => {}));
        return { id: document.id, title: document.title, deduped };
      }
    }
    // A PDF, a Google Drawing, or a Google Doc read from its PDF export:
    // PDF bytes, ingested the one way this app reads a PDF.
    const bytes = kind === "pdf" ? await fetchDrivePdf(data.fileId, token, grant, t) : await fetchExportedPdf(data.fileId, token, grant, t);
    const filename = kind === "pdf" ? fileName : `${fileName}.pdf`;
    await assertNotDuplicate(
      access.user,
      data.notebookId,
      { fileHash: hashOf(bytes), pdfPages: kind === "pdf" ? data.pdfPages : undefined },
      data.confirmDuplicate,
      t,
    );
    let ingested: Awaited<ReturnType<typeof parse.ingestPdf>>;
    try {
      ingested = await parse.ingestPdf(
        bytes,
        filename,
        onProgress,
        {
          pages: data.pages,
          convert: data.convert,
          pdfPages: kind === "pdf" ? data.pdfPages : undefined,
          // A scan reads its pages inside the add (SPEC.md §16).
          deadline: parse.modelPassDeadline(maxDuration),
        },
        user?.id ?? null,
      );
    } catch (err) {
      console.error("Drive PDF ingest failed:", err);
      throw new Error(describeIngestError(err, t, "pdf"));
    }
    const { document, deduped } = ingested;
    await attachDocument(data.notebookId, document.id, data.folderId);
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

/** A Word file's bytes from Drive: a .docx sitting in Drive as it is, or a
    Google Doc's .docx export. A .docx that is no Word file fails the add; a
    Google Doc whose export Drive refuses, or whose export is no Word file,
    gives null, and the add reads its PDF export instead. */
async function driveWordFile(
  kind: "docx" | "docx-file",
  fileId: string,
  token: string,
  grant: DriveAccess,
  t: TFunc,
  parse: typeof import("@/lib/parse/ingest"),
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (kind === "docx-file") {
    const bytes = await fetchDriveFile(fileId, token, grant, t);
    if (parse.sniffOfficeFile(bytes) !== "docx") throw new Error(t("api.notPdf"));
    return bytes;
  }
  try {
    const bytes = await fetchExported(fileId, token, grant, t, WORD_MIME_TYPE);
    if (parse.sniffOfficeFile(bytes) === "docx") return bytes;
    console.warn("[drive] Google Doc's .docx export is no Word file, reading its PDF export");
  } catch (err) {
    console.warn("[drive] Google Doc's .docx export failed, reading its PDF export:", err);
  }
  return null;
}
