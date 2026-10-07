import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpDocument, crossAccountLink, linkAccess, linkHideProjects, linkOfOtherAccount } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// accept: a recommended link becomes a normal link. reason: what the link is
// about — the reader types it after Close link, or in the Annotations tab.
const patchSchema = z
  .object({
    accept: z.literal(true).optional(),
    reason: z.string().max(2000).optional(),
  })
  .refine((d) => d.accept !== undefined || d.reason !== undefined, {
    message: "Provide accept or reason",
  });

// ?notebookId= names the project the request comes from: a link of another
// project is not found there (SPEC.md §13).
const scopeOf = (req: Request) => new URL(req.url).searchParams.get("notebookId");

// Accept a recommended link: it becomes a normal link — it paints in the text
// and joins the Edits panel as a LINK_ADD by its accepter. Or set the reason.
export async function PATCH(req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const t = await serverT();
  const { linkId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  if (!link) return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });
  const access = await linkAccess(link, "editor", scopeOf(req));
  if (access instanceof NextResponse) return access;
  // A link with no project shared across accounts: only its maker's
  // projects re-word or accept it (SPEC.md §13).
  if ((await crossAccountLink(link, access.user)).outside) return linkOfOtherAccount();
  if (data.reason !== undefined) {
    const reason = data.reason.trim();
    const updated = await db.docLink.update({
      where: { id: linkId },
      data: { reason: reason ? reason : null },
    });
    await bumpDocument(link.fromDocumentId);
    return NextResponse.json(updated);
  }
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
          ...(link.notebookId ? { notebookId: link.notebookId } : {}),
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
// The row is deleted only when no other account replied on it and no other
// account's project shows it. Otherwise the link is hidden in the remover's
// projects (DocLinkHidden): every reply row is kept, and every other project
// still reads the link (rule zero items 1 and 2; SPEC.md §13).
export async function DELETE(req: Request, ctx: { params: Promise<{ linkId: string }> }) {
  const t = await serverT();
  const { linkId } = await ctx.params;
  const link = await db.docLink.findUnique({
    where: { id: linkId },
    include: { toDocument: { select: { title: true } } },
  });
  if (!link) return NextResponse.json({ error: t("api.linkNotFound") }, { status: 404 });
  const scope = scopeOf(req);
  const access = await linkAccess(link, "editor", scope);
  if (access instanceof NextResponse) return access;
  const rule = await crossAccountLink(link, access.user);
  if (link.createdById !== access.user.id && rule.crossAccount) {
    return NextResponse.json({ error: t("api.linkSharedAcrossAccounts") }, { status: 403 });
  }
  const othersReplied = (await db.reply.count({ where: { docLinkId: linkId, userId: { not: access.user.id } } })) > 0;
  const hideIn = othersReplied || rule.crossAccount ? await linkHideProjects(link, access.user, scope) : [];
  const project = link.notebookId ?? (hideIn.length > 0 ? scope : null);

  await db.$transaction([
    hideIn.length > 0
      ? db.docLinkHidden.createMany({
          data: hideIn.map((notebookId) => ({ docLinkId: link.id, notebookId, userId: access.user.id })),
          skipDuplicates: true,
        })
      : db.docLink.delete({ where: { id: linkId } }),
    ...(link.recommended
      ? []
      : [
          db.blockEdit.create({
            data: {
              documentId: link.fromDocumentId,
              blockId: link.fromBlockId,
              kind: "LINK_REMOVE",
              meta: {
                linkId: link.id,
                ...(project ? { notebookId: project } : {}),
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
