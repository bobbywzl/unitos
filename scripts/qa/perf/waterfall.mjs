import { chromium } from "playwright-core";
const base = process.env.BASE ?? "http://localhost:3400";
const url = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const start = Date.now();
const rows = [];
page.on("requestfinished", async (r) => {
  const res = await r.response();
  const t = r.timing();
  let size = 0; try { size = (await res.body()).length; } catch {}
  rows.push({ start: t.startTime - performance.timeOrigin, ms: t.responseEnd, url: r.url().replace(base, ""), type: r.resourceType(), status: res.status(), size, fromSW: res.fromServiceWorker() });
});
await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; });
const entries = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => ({ name: e.name, start: e.startTime, end: e.responseEnd, size: e.transferSize, enc: e.encodedBodySize, dec: e.decodedBodySize, type: e.initiatorType })));
console.log(`dcl ${nav.dcl.toFixed(0)} load ${nav.load.toFixed(0)}`);
let total = 0;
for (const e of entries.sort((a, b) => a.start - b.start)) { total += e.enc; console.log(`${e.start.toFixed(0).padStart(6)} → ${e.end.toFixed(0).padStart(6)}  ${String(e.enc).padStart(8)}/${String(e.dec).padStart(8)}  ${e.type.padEnd(10)} ${e.name.replace(base, "").slice(0, 110)}`); }
console.log(`entries ${entries.length} encoded total ${(total/1024).toFixed(0)}KB`);
await browser.close();
