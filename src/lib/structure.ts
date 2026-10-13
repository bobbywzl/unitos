import { z } from "zod";

// Structure (SPEC.md §32): the document's blocks sorted into buckets on a
// canvas — one new page made from an existing document. A bucket is one box:
// a title, a description, the pieces in it in order, and the buckets inside
// it. A piece is one block of the document placed in a bucket, with a label
// the reader or the assistant gives it. A connection joins two buckets or two
// pieces with a label and a comment. Stored on NotebookDocument.structure,
// one structure per document per project; the reader edits it by hand, and
// the structure assistant proposes a whole structure the reader applies.
// The blocks are the document's: a piece names its block by id, keeps the
// hash of the text it was placed with and its first words, so a block whose
// text changed still shows where the reader put it, and a block that is gone
// shows its kept words and says so.

export const STRUCTURE_VERSION = 1;

export const BUCKETS_MAX = 200;
export const PIECES_MAX = 5000;
export const CONNECTIONS_MAX = 1000;
const TEXT_MAX = 400;
const COMMENT_MAX = 2000;
const PREVIEW_CHARS = 160;

export type StructureEnd = { kind: "bucket" | "piece"; id: string };

/** The hues a bucket can carry: the highlight hues, and sky. */
export const BUCKET_HUES = ["clay", "sage", "gold", "plum", "sky"] as const;
export type BucketHue = (typeof BUCKET_HUES)[number];

export type StructureBucket = {
  id: string;
  title: string;
  description: string;
  /** The bucket this one sits in; null = the canvas. */
  parentId: string | null;
  /** The canvas position of a top bucket; a bucket inside another has none. */
  x: number;
  y: number;
  /** The bucket's hue, or null for none. */
  color: BucketHue | null;
  /** The bucket's place among its siblings: 0 first. */
  order: number;
};

export type StructurePiece = {
  /** The block the piece stands for. */
  blockId: string;
  /** The hash of the block text the piece was placed with. */
  hash: string;
  /** The first words of the block, kept so a gone block still shows. */
  preview: string;
  bucketId: string;
  /** The piece's place in its bucket: 0 first. */
  order: number;
  /** The label the reader or the assistant gave the piece; "" for none. */
  label: string;
};

export type StructureConnection = {
  id: string;
  from: StructureEnd;
  to: StructureEnd;
  label: string;
  comment: string;
  /** The assistant proposed it; false when the reader drew it. */
  byAssistant: boolean;
};

export type Structure = {
  v: number;
  /** Bumped by every save; a save names the rev it was built on. */
  rev: number;
  buckets: StructureBucket[];
  pieces: StructurePiece[];
  connections: StructureConnection[];
};

const idSchema = z.string().min(1).max(64);
const hueSchema = z.enum(BUCKET_HUES).nullable();

const endSchema = z.object({ kind: z.enum(["bucket", "piece"]), id: idSchema });

export const bucketSchema = z.object({
  id: idSchema,
  title: z.string().max(TEXT_MAX),
  description: z.string().max(COMMENT_MAX),
  parentId: idSchema.nullable(),
  x: z.number().finite(),
  y: z.number().finite(),
  color: hueSchema,
  order: z.number().int(),
});

export const pieceSchema = z.object({
  blockId: idSchema,
  hash: z.string().max(32),
  preview: z.string().max(PREVIEW_CHARS + 1),
  bucketId: idSchema,
  order: z.number().int(),
  label: z.string().max(TEXT_MAX),
});

export const connectionSchema = z.object({
  id: idSchema,
  from: endSchema,
  to: endSchema,
  label: z.string().max(TEXT_MAX),
  comment: z.string().max(COMMENT_MAX),
  byAssistant: z.boolean(),
});

/** The structure as the reader saves it (the rev is the server's). */
export const structureBodySchema = z.object({
  buckets: z.array(bucketSchema).max(BUCKETS_MAX),
  pieces: z.array(pieceSchema).max(PIECES_MAX),
  connections: z.array(connectionSchema).max(CONNECTIONS_MAX),
});

export type StructureBody = z.infer<typeof structureBodySchema>;

/** An empty structure: no bucket, every block unsorted. */
export function emptyStructure(): Structure {
  return { v: STRUCTURE_VERSION, rev: 0, buckets: [], pieces: [], connections: [] };
}

/** The stored structure, or an empty one when there is none or it is of
    another version. A row written by an older build keeps nothing it never
    had: every field has a default. */
export function readStructure(value: unknown): Structure {
  if (!value || typeof value !== "object") return emptyStructure();
  const row = value as Record<string, unknown>;
  if (row.v !== STRUCTURE_VERSION) return emptyStructure();
  const parsed = structureBodySchema.safeParse({
    buckets: Array.isArray(row.buckets) ? row.buckets : [],
    pieces: Array.isArray(row.pieces) ? row.pieces : [],
    connections: Array.isArray(row.connections) ? row.connections : [],
  });
  const body = parsed.success ? parsed.data : { buckets: [], pieces: [], connections: [] };
  return {
    v: STRUCTURE_VERSION,
    rev: typeof row.rev === "number" ? row.rev : 0,
    ...tidy(body),
  };
}

/** The hash of a block's text, as a piece keeps it: FNV-1a, 32 bits, so the
    browser computes it too (the skeleton's md5 needs node). It tells a piece
    its block's text changed since it was placed. */
export function pieceHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The first words of a block, for a piece's preview. */
export function piecePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/** A structure with every dangling reference dropped: a bucket whose parent
    is gone goes to the canvas, a piece whose bucket is gone is unsorted
    (dropped: an unsorted block is not stored), a connection to a gone end
    goes, a block placed twice keeps its first place, and a bucket inside
    itself goes to the canvas. */
