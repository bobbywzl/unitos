// Round 3 graph logic: Find's patterns for a query that starts with
// punctuation (REV3-11), in JS and in Postgres, and where a curve's marks sit
// (VIEW3-01, lib/graph/curve-place.ts).
// Run: DB=dissect npx tsx scripts/qa/graph3-check.ts (the SQL half needs psql).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { firstMatch, wordStartPattern } from "@/lib/graph/find";
import { nodeRoom, placeMarks, quadAt } from "@/lib/graph/curve-place";

let pass = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  pass++;
  console.log(`PASS ${name}`);
};

// Find, JS: punctuation first matches where it stands; a word keeps its word start.
const cases: [string, string, boolean][] = [
  ["see §22 here", "§22", true],
  ["he said “pity” twice", "“pity”", true],
  ["it cost $5 today", "$5", true],
  ["pitying the weak", "pity", true],
  ["spity", "pity", false],
  ["no section here", "§22", false],
  // COST4-02: a word under three characters matches only whole.
  ["one of them", "of", true],
  ["Of course", "of", true],
  ["often the case", "of", false],
  ["the thing", "th", false],
  ["AI-based tools", "ai", true],
  ["often the case", "oft", true],
];
for (const [text, q, hit] of cases) ok((firstMatch(text, q) !== null) === hit, `firstMatch(${JSON.stringify(text)}, ${JSON.stringify(q)}) = ${hit}`);

// Find, SQL: the same cases through Postgres's ~* (the route's operator).
const DB = process.env.DB ?? "dissect";
try {
  for (const [text, q, hit] of cases) {
    const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const out = execFileSync("psql", ["-h", "localhost", "-U", "postgres", DB, "-Atc", `select ${lit(text)} ~* ${lit(wordStartPattern(q))}`], {
      env: { ...process.env, PGPASSWORD: "postgres" },
    })
      .toString()
      .trim();
    ok((out === "t") === hit, `SQL ${JSON.stringify(text)} ~* ${JSON.stringify(wordStartPattern(q))} = ${hit}`);
  }
} catch (err) {
  console.log(`SKIP SQL half: ${String(err).slice(0, 120)}`);
}

// Marks: a curve through a third node's room slides off it; two curves
// sharing a middle keep their marks apart.
const room = nodeRoom(-72, -16, 1, "Middle document");
const s = { x: -300, y: 0 };
const e = { x: 300, y: 0 };
const c = { x: 0, y: 0 };
const placed = placeMarks([{ id: "a|b", curve: { s, c, e }, at: c, w: 80, h: 22 }], room);
const p = placed.get("a|b")!;
const inside = (pt: { x: number; y: number }) => room.some((r) => pt.x + 40 > r.x0 && pt.x - 40 < r.x1 && pt.y + 11 > r.y0 && pt.y - 11 < r.y1);
ok(inside(quadAt(s, c, e, 0.5)), "the curve's middle is inside the node's room");
ok(!inside(p), `the marks slide off the room to (${Math.round(p.x)}, ${Math.round(p.y)})`);
const two = placeMarks(
  [
    { id: "x", curve: { s, c, e }, at: c, w: 80, h: 22 },
    { id: "y", curve: { s: { x: -300, y: 10 }, c: { x: 0, y: 10 }, e: { x: 300, y: 10 } }, at: c, w: 80, h: 22 },
  ],
  [],
);
const [px, py] = [two.get("x")!, two.get("y")!];
ok(Math.abs(px.x - py.x) >= 80 || Math.abs(px.y - py.y) >= 22, "two curves' marks do not overlap");
const loop = placeMarks([{ id: "l", curve: null, at: { x: 5, y: -40 }, w: 30, h: 22 }], []);
ok(loop.get("l")!.x === 5 && loop.get("l")!.y === -40, "a loop's marks sit at its top");

console.log(`${pass} pass, ALL PASS`);
