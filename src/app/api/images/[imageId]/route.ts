import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";

// A stored image (SPEC.md §16). The id is a cuid nobody guesses and the bytes
// never change, so the answer caches for a year — the figure route's twin.
export async function GET(_req: Request, ctx: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await ctx.params;
  const image = await db.imageAsset.findUnique({
    where: { id: imageId },
    select: { data: true, mimeType: true },
  });
  if (!image) {
    const t = await serverT();
    return NextResponse.json({ error: t("api.imageNotFound") }, { status: 404 });
  }
  // A visualization is an SVG (SPEC.md §20), reduced before it was stored;
  // opened as a page of its own it still runs nothing.
  const svg = image.mimeType === "image/svg+xml";
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(svg
        ? {
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
          }
        : {}),
    },
  });
}
