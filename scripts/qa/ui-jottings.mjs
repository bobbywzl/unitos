// Jottings (SPEC.md §33) in a real browser: a pen draws across the reader
// pane, the strokes save, come back on a reload, stay with their block when
// the pane narrows, erase, and come back on Undo; a mouse still selects; a
// stroke drawn with the network down is kept and saved later.
//
//   node scripts/qa/ui-jottings.mjs <notebookId> <documentId> [outDir]
//
// The app runs on :3311 with sign-in off (scripts/qa/tools-loop.mjs's header).
import { chromium } from "playwright-core";

const [NB, DOC, OUT = "scripts/qa/out"] = process.argv.slice(2);
if (!NB || !DOC) {
  console.error("usage: node scripts/qa/ui-jottings.mjs <notebookId> <documentId> [outDir]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3311";
const URL = `${BASE}/n/${NB}?doc=${DOC}`;
const API = `${BASE}/api/documents/${DOC}/jottings`;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
await context.addInitScript(() => {
  if (!localStorage.getItem("unitos-jot")) {
    localStorage.setItem("unitos-jot", JSON.stringify({ on: true, tool: "pen", color: "ink", width: 0, penSeen: true }));
  }
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

async function open() {
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector("[data-reader-root] [data-block-id]");
  await page.waitForSelector("[data-jot-bar]");
  await page.waitForTimeout(600);
}

/** One stroke of a pen (or a mouse) through the points, in viewport px. */
async function stroke(points, pointerType = "pen") {
  const send = (type, [x, y], buttons) =>
    cdp.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, pointerType, force: 0.6 });
  await send("mousePressed", points[0], 1);
  for (const point of points.slice(1)) {
    await send("mouseMoved", point, 1);
    await page.waitForTimeout(8);
  }
  await send("mouseReleased", points[points.length - 1], 0);
  await page.waitForTimeout(120);
}

const stored = async () => (await (await context.request.get(`${API}?notebookId=${NB}`)).json()).jottings;
const drawnCount = () => page.locator("[data-jottings] path[data-jotting-id]").count();

/** The second paragraph's box and a wavy line through its first line. */
async function paragraph() {
  return page.evaluate(() => {
    const blocks = [...document.querySelectorAll("[data-reader-root] p[data-block-id]")];
    const r = blocks[0].getBoundingClientRect();
    return { id: blocks[0].dataset.blockId, left: r.left, top: r.top, width: r.width, height: r.height };
  });
}
const wave = (box, dy = 14) =>
  Array.from({ length: 24 }, (_, i) => [box.left + 30 + i * 12, box.top + dy + Math.sin(i / 2) * 5]);

/** Where the first drawn stroke sits, relative to its block. */
async function strokeOffset() {
  return page.evaluate(() => {
    const path = document.querySelector("[data-jottings] path[data-jotting-id]");
    if (!path) return null;
    const blocks = [...document.querySelectorAll("[data-reader-root] p[data-block-id]")];
    const b = blocks[0].getBoundingClientRect();
    const s = path.getBoundingClientRect();
    return { dx: s.left - b.left, dy: s.top - b.top, w: s.width, bw: b.width, inside: s.top >= b.top - 6 && s.bottom <= b.bottom + 6 };
  });
}

// Start from no jottings of this document (a rerun). Erase is the route's own.
{
  const before = await stored();
  if (before.length > 0) {
    await context.request.post(API, { data: { notebookId: NB, erase: before.map((j) => j.id) } });
  }
}

await open();
const box = await paragraph();

// 1. A pen draws; nothing is selected and no toolbar opens.
await stroke(wave(box));
check("a pen stroke draws a jotting", (await drawnCount()) === 1);
check("the stroke selects no words", await page.evaluate(() => window.getSelection()?.isCollapsed ?? true));
check("the stroke opens no toolbar", (await page.locator("[data-selection-popover]").count()) === 0);
const first = await strokeOffset();
check("the jotting lies on the paragraph", first?.inside === true, JSON.stringify(first));

// 2. It saves, keyed to the block.
await page.waitForTimeout(1500);
let rows = await stored();
check("the jotting is stored", rows.length === 1 && rows[0].blockId === box.id, `${rows.length} stored`);
await page.screenshot({ path: `${OUT}/jottings-1-drawn.png` });

// 3. A reload draws it at the same place.
await open();
const again = await strokeOffset();
check(
  "a reload draws the jotting at the same place",
  again !== null && Math.abs(again.dx - first.dx) < 1.5 && Math.abs(again.dy - first.dy) < 1.5,
  JSON.stringify(again),
);

// 4. A narrower pane: the jotting stays on its block and scales with it.
await page.setViewportSize({ width: 820, height: 820 });
await page.waitForTimeout(900);
const narrow = await strokeOffset();
check(
  "in a narrower pane the jotting stays on its block",
  narrow !== null && narrow.inside && Math.abs(narrow.w / narrow.bw - first.w / first.bw) < 0.02,
  JSON.stringify(narrow),
);
await page.screenshot({ path: `${OUT}/jottings-2-narrow.png` });
await page.setViewportSize({ width: 1180, height: 820 });
await page.waitForTimeout(900);

// 5. A mouse still selects words and opens the toolbar with Jot on.
await stroke([[box.left + 40, box.top + 44], [box.left + 140, box.top + 44], [box.left + 260, box.top + 44]], "mouse");
await page.waitForTimeout(500);
check("a mouse drag still selects words", await page.evaluate(() => (window.getSelection()?.toString().length ?? 0) > 3));
check("a mouse drag still opens the toolbar", (await page.locator("[data-selection-popover]").count()) === 1);
check("a mouse drag draws no jotting", (await drawnCount()) === 1);
await page.keyboard.press("Escape");
await page.mouse.click(box.left + box.width + 5, box.top + box.height + 30);
await page.waitForTimeout(300);

// 6. The eraser removes the stroke; Undo brings it back.
await page.click('[data-jot-bar] [data-track="jot:eraser"]');
const p = await paragraph();
await stroke([[p.left + 150, p.top - 20], [p.left + 150, p.top + 14], [p.left + 150, p.top + 50]]);
check("the eraser removes the jotting", (await drawnCount()) === 0);
await page.waitForTimeout(1500);
check("the erased jotting leaves the stored list", (await stored()).length === 0);
await page.click('[data-jot-bar] [data-track="jot:undo"]');
// The stroke's block is measured again on the next frame.
await page.waitForTimeout(200);
check("Undo draws the jotting again", (await drawnCount()) === 1);
await page.waitForTimeout(1500);
rows = await stored();
check("Undo stores the jotting again", rows.length === 1);
await page.click('[data-jot-bar] [data-track="jot:pen"]');

// 7. The network is down: a stroke is kept through a reload, then saved.
await page.route("**/api/documents/*/jottings", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
await stroke(wave(p, 44));
check("a stroke with the network down is drawn", (await drawnCount()) === 2);
await page.waitForTimeout(1500);
check("the server does not have it yet", (await stored()).length === 1);
await open();
check("after a reload the unsaved stroke is still drawn", (await drawnCount()) === 2);
await page.unroute("**/api/documents/*/jottings");
await open();
await page.waitForTimeout(800);
check("with the network back the stroke is stored", (await stored()).length === 2);
check("the queue is empty once it is stored", await page.evaluate(() => localStorage.getItem("unitos-jot-queue") === null));

// 8. Done puts the pen away; the jottings stay drawn, and a pen then draws nothing.
await page.click('[data-jot-bar] [data-track="jot:off"]');
await stroke(wave(p, 70));
check("with Jot off a pen draws nothing", (await drawnCount()) === 2);
check("with Jot off the jottings stay drawn", (await drawnCount()) === 2);
await page.click('[data-jot-bar] [data-track="jot:on"]');
await page.screenshot({ path: `${OUT}/jottings-3-final.png` });

await browser.close();
console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
