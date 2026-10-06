import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordNoteEdit } from "@/lib/notes/edits";
import { NOTE_MERGE_KIND } from "@/lib/notes/merge-snapshot";
import { sourcesLeftByQuotes } from "@/lib/notes/quote-sources";
import { keptNoteOf } from "@/lib/notes/removed";
import { normalizeNoteOrders } from "@/lib/order";

// Words written to a note that is gone (SPEC.md §6): another tab, a
// collaborator, or a merge took the note away while this tab typed in it, or
// while the edit waited in the offline queue. The words are never dropped:
// the first such write makes a new note of them in the gone note's section,
// at its place, and its history event remembers the new note (`keptAs` in
// the event's meta). Every later write to the gone note goes to that note.

export type GoneHome = {
  eventId: string;
  notebookId: string;
  sectionId: string;
  sectionTitle: string | null;
  order: number;
  documentId: string | null;
  /** The note's text when it went. */
  content: string;
  /** Its anchors, copied onto the new note when its text still quotes them. */
  sources: Prisma.SourceCreateManyInput[];
  /** The note that took the words of an earlier write, when there is one. */
  keptAs: string | null;
};

const mergedSchema = z.object({
  notes: z.array(z.object({ id: z.string(), sectionId: z.string(), order: z.number(), content: z.string() }).passthrough()),
});

type EventRow = { id: string; notebookId: string; kind: string; meta: unknown };

/** The history event that says where the gone note stood: its removal, or
    the merge that took it. Locked when `tx` runs in a transaction. */
async function goneEvent(noteId: string, tx: Prisma.TransactionClient, lock: boolean): Promise<EventRow | null> {
  const rows = lock
    ? await tx.$queryRaw<EventRow[]>`
        SELECT "id", "notebookId", "kind", "meta" FROM "NotebookEvent"
        WHERE ("kind" = 'NOTE_REMOVE' AND "meta"->'kept'->>'id' = ${noteId})
           OR ("kind" = ${NOTE_MERGE_KIND} AND "meta"->'notes' @> jsonb_build_array(jsonb_build_object('id', ${noteId}::text)))
        ORDER BY "createdAt" DESC LIMIT 1 FOR UPDATE`
    : await tx.$queryRaw<EventRow[]>`
        SELECT "id", "notebookId", "kind", "meta" FROM "NotebookEvent"
        WHERE ("kind" = 'NOTE_REMOVE' AND "meta"->'kept'->>'id' = ${noteId})
           OR ("kind" = ${NOTE_MERGE_KIND} AND "meta"->'notes' @> jsonb_build_array(jsonb_build_object('id', ${noteId}::text)))
        ORDER BY "createdAt" DESC LIMIT 1`;
  return rows[0] ?? null;
}

function homeOf(noteId: string, event: EventRow): GoneHome | null {
  const meta = (event.meta ?? {}) as Record<string, unknown>;
  const keptAs = typeof meta.keptAs === "string" ? meta.keptAs : null;
  const sectionTitle = typeof meta.sectionTitle === "string" ? meta.sectionTitle : null;
  if (event.kind === "NOTE_REMOVE") {
    const kept = keptNoteOf(meta);
    if (!kept) return null;
    return {
      eventId: event.id,
      notebookId: event.notebookId,
      sectionId: kept.sectionId,
      sectionTitle,
      order: kept.order,
      documentId: kept.documentId,
      content: kept.content,
      sources: kept.sources.map((s) => ({
        documentId: s.documentId,
        blockId: s.blockId,
        startOffset: s.startOffset,
        endOffset: s.endOffset,
        quotedText: s.quotedText,
        prefix: s.prefix,
        suffix: s.suffix,
        orphaned: s.orphaned,
        layer: s.layer,
        startTime: s.startTime,
        endTime: s.endTime,
        ...(s.region === null || s.region === undefined ? {} : { region: s.region as Prisma.InputJsonValue }),
        noteId: "",
      })),
      keptAs,
    };
  }
  const merged = mergedSchema.safeParse(meta);
  const note = merged.success ? merged.data.notes.find((n) => n.id === noteId) : undefined;
  if (!note) return null;
  // A merged note's anchors moved to the merge's target; the target keeps them.
  return {
    eventId: event.id,
    notebookId: event.notebookId,
    sectionId: note.sectionId,
    sectionTitle: null,
    order: note.order,
    documentId: null,
    content: note.content,
    sources: [],
    keptAs,
  };
}

