import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({ accept: z.literal(true) });

// Accept a recommended link: it becomes a normal link — it paints in the text
// and joins the Edits panel as a LINK_ADD by its accepter.
export async function PATCH(req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const t = await serverT();
  const { linkId } = await ctx.params;
  const { error } = await parseBody(req, patchSchema);
  if (error) return error;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  if (!link) return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });
  const access = await documentAccess(link.fromDocumentId, "editor");
  if (access instanceof NextResponse) return access;
  if (!link.recommended) return NextResponse.json(link);

  const [accepted] = await db.$transaction([
    db.docLink.update({ where: { id: linkId }, data: { recommended: false } }),
    db.blockEdit.create({
      data: {
        documentId: link.fromDocumentId,
        blockId: link.fromBlockId,
        kind: "LINK_ADD",
        meta: {
          linkId: link.id,
          toDocumentId: link.toDocumentId,
          toTitle: link.toDocument.title,
          quotedText: link.quotedText,
        },
        userId: access.user.id,
      },
    }),
  ]);
  await bumpDocument(link.fromDocumentId);
  return NextResponse.json(accepted);
}

// Remove a link. Recorded as a LINK_REMOVE edit so the Edits panel shows it;
// dismissing a still-recommended link records nothing — it never was history.
export async function DELETE(_req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const t = await serverT();
  const { linkId } = await ctx.params;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  if (!link) return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });
  const access = await documentAccess(link.fromDocumentId, "editor");
  if (access instanceof NextResponse) return access;

  await db.$transaction([
    db.docLink.delete({ where: { id: linkId } }),
    ...(link.recommended
      ? []
      : [
          db.blockEdit.create({
            data: {
              documentId: link.fromDocumentId,
              blockId: link.fromBlockId,
              kind: "LINK_REMOVE",
              meta: {
                toDocumentId: link.toDocumentId,
                toTitle: link.toDocument.title,
                quotedText: link.quotedText,
              },
              userId: access.user.id,
            },
          }),
        ]),
  ]);
  await bumpDocument(link.fromDocumentId);
  return NextResponse.json({ ok: true });
}
