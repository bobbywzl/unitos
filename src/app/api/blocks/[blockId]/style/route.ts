import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { toggleBlockStyle } from "@/lib/docs/ops";
import { editRichText, importSharedResponse, isRichTextDocument } from "@/lib/docs/server";
import { serverT } from "@/lib/i18n/server";
import { isToggleStyle, sameSlot } from "@/lib/text-style";
import { parseBody } from "@/lib/validate";

const styleSchema = z.object({
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  style: z.string().refine(isToggleStyle),
});

type StyleSpan = { start: number; end: number; style: string; quotedText: string };

// Toggle an inline decoration span. Styling is a layer over the text, never
// markup inside it, so anchor offsets stay untouched (SPEC.md §5).
export async function POST(req: Request, ctx: { params: Promise<{ blockId: string }> }) {
  const t = await serverT();
  const { blockId } = await ctx.params;
  const { data, error } = await parseBody(req, styleSchema);
  if (error) return error;

  const block = await db.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: t("api.blockNotFound") }, { status: 404 });
  const access = await documentAccess(block.documentId, "editor");
  if (access instanceof NextResponse) return access;
  if (block.type === "TABLE" || block.type === "FIGURE" || block.type === "SLIDE" || block.type === "SHEET") {
    return NextResponse.json({ error: t("api.onlyTextBlocksStyled") }, { status: 400 });
  }
  if (data.endOffset <= data.startOffset || data.endOffset > block.text.length) {
    return NextResponse.json({ error: t("api.styleOffsetsInvalid") }, { status: 400 });
  }

  // A blank document is edited through its rich text (SPEC.md §29).
  if (await isRichTextDocument(block.documentId)) {
    const result = await editRichText(block.documentId, access.user.id, (doc) =>
      toggleBlockStyle(doc, blockId, data.startOffset, data.endOffset, data.style),
    );
    if (!result.ok) {
      return result.reason === "shared" ? importSharedResponse(t) : NextResponse.json({ error: t("api.styleOffsetsInvalid") }, { status: 400 });
    }
    await db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "STYLE",
        after: data.style,
        meta: { style: data.style, quotedText: block.text.slice(data.startOffset, data.endOffset) },
        userId: access.user.id,
      },
    });
    return NextResponse.json(await db.block.findUnique({ where: { id: blockId } }));
  }

  const spans = (Array.isArray(block.styles) ? block.styles : []) as unknown as StyleSpan[];
  const existing = spans.findIndex(
    (s) => s.style === data.style && s.start === data.startOffset && s.end === data.endOffset,
  );
  // One color and one highlight per range: a new one replaces the old one.
  const next =
    existing >= 0
      ? spans.filter((_, i) => i !== existing)
      : [
          ...spans.filter(
            (s) =>
              !(sameSlot(s.style, data.style) && s.start === data.startOffset && s.end === data.endOffset),
          ),
          {
            start: data.startOffset,
            end: data.endOffset,
            style: data.style,
            quotedText: block.text.slice(data.startOffset, data.endOffset),
          },
        ];

  const quotedText = block.text.slice(data.startOffset, data.endOffset);
  const [updated] = await db.$transaction([
    db.block.update({ where: { id: blockId }, data: { styles: next } }),
    // STYLE history row, so styling is auditable like every other edit.
    db.blockEdit.create({
      data: {
        documentId: block.documentId,
        blockId: block.id,
        kind: "STYLE",
        before: existing >= 0 ? data.style : null,
        after: existing >= 0 ? null : data.style,
        meta: { style: data.style, on: existing < 0, quotedText },
        userId: access.user.id,
      },
    }),
  ]);
  await bumpDocument(block.documentId);
  return NextResponse.json(updated);
}
