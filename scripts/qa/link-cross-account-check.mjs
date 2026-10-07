// REV2-01 / REV2-02: a link with no project shared across accounts, and a
// deleted project's links. Runs against a sign-in-on dev server on a COPY of
// the database seeded with .qa-tmp/stitch/r2/rev/seed.sql (accounts user-1
// "rev-owner", user-x "rev-other"; rev-big and rev-x share rev-d1, rev-d2;
// rev-legacy-x is user-x's link with no project). Never run it on `dissect`.
//
// Usage: BASE=http://localhost:3141 node scripts/qa/link-cross-account-check.mjs
const BASE = process.env.BASE ?? "http://localhost:3141";
const S = { owner: "rev-owner", other: "rev-other" };
async function call(who, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: `dissect-session=${S[who]}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, text: await res.text() };
}
let failed = 0;
function expect(name, r, status) {
  const ok = r.status === status;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${r.status} (want ${status}) ${r.text.slice(0, 120)}`);
}
const tag = Date.now().toString(36);
const anchor = (b) => ({ blockId: b, startOffset: 0, endOffset: 9, quotedText: "Paragraph", prefix: "", suffix: "" });

// ── REV2-01: user-1 (owner of rev-big) on user-x's link with no project ──
expect("owner reply on other's link, scoped to rev-big", await call("owner", "POST", "/api/replies", { docLinkId: "rev-legacy-x", notebookId: "rev-big", content: `owner ${tag}` }), 403);
expect("owner reply on other's link, no scope", await call("owner", "POST", "/api/replies", { docLinkId: "rev-legacy-x", content: `owner ${tag}` }), 403);
expect("owner resolve other's reply", await call("owner", "PATCH", "/api/replies/rev-reply-x", { resolved: true }), 403);
expect("owner resolve other's reply ?notebookId=rev-big", await call("owner", "PATCH", "/api/replies/rev-reply-x?notebookId=rev-big", { resolved: true }), 403);
expect("owner PATCH reason ?notebookId=rev-big", await call("owner", "PATCH", "/api/links/rev-legacy-x?notebookId=rev-big", { reason: "owner rewrote" }), 403);
expect("owner accept ?notebookId=rev-big", await call("owner", "PATCH", "/api/links/rev-legacy-x?notebookId=rev-big", { accept: true }), 403);
expect("owner DELETE other's link", await call("owner", "DELETE", "/api/links/rev-legacy-x?notebookId=rev-big"), 403);
expect("owner DELETE other's reply", await call("owner", "DELETE", "/api/replies/rev-reply-x"), 403);
// The author of a reply keeps control of it: user-1's own reply on that link (seeded safe-reply-1).
expect("owner resolve own reply on other's link", await call("owner", "PATCH", "/api/replies/safe-reply-1?notebookId=rev-big", { resolved: true }), 200);
expect("owner reopen own reply on other's link", await call("owner", "PATCH", "/api/replies/safe-reply-1?notebookId=rev-big", { resolved: false }), 200);
// The maker's own project works as before.
expect("maker reply on own link from rev-x", await call("other", "POST", "/api/replies", { docLinkId: "rev-legacy-x", notebookId: "rev-x", content: `maker ${tag}` }), 201);
expect("maker resolve own reply", await call("other", "PATCH", "/api/replies/rev-reply-x?notebookId=rev-x", { resolved: true }), 200);
expect("maker reopen own reply", await call("other", "PATCH", "/api/replies/rev-reply-x?notebookId=rev-x", { resolved: false }), 200);
expect("maker resolve user-1's reply (maker's project)", await call("other", "PATCH", "/api/replies/safe-reply-1?notebookId=rev-x", { resolved: true }), 200);
expect("maker reopen user-1's reply", await call("other", "PATCH", "/api/replies/safe-reply-1?notebookId=rev-x", { resolved: false }), 200);
expect("maker DELETE user-1's reply (owner of rev-x, cross-account)", await call("other", "DELETE", "/api/replies/safe-reply-1?notebookId=rev-x"), 403);
expect("maker PATCH reason from rev-x", await call("other", "PATCH", "/api/links/rev-legacy-x?notebookId=rev-x", { reason: "Other account reason" }), 200);
// A link with no project asked from a project that does not hold both documents: not found.
expect("maker reply scoped to rev-big (not a member)", await call("other", "POST", "/api/replies", { docLinkId: "rev-legacy-x", notebookId: "rev-big", content: "x" }), 404);
// Single-account documents keep the old workflow: user-1's own scoped link.
const own = await call("owner", "POST", "/api/replies", { docLinkId: "rev-l1-1", notebookId: "rev-big", content: `own ${tag}` });
expect("owner reply on own link", own, 201);
const ownId = JSON.parse(own.text).id;
expect("owner resolve own-project reply", await call("owner", "PATCH", `/api/replies/${ownId}?notebookId=rev-big`, { resolved: true }), 200);
expect("owner delete own-project reply", await call("owner", "DELETE", `/api/replies/${ownId}?notebookId=rev-big`), 200);

// ── REV2-02: deleting a project keeps its links out of other projects ──
const nb = await call("other", "POST", "/api/notebooks", { title: `SAFE delete ${tag}` });
expect("other creates a project", nb, 201);
const nbId = JSON.parse(nb.text).id;
for (const d of ["rev-d1", "rev-d2"]) {
  await call("other", "POST", `/api/notebooks/${nbId}/documents`, { documentId: d });
}
const link = await call("other", "POST", "/api/links", { notebookId: nbId, fromDocumentId: "rev-d1", toDocumentId: "rev-d2", anchor: anchor("rev-b1-4"), toAnchor: anchor("rev-b2-4") });
expect("other creates link in its project", link, 201);
const linkId = JSON.parse(link.text).id;
await call("other", "PATCH", `/api/links/${linkId}?notebookId=${nbId}`, { reason: `PRIVATE reason ${tag}` });
const rep = await call("other", "POST", "/api/replies", { docLinkId: linkId, notebookId: nbId, content: `PRIVATE reply ${tag}` });
expect("other replies", rep, 201);
let page = await call("owner", "GET", "/n/rev-big?doc=rev-d1");
console.log(`before delete, owner sees PRIVATE reason in rev-big: ${page.text.includes(`PRIVATE reason ${tag}`)}`);
expect("other deletes its project", await call("other", "DELETE", `/api/notebooks/${nbId}`), 200);
page = await call("owner", "GET", "/n/rev-big?doc=rev-d1");
const leak = page.text.includes(`PRIVATE reason ${tag}`) || page.text.includes(`PRIVATE reply ${tag}`);
if (leak) failed++;
console.log(`${leak ? "FAIL" : "PASS"} after delete, owner sees the deleted project's reason or reply in rev-big: ${leak}`);
const rid = JSON.parse(rep.text).id;
expect("owner deletes the other account's reply after the delete", await call("owner", "DELETE", `/api/replies/${rid}`), 404);
expect("owner replies on the deleted project's link", await call("owner", "POST", "/api/replies", { docLinkId: linkId, notebookId: "rev-big", content: "x" }), 404);
expect("owner notes on the deleted project's link", await call("owner", "POST", "/api/notes", { sectionId: "rev-big-s1", content: "x", fromLinkId: linkId }), 404);
console.log(`DELETED_LINK=${linkId} DELETED_REPLY=${rid} DELETED_PROJECT=${nbId}`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
