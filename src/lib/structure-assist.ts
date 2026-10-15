import type { ModelMessage } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  STRUCTURE_EFFORT,
  STRUCTURE_HISTORY_MAX,
  STRUCTURE_MAX_OUTPUT_TOKENS,
  STRUCTURE_READ_CHARS,
} from "@/lib/derive/config";
import { loadProfile } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall } from "@/lib/feature-models";
import type { Lang } from "@/lib/i18n/config";
import { structurePrompt, structureSystem, type StructureBlockCtx, type StructureStateCtx } from "@/lib/prompts/structure";
import type { ReaderProfileCtx } from "@/lib/prompts/types";
import {
  BUCKETS_MAX,
  CONNECTIONS_MAX,
  joinsOwnBucket,
  newId,
  parseRanges,
  pieceHash,
  piecePreview,
  placeNewBuckets,
  readStructure,
  tidy,
  type Structure,
  type StructureBody,
  type StructureBucket,
  type StructureConnection,
  type StructureEnd,
  type StructurePiece,
} from "@/lib/structure";
import type { UsageMeta } from "@/lib/usage";

// The Breakwork assistant (SPEC.md §32): one turn of the conversation over
// a document's structure. The model reads the document whole (every block
// numbered), the structure as it stands, the turns so far, and the reader's
// message, and answers with a reply and, when asked for one, the whole
// structure: each bucket with its blocks as ranges of block numbers, so the
// answer stays a few hundred tokens whatever the document's length. Nothing
// is stored here: the proposal goes back to the reader, who applies it or
// discards it; Apply is a PUT of the proposal.

// What the model answers. Block numbers, never ids. A loose shape on
// purpose: a field the model leaves out takes its default, a number written
// as a string reads as the number, and resolveProposal drops what names
// nothing — a near miss is a structure, not a failed turn.
const textOf = (max: number) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? "" : String(v).slice(0, max)));
const answerSchema = z.object({
  reply: textOf(8_000),
  structure: z
    .object({
      buckets: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).transform((v) => String(v).trim().slice(0, 64)),
            title: textOf(400),
            description: textOf(2_000),
            parent: z
              .union([z.string(), z.number()])
              .nullish()
              .transform((v) => (v === null || v === undefined || v === "" || v === "null" ? null : String(v).trim())),
            blocks: z
              .union([z.string(), z.array(z.union([z.string(), z.number()]))])
              .nullish()
              .transform((v) => (Array.isArray(v) ? v.join(", ") : (v ?? ""))),
          }),
        )
        .max(BUCKETS_MAX),
      labels: z.record(z.string(), textOf(400)).nullish().transform((v) => v ?? {}),
      connections: z
        .array(
          z.object({
            id: z.string().max(64).nullish(),
            from: z.string().max(80),
            to: z.string().max(80),
            label: textOf(400),
            comment: textOf(2_000),
          }),
        )
        .max(CONNECTIONS_MAX)
        .nullish()
        .transform((v) => v ?? []),
      removeConnections: z
        .array(z.string().max(64))
        .max(CONNECTIONS_MAX)
        .nullish()
        .transform((v) => v ?? []),
    })
    .nullish()
    .transform((v) => v ?? null),
});
export type StructureAnswer = z.infer<typeof answerSchema>;
export { answerSchema as structureAnswerSchema };

export type StructureProposal = {
  /** The structure as it would stand after Apply. */
  structure: StructureBody;
  /** What changes against the structure the turn read. */
  summary: { bucketsAdded: number; bucketsRemoved: number; piecesMoved: number; connectionsAdded: number; connectionsRemoved: number };
};

export type StructureTurnResult = {
  reply: string;
  proposal: StructureProposal | null;
};

export type StructureTurn = { role: "user" | "assistant"; content: string };

export type StructureDocBlock = { id: string; type: string; text: string };

/** The blocks the assistant sorts: text, never a page marker or the video
    block. Numbered in reading order from 1. */
