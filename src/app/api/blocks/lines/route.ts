import { Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { followOrders } from "@/lib/block-order";
import { bumpDocument, documentAccess } from "@/lib/collab";
import { contentsEntries } from "@/lib/contents";
import { db } from "@/lib/db";
import { refreshSkeleton } from "@/lib/graph/skeleton";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
import { context, joined, joinRefusal, split, splitRefusal } from "@/lib/transcript-lines";
import { parseBody } from "@/lib/validate";
import { parseSpeakers } from "@/lib/video/types";

// A video's or an audio's transcript lines (SPEC.md §11): two lines next to
// each other joined into one, one line split into two, a line given to
// another voice, and a join or a split taken back. Each is recorded (a
// LINE_JOIN, LINE_SPLIT, or SPEAKER edit) with what its Undo needs to give
// the lines back as they were, anchors and all (lib/transcript-lines.ts).

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("join"), blockId: z.string().min(1), nextBlockId: z.string().min(1) }),
  z.object({ op: z.literal("split"), blockId: z.string().min(1), offset: z.number().int().min(1).max(50_000) }),
  // null: no voice (Undo of a line that had none).
  z.object({ op: z.literal("speaker"), blockId: z.string().min(1), speakerId: z.string().min(1).max(64).nullable() }),
  z.object({ op: z.literal("undo"), editId: z.string().min(1) }),
]);

// What a join or a split changed, as it stood before: the lines' fields and
// every anchor it moved, so the Undo puts each back as it was.
const lineFields = z.object({
  text: z.string(),
  originalText: z.string().nullable(),
  endTime: z.number().nullable(),
  styles: z.unknown(),
  links: z.unknown(),
  citations: z.unknown(),
});
const movedSource = z.object({
  id: z.string(),
  blockId: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  prefix: z.string(),
  suffix: z.string(),
});
const movedLink = z.object({
  id: z.string(),
  fromBlockId: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  prefix: z.string(),
  suffix: z.string(),
  toBlockId: z.string().nullable(),
  toStartOffset: z.number().nullable(),
  toEndOffset: z.number().nullable(),
  toPrefix: z.string().nullable(),
  toSuffix: z.string().nullable(),
});
const joinMeta = z.object({
  first: lineFields,
  second: lineFields.extend({
    id: z.string(),
    order: z.number(),
    startTime: z.number().nullable(),
    speaker: z.string().nullable(),
    html: z.string().nullable(),
    page: z.number().nullable(),
  }),
  sources: z.array(movedSource),
  docLinks: z.array(movedLink),
});
const splitMeta = z.object({ line: lineFields, newId: z.string(), sources: z.array(movedSource), docLinks: z.array(movedLink) });

/** A stored JSON value, null as the database's null. */
const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

