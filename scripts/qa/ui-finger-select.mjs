// The finger selection (SPEC.md §33) in a real browser with a touch screen:
// a finger drawn along a line selects its words and the AI toolbar opens; a
// finger drawn down the page scrolls and selects nothing; a code block keeps
// its sideways scroll.
//
//   node scripts/qa/ui-finger-select.mjs <notebookId> <documentId> [outDir]
//
// The app runs on :3311 with sign-in off (scripts/qa/tools-loop.mjs's header).
import { chromium } from "playwright-core";

const [NB, DOC, OUT = "scripts/qa/out"] = process.argv.slice(2);
if (!NB || !DOC) {
  console.error("usage: node scripts/qa/ui-finger-select.mjs <notebookId> <documentId> [outDir]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3311";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
// An iPad in landscape: a touch screen, no mouse.
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await page.goto(`${BASE}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector("[data-reader-root][data-finger-select] [data-block-id]");
await page.waitForTimeout(800);

/** One finger through the points, in viewport px. */
async function finger(points, pause = 16) {
  const touch = ([x, y]) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(points[0]) });
  for (const point of points.slice(1)) {
    await page.waitForTimeout(pause);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(point) });
  }
  await page.waitForTimeout(pause);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const box = await page.evaluate(() => {
  const p = document.querySelector("[data-reader-root] p[data-block-id]");
  const r = p.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height, action: getComputedStyle(p).touchAction };
});
check("a paragraph hands the sideways drag to the page", box.action.includes("pan-y"), box.action);
const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? "");
const scrolled = () => page.evaluate(() => document.querySelector("[data-reader-root]").scrollTop);

// 1. A finger down the page scrolls and selects nothing.
const top0 = await scrolled();
await finger(Array.from({ length: 12 }, (_, i) => [box.left + 200, box.top + 200 - i * 18]));
await page.waitForTimeout(700);
const top1 = await scrolled();
check("a finger drawn up the page scrolls it", top1 > top0 + 40, `${top0} -> ${top1}`);
check("a scroll selects nothing", (await selected()) === "");
check("a scroll opens no toolbar", (await page.locator("[data-selection-popover]").count()) === 0);
await page.evaluate(() => document.querySelector("[data-reader-root]").scrollTo(0, 0));
await page.waitForTimeout(400);

// 2. A finger along the second line selects whole words; the toolbar opens.
const b = await page.evaluate(() => {
  const r = document.querySelector("[data-reader-root] p[data-block-id]").getBoundingClientRect();
  return { left: r.left, top: r.top };
});
const y = b.top + 45;
await finger(Array.from({ length: 14 }, (_, i) => [b.left + 60 + i * 20, y + (i % 2)]));
await page.waitForTimeout(900);
const words = await selected();
check("a finger drawn along a line selects its words", words.split(/\s+/).length >= 3, JSON.stringify(words));
check("the selection starts and ends on whole words", /^\S/.test(words) && !/\s$/.test(words));
check("the pane did not scroll", Math.abs((await scrolled()) - 0) < 2);
check("the AI toolbar opens", (await page.locator("[data-selection-popover]").count()) === 1);
await page.screenshot({ path: `${OUT}/finger-select.png` });

// 3. A finger back along the line (right to left) selects too.
await page.touchscreen.tap(b.left + 300, b.top - 60);
await page.waitForTimeout(500);
await page.evaluate(() => window.getSelection()?.removeAllRanges());
await finger(Array.from({ length: 10 }, (_, i) => [b.left + 320 - i * 20, y]));
await page.waitForTimeout(900);
const back = await selected();
check("a finger drawn right to left selects words", back.split(/\s+/).length >= 2, JSON.stringify(back));

await browser.close();
console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