export function readableBlocks<T extends { type: string; text: string }>(blocks: T[]): T[] {
  return blocks.filter((b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0);
}

/** The structure as the prompt lists it: block numbers in place of ids. */
function stateOf(structure: Structure, numberOf: Map<string, number>): StructureStateCtx {
  const endOf = (e: StructureEnd) => (e.kind === "piece" ? { kind: e.kind, id: String(numberOf.get(e.id) ?? e.id) } : e);
  return {
    buckets: structure.buckets.map((b) => ({ id: b.id, title: b.title, description: b.description, parentId: b.parentId })),
    pieces: structure.pieces
      .filter((p) => numberOf.has(p.blockId))
      .sort((a, b) => (a.bucketId === b.bucketId ? a.order - b.order : 0))
      .map((p) => ({ n: numberOf.get(p.blockId)!, bucketId: p.bucketId, label: p.label })),
    connections: structure.connections.map((c) => ({ ...c, from: endOf(c.from), to: endOf(c.to) })),
  };
}

/** The blocks as the system message lists them, under STRUCTURE_READ_CHARS
    in all: when the document is longer, every block past its fair share is
    cut to its opening words, so no block goes unread. */
function listedBlocks(blocks: StructureDocBlock[]): { listed: StructureBlockCtx[]; cut: boolean } {
  const total = blocks.reduce((sum, b) => sum + b.text.length, 0);
  if (total <= STRUCTURE_READ_CHARS) {
    return { listed: blocks.map((b, i) => ({ n: i + 1, type: b.type, text: b.text.replace(/\s+/g, " ").trim() })), cut: false };
  }
  // The share each block may keep: the largest cap under which the total fits.
  const lengths = blocks.map((b) => b.text.length).sort((a, b) => a - b);
  let cap = 0;
  let used = 0;
  for (let i = 0; i < lengths.length; i++) {
    const rest = lengths.length - i;
    const next = Math.floor((STRUCTURE_READ_CHARS - used) / rest);
    if (lengths[i] > next) {
      cap = next;
      break;
    }
    used += lengths[i];
    cap = lengths[i];
  }
  cap = Math.max(120, cap);
  return {
    listed: blocks.map((b, i) => {
      const flat = b.text.replace(/\s+/g, " ").trim();
      return { n: i + 1, type: b.type, text: flat.length > cap ? `${flat.slice(0, cap)}…` : flat };
    }),
    cut: true,
  };
}

/** The messages of one turn, as the route sends them: the document (the
    cached system message), the turns so far, and the prompt. The eval loop
    builds the same messages (scripts/eval/structure/run.ts). */
export function structureMessages(input: {
  title: string;
  blocks: StructureDocBlock[];
  structure: Structure;
  profile: ReaderProfileCtx;
  lang: Lang;
  history: StructureTurn[];
  message: string;
}): { messages: ModelMessage[]; byNumber: Map<number, StructureDocBlock> } {
  const blocks = readableBlocks(input.blocks);
  const numberOf = new Map(blocks.map((b, i) => [b.id, i + 1]));
  const byNumber = new Map(blocks.map((b, i) => [i + 1, b]));
  const { listed, cut } = listedBlocks(blocks);
  const history: ModelMessage[] = input.history
    .slice(-STRUCTURE_HISTORY_MAX)
    .filter((turn) => turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
  return {
    byNumber,
    messages: [
      {
        role: "system",
        content: structureSystem(input.title, listed),
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      ...history,
      {
        role: "user",
        content: structurePrompt({
          profile: input.profile,
          lang: input.lang,
          documentTitle: input.title,
          state: stateOf(input.structure, numberOf),
          blockCount: blocks.length,
          cut,
          message: input.message,
        }),
      },
    ],
  };
}

export async function structureTurn(input: {
  notebookId: string;
  documentId: string;
  userId: string | null;
  lang: Lang;
  message: string;
  history: StructureTurn[];
  signal?: AbortSignal;
  onFailure: (reason: string) => Error;
}): Promise<StructureTurnResult> {
  const [document, attachment, profile] = await Promise.all([
    db.document.findUnique({
      where: { id: input.documentId },
      select: {
        title: true,
        blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } },
      },
    }),
    db.notebookDocument.findUnique({
      where: { notebookId_documentId: { notebookId: input.notebookId, documentId: input.documentId } },
      select: { structure: true },
    }),
    loadProfile(input.notebookId),
  ]);
  if (!document || !attachment) throw input.onFailure("document not attached");
  const current = readStructure(attachment.structure);
  const { messages, byNumber } = structureMessages({
    title: document.title,
    blocks: document.blocks,
    structure: current,
    profile,
    lang: input.lang,
    history: input.history,
    message: input.message,
  });
  const call = await featureCall("structure", STRUCTURE_EFFORT);
  const usage = { userId: input.userId, feature: "structure", model: call.modelId } satisfies UsageMeta;
  const result = await callForJson({
    model: call.model,
    messages,
    maxOutputTokens: STRUCTURE_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: answerSchema,
    label: "STRUCTURE",
    usage,
    abortSignal: input.signal,
  });
  if (!result.ok) throw input.onFailure(result.error);
  const answer = result.data;
  const proposal = answer.structure ? resolveProposal(answer, current, byNumber) : null;
  return { reply: answer.reply.trim(), proposal };
}

/** A connection end as the model writes it: "bucket new1", "block 12", or a
    bare number (a block) or id (a bucket). */
function readEnd(text: string): { kind: "bucket" | "piece"; id: string } | null {
  const t = text.trim();
  const m = t.match(/^(bucket|block|piece)\s+(.+)$/i);
  if (m) return { kind: m[1].toLowerCase() === "bucket" ? "bucket" : "piece", id: m[2].trim() };
  if (/^\d+$/.test(t)) return { kind: "piece", id: t };
  return t ? { kind: "bucket", id: t } : null;
}

/** The model's structure as a real one: new bucket ids minted, block ranges
    turned into block ids, a label the model left out kept from the current
    piece, positions kept for the buckets that stay and given to the new
    ones, reader-drawn connections kept, and everything dangling dropped
    (tidy). Exported for the check script and the eval loop. */
export function resolveProposal(
  answer: StructureAnswer,
  current: Structure,
  byNumber: Map<number, { id: string; type: string; text: string }>,
): StructureProposal {
  const draft = answer.structure!;
  const max = Math.max(0, ...byNumber.keys());
  const currentBuckets = new Map(current.buckets.map((b) => [b.id, b]));
  const taken = new Set(current.buckets.map((b) => b.id));
  // Bucket ids: an id given above stays; any other id is a new bucket.
  const bucketIdOf = new Map<string, string>();
  for (const b of draft.buckets) {
    if (!b.id || bucketIdOf.has(b.id)) continue;
    if (currentBuckets.has(b.id)) bucketIdOf.set(b.id, b.id);
    else {
      const id = newId("b", taken);
      taken.add(id);
      bucketIdOf.set(b.id, id);
    }
  }
  const orderIn = new Map<string | null, number>();
  const buckets: StructureBucket[] = [];
  const seenBuckets = new Set<string>();
  for (const b of draft.buckets) {
    const id = bucketIdOf.get(b.id);
    if (!id || seenBuckets.has(id)) continue;
    seenBuckets.add(id);
    const parentId = b.parent ? (bucketIdOf.get(b.parent) ?? null) : null;
    const old = currentBuckets.get(id);
    const order = orderIn.get(parentId) ?? 0;
    orderIn.set(parentId, order + 1);
    buckets.push({
      id,
      title: b.title.trim() || old?.title || "",
      description: b.description.trim(),
      parentId,
      x: old?.x ?? 0,
      y: old?.y ?? 0,
      color: old?.color ?? null,
      order,
    });
  }
  const currentPieces = new Map(current.pieces.map((p) => [p.blockId, p]));
  const pieces: StructurePiece[] = [];
  const placed = new Set<number>();
  for (const b of draft.buckets) {
    const bucketId = bucketIdOf.get(b.id);
    if (!bucketId) continue;
    let order = pieces.filter((p) => p.bucketId === bucketId).length;
    for (const n of parseRanges(b.blocks, max)) {
      const block = byNumber.get(n);
      if (!block || placed.has(n)) continue;
      placed.add(n);
      const old = currentPieces.get(block.id);
      pieces.push({
        blockId: block.id,
        hash: pieceHash(block.text),
        preview: piecePreview(block.text),
        bucketId,
        order: order++,
        label: (draft.labels[String(n)] ?? old?.label ?? "").trim(),
      });
    }
  }
  const endOf = (text: string): StructureEnd | null => {
    const e = readEnd(text);
    if (!e) return null;
    if (e.kind === "bucket") {
      const id = bucketIdOf.get(e.id) ?? (currentBuckets.has(e.id) ? e.id : undefined);
      return id ? { kind: "bucket", id } : null;
    }
    const block = byNumber.get(Number(e.id));
    return block ? { kind: "piece", id: block.id } : null;
  };
  const removed = new Set(draft.removeConnections);
  const connectionTaken = new Set(current.connections.map((c) => c.id));
  // A connection the reader drew stays unless named for removal; one the
  // assistant drew stays too, as the prompt says.
  const connections: StructureConnection[] = current.connections.filter((c) => !removed.has(c.id)).map((c) => ({ ...c }));
  let added = 0;
  for (const c of draft.connections) {
    const from = endOf(c.from);
    const to = endOf(c.to);
    if (!from || !to) continue;
    const existing = c.id ? connections.find((x) => x.id === c.id) : undefined;
    if (existing) {
      existing.from = from;
      existing.to = to;
      existing.label = c.label.trim();
      existing.comment = c.comment.trim();
      continue;
    }
    const id = newId("c", connectionTaken);
    connectionTaken.add(id);
    connections.push({ id, from, to, label: c.label.trim(), comment: c.comment.trim(), byAssistant: true });
    added++;
  }
  const keptTops = new Set(current.buckets.filter((b) => !b.parentId).map((b) => b.id));
  const tidied = tidy({ buckets, pieces, connections });
  // A new connection of the assistant's from a block to the bucket that
  // holds it draws nothing new: it drops. The reader's own stay.
  const before = new Set(current.connections.map((c) => c.id));
  const kept = tidied.connections.filter((c) => before.has(c.id) || !joinsOwnBucket(tidied, c));
  added -= tidied.connections.length - kept.length;
  const structure = placeNewBuckets({ ...tidied, connections: kept }, keptTops);
  const afterBuckets = new Set(structure.buckets.map((b) => b.id));
  const afterPieces = new Map(structure.pieces.map((p) => [p.blockId, p.bucketId]));
  const afterConnections = new Set(structure.connections.map((c) => c.id));
  let piecesMoved = 0;
  for (const [blockId, bucketId] of afterPieces) if (currentPieces.get(blockId)?.bucketId !== bucketId) piecesMoved++;
  for (const p of current.pieces) if (!afterPieces.has(p.blockId)) piecesMoved++;
  return {
    structure,
    summary: {
      bucketsAdded: structure.buckets.filter((b) => !currentBuckets.has(b.id)).length,
      bucketsRemoved: current.buckets.filter((b) => !afterBuckets.has(b.id)).length,
      piecesMoved,
      connectionsAdded: Math.min(added, structure.connections.length),
      connectionsRemoved: current.connections.filter((c) => !afterConnections.has(c.id)).length,
    },
  };
}
