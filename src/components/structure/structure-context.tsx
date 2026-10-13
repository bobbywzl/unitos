"use client";

import { createContext, useContext } from "react";
import { pieceHash, type BucketHue, type Structure, type StructureEnd } from "@/lib/structure";

// Breakwork (SPEC.md §32): what every part of the overlay reads — the
// structure as it stands, the document's blocks, the annotations on each
// block, and the operations that change the structure. The overlay owns the
// state (structure-overlay.tsx); the canvas, the buckets, the pieces, the
// tray, and the assistant box read it here.

export type StructureBlock = { id: string; type: string; text: string };

/** One annotation or note on a block, as the piece lists it. */
export type PieceAnnotation = {
  kind: "highlight" | "comment" | "explain" | "simplify" | "analyze" | "visualize" | "assistant" | "note";
  color: string | null;
  text: string;
  sourceId: string;
  noteId: string;
};

/** An AI tool's output on a piece, run from the overlay. */
export type PieceToolRun = {
  kind: "explain" | "simplify";
  text: string;
  streaming: boolean;
  error: string | null;
};

export type StructureOps = {
  addBucket: (parentId: string | null, title?: string) => string;
  renameBucket: (id: string, title: string) => void;
  describeBucket: (id: string, description: string) => void;
  colorBucket: (id: string, color: BucketHue | null) => void;
  removeBucket: (id: string) => void;
  /** Puts a bucket inside another (null: onto the canvas). */
  nestBucket: (id: string, parentId: string | null) => void;
  moveBucket: (id: string, x: number, y: number) => void;
  /** Places a block in a bucket at the index (the end when absent). */
  placeBlock: (blockId: string, bucketId: string, index?: number) => void;
  unplaceBlock: (blockId: string) => void;
  labelPiece: (blockId: string, label: string) => void;
  connect: (from: StructureEnd, to: StructureEnd) => string | null;
  updateConnection: (id: string, patch: { label?: string; comment?: string }) => void;
  removeConnection: (id: string) => void;
};

export type StructureContextValue = {
  structure: Structure;
  blocks: Map<string, StructureBlock>;
  /** The blocks in reading order (the sortable ones). */
  blockOrder: string[];
  annotationsByBlock: Record<string, PieceAnnotation[]>;
  canEdit: boolean;
  ops: StructureOps;
  /** The connection whose card is open. */
  selectedConnectionId: string | null;
  selectConnection: (id: string | null) => void;
  /** The block a drag carries, so drop targets can tell a piece from anything else. */
  dragging: { blockId: string } | null;
  setDragging: (d: { blockId: string } | null) => void;
  /** Closes the overlay and jumps to the block in the reader; with a source
      id, opens that annotation's card there. */
  openBlock: (blockId: string, sourceId?: string) => void;
  /** Runs Explain or Simplify on the whole block; the output shows under the piece. */
  runTool: (blockId: string, kind: "explain" | "simplify") => void;
  toolRuns: Record<string, PieceToolRun>;
};

const StructureContext = createContext<StructureContextValue | null>(null);

export const StructureProvider = StructureContext.Provider;

export function useStructure(): StructureContextValue {
  const value = useContext(StructureContext);
  if (!value) throw new Error("useStructure outside StructureProvider");
  return value;
}

/** The hash a piece keeps, for the browser: the block's text changed when it differs. */
export const pieceHashOf = pieceHash;

/** The drag's data type: a block moved between buckets and the tray. */
export const PIECE_DRAG_TYPE = "application/x-unitos-piece";

/** A handle's id on the canvas: its side, and the end it belongs to. */
export function handleId(side: "l" | "r", end: StructureEnd): string {
  return `${side}|${end.kind}|${end.id}`;
}

export function endOfHandle(handle: string | null | undefined): StructureEnd | null {
  if (!handle) return null;
  const [, kind, id] = handle.split("|");
  if ((kind !== "bucket" && kind !== "piece") || !id) return null;
  return { kind, id };
}

/** The bucket hues as CSS colors. */
export const BUCKET_HUE_VAR: Record<string, string> = {
  clay: "var(--clay-400)",
  sage: "var(--sage-500)",
  gold: "#d9a54a",
  plum: "#a78bfa",
  sky: "#5fa8d3",
};
