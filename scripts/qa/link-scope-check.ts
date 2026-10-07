// Links belong to their project (DocLink.notebookId, SPEC.md §13). Checks, on
// a COPY of the database:
//   1. The backfill: the dry run writes nothing; --apply writes only
//      DocLink.notebookId, only where it was null (a checksum of every other
//      column of every row, before and after).
//   2. Every create path sets notebookId: the reader's POST /api/links, Stitch's
//      links and the generated document's provenance links, the link scan.
//   3. The twin case (graph-notes audit GN-01): account B's project holds the
//      same two documents as account A's. B's graph, reader, and digest do not
//      show A's link; B cannot remove, accept, reword, or reply to it (404);
//      a link with no project still shows in both, and B cannot remove it
//      (403) while A's project holds it too.
//   4. No project named (an older tab): a removal of a link that must stay
//      for another account answers 409 Reload and hides nothing (REV5-01),
//      also when a second owner's project holds both documents; asked from
//      a project it hides the link there only; a hidden link answers 404 to
//      reason edits, replies, and removals.
//
// Run, with a dev server on the same database copy, sign-in on, and the mock
// models (scripts/qa/mock-kimi.mjs):
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dissect_data \
//     npx tsx scripts/qa/link-scope-check.ts [http://localhost:3125]
// It refuses the shared database "dissect". It creates two accounts, three
// projects, and links in the copy; it deletes only the links it made.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { buildDigest } from "../../src/lib/digest/build";
import { documentsGraph } from "../../src/lib/graph/view";

const BASE = process.argv[2] ?? "http://localhost:3125";
const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
const db = new PrismaClient();
const SEED = JSON.parse(readFileSync("/home/user/unitos/.qa-tmp/stitch/gn/seed-out.json", "utf8")) as {
  notebook: string;
  twin: string;
  docs: string[];
  link: string;
};
const [DOC_A, DOC_B, DOC_C, DOC_D, DOC_E] = SEED.docs;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
}

type Snapshot = Map<string, { h: string; nb: string | null }>;
async function snapshot(): Promise<Snapshot> {
  const rows = await db.$queryRaw<{ id: string; h: string; nb: string | null }[]>`
    SELECT id, md5((to_jsonb(t) - 'notebookId')::text) AS h, "notebookId" AS nb FROM "DocLink" t`;
  return new Map(rows.map((r) => [r.id, { h: r.h, nb: r.nb }]));
}
async function tableCounts(): Promise<string> {
  const rows = await db.$queryRaw<{ c: string }[]>`
    SELECT (SELECT count(*) FROM "Reply")::text || ':' || (SELECT count(*) FROM "Notebook")::text || ':' ||
           (SELECT count(*) FROM "NotebookDocument")::text || ':' || (SELECT count(*) FROM "Document")::text || ':' ||
           (SELECT md5(coalesce(string_agg(to_jsonb(r)::text, '|' ORDER BY id), '')) FROM "Reply" r) AS c`;
  return rows[0].c;
}
function backfill(...args: string[]) {
  const run = spawnSync("node", ["scripts/backfill-doclink-notebook.mjs", ...args], { encoding: "utf8", env: process.env });
  if (run.status !== 0) throw new Error(run.stderr);
  const n = (label: string) => Number(new RegExp(`${label}[^:]*:\\s+(\\d+)`).exec(run.stdout)?.[1] ?? NaN);
  return { out: run.stdout, certain: n("certain"), byCreator: n("by creator"), ambiguous: n("ambiguous"), unknown: n("unknown") };
}

