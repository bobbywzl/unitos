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
import { gapReasons, openComments, waitsForReply, commentWaits, type DocumentCoverage } from "@/lib/graph/coverage-view";
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
  // [lists8] WALK8-01: a comment waits on me when its last words are another person's
  // (an answer from before `newest`: lastById alone).
  ok(commentWaits({ open: true, lastById: "mara" }, "me"), "another person's comment, no reply: waits on me");
  ok(!commentWaits({ open: true, lastById: "me" }, "me"), "my own last words do not wait on me");
  ok(!commentWaits({ open: false, lastById: "mara" }, "me"), "a resolved comment waits on no one");
  ok(!commentWaits({ open: true, lastById: null }, "me") && !commentWaits({ open: true, lastById: "mara" }, ""), "no author, or no account: waits on no one");
  // [lists9] WALK9-01: one rule for comments and links, by the newest reply, resolved or not (the walk's W1-W6).
  const n = (userId: string, at: string, resolved = false) => ({ userId, text: "", createdAt: at, resolved });
  ok(commentWaits({ open: true, lastById: "mara", authorId: "mara", newest: null }, "me"), "W6 at rest: Mara's comment, no reply: waits on me");
  ok(!commentWaits({ open: true, lastById: "mara", authorId: "mara", newest: null }, "mara"), "…not on Mara");
  ok(!commentWaits({ open: true, lastById: "me", authorId: "mara", newest: n("me", "2026-01-02") }, "me"), "W6 step 1: my answer is the newest: not waiting on me");
  ok(commentWaits({ open: true, lastById: "me", authorId: "mara", newest: n("me", "2026-01-02") }, "mara"), "…waits on Mara");
  ok(commentWaits({ open: true, lastById: "mara", authorId: "mara", newest: n("mara", "2026-01-03") }, "me"), "W6 step 2: Mara's thanks is the newest: waits on me");
  ok(!commentWaits({ open: true, lastById: null, authorId: "mara", newest: n("mara", "2026-01-03", true) }, "me"), "W6 step 3 / W1: the newest reply resolved: nobody waits (me)");
  ok(!commentWaits({ open: true, lastById: null, authorId: "mara", newest: n("mara", "2026-01-03", true) }, "mara"), "…nobody waits (Mara)");
  ok(!commentWaits({ open: true, lastById: null, authorId: "mara", newest: n("me", "2026-01-02", true) }, "me"), "W2 / W6 step 4: my answer resolved by Mara: nobody waits, not me again");
  ok(!commentWaits({ open: false, lastById: "mara", authorId: "mara", newest: n("mara", "2026-01-02") }, "me"), "W5: a resolved comment with an open reply waits on no one");
  const members = new Set(["me", "mara"]);
  ok(!commentWaits({ open: true, lastById: "rae", authorId: "me", newest: n("rae", "2026-01-02") }, "me", members), "W4: a removed collaborator's reply waits on no one (WALK9-09)");
  ok(!commentWaits({ open: true, lastById: "ghost", authorId: "me", newest: n("ghost", "2026-01-02") }, "me", members), "W3: a deleted account's reply waits on no one (WALK9-09)");
  ok(commentWaits({ open: true, lastById: "mara", authorId: "mara", newest: null }, "me", members), "…a collaborator's words still wait");
  ok(!commentWaits({ open: true, lastById: "rae", authorId: "rae", newest: null }, "me", members), "a removed collaborator's own comment waits on no one");
  const r = (userId: string, at: string, resolved = false) => ({ userId, createdAt: at, resolvedById: resolved ? "x" : null });
  ok(!waitsForReply({ replies: [] }, "me"), "a link with no reply waits on no one (WALK7-04)");
  ok(!waitsForReply({ replies: [r("me", "2026-01-01")] }, "me"), "my own last reply does not wait on me");
  ok(waitsForReply({ replies: [r("me", "2026-01-01"), r("owner", "2026-01-02")] }, "me"), "another person's last reply waits on me (WALK5-07)");
  ok(waitsForReply({ replies: [r("owner", "2026-01-02")] }, "editor"), "the owner's question waits on the editor");
  ok(!waitsForReply({ replies: [r("owner", "2026-01-02", true)] }, "editor"), "a resolved thread is closed");
  // [lists9] WALK9-01 on a link: the newest reply decides, resolved or not (REV9-04 case 3).
  ok(!waitsForReply({ replies: [r("owner", "2026-01-01"), r("me", "2026-01-02", true)] }, "me"), "the owner resolved my answer: the thread is closed, not handed back to me");
  ok(!waitsForReply({ replies: [r("owner", "2026-01-01"), r("me", "2026-01-02", true)] }, "owner"), "…and it waits on nobody");
  ok(!waitsForReply({ replies: [r("me", "2026-01-01"), r("owner", "2026-01-02", true)] }, "me"), "I resolved the owner's thanks: nobody waits");
  ok(waitsForReply({ replies: [r("owner", "2026-01-01", true), r("owner", "2026-01-02")] }, "me"), "an older resolved reply does not close a newer open one");
  ok(!waitsForReply({ replies: [r("rae", "2026-01-02")] }, "me", members), "a removed collaborator's reply on a link waits on no one (WALK9-09)");
  ok(waitsForReply({ replies: [r("mara", "2026-01-02")] }, "me", members), "…a collaborator's does");
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
    console.log(`Linda: ${docs.length} documents, ${comments.length} comments (${open.length} open, ${open.filter((c) => commentWaits(c, userId)).length} wait on ${userId}), median ${median.toFixed(1)} ms (max ${max.toFixed(1)})`);
    ok(docs.length === 7, "Linda: 7 documents");
    ok(docs.every((d) => d.parts.length > 0), "Linda: every document has at least one part (WALK5-06)");
    ok(docs.filter((d) => d.parts.length === 1 && d.parts[0].whole).length >= 2, "Linda: Schopenhauer as Educator and BOOK TWO are one whole-document part each");
    if (comments.length > 0) {
      // The project's comments by the same rule in SQL (seed-hour: 10, 9 open; the WALK8 seed: its own counts).
      const [counted] = await db.$queryRaw<{ n: number; open: number }[]>`
        SELECT count(*)::int AS n, count(*) FILTER (WHERE n."resolvedById" IS NULL)::int AS open
        FROM "Note" n JOIN "Section" sec ON sec.id = n."sectionId"
        WHERE sec."notebookId" = ${LINDA} AND sec.hidden AND n."derivationType" IS NULL AND n.color IS NULL
          AND n.status <> 'REJECTED' AND n."sideChatOfId" IS NULL AND n.content <> ''
          AND EXISTS (SELECT 1 FROM "Source" s JOIN "Block" b ON b.id = s."blockId" WHERE s."noteId" = n.id AND s.orphaned = false)`;
      ok(comments.length === counted.n && open.length === counted.open, `Linda: ${counted.n} comments, ${counted.open} open`);
      // [lists9] lastById follows the newest reply, resolved or not: resolved → null; else its author; no reply → the
      // comment's author; an author outside the project's members → null (WALK9-01, WALK9-09).
      const last = await db.$queryRaw<{ id: string; by: string | null }[]>`
        WITH nr AS (
          SELECT DISTINCT ON (r."noteId") r."noteId", r."userId", r."resolvedById" FROM "Reply" r
          WHERE r."noteId" = ANY(${comments.map((c) => c.id)}) ORDER BY r."noteId", r."createdAt" DESC, r.id DESC)
        SELECT n.id, CASE WHEN nr."noteId" IS NULL THEN n."createdById" WHEN nr."resolvedById" IS NOT NULL THEN NULL ELSE nr."userId" END AS by
        FROM "Note" n LEFT JOIN nr ON nr."noteId" = n.id WHERE n.id = ANY(${comments.map((c) => c.id)})`;
      const projectMembers = new Set(cov.members ?? []);
      const byId = new Map(last.map((x) => [x.id, x.by !== null && projectMembers.has(x.by) ? x.by : null]));
      ok(comments.every((c) => c.lastById === (byId.get(c.id) ?? null)), "Linda: each comment's lastById is its newest reply's author unless resolved, else its own, members only (WALK9-01)");
      ok(comments.every((c) => c.createdAt !== undefined && c.openReplies !== undefined && c.newest !== undefined), "Linda: every comment carries createdAt, openReplies and newest (the STYLE9 contract)");
      ok(comments.every((c) => (c.replies === 0) === (c.newest === null) && (c.openReplies ?? 0) <= c.replies), "Linda: newest is null exactly when the comment has no reply; open replies never exceed replies");
      ok((cov.members ?? []).includes("user-1"), "Linda: the owner is among the members");
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
