import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authEnabled, currentUser } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { buildConnections } from "@/lib/connect";
import { classifyDriveFile } from "@/lib/drive/types";
import {
  driveDownloadUrl,
  fetchDriveMetadata,
  fetchDrivePdf,
  fetchExportedPdf,
} from "@/lib/drive/fetch";
import { mintDriveAccessToken } from "@/lib/drive/link";
import { buildGlossary } from "@/lib/glossary";
import { runConversion } from "@/lib/handwritten/convert";
import { currentLang, serverT } from "@/lib/i18n/server";
import { progressResponse } from "@/lib/ingest-response";
import { attachDocument } from "@/lib/parse/attach";
import { describeIngestError } from "@/lib/parse/ingest-error";
import { ingestMediaUrl } from "@/lib/video/ingest-media-url";
import { runTranscription } from "@/lib/video/transcription-job";
import { parseBody } from "@/lib/validate";

// Google Drive upload (SPEC.md §14): the client holds a short-lived Drive
// OAuth token (per-visit grant, or minted from the linked account's refresh
// token) and the file the reader picked; this route spends the token once,
// immediately, and never stores it. A request without a bearer token mints one
// from the linked grant — the pasted-Drive-link path. Same budget as
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
  instructions: z.string().max(2_000).default(""),
  pages: z.boolean().default(false),
  convert: z.boolean().default(true),
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
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token && authEnabled() && user) {
    // No per-visit grant on the request: mint from the linked account
    // (SPEC.md §14). A revoked grant clears itself on the token route; here it
    // just fails the mint.
    const row = await db.user.findUnique({
      where: { id: user.id },
      select: { driveRefreshToken: true },
    });
    if (row?.driveRefreshToken) {
      const minted = await mintDriveAccessToken(row.driveRefreshToken);
      if (minted !== null && minted !== "revoked") token = minted.token;
    }
  }
  if (!token) return NextResponse.json({ error: t("api.driveTokenMissing") }, { status: 401 });

  let name = data.name;
  let mimeType = data.mimeType;
  if (!name || !mimeType) {
    try {
      ({ name, mimeType } = await fetchDriveMetadata(data.fileId, token, t));
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
        // The download URL's own path is the Drive file id, not a name —
        // pass the picked file's real name, extension stripped like the
        // chunked video upload path titles a document (/api/uploads/complete).
        title: mediaName.replace(/\.[a-z0-9]+$/i, ""),
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

  const pdfName = name;
  return progressResponse(async (onProgress) => {
    onProgress("fetch");
    const bytes =
      kind === "export"
        ? await fetchExportedPdf(data.fileId, token, t)
        : await fetchDrivePdf(data.fileId, token, t);
    const filename = kind === "export" ? `${pdfName}.pdf` : pdfName;
    let ingested: Awaited<ReturnType<typeof parse.ingestPdf>>;
    try {
      ingested = await parse.ingestPdf(
        bytes,
        filename,
        onProgress,
        {
          instructions: data.instructions.trim() || undefined,
          pages: data.pages,
          convert: data.convert,
        },
        user?.id ?? null,
      );
    } catch (err) {
      console.error("Drive PDF ingest failed:", err);
      throw new Error(describeIngestError(err, t, "pdf"));
    }
    const { document, deduped } = ingested;
    await attachDocument(data.notebookId, document.id);
    await bumpNotebook(data.notebookId);
    if (!deduped && document.handwritten && document.conversionStatus === "NONE") {
      // A handwritten document (SPEC.md §16): conversion starts on its own —
      // the text is the point. Glossary and the recommended-links scan follow
      // it, so they read the converted text. conversionStatus OFF = the
      // reader said not to convert; nothing starts.
      after(() =>
        runConversion(document.id, user?.id ?? null)
          .then((r) =>
            r.ok ? buildGlossary(document.id, user?.id ?? null).catch(() => {}) : undefined,
          )
          .then(() => buildConnections(data.notebookId, document.id, user?.id ?? null, lang))
          .catch(() => {}),
      );
    } else if (!document.handwritten || document.conversionStatus === "READY") {
      // A handwritten document without converted text has nothing to read —
      // both scans skip.
      if (!deduped) after(() => buildGlossary(document.id, user?.id ?? null).catch(() => {}));
      after(() =>
        buildConnections(data.notebookId, document.id, user?.id ?? null, lang).catch(() => {}),
      );
    }
    return { id: document.id, title: document.title, deduped };
  });
}
