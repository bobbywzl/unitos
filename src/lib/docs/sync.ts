import { Prisma } from "@prisma/client";
import { diffSegments, remapAnchor } from "@/lib/anchors/remap";
import { resolveAnchor } from "@/lib/anchors/resolve";
import { db } from "@/lib/db";
import { deriveBlocks, ensureBlockIds, type DerivedBlock } from "@/lib/docs/blocks";
import { sanitizeRichText, type RichNode } from "@/lib/docs/schema";

// One save of a blank document (SPEC.md §29): the rich text is stored and its
// paragraph index — the document's Block rows — is brought in line with it in
// the same transaction. Every anchor on a paragraph whose words changed is
// remapped the way the block edit route remaps it; an anchor whose words left
// their paragraph (Enter split it, Backspace joined it, the paragraph was
// removed) is found again by its quote across the document, and orphans
// visibly only when its words are gone (SPEC.md §5).

/** Edits by one account to one paragraph within this long merge into one
    history row, so typing reads as one change, not one per save. */
const COALESCE_MS = 10 * 60 * 1000;

type OldBlock = {
  id: string;
  order: number;
  type: string;
  text: string;
  html: string | null;
  styles: Prisma.JsonValue;
  links: Prisma.JsonValue;
};

export type SyncOk = {
  ok: true;
  rev: number;
  /** The history row of each paragraph this save removed, by block id: the
      block routes answer with it, and undo restores through it. */
  removedEdits: Record<string, string>;
};
export type SyncConflict = { ok: false; reason: "rev"; rev: number; richText: RichNode | null };
export type SyncIdClash = { ok: false; reason: "ids"; ids: string[] };
/** A server-side edit that found nothing to change (its block is gone). */
export type SyncNoop = { ok: false; reason: "noop" };
export type SyncResult = SyncOk | SyncConflict | SyncIdClash | SyncNoop;

/** The kind a history row names for a block: paragraph, h1…h6, list, code. */
function kindOf(b: { type: string; html: string | null }): string {
  if (b.type === "HEADING") return `h${/^<h([1-6])/.exec(b.html ?? "")?.[1] ?? "2"}`;
  if (b.type === "LIST") return "list";
  if (b.type === "CODE") return "code";
  return "paragraph";
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

type Placed = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
  orphaned: boolean;
};

/** Where an anchor's words are after the save: remapped inside its own
    paragraph when that paragraph's words changed, else found again by its
    quote anywhere in the document; orphaned when neither works. */
function relocate(
  anchor: { blockId: string; startOffset: number; endOffset: number; quote: string; prefix: string; suffix: string },
  oldById: Map<string, OldBlock>,
  newById: Map<string, DerivedBlock>,
  newBlocks: { id: string; text: string }[],
): Placed {
  const before = oldById.get(anchor.blockId);
  const after = newById.get(anchor.blockId);
  if (before && after && before.text !== after.text) {
    const r = remapAnchor(diffSegments(before.text, after.text), after.text, {
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quotedText: anchor.quote,
    });
    if (!r.orphaned) return { blockId: anchor.blockId, ...r };
  }
  const found = resolveAnchor(newBlocks, {
    blockId: anchor.blockId,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    quotedText: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
  });
  if (found) return { ...found, orphaned: false };
  return {
    blockId: anchor.blockId,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    quotedText: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    orphaned: true,
  };
}

/** Store a blank document's rich text and bring its Block rows in line.
    Either `richText` — the editor's copy, which must start from `baseRev` —
    or `edit`, a server-side change applied to the stored text under the
    same lock, so an editor save and a server edit never overwrite each
    other. */
