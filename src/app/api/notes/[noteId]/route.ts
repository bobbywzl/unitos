import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sourceInputSchema } from "@/lib/anchors/input";
import { MAX_SEGMENTS, passageSources, resolvePassage } from "@/lib/anchors/passage";
import { layerBlocks } from "@/lib/anchors/layer";
import { bumpNotebook, noteAccess, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { reconcileNoteText } from "@/lib/notes/conflict";
import { goneHome, keepGoneWords } from "@/lib/notes/gone";
import { keepNote } from "@/lib/notes/removed";
import { recordNoteEdit } from "@/lib/notes/edits";
import { sourcesLeftByQuotes } from "@/lib/notes/quote-sources";
import { normalizeNoteOrders, movedOrder } from "@/lib/order";
import { parseBody } from "@/lib/validate";

const MAX_CONTENT = 50_000;

const patchSchema = z.object({
  content: z.string().min(1).max(MAX_CONTENT).optional(),
  // The note's text as the editor had it when this edit began (SPEC.md §6):
  // when the stored text has changed since — another tab, a collaborator —
  // the write is refused with 409 and the stored text, and the editor puts
  // the two together (lib/notes/conflict.ts). A write without it saves as
  // it always did.
  baseContent: z.string().max(MAX_CONTENT).optional(),
  // "keep": a write that cannot read a 409 (the offline queue, the closing
  // flush) is put together with the stored text here instead of refused.
  onConflict: z.enum(["refuse", "keep"]).optional(),
  // Text added at the end of the note (Add to notes into an existing note):
  // the note's words stay as they are, then one blank line, then this. Never
  // sent with `content`.
  append: z.string().min(1).max(MAX_CONTENT).optional(),
  // A quote dropped into the note (SPEC.md §6): its anchor, one segment per
  // block of a passage over several. Resolved through the ladder like a
  // source on a new note (/api/notes), and added to the note's sources.
  addSource: z
    .object({
      source: sourceInputSchema,
      segments: z.array(sourceInputSchema.omit({ documentId: true })).min(1).max(MAX_SEGMENTS).optional(),
    })
    .optional(),
  // An annotation dropped into the note (lib/annotation-reference.ts): copies
  // of the annotation's anchors become sources of the note, so the quote the
  // drop landed points back to the reader. The annotation keeps its own.
  copySourcesFrom: z.string().min(1).optional(),
  // "keep": a quote whose anchor no longer resolves still lands its words,
  // without the source, and the answer carries sourceDropped (the offline
  // queue, the drop on a closed note). Unset, the write is refused whole.
  onSourceLost: z.enum(["refuse", "keep"]).optional(),
  // Sources a quote dropped into the open editor attached, given up with
  // the editor's Cancel (SPEC.md §6): only this note's own rows go.
  removeSources: z.array(z.string().min(1)).max(50).optional(),
  // A draft left of a note that is not in the project's notes on load
  // (use-outline.ts): its words go to a new note when the note is gone. A
  // note that still exists refuses the write; its own project's load saves
  // the draft.
  onlyIfGone: z.boolean().optional(),
  color: z.enum(["clay", "sage", "gold", "plum"]).optional(), // highlight hue
  order: z.number().int().min(0).optional(),
  sectionId: z.string().min(1).optional(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]).optional(),
  pinned: z.boolean().optional(),
});

type SourceRow = Prisma.SourceCreateManyInput;

/** What the locked write answered: the note's new state, or a refusal. */
type Written =
  | { kind: "ok" }
  | { kind: "gone" }
  | { kind: "changed"; current: { content: string; updatedAt: Date } }
  | { kind: "tooLong" };

type PatchData = z.infer<typeof patchSchema>;
type T = Awaited<ReturnType<typeof serverT>>;

export async function PATCH(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId } = await ctx.params;
  const { data, error } = await parseBody(req, patchSchema);
  if (error) return error;
  return writeNote(noteId, data, t);
}

