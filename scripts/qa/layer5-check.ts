// The reader's layer on the graph (round 5 LAYER5: VIEW5-01/02/07/08,
// WALK5-06/07): the comments in the coverage answer, the whole-document
// part, Gaps only's reasons, No reply's "waiting for your reply", the
// comments chip as a room for a curve's marks, and how long the coverage
// read takes. Projects missing from the database are skipped.
// Run: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<db> npx tsx scripts/qa/layer5-check.ts
// Read only: it writes nothing.
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { projectCoverage } from "@/lib/graph/coverage";
import { gapReasons, openComments, waitsForReply, commentAsks, type DocumentCoverage } from "@/lib/graph/coverage-view";
import { nodeRoom } from "@/lib/graph/curve-place";

let pass = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  pass++;
  console.log(`ok  ${label}`);
};

async function timed(id: string, userId: string) {
  await projectCoverage(id, userId);
  const runs: number[] = [];
  let cov = await projectCoverage(id, userId);
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    cov = await projectCoverage(id, userId);
    runs.push(performance.now() - t0);
  }
  runs.sort((a, b) => a - b);
  return { cov, median: runs[2], max: runs[4] };
}

async function main() {
  const userId = process.env.USER_ID ?? "user-1";

  // Pure rules.
  ok(commentAsks("Is it?") && commentAsks("是吗？ ") && !commentAsks("No? Yes."), "a comment asks when its words end with ? or ？");
  const r = (userId: string, at: string, resolved = false) => ({ userId, createdAt: at, resolvedById: resolved ? "x" : null });
  ok(!waitsForReply({ replies: [] }, "me"), "a link with no reply waits on no one (WALK7-04)");
  ok(!waitsForReply({ replies: [r("me", "2026-01-01")] }, "me"), "my own last reply does not wait on me");
  ok(waitsForReply({ replies: [r("me", "2026-01-01"), r("owner", "2026-01-02")] }, "me"), "another person's last reply waits on me (WALK5-07)");
  ok(waitsForReply({ replies: [r("owner", "2026-01-02")] }, "editor"), "the owner's question waits on the editor");
  ok(!waitsForReply({ replies: [r("owner", "2026-01-02", true)] }, "editor"), "a resolved thread is closed");
  const doc = (parts: DocumentCoverage["parts"], opened = true): DocumentCoverage => ({ parts, notes: 0, opened });
  ok(gapReasons(doc([{ blockId: "a", noted: 1, annotated: 0 }])).length === 0, "a noted, opened document has no gap");
  ok(JSON.stringify(gapReasons(doc([{ blockId: "", noted: 0, annotated: 0, whole: true }], false))) === '[{"kind":"notOpened"},{"kind":"whole"}]', "not opened, no note on the whole document");
  ok(JSON.stringify(gapReasons(doc([{ blockId: "a", noted: 0, annotated: 0 }, { blockId: "b", noted: 2, annotated: 0 }]))) === '[{"kind":"parts","n":1,"m":2}]', "1 of 2 parts with no note");
  const [plain] = nodeRoom(0, 0, 1, "A");
  const [chipped] = nodeRoom(0, 0, 1, "A", 30);
  ok(chipped.x1 - plain.x1 === 34, "the comments chip widens the node's room (VIEW5-01 (a))");

  // Linda's shape with an hour of reading (seed-hour.mjs): 10 comments, 1 resolved.
  const LINDA = process.env.LINDA ?? "cmuy46sr4005b7doy5eghkkeq";
  if (await db.notebook.findUnique({ where: { id: LINDA }, select: { id: true } })) {
    const { cov, median, max } = await timed(LINDA, userId);
    const docs = Object.values(cov.documents);
    const comments = docs.flatMap((d) => d.comments ?? []);
    const open = docs.flatMap((d) => openComments(d));
    console.log(`Linda: ${docs.length} documents, ${comments.length} comments (${open.length} open, ${open.filter((c) => c.asks).length} ask), median ${median.toFixed(1)} ms (max ${max.toFixed(1)})`);
    ok(docs.length === 7, "Linda: 7 documents");
    ok(docs.every((d) => d.parts.length > 0), "Linda: every document has at least one part (WALK5-06)");
    ok(docs.filter((d) => d.parts.length === 1 && d.parts[0].whole).length >= 2, "Linda: Schopenhauer as Educator and BOOK TWO are one whole-document part each");
    if (comments.length > 0) {
      ok(comments.length === 10 && open.length === 9, "Linda: 10 comments, 9 open");
      ok(open.filter((c) => c.asks).length === 5, "Linda: 5 open comments end with a question mark");
      const ids = comments.map((c) => c.id);
      const rows = await db.note.findMany({ where: { id: { in: ids } }, select: { section: { select: { notebookId: true, hidden: true } }, color: true, derivationType: true } });
      ok(rows.every((n) => n.section.notebookId === LINDA && n.section.hidden && n.color === null && n.derivationType === null), "Linda: every comment is this project's, in its Annotations section, no color, no tool");
      for (const d of docs) {
        const c = d.comments ?? [];
        ok(c.every((x, i) => i === 0 || Number(c[i - 1].open) >= Number(x.open)), "open comments list first");
      }
    }
    ok(median < 300, "Linda: coverage median under 300 ms");
  } else console.log(`--  ${LINDA} not in this database`);

  // 40 and 200 documents.
  for (const id of ["cmuyh42hr00hs7dw1ate1069g", "cmuxrhzqh0j2n7d1vbr48zsy0"]) {
    if (!(await db.notebook.findUnique({ where: { id }, select: { id: true } }))) {
      console.log(`--  ${id} not in this database`);
      continue;
    }
    const { cov, median, max } = await timed(id, userId);
    const docs = Object.values(cov.documents);
    const parts = docs.reduce((n, d) => n + d.parts.length, 0);
    const kept = docs.filter((d) => gapReasons(d).length > 0).length;
    const open = docs.reduce((n, d) => n + openComments(d).length, 0);
    console.log(`${id}: ${docs.length} documents, ${parts} parts, Gaps only keeps ${kept}, ${open} open comments, ${JSON.stringify(cov).length} bytes, median ${median.toFixed(1)} ms (max ${max.toFixed(1)})`);
    ok(docs.every((d) => d.parts.length > 0), `${id}: every document has a part`);
    ok(median < 300, `${id}: coverage median under 300 ms`);
  }
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
