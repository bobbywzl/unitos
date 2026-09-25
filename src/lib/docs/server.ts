import { after } from "next/server";
import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import type { RichNode } from "@/lib/docs/schema";
import { syncRichText, type SyncResult } from "@/lib/docs/sync";
import { refreshSkeleton } from "@/lib/graph/skeleton";

// The block routes' door into a blank document (SPEC.md §29): a document
// with rich text is edited through it, never row by row, so its Block rows
// stay the index of its rich text.

/** Whether the document is a blank document (it holds rich text). */
export async function isRichTextDocument(documentId: string): Promise<boolean> {
  const document = await db.document.findUnique({ where: { id: documentId }, select: { richTextRev: true, richText: true } });
  return Boolean(document?.richText);
}

/** Apply one server-side edit to a blank document's rich text and save it:
    the Block rows follow, the project's live sync moves, and the skeleton
    checks whether it needs a rebuild. */
export async function editRichText(
  documentId: string,
  userId: string,
  edit: (current: RichNode) => RichNode | null,
): Promise<SyncResult> {
  const result = await syncRichText({ documentId, userId, baseRev: null, edit });
  if (result.ok) {
    await bumpDocument(documentId);
    after(() => refreshSkeleton(documentId, userId).catch(() => {}));
  }
  return result;
}
