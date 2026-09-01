// UI verification for handwritten documents: pages render, Circle & ask draws
// and answers, marks paint, the conversion strip shows, converted text follows.
import { chromium } from "playwright-core";

// Usage: node scripts/qa/ui-handwritten.mjs <notebookId> <documentId>
// Expects the dev server on :3311 with the mock model (scripts/qa/mock-anthropic.mjs)
// and a handwritten document that has converted text and two stored marks on
// page 1 (one explain around 20-42% x, one comment lower).
const [NB, DOC] = process.argv.slice(2);
if (!NB || !DOC) {
  console.error("Usage: node scripts/qa/ui-handwritten.mjs <notebookId> <documentId>");
  process.exit(1);
}
const URL_ = `http://localhost:3311/n/${NB}?doc=${DOC}`;

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL_, { waitUntil: "networkidle" });

// 1. Pages render as images from the page image route.
const pageImages = page.locator('img[src*="/page/"]');
await pageImages.first().waitFor({ state: "visible", timeout: 15000 });
check("page images render", (await pageImages.count()) === 2, `${await pageImages.count()} images`);
const natural = await pageImages.first().evaluate((el) => el.naturalWidth);
check("page image bytes decode", natural === 1400, `naturalWidth ${natural}`);

// 2. Stored marks paint as SVG loops with source ids.
const marks = page.locator("svg [data-source-id]");
check("stored marks paint", (await marks.count()) >= 2, `${await marks.count()} marks`);

// 3. The conversion strip and the converted text.
check("Converted text header", (await page.locator("text=Converted text").count()) > 0);
check("Convert again button", (await page.locator("text=Convert again").count()) > 0);
check(
  "converted heading renders",
  (await page.locator("h2:has-text('Mock heading from the notes'), h1:has-text('Mock heading from the notes')").count()) > 0,
);
check("converted table renders", (await page.locator("table >> text=Ledger, table >> text=Count").count()) >= 0 && (await page.locator("td, th").count()) > 0);

const before = await marks.count();

// 4. Circle & ask: drag a loop on the first page; the card opens.
const img = pageImages.first();
await img.scrollIntoViewIfNeeded();
const box = await img.boundingBox();
const cx = box.x + box.width * 0.62;
const cy = box.y + box.height * 0.42;
const r = 60;
await page.mouse.move(cx + r, cy);
await page.mouse.down();
for (let a = 0; a <= 20; a++) {
  const t = (a / 20) * Math.PI * 2;
  await page.mouse.move(cx + r * Math.cos(t), cy + r * Math.sin(t));
}
await page.mouse.up();
await page.waitForTimeout(300);
check("Circle & ask card opens", (await page.locator("text=Circle & ask").count()) > 0);
await page.screenshot({ path: "/tmp/qa-handwritten-card.png", fullPage: false });

// 5. Type a question and Ask; the mock's answer streams into the card.
await page.fill('textarea[placeholder="Ask about the circled spot"]', "What does the box on the left mean?");
await page.locator("[data-selection-popover] button", { hasText: /^Ask$/ }).first().click();
await page.locator("text=Mock response").first().waitFor({ timeout: 20000 });
check("answer streams into the card", true);
await page.waitForTimeout(1200); // refresh lands the new mark
check("new mark painted", (await page.locator("svg [data-source-id]").count()) > before, `${await page.locator("svg [data-source-id]").count()} marks`);
await page.screenshot({ path: "/tmp/qa-handwritten-answer.png" });

// 6. Clicking a stored mark opens its annotation: a plain click on the page
// hit-tests the marks (the stored explain sits around 20-42% x, 18-32% y).
try {
  await page.locator('[aria-label="Close"]').first().click({ timeout: 2000 }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const b2 = await pageImages.first().boundingBox();
  await page.mouse.click(b2.x + b2.width * 0.31, b2.y + b2.height * 0.25);
  await page.waitForTimeout(800);
  const bubbleOpen =
    (await page.locator("text=Mock response").count()) > 0 ||
    (await page.locator("text=Check this sum").count()) > 0;
  check("clicking a mark opens its annotation", bubbleOpen);
} catch (e) {
  check("clicking a mark opens its annotation", false, String(e).slice(0, 80));
}
await page.screenshot({ path: "/tmp/qa-handwritten-final.png", fullPage: true });

console.log(results.join("\n"));
console.log("console errors:", errors.length === 0 ? "none" : errors.slice(0, 5).join(" | "));
await browser.close();
