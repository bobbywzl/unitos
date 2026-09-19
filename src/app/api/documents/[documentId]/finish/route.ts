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
// each one into the browser's cache first and the page paints complete.
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
        select: { id: true, type: true, page: true, html: true },
      },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });

  const images = new Set<string>();
  for (const block of document.blocks) {
    if (block.type === "PAGE" && block.page !== null) {
      images.add(`/api/documents/${documentId}/page/${block.id}`);
    } else if (block.type === "FIGURE" && !block.html && block.page !== null) {
      images.add(`/api/documents/${documentId}/figure/${block.id}`);
    } else if (block.type === "SLIDE" && block.html) {
      // A slide's stored picture (SPEC.md §27), when the add promised one,
      // and the pictures its replica carries.
      if (block.html.includes('data-picture="1"')) images.add(`/api/documents/${documentId}/page/${block.id}`);
      for (const match of block.html.matchAll(IMG_SRC_RX)) {
        const src = unescapeAttr(match[1]);
        if (/^(?:https?:\/\/|\/api\/)/i.test(src)) images.add(src);
      }
    } else if ((block.type === "FIGURE" || block.type === "TABLE") && block.html) {
      for (const match of block.html.matchAll(IMG_SRC_RX)) {
        const src = unescapeAttr(match[1]);
        // Inline data is already in the page; a relative path never survives
        // the parse (sanitize resolves every src), so only http(s) and the
        // app's own routes are worth a request.
        if (/^(?:https?:\/\/|\/api\/)/i.test(src)) images.add(src);
      }
    }
  }
  const plan: FinishPlan = { images: [...images] };
  return NextResponse.json(plan);
}
