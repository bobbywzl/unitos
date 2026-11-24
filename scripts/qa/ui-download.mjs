// Download (SPEC.md §15) in a real browser: the header's Download button on
// a document without rich text (an article) and on one with rich text (a
// blank document or an import). Every row saves a file named by the title,
// PDF prints (the article in a frame of its own, the page editor its page),
// and no file holds a word of a note or an annotation.
//
//   node scripts/qa/ui-download.mjs <notebookId> <articleId> <richTextId> [noteWord]
//
// noteWord: a word that stands in a note or a comment on the article and
// nowhere in the article (scripts/qa/document-export-check.ts checks the
// files' shape with no browser). The app runs on :3111 with sign-in off
// (scripts/qa/tools-loop.mjs's header).
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const [NB, ARTICLE, RICH, NOTE_WORD = ""] = process.argv.slice(2);
if (!NB || !ARTICLE || !RICH) {
  console.error("usage: node scripts/qa/ui-download.mjs <notebookId> <articleId> <richTextId> [noteWord]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3111";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 1430, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function open(documentId) {
  await page.goto(`${BASE}/n/${NB}?doc=${documentId}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector("[data-reader-root] [data-block-id]");
  await page.waitForTimeout(1500);
}
async function menu() {
  if (!(await page.locator('[role="menu"][aria-label="Download"]').count())) await page.click('header [data-track="download"]');
  await page.waitForSelector('[role="menu"][aria-label="Download"]');
}
async function take(format) {
  await menu();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.click(`[data-track="download:${format}"]`)]);
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

for (const [kind, documentId] of [["article", ARTICLE], ["rich text", RICH]]) {
  await open(documentId);
  await menu();
  const rows = await page.locator('[role="menu"][aria-label="Download"] [role="menuitem"]').allInnerTexts();
  check(`${kind}: the menu lists the five formats`, ["docx", "pdf", "html", "md", "txt"].every((f) => rows.some((r) => r.includes(`.${f})`))), rows.join(", "));
  for (const format of ["docx", "html", "md", "txt"]) {
    try {
      const file = await take(format);
      check(`${kind}: ${format} saves a file`, file.name.endsWith(`.${format}`) && file.bytes.length > 100, `${file.name}, ${file.bytes.length} b`);
      // A Word file is zipped: its words are not read here.
      if (NOTE_WORD && format !== "docx") check(`${kind}: ${format} holds no note or annotation`, !file.bytes.includes(NOTE_WORD));
    } catch (err) {
      check(`${kind}: ${format} saves a file`, false, String(err.message).split("\n")[0]);
    }
  }
  // PDF is the print dialog: the article's own page in a frame that runs no
  // script, the page editor's page as it is.
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => void (window.__printed += 1);
  });
  await menu();
  await page.click('[data-track="download:pdf"]');
  await page.waitForTimeout(2500);
  const frames = await page.locator("iframe[sandbox]:not([sandbox~='allow-scripts'])").count();
  const printed = await page.evaluate(() => window.__printed);
  check(`${kind}: PDF opens the print dialog`, kind === "article" ? frames === 1 : printed === 1, `frames ${frames}, page printed ${printed}`);
}
check("no page error", errors.length === 0 && (await page.locator("text=stopped on an error").count()) === 0, errors[0] ?? "");

await browser.close();
console.log(failed === 0 ? "\nall checks passed" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
