// Edit mode and the styling shortcuts (SPEC.md §6), driven in the built app:
// the format bar leaves with the mode, and Cmd/Ctrl+B, I, U style the
// selection in the reader, in a note, and in a comment.
// Env: NB, DOC, NOTE, CHROME.
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });

const bar = () => page.locator("[data-edit-toolbar]");
const para = () => page.locator("article.reader-prose p[data-block-id]").first();

/** Select `count` words from the start of the focused editable block. */
async function selectWords(count) {
  await page.keyboard.press("Home");
  for (let i = 0; i < count; i++) await page.keyboard.press("Shift+Control+ArrowRight");
}

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/keys-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // ── The bar comes with edit mode ──
  check("no format bar while reading", (await bar().count()) === 0);
  await para().dblclick();
  await page.waitForTimeout(400);
  check("double-click opens the format bar", (await bar().count()) === 1);

  // ── A press outside the article leaves edit mode, and the bar goes ──
  await page.locator('aside[data-track-surface="tray"]').click({ position: { x: 30, y: 8 } });
  await page.waitForTimeout(400);
  check("a press outside the article closes the format bar", (await bar().count()) === 0);

  // ── Escape still leaves too ──
  await para().dblclick();
  await page.waitForTimeout(300);
  check("the bar is back", (await bar().count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape closes the format bar", (await bar().count()) === 0);

  // ── Ctrl+B in the reader's edit mode bolds the selection ──
  // Read the block's id while reading: editing renames the attribute.
  const blockId = await para().getAttribute("data-block-id");
  await para().dblclick();
  await page.waitForTimeout(400);
  await page.locator(`[data-edit-block="${blockId}"]`).click();
  // The block keeps whatever styles earlier runs left, so each shortcut is
  // checked by its toggle: one press changes the spans, a second press on the
  // same words puts them back.
  const spans = (cls) => page.locator(`[data-edit-block="${blockId}"] .${cls}`).count();
  for (const [key, cls, name] of [["b", "font-bold", "Ctrl+B bolds"], ["i", "italic", "Ctrl+I italicizes"], ["u", "underline", "Ctrl+U underlines"]]) {
    const before = await spans(cls);
    await selectWords(3);
    await page.keyboard.press(`Control+${key}`);
    await page.waitForTimeout(700);
    const after = await spans(cls);
    await selectWords(3);
    await page.keyboard.press(`Control+${key}`);
    await page.waitForTimeout(700);
    const back = await spans(cls);
    check(`${name} the selection in the reader`, after !== before && back === before,
      `${before} → ${after} → ${back}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // ── Ctrl+B in a note's editor writes the markdown markers ──
  const noteCard = page.locator(`aside[data-track-surface="tray"] [data-note-id="${NOTE}"]`);
  await noteCard.locator('button[data-track="note-edit"]').first().click();
  await page.waitForTimeout(500);
  const editable = page.locator('aside[data-track-surface="tray"] [role="textbox"].note-doc').first();
  check("the note editor is open", (await editable.count()) === 1);
  // The note keeps whatever earlier runs left too: check the same toggle.
  const selectLine = async () => {
    await editable.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
  };
  for (const [key, tag, name] of [["b", "strong", "Ctrl+B bolds"], ["i", "em", "Ctrl+I italicizes"], ["u", "u", "Ctrl+U underlines"]]) {
    const count = () => editable.locator(tag).count();
    const before = await count();
    await selectLine();
    await page.keyboard.press(`Control+${key}`);
    await page.waitForTimeout(400);
    const after = await count();
    await selectLine();
    await page.keyboard.press(`Control+${key}`);
    await page.waitForTimeout(400);
    const back = await count();
    check(`${name} in the note editor`, after !== before && back === before, `${before} → ${after} → ${back}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // ── Ctrl+B in a comment box wraps the selection in markdown ──
  const block = page.locator(`article.reader-prose [data-block-id="${blockId}"]`);
  await block.evaluate((el) => {
    const range = document.createRange();
    const text = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim().length > 20) ?? el.firstChild;
    range.setStart(text, 0);
    range.setEnd(text, 12);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForTimeout(600);
  const commentBtn = page.locator('[data-selection-popover] button[data-track="comment"]');
  check("the selection tools opened", (await commentBtn.count()) === 1);
  await commentBtn.click();
  await page.waitForTimeout(400);
  const commentBox = page.locator('[data-selection-popover] textarea').first();
  await commentBox.fill("bold this word");
  await commentBox.evaluate((el) => el.setSelectionRange(0, 4));
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(300);
  check("Ctrl+B marks the comment's selection", (await commentBox.inputValue()) === "**bold** this word",
    await commentBox.inputValue());
  await commentBox.evaluate((el) => el.setSelectionRange(0, 8));
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(300);
  check("Ctrl+B again unmarks it", (await commentBox.inputValue()) === "bold this word",
    await commentBox.inputValue());
  await page.screenshot({ path: `${SHOT}/keys.png` });
}
