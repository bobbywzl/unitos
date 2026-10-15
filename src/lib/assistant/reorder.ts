import { z } from "zod";

// The order pass (SPEC.md §7): a change that moves blocks across the whole
// document — group by theme, put in order, organize — read in one model call
// over the whole document, since the windows of a revise or a suggest action
// (lib/assistant/revise.ts, lib/derive/suggest.ts) each see only their part.
// The model answers with the new order of the scope's blocks and the new
// headings between them; this file turns that order into the fewest moves.
// A block is moved, never written anew: its words, its id, and every anchor
// on it go with it. A block the answer leaves out stays, after the block it
// followed; only a heading the answer names goes. Pure: the plan card's
// block actions (lib/assistant/reorder-run.ts) and the page editor's
// suggestions (components/docs/suggest/assistant.ts) read the same order.

const HEADING_MAX = 200;
const WHY_MAX = 240;

/** One entry of the new order: a block of the document by its id, a new
    heading, or new blocks written as markdown (the one pass, lib/assistant/one-pass.ts). */
export type OrderEntry = { blockId: string } | { heading: string; level: 1 | 2 | 3 } | { markdown: string };

const entrySchema = z.union([
  z.string().trim().min(1).max(64).transform((blockId): OrderEntry => ({ blockId })),
  z
    .object({ blockId: z.string().trim().min(1).max(64) })
    .transform((e): OrderEntry => ({ blockId: e.blockId })),
  z
    .object({
      heading: z.string().trim().min(1).max(HEADING_MAX),
      level: z.preprocess((v) => (typeof v === "string" ? Number(v.replace(/^h/i, "")) : v), z.number().int().min(1).max(3)).catch(2),
    })
    .transform((e): OrderEntry => ({ heading: e.heading, level: e.level as 1 | 2 | 3 })),
]);

/** The model's answer: one sentence on what the order does, the new order,
    and the headings that go. An entry that does not read is left out, and
    the block it named stays where it was. */
export const orderAnswerSchema = z.object({
  summary: z.string().catch("").transform((s) => s.trim().slice(0, 400)),
  order: z.array(z.unknown()).transform((items) => items.flatMap((item) => {
    const parsed = entrySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  })),
  removeHeadings: z.array(z.unknown()).catch([]).optional().transform((ids) => (ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)),
  why: z.string().catch("").optional().transform((s) => (s ?? "").trim().slice(0, WHY_MAX)),
});
export type OrderAnswer = z.infer<typeof orderAnswerSchema>;

/** A unit: what moves as one. In a document without rich text, one block;
    in a document with rich text, one top-level node (a list or a table
    moves whole), its rows in order. */
export type OrderUnit = {
  rowIds: string[];
  /** It keeps its place: a page, a figure, the footnotes. */
  fixed: boolean;
  /** One heading row alone: the answer may drop it. */
  heading: boolean;
  /** One item of a list: it moves alone, and sooner than a block beside it. */
  item?: boolean;
};

/** An item of the new sequence: a unit by its index, a new heading, or new blocks. */
export type SequenceItem = { unit: number } | { heading: string; level: 1 | 2 | 3 } | { markdown: string };

export type OrderPlan = {
  /** The scope's units and new headings in their new order. */
  sequence: SequenceItem[];
  /** Units that go: headings the answer named and left out of the order. */
  removed: number[];
  /** How many of the scope's units the answer left out: they stay after the unit they followed. */
  missing: number;
};

/** The answer as the scope's new order: each unit once, where the answer
    first names one of its rows; a fixed unit and a row outside the scope
    are passed over; a heading named in removeHeadings and left out of the
    order goes; every other unit the answer leaves out stays right after the
    unit it followed. Null when the answer names no unit of the scope. */
