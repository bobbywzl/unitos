// The graph's speed on GR Forty (40 documents, 81 links): the time from the click to the nodes, the frame rate
// while the reader pans and while the pointer sweeps over nodes, and long tasks. Five runs, median.
//   node scripts/qa/ui-graph-perf.mjs <port>
import { chromium } from "playwright-core";
const port = process.argv[2] || "3123";
const B = `http://localhost:${port}`;
const FORTY = "cmuxebxxv00fg7diirtt32cns";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const runs = [];
for (let r = 0; r < 5; r++) {
  await page.goto(`${B}/n/${FORTY}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__long = 0;
    new PerformanceObserver((l) => (window.__long += l.getEntries().filter((e) => e.duration > 50).length)).observe({ type: "longtask", buffered: false });
  });
  let t0 = 0;
  for (let i = 0; i < 6; i++) {
    t0 = Date.now();
    await page.locator('[data-track="graph"]').first().click();
    if (await page.locator(".react-flow__node").first().waitFor({ timeout: 8000 }).then(() => true, () => false)) break;
  }
  const mount = Date.now() - t0;
  await page.waitForTimeout(1500);
  const mountLongTasks = await page.evaluate(() => { const n = window.__long; window.__long = 0; return n; });
  const fps = async (move) => {
    await page.evaluate(() => {
      window.__frames = 0;
      window.__stop = false;
      const tick = () => { window.__frames++; if (!window.__stop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const start = Date.now();
    await move();
    const ms = Date.now() - start;
    const frames = await page.evaluate(() => { window.__stop = true; return window.__frames; });
    return +((frames * 1000) / ms).toFixed(1);
  };
  const pan = await fps(async () => {
    await page.mouse.move(1300, 120);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(1300 - i * 6, 120 + i * 3);
    await page.mouse.up();
  });
  const sweep = await fps(async () => {
    for (let i = 0; i < 60; i++) await page.mouse.move(150 + i * 20, 200 + (i % 10) * 40);
  });
  const longTasks = await page.evaluate(() => window.__long);
  runs.push({ mount, mountLongTasks, pan, sweep, longTasks });
}
const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[2];
console.log(JSON.stringify({ port, runs, median: { mountMs: med("mount"), panFps: med("pan"), hoverSweepFps: med("sweep"), mountLongTasks: med("mountLongTasks"), interactionLongTasks: med("longTasks") } }));
await browser.close();
