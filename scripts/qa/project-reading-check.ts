// The assistant at Project scope past the whole threshold (SPEC.md §7): the
// digest renders each document's gist and only the picked blocks, gaps
// declared, notes whole. Run: npx tsx scripts/qa/project-reading-check.ts
import { corpusPickedSystem, corpusSystem } from "../../src/lib/digest/render";
import type { DigestDocument, DigestParts } from "../../src/lib/digest/types";
import { targetRows } from "../../src/lib/assistant/target";
import { skeletonGroups, type SkeletonView } from "../../src/lib/graph/stitch";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
}

const blocks = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `[block ${prefix}${i + 1}] (PARAGRAPH)\nText ${prefix}${i + 1} with words.`).join("\n\n");
const doc = (id: string, n: number): DigestDocument => {
  const text = blocks(id, n);
  return {
    id, title: `Doc ${id}`, sourceUrl: null, video: null, chars: text.length, text,
    glossary: [], annotations: [], distillations: [], extractions: [], summaries: [], salience: [], links: [], edits: [],
  };
};
const parts: DigestParts = {
  corpusId: "p1", corpusTitle: "Project", sections: ["Main"],
  notes: [{ id: "n1", section: "Main", hidden: false, status: "ACCEPTED", kind: "note", color: null, content: "My note", sources: [] }],
  looseAnnotations: [], documents: [doc("a", 10), doc("b", 5)],
};

const picked = corpusPickedSystem(parts, new Map([
  ["a", { blockIds: new Set(["a2", "a3", "a7"]), gist: "Doc a argues X." }],
  ["b", { blockIds: new Set<string>(), gist: "" }],
]));
check("picked blocks shown", ["[block a2]", "[block a3]", "[block a7]"].every((t) => picked.includes(t)));
check("other blocks not shown", !picked.includes("[block a1]") && !picked.includes("[block a4]") && !picked.includes("[block b1]"));
check("gap declared between a3 and a7", picked.includes("(3 blocks not shown)"));
check("no gap line before the first shown block", !picked.includes("(1 blocks not shown)"));
check("count header", picked.includes("(3 of 10 blocks shown") && picked.includes("(0 of 5 blocks shown"));
check("gist shown", picked.includes("Gist: Doc a argues X."));
check("notes whole", picked.includes("[note n1]") && picked.includes("My note"));
const whole = corpusSystem(parts);
check("whole digest unchanged without picks", whole.includes("[block a1]") && whole.includes("[block b5]") && !whole.includes("blocks shown"));
check("picked is shorter", picked.length < whole.length, `${picked.length} vs ${whole.length}`);

// The grouped select pass: every line in exactly one group, groups under the size, one call when it fits.
const view = (letter: string, n: number, len: number): SkeletonView =>
  ({ r: { letter } as SkeletonView["r"], gist: "", parts: [], lines: Array.from({ length: n }, (_, i) => ({ alias: `${letter}${i + 1}`, text: "x".repeat(len), partAlias: null })) });
const views = [view("A", 300, 100), view("B", 20, 100), view("C", 900, 100)];
const one = skeletonGroups(views, null, 1_000_000, 10_000);
check("fits: one call, every line", one.length === 1 && one[0].shown === null);
const groups = skeletonGroups(views, null, 50_000, 10_000);
const seen = groups.flatMap((g) => [...(g.shown ?? [])]);
check("grouped: every line once", seen.length === 1220 && new Set(seen).size === 1220);
check("grouped: each group under the size", groups.every((g) => [...(g.shown ?? [])].length * 113 <= 10_000 + 113), String(groups.map((g) => g.shown?.size)));
check("grouped: a long document spans groups", groups.filter((g) => g.views.some((v) => v.r.letter === "C")).length > 1);
const cut = skeletonGroups(views, new Set(["A1", "C5"]), 50_000, 10_000);
check("shown lines only", cut.length === 1 && cut[0].shown?.size === 2);

// The target pass's names as the scope's rows.
const scope = ["r1", "r2", "r3", "r4", "r5", "r6"];
check("ids and ranges", targetRows(["r2", "r4..r5"], scope).join() === "r2,r4,r5");
check("range in reverse", targetRows(["r5..r3"], scope).join() === "r3,r4,r5");
check("tags and spaces read", targetRows(["[block r1]", " r6 "], scope).join() === "r1,r6");
check("outside the scope passed over", targetRows(["x9", "r2..x9"], scope).join() === "r2");
check("document order, once", targetRows(["r6", "r1", "r1..r2"], scope).join() === "r1,r2,r6");

if (failed > 0) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