export function tidy(body: StructureBody): StructureBody {
  const bucketIds = new Set(body.buckets.map((b) => b.id));
  const buckets: StructureBucket[] = [];
  const seenBuckets = new Set<string>();
  for (const b of body.buckets) {
    if (seenBuckets.has(b.id)) continue;
    seenBuckets.add(b.id);
    const parentId = b.parentId && bucketIds.has(b.parentId) && b.parentId !== b.id ? b.parentId : null;
    buckets.push({ ...b, parentId });
  }
  // A cycle of parents (a inside b inside a) breaks at its first bucket.
  const byId = new Map(buckets.map((b) => [b.id, b]));
  for (const b of buckets) {
    const seen = new Set<string>([b.id]);
    let p = b.parentId;
    while (p) {
      if (seen.has(p)) {
        b.parentId = null;
        break;
      }
      seen.add(p);
      p = byId.get(p)?.parentId ?? null;
    }
  }
  const pieces: StructurePiece[] = [];
  const seenBlocks = new Set<string>();
  for (const p of body.pieces) {
    if (seenBlocks.has(p.blockId) || !byId.has(p.bucketId)) continue;
    seenBlocks.add(p.blockId);
    pieces.push(p);
  }
  const ends = new Set<string>([
    ...buckets.map((b) => `bucket:${b.id}`),
    ...pieces.map((p) => `piece:${p.blockId}`),
  ]);
  const connections: StructureConnection[] = [];
  const seenConnections = new Set<string>();
  for (const c of body.connections) {
    if (seenConnections.has(c.id)) continue;
    if (!ends.has(`${c.from.kind}:${c.from.id}`) || !ends.has(`${c.to.kind}:${c.to.id}`)) continue;
    if (c.from.kind === c.to.kind && c.from.id === c.to.id) continue;
    seenConnections.add(c.id);
    connections.push(c);
  }
  return { buckets, pieces, connections };
}

/** The buckets inside one bucket (null: the canvas), in order. */
export function childBuckets(structure: StructureBody, parentId: string | null): StructureBucket[] {
  return structure.buckets.filter((b) => b.parentId === parentId).sort((a, b) => a.order - b.order);
}

/** The pieces of one bucket, in order. */
export function bucketPieces(structure: StructureBody, bucketId: string): StructurePiece[] {
  return structure.pieces.filter((p) => p.bucketId === bucketId).sort((a, b) => a.order - b.order);
}

/** The top bucket a bucket sits under (itself when it is on the canvas). */
export function topBucketOf(structure: StructureBody, bucketId: string): string {
  const byId = new Map(structure.buckets.map((b) => [b.id, b]));
  let id = bucketId;
  for (let i = 0; i < structure.buckets.length; i++) {
    const b = byId.get(id);
    if (!b || !b.parentId) return id;
    id = b.parentId;
  }
  return id;
}

/** A new id for a bucket or a connection: short, unique in this structure. */
export function newId(prefix: "b" | "c", taken: Set<string>): string {
  for (;;) {
    const id = `${prefix}${Math.random().toString(36).slice(2, 8)}`;
    if (!taken.has(id)) return id;
  }
}

// The default layout: new top buckets fill columns on the canvas, left to
// right, each column stacked. The assistant's proposal lands this way; the
// reader then drags them where they belong.
export const BUCKET_WIDTH = 360;
export const BUCKET_GAP = 40;
const LAYOUT_COLUMNS = 3;
// A piece row folded: its label and two lines of preview, with the gap.
const ROW_HEIGHT_PER_PIECE = 76;
// The header with a title and a description, and the row under the pieces.
const BUCKET_HEAD_HEIGHT = 130;
// Between columns: room for a connection's label between two buckets.
const COLUMN_GAP = 100;
const ROW_GAP = 60;
// A top bucket's body scrolls past this (bucket-box.tsx MAX_BODY), so its
// drawn height never passes head and body together.
const BODY_MAX = 560;

/** Places every top bucket with no position (x and y at 0 and never
    dragged): in columns, under the buckets already placed. */
export function placeNewBuckets(structure: StructureBody, placedIds: Set<string>): StructureBody {
  const tops = childBuckets(structure, null);
  const unplaced = tops.filter((b) => !placedIds.has(b.id));
  if (unplaced.length === 0) return structure;
  let baseY = 0;
  for (const b of tops) {
    if (placedIds.has(b.id)) baseY = Math.max(baseY, b.y + estimateHeight(structure, b.id) + ROW_GAP);
  }
  const columnY = Array.from({ length: LAYOUT_COLUMNS }, () => baseY);
  const positioned = new Map<string, { x: number; y: number }>();
  for (const b of unplaced) {
    let col = 0;
    for (let i = 1; i < LAYOUT_COLUMNS; i++) if (columnY[i] < columnY[col]) col = i;
    positioned.set(b.id, { x: col * (BUCKET_WIDTH + COLUMN_GAP), y: columnY[col] });
    columnY[col] += estimateHeight(structure, b.id) + ROW_GAP;
  }
  return {
    ...structure,
    buckets: structure.buckets.map((b) => (positioned.has(b.id) ? { ...b, ...positioned.get(b.id)! } : b)),
  };
}

/** A bucket's drawn height, roughly: its head, its pieces, and its buckets. */
export function estimateHeight(structure: StructureBody, bucketId: string): number {
  const pieces = structure.pieces.filter((p) => p.bucketId === bucketId).length;
  const children = childBuckets(structure, bucketId);
  const body = pieces * ROW_HEIGHT_PER_PIECE + children.reduce((sum, c) => sum + estimateHeight(structure, c.id) + 12, 0);
  return BUCKET_HEAD_HEIGHT + Math.min(body, BODY_MAX);
}
