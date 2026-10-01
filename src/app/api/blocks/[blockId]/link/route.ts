import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { blockTakes, isWebAddress } from "@/lib/block-takes";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { isRichTextDocument } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const linkSchema = z.object({
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  // The web address; "" takes the link off the words.
  href: z.string().max(2_000),
});

type LinkSpan = { start: number; end: number; quotedText: string; targetOrder?: number; href?: string };

// A web link on a text block's words (SPEC.md §7: the assistant's link with
// an address), kept in Block.links like a PDF's own links, and healed at
// render by its words. A new address replaces the web links it overlaps; ""
// takes them off. The answer names the address the words had before, so
// Undo puts it back. Recorded as LINK_ADD or LINK_REMOVE. A document with
// rich text sets its links in the page editor.
export async function POST(req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const t = await serverT();
  const { blockId } = await ctx.params;
  const { data, error } = await parseBody(req, linkSchema);
  if (error) return error;

  const block = await db.block.findUnique({ where: { id: blockId }, select: { id: true, documentId: true, type: true, text: true, links: true } });
  if (!block) return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  const access = await documentAccess(block.documentId, "editor");
  if (access instanceof NextResponse) return access;
  if (await isRichTextDocument(block.documentId)) {
    return NextResponse.json({ error: t("api.linkInPageEditor") }, { status: 400 });
  }
  if (!blockTakes.style(block.type)) {
    return NextResponse.json({ error: t("api.onlyTextBlocksLinked") }, { status: 400 });
  }
  if (data.endOffset <= data.startOffset || data.endOffset > block.text.length) {
    return NextResponse.json({ error: t("api.linkOffsetsInvalid") }, { status: 400 });
  }
  const href = data.href.trim();
  if (href && !isWebAddress(href)) {
    return NextResponse.json({ error: t("api.linkAddressInvalid") }, { status: 400 });
  }

  const spans = (Array.isArray(block.links) ? block.links : []) as unknown as LinkSpan[];
  // A web link that shares words with the range; a Contents entry stays.
  const overlaps = (s: LinkSpan) => s.href !== undefined && s.start < data.endOffset && data.startOffset < s.end;
  const previous = spans.find(overlaps)?.href ?? null;
  const quotedText = block.text.slice(data.startOffset, data.endOffset);
  const links = [
    ...spans.filter((s) => !overlaps(s)),
    ...(href ? [{ start: data.startOffset, end: data.endOffset, quotedText, href }] : []),
  ];
  if (!href && previous === null) return NextResponse.json({ ok: true, previous });

  await db.$transaction([
    // The last link taken off leaves the block with none, as it was.
    db.block.update({ where: { id: block.id }, data: { links: links.length > 0 ? (links as unknown as Prisma.InputJsonValue) : Prisma.DbNull } }),
    db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: href ? "LINK_ADD" : "LINK_REMOVE",
        // The Edits tab shows the words and the address, as for a link to a document.
        meta: { quotedText, toTitle: href || previous },
        userId: access.user.id,
      },
    }),
  ]);
  await bumpDocument(block.documentId);
  return NextResponse.json({ ok: true, previous });
}
