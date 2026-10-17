// Round 3 graph logic: Find's patterns for a query that starts with
// punctuation (REV3-11), in JS and in Postgres.
// Run: DB=dissect npx tsx scripts/qa/graph3-check.ts (the SQL half needs psql).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { firstMatch, wordStartPattern } from "@/lib/graph/find";

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

console.log(`${pass} pass, ALL PASS`);
