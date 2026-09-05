// QA check for the Summary tab and the SIMPLIFY bubble. Needs the dev server on
// :3311 and the mock Kimi server on :3399 (start the dev server with
// KIMI_API_KEY=mock KIMI_BASE_URL=http://localhost:3399/v1). Pass seeded ids:
//   NB=<notebook id> DOC=<document id> node scripts/qa/verify-summary-simplify.mjs
import { chromium } from "playwright-core";

const NB = process.env.NB;
const DOC = process.env.DOC;
const URL = `http://localhost:3311/n/${NB}?doc=${DOC}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(URL, { waitUntil: "networkidle" });

// ── 1. Summary tab ──────────────────────────────────────────────────────────
await page.click('[aria-label="Summary"]');
await page.waitForTimeout(300);
check("summary tab opens", (await page.locator("aside >> text=Summary").count()) > 0);
check("depth control shows three levels",
  (await page.locator('button:text-is("Layman")').count()) === 1 &&
  (await page.locator('button:text-is("Intermediate")').count()) === 1 &&
  (await page.locator('button:text-is("Professional")').count()) === 1);
check("empty state offers Summarize", (await page.locator('button:text-is("Summarize")').count()) === 1);

await page.click('button:text-is("Summarize")');
try {
  await page.waitForSelector("aside >> text=Mock response", { timeout: 15000 });
  check("summary streams in", true);
} catch {
  check("summary streams in", false);
}
await page.waitForTimeout(800);
check("Regenerate appears after streaming", (await page.locator('button:text-is("Regenerate")').count()) === 1);

// Professional depth is separate and empty.
await page.click('button:text-is("Professional")');
await page.waitForTimeout(200);
check("professional depth empty until generated",
  (await page.locator("text=No summary at this depth yet").count()) === 1);
await page.click('button:text-is("Layman")');
await page.waitForTimeout(200);

// Persistence: reload, reopen Summary, the stored layman summary is there without generating.
await page.waitForTimeout(1000);
await page.reload({ waitUntil: "networkidle" });
await page.click('[aria-label="Summary"]');
try {
  await page.waitForSelector("aside >> text=Mock response", { timeout: 5000 });
  check("summary persists across reload", true);
} catch {
  check("summary persists across reload", false);
}

// ── 2. Simplify bubble ──────────────────────────────────────────────────────
// Collapse the tray so the right margin is wide, then select text.
await page.click('[aria-label="Collapse the notes tray"]');
await page.waitForTimeout(300);

const para = page.locator("[data-block-id] >> nth=1");
const originalText = await para.textContent();
await page.evaluate(() => {
  const blocks = document.querySelectorAll("[data-block-id]");
  const p = blocks[1];
  const textNode = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(60, textNode.textContent.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await para.dispatchEvent("mouseup");
await page.waitForTimeout(400);
check("popover appears", (await page.locator("[data-selection-popover]").count()) > 0);

await page.click('[data-selection-popover] >> button:text-is("Simplify")');
try {
  await page.waitForSelector(".bubble-in", { timeout: 5000 });
  check("simplify bubble appears", true);
} catch {
  check("simplify bubble appears", false);
}
try {
  await page.waitForSelector(".bubble-in >> text=Mock response", { timeout: 15000 });
  check("simplify streams into the bubble", true);
} catch {
  check("simplify streams into the bubble", false);
}
await page.waitForTimeout(400);
check("bubble header reads Simplified",
  (await page.locator(".bubble-in >> text=Simplified").count()) > 0);

// Position: the bubble sits to the right of the article.
const articleBox = await page.locator("article").boundingBox();
const bubbleBox = await page.locator(".bubble-in").boundingBox();
check("bubble sits right of the article",
  bubbleBox !== null && articleBox !== null && bubbleBox.x >= articleBox.x + articleBox.width - 1,
  `bubble.x=${bubbleBox?.x} article.right=${articleBox ? articleBox.x + articleBox.width : "?"}`);

check("selection stays tinted", (await page.locator(".simplify-mark").count()) > 0);
const textAfter = await para.textContent();
check("document text unchanged", textAfter === originalText);

// Close: the bubble and the tint both go.
await page.click('.bubble-in [aria-label="Close"]');
await page.waitForTimeout(300);
check("bubble closes", (await page.locator(".bubble-in").count()) === 0);
check("tint clears on close", (await page.locator(".simplify-mark").count()) === 0);

check("no console errors", errors.length === 0, errors[0] ?? "");
console.log(results.join("\n"));
await browser.close();
