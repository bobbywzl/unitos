// The graph at scale (REV2-09, REV2-10): a 100-document, 300-link project. Three runs of: the click to the
// nodes, long tasks while opening, the frame rate while the reader pans and while the pointer sweeps over
// nodes; then what the fit shows (nodes inside the canvas, label size on screen, labels drawn), the DOM, the
// gradients, the running animations, and the Tab presses from the canvas to the Stitch box. Screenshots at
// 1440 and at 390 (touch).
//   node scripts/qa/ui-graph-scale.mjs <port> <label> [projectId]
// The project is the GRAPH2 seed (.qa-tmp/stitch/r2/graph/seed.sql, id g2-big).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
const port = process.argv[2] || "3142";
const label = process.argv[3] || "after";
const NB = process.argv[4] || "g2-big";
const B = `http://localhost:${port}`;
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-2/graph";
const OUT = process.env.OUT ?? "/home/user/unitos/.qa-tmp/stitch/r2/graph";
mkdirSync(SHOT, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

async function openGraph() {
  await page.goto(`${B}/n/${NB}`, { waitUntil: "networkidle", timeout: 300000 });
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => Math.round(e.duration)))).observe({ type: "longtask" });
  });
  const t0 = Date.now();
  await page.locator('[data-track="graph"]').first().click();
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  const firstNode = Date.now() - t0;
  await page.waitForTimeout(2500);
  return { firstNode, long: await page.evaluate(() => window.__long.slice()) };
}

const fps = async (move) => {
  await page.evaluate(() => {
    window.__f = 0;
    window.__s = false;
    const t = () => { window.__f++; if (!window.__s) requestAnimationFrame(t); };
    requestAnimationFrame(t);
  });
  const s = Date.now();
  await move();
  const ms = Date.now() - s;
  return +(((await page.evaluate(() => { window.__s = true; return window.__f; })) * 1000) / ms).toFixed(1);
};

const runs = [];
for (let r = 0; r < 3; r++) {
  const { firstNode, long } = await openGraph();
  const pane = await page.locator(".react-flow__pane").boundingBox();
  const sweep = await fps(async () => {
    for (let i = 0; i < 60; i++) await page.mouse.move(pane.x + 120 + i * 18, pane.y + 120 + (i % 10) * 35);
  });
  const pan = await fps(async () => {
    await page.mouse.move(pane.x + pane.width - 30, pane.y + 30);
    await page.mouse.down();
    for (let i = 0; i < 60; i++) await page.mouse.move(pane.x + pane.width - 30 - i * 6, pane.y + 30 + i * 3);
    await page.mouse.up();
  });
  runs.push({ firstNode, longTasks: long.length, longestTask: Math.max(0, ...long), pan, sweep });
}

// What the fit shows: reopen, no pointer over the canvas.
await openGraph();
await page.mouse.move(5, 5);
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOT}/REV2-09-${label}.png` });
const view = await page.evaluate(() => {
  const pane = document.querySelector(".react-flow__pane").getBoundingClientRect();
  const box = document.querySelector('[aria-label="Stitch"][role="region"]')?.getBoundingClientRect();
  const nodes = [...document.querySelectorAll(".react-flow__node")];
  const inside = nodes.filter((n) => {
    const r = n.getBoundingClientRect();
    return r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= (box ? box.top : pane.bottom);
  }).length;
  const labels = [...document.querySelectorAll("[data-graph-label]")].filter((l) => l.getClientRects().length > 0 && getComputedStyle(l).visibility !== "hidden");
  const zoom = +(document.querySelector(".react-flow__viewport").style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);
  const px = labels.length ? +(parseFloat(getComputedStyle(labels[0]).fontSize) * zoom).toFixed(1) : 0;
  return {
    zoom,
    nodes: nodes.length,
    nodesInFreeCanvas: inside,
    labelsDrawn: labels.length,
    labelPxOnScreen: px,
    edges: document.querySelectorAll(".react-flow__edge").length,
    dom: document.querySelectorAll("*").length,
    gradients: document.querySelectorAll(".corpus-graph linearGradient").length,
    animations: document.getAnimations().filter((a) => a.playState === "running").length,
    tabStops: document.querySelectorAll('.corpus-graph [tabindex="0"]').length,
  };
});

// Keyboard: from the canvas's first Tab stop to the Stitch text box.
const tabs = await page.evaluate(() => {
  const first = document.querySelector('.corpus-graph [tabindex="0"]');
  first?.focus();
  return first ? 0 : -1;
});
let tabCount = -1;
if (tabs === 0) {
  for (let i = 1; i <= 600; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Stitch" && document.activeElement.tagName === "TEXTAREA")) {
      tabCount = i;
      break;
    }
  }
}

// Phone, touch.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const pp = await phone.newPage();
await pp.goto(`${B}/n/${NB}`, { waitUntil: "networkidle", timeout: 300000 });
await pp.locator('[data-track="graph"]').first().click().catch(() => {});
await pp.locator(".react-flow__node").first().waitFor({ timeout: 60000 }).catch(() => {});
await pp.waitForTimeout(2500);
await pp.screenshot({ path: `${SHOT}/REV2-09-390-${label}.png` });
await phone.close();

const result = { label, port, project: NB, runs, view, tabsCanvasToStitch: tabCount, errors };
writeFileSync(`${OUT}/scale-${label}.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
