import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizeNoteOrders } from "@/lib/order";

// A removed note, kept whole in its NOTE_REMOVE history event (SPEC.md §12):
// the note's fields, its sources, its replies, its edits, and its side chats
// with theirs. History's Restore puts it back as it was, with its id, so an
// annotation reference or a link to the note finds it again. The 12-second
// Undo after a delete is the quick way back; this is the way back after it.

const noteInclude = { sources: true, replies: true, edits: true } as const;
type NoteRow = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;
export type KeptNote = NoteRow & { sideChats: NoteRow[] };

/** The note as it is now, whole, for its history event; null when it is gone. */
export async function keepNote(noteId: string): Promise<KeptNote | null> {
  const note = await db.note.findUnique({ where: { id: noteId }, include: noteInclude });
  if (!note) return null;
  const sideChats = await db.note.findMany({ where: { sideChatOfId: noteId }, include: noteInclude });
  return { ...note, sideChats };
}

const json = (value: unknown) =>
  value === null || value === undefined ? undefined : (value as Prisma.InputJsonValue);

function noteWrites(row: NoteRow, sectionId: string, order: number, documents: Set<string>) {
  // Only the note's own columns go into its create: the kept relations
  // (and a side chat list, on the top note) are written as their own rows.
  const { sources, replies, edits, section: _section, sideChats: _chats, ...note } = row as NoteRow & {
    section?: unknown;
    sideChats?: unknown;
  };
  void _section;
  void _chats;
  return [
    db.note.create({
      data: {
        ...note,
        sectionId,
        order,
        conversation: json(note.conversation),
        log: json(note.log),
        documentId: note.documentId && documents.has(note.documentId) ? note.documentId : null,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt),
      },
    }),
    ...(sources.length > 0
      ? [
          db.source.createMany({
            data: sources.map((s) => {
              // A source whose document is gone since keeps its quote, orphaned (SPEC.md §5).
              const kept = s.documentId !== null && documents.has(s.documentId);
              return { ...s, documentId: kept ? s.documentId : null, orphaned: kept ? s.orphaned : true, region: json(s.region) };
            }),
          }),
        ]
      : []),
    ...(replies.length > 0
      ? [db.reply.createMany({ data: replies.map((r) => ({ ...r, createdAt: new Date(r.createdAt) })) })]
      : []),
    ...(edits.length > 0
      ? [
          db.noteEdit.createMany({
            data: edits.map((e) => ({ ...e, createdAt: new Date(e.createdAt), updatedAt: new Date(e.updatedAt) })),
          }),
        ]
      : []),
  ];
}

export type RestoreResult =
  | { ok: true; noteId: string; sectionId: string }
  | { ok: false; reason: "restored" | "notKept" };

/** Put a kept note back in its project: in its section when the section is
    still there, else in the section of the same title, else the project's
    first section. In its own section it takes its place again; in
    another it lands at the end. */
export async function restoreNote(kept: KeptNote, notebookId: string, sectionTitle: string | null): Promise<RestoreResult> {
  if (await db.note.findUnique({ where: { id: kept.id }, select: { id: true } })) {
    return { ok: false, reason: "restored" };
  }
  const sections = await db.section.findMany({
    where: { notebookId },
    select: { id: true, title: true },
    orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { order: "asc" }],
  });
  const section =
    sections.find((s) => s.id === kept.sectionId) ??
    (sectionTitle ? sections.find((s) => s.title === sectionTitle) : undefined) ??
    sections[0];
  if (!section) return { ok: false, reason: "notKept" };
  const docIds = [kept.documentId, ...kept.sources.map((s) => s.documentId), ...kept.sideChats.flatMap((c) => [c.documentId, ...c.sources.map((s) => s.documentId)])]
    .filter((id): id is string => !!id);
  const documents = new Set(
    (await db.document.findMany({ where: { id: { in: [...new Set(docIds)] } }, select: { id: true } })).map((d) => d.id),
  );
  const count = await db.note.count({ where: { sectionId: section.id } });
  // Back in its own section, the note takes its place again: the row it
  // had, the notes from there down one row lower. In another section it
  // lands at the end.
  const at = section.id === kept.sectionId ? Math.max(0, Math.min(kept.order, count)) : count;
  await db.$transaction([
    db.note.updateMany({ where: { sectionId: section.id, order: { gte: at } }, data: { order: { increment: 1 } } }),
    ...noteWrites(kept, section.id, at, documents),
    ...kept.sideChats.flatMap((chat, i) => noteWrites(chat, section.id, count + 1 + i, documents)),
  ]);
  await normalizeNoteOrders(section.id);
  return { ok: true, noteId: kept.id, sectionId: section.id };
}

// Validated on the way back in, as every stored JSON the app acts on is:
// the fields Restore reads by name; the rest of each row passes through.
const rowSchema = z.object({ id: z.string() }).passthrough();
const noteSchema = z
  .object({
    id: z.string(),
    sectionId: z.string(),
    content: z.string(),
    sources: z.array(rowSchema.extend({ noteId: z.string(), blockId: z.string() })),
    replies: z.array(rowSchema),
    edits: z.array(rowSchema),
  })
  .passthrough();
const keptSchema = noteSchema.extend({ sideChats: z.array(noteSchema) });

/** The kept note in a history event's meta, or null (a removal made before
    removals kept the note). */
export function keptNoteOf(meta: unknown): KeptNote | null {
  const parsed = keptSchema.safeParse((meta as { kept?: unknown } | null)?.kept);
  return parsed.success ? (parsed.data as unknown as KeptNote) : null;
}