export function planOrder(
  units: OrderUnit[],
  scope: number[],
  answer: { order: OrderEntry[]; removeHeadings: string[] },
  // Which units the answer may take away: a heading alone, unless the caller says more.
  canRemove: (unit: OrderUnit) => boolean = (unit) => unit.heading,
): OrderPlan | null {
  const inScope = new Set(scope.filter((u) => !units[u].fixed));
  const unitOfRow = new Map<string, number>();
  units.forEach((unit, u) => unit.rowIds.forEach((id) => unitOfRow.set(id, u)));
  const sequence: SequenceItem[] = [];
  const placed = new Set<number>();
  for (const entry of answer.order) {
    if ("markdown" in entry) {
      sequence.push(entry);
      continue;
    }
    if ("heading" in entry) {
      // Two new headings in a row: the second stands, the first has nothing under it.
      const last = sequence[sequence.length - 1];
      if (last && "heading" in last) sequence.pop();
      sequence.push(entry);
      continue;
    }
    const u = unitOfRow.get(entry.blockId);
    if (u === undefined || !inScope.has(u) || placed.has(u)) continue;
    placed.add(u);
    sequence.push({ unit: u });
  }
  // A new heading at the end has nothing under it.
  while (sequence.length > 0 && "heading" in sequence[sequence.length - 1]) sequence.pop();
  // No unit placed and no new block: no order to make. New blocks alone (a
  // merge takes the scope's blocks away and writes one in their place) still
  // land where the scope was.
  if (placed.size === 0 && !sequence.some((item) => "markdown" in item)) return null;
  const dropped = new Set(answer.removeHeadings.map((id) => unitOfRow.get(id)).filter((u): u is number => u !== undefined && inScope.has(u) && !placed.has(u) && canRemove(units[u])));
  // The units left out, in document order: each right after the unit it
  // followed (the last one before it that is placed), else at the start.
  let missing = 0;
  let previous: number | null = null;
  for (const u of scope) {
    if (!inScope.has(u)) continue;
    if (!placed.has(u) && !dropped.has(u)) {
      const at = previous === null ? 0 : sequence.findIndex((item) => "unit" in item && item.unit === previous) + 1;
      sequence.splice(at, 0, { unit: u });
      placed.add(u);
      missing++;
    }
    if (placed.has(u)) previous = u;
  }
  return { sequence, removed: [...dropped], missing };
}

/** A run of the new order to move: units and new headings, in order, that
    go right after `after` (a unit that stays, or null: where the scope
    starts). */
export type MoveRun = { after: number | null; items: SequenceItem[] };

/** The fewest moves that make the sequence: the longest run of units already
    in order stays, and every other unit and every new heading moves in runs,
    each run right after the unit before it in the sequence, which stays.
    `before`: the unit just before the scope, or null at the document's start.
    With `units`, a list item moves sooner than a block beside it when either
    would do (a line put after a paragraph, not the paragraph put before the
    line): a block cannot land between the lines of a list. */
export function moveRuns(sequence: SequenceItem[], before: number | null, units?: readonly OrderUnit[]): MoveRun[] {
  const placed = sequence.flatMap((item, k) => ("unit" in item ? [{ k, u: item.unit }] : []));
  const weights = units ? placed.map((x) => (units[x.u]?.item ? 1 : 2)) : undefined;
  const stays = new Set(longestIncreasing(placed.map((x) => x.u), weights).map((i) => placed[i].k));
  const runs: MoveRun[] = [];
  let after = before;
  let open: MoveRun | null = null;
  sequence.forEach((item, k) => {
    if (stays.has(k)) {
      open = null;
      after = (item as { unit: number }).unit;
      return;
    }
    if (!open) runs.push((open = { after, items: [] }));
    open.items.push(item);
  });
  return runs;
}

/** The indexes of a longest strictly increasing subsequence; with weights,
    of a heaviest one (each value counts its weight), the earliest on a tie. */
export function longestIncreasing(values: number[], weights?: number[]): number[] {
  if (weights) {
    // best[i]: the heaviest increasing run that ends at i.
    const best = values.map((_, i) => weights[i]);
    const back = new Array<number>(values.length).fill(-1);
    values.forEach((v, i) => {
      for (let j = 0; j < i; j++) {
        if (values[j] < v && best[j] + weights[i] > best[i]) {
          best[i] = best[j] + weights[i];
          back[i] = j;
        }
      }
    });
    let end = -1;
    best.forEach((w, i) => {
      if (end < 0 || w > best[end]) end = i;
    });
    const out: number[] = [];
    for (let i = end; i >= 0; i = back[i]) out.push(i);
    return out.reverse();
  }
  // tails[l]: the index of the smallest last value of a run of length l + 1.
  const tails: number[] = [];
  const back = new Array<number>(values.length).fill(-1);
  values.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[i] = tails[lo - 1];
    tails[lo] = i;
  });
  const out: number[] = [];
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = back[i]) out.push(i);
  return out.reverse();
}

/** The scope's units, in document order: the units that hold a row of it. */
export function scopeUnits(units: OrderUnit[], rowIds: readonly string[]): number[] {
  const wanted = new Set(rowIds);
  return units.flatMap((unit, u) => (unit.rowIds.some((id) => wanted.has(id)) ? [u] : []));
}
