// COST10-04 (SPEC.md §12 Live sync, §13): while the graph is open, a change another account made reaches the
// graph through GET …/notes-view (the notes alone), the page's RSC refresh waits until the graph closes and
// then runs once, and words typed in a tray note before the graph opened are kept through it all, even while
// their save fails (rule zero 6). Against a dev server with sign-in on, on a COPY of the database:
//   BASE=http://localhost:3171 DB=<db name> NB=<project id> DOC=<document id> NOTE=<note id> \
//   LINDA=<session token>:<account id> MARA=<account id> node scripts/qa/ui-graph-deferred-refresh.mjs
// NB is shared with MARA (an editor); NOTE is LINDA's accepted note written in DOC (the tray lists it with DOC
// open). Writes, in the copy: one note by MARA in NB's first section (deleted at the end), the typed words on
// NOTE (its content restored at the end). Refuses "dissect".
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:3171";
const DB = process.env.DB ?? "";
const NB = process.env.NB ?? "";
const DOC = process.env.DOC ?? "";
const NOTE = process.env.NOTE ?? "";
const [LINDA_SESSION, LINDA_ID] = (process.env.LINDA ?? "").split(":");
const MARA = process.env.MARA ?? "walk8-mara";
if (!DB || DB === "dissect" || !NB || !DOC || !NOTE || !LINDA_SESSION || !LINDA_ID) {
  console.error("DB (not dissect), NB, DOC, NOTE and LINDA=<session>:<account> are required");
  process.exit(1);
}
const psql = (sql) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-tAc", sql], { env: { ...process.env, PGPASSWORD: "postgres" }, timeout: 20000 })
    .toString()
    .trim();
const WORDS = `COST10 kept ${Date.now().toString(36)}`;
const TAG = `[COST10] Mara live note ${Date.now().toString(36)}`;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, step = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return fn();
};

