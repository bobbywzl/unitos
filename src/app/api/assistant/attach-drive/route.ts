import { NextResponse } from "next/server";
import { extractText } from "unpdf";
import { z } from "zod";
import { capFileName, capFileText, FILE_MAX_BYTES, MEDIA_MAX_BYTES } from "@/lib/assistant/attachments";
import { mediaAttachmentText } from "@/lib/assistant/media";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { driveDownloadUrl, fetchDrivePdf, fetchExportedPdf } from "@/lib/drive/fetch";
import { requestDriveToken } from "@/lib/drive/request-token";
import { classifyDriveAttachment } from "@/lib/drive/types";
import { outboundFetch } from "@/lib/outbound-fetch";
import { sniffImage } from "@/lib/handwritten/image";
import { serverT } from "@/lib/i18n/server";
import { FREE_IMAGE_BYTES, MAX_IMAGE_BYTES } from "@/lib/images";
import { premiumActive } from "@/lib/tiers";
import { parseBody } from "@/lib/validate";

export const maxDuration = 300;

const LADDER_BUDGET_MS = 240_000;

// A Google Drive file attached to an assistant message (SPEC.md §7, §14):
// the client holds a short-lived Drive token and the file it picked; this
// route spends the token once and never stores it. The file becomes what an
// attachment is — a Google Doc, Sheet, Slide, Drawing, or PDF its text; a
// video or audio file its transcript; an image a stored image the model is
// shown; a text file its text — through the same readers every other add
// path uses. Drive is a source, never a new reader.
const bodySchema = z.object({
  fileId: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
});

export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const startedAt = Date.now();

  const { token, grant } = await requestDriveToken(req, user);
  if (!token) return NextResponse.json({ error: t("api.driveTokenMissing") }, { status: 401 });

  const name = capFileName(data.name);
  const kind = classifyDriveAttachment(data.mimeType, data.name);
  if (kind === "unsupported") {
    return NextResponse.json({ error: t("api.driveUnsupportedType") }, { status: 400 });
  }

  const download = async (cap: number) => {
    const res = await outboundFetch(driveDownloadUrl(data.fileId), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(t("api.driveFetchFailed"));
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > cap) throw new Error(t(cap === MEDIA_MAX_BYTES ? "api.videoTooLarge" : "api.attachmentTooLarge"));
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > cap) throw new Error(t(cap === MEDIA_MAX_BYTES ? "api.videoTooLarge" : "api.attachmentTooLarge"));
    if (bytes.length === 0) throw new Error(t("api.driveFetchFailed"));
    return bytes;
  };

  try {
    if (kind === "export" || kind === "pdf") {
      const bytes =
        kind === "export"
          ? await fetchExportedPdf(data.fileId, token, grant, t)
          : await fetchDrivePdf(data.fileId, token, grant, t);
      if (bytes.length > FILE_MAX_BYTES) {
        return NextResponse.json({ error: t("api.attachmentTooLarge") }, { status: 413 });
      }
      let text: string;
      try {
        // pdf.js transfers (detaches) the buffer it receives — parse a copy.
        text = (await extractText(new Uint8Array(bytes), { mergePages: true })).text;
      } catch (err) {
        console.error("[assistant] attach-drive: PDF unreadable:", err);
        return NextResponse.json({ error: t("api.attachmentUnreadable") }, { status: 422 });
      }
      if (!text.trim()) return NextResponse.json({ error: t("api.attachmentEmpty") }, { status: 422 });
      return NextResponse.json({ kind: "file", name, text: capFileText(text) });
    }
    if (kind === "media") {
      const bytes = await download(MEDIA_MAX_BYTES);
      try {
        const text = await mediaAttachmentText(bytes, data.mimeType, name, startedAt + LADDER_BUDGET_MS, user?.id ?? null);
        return NextResponse.json({ kind: "file", name, text });
      } catch (err) {
        console.error("[assistant] attach-drive: transcription failed:", err);
        return NextResponse.json(
          { error: t("api.attachmentTranscribeFailed", { reason: err instanceof Error ? err.message : String(err) }) },
          { status: 422 },
        );
      }
    }
    if (kind === "image") {
      // The same gate as POST /api/images (SPEC.md §16, TIERS.md).
      const bytes = await download(MAX_IMAGE_BYTES);
      if (bytes.length > FREE_IMAGE_BYTES && !premiumActive(user)) {
        return NextResponse.json({ error: t("api.imageNeedsPremium") }, { status: 402 });
      }
      const mimeType = sniffImage(bytes);
      if (!mimeType) return NextResponse.json({ error: t("api.notImage") }, { status: 400 });
      const image = await db.imageAsset.create({
        data: { mimeType, size: bytes.length, data: bytes, userId: user.id },
        select: { id: true },
      });
      return NextResponse.json({ kind: "image", name, id: image.id, url: `/api/images/${image.id}` });
    }
    // text
    const bytes = await download(FILE_MAX_BYTES);
    if (bytes.subarray(0, 8192).includes(0)) {
      return NextResponse.json({ error: t("api.attachmentNotText") }, { status: 400 });
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    if (!text.trim()) return NextResponse.json({ error: t("api.attachmentEmpty") }, { status: 422 });
    return NextResponse.json({ kind: "file", name, text: capFileText(text) });
  } catch (err) {
    const message = err instanceof Error ? err.message : t("api.driveFetchFailed");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
