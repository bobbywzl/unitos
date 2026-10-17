import { withoutOtherProjectLinkEdits } from "@/lib/collab";
import { db } from "@/lib/db";
import { trivialEdits } from "@/lib/history/trivial";
import { NOTE_MERGE_KIND } from "@/lib/notes/merge-snapshot";
import type { EditItem, HistoryEntry } from "@/lib/types";

// The History panel's rows (SPEC.md §12): the project's events (deletions,
// detachments, merges) merged with every attached document's edits, newest
// first. One page is HISTORY_PAGE rows; Show older reads the page under the
// last row shown, so every row, a removed note kept whole among them, is
// reachable. History's This document reads one document's rows
// (`documentId`): its edits, the notes and annotations removed that quoted
// it or were made on it, and its removal from the project. Read-only:
// nothing here writes a row.

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

/** The ids of the project's events about one document: a removed note made
    on it or quoting it, and its removal from the project. */
async function eventsOfDocument(notebookId: string, documentId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "NotebookEvent"
    WHERE "notebookId" = ${notebookId} AND (
      ("kind" = 'DOCUMENT_DETACH' AND "meta" ->> 'documentId' = ${documentId})
      OR ("kind" = 'NOTE_REMOVE' AND (
        "meta" -> 'kept' ->> 'documentId' = ${documentId}
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof("meta" -> 'kept' -> 'sources') = 'array' THEN "meta" -> 'kept' -> 'sources' ELSE '[]'::jsonb END
          ) AS s
          WHERE s ->> 'documentId' = ${documentId}
        )
      ))
    )`;
  return rows.map((r) => r.id);
}

const newestFirst = (a: HistoryEntry, b: HistoryEntry) =>
  b.createdAt.localeCompare(a.createdAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0);

export async function historyPage(
  notebookId: string,
  attachedIds: string[],
  cursor: HistoryCursor | null = null,
  limit = HISTORY_PAGE,
  { documentId }: { documentId?: string } = {},
): Promise<{ entries: HistoryEntry[]; more: boolean }> {
  // This document: the project's events that name it. A removed note names
  // it by its own document or by a quote's; a detach by its documentId.
  const eventIds = documentId === undefined ? null : await eventsOfDocument(notebookId, documentId);
  // The newest `limit` rows of the union are among the newest `limit` of
  // each table; one more of each says whether older rows remain.
  const [events, edits] = await Promise.all([
    // meta is left out: a detach keeps the project's work on the document
    // there (lib/documents/detach.ts), and the panel reads none of it.
    eventIds !== null && eventIds.length === 0
      ? []
      : db.notebookEvent.findMany({
          where: { notebookId, ...(eventIds ? { id: { in: eventIds } } : {}), ...olderThan(cursor) },
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
  // Links belong to a project (SPEC.md §13): the LINK_ADD and LINK_REMOVE
  // edits of another project's links are left out (lib/collab.ts).
  const ownEdits = await withoutOtherProjectLinkEdits(edits, notebookId);
  // Small edits are marked (lib/history/trivial.ts) so the panel folds them.
  const trivial = await trivialEdits(ownEdits);
  // A removed note or section kept whole can be restored (lib/notes/removed.ts): read
  // as two flags, never the kept note itself. A removed document's row
  // reads its document's id, so the row can offer Add back.
  // A merge keeps the notes it took (lib/notes/merge-snapshot.ts): its
  // row restores them, and reads as restored once its Undo or a Restore
  // put them back.
  const flagged = events
    .filter(
      (e) =>
        e.kind === "NOTE_REMOVE" ||
        e.kind === "SECTION_REMOVE" ||
        e.kind === "DOCUMENT_DETACH" ||
        e.kind === NOTE_MERGE_KIND,
    )
    .map((e) => e.id);
  const flags =
    flagged.length === 0
      ? []
      : await db.$queryRaw<{ id: string; kept: boolean; restored: boolean; documentId: string | null }[]>`
          SELECT "id",
                 (CASE WHEN "kind" = ${NOTE_MERGE_KIND}
                       THEN jsonb_typeof("meta" -> 'notes') = 'array' AND jsonb_array_length("meta" -> 'notes') > 0
                       ELSE ("meta" -> 'kept') IS NOT NULL END) IS TRUE AS "kept",
                 (("meta" -> 'restoredAt') IS NOT NULL OR ("kind" = ${NOTE_MERGE_KIND} AND ("meta" -> 'undoneAt') IS NOT NULL)) AS "restored",
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
  // A link's edit: its meta names the link, its other end, and what
  // happened to it (restored by Undo or Restore; a recommended link
  // dismissed, hidden and not deleted).
  const linkMeta = (meta: unknown) =>
    (meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}) as {
      linkId?: unknown;
      restored?: unknown;
      dismissed?: unknown;
      toTitle?: unknown;
    };
  // A removed link still hidden in this project: its newest LINK_REMOVE row
  // carries the link, so the row offers Restore (WALK5-01, WALK5-08). The
  // panel shows the button to editors; the route checks the role again.
  const removedLinkIds = [
    ...new Set(
      ownEdits.flatMap((e) => {
        const id = linkMeta(e.meta).linkId;
        return e.kind === "LINK_REMOVE" && typeof id === "string" ? [id] : [];
      }),
    ),
  ];
  const stillHidden = new Set(
    removedLinkIds.length === 0
      ? []
      : (
          await db.docLinkHidden.findMany({
            where: { notebookId, docLinkId: { in: removedLinkIds } },
            select: { docLinkId: true },
          })
        ).map((h) => h.docLinkId),
  );
  const restoreOffered = new Set<string>();
  const restoreLinkOf = (e: { kind: string; meta: unknown }): string | undefined => {
    const id = linkMeta(e.meta).linkId;
    if (e.kind !== "LINK_REMOVE" || typeof id !== "string" || !stillHidden.has(id) || restoreOffered.has(id)) {
      return undefined;
    }
    restoreOffered.add(id); // ownEdits is newest first: the newest removal
    return id;
  };
  // A link's row names both ends: "BOOK TWO → Extra notes".
  const linkEnds = (e: { kind: string; meta: unknown; document: { title: string } }): string => {
    const to = linkMeta(e.meta).toTitle;
    return (e.kind === "LINK_ADD" || e.kind === "LINK_REMOVE") && typeof to === "string" && to !== ""
      ? `${e.document.title} → ${to}`
      : e.document.title;
  };
  const all: HistoryEntry[] = [
    ...events.map(
      (e): HistoryEntry => ({
        id: e.id,
        userId: e.userId,
        kind: e.kind as HistoryEntry["kind"],
        content: e.content,
        documentTitle: null,
        ...((e.kind === "NOTE_REMOVE" || e.kind === "SECTION_REMOVE" || e.kind === NOTE_MERGE_KIND) &&
        flagsOf.get(e.id)?.kept
          ? { restorable: true, restored: flagsOf.get(e.id)!.restored }
          : {}),
        ...(e.kind === "DOCUMENT_DETACH" && addBackOf(e.id) ? { addBackDocumentId: addBackOf(e.id)! } : {}),
        createdAt: e.createdAt.toISOString(),
      }),
    ),
    ...ownEdits.map((e): HistoryEntry => {
      const restoreLinkId = restoreLinkOf(e);
      return {
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
        documentTitle: linkEnds(e),
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
        ...(restoreLinkId ? { restoreLinkId } : {}),
        ...(e.kind === "LINK_ADD" && linkMeta(e.meta).restored === true ? { restored: true } : {}),
        ...(e.kind === "LINK_REMOVE" && linkMeta(e.meta).dismissed === true ? { dismissed: true } : {}),
      };
    }),
  ].sort(newestFirst);
  // Rows left out as another project's link edits held places in the page:
  // older rows may remain past what shows.
  return { entries: all.slice(0, limit), more: all.length > limit || edits.length > limit };
}
