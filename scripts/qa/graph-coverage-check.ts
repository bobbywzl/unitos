// Coverage on the graph (lib/graph/coverage.ts, VIEW4-01): the parts noted,
// the documents opened, on real projects, and how long the reads take.
// cover4-scale (150 documents, 300 notes) is seeded in a copy of the
// database by /tmp/claude-0/cover4/seed-scale.sql; a database without it skips it.
// Run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<db> npx tsx scripts/qa/graph-coverage-check.ts
// PROJECTS="<title>|<title>" adds projects by title (the first word
// characters: startsWith), for the seeded 7-, 40- and 200-document shapes.
// [cost10] COST10-03: on every project the compact form (?parts=counts,
// projectCoverageWire) built back with the part titles' ids equals today's
// shape document by document; with no ids known the counts, shares and gap
// reasons are today's; a document whose titles are from another time is the
// one mismatched. Prints both shapes' bytes.
// Read only: it writes nothing.
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { db } from "@/lib/db";
import { notedShare, projectCoverage, projectCoverageWire } from "@/lib/graph/coverage";
import { expandCoverage, gapReasons, partIdsHash, type PartCoverage } from "@/lib/graph/coverage-view";
import { projectPartTitles } from "@/lib/graph/outline-titles";

const VIEW = "cmuxjmvh7006t7d0bk8xjqaja"; // 7 documents, Linda's shape
const projects = [VIEW, "cmuxjmw8704qt7dztg6adlhps", "cmuxrbzyq00h07d67vpwfonir", "g2-big", "g2-gen", "cover4-scale"];
const byTitle = (process.env.PROJECTS ?? "").split("|").filter(Boolean);

let pass = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  pass++;
  console.log(`ok  ${label}`);
};

async function main() {
  // The local reader with sign-in off; USER_ID names another account.
  const userId = process.env.USER_ID ?? "user-1";
  // [cost10] The hash the server writes and the browser checks.
  ok(partIdsHash([]) === "0.ztntfp" && partIdsHash(["a", "b"]) !== partIdsHash(["b", "a"]) && partIdsHash([""]) !== partIdsHash([]), "partIdsHash: stable, ordered, and a blank id is not no id");
  for (const t of byTitle) {
    const nb = await db.notebook.findFirst({ where: { title: { startsWith: t } }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (nb) projects.push(nb.id);
    else console.log(`--  "${t}" not in this database`);
  }
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
    // [cost10] COST10-03: the compact form carries the same facts.
    const wire = await projectCoverageWire(id, userId);
    const titles = await projectPartTitles(id);
    const idsOf = (d: string) => titles.documents[d]?.map((p) => p.blockId);
    const sortedParts = (parts: PartCoverage[]) => [...parts].sort((a, b) => a.blockId.localeCompare(b.blockId));
    const sortedCounts = (parts: PartCoverage[]) => parts.map((p) => `${p.noted}/${p.annotated}`).sort();
    // The same facts, whatever the key order and the parts' order.
    const canon = (v: unknown): string =>
      JSON.stringify(v, (_, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
    const back = expandCoverage(wire, idsOf);
    ok(back.mismatched.length === 0, `${id}: every document's titles pair with the compact answer`);
    const ids = Object.keys(cov.documents);
    const same = ids.filter((d) => {
      const b = back.coverage.documents[d];
      return b !== undefined && canon({ ...cov.documents[d], parts: sortedParts(cov.documents[d].parts) }) === canon({ ...b, parts: sortedParts(b.parts) });
    }).length;
    ok(same === ids.length && Object.keys(back.coverage.documents).length === ids.length, `${id}: the old shape built from the new equals today's for every document (${same}/${ids.length})`);
    ok(JSON.stringify(cov.members) === JSON.stringify(back.coverage.members), `${id}: members kept`);
    const compacted = Object.values(wire.documents).filter((d) => d.p !== undefined || d.w !== undefined).length;
    ok(Object.values(wire.documents).every((d) => (d.parts === undefined) !== (d.p === undefined && d.w === undefined)), `${id}: every document is compact (p or w) or carries today's parts, never both`);
    const blind = expandCoverage(wire, () => undefined);
    ok(
      blind.mismatched.length === 0 &&
        ids.every((d) => {
          const b = blind.coverage.documents[d];
          const f = cov.documents[d];
          return b !== undefined && notedShare(b) === notedShare(f) && JSON.stringify(gapReasons(b)) === JSON.stringify(gapReasons(f)) && JSON.stringify(sortedCounts(b.parts)) === JSON.stringify(sortedCounts(f.parts));
        }),
      `${id}: with no ids known, every share, gap reason and count is today's (${compacted} documents compacted)`,
    );
    const first = ids.find((d) => cov.documents[d].parts.length > 0 && !cov.documents[d].parts[0].whole);
    if (first) {
      const other = expandCoverage(wire, (d) => (d === first ? [...(idsOf(d) ?? []), "gone"] : idsOf(d)));
      ok(JSON.stringify(other.mismatched) === JSON.stringify([first]), `${id}: a document whose titles are from another time is the one mismatched, the rest pair`);
      const o = other.coverage.documents[first];
      ok(o.parts.every((p) => p.blockId === "") && notedShare(o) === notedShare(cov.documents[first]), `${id}: the mismatched document keeps its counts and carries no id`);
    }
    const bytes = (v: unknown) => {
      const text = JSON.stringify(v);
      return `${text.length} B (gzip ${gzipSync(text).length})`;
    };
    console.log(`    bytes: today ${bytes(cov)} · counts ${bytes(wire)} · titles ${bytes(titles)}`);
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
