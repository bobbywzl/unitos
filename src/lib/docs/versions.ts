import type { Prisma } from "@prisma/client";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";

// Version history of a blank document (SPEC.md §29), Google Docs' way: a
// version is the rich text as one sitting of edits left it. A save 10 minutes
// or more after the last one starts a new sitting, and the stored text is kept
// as a version first. Every version is kept; none is made from an empty
// document.

const SITTING_MS = 10 * 60 * 1000;

/** No words, no image, no line. */
export function isEmptyRichText(doc: RichNode): boolean {
  return !deriveBlocks(doc).some((b) => b.text.trim() || b.type === "FIGURE" || b.type === "SEPARATOR");
}

/** In a save's transaction, under the document's lock, before the save:
    keep the stored text as a version when a new sitting starts. The save
    then notes its own time and author (lib/docs/sync.ts). */
export async function keepVersion(
  tx: Prisma.TransactionClient,
  documentId: string,
  stored: { rev: number; savedAt: Date; savedBy: string | null },
): Promise<void> {
  if (Date.now() - stored.savedAt.getTime() < SITTING_MS) return;
  const newest = await tx.documentVersion.findFirst({ where: { documentId }, orderBy: { rev: "desc" }, select: { rev: true } });
  if (newest?.rev === stored.rev) return;
  const current = await tx.document.findUnique({ where: { id: documentId }, select: { richText: true } });
  const text = current?.richText as unknown as RichNode | null;
  if (!text || isEmptyRichText(text)) return;
  await tx.documentVersion.createMany({
    data: { documentId, rev: stored.rev, richText: text as Prisma.InputJsonValue, userId: stored.savedBy, savedAt: stored.savedAt },
    skipDuplicates: true,
  });
}