const original = psql(`SELECT content FROM "Note" WHERE id = '${NOTE}'`);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const maraNote = `cost10-live-${Date.now().toString(36)}`;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([
    { name: "dissect-session", value: LINDA_SESSION, domain: host, path: "/" },
    { name: "dissect-account", value: LINDA_ID, domain: host, path: "/" },
  ]);
  const page = await ctx.newPage();
  const log = [];
  page.on("response", async (res) => {
    const r = res.request();
    const rsc = !!r.headers()["rsc"];
    const url = r.url();
    if (!rsc && !url.includes("/api/notebooks/")) return;
    let bytes = 0;
    try {
      bytes = (await res.body()).length;
    } catch {
      // a 304 or an aborted body
    }
    log.push({ t: Date.now(), rsc, url: url.replace(BASE, "").replace(NB, "NB").slice(0, 80), status: res.status(), bytes });
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const rscSince = (t) => log.filter((e) => e.rsc && e.t >= t);
  const apiSince = (t, part) => log.filter((e) => !e.rsc && e.t >= t && e.url.includes(part));

  await page.goto(`${BASE}/n/${NB}?doc=${DOC}`, { waitUntil: "domcontentloaded", timeout: 300000 });
  const card = page.locator(`[data-note-id="${NOTE}"]`).first();
  await card.waitFor({ timeout: 120000 });
  check("the tray lists the note", true);

  // 1. Type into the note while its saves fail: the words live in the editor and the browser's draft alone.
  await page.route("**/api/notes/*", (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()));
  const editor = page.locator(`[data-note-id="${NOTE}"] [contenteditable]`).first();
  // A click before the page is hydrated opens nothing: try again until the editor is there.
  for (let i = 0; i < 4 && (await editor.count()) === 0; i++) {
    await card.locator('[data-track="note-edit"]').first().click({ force: true }).catch(() => undefined);
    await editor.waitFor({ timeout: 8000 }).catch(() => undefined);
  }
  await editor.waitFor({ timeout: 20000 });
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(` ${WORDS}`);
  await sleep(2500);
  const typed = async () => (await editor.innerText()).includes(WORDS);
  check("the editor holds the typed words", await typed());
  check("the save failed (blocked), so the words are unsaved", !psql(`SELECT content FROM "Note" WHERE id = '${NOTE}'`).includes(WORDS));

  // 2. Open the graph from the rail (the focus leaves the editor; the editor stays open under the overlay).
  await ((await page.locator('[data-track="graph"]').first().isVisible()) ? page.locator('[data-track="graph"]').first().click() : page.locator('[data-track="more"]').click().then(() => page.locator('[data-track="more:graph"]').click()));
  await page.waitForSelector(".graph-overlay-in", { timeout: 120000 });
  await until(() => apiSince(0, "/graph").some((e) => e.url.endsWith("/graph") || e.url.includes("/graph?")), 60000);
  await sleep(1500);
  const opened = Date.now();
  check("the graph is open", true, `${rscSince(0).length} RSC refresh(es) before the change`);

  // 3. Mara's note lands, and the rev moves.
  const section = psql(`SELECT id FROM "Section" WHERE "notebookId" = '${NB}' AND NOT hidden ORDER BY "order" LIMIT 1`);
  psql(
    `INSERT INTO "Note" (id, "sectionId", content, status, "order", "createdById", "documentId", "createdAt", "updatedAt") VALUES ('${maraNote}', '${section}', '# ${TAG}' || chr(10) || 'Made while Linda had the graph open.', 'ACCEPTED', 900, '${MARA}', '${DOC}', now(), now())`,
  );
  psql(
    `INSERT INTO "Source" (id, "noteId", "documentId", "blockId", "startOffset", "endOffset", "quotedText", prefix, suffix) SELECT '${maraNote}-s', '${maraNote}', '${DOC}', b.id, 0, 20, left(b.text, 20), '', '' FROM "Block" b WHERE b."documentId" = '${DOC}' AND b.type = 'PARAGRAPH' ORDER BY b."order" LIMIT 1`,
  );
  psql(`UPDATE "Notebook" SET rev = rev + 1 WHERE id = '${NB}'`);
  const changed = Date.now();

  // 4. Within the poll's 8 s the notes view is read and the graph shows the note; the page did not refresh.
  const sawNotes = await until(() => apiSince(changed, "/notes-view").some((e) => e.status === 200), 20000);
  const nv = apiSince(changed, "/notes-view");
  check("a rev move while the graph is open reads …/notes-view (200)", sawNotes, nv.map((e) => `${e.status} ${e.bytes} B at +${((e.t - changed) / 1000).toFixed(1)} s`).join(", "));
  await page.locator('[data-track="graph-notes"]').first().click({ force: true }).catch(() => undefined);
  // Mara's note is new to Linda, so it lists first among the notes across
  // documents while new (WALK10-01), not under "n notes on one document".
  const row = page.locator(`[data-graph-notes-row="${maraNote}"]`);
  const shown = await until(() => row.count().then((n) => n > 0), 15000);
  check("the graph's Notes list shows Mara's note within the poll", shown, `+${((Date.now() - changed) / 1000).toFixed(1)} s`);
  check("the tray under the graph lists it too", (await page.locator(`[data-note-id="${maraNote}"]`).count()) > 0);
  const refetched = await until(() => apiSince(changed, "/graph").some((e) => (e.url.endsWith("/graph") || e.url.includes("/graph?")) && (e.status === 200 || e.status === 304)), 10000);
  check("the graph refetched its data at the moved rev (200 or 304)", refetched);
  check("no RSC refresh while the graph is open", rscSince(opened).length === 0, `${rscSince(opened).length}`);
  check("the editor under the graph still holds the typed words", await typed());

  // 5. Close the graph: the refresh that waited runs once, and the words stay.
  await page.locator('[data-track="graph-close"]').first().click();
  const closed = Date.now();
  const refreshed = await until(() => rscSince(closed).length >= 1, 20000);
  check("closing the graph runs the waiting refresh", refreshed, rscSince(closed).map((e) => `${e.status} ${e.bytes} B at +${((e.t - closed) / 1000).toFixed(1)} s`).join(", "));
  await sleep(12000);
  check("…once", rscSince(closed).length === 1, `${rscSince(closed).length} refresh(es) within 12 s more`);
  check("the tray lists Mara's note after the refresh", (await page.locator(`[data-note-id="${maraNote}"]`).count()) > 0);
  check("the editor still holds the typed words after the refresh", await typed());

  // 6. Saves work again: the words reach the server.
  await page.unroute("**/api/notes/*");
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type(".");
  const saved = await until(() => psql(`SELECT content FROM "Note" WHERE id = '${NOTE}'`).includes(WORDS), 15000);
  check("once saves work again the typed words reach the server", saved);
  check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
  await ctx.close();
} finally {
  await browser.close();
  psql(`DELETE FROM "Source" WHERE "noteId" = '${maraNote}'`);
  psql(`DELETE FROM "Note" WHERE id = '${maraNote}'`);
  psql(`UPDATE "Note" SET content = $q$${original}$q$ WHERE id = '${NOTE}'`);
  console.log(`cleanup: Mara's note deleted, the note's content restored`);
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