const refuse = (t: TFunc, key: Parameters<TFunc>[0], status = 400) => NextResponse.json({ error: t(key) }, { status });

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  if (data.op === "undo") return undo(data.editId, t);

  const block = await db.block.findUnique({ where: { id: data.blockId } });
  if (!block) return refuse(t, "api.blockNotFound", 404);
  const access = await documentAccess(block.documentId, "editor");
  if (access instanceof NextResponse) return access;
  const userId = access.user.id;
  const documentId = block.documentId;
  const done = async (body: Record<string, unknown>) => {
    await bumpDocument(documentId);
    after(() => refreshSkeleton(documentId, userId).catch(() => {}));
    return NextResponse.json(body);
  };

  if (data.op === "speaker") {
    if (block.type !== "TRANSCRIPT") return refuse(t, "api.lineSpeakerLine");
    const asset = await db.videoAsset.findUnique({ where: { documentId }, select: { speakers: true } });
    const speakers = parseSpeakers(asset?.speakers);
    if (data.speakerId !== null && !speakers.some((s) => s.id === data.speakerId)) return refuse(t, "api.lineSpeakerUnknown");
    if (block.speaker === data.speakerId) return NextResponse.json({ previous: block.speaker });
    const name = (id: string | null) => speakers.find((s) => s.id === id)?.name ?? null;
    await db.$transaction([
      db.block.update({ where: { id: block.id }, data: { speaker: data.speakerId } }),
      db.blockEdit.create({
        data: {
          documentId,
          blockId: block.id,
          kind: "SPEAKER",
          before: block.speaker,
          after: data.speakerId,
          meta: { from: name(block.speaker), to: name(data.speakerId), quotedText: block.text.slice(0, 200) },
          userId,
        },
      }),
    ]);
    return done({ previous: block.speaker });
  }

  if (data.op === "join") {
    const next = await db.block.findUnique({ where: { id: data.nextBlockId } });
    if (!next || next.documentId !== documentId) return refuse(t, "api.blockNotFound", 404);
    const [between, document] = await Promise.all([
      db.block.count({ where: { documentId, order: { gt: block.order, lt: next.order } } }),
      db.document.findUnique({ where: { id: documentId }, select: { contents: true } }),
    ]);
    const chapterStarts = new Set(contentsEntries(document?.contents ?? null).map((e) => e.blockId));
    const refused = joinRefusal(block, next, next.order > block.order && between === 0, chapterStarts);
    if (refused) return refuse(t, refused);
    const one = joined(block, next);
    const [sources, docLinks] = await Promise.all([
      db.source.findMany({ where: { blockId: next.id } }),
      db.docLink.findMany({ where: { OR: [{ fromBlockId: next.id }, { toBlockId: next.id }] } }),
    ]);
    const edit = await db.$transaction(async (tx) => {
      await tx.block.update({
        where: { id: block.id },
        data: { text: one.text, endTime: one.endTime, styles: json(one.styles), links: json(one.links), citations: json(one.citations) },
      });
      await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" = ${block.id}`;
      // Every anchor on the second line follows its words; one on the
      // recording's time (a video anchor) names the line that holds it.
      for (const s of sources) {
        const text = s.startTime === null && s.layer === null;
        const start = text ? s.startOffset + one.shift : s.startOffset;
        const end = text ? s.endOffset + one.shift : s.endOffset;
        await tx.source.update({
          where: { id: s.id },
          data: { blockId: block.id, startOffset: start, endOffset: end, ...(text ? context(one.text, start, end) : {}) },
        });
      }
      for (const l of docLinks) {
        const from = l.fromBlockId === next.id;
        const to = l.toBlockId === next.id && l.toStartOffset !== null && l.toEndOffset !== null;
        await tx.docLink.update({
          where: { id: l.id },
          data: {
            ...(from
              ? { fromBlockId: block.id, startOffset: l.startOffset + one.shift, endOffset: l.endOffset + one.shift, ...context(one.text, l.startOffset + one.shift, l.endOffset + one.shift) }
              : {}),
            ...(l.toBlockId === next.id ? { toBlockId: block.id } : {}),
            ...(to
              ? (() => {
                  const c = context(one.text, l.toStartOffset! + one.shift, l.toEndOffset! + one.shift);
                  return { toStartOffset: l.toStartOffset! + one.shift, toEndOffset: l.toEndOffset! + one.shift, toPrefix: c.prefix, toSuffix: c.suffix };
                })()
              : {}),
          },
        });
      }
      await tx.block.delete({ where: { id: next.id } });
      return tx.blockEdit.create({
        data: {
          documentId,
          blockId: block.id,
          kind: "LINE_JOIN",
          before: `${block.text}\n${next.text}`,
          after: one.text,
          meta: {
            first: { text: block.text, originalText: block.originalText, endTime: block.endTime, styles: block.styles, links: block.links, citations: block.citations },
            second: {
              id: next.id,
              order: next.order,
              text: next.text,
              originalText: next.originalText,
              startTime: next.startTime,
              endTime: next.endTime,
              speaker: next.speaker,
              html: next.html,
              page: next.page,
              styles: next.styles,
              links: next.links,
              citations: next.citations,
            },
            sources: sources.map((s) => ({ id: s.id, blockId: s.blockId, startOffset: s.startOffset, endOffset: s.endOffset, prefix: s.prefix, suffix: s.suffix })),
            docLinks: docLinks.map(linkBefore),
          } as Prisma.InputJsonValue,
          userId,
        },
      });
    });
    return done({ editId: edit.id });
  }

  // split
  const [sources, docLinks] = await Promise.all([
    db.source.findMany({ where: { blockId: block.id } }),
    db.docLink.findMany({ where: { OR: [{ fromBlockId: block.id }, { toBlockId: block.id }] } }),
  ]);
  // The words anchored on the line: a note's or an annotation's, a link's ends.
  const textSources = sources.filter((s) => s.startTime === null && s.layer === null && !s.orphaned);
  const anchors = [
    ...textSources.map((s) => ({ start: s.startOffset, end: s.endOffset })),
    ...docLinks.filter((l) => l.fromBlockId === block.id && !l.fromOrphaned).map((l) => ({ start: l.startOffset, end: l.endOffset })),
    ...docLinks
      .filter((l) => l.toBlockId === block.id && !l.toOrphaned && l.toStartOffset !== null && l.toEndOffset !== null)
      .map((l) => ({ start: l.toStartOffset!, end: l.toEndOffset! })),
  ];
  const refused = splitRefusal(block, data.offset, anchors);
  if (refused) return refuse(t, refused);
  const two = split(block, data.offset);
  const movedSources = sources.filter((s) => (s.startTime === null && s.layer === null ? s.startOffset >= two.tailStart : s.startTime !== null && s.startTime >= two.time));
  const movedLinks = docLinks.filter(
    (l) => (l.fromBlockId === block.id && l.startOffset >= two.tailStart) || (l.toBlockId === block.id && l.toStartOffset !== null && l.toStartOffset >= two.tailStart),
  );
  const result = await db.$transaction(async (tx) => {
    // The new line stands right after the line: the blocks after it make room.
    await tx.block.updateMany({ where: { documentId, order: { gt: block.order } }, data: { order: { increment: 1 } } });
    await followOrders(tx, documentId, (at) => (at > block.order ? at + 1 : at));
    const created = await tx.block.create({
      data: {
        documentId,
        order: block.order + 1,
        type: "TRANSCRIPT",
        text: two.second.text,
        startTime: two.second.startTime,
        endTime: two.second.endTime,
        speaker: two.second.speaker,
        page: block.page,
        styles: json(two.second.styles),
        links: json(two.second.links),
        citations: json(two.second.citations),
      },
    });
    await tx.block.update({
      where: { id: block.id },
      data: { text: two.first.text, endTime: two.first.endTime, styles: json(two.first.styles), links: json(two.first.links), citations: json(two.first.citations) },
    });
    await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" = ${block.id}`;
    for (const s of movedSources) {
      const text = s.startTime === null && s.layer === null;
      const start = text ? s.startOffset - two.tailStart : s.startOffset;
      const end = text ? s.endOffset - two.tailStart : s.endOffset;
      await tx.source.update({
        where: { id: s.id },
        data: { blockId: created.id, startOffset: start, endOffset: end, ...(text ? context(two.second.text, start, end) : {}) },
      });
    }
    for (const l of movedLinks) {
      const from = l.fromBlockId === block.id && l.startOffset >= two.tailStart;
      const to = l.toBlockId === block.id && l.toStartOffset !== null && l.toEndOffset !== null && l.toStartOffset >= two.tailStart;
      await tx.docLink.update({
        where: { id: l.id },
        data: {
          ...(from
            ? {
                fromBlockId: created.id,
                startOffset: l.startOffset - two.tailStart,
                endOffset: l.endOffset - two.tailStart,
                ...context(two.second.text, l.startOffset - two.tailStart, l.endOffset - two.tailStart),
              }
            : {}),
          ...(to
            ? (() => {
                const c = context(two.second.text, l.toStartOffset! - two.tailStart, l.toEndOffset! - two.tailStart);
                return { toBlockId: created.id, toStartOffset: l.toStartOffset! - two.tailStart, toEndOffset: l.toEndOffset! - two.tailStart, toPrefix: c.prefix, toSuffix: c.suffix };
              })()
            : {}),
        },
      });
    }
    const edit = await tx.blockEdit.create({
      data: {
        documentId,
        blockId: block.id,
        kind: "LINE_SPLIT",
        before: block.text,
        after: `${two.first.text}\n${two.second.text}`,
        meta: {
          line: { text: block.text, originalText: block.originalText, endTime: block.endTime, styles: block.styles, links: block.links, citations: block.citations },
          newId: created.id,
          sources: movedSources.map((s) => ({ id: s.id, blockId: s.blockId, startOffset: s.startOffset, endOffset: s.endOffset, prefix: s.prefix, suffix: s.suffix })),
          docLinks: movedLinks.map(linkBefore),
        } as Prisma.InputJsonValue,
        userId,
      },
    });
    return { editId: edit.id, blockId: created.id };
  });
  return done(result);
}

