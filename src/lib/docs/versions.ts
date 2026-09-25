import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
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

/** Before a save by `userId`: keep the stored text as a version when a new
    sitting starts, then note the save's time and author. */
export async function keepVersion(documentId: string, userId: string): Promise<void> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: {
      richTextRev: true,
      richTextSavedAt: true,
      richTextSavedBy: true,
      createdAt: true,
      versions: { orderBy: { rev: "desc" }, take: 1, select: { rev: true } },
    },
  });
  if (!document) return;
  const savedAt = document.richTextSavedAt ?? document.createdAt;
  if (Date.now() - savedAt.getTime() >= SITTING_MS && document.versions[0]?.rev !== document.richTextRev) {
    const stored = await db.document.findUnique({ where: { id: documentId }, select: { richText: true, richTextRev: true } });
    if (stored?.richText && !isEmptyRichText(stored.richText as unknown as RichNode)) {
      // One version per revision: two saves that start the sitting together keep one.
      await db.documentVersion.createMany({
        data: {
          documentId,
          rev: stored.richTextRev,
          richText: stored.richText as Prisma.InputJsonValue,
          userId: document.richTextSavedBy,
          savedAt,
        },
        skipDuplicates: true,
      });
    }
  }
  await db.document.update({ where: { id: documentId }, data: { richTextSavedAt: new Date(), richTextSavedBy: userId } });
}
