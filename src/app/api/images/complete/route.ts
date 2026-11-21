import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { storeImage } from "@/lib/image-store";
import { IMAGE_UPLOAD_CHUNKS } from "@/lib/images";
import { UPLOAD_CHUNK_BYTES } from "@/lib/video/types";
import { parseBody } from "@/lib/validate";

export const maxDuration = 60;

// An image larger than one request (Vercel caps a body at about 4.5 MB),
// sent in chunks to POST /api/uploads: the chunks are put together in
// order and stored as /api/images stores one (lib/image-store.ts). The
// staged chunks go once they are read: they are staging rows only.
const bodySchema = z.object({
  uploadId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  chunks: z.number().int().min(1).max(IMAGE_UPLOAD_CHUNKS),
});

export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;

  const staged = await db.uploadChunk.findMany({
    where: { uploadId: data.uploadId },
    orderBy: { index: "asc" },
    select: { index: true, data: true },
  });
  await db.uploadChunk.deleteMany({ where: { uploadId: data.uploadId } });
  if (staged.length === 0) return NextResponse.json({ error: t("api.uploadNotFound") }, { status: 404 });
  const whole =
    staged.length === data.chunks &&
    staged.every((c, i) => c.index === i && (i === staged.length - 1 || c.data.length === UPLOAD_CHUNK_BYTES));
  if (!whole) return NextResponse.json({ error: t("api.uploadMissingChunks") }, { status: 400 });

  const size = staged.reduce((n, c) => n + c.data.length, 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of staged) {
    bytes.set(c.data, at);
    at += c.data.length;
  }
  return storeImage(bytes, user, t);
}