type LinkRow = z.infer<typeof movedLink>;
const linkBefore = (l: LinkRow): LinkRow => ({
  id: l.id,
  fromBlockId: l.fromBlockId,
  startOffset: l.startOffset,
  endOffset: l.endOffset,
  prefix: l.prefix,
  suffix: l.suffix,
  toBlockId: l.toBlockId,
  toStartOffset: l.toStartOffset,
  toEndOffset: l.toEndOffset,
  toPrefix: l.toPrefix,
  toSuffix: l.toSuffix,
});

/** The lines as a join or a split found them, while they are still as it
    left them: each field, each anchor it moved, back as it was. */
async function undo(editId: string, t: TFunc) {
  const edit = await db.blockEdit.findUnique({ where: { id: editId } });
  if (!edit || !edit.blockId || (edit.kind !== "LINE_JOIN" && edit.kind !== "LINE_SPLIT")) return refuse(t, "api.lineUndoNone");
  const access = await documentAccess(edit.documentId, "editor");
  if (access instanceof NextResponse) return access;
  const documentId = edit.documentId;
  const line = await db.block.findUnique({ where: { id: edit.blockId } });
  const putBack = async (tx: Prisma.TransactionClient, sources: z.infer<typeof movedSource>[], docLinks: LinkRow[]) => {
    for (const { id, ...fields } of sources) await tx.source.update({ where: { id }, data: fields });
    for (const { id, ...fields } of docLinks) await tx.docLink.update({ where: { id }, data: fields });
  };
  const fields = (f: z.infer<typeof lineFields>) => ({
    text: f.text,
    originalText: f.originalText,
    endTime: f.endTime,
    styles: json(f.styles),
    links: json(f.links),
    citations: json(f.citations),
  });

  if (edit.kind === "LINE_JOIN") {
    const meta = joinMeta.safeParse(edit.meta);
    if (!meta.success) return refuse(t, "api.lineUndoNone");
    const { first, second, sources, docLinks } = meta.data;
    const taken = await db.block.findUnique({ where: { id: second.id }, select: { id: true } });
    if (!line || line.text !== edit.after || taken) return refuse(t, "api.lineChanged", 409);
    await db.$transaction(async (tx) => {
      await tx.block.update({ where: { id: line.id }, data: fields(first) });
      await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" = ${line.id}`;
      await tx.block.create({
        data: {
          id: second.id,
          documentId,
          order: second.order,
          type: "TRANSCRIPT",
          text: second.text,
          originalText: second.originalText,
          html: second.html,
          page: second.page,
          startTime: second.startTime,
          endTime: second.endTime,
          speaker: second.speaker,
          styles: json(second.styles),
          links: json(second.links),
          citations: json(second.citations),
        },
      });
      await putBack(tx, sources, docLinks);
      await tx.blockEdit.create({
        data: { documentId, blockId: line.id, kind: "LINE_SPLIT", before: edit.after, after: edit.before, meta: { undoes: edit.id }, userId: access.user.id },
      });
    });
  } else {
    const meta = splitMeta.safeParse(edit.meta);
    if (!meta.success) return refuse(t, "api.lineUndoNone");
    const { line: was, newId, sources, docLinks } = meta.data;
    const added = await db.block.findUnique({ where: { id: newId } });
    if (!line || !added || `${line.text}\n${added.text}` !== edit.after) return refuse(t, "api.lineChanged", 409);
    await db.$transaction(async (tx) => {
      await putBack(tx, sources, docLinks);
      await tx.block.delete({ where: { id: added.id } });
      await tx.block.updateMany({ where: { documentId, order: { gt: added.order } }, data: { order: { decrement: 1 } } });
      await followOrders(tx, documentId, (at) => (at > added.order ? at - 1 : at));
      await tx.block.update({ where: { id: line.id }, data: fields(was) });
      await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" = ${line.id}`;
      await tx.blockEdit.create({
        data: { documentId, blockId: line.id, kind: "LINE_JOIN", before: edit.after, after: edit.before, meta: { undoes: edit.id }, userId: access.user.id },
      });
    });
  }
  await bumpDocument(documentId);
  return NextResponse.json({ ok: true });
}
