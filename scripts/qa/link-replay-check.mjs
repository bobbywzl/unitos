// REV8-01: a note or a reply on a link, replayed from the offline queue
// (x-unitos-replay), after another editor removed the link, after its
// document left the project, or when the link is gone or another account's.
// Runs on a COPY of the database seeded with the review seeds (r3 seed and
// seed2, r4 seed4, r5 seed5, r6 seed6; see link-remove-check.ts) and a
// sign-in-on dev server on the same copy. A = rev3-sa (owner of P,
// rev3-p), C = rev3-sc (editor), V = rev5-sv (viewer).
//   DB=dissect_r8safe8 BASE=http://localhost:3173 node scripts/qa/link-replay-check.mjs
// It refuses the shared database "dissect"; it deletes only the rows it made
// and restores the link it removed.
import { execFileSync } from "node:child_process";
const BASE = process.env.BASE ?? "http://localhost:3173";
const DB = process.env.DB ?? "dissect_r8safe8";
if (DB === "dissect") {
  console.error("Refusing the shared database.");
  process.exit(1);
}
const q = (sql) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", sql], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
const call = async (who, method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Cookie: `dissect-session=${who}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, kept: res.headers.get("x-unitos-quotes-kept"), text: await res.text() };
};
const REPLAY = () => ({ "x-unitos-replay": String(Date.now() - 600e3) });
const TAG = `SAFE8 ${Date.now().toString(36)}`;
let pass = 0, fail = 0;
const check = (name, ok, info = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${info ? " | " + info : ""}`); };
const noteRow = (c) => q(`SELECT n.content || ' || sources: ' || (SELECT count(*) FROM "Source" s WHERE s."noteId"=n.id) FROM "Note" n WHERE n.content LIKE '${c}%' LIMIT 1`);
try {
  let r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} control`, fromLinkId: "rev6-l11" }, REPLAY());
  const controlSources = noteRow(`${TAG} control`).split("sources: ")[1];
  check("link shown, replay: saved with the link's sources", r.status === 201 && Number(controlSources) >= 1, `${r.status} sources ${controlSources} (rev6-l11's to end has no offsets: 1 source)`);
  r = await call("rev3-sc", "DELETE", "/api/links/rev6-l11?notebookId=rev3-p");
  check("C removes rev6-l11 in P", r.status === 200, r.text.slice(0, 60));
  r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} online`, fromLinkId: "rev6-l11" });
  check("removed, online: 404 (the composer keeps the draft)", r.status === 404, r.text.slice(0, 50));
  r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} note on removed`, fromLinkId: "rev6-l11" }, REPLAY());
  check("removed, replay: note saved with the same sources as the control", r.status === 201 && noteRow(`${TAG} note on removed`).endsWith(`sources: ${controlSources}`), `${r.status} ${noteRow(`${TAG} note on removed`)}`);
  r = await call("rev3-sa", "POST", "/api/replies", { docLinkId: "rev6-l11", notebookId: "rev3-p", content: `${TAG} reply online` });
  check("reply on removed, online: 404", r.status === 404);
  r = await call("rev3-sa", "POST", "/api/replies", { docLinkId: "rev6-l11", notebookId: "rev3-p", content: `${TAG} reply on removed` }, REPLAY());
  check("reply on removed, replay: saved on the kept row", r.status === 201 && q(`SELECT count(*) FROM "Reply" WHERE "docLinkId"='rev6-l11' AND content='${TAG} reply on removed'`) === "1", `${r.status}`);
  r = await call("rev5-sv", "POST", "/api/replies", { docLinkId: "rev6-l11", notebookId: "rev3-p", content: `${TAG} viewer reply` }, REPLAY());
  check("viewer's replayed reply on removed: still refused (403)", r.status === 403, `${r.status}`);
  r = await call("rev3-sa", "GET", "/api/notebooks/rev3-p/graph");
  check("the removed link is still not drawn in P", r.status === 200 && !r.text.includes('"rev6-l11"'), `${r.status}`);
  // Restore brings the link back with the replayed reply.
  r = await call("rev3-sc", "DELETE", "/api/links/rev6-l11/hidden?notebookId=rev3-p");
  check("Restore: the link is back", r.status === 200);
  // A link of P whose end document left P (not attached): quotes kept as text.
  q(`INSERT INTO "Document"(id,title) VALUES ('safe8-dx','SAFE8 DX') ON CONFLICT DO NOTHING`);
  q(`INSERT INTO "Block"(id,"documentId","order",type,text) VALUES ('safe8-bx','safe8-dx',0,'PARAGRAPH','Detached words here.') ON CONFLICT DO NOTHING`);
  q(`INSERT INTO "DocLink"(id,"createdById","notebookId","fromDocumentId","fromBlockId","startOffset","endOffset","quotedText",prefix,suffix,"toDocumentId","toBlockId","toStartOffset","toEndOffset","toQuotedText","createdAt") SELECT 'safe8-l1','rev3-ua','rev3-p',"fromDocumentId","fromBlockId","startOffset","endOffset","quotedText",prefix,suffix,'safe8-dx','safe8-bx',0,8,'Detached',now() FROM "DocLink" WHERE id='rev6-l11' ON CONFLICT DO NOTHING`);
  r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} note on detached`, fromLinkId: "safe8-l1" });
  check("a link of P with an end outside P, online: 404", r.status === 404);
  r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} note on detached`, fromLinkId: "safe8-l1" }, REPLAY());
  const det = noteRow(`${TAG} note on detached`);
  check("same, replay: words + both quotes as text, no sources, header says 2", r.status === 201 && r.kept === "2" && det.includes("> Suffering") && det.includes("> Detached") && det.endsWith("sources: 0"), `${r.status} kept=${r.kept} ${JSON.stringify(det)}`);
  // A link that is gone: words alone.
  r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} note on gone`, fromLinkId: "safe8-gone" }, REPLAY());
  check("gone link, replay: the words alone", r.status === 201 && noteRow(`${TAG} note on gone`) === `${TAG} note on gone || sources: 0`, `${r.status} ${noteRow(`${TAG} note on gone`)}`);
  // Another account's link (B's private rev5-l8): words alone, no quote reaches P.
  r = await call("rev3-sa", "POST", "/api/notes", { sectionId: "rev5-s-p", content: `${TAG} note on other`, fromLinkId: "rev5-l8" }, REPLAY());
  const other = noteRow(`${TAG} note on other`);
  check("B's private link, replay: the words alone, nothing of B's", r.status === 201 && !other.includes("B private") && other.endsWith("sources: 0"), `${r.status} ${JSON.stringify(other)}`);
  r = await call("rev3-sa", "POST", "/api/replies", { docLinkId: "rev5-l8", notebookId: "rev3-p", content: `${TAG} reply other` }, REPLAY());
  check("B's private link, replayed reply: still 404 (ends not in P)", r.status === 404, `${r.status}`);
} finally {
  q(`DELETE FROM "Note" WHERE content LIKE '${TAG}%'`);
  q(`DELETE FROM "Reply" WHERE content LIKE '${TAG}%'`);
  q(`DELETE FROM "DocLink" WHERE id='safe8-l1'`);
  q(`DELETE FROM "Block" WHERE id='safe8-bx'`);
  q(`DELETE FROM "Document" WHERE id='safe8-dx'`);
  await call("rev3-sc", "DELETE", "/api/links/rev6-l11/hidden?notebookId=rev3-p");
}
console.log(`${pass} ok, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
