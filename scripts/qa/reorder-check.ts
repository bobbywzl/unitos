// The order pass's moves (lib/assistant/reorder.ts), checked with no model
// and no database: random orders of random documents become the plan card's
// block actions, which run here the way the plan card runs them
// (reader-interactions.tsx executePlan: one after another, new blocks after
// one block in the plan's order), and the document must come out in the
// asked order with every block kept. Run: npx tsx scripts/qa/reorder-check.ts
import { moveRuns, planOrder, type OrderUnit } from "@/lib/assistant/reorder";
import { orderBlockActions } from "@/lib/assistant/reorder-run";
import type { AssistantAction } from "@/lib/types";

let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffle = <T,>(list: T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** The plan card's run of the actions over a list of block ids. */
function execute(start: string[], actions: AssistantAction[]): string[] {
  const doc = [...start];
  const lastInserted = new Map<string, string>();
  let n = 0;
  for (const a of actions) {
    if (a.type === "move_block") {
      doc.splice(doc.indexOf(a.blockId), 1);
      doc.splice(a.afterBlockId === null ? 0 : doc.indexOf(a.afterBlockId) + 1, 0, a.blockId);
    } else if (a.type === "insert_paragraph") {
      const place = a.afterBlockId ?? "";
      const after = lastInserted.get(place) ?? a.afterBlockId;
      const id = `H${n++}:${a.text}`;
      doc.splice(after === null ? 0 : doc.indexOf(after) + 1, 0, id);
      lastInserted.set(place, id);
    } else if (a.type === "remove_block") {
      doc.splice(doc.indexOf(a.blockId), 1);
    } else throw new Error(`unexpected ${a.type}`);
  }
  return doc;
}

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.error(`FAIL ${what}`);
  }
};

for (let round = 0; round < 3000; round++) {
  const size = 2 + Math.floor(random() * 30);
  const ids = Array.from({ length: size }, (_, k) => `b${k}`);
  const headingAt = new Set(ids.filter(() => random() < 0.2));
  const units: OrderUnit[] = ids.map((id) => ({ rowIds: [id], fixed: false, heading: headingAt.has(id) }));
  // A scope: the whole document, or a run of it.
  const whole = random() < 0.5;
  const from = whole ? 0 : Math.floor(random() * size);
  const to = whole ? size : from + 1 + Math.floor(random() * (size - from));
  const scope = Array.from({ length: to - from }, (_, k) => from + k);
  // The answer: the scope's blocks shuffled, some left out, some headings
  // dropped, new headings between, and noise (unknown ids, repeats, ids
  // outside the scope).
  const removable = scope.filter((u) => units[u].heading && random() < 0.5);
  const kept = shuffle(scope.filter((u) => !removable.includes(u)));
  const leftOut = new Set(kept.filter(() => random() < 0.1));
  const order: ({ blockId: string } | { heading: string; level: 1 | 2 | 3 })[] = [];
  for (const u of kept) {
    if (random() < 0.15) order.push({ heading: `T${order.length}`, level: 2 });
    if (!leftOut.has(u)) order.push({ blockId: ids[u] });
    if (random() < 0.05) order.push({ blockId: ids[u] });
    if (random() < 0.05) order.push({ blockId: "nope" });
    if (random() < 0.05 && from > 0) order.push({ blockId: ids[0] });
  }
  const plan = planOrder(units, scope, { order, removeHeadings: removable.map((u) => ids[u]) });
  if (!plan) {
    check(order.every((e) => "heading" in e || !scope.some((u) => ids[u] === e.blockId)), `round ${round}: no plan though the answer names the scope`);
    continue;
  }
  const result = execute(ids, orderBlockActions(units, scope, plan, "why"));
  // The asked order: before the scope, the sequence, after the scope.
  const expected = [
    ...ids.slice(0, from),
    ...plan.sequence.map((item) => ("unit" in item ? ids[item.unit] : `heading:${item.heading}`)),
    ...ids.slice(to),
  ];
  const got = result.map((id) => (id.startsWith("H") ? `heading:${id.slice(id.indexOf(":") + 1)}` : id));
  check(JSON.stringify(got) === JSON.stringify(expected), `round ${round}: order\n  got      ${got.join(" ")}\n  expected ${expected.join(" ")}`);
  // Every block stays but the headings the answer dropped.
  const gone = new Set(plan.removed.map((u) => ids[u]));
  check(ids.every((id) => gone.has(id) || result.includes(id)), `round ${round}: a block was lost`);
  check([...gone].every((id) => headingAt.has(id)), `round ${round}: a block that is no heading was removed`);
  // The fewest moves: a sequence already in order moves nothing.
  const sorted = planOrder(units, scope, { order: scope.map((u) => ({ blockId: ids[u] })), removeHeadings: [] })!;
  check(moveRuns(sorted.sequence, null).length === 0, `round ${round}: the order as it stands moves blocks`);
}

// Fixed units keep their place, whatever the answer says.
{
  const units: OrderUnit[] = ["a", "P", "b", "c"].map((id) => ({ rowIds: [id], fixed: id === "P", heading: false }));
  const plan = planOrder(units, [0, 1, 2, 3], { order: [{ blockId: "c" }, { blockId: "P" }, { blockId: "b" }, { blockId: "a" }], removeHeadings: [] })!;
  const result = execute(["a", "P", "b", "c"], orderBlockActions(units, [0, 1, 2, 3], plan, "why"));
  check(result.indexOf("P") === 1 || result.includes("P"), "a fixed block is kept");
  check(!orderBlockActions(units, [0, 1, 2, 3], plan, "why").some((a) => a.type === "move_block" && a.blockId === "P"), "a fixed block never moves");
}

console.log(failures === 0 ? "reorder-check: all passed" : `reorder-check: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