/** Where a gone note stood, or null when no history event kept it. */
export async function goneHome(noteId: string): Promise<GoneHome | null> {
  const event = await goneEvent(noteId, db, false);
  return event ? homeOf(noteId, event) : null;
}

/** Make the new note that keeps words written to a gone note: in its
    section (else the section of the same title, else the project's first),
    at its place. `content` is the note's whole text after the write.
    `sources`: anchors the write itself adds. Returns the new note's id, or
    the id of the note an earlier write already made. */
export async function keepGoneWords(
  noteId: string,
  content: string,
  userId: string | null,
  sources: Prisma.SourceCreateManyInput[],
  fromWholeText: boolean,
): Promise<string | null> {
  const made = await db.$transaction(
    async (tx) => {
      const event = await goneEvent(noteId, tx, true);
      const home = event ? homeOf(noteId, event) : null;
      if (!event || !home) return null;
      if (home.keptAs && (await tx.note.findUnique({ where: { id: home.keptAs }, select: { id: true } }))) {
        return { id: home.keptAs, sectionId: null as string | null, fresh: false };
      }
      const sections = await tx.section.findMany({
        where: { notebookId: home.notebookId, hidden: false },
        select: { id: true, title: true },
        orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { order: "asc" }],
      });
      const section =
        sections.find((s) => s.id === home.sectionId) ??
        (home.sectionTitle ? sections.find((s) => s.title === home.sectionTitle) : undefined) ??
        sections[0];
      if (!section) return null;
      const attached = home.documentId
        ? await tx.notebookDocument.findUnique({
            where: { notebookId_documentId: { notebookId: home.notebookId, documentId: home.documentId } },
            select: { documentId: true },
          })
        : null;
      // The gone note's own anchors come along when the text still quotes them
      // (a whole text saved from the editor); an append carries only its own.
      const docs = new Set(
        (
          await tx.document.findMany({
            where: { id: { in: home.sources.map((s) => s.documentId).filter((d): d is string => !!d) } },
            select: { id: true },
          })
        ).map((d) => d.id),
      );
      const own = fromWholeText
        ? home.sources.filter((s) => s.documentId && docs.has(s.documentId))
        : [];
      const dropped = new Set(
        sourcesLeftByQuotes(
          home.content,
          content,
          own.map((s, i) => ({ id: String(i), quotedText: s.quotedText })),
        ),
      );
      const kept = own.filter((_, i) => !dropped.has(String(i)));
      // Its place: the notes at and after it move down one.
      await tx.note.updateMany({
        where: { sectionId: section.id, order: { gte: home.order } },
        data: { order: { increment: 1 } },
      });
      const note = await tx.note.create({
        data: {
          sectionId: section.id,
          content,
          status: "ACCEPTED",
          createdById: userId,
          documentId: attached?.documentId ?? null,
          order: Math.max(0, home.order),
        },
        select: { id: true },
      });
      const rows = [...kept, ...sources].map((s) => ({ ...s, noteId: note.id }));
      if (rows.length > 0) await tx.source.createMany({ data: rows });
      await recordNoteEdit(note.id, userId, content, tx);
      // The event remembers the new note (one key added to its meta), so
      // every later write to the gone note lands there.
      const meta = (event.meta ?? {}) as Record<string, unknown>;
      await tx.notebookEvent.update({
        where: { id: event.id },
        data: { meta: { ...meta, keptAs: note.id } as Prisma.InputJsonValue },
      });
      return { id: note.id, sectionId: section.id as string | null, fresh: true };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  if (!made) return null;
  if (made.sectionId) await normalizeNoteOrders(made.sectionId);
  return made.id;
}
