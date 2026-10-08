// The graph of a project saved for offline opens without a network (GR-18,
// SPEC.md §13, §17): the copy keeps GET .../graph and each document's
// GET .../outline, and the service worker answers them offline. Round 3
// (COST3-03, VIEW3-06): the copy also keeps .../graph?provenance=1 (only
// when an edge counts provenance links, COST4-05), every
// link's passages (.../graph/passages: a link panel draws its passages
// offline) and the part titles (.../outline?parts=titles: the Documents list). On a dev
// server the worker is not registered by the app, so the script registers
// public/sw.js itself, saves the project from the reader's Save for offline
// pill, goes offline, reloads the graph, and opens a node card.
//
//   BASE=http://localhost:3143 OUT=<dir> node scripts/qa/ui-graph-offline.mjs
// It removes the copy at the end (the pill again).

import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3143";
const OUT = process.env.OUT ?? "/mnt/project-files/stitch-graph-loop/round-2/view2";
const TAG = process.env.TAG ?? "";
const seed = JSON.parse(fs.readFileSync(process.env.SEED ?? "/home/user/unitos/.qa-tmp/stitch/r2/view/seed.json", "utf8"));
const NB = seed.notebookId;
const NCN = seed.docs.find((d) => d.title === "Nietzsche combined notes").id;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const out = {};
page.on("console", (m) => (m.text().startsWith("KEYS") || m.type() === "error") && console.log("CONSOLE", m.text().slice(0, 160)));
page.on("requestfailed", (r) => r.url().includes("/_next/") || r.url().includes("/api/") ? console.log("REQFAIL", r.url().slice(0, 140)) : null);
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

