import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";

// Version history of a blank document (SPEC.md §29).

const SITTING_MS = 10 * 60 * 1000;
const STEADY_MS = 30 * 60 * 1000;

export const VERSION_FIELDS = { id: true, rev: true, savedAt: true, userId: true, name: true } as const;

/** No words, no image, no line. */
function isEmptyRichText(doc: RichNode): boolean {
  return !deriveBlocks(doc).some((b) => b.text.trim() || b.type === "FIGURE" || b.type === "SEPARATOR");
}

/** Keep the live text as a version at once (Name current version, Restore
    this version, a command of the assistant's suggestions over the whole
    document): the version of its revision, named when a name is given.
    Null when the document has no rich text; "empty" when it has no words. */
export async function keepCurrentVersion(documentId: string, name: string | null) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { richText: true, richTextRev: true, richTextSavedAt: true, richTextSavedBy: true },
  });
  if (!document?.richText) return null;
  if (isEmptyRichText(document.richText as unknown as RichNode)) return "empty" as const;
  return db.documentVersion.upsert({
    where: { documentId_rev: { documentId, rev: document.richTextRev } },
    create: {
      documentId,
      rev: document.richTextRev,
      richText: document.richText as Prisma.InputJsonValue,
      userId: document.richTextSavedBy,
      name,
      savedAt: document.richTextSavedAt ?? new Date(),
    },
    update: name ? { name } : {},
    select: VERSION_FIELDS,
  });
}

/** In a save's transaction, under the document's lock, before the save: keep
    the stored text as a version when a new sitting starts (the last save is
    10 minutes old or more), or when the newest version, else the first edit,
    is 30 minutes old (steady typing keeps one version per half hour). Every
    version is kept; none is made from an empty document. The save then notes
    its own time and author (lib/docs/sync.ts). */
export async function keepVersion(
  tx: Prisma.TransactionClient,
  documentId: string,
  stored: { rev: number; savedAt: Date; savedBy: string | null; keptAt: Date | null },
): Promise<void> {
  const now = Date.now();
  const sitting = now - stored.savedAt.getTime() >= SITTING_MS;
  const steady = stored.keptAt !== null && now - stored.keptAt.getTime() >= STEADY_MS;
  if (!sitting && !steady) return;
  const current = await tx.document.findUnique({ where: { id: documentId }, select: { richText: true } });
  const text = current?.richText as unknown as RichNode | null;
  if (!text || isEmptyRichText(text)) return;
  await tx.documentVersion.createMany({
    data: { documentId, rev: stored.rev, richText: text as Prisma.InputJsonValue, userId: stored.savedBy, savedAt: stored.savedAt },
    skipDuplicates: true,
  });
}
