// Remove on a link hides it and never deletes it; Undo and History's Restore
// bring it back (WALK5-01, WALK5-08); an older tab's Remove of a link that
// must stay for another account answers 409 Reload and hides nothing
// (REV5-01). Runs on a COPY of the database seeded with the round 3, 4 and 5
// review seeds (.qa-tmp/stitch/r3/rev/seed.sql, seed2.sql, r4/rev/seed4.sql,
// r5/audit/rev/seed5.sql): A (rev3-sa) owns P (rev3-p) and Q, B (rev3-sb)
// owns Z (rev5-z) holding rev4-d3/d4 too, C (rev3-sc) edits P and Z, V
// (rev5-sv) views P. A sign-in-on dev server must run on the same copy.
//
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dissect_r5safe5 \
//     npx tsx scripts/qa/link-remove-check.ts [http://localhost:3161]
//
// It refuses the shared database "dissect". It deletes only the rows it made.
import { PrismaClient } from "@prisma/client";

const BASE = process.argv[2] ?? "http://localhost:3161";
const url = new URL(process.env.DATABASE_URL ?? "");
const dbName = url.pathname.replace(/^\//, "");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || dbName === "dissect" || !dbName) {
  console.error(`Refusing: ${url.hostname}/${dbName} is not a local database copy.`);
  process.exit(1);
}
const db = new PrismaClient();
const S = { A: "rev3-sa", B: "rev3-sb", C: "rev3-sc", V: "rev5-sv" } as const;
type Who = keyof typeof S;
const U = { A: "rev3-ua", B: "rev3-ub", C: "rev3-uc" } as const;
const P = "rev3-p";
const Z = "rev5-z";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
}
async function call(who: Who, method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `dissect-session=${S[who]}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
async function graphLinks(who: Who, nb: string): Promise<string[]> {
  const r = await call(who, "GET", `/api/notebooks/${nb}/graph`);
  if (r.status !== 200) return [`status ${r.status}`];
  const data = JSON.parse(r.text) as { edges: { links: { id: string }[] }[]; recommended?: { id: string }[] };
  return data.edges.flatMap((e) => e.links.map((l) => l.id));
}
const hiddenIn = async (id: string) =>
  (await db.docLinkHidden.findMany({ where: { docLinkId: id }, select: { notebookId: true } })).map((h) => h.notebookId).sort();
const removeEdit = (id: string) =>
  db.blockEdit.findFirst({ where: { kind: "LINK_REMOVE", meta: { path: ["linkId"], equals: id } }, orderBy: { createdAt: "desc" } });
// The page carries the History in its RSC payload, escaped or not.
const offersRestore = (page: string, id: string) =>
  page.includes(`restoreLinkId\\":\\"${id}`) || page.includes(`"restoreLinkId":"${id}"`);
const made: string[] = [];
async function link(opts: { by: string; notebookId: string | null; from: string; fromBlock: string; to: string; toBlock: string; recommended?: boolean; reason?: string }) {
  const l = await db.docLink.create({
    data: {
      createdById: opts.by,
      notebookId: opts.notebookId,
      recommended: opts.recommended ?? false,
      reason: opts.reason ?? null,
      fromDocumentId: opts.from,
      fromBlockId: opts.fromBlock,
      startOffset: 0,
      endOffset: 9,
      quotedText: "Suffering",
      prefix: "",
      suffix: " is the ground",
      toDocumentId: opts.to,
      toBlockId: opts.toBlock,
      toQuotedText: "Compassion",
      createdAt: new Date("2026-01-01"),
    },
  });
  made.push(l.id);
  return l.id;
}
const d34 = { from: "rev4-d3", fromBlock: "rev4-b3", to: "rev4-d4", toBlock: "rev4-b4" };

async function main() {
  const replies0 = await db.reply.count();

  // ── 1. The reader's own link, no replies: hidden, kept, Undo ─────────────
  console.log("== Remove, then Undo");
  const own = await link({ by: U.A, notebookId: P, ...d34, reason: "SAFE5: the teacher and the critique" });
  const r1 = await call("A", "DELETE", `/api/links/${own}?notebookId=${P}`);
  const body1 = r1.status === 200 ? (JSON.parse(r1.text) as { hidden?: string[]; editId?: string }) : {};
  check("A removes A's link with no replies: 200", r1.status === 200, `${r1.status} ${r1.text.slice(0, 160)}`);
  check("…the DocLink row and its reason stay", (await db.docLink.findUnique({ where: { id: own } }))?.reason === "SAFE5: the teacher and the critique");
  check("…hidden in P only", JSON.stringify(await hiddenIn(own)) === JSON.stringify([P]), JSON.stringify(await hiddenIn(own)));
  check("…the answer names the hide and the edit", JSON.stringify(body1.hidden) === JSON.stringify([P]) && typeof body1.editId === "string", r1.text);
  const meta1 = (await removeEdit(own))?.meta as Record<string, unknown> | null;
  check(
    "…the LINK_REMOVE meta keeps the project, the hide rows, the reason, and both ends' words",
    meta1?.notebookId === P && JSON.stringify(meta1?.hiddenIn) === JSON.stringify([P]) && meta1?.reason === "SAFE5: the teacher and the critique" && meta1?.toQuotedText === "Compassion" && meta1?.quotedText === "Suffering",
    JSON.stringify(meta1),
  );
  check("…P's graph no longer draws it", !(await graphLinks("A", P)).includes(own));
  const u1 = await call("A", "DELETE", `/api/links/${own}/hidden?notebookId=${P}`);
  check("Undo: 200, the hide row goes", u1.status === 200 && (await hiddenIn(own)).length === 0, `${u1.status} ${u1.text.slice(0, 160)}`);
  check("…P's graph draws it again", (await graphLinks("A", P)).includes(own));
  const restoredEdit = await db.blockEdit.findFirst({ where: { kind: "LINK_ADD", meta: { path: ["linkId"], equals: own } } });
  check("…recorded as a LINK_ADD with meta.restored, by A", (restoredEdit?.meta as { restored?: boolean } | null)?.restored === true && restoredEdit?.userId === U.A);
  const u1b = await call("A", "DELETE", `/api/links/${own}/hidden?notebookId=${P}`);
  check("a second Undo answers 404 and writes nothing", u1b.status === 404, String(u1b.status));

  // ── 2. An editor removes the owner's link; the owner restores it ────────
  console.log("== an editor's Remove, the owner's Restore");
  const owners = await link({ by: U.A, notebookId: P, ...d34 });
  await db.reply.create({ data: { docLinkId: owners, userId: U.A, content: "SAFE5: A's reply" } });
  const r2 = await call("C", "DELETE", `/api/links/${owners}?notebookId=${P}`);
  check("C (editor) removes A's link with A's reply: 200, hidden in P, row and reply kept", r2.status === 200 && JSON.stringify(await hiddenIn(owners)) === JSON.stringify([P]) && (await db.reply.count({ where: { docLinkId: owners } })) === 1, `${r2.status} ${r2.text.slice(0, 160)}`);
  const page = await fetch(`${BASE}/n/${P}`, { headers: { Cookie: `dissect-session=${S.A}` } }).then((r) => r.text());
  check("A's page offers Restore on C's removal (restoreLinkId in the history)", offersRestore(page, owners), `page ${page.length} bytes`);
  const pageV = await fetch(`${BASE}/n/${P}`, { headers: { Cookie: `dissect-session=${S.V}` } }).then((r) => r.text());
  check("V's (viewer) page offers no Restore", pageV.length > 1000 && !pageV.includes(`restoreLinkId`), `page ${pageV.length} bytes`);
  const v2 = await call("V", "DELETE", `/api/links/${owners}/hidden?notebookId=${P}`);
  check("V (viewer) Restore: refused (403), still hidden", v2.status === 403 && (await hiddenIn(owners)).length === 1, String(v2.status));
  const b2 = await call("B", "DELETE", `/api/links/${owners}/hidden?notebookId=${P}`);
  check("B (not in P) Restore: refused, still hidden", (b2.status === 403 || b2.status === 404) && (await hiddenIn(owners)).length === 1, String(b2.status));
  const n2 = await call("A", "DELETE", `/api/links/${owners}/hidden`);
  check("Restore with no project named: 400, still hidden", n2.status === 400 && (await hiddenIn(owners)).length === 1, String(n2.status));
  const a2 = await call("A", "DELETE", `/api/links/${owners}/hidden?notebookId=${P}`);
  check("A (owner) restores C's removal: 200, shown in P with its reply", a2.status === 200 && (await graphLinks("A", P)).includes(owners) && (await db.reply.count({ where: { docLinkId: owners } })) === 1, `${a2.status} ${a2.text.slice(0, 160)}`);
  const pageAfter = await fetch(`${BASE}/n/${P}`, { headers: { Cookie: `dissect-session=${S.A}` } }).then((r) => r.text());
  check("…History no longer offers Restore for it", pageAfter.length > 1000 && !offersRestore(pageAfter, owners));

  // ── 3. REV5-01: an older tab, a link that must stay for another account ─
  console.log("== an older tab (no project named)");
  const legacy = await link({ by: U.C, notebookId: null, ...d34, reason: "SAFE5: C made this" });
  await db.reply.create({ data: { docLinkId: legacy, userId: U.A, content: "SAFE5: A's reply on a link with no project" } });
  const zBefore = (await graphLinks("B", Z)).includes(legacy);
  const r3 = await call("C", "DELETE", `/api/links/${legacy}`);
  check("C's older tab removes it: 409 Reload", r3.status === 409, `${r3.status} ${r3.text.slice(0, 160)}`);
  check("…hidden nowhere, no history record, still in B's Z and A's P", (await hiddenIn(legacy)).length === 0 && !(await removeEdit(legacy)) && zBefore && (await graphLinks("B", Z)).includes(legacy) && (await graphLinks("A", P)).includes(legacy));
  const r3b = await call("C", "DELETE", `/api/links/${legacy}?notebookId=${P}`);
  check("C removes it from P: 200, hidden in P only, still in B's Z", r3b.status === 200 && JSON.stringify(await hiddenIn(legacy)) === JSON.stringify([P]) && (await graphLinks("B", Z)).includes(legacy), `${r3b.status} ${await hiddenIn(legacy)}`);
  check("…its history record names P", ((await removeEdit(legacy))?.meta as { notebookId?: string } | null)?.notebookId === P);

  // ── 4. An older tab, a link only one account's projects show ────────────
  const docs = await Promise.all(
    ["SAFE5 solo X", "SAFE5 solo Y"].map((title) =>
      db.document.create({ data: { title, blocks: { create: [{ order: 0, type: "PARAGRAPH", text: "Suffering is the ground of compassion." }] } }, include: { blocks: true } }),
    ),
  );
  for (const d of docs) await db.notebookDocument.create({ data: { notebookId: P, documentId: d.id } });
  const solo = await link({ by: U.A, notebookId: null, from: docs[0].id, fromBlock: docs[0].blocks[0].id, to: docs[1].id, toBlock: docs[1].blocks[0].id });
  const r4 = await call("A", "DELETE", `/api/links/${solo}`);
  check("A's older tab removes A's link only A's P shows: 200, hidden in P, row kept", r4.status === 200 && JSON.stringify(await hiddenIn(solo)) === JSON.stringify([P]) && !!(await db.docLink.findUnique({ where: { id: solo } })), `${r4.status} ${r4.text.slice(0, 160)}`);
  check("…its history record names P", ((await removeEdit(solo))?.meta as { notebookId?: string } | null)?.notebookId === P);

  // ── 5. Dismiss on a recommended link is unchanged ───────────────────────
  const rec = await link({ by: U.A, notebookId: P, ...d34, recommended: true });
  const r5 = await call("A", "DELETE", `/api/links/${rec}?notebookId=${P}`);
  check("Dismiss on A's recommended link with no replies: 200, the proposal is deleted, no history record", r5.status === 200 && !(await db.docLink.findUnique({ where: { id: rec } })) && !(await removeEdit(rec)), String(r5.status));

  // ── Every reply this run did not make is untouched ───────────────────────
  check("Reply rows: only this run's 2 were added", (await db.reply.count()) === replies0 + 2);

  // Clean up only this run's rows.
  await db.blockEdit.deleteMany({ where: { OR: made.map((id) => ({ meta: { path: ["linkId"], equals: id } })) } });
  await db.docLink.deleteMany({ where: { id: { in: made } } });
  await db.notebookDocument.deleteMany({ where: { documentId: { in: docs.map((d) => d.id) } } });
  await db.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } });
  await db.$disconnect();
  console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
