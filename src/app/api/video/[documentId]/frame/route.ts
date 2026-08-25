import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { outboundFetch } from "@/lib/outbound-fetch";
import { storyboardFrame } from "@/lib/video/storyboard";

export const maxDuration = 60;

const paramsSchema = z.object({
  t: z.coerce.number().min(0).max(24 * 60 * 60),
  sheet: z.coerce.boolean().optional(),
});

// The real frame of a YouTube video at a moment (SPEC.md §11). Two shapes:
// without `sheet`, the tile's rectangle plus a same-origin URL for the sheet;
// with it, the sheet's bytes. Serving the bytes from this origin is the point —
// a cross-origin image taints the canvas, and the client has to read pixels to
// crop the frame to what the reader circled.
export async function GET(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const { documentId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const params = paramsSchema.safeParse({
    t: searchParams.get("t"),
    sheet: searchParams.get("sheet") ?? undefined,
  });
  if (!params.success) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }

  const asset = await db.videoAsset.findUnique({
    where: { documentId },
    select: { kind: true, youtubeId: true },
  });
  if (!asset?.youtubeId || asset.kind !== "YOUTUBE") {
    return NextResponse.json({ error: t("api.noStoryboard") }, { status: 404 });
  }

  let frame: Awaited<ReturnType<typeof storyboardFrame>>;
  try {
    frame = await storyboardFrame(asset.youtubeId, params.data.t);
  } catch (err) {
    console.warn("[frame] storyboard lookup failed:", err);
    return NextResponse.json({ error: t("api.frameUnavailable") }, { status: 502 });
  }
  if (!frame) return NextResponse.json({ error: t("api.frameUnavailable") }, { status: 404 });

  if (!params.data.sheet) {
    return NextResponse.json({
      url: `/api/video/${documentId}/frame?t=${params.data.t}&sheet=1`,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    });
  }

  const sheet = await outboundFetch(frame.sheetUrl, {});
  if (!sheet.ok) {
    return NextResponse.json({ error: t("api.frameFetchFailed", { status: sheet.status }) }, { status: 502 });
  }
  return new Response(await sheet.arrayBuffer(), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
