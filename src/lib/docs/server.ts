import type { Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import type { RichNode } from "@/lib/docs/schema";
import { syncRichText, type SyncResult } from "@/lib/docs/sync";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import type { TFunc } from "@/lib/i18n/dictionaries";

// The block routes' door into a document with rich text (SPEC.md §29), a
// blank document or an import: it is edited through its rich text, never
// row by row, so its Block rows stay the index of its rich text.

/** Whether the document holds rich text (a blank document or an import). */
export async function isRichTextDocument(documentId: string): Promise<boolean> {
  const document = await db.document.findUnique({ where: { id: documentId }, select: { richTextRev: true, richText: true } });
  return Boolean(document?.richText);
}

/** An import shared across accounts (SPEC.md §29): an import attached to
    projects of two or more owners. Its words are every one of those
    projects', so nobody edits it: the save and the server-side edits refuse
    it. A blank document is never shared this way. */
export async function importShared(documentId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
  const document = await (tx ?? db).document.findUnique({
    where: { id: documentId },
    select: { importRev: true, notebooks: { select: { notebook: { select: { userId: true } } } } },
  });
  if (!document || document.importRev === null) return false;
  return new Set(document.notebooks.map((n) => n.notebook.userId)).size >= 2;
}

/** A server-side edit refused: the import is shared across accounts. */
export type EditShared = { ok: false; reason: "shared" };

/** How a route refuses an edit of an import shared across accounts. */
export function importSharedResponse(t: TFunc): NextResponse {
  return NextResponse.json({ error: t("api.importShared"), reason: "shared" }, { status: 403 });
}

/** Apply one server-side edit to a document's rich text and save it: the
    Block rows follow, the project's live sync moves, and the skeleton checks
    whether it needs a rebuild. An import shared across accounts is refused. */
export async function editRichText(
  documentId: string,
  userId: string,
  edit: (current: RichNode) => RichNode | null,
): Promise<SyncResult | EditShared> {
  if (await importShared(documentId)) return { ok: false, reason: "shared" };
  const result = await syncRichText({ documentId, userId, baseRev: null, edit });
  if (result.ok) {
    await bumpDocument(documentId);
    after(() => refreshSkeleton(documentId, userId).catch(() => {}));
  }
  return result;
}
