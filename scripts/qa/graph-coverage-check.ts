// Coverage on the graph (lib/graph/coverage.ts, VIEW4-01): the parts noted,
// the documents opened, on real projects, and how long the reads take.
// cover4-scale (150 documents, 300 notes) is seeded in a copy of the
// database by /tmp/claude-0/cover4/seed-scale.sql; a database without it skips it.
// Run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<db> npx tsx scripts/qa/graph-coverage-check.ts
// Read only: it writes nothing.
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { notedShare, projectCoverage } from "@/lib/graph/coverage";

const VIEW = "cmuxjmvh7006t7d0bk8xjqaja"; // 7 documents, Linda's shape
const projects = [VIEW, "cmuxjmw8704qt7dztg6adlhps", "cmuxrbzyq00h07d67vpwfonir", "g2-big", "g2-gen", "cover4-scale"];

let pass = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  pass++;
  console.log(`ok  ${label}`);
};

async function main() {
  // The local reader with sign-in off; USER_ID names another account.
  const userId = process.env.USER_ID ?? "user-1";
  for (const id of projects) {
    const nb = await db.notebook.findUnique({ where: { id }, select: { title: true } });
    if (!nb) {
      console.log(`--  ${id} not in this database`);
      continue;
    }
    await projectCoverage(id, userId); // warm the connection and the plans
    const runs: number[] = [];
    let cov = await projectCoverage(id, userId);
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      cov = await projectCoverage(id, userId);
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    const docs = Object.values(cov.documents);
    const parts = docs.reduce((n, d) => n + d.parts.length, 0);
    const noted = docs.reduce((n, d) => n + d.parts.filter((p) => p.noted > 0).length, 0);
    const opened = docs.filter((d) => d.opened).length;
    console.log(
      `${nb.title.slice(0, 40).padEnd(40)} docs ${String(docs.length).padStart(3)} · parts ${noted}/${parts} noted · opened ${opened} · median ${runs[2].toFixed(1)} ms (max ${runs[4].toFixed(1)})`,
    );
    ok(runs[2] < 300, `${id}: coverage median under 300 ms`);
    for (const d of docs) ok(notedShare(d) >= 0 && notedShare(d) <= 1, `${id}: share in 0..1`);
    if (id === VIEW) {
      ok(docs.length === 7, "VIEW: 7 documents (generated ones aside)");
      ok(noted === 7 && parts === 19, "VIEW: 7 of 19 parts noted (the audit's coverage.sql)");
      ok(opened >= 2 && opened < 7, "VIEW: the 2 documents with a reading position, and those the reader wrote notes on, are opened; one is not");
    }
  }
  // Sources whose part sits outside the document never count: one query, the
  // same answer for a missing project.
  const none = await projectCoverage("no-such-project", userId);
  ok(Object.keys(none.documents).length === 0, "a missing project has no documents");
  console.log(`\n${pass} pass`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
