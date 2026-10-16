// The Breakwork loop's request-following checks (SPEC.md §32): what the
// reader's request asks for, as hard facts about the structure after the
// turn. Each case lists its own (cases.ts `follow`); every one is a pass or
// a fail, so the rate of passes says how often the assistant does what it
// was asked, apart from the judges' taste. Block numbers are the readable
// blocks' numbers, as the prompt shows them.
import { childBuckets, parseRanges, type Structure } from "@/lib/structure";

export type Follow =
  // The number of top buckets.
  | { kind: "tops"; min: number; max: number; why: string }
  // Every listed block sits in a bucket whose title, or an outer bucket's
  // title, matches the pattern (case-insensitive).
  | { kind: "in"; blocks: string; title: string; why: string }
  // Every listed block sits in one and the same bucket.
  | { kind: "together"; blocks: string; why: string }
  // No two of the listed groups share a bucket (top bucket when `top`).
  | { kind: "apart"; groups: string[]; top?: boolean; why: string }
  // None of the listed blocks is placed.
  | { kind: "unsorted"; blocks: string; why: string }
  // Every placed block is one of the listed blocks.
  | { kind: "onlyPlaced"; blocks: string; why: string }
  // At least `share` of the listed blocks are placed (default all).
  | { kind: "placed"; blocks: string; share?: number; why: string }
  // A canvas bucket keeps its id, title, parent, and exactly its blocks.
  | { kind: "same"; bucket: string; why: string }
  // A canvas bucket is gone.
  | { kind: "gone"; bucket: string; why: string }
  // A bucket (by canvas id) has a title matching the pattern.
  | { kind: "title"; bucket: string; title: string; why: string }
  // Some bucket's title matches the pattern.
  | { kind: "hasTitle"; title: string; why: string }
  // The listed blocks carry labels; no block outside `within` does.
  | { kind: "labels"; blocks: string; within?: string; why: string }
  // At least `min` connections with one end on a `from` block (or a bucket
  // holding one) and the other on a `to` block (or a bucket holding one).
  | { kind: "connections"; min: number; from?: string; to?: string; why: string }
  // The top buckets that match the patterns come in this order.
  | { kind: "order"; titles: string[]; why: string }
  // The block comes first in its bucket.
  | { kind: "first"; block: number; why: string }
  // The listed blocks share one bucket and come in this order in it.
  | { kind: "sequence"; blocks: number[]; why: string }
  // Some bucket holds blocks from at least two of the groups.
  | { kind: "mixes"; groups: string[]; why: string }
  // At most `max` connections in all (a narrow edit draws none unasked).
  | { kind: "connectionsMax"; max: number; why: string }
  // No one bucket holds more than `max` of the listed blocks.
  | { kind: "maxSize"; blocks: string; max: number; why: string };

export type FollowContext = {
  structure: Pick<Structure, "buckets" | "pieces" | "connections">;
  // The canvas before the turn: bucket id → title, parent, block numbers.
  canvas: Map<string, { title: string; parent: string | null; blocks: number[] }>;
  numberOf: Map<string, number>;
  blockCount: number;
};

export type FollowResult = { why: string; ok: boolean; detail: string };

