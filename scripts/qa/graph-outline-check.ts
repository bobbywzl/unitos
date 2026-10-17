// The node card's outline (lib/graph/outline.ts) and Find's match rule
// (lib/graph/find.ts): the skeleton's parts before the stored contents, a
// part whose block is gone drops, the part a block sits in, the word-start
// rule in English, the substring rule in Chinese, and regex and LIKE
// metacharacters taken literally. Run: npx tsx scripts/qa/graph-outline-check.ts
import assert from "node:assert/strict";
import { outlineParts, partAt } from "@/lib/graph/outline";
import { firstMatch, isCjk, likePattern, normalizeQuery, snippet, wordStartPattern } from "@/lib/graph/find";

// ── outlineParts ───────────────────────────────────────────────────────────
const contents = [
  { title: "One", blockId: "b1", level: 1 as const },
  { title: "One.a", blockId: "b2", level: 2 as const },
  { title: "Two", blockId: "b5", level: 1 as const },
];
const skel = [
  { blockId: "b1", title: "One", summary: "The first part." },
  { blockId: "b2", title: "One.a", summary: "  " },
  { blockId: "gone", title: "Gone", summary: "A part whose block a re-parse replaced." },
];
const a = outlineParts(skel, contents, new Set(["b1", "b2", "b5"]));
assert.equal(a.from, "skeleton");
assert.deepEqual(
  a.parts.map((p) => [p.blockId, p.level, p.summary]),
  [
    ["b1", 1, "The first part."],
    ["b2", 2, null],
  ],
  "skeleton parts keep the contents' level; a blank summary is null; a gone block drops",
);
const b = outlineParts(null, contents, new Set(["b1", "b5"]));
assert.equal(b.from, "contents", "no skeleton: the stored contents");
assert.deepEqual(b.parts.map((p) => p.blockId), ["b1", "b5"]);
assert.ok(b.parts.every((p) => p.summary === null));
const c = outlineParts([{ blockId: "gone", title: "x", summary: "y" }], [], new Set());
assert.equal(c.from, "none", "nothing alive: the caller reads the headings");

// ── partAt ─────────────────────────────────────────────────────────────────
assert.equal(partAt([3, 10, 20], 1), -1, "before every part");
assert.equal(partAt([3, 10, 20], 3), 0, "at a part's start");
assert.equal(partAt([3, 10, 20], 15), 1);
assert.equal(partAt([3, 10, 20], 99), 2);

// ── Find ───────────────────────────────────────────────────────────────────
assert.equal(normalizeQuery("  will   to\npower "), "will to power");
assert.equal(isCjk("同情"), true);
assert.equal(isCjk("pity"), false);
assert.equal(wordStartPattern("pity"), "\\mpity");
assert.equal(wordStartPattern("50%_("), "\\m50%_\\(", "regex metacharacters escaped; LIKE ones need no escape here");
assert.equal(likePattern("50%_\\"), "%50\\%\\_\\\\%", "LIKE metacharacters escaped");

assert.deepEqual(firstMatch("Pitying the weak", "pity"), { start: 0, end: 4 }, "a word start matches");
assert.equal(firstMatch("spity", "pity"), null, "not inside a word");
assert.deepEqual(firstMatch("it is a pity.", "PITY"), { start: 8, end: 12 }, "case aside");
assert.deepEqual(firstMatch("a (b) c", "(b"), { start: 2, end: 4 }, "a query that starts with no word character matches anywhere (REV3-11: no \\m)");
assert.deepEqual(firstMatch("他对同情的看法", "同情"), { start: 2, end: 4 }, "Chinese: a substring");
assert.deepEqual(firstMatch("the will-to-power", "will-to"), { start: 4, end: 11 }, "a hyphen is literal");
assert.equal(firstMatch("x", "a/b|c[d]"), null, "metacharacters never throw");

const long = `${"word ".repeat(40)}the pity of it ${"more ".repeat(40)}`;
const s = snippet(long, "pity");
assert.equal(s.text.slice(s.start, s.end), "pity", "the match's place in the snippet");
assert.ok(s.text.startsWith("…") && s.text.endsWith("…"), "cut both sides");
assert.ok(s.text.length <= 200, `snippet ≤ 200 characters (${s.text.length})`);
const short = snippet("Pity.", "pity");
assert.deepEqual(short, { text: "Pity.", start: 0, end: 4 });

console.log("graph-outline-check: all pass");