/** A write to a note that is gone (lib/notes/gone.ts): words are never
    dropped. The first write with words makes a new note of them where the
    note stood; every later one goes to that note. The answer is that note,
    with keptAs naming it. A write without words answers 404 as before. */
async function writeGoneNote(noteId: string, data: PatchData, t: T): Promise<NextResponse> {
  const notFound = NextResponse.json({ error: t("api.noteNotFound"), code: "noteGone" }, { status: 404 });
  const home = await goneHome(noteId);
  if (!home) return notFound;
  const access = await notebookAccess(home.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  if (home.keptAs && (await db.note.findUnique({ where: { id: home.keptAs }, select: { id: true } }))) {
    return writeNote(home.keptAs, data, t, home.keptAs);
  }
  const words = data.content ?? data.append;
  if (words === undefined) return notFound;
  let sources: Prisma.SourceCreateManyInput[] = [];
  if (data.addSource) {
    const { source, segments } = data.addSource;
    const layer = source.layer ?? null;
    if (source.endOffset > source.startOffset) {
      const passage = resolvePassage(await layerBlocks(source.documentId, layer), source, segments);
      sources = passageSources(source.documentId, passage, layer).map((row) => ({ ...row, noteId: "" }));
    }
  }
  const keptAs = await keepGoneWords(noteId, words, access.user.id || null, sources, data.content !== undefined);
  if (!keptAs) return notFound;
  // The rest of the write (an annotation's anchors, a status) lands on the new note.
  const rest: PatchData = { ...data, content: undefined, baseContent: undefined, append: undefined, addSource: undefined };
  if (rest.copySourcesFrom || rest.status || rest.color || rest.pinned !== undefined) return writeNote(keptAs, rest, t, keptAs);
  await bumpNotebook(home.notebookId);
  const kept = await db.note.findUnique({ where: { id: keptAs } });
  return NextResponse.json({ ...kept, keptAs });
}

async function writeNote(noteId: string, data: PatchData, t: T, keptAs?: string): Promise<NextResponse> {
  const note = await db.note.findUnique({ where: { id: noteId } });
  if (!note) return keptAs ? NextResponse.json({ error: t("api.noteNotFound"), code: "noteGone" }, { status: 404 }) : writeGoneNote(noteId, data, t);
  if (data.onlyIfGone && !keptAs) return NextResponse.json({ error: t("api.noteChanged"), code: "noteExists" }, { status: 409 });
  const access = await noteAccess(noteId, "editor");
  if (access instanceof NextResponse) return access;

  const fromSectionId = note.sectionId;

  if (data.append !== undefined && data.content !== undefined) {
    return NextResponse.json({ error: t("api.appendWithContent") }, { status: 400 });
  }

  // The sources first, outside the lock: resolving a quote reads the
  // document's blocks, and never depends on the note's text.
  let sourceRows: SourceRow[] = [];
  // A quote whose place the document no longer has (an edit, a re-parse):
  // with onSourceLost "keep" its words still land, without the source, and
  // the answer says so. Without it the write is refused whole, as before.
  let sourceDropped = false;
  if (data.addSource) {
    const { source, segments } = data.addSource;
    if (source.endOffset <= source.startOffset) {
      return NextResponse.json({ error: t("api.anchorOffsetsInvalid") }, { status: 400 });
    }
    const layer = source.layer ?? null;
    const passage = resolvePassage(await layerBlocks(source.documentId, layer), source, segments);
    if (passage.length === 0) {
      if (data.onSourceLost !== "keep") {
        return NextResponse.json({ error: t("api.anchorNotResolvedInDocument"), code: "sourceLost" }, { status: 400 });
      }
      sourceDropped = true;
    } else {
      sourceRows = passageSources(source.documentId, passage, layer).map((row) => ({ ...row, noteId }));
    }
  }

  let copyRows: SourceRow[] = [];
  if (data.copySourcesFrom) {
    const [annotation, own] = await Promise.all([
      db.note.findUnique({
        where: { id: data.copySourcesFrom },
        include: { sources: true, section: { select: { hidden: true, notebookId: true } } },
      }),
      db.section.findUnique({ where: { id: note.sectionId }, select: { notebookId: true } }),
    ]);
    if (!annotation || !annotation.section.hidden || annotation.section.notebookId !== own?.notebookId) {
      return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
    }
    copyRows = annotation.sources.map((s) => ({
      noteId,
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
      ...(s.region === null ? {} : { region: s.region as Prisma.InputJsonValue }),
    }));
  }

  if (data.sectionId && data.sectionId !== note.sectionId) {
    const target = await db.section.findUnique({ where: { id: data.sectionId } });
    if (!target) return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });
    const count = await db.note.count({ where: { sectionId: data.sectionId } });
    await db.note.update({
      where: { id: noteId },
      data: { sectionId: data.sectionId, order: count },
    });
  }

  // The note's text is read, checked, and written with its row locked
  // (SPEC.md §6): two writes at once — two quotes dropped, an append beside
  // an editor's save, two tabs saving — run one after the other, and the
  // second is built from the text the first left. Without the lock both
  // read the same text and the later write drops the earlier one's words.
  // The sources this write added, so the editor's Cancel can give them up.
  const added: string[] = [];
  const written = await db.$transaction(
    async (tx): Promise<Written> => {
      const [row] = await tx.$queryRaw<{ content: string; updatedAt: Date }[]>`
        SELECT "content", "updatedAt" FROM "Note" WHERE "id" = ${noteId} FOR UPDATE`;
      if (!row) return { kind: "gone" };
      const stored = row.content;

      // The note's next text: the whole replacement, or the stored text with
      // the appended words after a blank line (an empty note becomes the words).
      let content = data.content;
      if (data.append !== undefined) {
        const head = stored.replace(/\n+$/, "");
        content = head ? `${head}\n\n${data.append}` : data.append;
        if (content.length > MAX_CONTENT) return { kind: "tooLong" };
      }

      // A write made from text that is no longer the note's (SPEC.md §6):
      // never saved over the words it did not see.
      if (
        data.content !== undefined &&
        data.baseContent !== undefined &&
        data.baseContent.trim() !== stored.trim() &&
        data.content.trim() !== stored.trim()
      ) {
        if (data.onConflict !== "keep") return { kind: "changed", current: { content: stored, updatedAt: row.updatedAt } };
        content = reconcileNoteText(data.baseContent.trim(), stored.trim(), data.content.trim(), {
          other: t("outline.conflictOther"),
          yours: t("outline.conflictYours"),
          end: t("outline.conflictEnd"),
        }).text;
        if (content.length > MAX_CONTENT) return { kind: "tooLong" };
      }

      if (sourceRows.length > 0) {
        const made = await tx.source.createManyAndReturn({ data: sourceRows, select: { id: true } });
        added.push(...made.map((m) => m.id));
      }
      if (data.removeSources && data.removeSources.length > 0) {
        await tx.source.deleteMany({ where: { id: { in: data.removeSources }, noteId } });
      }
      if (copyRows.length > 0) {
        // An anchor the note already holds is not copied twice.
        const held = await tx.source.findMany({
          where: { noteId },
          select: { blockId: true, startOffset: true, endOffset: true },
        });
        const keys = new Set(held.map((s) => `${s.blockId}:${s.startOffset}:${s.endOffset}`));
        const rows = copyRows.filter((s) => !keys.has(`${s.blockId}:${s.startOffset}:${s.endOffset}`));
        if (rows.length > 0) await tx.source.createMany({ data: rows });
      }

      if (
        content !== undefined ||
        data.status !== undefined ||
        data.color !== undefined ||
        data.pinned !== undefined
      ) {
        await tx.note.update({
          where: { id: noteId },
          data: {
            // A content edit clears the gist; the next collapsed render asks
            // for a new one (SPEC.md §6).
            ...(content !== undefined ? { content, gist: null } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.color !== undefined ? { color: data.color } : {}),
            ...(data.pinned !== undefined ? { pinned: data.pinned } : {}),
          },
        });
        // A changed text is the note's history (SPEC.md §12).
        if (content !== undefined && content !== stored) {
          await recordNoteEdit(noteId, access.user.id || null, content, tx);
          // A quote deleted from the note takes its source with it: the mark
          // in the reader no longer points at a note that lost the words
          // (SPEC.md §6). An append keeps every quote, so it leaves every source.
          if (data.content !== undefined) {
            const sources = await tx.source.findMany({ where: { noteId }, select: { id: true, quotedText: true } });
            const left = sourcesLeftByQuotes(stored, content, sources);
            if (left.length > 0) await tx.source.deleteMany({ where: { id: { in: left }, noteId } });
          }
        }
      }
      return { kind: "ok" };
    },
    { timeout: 20_000, maxWait: 20_000 },
  );
  if (written.kind === "gone") {
    return keptAs ? NextResponse.json({ error: t("api.noteNotFound"), code: "noteGone" }, { status: 404 }) : writeGoneNote(noteId, data, t);
  }
  if (written.kind === "tooLong") return NextResponse.json({ error: t("api.noteTooLong") }, { status: 400 });
  if (written.kind === "changed") {
    return NextResponse.json({ error: t("api.noteChanged"), current: written.current }, { status: 409 });
  }

  // Pinning moves the note to the top of its section; unpinning leaves it in place.
  const targetOrder = data.order ?? (data.pinned === true ? 0 : undefined);
  if (targetOrder !== undefined) {
    const current = await db.note.findUnique({ where: { id: noteId } });
    if (current) {
      const siblings = await db.note.findMany({
        where: { sectionId: current.sectionId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const ids = movedOrder(siblings.map((n) => n.id), noteId, targetOrder);
      await db.$transaction(
        ids.map((id, i) => db.note.update({ where: { id }, data: { order: i } })),
      );
    }
  }

  await normalizeNoteOrders(fromSectionId);
  const updated = await db.note.findUnique({ where: { id: noteId } });
  if (updated && updated.sectionId !== fromSectionId) {
    await normalizeNoteOrders(updated.sectionId);
  }
  const section = await db.section.findUnique({
    where: { id: updated?.sectionId ?? fromSectionId },
    select: { notebookId: true },
  });
  if (section) await bumpNotebook(section.notebookId);
  return NextResponse.json(
    updated
      ? {
          ...updated,
          ...(sourceDropped ? { sourceDropped: true } : {}),
          ...(keptAs ? { keptAs } : {}),
          ...(added.length > 0 ? { addedSourceIds: added } : {}),
        }
      : updated,
  );
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId: asked } = await ctx.params;
  // A gone note whose words a later write kept as a new note
  // (lib/notes/gone.ts): the delete is that note's, as every later write is.
  let noteId = asked;
  if (!(await db.note.findUnique({ where: { id: asked }, select: { id: true } }))) {
    const home = await goneHome(asked);
    if (home?.keptAs) noteId = home.keptAs;
  }
  const access = await noteAccess(noteId, "editor");
  if (access instanceof NextResponse) return access;
  // The note whole, sources, replies, edits, and side chats, for its
  // history event: History's Restore puts it back (lib/notes/removed.ts).
  const kept = await keepNote(noteId);
  const note = await db.note.delete({ where: { id: noteId } }).catch(() => null);
  if (!note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  await normalizeNoteOrders(note.sectionId);
  const section = await db.section.findUnique({
    where: { id: note.sectionId },
    select: { notebookId: true, title: true },
  });
  if (section) {
    // Deletions are corpus history (SPEC.md §12): the History panel shows who
    // removed what.
    await db.notebookEvent.create({
      data: {
        notebookId: section.notebookId,
        userId: access.user.id,
        kind: "NOTE_REMOVE",
        content: note.content.slice(0, 500),
        meta: { sectionTitle: section.title, ...(kept ? { kept: kept as unknown as Prisma.InputJsonValue } : {}) },
      },
    });
    await bumpNotebook(section.notebookId);
  }
  return NextResponse.json({ ok: true });
}
