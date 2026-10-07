import { NextResponse } from "next/server";
import { z } from "zod";
import {
  bumpDocument,
  bumpNotebook,
  crossAccountLink,
  documentAccess,
  linkAccess,
  linkOfOtherAccount,
  noteAccess,
} from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const patchSchema = z.object({ resolved: z.boolean() });

const docLinkSelect = {
  select: {
    id: true,
    fromDocumentId: true,
    toDocumentId: true,
    notebookId: true,
    formerNotebookId: true,
    createdById: true,
  },
} as const;

// ?notebookId= names the project a reply on a link is changed from: a link
// of another project is not found there (SPEC.md §13).
const scopeOf = (req: Request) => new URL(req.url).searchParams.get("notebookId");

// Resolve or reopen one reply. Any editor of the corpus can — resolution is a
// shared state, like the rest of the corpus. On a link with no project
// shared across accounts, only its maker's projects resolve another
// account's reply; the reply's author always can (SPEC.md §13).
export async function PATCH(req: Request, ctx: { params: Promise<{ replyId: string }> }) {
  const t = await serverT();
  const { replyId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  const reply = await db.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      userId: true,
      noteId: true,
      note: { select: { section: { select: { notebookId: true } } } },
      blockEdit: { select: { documentId: true } },
      docLink: docLinkSelect,
    },
  });
  if (!reply) return NextResponse.json({ error: t("api.replyNotFound") }, { status: 404 });
  const access = reply.noteId
    ? await noteAccess(reply.noteId, "editor")
    : reply.docLink
      ? await linkAccess(reply.docLink, "editor", scopeOf(req))
      : await documentAccess(reply.blockEdit!.documentId, "editor");
  if (access instanceof NextResponse) return access;
  if (
    reply.docLink &&
    reply.userId !== access.user.id &&
    (await crossAccountLink(reply.docLink, access.user)).outside
  ) {
    return linkOfOtherAccount();
  }

  const updated = await db.reply.update({
    where: { id: replyId },
    data: { resolvedById: data.resolved ? access.user.id : null },
  });
  if (reply.note) await bumpNotebook(reply.note.section.notebookId);
  else if (reply.docLink) await bumpDocument(reply.docLink.fromDocumentId);
  else if (reply.blockEdit) await bumpDocument(reply.blockEdit.documentId);
  return NextResponse.json(updated);
}

// Delete one reply: its author, or the corpus owner. On a link with no
// project shared across accounts, only its author: no project's owner
// deletes another account's reply there (SPEC.md §13).
export async function DELETE(req: Request, ctx: { params: Promise<{ replyId: string }> }) {
  const t = await serverT();
  const { replyId } = await ctx.params;
  const reply = await db.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      userId: true,
      noteId: true,
      note: { select: { section: { select: { notebookId: true } } } },
      blockEdit: { select: { documentId: true } },
      docLink: docLinkSelect,
    },
  });
  if (!reply) return NextResponse.json({ error: t("api.replyNotFound") }, { status: 404 });

  const access = reply.noteId
    ? await noteAccess(reply.noteId, "viewer")
    : reply.docLink
      ? await linkAccess(reply.docLink, "viewer", scopeOf(req))
      : await documentAccess(reply.blockEdit!.documentId, "viewer");
  if (access instanceof NextResponse) return access;
  if (reply.userId !== access.user.id) {
    if (access.role !== "owner") {
      return NextResponse.json({ error: t("api.replyNotYours") }, { status: 403 });
    }
    if (reply.docLink && (await crossAccountLink(reply.docLink, access.user)).crossAccount) {
      return linkOfOtherAccount();
    }
  }

  await db.reply.delete({ where: { id: replyId } });
  if (reply.note) await bumpNotebook(reply.note.section.notebookId);
  else if (reply.docLink) await bumpDocument(reply.docLink.fromDocumentId);
  else if (reply.blockEdit) await bumpDocument(reply.blockEdit.documentId);
  return NextResponse.json({ ok: true });
}
