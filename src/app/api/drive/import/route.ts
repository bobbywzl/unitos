import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { classifyDriveFile } from "@/lib/drive/types";
import { driveDownloadUrl, fetchDrivePdf, fetchExportedPdf } from "@/lib/drive/fetch";
import { buildGlossary } from "@/lib/glossary";
import { currentLang, serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { ingestMediaUrl } from "@/lib/video/ingest-media-url";
import { runTranscription } from "@/lib/video/transcription-job";
import { parseBody } from "@/lib/validate";

// Google Drive upload (SPEC.md §14): the client already holds a short-lived
// Drive OAuth token (Google Identity Services, requested in the browser) and
// the file the reader picked; this route spends that token once, immediately,
// and never stores it. Same budget as /api/documents, which downloads media
// URLs under the same ceiling.
export const maxDuration = 120;

const bodySchema = z.object({
  notebookId: z.string().min(1),
  fileId: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
});

export async function POST(req: Request) {
  const user = await currentUser();
  const t = await serverT();
  // Captured now: the after() scans below outlive the request and its cookies.
  const lang = await currentLang();
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return NextResponse.json({ error: t("api.driveTokenMissing") }, { status: 401 });

  const kind = classifyDriveFile(data.mimeType, data.name);
  if (kind === "unsupported") {
    return NextResponse.json({ error: t("api.driveUnsupportedType") }, { status: 400 });
  }

  // Video and audio: the same download-and-store path a direct media link
  // uses (SPEC.md §11), just with a bearer token on the request.
  if (kind === "media") {
    return progressResponse(async (onProgress) => {
      const { document, deduped } = await ingestMediaUrl(driveDownloadUrl(data.fileId), t, onProgress, {
        headers: { Authorization: `Bearer ${token}` },
        // The download URL's own path is the Drive file id, not a name —
        // pass the picked file's real name, extension stripped like the
        // chunked video upload path titles a document (/api/uploads/complete).
        title: data.name.replace(/\.[a-z0-9]+$/i, ""),
      });
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

  // kind is "pdf" or "export" — both end up as PDF bytes, ingested the one
  // way this app reads a PDF. The parse chain (jsdom, unpdf) loads per
  // request; see /api/documents for why it cannot load with the route module.
  let parse: typeof import("@/lib/parse/ingest");
  try {
    parse = await import("@/lib/parse/ingest");
  } catch (err) {
    console.error("Parse module load failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: t("api.parsingUnavailable", { message }) }, { status: 500 });
  }

  return progressResponse(async (onProgress) => {
    onProgress("fetch");
    const bytes =
      kind === "export"
        ? await fetchExportedPdf(data.fileId, token, t)
        : await fetchDrivePdf(data.fileId, token, t);
    const filename = kind === "export" ? `${data.name}.pdf` : data.name;
    let ingested: Awaited<ReturnType<typeof parse.ingestPdf>>;
    try {
      ingested = await parse.ingestPdf(bytes, filename, onProgress);
    } catch (err) {
      console.error("Drive PDF ingest failed:", err);
      throw new Error(t("api.pdfParseFailed"));
    }
    const { document, deduped } = ingested;
    await attachDocument(data.notebookId, document.id);
    await bumpNotebook(data.notebookId);
    if (!deduped) after(() => buildGlossary(document.id, user?.id ?? null).catch(() => {}));
    after(() =>
      buildConnections(data.notebookId, document.id, user?.id ?? null, lang).catch(() => {}),
    );
    return { id: document.id, title: document.title, deduped };
  });
}
