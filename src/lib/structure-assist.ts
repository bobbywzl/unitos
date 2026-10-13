import type { ModelMessage } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { STRUCTURE_EFFORT, STRUCTURE_HISTORY_MAX, STRUCTURE_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { loadProfile } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall } from "@/lib/feature-models";
import type { Lang } from "@/lib/i18n/config";
import { structurePrompt, structureSystem, type StructureBlockCtx, type StructureStateCtx } from "@/lib/prompts/structure";
import {
  BUCKETS_MAX,
  CONNECTIONS_MAX,
  newId,
  PIECES_MAX,
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
// structure. Nothing is stored here: the proposal goes back to the reader,
// who applies it or discards it; Apply is a PUT of the proposal.

// What the model answers. Block numbers, never ids; a connection's piece end
// is a block number as a string.
const endSchema = z.object({ kind: z.enum(["bucket", "piece"]), id: z.string().min(1).max(64) });
const answerSchema = z.object({
  reply: z.string().max(8_000).default(""),
  structure: z
    .object({
      buckets: z
        .array(
          z.object({
            id: z.string().min(1).max(64),
            title: z.string().max(400).default(""),
            description: z.string().max(2000).default(""),
            parentId: z.string().max(64).nullable().default(null),
          }),
        )
        .max(BUCKETS_MAX),
      pieces: z
        .array(
          z.object({
            n: z.number().int().positive(),
            bucketId: z.string().min(1).max(64),
            label: z.string().max(400).optional(),
          }),
        )
        .max(PIECES_MAX),
      connections: z
        .array(
          z.object({
            id: z.string().max(64).optional(),
            from: endSchema,
            to: endSchema,
            label: z.string().max(400).default(""),
            comment: z.string().max(2000).default(""),
          }),
        )
        .max(CONNECTIONS_MAX)
        .default([]),
      removeConnectionIds: z.array(z.string().max(64)).max(CONNECTIONS_MAX).default([]),
    })
    .nullable()
    .default(null),
});
type Answer = z.infer<typeof answerSchema>;

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

/** The blocks the assistant sorts: text, never a page marker or the video
    block. Numbered in reading order from 1. */
function readable<T extends { type: string; text: string }>(blocks: T[]): T[] {
  return blocks.filter((b) => b.type !== "VIDEO" && b.type !== "PAGE" && b.text.trim().length > 0);
}

/** The structure as the prompt lists it: block numbers in place of ids. */
function stateOf(structure: Structure, numberOf: Map<string, number>): StructureStateCtx {
  const endOf = (e: StructureEnd) => (e.kind === "piece" ? { kind: e.kind, id: String(numberOf.get(e.id) ?? e.id) } : e);
  return {
    buckets: structure.buckets.map((b) => ({ id: b.id, title: b.title, description: b.description, parentId: b.parentId })),
    pieces: structure.pieces
      .filter((p) => numberOf.has(p.blockId))
      .map((p) => ({ n: numberOf.get(p.blockId)!, bucketId: p.bucketId, label: p.label })),
    connections: structure.connections.map((c) => ({ ...c, from: endOf(c.from), to: endOf(c.to) })),
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
  const blocks = readable(document.blocks);
  const numberOf = new Map(blocks.map((b, i) => [b.id, i + 1]));
  const byNumber = new Map(blocks.map((b, i) => [i + 1, b]));
  const current = readStructure(attachment.structure);

  const listed: StructureBlockCtx[] = blocks.map((b, i) => ({ n: i + 1, type: b.type, text: b.text }));
  const history: ModelMessage[] = input.history
    .slice(-STRUCTURE_HISTORY_MAX)
    .filter((turn) => turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content }));
  const call = await featureCall("structure", STRUCTURE_EFFORT);
  const usage = { userId: input.userId, feature: "structure", model: call.modelId } satisfies UsageMeta;
  const result = await callForJson({
    model: call.model,
    messages: [
      { role: "system", content: structureSystem(document.title, listed) },
      ...history,
      {
        role: "user",
        content: structurePrompt({
          profile,
          lang: input.lang,
          documentTitle: document.title,
          state: stateOf(current, numberOf),
          blockCount: blocks.length,
          message: input.message,
        }),
      },
    ],
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

/** The model's structure as a real one: new bucket ids minted, block numbers
    turned into ids, a label the model left out kept from the current piece,
    positions kept for the buckets that stay and given to the new ones,
    reader-drawn connections kept, and everything dangling dropped (tidy).
    Exported for the check script. */
export function resolveProposal(
  answer: Answer,
  current: Structure,
  byNumber: Map<number, { id: string; type: string; text: string }>,
): StructureProposal {
  const draft = answer.structure!;
  const currentBuckets = new Map(current.buckets.map((b) => [b.id, b]));
  const taken = new Set(current.buckets.map((b) => [b.id][0]));
  // Bucket ids: an id given above stays; any other id is a new bucket.
  const bucketIdOf = new Map<string, string>();
  for (const b of draft.buckets) {
    if (bucketIdOf.has(b.id)) continue;
    if (currentBuckets.has(b.id)) bucketIdOf.set(b.id, b.id);
    else {
      const id = newId("b", taken);
      taken.add(id);
      bucketIdOf.set(b.id, id);
    }
  }
  const orderIn = new Map<string | null, number>();
  const buckets: StructureBucket[] = [];
  for (const b of draft.buckets) {
    const id = bucketIdOf.get(b.id)!;
    if (buckets.some((x) => x.id === id)) continue;
    const parentId = b.parentId ? (bucketIdOf.get(b.parentId) ?? null) : null;
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
  const orderInBucket = new Map<string, number>();
  const pieces: StructurePiece[] = [];
  for (const p of draft.pieces) {
    const block = byNumber.get(p.n);
    const bucketId = bucketIdOf.get(p.bucketId);
    if (!block || !bucketId) continue;
    const order = orderInBucket.get(bucketId) ?? 0;
    orderInBucket.set(bucketId, order + 1);
    const old = currentPieces.get(block.id);
    pieces.push({
      blockId: block.id,
      hash: pieceHash(block.text),
      preview: piecePreview(block.text),
      bucketId,
      order,
      label: (p.label ?? old?.label ?? "").trim(),
    });
  }
  const endOf = (e: { kind: "bucket" | "piece"; id: string }): StructureEnd | null => {
    if (e.kind === "bucket") {
      const id = bucketIdOf.get(e.id);
      return id ? { kind: "bucket", id } : null;
    }
    const block = byNumber.get(Number(e.id));
    return block ? { kind: "piece", id: block.id } : null;
  };
  const removed = new Set(draft.removeConnectionIds);
  const connectionTaken = new Set(current.connections.map((c) => c.id));
  const connections: StructureConnection[] = current.connections.filter((c) => !removed.has(c.id));
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
  }
  const placed = new Set(current.buckets.filter((b) => !b.parentId).map((b) => b.id));
  const structure = placeNewBuckets(tidy({ buckets, pieces, connections }), placed);
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
      connectionsAdded: structure.connections.filter((c) => !connectionTaken.has(c.id) || !current.connections.some((x) => x.id === c.id)).length,
      connectionsRemoved: current.connections.filter((c) => !afterConnections.has(c.id)).length,
    },
  };
}
