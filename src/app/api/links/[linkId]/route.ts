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

// Remove a link. Recorded as a LINK_REMOVE edit so the Edits panel and
// History show it; dismissing a still-recommended link records nothing — it
// never was history. An accepted link is never deleted: it is hidden in the
// remover's projects (DocLinkHidden), its row, reason, replies, and notes on
// it are kept, and Undo, or Restore in History, removes the hide row
// (DELETE /api/links/:id/hidden; WALK5-01, rule zero item 1). A recommended
// link nobody else replied on and no other account's project shows is
// deleted on Dismiss: it was an AI proposal the reader never took. Asked
// from no project (an older tab), a link that has no project and must stay
// for another account answers 409 Reload: the tab cannot say which project
// it shows, so nothing is hidden by guess (REV5-01). Every other project
// still reads the link (rule zero item 2; SPEC.md §13).
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
  const keep = othersReplied || rule.crossAccount;
  const deleteRow = link.recommended && !keep;
  const reload = () => NextResponse.json({ error: t("api.linkRemoveReload") }, { status: 409 });
  if (!deleteRow && keep && !scope && !link.notebookId) return reload();
  const hideIn = deleteRow ? [] : await linkHideProjects(link, access.user, scope);
  // No project to hide it in was found: refuse rather than delete.
  if (!deleteRow && hideIn.length === 0) return reload();
  const project = link.notebookId ?? scope ?? (hideIn.length === 1 ? hideIn[0] : null);

  const edit = await db.$transaction(async (tx) => {
    if (deleteRow) await tx.docLink.delete({ where: { id: linkId } });
    else {
      await tx.docLinkHidden.createMany({
        data: hideIn.map((notebookId) => ({ docLinkId: link.id, notebookId, userId: access.user.id })),
        skipDuplicates: true,
      });
    }
    if (link.recommended) return null;
    return tx.blockEdit.create({
      data: {
        documentId: link.fromDocumentId,
        blockId: link.fromBlockId,
        kind: "LINK_REMOVE",
        // Enough to say what was removed and to restore it: the projects it
        // was hidden in (the hide rows), its reason, its other end's words.
        meta: {
          linkId: link.id,
          ...(project ? { notebookId: project } : {}),
          hiddenIn: hideIn,
          toDocumentId: link.toDocumentId,
          toTitle: link.toDocument.title,
          quotedText: link.quotedText,
          ...(link.toQuotedText ? { toQuotedText: link.toQuotedText } : {}),
          ...(link.reason ? { reason: link.reason } : {}),
        },
        userId: access.user.id,
      },
      select: { id: true },
    });
  });
  await bumpDocument(link.fromDocumentId);
  return NextResponse.json({ ok: true, hidden: hideIn, ...(edit ? { editId: edit.id } : {}) });
}
