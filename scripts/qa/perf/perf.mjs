// Client-side flow benchmark: dashboard → new project → reader → note → notes page.
// Prints per-step wall time, server TTFB, JS bytes, long-task time.
import { chromium } from "playwright-core";
import { readdirSync } from "node:fs";
const base = process.env.BASE ?? "http://localhost:3400";
const browsers = "/opt/pw-browsers";
const dir = "chromium";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript(() => {
  window.__long = 0; window.__longN = 0;
  window.__seen = {};
  const seen = (sel, key) => { if (!window.__seen[key] && document.querySelector(sel)) window.__seen[key] = performance.now(); };
  const observe = () => new MutationObserver(() => { seen("[data-reader-loading]", "frame"); seen("[data-track-surface='sidebar']", "sidebar"); seen("[data-block-id]", "block"); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) observe(); else document.addEventListener("readystatechange", observe, { once: true });
  document.addEventListener("click", () => { window.__clickAt = performance.now(); window.__seen = {}; }, true);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__long += e.duration; window.__longN++; } }).observe({ type: "longtask", buffered: true }); } catch {}
});
const page = await context.newPage();
let js = 0, jsN = 0, css = 0, reqN = 0, rsc = 0, rscN = 0;
page.on("response", async (r) => {
  reqN++;
  const type = r.request().resourceType();
  try {
    if (type === "script") { js += (await r.body()).length; jsN++; }
    else if (type === "stylesheet") css += (await r.body()).length;
    else if (r.request().headers()["rsc"] === "1") { rsc += (await r.body()).length; rscN++; }
  } catch {}
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const reset = () => { js = 0; jsN = 0; css = 0; reqN = 0; rsc = 0; rscN = 0; };
const nav = () => page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return { ttfb: n.responseStart - n.requestStart, dcl: n.domContentLoadedEventEnd - n.startTime, load: n.loadEventEnd - n.startTime, long: window.__long, longN: window.__longN };
});
const row = (label, ms, extra = "") => console.log(`${label.padEnd(34)} ${String(Math.round(ms)).padStart(6)}ms  ${extra}`);
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

// 1. Dashboard cold.
reset();
let t0 = Date.now();
await page.goto(`${base}/`, { waitUntil: "networkidle" });
let n = await nav();
row("dashboard load (networkidle)", Date.now() - t0, `ttfb ${n.ttfb.toFixed(0)} dcl ${n.dcl.toFixed(0)} load ${n.load.toFixed(0)} js ${kb(js)}/${jsN} css ${kb(css)} req ${reqN} longtask ${n.long.toFixed(0)}ms/${n.longN}`);

// 2. New project: click → reader renders.
reset();
t0 = Date.now();
await page.click("[data-track='new-project']");
await page.waitForURL(/\/n\//, { timeout: 30000 });
const tUrl = Date.now() - t0;
await page.waitForSelector("[data-track-surface='sidebar']", { timeout: 30000 });
await page.waitForLoadState("networkidle");
const seen = await page.evaluate(() => ({ click: window.__clickAt, ...window.__seen }));
const rel = (k) => (seen[k] ? Math.round(seen[k] - seen.click) : "-");
row("new project → reader", Date.now() - t0, `url ${tUrl} frame ${rel("frame")} sidebar(DOM) ${rel("sidebar")} js ${kb(js)}/${jsN} rsc ${kb(rsc)}/${rscN} req ${reqN}`);
const newUrl = page.url();
// A project card from the dashboard: the frame, then the content, timed in the page.
await page.goto(`${base}/`, { waitUntil: "networkidle" });
reset();
await page.click(`a[href="/n/${process.env.NB}"]`);
await page.waitForSelector("[data-block-id]", { timeout: 30000 });
await page.waitForLoadState("networkidle");
const seen2 = await page.evaluate(() => ({ click: window.__clickAt, ...window.__seen }));
const rel2 = (k) => (seen2[k] ? Math.round(seen2[k] - seen2.click) : "-");
row("project card → reader", seen2.block - seen2.click, `frame ${rel2("frame")} sidebar(DOM) ${rel2("sidebar")} block(DOM) ${rel2("block")} js ${kb(js)}/${jsN} req ${reqN}`);
// Close the add dialog if open.
await page.keyboard.press("Escape").catch(() => {});

// 3. Reader with a document, cold load.
const NB = process.env.NB, DOC = process.env.DOC;
reset();
t0 = Date.now();
await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
n = await nav();
row("reader load (networkidle)", Date.now() - t0, `ttfb ${n.ttfb.toFixed(0)} dcl ${n.dcl.toFixed(0)} load ${n.load.toFixed(0)} js ${kb(js)}/${jsN} css ${kb(css)} req ${reqN} longtask ${n.long.toFixed(0)}ms/${n.longN}`);

// 4. Open the notes tray, accept a pending note: PATCH + router.refresh() until the page settles.
await page.click("[data-track-surface='sidebar'] [data-track='notes']").catch(() => {});
await page.waitForTimeout(300);
const pending = page.locator("[data-track-surface='tray'] [data-note-id][data-note-status='PENDING']").first();
if (await pending.count()) {
  const noteId = await pending.getAttribute("data-note-id");
  reset();
  t0 = Date.now();
  await pending.locator("[data-track='note-accept']").first().evaluate((el) => el.click());
  await page.waitForFunction((id) => document.querySelector(`[data-note-id="${id}"]`)?.getAttribute("data-note-status") !== "PENDING", noteId, { timeout: 15000 }).catch(() => {});
  const tAccepted = Date.now() - t0;
  await page.waitForLoadState("networkidle");
  row("accept note → accepted / settled", Date.now() - t0, `accepted ${tAccepted} rsc ${kb(rsc)}/${rscN} req ${reqN}`);
  console.log(`RESTORE_NOTE ${noteId}`);
} else row("accept note", 0, "no pending note found");

// 5. Client navigation to the notes full page.
reset();
t0 = Date.now();
await page.click("[data-track='notes-full-page']").catch(async () => page.goto(`${base}/n/${NB}/notes`));
await page.waitForURL(/\/notes/, { timeout: 30000 });
const tNotesUrl = Date.now() - t0;
await page.waitForLoadState("networkidle");
row("reader → notes full page", Date.now() - t0, `url ${tNotesUrl} js ${kb(js)}/${jsN} rsc ${kb(rsc)}/${rscN} req ${reqN}`);

// 6. Back to the dashboard (client nav).
reset();
t0 = Date.now();
await page.goto(`${base}/`, { waitUntil: "networkidle" });
row("dashboard warm", Date.now() - t0, `js ${kb(js)}/${jsN} req ${reqN}`);

// Delete the project made in step 2 to keep the seed clean.
const id = newUrl.match(/\/n\/([^/?]+)/)?.[1];
if (id) await page.request.delete(`${base}/api/notebooks/${id}`).catch(() => {});
if (errors.length) console.log("page errors:", errors.slice(0, 5));
await browser.close();
