import { chromium } from "playwright-core";

const NB = "cmsor88jb000v7d88t5tasnxz"; // QA Student
const DOC = "cmsor88ia000h7d88tj7x1ze5"; // Search primer
const URL = `http://localhost:3311/n/${NB}?doc=${DOC}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(URL, { waitUntil: "networkidle" });

// 1. Guide dialog: ? button opens it, mentions Extract, Escape closes it.
await page.click('[aria-label="Guide"]');
await page.waitForTimeout(300);
const guideVisible = await page.locator('[aria-label="Guide"][role="dialog"], [role="dialog"]').count();
const extractExplained = await page.locator("text=the note-taking tool").count();
check("guide dialog opens", guideVisible > 0);
check("guide explains Extract", extractExplained > 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("guide closes on Escape", (await page.locator('[role="dialog"]').count()) === 0);

// 2. Selection popover: select text, popover appears; Escape dismisses it.
const para = page.locator("[data-block-id] >> nth=1");
await page.evaluate(() => {
  const blocks = document.querySelectorAll("[data-block-id]");
  const p = blocks[1];
  const textNode = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(30, textNode.textContent.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await para.dispatchEvent("mouseup");
await page.waitForTimeout(400);
check("popover appears on selection", (await page.locator("[data-selection-popover]").count()) > 0);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("popover closes on Escape", (await page.locator("[data-selection-popover]").count()) === 0);

// 3. Optimistic highlight: select again, click a color dot, mark paints fast.
await page.evaluate(() => {
  const blocks = document.querySelectorAll("[data-block-id]");
  const p = blocks[1];
  const textNode = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(20, textNode.textContent.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await para.dispatchEvent("mouseup");
await page.waitForTimeout(400);
const t0 = Date.now();
await page.click('[aria-label="Highlight in gold"]');
await page.waitForSelector(".hl-gold", { timeout: 3000 });
check("highlight paints", true, `${Date.now() - t0}ms`);

// 4. CRITICAL editor fix: edit mode, type into a paragraph, click H3 without blur.
await page.click("text=Edit >> nth=0");
await page.waitForTimeout(300);
const editable = page.locator("[data-edit-block] >> nth=1");
await editable.click();
await page.keyboard.press("End");
await page.keyboard.type(" UNSAVED-TAIL");
await page.waitForTimeout(150);
await page.click('button:text-is("H3")');
await page.waitForTimeout(1500);
const blockText = await page.evaluate(
  () => document.querySelectorAll("[data-edit-block]")[1]?.textContent ?? "",
);
check("typed text survives format click", blockText.includes("UNSAVED-TAIL"), blockText.slice(-30));

// caret/focus retained?
const focusInBlock = await page.evaluate(() =>
  Boolean(document.activeElement?.closest("[data-edit-block]")),
);
check("focus kept after format", focusInBlock);
await page.click('button:text-is("¶")');
await page.waitForTimeout(800);

// 5. Insert paragraph: empty with placeholder, focused.
const firstGap = page.locator('[aria-label="Insert a paragraph here"] >> nth=0');
await firstGap.evaluate((el) => el.click());
await page.waitForTimeout(1500);
const inserted = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el || !el.hasAttribute("data-edit-block")) return { focused: false };
  return { focused: true, empty: el.textContent === "", placeholder: el.dataset.placeholder };
});
check("inserted paragraph auto-focused", inserted.focused);
check("inserted paragraph empty with placeholder", inserted.empty === true && inserted.placeholder === "Type here");
if (inserted.focused) {
  await page.keyboard.type("A fresh paragraph.");
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(() =>
    [...document.querySelectorAll("[data-edit-block]")].some(
      (el) => el.textContent === "A fresh paragraph.",
    ),
  );
  check("typed text saved on blur", saved);
}

// Done
await page.click("text=Done");
await page.waitForTimeout(300);

check("no console errors", errors.length === 0, errors[0] ?? "");
console.log(results.join("\n"));
await browser.close();