export function runFollow(rules: Follow[], ctx: FollowContext): FollowResult[] {
  const { structure, numberOf, blockCount } = ctx;
  const nums = (ranges: string) => parseRanges(ranges, blockCount);
  const bucketOfBlock = new Map<number, string>();
  for (const p of structure.pieces) {
    const n = numberOf.get(p.blockId);
    if (n) bucketOfBlock.set(n, p.bucketId);
  }
  const byId = new Map(structure.buckets.map((b) => [b.id, b]));
  const titlesUp = (bucketId: string): string[] => {
    const out: string[] = [];
    let b = byId.get(bucketId);
    for (let i = 0; b && i < 20; i++) {
      out.push(b.title);
      b = b.parentId ? byId.get(b.parentId) : undefined;
    }
    return out;
  };
  const topOf = (bucketId: string): string => {
    let b = byId.get(bucketId);
    for (let i = 0; b?.parentId && i < 20; i++) b = byId.get(b.parentId);
    return b?.id ?? bucketId;
  };
  const rx = (pattern: string) => new RegExp(pattern, "i");
  // The blocks an end of a connection touches: a block, or every block of a
  // bucket and the buckets inside it.
  const blocksOfBucket = (id: string): number[] => [
    ...structure.pieces.filter((p) => p.bucketId === id).map((p) => numberOf.get(p.blockId) ?? 0),
    ...childBuckets(structure, id).flatMap((b) => blocksOfBucket(b.id)),
  ];
  const endBlocks = (e: { kind: "bucket" | "piece"; id: string }) =>
    e.kind === "piece" ? [numberOf.get(e.id) ?? 0] : blocksOfBucket(e.id);

  return rules.map((rule): FollowResult => {
    const res = (ok: boolean, detail = ""): FollowResult => ({ why: rule.why, ok, detail });
    switch (rule.kind) {
      case "tops": {
        const n = childBuckets(structure, null).length;
        return res(n >= rule.min && n <= rule.max, `${n} top buckets`);
      }
      case "in": {
        const miss = nums(rule.blocks).filter((n) => {
          const b = bucketOfBlock.get(n);
          return !b || !titlesUp(b).some((t) => rx(rule.title).test(t));
        });
        return res(miss.length === 0, miss.length ? `not under /${rule.title}/: ${miss.join(", ")}` : "");
      }
      case "together": {
        const at = new Set(nums(rule.blocks).map((n) => bucketOfBlock.get(n) ?? "unsorted"));
        return res(at.size === 1 && !at.has("unsorted"), `${at.size} places`);
      }
      case "apart": {
        const place = (n: number) => {
          const b = bucketOfBlock.get(n);
          return b ? (rule.top ? topOf(b) : b) : null;
        };
        const sets = rule.groups.map((g) => new Set(nums(g).map(place).filter((x): x is string => !!x)));
        const shared = sets.flatMap((s, i) => sets.slice(i + 1).flatMap((t) => [...s].filter((x) => t.has(x))));
        return res(shared.length === 0, shared.length ? `shared: ${[...new Set(shared)].map((id) => byId.get(id)?.title).join("; ")}` : "");
      }
      case "unsorted": {
        const placed = nums(rule.blocks).filter((n) => bucketOfBlock.has(n));
        return res(placed.length === 0, placed.length ? `placed: ${placed.join(", ")}` : "");
      }
      case "onlyPlaced": {
        const allowed = new Set(nums(rule.blocks));
        const extra = [...bucketOfBlock.keys()].filter((n) => !allowed.has(n)).sort((a, b) => a - b);
        return res(extra.length === 0, extra.length ? `placed outside: ${extra.slice(0, 15).join(", ")}${extra.length > 15 ? "…" : ""}` : "");
      }
      case "placed": {
        const list = nums(rule.blocks);
        const placed = list.filter((n) => bucketOfBlock.has(n)).length;
        const need = Math.ceil(list.length * (rule.share ?? 1));
        return res(placed >= need, `${placed} of ${list.length} placed`);
      }
      case "same": {
        const was = ctx.canvas.get(rule.bucket);
        const now = byId.get(rule.bucket);
        if (!was || !now) return res(false, "bucket gone");
        const blocks = structure.pieces.filter((p) => p.bucketId === now.id).map((p) => numberOf.get(p.blockId) ?? 0).sort((a, b) => a - b);
        const same = now.title === was.title && (now.parentId ?? null) === was.parent && JSON.stringify(blocks) === JSON.stringify([...was.blocks].sort((a, b) => a - b));
        return res(same, same ? "" : `title "${now.title}", ${blocks.length} blocks (was ${was.blocks.length})`);
      }
      case "gone":
        return res(!byId.has(rule.bucket), byId.has(rule.bucket) ? "still there" : "");
      case "title": {
        const now = byId.get(rule.bucket);
        return res(!!now && rx(rule.title).test(now.title), now ? `"${now.title}"` : "bucket gone");
      }
      case "hasTitle":
        return res(structure.buckets.some((b) => rx(rule.title).test(b.title)), structure.buckets.map((b) => b.title).join("; ").slice(0, 200));
      case "labels": {
        const want = new Set(nums(rule.blocks));
        const labeled = structure.pieces.filter((p) => p.label.trim()).map((p) => numberOf.get(p.blockId) ?? 0);
        const missing = [...want].filter((n) => !labeled.includes(n));
        const within = rule.within ? new Set(nums(rule.within)) : null;
        const extra = within ? labeled.filter((n) => !within.has(n)) : [];
        return res(missing.length === 0 && extra.length === 0, [missing.length ? `unlabeled: ${missing.join(", ")}` : "", extra.length ? `labeled outside: ${extra.join(", ")}` : ""].filter(Boolean).join("; "));
      }
      case "connections": {
        const from = rule.from ? new Set(nums(rule.from)) : null;
        const to = rule.to ? new Set(nums(rule.to)) : null;
        const hits = (ends: number[], set: Set<number> | null) => !set || ends.some((n) => set.has(n));
        const n = structure.connections.filter((c) => {
          const a = endBlocks(c.from);
          const b = endBlocks(c.to);
          return (hits(a, from) && hits(b, to)) || (hits(b, from) && hits(a, to));
        }).length;
        return res(n >= rule.min, `${n} matching connections`);
      }
      case "first": {
        const b = bucketOfBlock.get(rule.block);
        if (!b) return res(false, "unsorted");
        const first = structure.pieces.filter((p) => p.bucketId === b).sort((x, y) => x.order - y.order)[0];
        return res(numberOf.get(first.blockId) === rule.block, `first is ${numberOf.get(first.blockId)}`);
      }
      case "sequence": {
        const at = new Set(rule.blocks.map((n) => bucketOfBlock.get(n) ?? "unsorted"));
        if (at.size !== 1 || at.has("unsorted")) return res(false, `${at.size} places`);
        const order = new Map(structure.pieces.map((p) => [numberOf.get(p.blockId) ?? 0, p.order]));
        const seq = rule.blocks.map((n) => order.get(n) ?? 0);
        const ok = seq.every((o, i) => i === 0 || o > seq[i - 1]);
        const shown = [...rule.blocks].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        return res(ok, ok ? "" : `order ${shown.join(", ")}`);
      }
      case "mixes": {
        const groups = rule.groups.map((g) => new Set(nums(g)));
        const mixed = structure.buckets.some((b) => {
          const held = structure.pieces.filter((p) => p.bucketId === b.id).map((p) => numberOf.get(p.blockId) ?? 0);
          return groups.filter((g) => held.some((n) => g.has(n))).length >= 2;
        });
        return res(mixed, mixed ? "" : "every bucket keeps to one group");
      }
      case "connectionsMax":
        return res(structure.connections.length <= rule.max, `${structure.connections.length} connections`);
      case "maxSize": {
        const list = new Set(nums(rule.blocks));
        const sizes = structure.buckets.map((b) => ({
          title: b.title,
          n: structure.pieces.filter((p) => p.bucketId === b.id && list.has(numberOf.get(p.blockId) ?? 0)).length,
        }));
        const big = sizes.filter((x) => x.n > rule.max);
        return res(big.length === 0, big.map((x) => `${x.title}: ${x.n}`).join("; "));
      }
      case "order": {
        const tops = childBuckets(structure, null).map((b) => b.title);
        const at = rule.titles.map((t) => tops.findIndex((title) => rx(t).test(title)));
        const ok = at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1]);
        return res(ok, tops.join(" | ").slice(0, 200));
      }
    }
  });
}
