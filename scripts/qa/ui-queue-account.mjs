// REV9-01: A's offline writes, still queued when A signs out, meet B's
// sign-in on the same browser. The queue sends only the signed-in account's
// records (lib/offline/queue.ts): A's wait, uncounted, and the middleware's
// 409 (`code: "accountChanged"`) keeps a record too. When A signs in again,
// A's records land. Runs on a COPY of the database seeded with the review
// seeds (see link-remove-check.ts: A = rev3-ua owns P = rev3-p, B = rev3-ub
// owns X = rev3-x, C's comment rev6-n-c is in P) with a sign-in-on dev
// server on it.
//   DB=dissect_r9safe9 BASE=http://localhost:3176 node scripts/qa/ui-queue-account.mjs
// It refuses the shared database "dissect" and deletes only the rows it made.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3176";
const DB = process.env.DB ?? "dissect_r9safe9";
if (DB === "dissect") {
  console.error("Refusing the shared database.");
  process.exit(1);
}
const q = (s) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", s], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
const TAG = `SAFE9 account ${Date.now().toString(36)}`;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const warns = [];
  page.on("console", (m) => {
    if (/Offline sync/.test(m.text())) warns.push(m.text());
  });
  // B is signed in on this browser now (session and account cookies, as login sets them).
  const signIn = async (session, account) => {
    await ctx.clearCookies();
    await ctx.addCookies([
      { name: "dissect-session", value: session, url: BASE },
      { name: "dissect-account", value: account, url: BASE },
      { name: "dissect-lang", value: "en", url: BASE },
    ]);
  };
  await signIn("rev3-sb", "rev3-ub");
  // A page with no app shell first, so no drain runs before the records land.
  await page.goto(`${BASE}/manifest.webmanifest`, { timeout: 120000 }).catch(() => page.goto(`${BASE}/robots.txt`));
  // A's records, as queueWrite stores them: a reply on C's comment and a comment in the reader, both in P (A owns P).
  await page.evaluate(
    async ({ TAG }) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open("unitos-offline", 3);
        r.onupgradeneeded = () => {
          for (const s of ["writes", "uploads"]) r.result.createObjectStore(s, { autoIncrement: true });
          r.result.createObjectStore("saved", { keyPath: "id" });
          r.result.createObjectStore("docDrafts", { keyPath: "id" });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const t = db.transaction("writes", "readwrite").objectStore("writes");
      const now = Date.now() - 3600e3;
      t.add({ path: "/api/replies", method: "POST", body: { noteId: "rev6-n-c", content: `${TAG} A's reply typed offline` }, account: "rev3-ua", queuedAt: now });
      t.add({
        path: "/api/annotations",
        method: "POST",
        body: {
          notebookId: "rev3-p",
          documentId: "rev3-d1",
          comment: `${TAG} A's comment typed offline`,
          anchor: { blockId: "rev3-b1", startOffset: 0, endOffset: 4, quotedText: "Pity", prefix: "", suffix: " is the practice" },
        },
        account: "rev3-ua",
        queuedAt: now,
      });
      await new Promise((r) => (t.transaction.oncomplete = r));
    },
    { TAG },
  );
  const count = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          const r = indexedDB.open("unitos-offline");
          r.onsuccess = () => {
            const c = r.result.transaction("writes").objectStore("writes").count();
            c.onsuccess = () => res(c.result);
          };
        }),
    );
  check("A's two records are queued", (await count()) === 2);
  // B opens the app: QueueSync drains on app start.
  await page.goto(`${BASE}/n/rev3-x`, { waitUntil: "networkidle", timeout: 300000 });
  await page.waitForTimeout(4000);
  const leftForB = await count();
  check("after B's app start A's records are still queued", leftForB === 2, `records left ${leftForB}`);
  check("no record was dropped", warns.length === 0, warns.join(" | "));
  const rows = () => ({
    replies: Number(q(`SELECT count(*) FROM "Reply" WHERE content LIKE '${TAG}%'`)),
    comments: Number(q(`SELECT count(*) FROM "Note" WHERE content LIKE '${TAG}%'`)),
  });
  let saved = rows();
  check("nothing of A's was written as B", saved.replies === 0 && saved.comments === 0, JSON.stringify(saved));
  // B's pill does not count A's records: online with nothing of B's queued, no pill.
  const pill = await page.locator('[role="status"]').filter({ hasText: /sync|Syncing|saved for/ }).count();
  check("B's offline pill does not count A's records", pill === 0, `pills ${pill}`);
  // A signs in again on this browser: the drain sends A's records.
  await signIn("rev3-sa", "rev3-ua");
  await page.goto(`${BASE}/n/rev3-p`, { waitUntil: "networkidle", timeout: 300000 });
  let left = await count();
  for (let i = 0; i < 60 && left > 0; i++) {
    await page.waitForTimeout(500);
    left = await count();
  }
  check("A back: the queue drains", left === 0, `records left ${left}`);
  saved = rows();
  check("A back: A's reply and comment are saved, as A", saved.replies === 1 && saved.comments === 1, JSON.stringify(saved));
  const by = q(`SELECT string_agg(DISTINCT "userId", ',') FROM "Reply" WHERE content LIKE '${TAG}%'`);
  check("the reply is A's", by === "rev3-ua", by);
  check("no record was dropped on the way", warns.length === 0, warns.join(" | "));
  await ctx.close();
} finally {
  q(`DELETE FROM "Reply" WHERE content LIKE '${TAG}%'`);
  q(`DELETE FROM "Source" WHERE "noteId" IN (SELECT id FROM "Note" WHERE content LIKE '${TAG}%')`);
  q(`DELETE FROM "Note" WHERE content LIKE '${TAG}%'`);
  await browser.close();
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
