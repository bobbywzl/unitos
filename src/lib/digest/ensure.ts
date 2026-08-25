import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { buildDigest } from "@/lib/digest/build";
import { contentFingerprints } from "@/lib/digest/fingerprint";
import { renderCorpusDigest } from "@/lib/digest/render";
import { digestCounts, digestParts, type DigestCounts, type DigestParts } from "@/lib/digest/types";

export type DigestRow = {
  notebookId: string;
  userId: string;
  fingerprint: string;
  parts: DigestParts;
  counts: DigestCounts;
  chars: number;
  builtAt: Date;
  rebuilt: boolean; // this read rebuilt the row
};

// Rebuild one corpus's digest and store it. The stored row is what the
// assistant reads and what the admin digest page shows.
export async function rebuildDigest(notebookId: string, fingerprint?: string): Promise<DigestRow | null> {
  const fp = fingerprint ?? (await contentFingerprints([notebookId])).get(notebookId);
  if (!fp) return null;
  const built = await buildDigest(notebookId);
  if (!built) return null;
  const chars = renderCorpusDigest(built.parts).length;
  const builtAt = new Date();
  await db.notebookDigest.upsert({
    where: { notebookId },
    create: {
      notebookId,
      userId: built.owner,
      fingerprint: fp,
      parts: built.parts as unknown as Prisma.InputJsonValue,
      counts: built.counts as unknown as Prisma.InputJsonValue,
      chars,
      builtAt,
    },
    update: {
      userId: built.owner,
      fingerprint: fp,
      parts: built.parts as unknown as Prisma.InputJsonValue,
      counts: built.counts as unknown as Prisma.InputJsonValue,
      chars,
      builtAt,
    },
  });
  return {
    notebookId,
    userId: built.owner,
    fingerprint: fp,
    parts: built.parts,
    counts: built.counts,
    chars,
    builtAt,
    rebuilt: true,
  };
}

type StoredDigest = {
  notebookId: string;
  userId: string;
  fingerprint: string;
  parts: unknown;
  counts: unknown;
  chars: number;
  builtAt: Date;
};

function storedRow(stored: StoredDigest, fingerprint: string): DigestRow | null {
  if (stored.fingerprint !== fingerprint) return null;
  const parts = digestParts(stored.parts);
  if (!parts) return null;
  return {
    notebookId: stored.notebookId,
    userId: stored.userId,
    fingerprint: stored.fingerprint,
    parts,
    counts: digestCounts(stored.counts),
    chars: stored.chars,
    builtAt: stored.builtAt,
    rebuilt: false,
  };
}

// The digest for one corpus, current: the stored row when its fingerprint
// matches the content, else a rebuild. Null = corpus not found.
export async function ensureDigest(notebookId: string): Promise<DigestRow | null> {
  const fingerprint = (await contentFingerprints([notebookId])).get(notebookId);
  if (!fingerprint) return null;
  const stored = await db.notebookDigest.findUnique({ where: { notebookId } });
  if (stored) {
    const row = storedRow(stored, fingerprint);
    if (row) return row;
  }
  return rebuildDigest(notebookId, fingerprint);
}

// Every corpus's digest, current, most recently updated corpus first — the
// Corpora scope (pass the reader's userId) and the admin digest page (pass
// nothing: every user) read this.
export async function ensureAllDigests(userId?: string): Promise<DigestRow[]> {
  const [notebooks, fingerprints, stored] = await Promise.all([
    db.notebook.findMany({
      where: userId ? { userId } : undefined,
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    }),
    contentFingerprints(),
    db.notebookDigest.findMany(),
  ]);
  const storedByNotebook = new Map(stored.map((s) => [s.notebookId, s]));
  const rows: DigestRow[] = [];
  for (const nb of notebooks) {
    const fingerprint = fingerprints.get(nb.id);
    if (!fingerprint) continue;
    const existing = storedByNotebook.get(nb.id);
    const row = existing ? storedRow(existing, fingerprint) : null;
    if (row) {
      rows.push(row);
      continue;
    }
    const rebuilt = await rebuildDigest(nb.id, fingerprint);
    if (rebuilt) rows.push(rebuilt);
  }
  return rows;
}
