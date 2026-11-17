// The assistant's bar beside a page that has to move for it (SPEC.md §29) in
// a real browser: on a blank document with the notes tray open, the
// selection toolbar's Assistant opens the bar, the page moves left once, and
// the page does not stop on an error. The page slides to its shift for
// 0.2 s; the bar is placed again before the page is there, and a bar that
// reads the page's place with the shift it asked for asks again without end
// (React error 185).
//
//   node scripts/qa/ui-assistant-bar.mjs <notebookId> <documentId> [outDir]
//
// <documentId> is a blank document with a few paragraphs of text. The app
// runs on :3111 with sign-in off (scripts/qa/tools-loop.mjs's header).
import { chromium } from "playwright-core";

const [NB, DOC, OUT = "scripts/qa/out"] = process.argv.slice(2);
if (!NB || !DOC) {
  console.error("usage: node scripts/qa/ui-assistant-bar.mjs <notebookId> <documentId> [outDir]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3111";
const URL = `${BASE}/n/${NB}?doc=${DOC}`;

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });

/** Select words of the paragraph at `index`, by a drag along its first line. */
async function selectWords(page, index) {
  const block = page.locator("[data-reader-root] [data-block-id]").nth(index);
  await block.scrollIntoViewIfNeeded();
  const box = await block.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 10, { steps: 8 });
  await page.mouse.up();
  await page.waitForSelector('[data-selection-popover] [data-track="assistant"]');
}

/** The bar's box and the page's, once the page has come to rest. */
async function measure(page) {
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const pane = document.querySelector("[data-reader-root]");
    const bar = document.querySelector("[data-assistant-bar]")?.getBoundingClientRect();
    const text = document.querySelector("[data-docs-body]")?.getBoundingClientRect();
    const paneRect = pane?.getBoundingClientRect();
    return {
      crashed: document.body.innerText.includes("stopped on an error"),
      shift: parseFloat(pane?.style.getPropertyValue("--docs-shift") ?? "") || 0,
      bar: bar ? { left: bar.left, right: bar.right, top: bar.top } : null,
      textRight: text?.right ?? null,
      paneRight: paneRect?.right ?? null,
    };
  });
}

for (const width of [1100, 1250, 1430]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector("[data-reader-root] [data-block-id]");
  // The tray open beside the page: the margin has no room for the bar.
  await page.click('nav [data-track="assistant"]');
  await page.waitForTimeout(800);

  await selectWords(page, 2);
  await page.locator('[data-selection-popover] [data-track="assistant"]').first().click();
  let got = await measure(page);
  check(`${width}: the page did not stop on an error`, !got.crashed && errors.length === 0, errors[0] ?? "");
  check(`${width}: the bar is open`, got.bar !== null);
  if (got.bar) {
    check(`${width}: the bar stands inside the pane`, got.bar.right <= got.paneRight + 1, `right ${got.bar.right}, pane ${got.paneRight}`);
    // A page that moved for the bar gave it room clear of the text.
    if (got.shift > 0) {
      check(`${width}: the bar is clear of the text`, got.bar.left >= got.textRight, `left ${got.bar.left}, text ${got.textRight}, shift ${got.shift}`);
    }
  }
  // The page moved once, for the room the bar needs, and stays there.
  const first = got.shift;
  got = await measure(page);
  check(`${width}: the shift holds still`, got.shift === first && !got.crashed, `${first} then ${got.shift}`);

  // A second bar, on other words, with the first one's shift still held.
  await page.keyboard.press("Escape");
  await selectWords(page, 4);
  await page.locator('[data-selection-popover] [data-track="assistant"]').first().click();
  got = await measure(page);
  check(`${width}: a second bar opens with no error`, !got.crashed && errors.length === 0 && got.bar !== null, errors[0] ?? "");
  if (failed) await page.screenshot({ path: `${OUT}/assistant-bar-${width}.png` }).catch(() => {});
  await context.close();
}

await browser.close();
console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
