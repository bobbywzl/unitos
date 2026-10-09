// REV9-03 and REV9-07, the server side: a comment replayed from the offline
// queue whose words left the block saves with an orphaned source instead of
// answering 400 (the words are never dropped), a highlight still answers
// 400, a viewer still gets 403 (the browser keeps the words), and the
// replies route takes a replay mark only as a whole number of ms, as the
// notes route does (lib/replay.ts). Runs on a COPY of the database seeded
// with the review seeds (A = rev3-sa owns P = rev3-p with document rev3-d1,
// block rev3-b1 "Pity is the practice of nihilism."; C = rev3-sc editor of
// P; V = rev5-sv viewer of P; link rev3-l1 in P) with a sign-in-on dev
// server on it:
//   DB=dissect_r9safe9 BASE=http://localhost:3176 node scripts/qa/replay-drop-check.mjs
// Deletes only the rows it made; restores the link it removed.
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3176";
const DB = process.env.DB ?? "";
if (!DB || DB === "dissect") throw new Error("Set DB to a copy of the database, never the shared one.");
const q = (sql) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", sql], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
const call = async (who, method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `dissect-session=${who}`, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON.
  }
  return { status: res.status, text, json };
};
const REPLAY = { "x-unitos-replay": String(Date.now() - 600e3) };
const TAG = `SAFE9 ${Date.now().toString(36)}`;
const A = "rev3-sa";
const C = "rev3-sc";
const V = "rev5-sv";
const LINK = "rev3-l1";
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};
const gone = { blockId: "rev3-b1", startOffset: 0, endOffset: 9, quotedText: "Gone word", prefix: "", suffix: "" };
const there = { blockId: "rev3-b1", startOffset: 0, endOffset: 4, quotedText: "Pity", prefix: "", suffix: "" };
const base = { notebookId: "rev3-p", documentId: "rev3-d1" };
let linkRemoved = false;
try {
  // 1. Online, the words left the block: 400, the reader keeps the box.
  let r = await call(A, "POST", "/api/annotations", { ...base, anchor: gone, comment: `${TAG} typed on the train` });
  check("online, a comment whose words left the block answers 400", r.status === 400, `${r.status}`);
  // 2. Replayed: saved, with the source orphaned on the block the reader commented on.
  r = await call(A, "POST", "/api/annotations", { ...base, anchor: gone, comment: `${TAG} typed on the train` }, REPLAY);
  const src = r.json?.sources?.[0];
  check(
    "replayed, the same comment saves with an orphaned source on that block",
    r.status === 201 && src?.orphaned === true && src?.blockId === "rev3-b1" && src?.quotedText === "Gone word" && src?.documentId === "rev3-d1",
    `${r.status} ${JSON.stringify(src)}`,
  );
  const saved = q(`SELECT n.id || ' ' || n."sectionId" || ' ' || n.status || ' ' || coalesce(n.color, 'null') FROM "Note" n WHERE n.content='${TAG} typed on the train'`);
  check("the note is an accepted comment in the hidden Annotations section", /rev6-s-ann ACCEPTED null$/.test(saved), saved);
  // 3. A second replay of the same record answers the saved note, not a second one.
  r = await call(A, "POST", "/api/annotations", { ...base, anchor: gone, comment: `${TAG} typed on the train` }, REPLAY);
  const count = q(`SELECT count(*) FROM "Note" WHERE content='${TAG} typed on the train'`);
  check("a second replay answers 200 and saves no second comment", r.status === 200 && count === "1", `${r.status}, rows ${count}`);
  // 4. A highlight has no words of the reader's own: 400 on replay too.
  r = await call(A, "POST", "/api/annotations", { ...base, anchor: gone, color: "clay" }, REPLAY);
  check("a replayed highlight whose words left the block still answers 400", r.status === 400, `${r.status}`);
  // 5. A viewer (editor when the comment was queued): 403, the browser keeps the words.
  r = await call(V, "POST", "/api/annotations", { ...base, anchor: there, comment: `${TAG} V comment` }, REPLAY);
  check("a viewer's replayed comment answers 403", r.status === 403, `${r.status}`);
  // 6. REV9-07: the replies route takes the replay mark as a whole number only.
  r = await call(A, "DELETE", `/api/links/${LINK}?notebookId=rev3-p`);
  linkRemoved = r.status === 200;
  check("A removes rev3-l1 in P", linkRemoved, `${r.status}`);
  for (const forged of ["anything", "1.5e3", "-1", "now"]) {
    r = await call(C, "POST", "/api/replies", { docLinkId: LINK, notebookId: "rev3-p", content: `${TAG} C forged ${forged}` }, { "x-unitos-replay": forged });
    check(`a reply on the removed link with the header '${forged}' answers 404 (no replay)`, r.status === 404, `${r.status}`);
  }
  const forgedRows = q(`SELECT count(*) FROM "Reply" WHERE "docLinkId"='${LINK}' AND content LIKE '${TAG} C forged%'`);
  check("no forged reply landed on the hidden link", forgedRows === "0", `rows ${forgedRows}`);
  r = await call(C, "POST", "/api/replies", { docLinkId: LINK, notebookId: "rev3-p", content: `${TAG} C replayed` }, REPLAY);
  check("a reply replayed with a whole-number mark still saves on the removed link's kept row (REV8-01)", r.status === 201, `${r.status}`);
} finally {
  if (linkRemoved) {
    const back = await call(A, "DELETE", `/api/links/${LINK}/hidden?notebookId=rev3-p`);
    console.log(`restore rev3-l1: ${back.status}; hidden rows left ${q(`SELECT count(*) FROM "DocLinkHidden" WHERE "docLinkId"='${LINK}'`)}`);
  }
  q(`DELETE FROM "Reply" WHERE content LIKE '${TAG}%'`);
  q(`DELETE FROM "Note" WHERE content LIKE '${TAG}%'`);
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
