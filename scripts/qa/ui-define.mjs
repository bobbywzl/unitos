// UI verification for Define (SPEC.md §6): the first row of the AI toolbar
// on a selection of one word, right under the highlight colors, on every
// surface the reader draws — an article, a transcript, slides, a sheet, a
// blank document in the page editor, a core in the collapsed view, a key
// term — and never on two words, a list, a sentence, or Chinese text, in
// either interface language. The definition streams under the row; a key
// term's is the glossary's, with no call. The route refuses anything but
// one word.
//
// Usage: DATABASE_URL=... NB=<notebook> DOC=<article> AUDIO=<audio document>
//   ZH=<Chinese document> CHROME=<chromium> node scripts/qa/ui-define.mjs
// Expects the server on :3311 against the same database and the model mock
// (scripts/qa/mock-kimi.mjs; MOONSHOT_API_KEY=mock
// MOONSHOT_BASE_URL=http://localhost:3399/v1), after scripts/qa/seed.mjs and
// scripts/qa/seed-ai-tools.mjs. Screenshots land in SHOT_DIR (default .).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const { NB, DOC, AUDIO, ZH } = process.env;
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const base = `http://localhost:${PORT}`;
const db = new PrismaClient();
const results = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  results.push(line);
  if (process.env.VERBOSE) console.error(line);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
// The seeded audio document has no bytes: its player's failed load is expected.
const ignorable = (text) => /\/api\/video\/|Failed to load resource|net::ERR/.test(text);
page.on("console", (m) => m.type() === "error" && !ignorable(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
// Every Define call the page makes, by its selection.
const defineCalls = [];
page.on("request", (r) => {
  if (!r.url().endsWith("/api/derive") || r.method() !== "POST") return;
  const body = JSON.parse(r.postData() ?? "{}");
  if (body.type === "DEFINE") defineCalls.push(body.anchor?.quotedText ?? "");
});

// Select `text` inside the element, in one text node, and let go of the
// mouse there: the reader opens its toolbar on the mouseup.
async function select(p, selector, text) {
  const found = await p.evaluate(
    ({ selector, text }) => {
      for (const el of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const at = node.textContent.indexOf(text);
          if (at === -1) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + text.length);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return true;
        }
      }
      return false;
    },
    { selector, text },
  );
  if (!found) throw new Error(`"${text}" is not in ${selector}`);
  await p.waitForTimeout(500);
}

const toolbar = (p) => p.locator('[data-selection-popover][data-track-surface="ai-toolbar"]').first();
const defineRow = (p) => p.locator('[data-track="define"]');

// The toolbar's geometry: Define is the first tool under the highlight
// colors, and the assistant sits under it. On a fine pointer the Add to notes
// bubble floats above the colors, so the tools counted are the ones below them.
async function layout(p) {
  return p.evaluate(() => {
    const box = document.querySelector('[data-selection-popover][data-track-surface="ai-toolbar"]');
    if (!box) return null;
    const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const colors = box.querySelector('[data-track^="highlight:"]')?.parentElement;
    const floor = colors ? colors.getBoundingClientRect().bottom - 1 : -Infinity;
    const tools = [...box.querySelectorAll("button[data-track]")]
      .filter((b) => !b.dataset.track.startsWith("highlight:") && !b.closest("[data-definition]"))
      .map((b) => ({ track: b.dataset.track, top: b.getBoundingClientRect().top }))
      .filter((b) => b.top >= floor)
      .sort((a, b) => a.top - b.top);
    return {
      width: box.getBoundingClientRect().width,
      first: tools[0]?.track ?? null,
      define: rect(box.querySelector('[data-track="define"]')),
      assistant: rect(box.querySelector('[data-track="assistant"]')),
      colors: rect(colors),
    };
  });
}