export async function syncRichText({
  documentId,
  userId,
  baseRev,
  richText: given,
  edit,
}: {
  documentId: string;
  userId: string;
  baseRev: number | null;
  richText?: RichNode;
  edit?: (current: RichNode) => RichNode | null;
}): Promise<SyncResult> {
  return db.$transaction(
    async (tx) => {
      // One save at a time per document: the row lock orders them.
      const [locked] = await tx.$queryRaw<{ richTextRev: number }[]>`
        SELECT "richTextRev" FROM "Document" WHERE "id" = ${documentId} FOR UPDATE`;
      if (!locked) throw new Error("document not found");
      let richText = given ?? null;
      if (edit) {
        const current = await tx.document.findUnique({ where: { id: documentId }, select: { richText: true } });
        const next = current?.richText ? edit(current.richText as unknown as RichNode) : null;
        richText = next ? sanitizeRichText(ensureBlockIds(next)) : null;
        if (!richText) return { ok: false as const, reason: "noop" as const };
      }
      if (!richText) return { ok: false as const, reason: "noop" as const };
      const derived = deriveBlocks(richText);
      if (baseRev !== null && locked.richTextRev !== baseRev) {
        const current = await tx.document.findUnique({ where: { id: documentId }, select: { richText: true } });
        return {
          ok: false as const,
          reason: "rev" as const,
          rev: locked.richTextRev,
          richText: (current?.richText ?? null) as RichNode | null,
        };
      }

      const old = await tx.block.findMany({
        where: { documentId },
        orderBy: { order: "asc" },
        select: { id: true, order: true, type: true, text: true, html: true, styles: true, links: true },
      });
      const oldById = new Map<string, OldBlock>(old.map((b) => [b.id, b]));
      const newById = new Map(derived.map((d) => [d.id, d]));

      const created = derived
        .map((d, order) => ({ d, order }))
        .filter(({ d }) => !oldById.has(d.id));
      // A new paragraph's id must be new everywhere: a pasted node can carry
      // an id from another document. The editor gives those nodes fresh ids
      // and saves again.
      if (created.length > 0) {
        const taken = await tx.block.findMany({
          where: { id: { in: created.map(({ d }) => d.id) } },
          select: { id: true },
        });
        if (taken.length > 0) return { ok: false as const, reason: "ids" as const, ids: taken.map((b) => b.id) };
      }
      const removed = old.filter((b) => !newById.has(b.id));
      const kept: { d: DerivedBlock; order: number; before: OldBlock }[] = [];
      derived.forEach((d, order) => {
        const before = oldById.get(d.id);
        if (before) kept.push({ d, order, before });
      });
      const textChanged = kept.filter((k) => k.before.text !== k.d.text);
      const formatChanged = kept.filter(
        (k) => k.before.type !== k.d.type || (k.before.html ?? null) !== (k.d.html ?? null),
      );
      const contentChanged = kept.filter(
        (k) =>
          k.before.text !== k.d.text ||
          k.before.type !== k.d.type ||
          (k.before.html ?? null) !== (k.d.html ?? null) ||
          !sameJson(k.before.styles, k.d.styles) ||
          !sameJson(k.before.links, k.d.links),
      );
      const moved = kept.filter((k) => k.before.order !== k.order);

      // Anchors on paragraphs whose words changed or left.
      const affected = [...textChanged.map((k) => k.d.id), ...removed.map((b) => b.id)];
      const newBlocks = derived.map((d) => ({ id: d.id, text: d.text }));
      if (affected.length > 0) {
        const [sources, links] = await Promise.all([
          tx.source.findMany({
            where: { blockId: { in: affected }, orphaned: false, layer: null, startTime: null },
          }),
          tx.docLink.findMany({
            where: { OR: [{ fromBlockId: { in: affected } }, { toBlockId: { in: affected } }] },
          }),
        ]);
        for (const src of sources) {
          const quote = src.anchoredText ?? src.quotedText;
          const placed = relocate(
            { blockId: src.blockId, startOffset: src.startOffset, endOffset: src.endOffset, quote, prefix: src.prefix, suffix: src.suffix },
            oldById,
            newById,
            newBlocks,
          );
          await tx.source.update({
            where: { id: src.id },
            data: placed.orphaned
              ? { orphaned: true }
              : {
                  blockId: placed.blockId,
                  startOffset: placed.startOffset,
                  endOffset: placed.endOffset,
                  // The quote never changes (SPEC.md §5); the words the
                  // anchor covers now ride anchoredText.
                  anchoredText: placed.quotedText === src.quotedText ? null : placed.quotedText,
                  prefix: placed.prefix,
                  suffix: placed.suffix,
                },
          });
        }
        const touched = new Set(affected);
        for (const link of links) {
          if (touched.has(link.fromBlockId) && link.fromDocumentId === documentId && !link.fromOrphaned) {
            const placed = relocate(
              { blockId: link.fromBlockId, startOffset: link.startOffset, endOffset: link.endOffset, quote: link.quotedText, prefix: link.prefix, suffix: link.suffix },
              oldById,
              newById,
              newBlocks,
            );
            await tx.docLink.update({
              where: { id: link.id },
              data: placed.orphaned
                ? { fromOrphaned: true }
                : {
                    fromBlockId: placed.blockId,
                    startOffset: placed.startOffset,
                    endOffset: placed.endOffset,
                    quotedText: placed.quotedText,
                    prefix: placed.prefix,
                    suffix: placed.suffix,
                  },
            });
          }
          if (
            link.toBlockId &&
            touched.has(link.toBlockId) &&
            link.toDocumentId === documentId &&
            !link.toOrphaned &&
            link.toStartOffset !== null &&
            link.toEndOffset !== null &&
            link.toQuotedText !== null
          ) {
            const placed = relocate(
              {
                blockId: link.toBlockId,
                startOffset: link.toStartOffset,
                endOffset: link.toEndOffset,
                quote: link.toQuotedText,
                prefix: link.toPrefix ?? "",
                suffix: link.toSuffix ?? "",
              },
              oldById,
              newById,
              newBlocks,
            );
            await tx.docLink.update({
              where: { id: link.id },
              data: placed.orphaned
                ? { toOrphaned: true }
                : {
                    toBlockId: placed.blockId,
                    toStartOffset: placed.startOffset,
                    toEndOffset: placed.endOffset,
                    toQuotedText: placed.quotedText,
                    toPrefix: placed.prefix,
                    toSuffix: placed.suffix,
                  },
            });
          }
        }
      }

      // The rows themselves.
      if (removed.length > 0) {
        await tx.block.deleteMany({ where: { id: { in: removed.map((b) => b.id) } } });
      }
      if (created.length > 0) {
        await tx.block.createMany({
          data: created.map(({ d, order }) => ({
            id: d.id,
            documentId,
            order,
            type: d.type,
            text: d.text,
            html: d.html,
            styles: d.styles as unknown as Prisma.InputJsonValue,
            links: d.links as unknown as Prisma.InputJsonValue,
            // User-authored, like an inserted paragraph.
            originalText: "",
          })),
        });
      }
      for (const { d } of contentChanged) {
        await tx.block.update({
          where: { id: d.id },
          data: {
            text: d.text,
            type: d.type,
            html: d.html,
            styles: d.styles as unknown as Prisma.InputJsonValue,
            links: d.links as unknown as Prisma.InputJsonValue,
          },
        });
      }
      if (moved.length > 0) {
        const rows = Prisma.join(moved.map((k) => Prisma.sql`(${k.d.id}, ${k.order}::int)`));
        await tx.$executeRaw`
          UPDATE "Block" AS b SET "order" = v.o FROM (VALUES ${rows}) AS v(id, o) WHERE b."id" = v.id`;
      }
      if (textChanged.length > 0) {
        // The search vector no longer matches the words; the next search re-embeds.
        const ids = Prisma.join(textChanged.map((k) => k.d.id));
        await tx.$executeRaw`UPDATE "Block" SET "embedding" = NULL WHERE "id" IN (${ids})`;
      }

      // The history (SPEC.md §12): one row per paragraph added, removed,
      // retyped, or restyled — typing merges into the account's last row for
      // the paragraph while it is fresh.
      const since = new Date(Date.now() - COALESCE_MS);
      const touchedIds = [...removed.map((b) => b.id), ...textChanged.map((k) => k.d.id), ...formatChanged.map((k) => k.d.id)];
      const recent =
        touchedIds.length > 0
          ? await tx.blockEdit.findMany({
              where: { documentId, userId, blockId: { in: touchedIds }, createdAt: { gte: since } },
              orderBy: { createdAt: "desc" },
            })
          : [];
      const latest = new Map<string, (typeof recent)[number]>();
      for (const edit of recent) if (edit.blockId && !latest.has(edit.blockId)) latest.set(edit.blockId, edit);

      for (const { d } of created) {
        await tx.blockEdit.create({
          data: { documentId, blockId: d.id, kind: "BLOCK_ADD", after: d.text, userId },
        });
      }
      const removedEdits: Record<string, string> = {};
      for (const b of removed) {
        const last = latest.get(b.id);
        if (last && last.kind === "BLOCK_ADD") {
          // Added and taken away while fresh: nothing to keep.
          await tx.blockEdit.deleteMany({ where: { documentId, blockId: b.id, userId, createdAt: { gte: since } } });
          continue;
        }
        const removal = await tx.blockEdit.create({
          data: {
            documentId,
            blockId: b.id,
            kind: "BLOCK_REMOVE",
            before: b.text,
            meta: { order: b.order, type: b.type, html: b.html, originalText: "" },
            userId,
          },
        });
        removedEdits[b.id] = removal.id;
      }
      for (const { d, before } of textChanged) {
        const last = latest.get(d.id);
        if (last && (last.kind === "TEXT_EDIT" || last.kind === "BLOCK_ADD")) {
          await tx.blockEdit.update({ where: { id: last.id }, data: { after: d.text } });
        } else {
          await tx.blockEdit.create({
            data: { documentId, blockId: d.id, kind: "TEXT_EDIT", before: before.text, after: d.text, userId },
          });
        }
      }
      for (const { d, before } of formatChanged) {
        const from = kindOf(before);
        const to = kindOf(d);
        if (from === to) continue;
        const last = latest.get(d.id);
        if (last && last.kind === "FORMAT") {
          await tx.blockEdit.update({ where: { id: last.id }, data: { after: to, meta: { from: last.before, to } } });
        } else {
          await tx.blockEdit.create({
            data: { documentId, blockId: d.id, kind: "FORMAT", before: from, after: to, meta: { from, to }, userId },
          });
        }
      }

      const saved = await tx.document.update({
        where: { id: documentId },
        data: { richText: richText as unknown as Prisma.InputJsonValue, richTextRev: { increment: 1 } },
        select: { richTextRev: true },
      });
      return { ok: true as const, rev: saved.richTextRev, removedEdits };
    },
    { timeout: 30_000, maxWait: 15_000 },
  );
}
