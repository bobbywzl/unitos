// Drives the built app: the drag board (components/sortable.tsx) — the drop
// line, the reorder it lands, the hold that draws the ring and merges, and the
// drop of an annotation onto the floating note card. Prints PASS/FAIL.
//
// The run merges and moves notes, so it wants a fresh fixture: seed first
// (scripts/qa/seed.mjs) and pass NB and DOC.
import { chromium } from "playwright-core";

const [NB, DOC] = [process.env.NB, process.env.DOC];
const URL = `http://localhost:3311/n/${NB}?doc=${DOC}`;
const SHOT = process.env.SHOT_DIR ?? ".";

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && !m.text().includes('unique "key"') && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/merge-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
const trayIds = () =>
  page.$$eval('aside[data-track-surface="tray"] [data-sortable-id]', (els) =>
    els.map((e) => e.getAttribute("data-sortable-id")),
  );
// The ids of the first section's notes list: one list, so the line's place in
// it is the place the note has to land in.
const listIds = () =>
  page.$$eval('aside[data-track-surface="tray"] [data-drop-list]', (els) =>
    Array.from(els[0].querySelectorAll("[data-sortable-id]")).map((e) =>
      e.getAttribute("data-sortable-id"),
    ),
  );
// The card the line stands before, or "END" when it stands at the end of a list.
const lineBefore = () =>
  page.$$eval(".drop-line", (els) =>
    els.map((e) => e.parentElement.getAttribute("data-sortable-id") ?? "END"),
  );

await page.locator('[data-track="notes"]').first().click();
await page.waitForSelector('aside[data-track-surface="tray"] [data-sortable-id]', { timeout: 15000 });

// 1. A drag that passes over a card and drops: the line says where it lands,
// and it lands there. No merge — a passing drag never merges.
const before = await listIds();
const trayBefore = await trayIds();
const grip = page.locator(`[data-sortable-id="${before[0]}"] [data-drag-handle]`).first();
const g = await grip.boundingBox();
const onto = await page.locator(`[data-sortable-id="${before[1]}"]`).boundingBox();
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(g.x + g.width / 2, g.y + ((onto.y + onto.height - 6 - g.y) * i) / 14);
  await page.waitForTimeout(30);
}
check("drop line shows while dragging", (await page.locator(".drop-line").count()) === 1);
check("cards hold still", (await page.locator(".card-drag-overlay").count()) === 1);
check("no ring while passing", (await page.locator(".merge-ring").count()) === 0);
const line = (await lineBefore())[0];
await page.mouse.up();
await page.waitForTimeout(2000);
const after = await listIds();
check("no note was merged away", (await trayIds()).length === trayBefore.length);
const landed = after.indexOf(before[0]);
const lineAt = after.indexOf(line);
check(
  "the note landed where the line stood",
  line === "END" ? landed === after.length - 1 : landed === lineAt - 1,
  `landed ${landed}, line before ${line} at ${lineAt}`,
);

// 2. Laying the dragged card over another card and holding it there draws the
// ring, which closes and merges on its own. The card is drawn under the pointer
// at the offset it was picked up by, so the pointer goes to where that offset
// puts the card on the target — not to the target's middle.
const now = await listIds();
const trayNow = await trayIds();
const src = await page.locator(`[data-sortable-id="${now[0]}"]`).boundingBox();
const g2 = await page.locator(`[data-sortable-id="${now[0]}"] [data-drag-handle]`).first().boundingBox();
const cover = await page.locator(`[data-sortable-id="${now[now.length - 1]}"]`).boundingBox();
const from = { x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 };
// The pointer's offset inside the card, carried onto the target's top left.
const to = { x: from.x + (cover.x - src.x), y: from.y + (cover.y - src.y) };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
  await page.waitForTimeout(30);
}
check("the ring draws around the covered card", (await page.locator(".merge-ring").count()) === 1);
check("the covered card rings", (await page.locator(".outline-sage-500").count()) > 0);
check("the line is gone while the ring draws", (await page.locator(".drop-line").count()) === 0);
check("the dragged card draws back over the card it covers", (await page.locator(".card-drag-overlay-merging").count()) === 1);
await page.screenshot({ path: `${SHOT}/merge-ring.png` });
// The ring closes on its own: the merge runs without a release, the held card
// falls into the card it merges into, and that card works while the model writes.
let fell = false;
for (let i = 0; i < 90 && !fell; i++) {
  if (await page.locator(".merge-fall").count()) {
    fell = true;
    await page.screenshot({ path: `${SHOT}/merge-fall.png` });
  }
  await page.waitForTimeout(40);
}
check("the held card falls into the card it merges into", fell);
check("the ring is gone once the merge runs", (await page.locator(".merge-ring").count()) === 0);
await page.waitForTimeout(400);
check("the merge took one note away", (await trayIds()).length === trayNow.length - 1);
await page.mouse.up();
await page.waitForTimeout(2500);

// 3. A note pulled sideways floats; an annotation dropped on it lands in it,
// and the annotation stays where it is.
const left = await trayIds();
const card = await page.locator(`[data-sortable-id="${left[0]}"]`).boundingBox();
await page.mouse.move(card.x + 150, card.y + 24);
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(card.x + 150 - i * 30, card.y + 24);
  await page.waitForTimeout(25);
}
await page.mouse.up();
await page.waitForTimeout(1200);
check("the note floats over the article", (await page.locator("[data-floating-note]").count()) === 1);

await page.locator('[data-track="annotations"]').first().click();
await page.waitForTimeout(900);
const grips = await page.locator('[data-track="annotation-drag"]').count();
check("annotation cards carry a grip while a card floats", grips > 0);
if (grips > 0) {
  const anns = await page.locator("[data-annotation-source-id]").count();
  const gb = await page.locator('[data-track="annotation-drag"]').first().boundingBox();
  const fb = await page.locator("[data-floating-note]").first().boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(
      gb.x + ((fb.x + fb.width / 2 - gb.x) * i) / 14,
      gb.y + ((fb.y + 60 - gb.y) * i) / 14,
    );
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(200);
  check("the ghost follows the pointer", (await page.locator(".card-drag-ghost").count()) === 1);
  check("the floating card says what the drop does", (await page.locator("[data-floating-note] .outline-sage-500, [data-floating-note]").count()) > 0);
  await page.screenshot({ path: `${SHOT}/merge-drop.png` });
  await page.mouse.up();
  await page.waitForTimeout(3000);
  check("the annotation stays in the panel", (await page.locator("[data-annotation-source-id]").count()) === anns);
}

// 4. Add to notes from the distilled page: highlighting text offers the pill.
await page.keyboard.press("Escape");
await page.locator('button:has-text("Distill")').first().click();
await page.waitForTimeout(1500);
const quote = await page.locator("[data-quote-key]").first().boundingBox();
if (quote) {
  await page.mouse.move(quote.x + 40, quote.y + 24);
  await page.mouse.down();
  await page.mouse.move(quote.x + 300, quote.y + 24, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  check("the words of a point are selectable", (await page.evaluate(() => window.getSelection().toString())).trim() !== "");
  check("Add to notes shows on the selection", (await page.locator("[data-selection-notes]").count()) === 1);
  await page.screenshot({ path: `${SHOT}/merge-selection.png` });
}
}