async function definitionText(p) {
  const panel = p.locator("[data-definition]");
  await panel.waitFor({ timeout: 15000 });
  await p.waitForFunction(() => {
    const el = document.querySelector("[data-definition]");
    return el && !el.querySelector('[role="status"]') && el.textContent.length > 20;
  }, null, { timeout: 15000 });
  // The fold opens over 0.22 s (globals.css .folding): let it finish, so a
  // screenshot shows the whole definition.
  await p.waitForTimeout(400);
  return panel.innerText();
}

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/define-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
await db.$disconnect();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // ── The route: one word, nothing else ──
  const docRow = await db.document.findUnique({ where: { id: DOC }, include: { blocks: { orderBy: { order: "asc" } } } });
  const paragraph = docRow.blocks.find((b) => b.type === "PARAGRAPH" && b.text.includes("monetization"));
  const at = paragraph.text.indexOf("monetization");
  const anchor = (start, end) => ({
    blockId: paragraph.id,
    startOffset: start,
    endOffset: end,
    quotedText: paragraph.text.slice(start, end),
    prefix: paragraph.text.slice(Math.max(0, start - 32), start),
    suffix: paragraph.text.slice(end, end + 32),
  });
  const derive = (a) =>
    fetch(`${base}/api/derive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "DEFINE", documentId: DOC, notebookId: NB, anchor: a }),
    });
  const ok = await derive(anchor(at, at + "monetization".length));
  const okText = await ok.text();
  check("route: DEFINE streams a definition", ok.status === 200 && okText.includes("Mock definition of monetization"), okText.trim().slice(0, 80));
  const long = await derive(anchor(0, Math.min(paragraph.text.length, 160)));
  const longBody = await long.json().catch(() => ({}));
  check("route: a longer selection is refused", long.status === 400 && /one word/.test(longBody.error ?? ""), `${long.status} ${longBody.error ?? ""}`);
  const two = await derive(anchor(at, at + "monetization edge".length));
  check("route: two words are refused", two.status === 400, `${two.status}`);
  const notes = await db.note.count({ where: { derivationType: "DEFINE" } });
  check("route: nothing persists", notes === 0, `${notes} DEFINE notes`);

  // ── The article ──
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });
  const para = `[data-block-id="${paragraph.id}"]`;
  await select(page, para, "monetization");
  await toolbar(page).waitFor({ timeout: 5000 });
  const before = await layout(page);
  check("article: Define shows on one word", (await defineRow(page).count()) === 1);
  check("article: Define is the first tool", before?.first === "define", before?.first ?? "none");
  check(
    "article: the highlight colors sit right above Define",
    before?.colors && before?.define && before.colors.bottom <= before.define.top && before.define.top - before.colors.bottom < 30,
    before?.colors && before?.define ? `gap ${Math.round(before.define.top - before.colors.bottom)}px` : "",
  );
  check("article: the assistant sits under Define", before?.assistant && before.assistant.top >= before.define.bottom);
  await defineRow(page).click();
  const meaning = await definitionText(page);
  check("article: the definition lands under the row", meaning.includes("Mock definition of monetization"), meaning.replace(/\s+/g, " ").slice(0, 90));
  const after = await layout(page);
  check("article: the toolbox widens for the definition", after && after.width > before.width, `${Math.round(before?.width ?? 0)} → ${Math.round(after?.width ?? 0)}`);
  check("article: the definition carries the rating", (await page.locator('[data-definition] [data-rating="define"]').count()) === 1);
  await page.screenshot({ path: `${SHOT}/define-article.png` });
  // A second press folds it; a third reads it from the session, no call.
  const calls = defineCalls.length;
  await defineRow(page).click();
  await page.waitForTimeout(400);
  check("article: a second press folds the definition", (await page.locator("[data-definition]").count()) === 0);
  await defineRow(page).click();
  await page.locator("[data-definition]").waitFor({ timeout: 5000 });
  check("article: the same word again costs no call", defineCalls.length === calls, `${defineCalls.length - calls} calls`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // A word with its period shows Define; two words, a list, a sentence, and
  // a selection over a sentence end do not.
  await select(page, para, "targeting.");
  check("article: Define shows on a word with its period", (await defineRow(page).count()) === 1);
  await page.keyboard.press("Escape");
  await select(page, para, "monetization edge");
  check("article: no Define on two words", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  await select(page, para, "more advertisers, better targeting.");
  check("article: no Define on a list", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  const sentence = paragraph.text.split(". ")[0];
  await select(page, para, sentence);
  check("article: no Define on a sentence", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0, `${sentence.split(/\s+/).length} words`);
  await page.keyboard.press("Escape");
  const end = paragraph.text.indexOf(". ");
  const across = paragraph.text.slice(end - 6, end + 6);
  await select(page, para, across);
  check("article: no Define over a sentence end", (await defineRow(page).count()) === 0, JSON.stringify(across));
  await page.keyboard.press("Escape");

  // ── A key term: one word's is the glossary's definition, no call; a
  // longer one has no Define (its hover shows the definition) ──
  const termBlock = docRow.blocks.find((b) => b.type === "PARAGRAPH" && b.text.includes("Alice study"));
  const slotBlock = docRow.blocks.find((b) => b.type === "PARAGRAPH" && b.text.includes("default slot"));
  const glossaryDefinition = "Google's internal study of what Microsoft would have to pay Apple to take the default.";
  const slotDefinition = "The browser's or the phone's preset search engine, sold to the highest bidder.";
  await db.document.update({
    where: { id: DOC },
    data: {
      glossary: [
        { term: "Alice", definition: glossaryDefinition, blockIds: [termBlock.id], lang: "en", definitions: { en: glossaryDefinition } },
        { term: "default slot", definition: slotDefinition, blockIds: [slotBlock.id], lang: "en", definitions: { en: slotDefinition } },
      ],
    },
  });
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".glossary-term", { timeout: 20000 });
  const termCalls = defineCalls.length;
  await page.locator(".glossary-term", { hasText: "default slot" }).first().dispatchEvent("mousedown", { button: 0 });
  await page.waitForTimeout(400);
  check("key term of two words: no Define", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(".glossary-term", { hasText: /^Alice$/ }).first().dispatchEvent("mousedown", { button: 0 });
  await page.waitForTimeout(400);
  check("key term: Define shows on the term's toolbar", (await defineRow(page).count()) === 1);
  await defineRow(page).click();
  await page.waitForTimeout(400);
  const termMeaning = await page.locator("[data-definition]").innerText();
  check("key term: the glossary's definition, at once", termMeaning.includes(glossaryDefinition), termMeaning.replace(/\s+/g, " ").slice(0, 90));
  check("key term: no call", defineCalls.length === termCalls);
  check("key term: no rating on the glossary's words", (await page.locator('[data-definition] [data-rating="define"]').count()) === 0);
  await page.screenshot({ path: `${SHOT}/define-key-term.png` });
  await page.keyboard.press("Escape");
  await db.document.update({ where: { id: DOC }, data: { glossary: [] } });

  // ── The collapsed view: a core's words ──
  const cores = docRow.blocks
    .filter((b) => b.type === "PARAGRAPH" || b.type === "LIST")
    .map((b) => ({
      blockId: b.id,
      hash: createHash("md5").update(b.text).digest("hex").slice(0, 12),
      text: `Core: the defaults decide the first query, and ${b.text.split(/\s+/).slice(0, 5).join(" ")}.`,
    }));
  await db.document.update({ where: { id: DOC }, data: { collapse: { v: 1, cores } } });
  await page.evaluate((id) => localStorage.setItem(`unitos-collapse-${id}`, "on"), DOC);
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-collapsed]", { timeout: 20000 });
  await select(page, "[data-collapsed]", "defaults");
  check("core: Define shows on a core's word", (await defineRow(page).count()) === 1);
  await defineRow(page).click();
  const coreMeaning = await definitionText(page);
  check("core: the definition lands", coreMeaning.includes("Mock definition of defaults"), coreMeaning.replace(/\s+/g, " ").slice(0, 90));
  await page.screenshot({ path: `${SHOT}/define-core.png` });
  await page.keyboard.press("Escape");
  await page.evaluate((id) => localStorage.removeItem(`unitos-collapse-${id}`), DOC);
  await db.document.update({ where: { id: DOC }, data: { collapse: null } });

  // ── The transcript ──
  await page.goto(`${base}/n/${NB}?doc=${AUDIO}`, { waitUntil: "networkidle" });
  const audioRow = await db.document.findUnique({ where: { id: AUDIO }, include: { blocks: { orderBy: { order: "asc" } } } });
  const line = audioRow.blocks.find((b) => b.type === "TRANSCRIPT" && b.text.includes("default"));
  await page.waitForSelector(`[data-block-id="${line.id}"]`, { timeout: 20000 });
  await select(page, `[data-block-id="${line.id}"]`, "default search engine");
  check("transcript: no Define on three words", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  await select(page, `[data-block-id="${line.id}"]`, "default");
  check("transcript: Define shows on a word of a line", (await defineRow(page).count()) === 1);
  const transcriptLayout = await layout(page);
  check("transcript: Define is the first tool", transcriptLayout?.first === "define", transcriptLayout?.first ?? "none");
  await defineRow(page).click();
  const lineMeaning = await definitionText(page);
  check("transcript: the definition lands", lineMeaning.includes("Mock definition of default:"), lineMeaning.replace(/\s+/g, " ").slice(0, 90));
  await page.screenshot({ path: `${SHOT}/define-transcript.png` });
  await page.keyboard.press("Escape");

  // ── Slides and a sheet ──
  const upload = async (file, name) => {
    const form = new FormData();
    form.set("file", new Blob([readFileSync(file)]), name);
    form.set("notebookId", NB);
    const res = await fetch(`${base}/api/documents`, { method: "POST", body: form });
    const lines = (await res.text()).split("\n").filter((l) => l.trim());
    return JSON.parse(lines[lines.length - 1]).id;
  };
  const deckId = await upload("scripts/qa/fixtures/office/deck.pptx", "deck.pptx");
  const bookId = await upload("scripts/qa/fixtures/office/book.xlsx", "book.xlsx");
  for (const [label, id, type] of [
    ["slides", deckId, "SLIDE"],
    ["sheet", bookId, "SHEET"],
  ]) {
    const row = await db.document.findUnique({ where: { id }, include: { blocks: { orderBy: { order: "asc" } } } });
    const block = row?.blocks.find((b) => b.type === type && /\p{L}{4,}/u.test(b.text));
    if (!block) {
      check(`${label}: a ${type} block with words`, false, row ? row.blocks.map((b) => b.type).join(",") : "not uploaded");
      continue;
    }
    const word = block.text.match(/\p{L}{4,}/u)[0];
    await page.goto(`${base}/n/${NB}?doc=${id}`, { waitUntil: "networkidle" });
    await page.waitForSelector(`[data-block-id="${block.id}"]`, { timeout: 20000 });
    await select(page, `[data-block-id="${block.id}"]`, word);
    check(`${label}: Define shows on a word`, (await defineRow(page).count()) === 1, word);
    await defineRow(page).click();
    const text = await definitionText(page);
    check(`${label}: the definition lands`, text.includes(`Mock definition of ${word}`), text.replace(/\s+/g, " ").slice(0, 90));
    await page.screenshot({ path: `${SHOT}/define-${label}.png` });
    await page.keyboard.press("Escape");
  }

  // ── A blank document in the page editor (SPEC.md §29) ──
  const blankRes = await fetch(`${base}/api/documents/blank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notebookId: NB, title: "Define in the page editor (QA)" }),
  });
  const blank = await blankRes.json();
  await page.goto(`${base}/n/${NB}?doc=${blank.id}`, { waitUntil: "networkidle" });
  const editor = "[data-docs-editor] .ProseMirror";
  await page.waitForSelector(editor, { timeout: 30000 });
  await page.locator(editor).click();
  await page.keyboard.type("The ledger reconciles accruals every quarter.");
  // The typing saves after a pause (700 ms); Define saves what waits first.
  await page.waitForTimeout(1500);
  await select(page, editor, "accruals");
  check("page editor: Define shows on a word", (await defineRow(page).count()) === 1);
  const pageLayout = await layout(page);
  check("page editor: Define is the first tool", pageLayout?.first === "define", pageLayout?.first ?? "none");
  await defineRow(page).click();
  const pageMeaning = await definitionText(page);
  check("page editor: the definition lands", pageMeaning.includes("Mock definition of accruals"), pageMeaning.replace(/\s+/g, " ").slice(0, 90));
  await page.screenshot({ path: `${SHOT}/define-page-editor.png` });
  await page.keyboard.press("Escape");
  await fetch(`${base}/api/documents/${blank.id}`, { method: "DELETE" });

  // ── Chinese text: no Define, in either interface language; the Chinese
  // interface keeps Define on an English word ──
  await page.goto(`${base}/n/${NB}?doc=${ZH}`, { waitUntil: "networkidle" });
  const zhRow = await db.document.findUnique({ where: { id: ZH }, include: { blocks: { orderBy: { order: "asc" } } } });
  const zhParagraph = zhRow.blocks.find((b) => b.type === "PARAGRAPH" && b.text.includes("规模经济"));
  const zhBlock = `[data-block-id="${zhParagraph.id}"]`;
  await page.waitForSelector(zhBlock, { timeout: 20000 });
  await select(page, zhBlock, "规模经济");
  check("Chinese text: no Define on a word", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  await select(page, zhBlock, "规");
  check("Chinese text: no Define on one character", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  await context.addCookies([{ name: "dissect-lang", value: "zh", url: base }]);
  await page.goto(`${base}/n/${NB}?doc=${ZH}`, { waitUntil: "networkidle" });
  await page.waitForSelector(zhBlock, { timeout: 20000 });
  await select(page, zhBlock, "规模经济");
  check("Chinese interface, Chinese text: no Define", (await toolbar(page).count()) === 1 && (await defineRow(page).count()) === 0);
  await page.keyboard.press("Escape");
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.waitForSelector(para, { timeout: 20000 });
  await select(page, para, "monetization");
  check("Chinese interface: the row reads 定义 on an English word", (await defineRow(page).innerText()).includes("定义"));
  await defineRow(page).click();
  const zhText = await definitionText(page);
  check("Chinese interface: the definition lands", zhText.includes("Mock definition of monetization"), zhText.replace(/\s+/g, " ").slice(0, 60));
  await page.screenshot({ path: `${SHOT}/define-zh.png` });
  await page.keyboard.press("Escape");
  await context.clearCookies({ name: "dissect-lang" });

  // ── A touch screen: Define right after the colors row ──
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await touch.newPage();
  await phone.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await phone.waitForSelector(para, { timeout: 20000 });
  await phone.evaluate((selector) => {
    const el = document.querySelector(selector);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.indexOf("monetization");
      if (at === -1) continue;
      el.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "monetization".length);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      return;
    }
  }, para);
  await phone.waitForTimeout(1200);
  const phoneLayout = await layout(phone);
  check("touch: Define shows", (await defineRow(phone).count()) === 1);
  check(
    "touch: Define sits right after the colors row",
    phoneLayout?.colors && phoneLayout?.define && phoneLayout.define.top >= phoneLayout.colors.bottom && phoneLayout.define.top - phoneLayout.colors.bottom < 12 && phoneLayout.first === "define",
    phoneLayout?.colors && phoneLayout?.define ? `gap ${Math.round(phoneLayout.define.top - phoneLayout.colors.bottom)}px, first ${phoneLayout.first}` : "",
  );
  await phone.screenshot({ path: `${SHOT}/define-touch.png` });
  await touch.close();
}
