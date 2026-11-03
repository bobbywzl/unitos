import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { sniffImage } from "@/lib/handwritten/image";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { FREE_IMAGE_BYTES, MAX_IMAGE_BYTES } from "@/lib/images";
import { premiumActive } from "@/lib/tiers";

// Store one dropped image (SPEC.md §16): the rules both image routes keep.
// The format is read from the bytes, never from the file name. An expired
// trial drops images up to FREE_IMAGE_BYTES; above that the account needs
// Unitos Premium (TIERS.md). Server only.
export async function storeImage(bytes: Uint8Array<ArrayBuffer>, user: User, t: TFunc): Promise<NextResponse> {
  if (bytes.length === 0) return NextResponse.json({ error: t("api.emptyChunk") }, { status: 400 });
  if (bytes.length > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: t("api.imageTooLarge") }, { status: 413 });
  }
  if (bytes.length > FREE_IMAGE_BYTES && !premiumActive(user)) {
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