async function main() {
// ── 1. The backfill ─────────────────────────────────────────────────────────
console.log("== backfill");
const s0 = await snapshot();
const t0 = await tableCounts();
const dry = backfill();
console.log(dry.out.trim().replace(/^/gm, "     "));
const s1 = await snapshot();
check("dry run: no row changed", s1.size === s0.size && [...s0].every(([id, r]) => s1.get(id)?.h === r.h && s1.get(id)?.nb === r.nb));
const applied = backfill("--apply");
const written = Number(/Applied: (\d+)/.exec(applied.out)?.[1] ?? NaN);
const s2 = await snapshot();
check("apply: same rows", s2.size === s0.size && [...s0.keys()].every((id) => s2.has(id)));
check("apply: every other column unchanged (row checksum)", [...s0].every(([id, r]) => s2.get(id)?.h === r.h));
const changed = [...s0].filter(([id, r]) => s2.get(id)?.nb !== r.nb);
check("apply: only null notebookId written", changed.every(([, r]) => r.nb === null));
check(`apply: writes the dry run's certain + by creator (${dry.certain} + ${dry.byCreator})`, written === dry.certain + dry.byCreator && changed.length === written, `written ${written}, changed ${changed.length}`);
check("apply: other tables unchanged (Reply rows, projects, attachments, documents)", (await tableCounts()) === t0);
const seedLink = await db.docLink.findUniqueOrThrow({ where: { id: SEED.link } });
check("the seeded A–B link stays null (two projects hold both documents)", seedLink.notebookId === null);
const acLink = await db.docLink.findFirst({ where: { fromDocumentId: DOC_A, toDocumentId: DOC_C } });
check("the seeded A–C link gets QA Graph Notes (one project holds both)", acLink?.notebookId === SEED.notebook, String(acLink?.notebookId));
const again = backfill();
check("a second dry run finds nothing certain left", again.certain === 0 && again.byCreator === 0);

// ── Fixture: two accounts, their projects on the same two documents ────────
const later = new Date(Date.now() + 86_400_000);
async function account(key: string) {
  const id = `qa-link-${key}`;
  await db.user.upsert({
    where: { id },
    create: { id, email: `${id}@example.invalid`, name: `QA Link ${key.toUpperCase()}`, tier: "ULTRA", trialEndsAt: later },
    update: { tier: "ULTRA", trialEndsAt: later },
  });
  const token = `${id}-token`;
  await db.session.upsert({ where: { token }, create: { token, userId: id, expiresAt: later }, update: { expiresAt: later } });
  return { id, cookie: `dissect-session=${token}` };
}
async function project(owner: string, title: string, docs: string[]) {
  const found = await db.notebook.findFirst({ where: { userId: owner, title } });
  const nb = found ?? (await db.notebook.create({ data: { userId: owner, title, sections: { create: [{ title: "Notes", order: 0 }] } } }));
  for (const documentId of docs) {
    await db.notebookDocument.upsert({
      where: { notebookId_documentId: { notebookId: nb.id, documentId } },
      create: { notebookId: nb.id, documentId },
      update: {},
    });
  }
  return nb.id;
}
const A = await account("a");
const B = await account("b");
// D and E: the pair Stitch links (the mock links the first two documents it reads).
const PA = await project(A.id, "QA Link Scope A", [DOC_A, DOC_B, DOC_D, DOC_E]);
const PA2 = await project(A.id, "QA Link Scope A2", [DOC_A, DOC_B]);
const PB = await project(B.id, "QA Link Scope B", [DOC_A, DOC_B, DOC_D, DOC_E]);

async function call(who: { cookie: string }, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie: who.cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}
const blocksOf = (documentId: string) => db.block.findMany({ where: { documentId }, orderBy: { order: "asc" } });
const anchorIn = async (documentId: string) => {
  const block = (await blocksOf(documentId)).find((b) => b.text.length >= 40)!;
  return { blockId: block.id, startOffset: 0, endOffset: 24, quotedText: block.text.slice(0, 24), prefix: "", suffix: block.text.slice(24, 88) };
};

// ── 2. Creation sets notebookId ─────────────────────────────────────────────
console.log("== creation");
const made: string[] = [];
const fromAnchor = await anchorIn(DOC_A);
const toAnchor = await anchorIn(DOC_B);
const post = await call(A, "POST", "/api/links", { notebookId: PA, fromDocumentId: DOC_A, toDocumentId: DOC_B, anchor: fromAnchor, toAnchor });
check("reader: POST /api/links answers 201", post.status === 201, `${post.status} ${post.text.slice(0, 200)}`);
const linkA = post.status === 201 ? (JSON.parse(post.text) as { id: string }).id : "";
if (linkA) made.push(linkA);
check("reader: the link carries the project", (await db.docLink.findUnique({ where: { id: linkA } }))?.notebookId === PA);
const postOld = await call(A, "POST", "/api/links", { fromDocumentId: DOC_A, toDocumentId: DOC_B, anchor: fromAnchor, toAnchor });
const legacyA = postOld.status === 201 ? (JSON.parse(postOld.text) as { id: string }).id : "";
check("reader, a tab from before (no notebookId): 201 and no project", postOld.status === 201 && (await db.docLink.findUnique({ where: { id: legacyA } }))?.notebookId === null, postOld.text.slice(0, 200));
const postOther = await call(A, "POST", "/api/links", { notebookId: PB, fromDocumentId: DOC_A, toDocumentId: DOC_B, anchor: fromAnchor, toAnchor });
check("reader: POST into another account's project answers 404", postOther.status === 404, String(postOther.status));
const postDetached = await call(A, "POST", "/api/links", { notebookId: PA, fromDocumentId: DOC_A, toDocumentId: DOC_C, anchor: fromAnchor });
check("reader: POST to a document the project does not hold answers 404", postDetached.status === 404, String(postDetached.status));

async function stitchAs(who: { id: string; cookie: string }, notebookId: string) {
  const since = new Date();
  const res = await call(who, "POST", `/api/notebooks/${notebookId}/stitch`, {
    command: "connect the passages that answer what limits adoption",
    documentIds: [DOC_D, DOC_E],
  });
  const rows = await db.docLink.findMany({ where: { createdById: who.id, createdAt: { gte: since } } });
  return { res, rows };
}
const sA = await stitchAs(A, PA);
let stitchResult: { document?: { id: string } | null } = {};
try {
  stitchResult = JSON.parse(sA.res.text.trim()) as typeof stitchResult;
} catch {
  /* the stream's error token: reported below */
}
check("stitch in A's project answers", sA.res.status === 200 && sA.rows.length > 0, `${sA.res.status} ${sA.res.text.trim().slice(0, 200)} rows ${sA.rows.length}`);
check(`stitch: all ${sA.rows.length} new link(s) carry A's project`, sA.rows.every((l) => l.notebookId === PA));
const provenance = sA.rows.filter((l) => l.fromDocumentId === stitchResult.document?.id);
console.log(`     stitch: ${sA.rows.length - provenance.length} recommended, ${provenance.length} provenance link(s), generated document ${stitchResult.document?.id ?? "none"}`);
made.push(...sA.rows.map((l) => l.id));
const recommendedA = sA.rows.filter((l) => l.recommended);
const sB = await stitchAs(B, PB);
const sameEnds = (x: { fromBlockId: string; quotedText: string; toBlockId: string | null }) =>
  recommendedA.some((l) => l.fromBlockId === x.fromBlockId && l.quotedText === x.quotedText && l.toBlockId === x.toBlockId);
check(
  "stitch in B's project gets its own link on the same passages (A's link does not dedupe B's away)",
  recommendedA.length > 0 && sB.rows.some((l) => l.recommended && sameEnds(l)) && sB.rows.every((l) => l.notebookId === PB),
  `A recommended ${recommendedA.length}, B rows ${sB.rows.length}`,
);
const sA2 = await stitchAs(A, PA);
check("stitch in A's project again: A's own link dedupes the repeat", sA2.rows.every((l) => !(l.recommended && sameEnds(l))), `rows ${sA2.rows.length}`);
made.push(...sA2.rows.map((l) => l.id));
made.push(...sB.rows.map((l) => l.id));

const scanSince = new Date();
const scan = await call(A, "POST", `/api/notebooks/${PA}/connect`);
const scanRows = await db.docLink.findMany({ where: { createdById: A.id, createdAt: { gte: scanSince } } });
if (scan.status === 429) console.log("     scan: this month's runs are spent for the QA account; skipped");
else {
  check("scan answers", scan.status === 200, `${scan.status} ${scan.text.slice(0, 200)}`);
  check(`scan: all ${scanRows.length} new link(s) carry A's project`, scanRows.every((l) => l.notebookId === PA));
}
made.push(...scanRows.map((l) => l.id));

// ── 3. The twin case ────────────────────────────────────────────────────────
console.log("== twin case");
const nodes = [DOC_A, DOC_B, DOC_D, DOC_E].map((id) => ({ id, title: id, hasVideo: false }));
const graphLinks = async (notebookId: string) => {
  const g = await documentsGraph(nodes, notebookId);
  return { ids: new Set(g.edges.flatMap((e) => e.links.map((l) => l.id))), recommended: new Set(g.recommended.map((l) => l.id)) };
};
const gA = await graphLinks(PA);
const gB = await graphLinks(PB);
const gMain = await graphLinks(SEED.notebook);
check("graph: A's project shows A's link", gA.ids.has(linkA));
check("graph: B's project does not show A's link", !gB.ids.has(linkA));
check("graph: the seeded QA Graph Notes twin does not show A's link", !(await graphLinks(SEED.twin)).ids.has(linkA));
check("graph: B's recommended links hold none of A's Stitch links", recommendedA.every((l) => !gB.recommended.has(l.id)) && recommendedA.length > 0);
check("graph: a link with no project shows in A's, B's, and the seed's projects", [gA, gB, gMain].every((g) => g.ids.has(SEED.link) && g.ids.has(legacyA)));
const page = async (who: { cookie: string }, nb: string) => (await call(who, "GET", `/n/${nb}?doc=${DOC_A}`)).text;
const pageB = await page(B, PB);
const pageA = await page(A, PA);
check("reader: A's page carries A's link", pageA.includes(linkA));
check("reader and Edits panel: B's page does not carry A's link", pageB.length > 1000 && !pageB.includes(linkA), `length ${pageB.length}`);
const addEdit = await db.blockEdit.findFirst({ where: { kind: "LINK_ADD", meta: { path: ["linkId"], equals: linkA } } });
check("the LINK_ADD edit names A's project", (addEdit?.meta as { notebookId?: string } | null)?.notebookId === PA);
check("reader: B's page still carries the link with no project", pageB.includes(SEED.link));
const digestHas = async (nb: string) =>
  (await buildDigest(nb))!.parts.documents.flatMap((d) => d.links).some((l) => l.quote === fromAnchor.quotedText && l.toQuote === toAnchor.quotedText);
// legacyA has the same quotes and no project, so it shows in B's digest; move it out of the way first.
// From an older tab (no project named) the link must stay for B: 409 Reload, nothing hidden (REV5-01).
const legacyOld = await call(A, "DELETE", `/api/links/${legacyA}`);
check(
  "A's older tab removes A's link with no project that B's project shows: 409, nothing hidden",
  legacyOld.status === 409 && (await db.docLinkHidden.count({ where: { docLinkId: legacyA } })) === 0,
  `${legacyOld.status} ${legacyOld.text.slice(0, 160)}`,
);
check("A removes A's own link with no project from A's project, though B's project holds both documents (the maker may)", (await call(A, "DELETE", `/api/links/${legacyA}?notebookId=${PA}`)).status === 200);
// B's project still shows it (REV3-02): the removal hides it in A's projects only.
check(
  "the removed link stays in B's project: hidden in A's projects, not in B's",
  (await db.docLinkHidden.count({ where: { docLinkId: legacyA } })) > 0 &&
    (await db.docLinkHidden.count({ where: { docLinkId: legacyA, notebookId: PB } })) === 0,
);
await db.docLink.delete({ where: { id: legacyA } }); // this run's row
check("digest: A's project lists A's link, B's does not", (await digestHas(PA)) && !(await digestHas(PB)));

const rA = await call(A, "POST", "/api/replies", { docLinkId: linkA, notebookId: PA, content: "A's reply on A's link" });
check("reply: A replies on A's link", rA.status === 201, `${rA.status} ${rA.text.slice(0, 200)}`);
const replyA = rA.status === 201 ? (JSON.parse(rA.text) as { id: string }).id : "";
const tries: [string, { status: number }][] = [
  ["DELETE", await call(B, "DELETE", `/api/links/${linkA}`)],
  ["DELETE ?notebookId=B", await call(B, "DELETE", `/api/links/${linkA}?notebookId=${PB}`)],
  ["PATCH accept", await call(B, "PATCH", `/api/links/${linkA}?notebookId=${PB}`, { accept: true })],
  ["PATCH reason", await call(B, "PATCH", `/api/links/${linkA}`, { reason: "B was here" })],
  ["reply", await call(B, "POST", "/api/replies", { docLinkId: linkA, notebookId: PB, content: "B's reply" })],
  ["reply without notebookId", await call(B, "POST", "/api/replies", { docLinkId: linkA, content: "B's reply" })],
  ["resolve A's reply", await call(B, "PATCH", `/api/replies/${replyA}`, { resolved: true })],
  ["delete A's reply", await call(B, "DELETE", `/api/replies/${replyA}`)],
];
for (const [what, res] of tries) check(`B on A's link: ${what} answers 404`, res.status === 404, String(res.status));
const recB = recommendedA[0];
if (recB) {
  check("B dismissing A's recommended Stitch link answers 404", (await call(B, "DELETE", `/api/links/${recB.id}?notebookId=${PB}`)).status === 404);
}
const after = await db.docLink.findUnique({ where: { id: linkA }, include: { replies: true } });
check("A's link, its reason, and its reply are intact", !!after && after.reason === null && after.replies.length === 1 && after.replies[0].resolvedById === null);
check("same account, another project: A's DELETE from A2 answers 404", (await call(A, "DELETE", `/api/links/${linkA}?notebookId=${PA2}`)).status === 404);

const seedDelete = await call(B, "DELETE", `/api/links/${SEED.link}?notebookId=${PB}`);
check("B removing the seeded link with no project answers 403", seedDelete.status === 403, `${seedDelete.status} ${seedDelete.text.slice(0, 160)}`);
const seedAfter = await db.docLink.findUnique({ where: { id: SEED.link }, include: { replies: true } });
check("the seeded link and its 2 replies are intact", !!seedAfter && seedAfter.replies.length === 2);

// Existing workflow: the owner still rewords, replies, and removes in their own project.
check("A rewords A's link from A's project", (await call(A, "PATCH", `/api/links/${linkA}?notebookId=${PA}`, { reason: "Same COP" })).status === 200);
check("A removes A's link from A's project", (await call(A, "DELETE", `/api/links/${linkA}?notebookId=${PA}`)).status === 200);

// ── 4. No project named (REV4-01) ───────────────────────────────────────────
// Every tab open at the deploy sends Remove, Dismiss, reason edits, and
// replies with no project. A removal must still keep the row and the replies
// of other accounts, and a link hidden in a project stays out of reach.
console.log("== no project named");
const C = await account("c");
const cUser = await db.user.findUniqueOrThrow({ where: { id: C.id } });
// Four documents of this run: X and Y only A's project PA3 holds (C edits it),
// Z and W no project holds.
const madeDocs: string[] = [];
async function doc(title: string) {
  const d = await db.document.create({
    data: { title, blocks: { create: [{ order: 0, type: "PARAGRAPH", text: `${title}: suffering is the ground of compassion.` }] } },
    include: { blocks: true },
  });
  madeDocs.push(d.id);
  return { id: d.id, block: d.blocks[0] };
}
const [X, Y, Z, W] = [await doc("QA Link X"), await doc("QA Link Y"), await doc("QA Link Z"), await doc("QA Link W")];
const PA3 = await project(A.id, "QA Link Scope A3", [X.id, Y.id]);
await db.notebookCollaborator.upsert({
  where: { notebookId_email: { notebookId: PA3, email: cUser.email! } },
  create: { notebookId: PA3, email: cUser.email!, role: "EDITOR" },
  update: { role: "EDITOR" },
});
const legacyLink = (from: typeof X, to: typeof X) =>
  db.docLink.create({
    data: {
      createdById: A.id,
      fromDocumentId: from.id,
      fromBlockId: from.block.id,
      startOffset: 0,
      endOffset: 9,
      quotedText: from.block.text.slice(0, 9),
      prefix: "",
      suffix: from.block.text.slice(9, 40),
      toDocumentId: to.id,
      toBlockId: to.block.id,
    },
  });
const legacy = (await legacyLink(X, Y)).id;
const legacyReply = await call(A, "POST", "/api/replies", { docLinkId: legacy, notebookId: PA3, content: "A's reply on a link with no project" });
check("A replies on a link with no project", legacyReply.status === 201, `${legacyReply.status} ${legacyReply.text.slice(0, 160)}`);
const cOld = await call(C, "DELETE", `/api/links/${legacy}`);
check(
  "C (A's editor) removes it from an older tab: 409 Reload, hidden nowhere (REV5-01)",
  cOld.status === 409 && (await db.docLinkHidden.count({ where: { docLinkId: legacy } })) === 0,
  `${cOld.status} ${cOld.text.slice(0, 160)}`,
);
// A second owner's project holds X and Y too, and C edits it; C made a link
// with no project there, and A replied (REV5-01).
const B2 = await project(B.id, "QA Link Scope B2", [X.id, Y.id]);
await db.notebookCollaborator.upsert({
  where: { notebookId_email: { notebookId: B2, email: cUser.email! } },
  create: { notebookId: B2, email: cUser.email!, role: "EDITOR" },
  update: { role: "EDITOR" },
});
const legacyC = (
  await db.docLink.create({
    data: {
      createdById: C.id,
      fromDocumentId: X.id,
      fromBlockId: X.block.id,
      startOffset: 10,
      endOffset: 19,
      quotedText: X.block.text.slice(10, 19),
      prefix: "",
      suffix: "",
      toDocumentId: Y.id,
      toBlockId: Y.block.id,
    },
  })
).id;
await db.reply.create({ data: { docLinkId: legacyC, userId: A.id, content: "A's reply on C's link" } });
const cOld2 = await call(C, "DELETE", `/api/links/${legacyC}`);
check(
  "C removes C's link that A's and B's projects show, from an older tab: 409, hidden nowhere",
  cOld2.status === 409 && (await db.docLinkHidden.count({ where: { docLinkId: legacyC } })) === 0,
  `${cOld2.status} ${cOld2.text.slice(0, 160)}`,
);
const cScoped2 = await call(C, "DELETE", `/api/links/${legacyC}?notebookId=${PA3}`);
check(
  "…asked from A's project: hidden in A's project only, not in B's",
  cScoped2.status === 200 &&
    (await db.docLinkHidden.count({ where: { docLinkId: legacyC, notebookId: PA3 } })) === 1 &&
    (await db.docLinkHidden.count({ where: { docLinkId: legacyC, notebookId: B2 } })) === 0,
  `${cScoped2.status} ${cScoped2.text.slice(0, 160)}`,
);
await db.notebook.delete({ where: { id: B2 } }); // this run's project
const cRemove = await call(C, "DELETE", `/api/links/${legacy}?notebookId=${PA3}`);
const kept = await db.docLink.findUnique({ where: { id: legacy }, include: { replies: true } });
check("C removes A's link from A's project: 200, the row and A's reply stay", cRemove.status === 200 && !!kept && kept.replies.length === 1, `${cRemove.status} ${cRemove.text.slice(0, 160)}`);
check("…and it is hidden in A's project C edits", (await db.docLinkHidden.count({ where: { docLinkId: legacy, notebookId: PA3 } })) === 1);
const hiddenTries: [string, { status: number }][] = [
  ["PATCH reason", await call(A, "PATCH", `/api/links/${legacy}`, { reason: "set from an older tab" })],
  ["reply", await call(A, "POST", "/api/replies", { docLinkId: legacy, content: "reply from an older tab" })],
  ["DELETE", await call(C, "DELETE", `/api/links/${legacy}`)],
];
for (const [what, res] of hiddenTries) check(`a hidden link, no project named: ${what} answers 404`, res.status === 404, String(res.status));
const orphan = (await legacyLink(Z, W)).id;
await db.reply.create({ data: { docLinkId: orphan, userId: A.id, content: "A's reply on a link no project holds" } });
const refuse = await call(C, "DELETE", `/api/links/${orphan}`);
check(
  "no project to hide it in: the removal answers 409 and keeps the row and A's reply",
  refuse.status === 409 && (await db.reply.count({ where: { docLinkId: orphan } })) === 1,
  `${refuse.status} ${refuse.text.slice(0, 160)}`,
);
await db.notebook.delete({ where: { id: PA3 } }); // this run's project
await db.document.deleteMany({ where: { id: { in: madeDocs } } }); // this run's documents, with their links

// Clean up only the links this run made (their replies go with them).
await db.docLink.deleteMany({ where: { id: { in: made } } });
await db.$disconnect();
console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
}

void main();