await page.goto(`${BASE}/n/${NB}`, { waitUntil: "networkidle", timeout: 300000 });
await page.evaluate(async () => {
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
});
await page.reload({ waitUntil: "networkidle" });
out.controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
// The graph's code loads when the graph first opens (reactflow); the worker
// keeps a static file once it has loaded, so the reader opens the graph once
// online, as anyone who uses it has.
await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "networkidle", timeout: 300000 });
await page.waitForSelector(".react-flow__node", { timeout: 120000 });
await page.goto(`${BASE}/n/${NB}`, { waitUntil: "networkidle", timeout: 300000 });
await page.locator('[data-track="offline-save"]').click();
// The save is done when its row is in IndexedDB (written last).
const savedAt = Date.now();
for (;;) {
  const done = await page.evaluate(
    (nb) =>
      new Promise((resolve) => {
        const open = indexedDB.open("unitos-offline");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("saved")) return resolve(false);
          const get = db.transaction("saved").objectStore("saved").get(nb);
          get.onsuccess = () => resolve(Boolean(get.result));
          get.onerror = () => resolve(false);
        };
      }),
    NB,
  );
  if (done) break;
  if (Date.now() - savedAt > 600000) throw new Error("the save did not finish");
  await page.waitForTimeout(2000);
}
out.cached = await page.evaluate(async (nb) => {
  const cache = await caches.open(`unitos-project-${nb}`);
  const all = (await cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  console.log("KEYS", (await caches.keys()).join(","), all.length, all.slice(0, 5).join(" "));
  return all.filter((u) => u.startsWith("/api/notebooks"));
}, NB);
check("the copy holds the graph and every outline", out.cached.includes(`/api/notebooks/${NB}/graph`) && out.cached.filter((u) => u.includes("/outline?documentId=")).length === seed.docs.length, `${out.cached.length} data routes`);
check(
  "the copy holds the passages and the part titles",
  [`/api/notebooks/${NB}/graph/passages`, `/api/notebooks/${NB}/outline?parts=titles`].every((u) => out.cached.includes(u)),
  out.cached.join(" "),
);
// COST4-05: the provenance graph only when an edge counts provenance links.
out.provenanceLinks = await page.evaluate(async (nb) => {
  const res = await (await caches.open(`unitos-project-${nb}`)).match(`/api/notebooks/${nb}/graph`);
  const data = res ? await res.json() : { edges: [] };
  return data.edges.reduce((n, e) => n + (e.provenance ?? 0), 0);
}, NB);
check(
  "the copy holds the provenance graph only when there are provenance links",
  out.cached.includes(`/api/notebooks/${NB}/graph?provenance=1`) === out.provenanceLinks > 0,
  `${out.provenanceLinks} provenance links`,
);

await context.setOffline(true);
// The tab stays as it was when the network went (a dev server's pages do not
// load offline: its chunks are not the production build's); the graph has
// not opened in this load, so its data can only come from the copy.
out.offlineFailed = [];
if ((await page.locator(".react-flow__node").count()) === 0) {
  // Not open from the URL: the rail's Graph button.
  await page.locator('[data-track="graph"]').first().click().catch((e) => out.offlineFailed.push(String(e).slice(0, 120)));
  await page.waitForSelector(".react-flow__node", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
}
// The graph with ?provenance=1 answers offline from the bare entry.
out.provenanceOffline = await page.evaluate(async (nb) => {
  const r = await fetch(`/api/notebooks/${nb}/graph?provenance=1`).catch(() => null);
  return r ? r.status : 0;
}, NB);
check("offline: ?provenance=1 answers from the copy", out.provenanceOffline === 200, String(out.provenanceOffline));
const nodes = await page.locator(".react-flow__node").count();
const edges = await page.locator(".react-flow__edge").count();
check("offline: the graph draws its nodes and curves", nodes === seed.docs.length && edges > 0, `${nodes} nodes, ${edges} curves`);
await page.screenshot({ path: `${OUT}/GR-18-offline-graph${TAG}.png` });
const box = await page.locator(`.react-flow__node[data-id="${NCN}"]`).boundingBox().catch(() => null);
if (box) {
  await page.mouse.click(box.x + box.width / 2, box.y + 14);
  await page.locator("[data-graph-gist]").waitFor({ timeout: 20000 }).catch(() => {});
  const gist = await page.locator("[data-graph-gist]").innerText().catch(() => "");
  check("offline: the node card reads its outline", gist.startsWith("From The Antichrist"), gist.slice(0, 50));
  await page.screenshot({ path: `${OUT}/GR-18-offline-card${TAG}.png` });
}
// A link panel offline: its passages come from the copy's every-link passages.
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.locator('[data-track="graph-links"]').click();
await page.locator('[data-track="graph-links-open"]').first().click();
await page.locator("[data-graph-link-panel]").waitFor({ timeout: 10000 }).catch(() => {});
await page.locator("[data-link-passages]").waitFor({ timeout: 10000 }).catch(() => {});
const passage = await page
  .locator("[data-graph-link-panel] mark.link-detail-quote")
  .first()
  .evaluate((m) => ({ quote: m.textContent.length, passage: m.parentElement.textContent.length }))
  .catch(() => null);
check(
  "offline: a link panel draws its passages",
  (await page.locator("[data-link-passages]").count()) === 1 && passage !== null && passage.passage > passage.quote,
  JSON.stringify(passage),
);
await page.screenshot({ path: `${OUT}/COST3-03-offline-link${TAG}.png` });
// The Documents list offline: gists and part titles from the copy.
await page.locator('[data-track="graph-documents"]').click();
await page.locator("[data-graph-documents-list]").waitFor({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1000);
const docRows = await page.locator("[data-graph-documents-row]").count();
// [chrome6] VIEW6-04: a row is one line until opened; open every row to read its parts.
const rowHeads = page.locator("[data-graph-documents-row]:not([data-open]) [data-row-head]");
for (let i = (await rowHeads.count()) - 1; i >= 0; i--) await rowHeads.nth(i).click();
await page.waitForTimeout(500);
const docParts = await page.locator("[data-graph-documents-row] [data-graph-part]").count();
check("offline: the Documents list lists every document with its parts", docRows === seed.docs.length && docParts > 0, `${docRows} rows, ${docParts} parts`);
// What the notes cover, from the copy (COVER4's route is in the offline copy).
const dots = await page.locator("[data-graph-documents-row] [data-graph-part-dot]").count();
check("offline: the coverage dots draw from the copy", dots === docParts, `${dots} dots for ${docParts} parts`);
await page.screenshot({ path: `${OUT}/VIEW3-06-offline-documents${TAG}.png` });
await context.setOffline(false);
await page.goto(`${BASE}/n/${NB}`, { waitUntil: "networkidle", timeout: 300000 });
await page.locator('[data-track="offline-save"]').click().catch(() => {});
await page.waitForTimeout(2000);
out.removed = await page.evaluate(async (nb) => !(await caches.has(`unitos-project-${nb}`)), NB);
await page.evaluate(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(failures ? 1 : 0);
