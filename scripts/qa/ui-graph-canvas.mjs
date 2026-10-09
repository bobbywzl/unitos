// The graph canvas check (SPEC.md §13): opens the graph of each seeded project at 1440, 1000, 820 and 390,
// measures the fit (zoom, label size on screen, nodes under the Stitch box, nodes off the canvas, the header's
// height), and screenshots each view.
//   node scripts/qa/ui-graph-canvas.mjs <port> <tag> [en|zh] [project,project…]
// Env: SHOT (screenshot dir), OUT (json dir), W (widths), IDS (json of {name: notebookId}).
import { chromium } from "playwright-core";
import fs from "node:fs";
const port = process.argv[2] || "3111";
const tag = process.argv[3] || "before";
const lang = process.argv[4] || "en";
const B = `http://localhost:${port}`;
const SHOT = process.env.SHOT || "/mnt/project-files/stitch-graph-loop/round-1/canvas/";
const OUT = process.env.OUT || "/tmp";
const P = process.env.IDS
  ? JSON.parse(fs.readFileSync(process.env.IDS, "utf8"))
  : {
      seven: "cmuxebxpk00307diibsh2enao",
      forty: "cmuxebxxv00fg7diirtt32cns",
      box: "cmuxeb7i900357dd1h5hnq9be",
      gr0: "cmuxebxnc00007diizi6s25w2",
      gr1: "cmuxebxns000a7dii7j4l8x2d",
      gr2: "cmuxebxo5000s7diidqnpcjz6",
      twin: "cmuxeddmv001p7d4egz787k27",
    };
const which = (process.argv[5] || "seven,forty").split(",");
const widths = (process.env.W || "1440,1000,820,390").split(",").map(Number);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext();
if (lang === "zh") await ctx.addCookies([{ name: "dissect-lang", value: "zh", url: B }]);
const out = {};
for (const name of which) {
  for (const w of widths) {
    const h = w === 390 ? 844 : w === 820 ? 1100 : w === 1000 ? 800 : 900;
    const page = await ctx.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${B}/n/${P[name]}`, { waitUntil: "networkidle", timeout: 180000 });
    await page.locator('[data-track="graph"]').first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(400);
    const t0 = Date.now();
    // A click before hydration does nothing: click again until the overlay opens.
    for (let i = 0; i < 6; i++) {
      await page.locator('[data-track="graph"]').first().click();
      const opened = await page.locator(".graph-overlay-in").first().waitFor({ timeout: 8000 }).then(() => true, () => false);
      if (opened) break;
    }
    await page.locator(".react-flow__node, .graph-overlay-in p").first().waitFor({ timeout: 90000 }).catch(() => {});
    const mountMs = Date.now() - t0;
    await page.waitForTimeout(2400);
    const m = await page.evaluate(() => {
      const r = (e) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
      };
      const vp = document.querySelector(".react-flow__viewport");
      const zoom = vp ? new DOMMatrix(getComputedStyle(vp).transform).a : null;
      const box = document.querySelector('[role="region"][data-track-surface]') || document.querySelector('[data-track="stitch-expand"]');
      const header = document.querySelector(".graph-overlay-in > div");
      const nodes = [...document.querySelectorAll(".react-flow__node")];
      const labels = nodes.map((n) => n.querySelector("[data-graph-label]") || n.querySelector("span.font-semibold")).filter(Boolean);
      const labelPx = labels.length ? Math.min(...labels.map((l) => l.getBoundingClientRect().height)) / 1 : null;
      const fontPx = labels.length ? Math.min(...labels.map((l) => parseFloat(getComputedStyle(l).fontSize) * zoom)) : null;
      const sb = box?.getBoundingClientRect();
      const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
      const nb = nodes.map((n) => {
        const c = n.querySelector("[data-graph-dot]") || n.querySelector("span.rounded-full");
        return c.getBoundingClientRect();
      });
      const under = sb ? nb.filter((b) => b.bottom > sb.top && b.right > sb.left && b.left < sb.right && b.top < sb.bottom).length : 0;
      const offCanvas = pane ? nb.filter((b) => b.left < pane.left || b.right > pane.right || b.top < pane.top || b.bottom > pane.bottom).length : 0;
      let bbox = null;
      if (nb.length) {
        const x0 = Math.min(...nb.map((b) => b.left)), x1 = Math.max(...nb.map((b) => b.right));
        const y0 = Math.min(...nb.map((b) => b.top)), y1 = Math.max(...nb.map((b) => b.bottom));
        bbox = [x0, y0, x1 - x0, y1 - y0].map(Math.round);
      }
      return {
        zoom: zoom && +zoom.toFixed(3),
        labelFontOnScreen: fontPx && +fontPx.toFixed(1),
        nodes: nodes.length,
        dotsUnderBox: under,
        dotsOffCanvas: offCanvas,
        dotsBbox: bbox,
        pane: r(document.querySelector(".react-flow")),
        header: r(header),
        box: r(box),
        scrollW: document.documentElement.scrollWidth,
        void: labelPx,
      };
    });
    m.mountMs = mountMs;
    out[`${name}-${w}`] = m;
    console.log(name, w, JSON.stringify(m));
    await page.screenshot({ path: `${SHOT}${name}-${w}-${lang}-${tag}.png` });
    await page.close();
  }
}
fs.writeFileSync(`${OUT}/measure-${tag}-${lang}.json`, JSON.stringify(out, null, 1));
await browser.close();
