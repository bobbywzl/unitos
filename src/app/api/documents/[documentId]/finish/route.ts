import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import type { FinishPlan } from "@/lib/finish";
import { serverT } from "@/lib/i18n/server";

const paramsSchema = z.object({ documentId: z.string().min(1) });

// The finishing step of an add (SPEC.md §15): what is left before the
// document opens complete.
// images: every visual the reader requests on open — PDF figure and page
// renders, and the images inside figure and table html — so the client loads
// each one into the browser's cache first and the page paints complete. An
// import's figure objects (SPEC.md §29) draw from their FigureMedia rows: a
// PDF figure's crop by its media id, a web figure's images from its html —
// the same URLs the page editor requests. An image in an import's text is a
// FIGURE row with html, as in a blank document.
// Nothing else is left: the glossary is built when the reader opens it and
// links when the reader asks for them (SPEC.md §13).

const IMG_SRC_RX = /<img\b[^>]*?\ssrc="([^"]+)"/gi;

function unescapeAttr(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Inline data is already in the page; a relative path never survives the
// parse (sanitize resolves every src), so only http(s) and the app's own
// routes are worth a request.
function addImageSources(html: string, images: Set<string>) {
  for (const match of html.matchAll(IMG_SRC_RX)) {
    const src = unescapeAttr(match[1]);
    if (/^(?:https?:\/\/|\/api\/)/i.test(src)) images.add(src);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const t = await serverT();
  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  }
  const { documentId } = parsed.data;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;

  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      blocks: {
        orderBy: { order: "asc" },
        select: { id: true, type: true, page: true, html: true, mediaId: true },
      },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });

  const mediaIds = document.blocks.flatMap((b) => (b.type === "FIGURE" && b.mediaId ? [b.mediaId] : []));
  const media =
    mediaIds.length > 0
      ? await db.figureMedia.findMany({
          where: { documentId, id: { in: mediaIds } },
          select: { id: true, html: true, page: true },
        })
      : [];
  const mediaById = new Map(media.map((m) => [m.id, m]));

  const images = new Set<string>();
  for (const block of document.blocks) {
    if (block.type === "FIGURE" && block.mediaId) {
      const figure = mediaById.get(block.mediaId);
      if (figure?.html) addImageSources(figure.html, images);
      else if (figure && figure.page !== null) images.add(`/api/documents/${documentId}/figure/${figure.id}`);
    } else if (block.type === "PAGE" && block.page !== null) {
      images.add(`/api/documents/${documentId}/page/${block.id}`);
    } else if (block.type === "FIGURE" && !block.html && block.page !== null) {
      images.add(`/api/documents/${documentId}/figure/${block.id}`);
    } else if (block.type === "SLIDE" && block.html) {
      // A slide's stored picture (SPEC.md §27), when the add promised one,
      // and the pictures its replica carries.
      if (block.html.includes('data-picture="1"')) images.add(`/api/documents/${documentId}/page/${block.id}`);
      addImageSources(block.html, images);
    } else if ((block.type === "FIGURE" || block.type === "TABLE") && block.html) {
      addImageSources(block.html, images);
    }
  }
  const plan: FinishPlan = { images: [...images] };
  return NextResponse.json(plan);
}
