// Drives the built app: drag a note out of the tray (sensitivity, fold, shift),
// wrap text, scroll with the text, unwrap, dock on the rail. Prints PASS/FAIL.
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const URL = `http://localhost:3311/n/${NB}?doc=${DOC}`;
const SHOT = process.env.SHOT_DIR ?? ".";
const DRAG_HINT = "Hold and drag sideways to float this note over the article";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(`[data-note-id="${NOTE}"]`, { timeout: 15000 });

// A step that throws ends the run; the checks before it still print.
try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
const card = page.locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"]`);
const header = card.locator(`[data-tip="${DRAG_HINT}"]`);
const rect = async (loc) => loc.boundingBox();

// 1. The pen: one edit control, in the header, and no text edit button below.
check("pen edit button in header", (await card.locator('button[data-track="note-edit"] svg').count()) === 1);
check("no bottom edit text button", (await card.locator('button[data-track="note-edit"]').count()) === 1);
check("header carries the drag hint", (await header.count()) === 1);

// 2. A press without a sideways move is a click: the collapsed summary opens the note.
const summary = card.locator('button[data-track="note-collapse"]').last();
const summaryBox = await rect(summary);
await page.mouse.move(summaryBox.x + 40, summaryBox.y + summaryBox.height / 2);
await page.mouse.down();
await page.mouse.move(summaryBox.x + 52, summaryBox.y + summaryBox.height / 2, { steps: 4 }); // 12px: below the threshold
await page.mouse.up();
await page.waitForTimeout(250);
check("12px sideways stays a click (note expanded)", (await card.locator(".note-body").count()) === 1);
check("12px sideways floats nothing", (await page.locator("[data-floating-note]").count()) === 0);

// 3. A vertical move first cancels the drag: no float even after a sideways move.
let h = await rect(header);
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 40, { steps: 5 });
await page.mouse.move(h.x + h.width / 2 - 80, h.y + h.height / 2 + 40, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(250);
check("vertical-first move floats nothing", (await page.locator("[data-floating-note]").count()) === 0);

// 4. A sideways hold-and-drag of 40px floats the note; the tray folds; the article moves left.
const trayBefore = await rect(page.locator(".tray-column"));
const articleBefore = await rect(page.locator("article.reader-prose"));
h = await rect(header);
const startX = h.x + h.width / 2;
const startY = h.y + h.height / 2;
await page.mouse.move(startX, startY);
await page.mouse.down();
await page.mouse.move(startX - 40, startY + 4, { steps: 6 });
await page.waitForTimeout(150);
check("40px sideways drag floats the note", (await page.locator("[data-floating-note]").count()) === 1);
await page.mouse.move(startX - 700, startY + 120, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(700); // the tray's slide and the column's move
const trayAfter = await rect(page.locator(".tray-column"));
check("tray folds while the note floats", (trayAfter?.width ?? 0) < 2, `tray ${trayBefore?.width}px → ${trayAfter?.width ?? 0}px`);
check("workspace marks the floating note", (await page.locator("[data-note-floating]").count()) === 1);
const articleAfter = await rect(page.locator("article.reader-prose"));
check("article column moves left", articleAfter.x < articleBefore.x - 40, `x ${Math.round(articleBefore.x)} → ${Math.round(articleAfter.x)}`);
check("tray card reads Editing in a floating card", (await page.locator('aside[data-track-surface="tray"]').getByText("Editing in a floating card").count()) === 1);
check("floating card has no Pop out and says Done", (await page.locator("[data-floating-note]").getByText("Done").count()) === 1 && (await page.getByText("Pop out").count()) === 0);

// 5. Wrap text: the card joins the reader pane, the gap lands, lines beside the card stop short of it, the card scrolls with the text.
const floating = page.locator("[data-floating-note]");
await floating.locator('button[data-track="note-wrap"]').click();
await page.waitForTimeout(400);
check("wrapped card sits inside the reader pane", (await page.locator("[data-reader-root] [data-floating-note]").count()) === 1);
check("wrapped card is positioned in the pane's content", (await floating.evaluate((el) => getComputedStyle(el).position)) === "absolute");
check("wrap gap is drawn in the article", (await page.locator("article.reader-prose [data-note-wrap-gap]").count()) === 1);
const wrap = await page.evaluate(() => {
  const card = document.querySelector("[data-floating-note]").getBoundingClientRect();
  const gap = document.querySelector("[data-note-wrap-gap]");
  const side = gap.style.float;
  const article = document.querySelector("article.reader-prose");
  const blocks = Array.from(article.querySelectorAll("[data-block-id]"));
  let beside = 0, intruding = 0, full = 0;
  for (const b of blocks) {
    const r = document.createRange();
    r.selectNodeContents(b);
    for (const line of r.getClientRects()) {
      if (line.width < 20) continue;
      const overlaps = line.bottom > card.top && line.top < card.bottom;
      if (overlaps) {
        beside++;
        if (side === "right" ? line.right > card.left - 4 : line.left < card.right + 4) intruding++;
      } else if (line.right > card.left + 20 && side === "right") full++;
    }
  }
  return { side, beside, intruding, full, card: { left: Math.round(card.left), right: Math.round(card.right), top: Math.round(card.top), bottom: Math.round(card.bottom) } };
});
check("lines beside the card stop short of it", wrap.beside > 3 && wrap.intruding === 0, JSON.stringify(wrap));
check("lines above or below the card run full width", wrap.full > 0, `${wrap.full} full lines`);
await page.screenshot({ path: `${SHOT}/wrap.png` });
const beforeScroll = await rect(floating);
await page.locator("[data-reader-root]").first().evaluate((el) => el.scrollBy(0, 160));
await page.waitForTimeout(200);
const afterScroll = await rect(floating);
check("wrapped card scrolls with the text", Math.abs(beforeScroll.y - afterScroll.y - 160) < 3, `moved ${Math.round(beforeScroll.y - afterScroll.y)}px`);
await page.locator("[data-reader-root]").first().evaluate((el) => el.scrollBy(0, -160));
await page.waitForTimeout(200);

// 6. Wrap off: the card returns to the viewport, the gap closes.
await floating.locator('button[data-track="note-wrap"]').click();
await page.waitForTimeout(300);
check("unwrapped card is fixed again", (await floating.evaluate((el) => getComputedStyle(el).position)) === "fixed");
check("wrap gap closes", (await page.locator("[data-note-wrap-gap]").count()) === 0);

// 7. Dock by dropping the card on the rail: the tray opens with the note's editor.
const grip = floating.locator(".cursor-grab").first();
const g = await rect(grip);
const rail = await rect(page.locator('[data-track-surface="sidebar"]'));
await page.mouse.move(g.x + 20, g.y + g.height / 2);
await page.mouse.down();
await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(700);
check("drop on the rail docks the card", (await page.locator("[data-floating-note]").count()) === 0);
const trayDocked = await rect(page.locator(".tray-column"));
check("tray opens again after docking", (trayDocked?.width ?? 0) > 200, `tray ${trayDocked?.width ?? 0}px`);
check("article column returns", Math.abs((await rect(page.locator("article.reader-prose"))).x - articleBefore.x) < 4);
check("note's tray card reopens its editor", (await page.locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"] [contenteditable]`).count()) === 1);
}
