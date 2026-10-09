// A second graph open answers the coverage and the part titles with 304 (COST5-09). Against a dev server with
// sign-in off:  BASE=http://localhost:3164 NB=<project id> node scripts/qa/ui-graph-etag.mjs
// Opens the graph, opens it again in the same browser context, and reports each open's status for
// /graph/coverage (and /outline?parts=titles when the open fetches it) as the server sent it (CDP), with the
// bytes on the wire.
// With DB=<postgres url> as well: two more phases (COST9-05). A change the graph shows arrives from another
// account (a reply on a link, then the rev moves) with the Documents list open, then again with a link open:
// the part titles are read once, and the open link's passages once, not twice.
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3164";
const NB = process.env.NB;
const DB = process.env.DB;
// WAIT: how long one open may take to send and finish its coverage fetch. The graph sends it 150 ms after
// the overlay mounts, which on a webpack dev server comes 4-8 s after the load (round 8).
const WAIT = Number(process.env.WAIT ?? 30000);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
// Service workers blocked: on `next start` the offline copy's worker answers a reopen from its cache, so the
// server is never asked and no 304 can be seen. This check is about the server's answer.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
if (process.env.SESSION) await context.addCookies([{ name: "dissect-session", value: process.env.SESSION, url: BASE }]);
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
// Each request belongs to the open that sent it: a late answer of one open never counts for the next.
let current = 0;
const seen = [];
const openOf = new Map();
const byId = new Map();
const WATCHED = /\/graph\/coverage|outline\?parts=titles|graph\/passages/;
cdp.on("Network.responseReceived", (e) => {
  if (WATCHED.test(e.response.url)) byId.set(e.requestId, { url: e.response.url.replace(/^.*\/api\/notebooks\/[^/]+\//, ""), status: e.response.status, sw: e.response.fromServiceWorker, etag: e.response.headers.ETag ?? e.response.headers.etag, cc: e.response.headers["Cache-Control"] ?? e.response.headers["cache-control"] });
});
cdp.on("Network.requestWillBeSent", (e) => {
  if (!WATCHED.test(e.request.url)) return;
  openOf.set(e.requestId, current);
  console.log(`  open ${current} sent ${e.request.url.replace(/^.*\/api\/notebooks\/[^/]+\//, "")}`);
});
// The raw status the server sent: a revalidated answer reads 200 to the page, from the HTTP cache, and 304
// here (Network.responseReceivedExtraInfo).
const raw = new Map();
cdp.on("Network.responseReceivedExtraInfo", (e) => raw.set(e.requestId, e.statusCode));
cdp.on("Network.loadingFinished", (e) => {
  const r = byId.get(e.requestId);
  if (r) seen.push({ ...r, open: openOf.get(e.requestId), status: raw.get(e.requestId) ?? r.status, bytes: e.encodedDataLength });
});
let failed = 0;
for (const open of [1, 2, 3]) {
  current = open;
  await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "networkidle", timeout: 300000 });
  // Wait for this open's coverage answer (the one fetch every open makes), then a beat for the titles.
  const t0 = Date.now();
  while (!seen.some((s) => s.open === open && s.url.startsWith("graph/coverage")) && Date.now() - t0 < WAIT) await page.waitForTimeout(250);
  await page.waitForTimeout(500);
  const mine = seen.filter((s) => s.open === open);
  console.log(`open ${open}: coverage after ${Date.now() - t0} ms past networkidle`);
  for (const s of mine) console.log(`open ${open}: ${s.url} ${s.status} ${s.bytes} bytes on the wire (ETag ${s.etag})`);
  if (open >= 2) {
    const ok = mine.length >= 1 && mine.every((s) => s.status === 304);
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} open ${open} (a reopen) answers every one with 304`);
  }
}
if (DB) {
  // COST9-05: one read of the titles, and of an open link's passages, per change (graph-data.tsx bumps the
  // graph's generation once per rev move, not again when the refetch answers 200).
  const sql = (q) => execFileSync("psql", [DB, "-Atc", q], { encoding: "utf8", timeout: 20000 }).trim();
  const link = sql(`select id from "DocLink" where ("notebookId"='${NB}' or ("notebookId" is null and "fromDocumentId" in (select "documentId" from "NotebookDocument" where "notebookId"='${NB}'))) and recommended=false order by id limit 1`);
  const until = async (open, prefix) => {
    const t = Date.now();
    while (!seen.some((s) => s.open === open && s.url.startsWith(prefix)) && Date.now() - t < WAIT) await page.waitForTimeout(250);
  };
  // The change, as another account makes it; the sync poll (every 8 s) brings the new rev to the page.
  const change = async (open, n, what, prefix) => {
    current = open;
    sql(`insert into "Reply"(id,"docLinkId","userId",content) values ('ui-graph-etag-'||md5(random()::text), '${link}', 'user-1', 'ui-graph-etag: a reply from another account')`);
    sql(`update "Notebook" set rev = rev + 1 where id='${NB}'`);
    await page.waitForTimeout(Math.max(WAIT, 25000));
    const mine = seen.filter((s) => s.open === open);
    for (const s of mine) console.log(`change ${n}: ${s.url} ${s.status} ${s.bytes} bytes on the wire`);
    const reads = mine.filter((s) => s.url.startsWith(prefix)).length;
    if (reads !== 1) failed++;
    console.log(`${reads === 1 ? "ok  " : "FAIL"} change ${n}: ${what} read ${reads} time(s) (1 expected)`);
  };
  current = 4;
  await page.locator('[data-track="graph-documents"]').first().click();
  await until(4, "outline?parts=titles");
  await page.waitForTimeout(1000);
  await change(5, 1, "the Documents list open, the part titles", "outline?parts=titles");
  // A link opened from a row of the list (the link panel takes the list's place).
  current = 6;
  await page.locator('[data-track="graph-documents-row-open"]').first().click();
  await page.waitForTimeout(1000);
  await page.locator('[data-track="graph-documents-link"]').first().click();
  await until(6, "graph/passages");
  await page.waitForTimeout(1000);
  await change(7, 2, "a link open, its passages", "graph/passages");
  sql(`delete from "Reply" where content = 'ui-graph-etag: a reply from another account'`);
}
await browser.close();
process.exit(failed ? 1 : 0);
