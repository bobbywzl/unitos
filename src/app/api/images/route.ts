import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sniffImage } from "@/lib/handwritten/image";
import { serverT } from "@/lib/i18n/server";
import { FREE_IMAGE_BYTES, MAX_IMAGE_BYTES } from "@/lib/images";

export const maxDuration = 60;

// One image dropped into a note or into the reader's edit mode (SPEC.md §16).
// The bytes are the whole body — no form, no base64 — and the format is read
// from them, never from the file name. Free drops images up to
// FREE_IMAGE_BYTES; above that the account needs Unitos Premium (TIERS.md).
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: t("api.emptyChunk") }, { status: 400 });
  if (bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: t("api.imageTooLarge") }, { status: 413 });
  }
  if (bytes.length > FREE_IMAGE_BYTES && !user.premium) {
    return NextResponse.json({ error: t("api.imageNeedsPremium") }, { status: 402 });
  }
  const mimeType = sniffImage(bytes);
  if (!mimeType) return NextResponse.json({ error: t("api.notImage") }, { status: 400 });

  const image = await db.imageAsset.create({
    data: { mimeType, size: bytes.length, data: bytes, userId: user.id },
    select: { id: true },
  });
  return NextResponse.json({ id: image.id, url: `/api/images/${image.id}` }, { status: 201 });
}
