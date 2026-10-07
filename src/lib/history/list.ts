import { db } from "@/lib/db";
import { trivialEdits } from "@/lib/history/trivial";
import type { EditItem, HistoryEntry } from "@/lib/types";

// The History panel's rows (SPEC.md §12): the project's events (deletions,
// detachments, merges) merged with every attached document's edits, newest
// first. One page is HISTORY_PAGE rows; Show older reads the page under the
// last row shown, so every row, a removed note kept whole among them, is
// reachable. History's This document reads one document's edits alone
// (`editsOnly`), the rows the rail's Edits tab listed. Read-only: nothing
// here writes a row.

export const HISTORY_PAGE = 100;

/** Where a page ends: the last row shown. Rows older than it come next. */
export type HistoryCursor = { at: Date; id: string };

/** Rows strictly older than the cursor, by (createdAt, id) descending. */
function olderThan(cursor: HistoryCursor | null) {
  return cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.at } },
          { createdAt: cursor.at, id: { lt: cursor.id } },
        ],
      }
    : {};
}

const newestFirst = (a: HistoryEntry, b: HistoryEntry) =>
  b.createdAt.localeCompare(a.createdAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

export async function historyPage(
  notebookId: string,
  attachedIds: string[],
  cursor: HistoryCursor | null = null,
  limit = HISTORY_PAGE,
  { editsOnly = false }: { editsOnly?: boolean } = {},
): Promise<{ entries: HistoryEntry[]; more: boolean }> {
  // The newest `limit` rows of the union are among the newest `limit` of
  // each table; one more of each says whether older rows remain.
  const [events, edits] = await Promise.all([
    // meta is left out: a detach keeps the project's work on the document
    // there (lib/documents/detach.ts), and the panel reads none of it.
    editsOnly
      ? []
      : db.notebookEvent.findMany({
          where: { notebookId, ...olderThan(cursor) },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: { id: true, userId: true, kind: true, content: true, createdAt: true },
        }),
    attachedIds.length > 0
      ? db.blockEdit.findMany({
          where: { documentId: { in: attachedIds }, ...olderThan(cursor) },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          include: {
            document: { select: { title: true } },
            // The discussion under each edit (reply-thread.tsx), oldest first.
            replies: { orderBy: { createdAt: "asc" } },
          },
        })
      : [],
  ]);
  // Small edits are marked (lib/history/trivial.ts) so the panel folds them.
  const trivial = await trivialEdits(edits);
  // A removed note kept whole can be restored (lib/notes/removed.ts): read
  // as two flags, never the kept note itself. A removed document's row
  // reads its document's id, so the row can offer Add back.
  const flagged = events.filter((e) => e.kind === "NOTE_REMOVE" || e.kind === "DOCUMENT_DETACH").map((e) => e.id);
  const flags =
    flagged.length === 0
      ? []
      : await db.$queryRaw<{ id: string; kept: boolean; restored: boolean; documentId: string | null }[]>`
          SELECT "id", ("meta" -> 'kept') IS NOT NULL AS "kept", ("meta" -> 'restoredAt') IS NOT NULL AS "restored",
                 ("meta" ->> 'documentId') AS "documentId"
          FROM "NotebookEvent" WHERE "id" = ANY(${flagged})`;
  const flagsOf = new Map(flags.map((r) => [r.id, r]));
  // Add back shows while the document is out of the project and still exists.
  const detachedIds = [
    ...new Set(
      flags
        .map((r) => r.documentId)
        .filter((id): id is string => !!id && !attachedIds.includes(id)),
    ),
  ];
  const stillThere =
    detachedIds.length === 0
      ? new Set<string>()
      : new Set(
          (await db.document.findMany({ where: { id: { in: detachedIds } }, select: { id: true } })).map((d) => d.id),
        );
  const addBackOf = (id: string): string | null => {
    const documentId = flagsOf.get(id)?.documentId;
    return documentId && stillThere.has(documentId) ? documentId : null;
  };
  const all: HistoryEntry[] = [
    ...events.map(
      (e): HistoryEntry => ({
        id: e.id,
        userId: e.userId,
        kind: e.kind as HistoryEntry["kind"],
        content: e.content,
        documentTitle: null,
        ...(e.kind === "NOTE_REMOVE" && flagsOf.get(e.id)?.kept
          ? { restorable: true, restored: flagsOf.get(e.id)!.restored }
          : {}),
        ...(e.kind === "DOCUMENT_DETACH" && addBackOf(e.id) ? { addBackDocumentId: addBackOf(e.id)! } : {}),
        createdAt: e.createdAt.toISOString(),
      }),
    ),
    ...edits.map(
      (e): HistoryEntry => ({
        id: e.id,
        userId: e.userId,
        kind: e.kind as HistoryEntry["kind"],
        content:
          e.kind === "TEXT_EDIT" || e.kind === "BLOCK_ADD"
            ? (e.after ?? e.before ?? "")
            : e.kind === "BLOCK_REMOVE"
              ? (e.before ?? "")
              : ((e.meta as { quotedText?: string; to?: string } | null)?.quotedText ??
                (e.meta as { to?: string } | null)?.to ??
                ""),
        documentTitle: e.document.title,
        documentId: e.documentId,
        blockId: e.blockId,
        edit: {
          before: e.before,
          after: e.after,
          meta: e.meta as EditItem["meta"],
          replies: e.replies.map((r) => ({
            id: r.id,
            content: r.content,
            userId: r.userId,
            resolvedById: r.resolvedById,
            createdAt: r.createdAt.toISOString(),
          })),
        },
        createdAt: e.createdAt.toISOString(),
        trivial: trivial.get(e.id) ?? false,
      }),
    ),
  ].sort(newestFirst);
  return { entries: all.slice(0, limit), more: all.length > limit };
}
