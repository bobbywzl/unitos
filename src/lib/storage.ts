import { db } from "@/lib/db";

// Storage (TIERS.md): the bytes an account's files take — the documents
// attached to its projects (the original PDF bytes kept for re-parse), the
// images it dropped or its documents' parses captured, and the videos of its
// documents. Settings shows it as a bar against the tier's limit
// (components/storage-bar.tsx). Text — blocks, notes, transcripts — is small
// beside the files and is not counted.

export type AccountStorage = {
  /** Bytes, by kind. */
  documents: number;
  images: number;
  videos: number;
  /** The three together. */
  used: number;
};

export async function accountStorage(userId: string): Promise<AccountStorage> {
  const [documentRows, images, videos] = await Promise.all([
    // The stored file bytes of every document attached to one of the
    // account's projects. Prisma cannot sum a column's length, so this one
    // is raw; the join mirrors the count in lib/account-data.ts.
    db.$queryRaw<{ bytes: bigint | number | null }[]>`
      SELECT COALESCE(SUM(octet_length(d."fileData")), 0) AS bytes
      FROM "Document" d
      WHERE EXISTS (
        SELECT 1 FROM "NotebookDocument" nd
        JOIN "Notebook" n ON n.id = nd."notebookId"
        WHERE nd."documentId" = d.id AND n."userId" = ${userId}
      )`,
    db.imageAsset.aggregate({
      _sum: { size: true },
      where: {
        OR: [{ userId }, { document: { notebooks: { some: { notebook: { userId } } } } }],
      },
    }),
    db.videoAsset.aggregate({
      _sum: { size: true },
      where: { document: { notebooks: { some: { notebook: { userId } } } } },
    }),
  ]);
  const documents = Number(documentRows[0]?.bytes ?? 0);
  const imageBytes = images._sum.size ?? 0;
  const videoBytes = videos._sum.size ?? 0;
  return { documents, images: imageBytes, videos: videoBytes, used: documents + imageBytes + videoBytes };
}
