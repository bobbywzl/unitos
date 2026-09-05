// The AI tools round (SPEC.md §4, §7, §11, §19), driven in the built app
// against the mocks: Analyze on a table and a figure, Compare two documents,
// Ask about a range on an audio document, Translate a Chinese document, a
// voice note, and the assistant's web access with cited sources.
// Env: NB, DOC, TABLE, FIGURE, AUDIO, ZH, CHROME. The server runs with
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:3399
//   DEEPL_API_KEY=mock:fx DEEPL_API_URL=http://localhost:3398
//   GROQ_API_KEY=mock GROQ_API_URL=http://localhost:3398/openai/v1/audio/transcriptions
// (scripts/qa/mock-anthropic.mjs and scripts/qa/mock-services.mjs).
import { chromium } from "playwright-core";

const { NB, DOC, TABLE, FIGURE, FIGURE_TEXT, AUDIO, ZH } = process.env;
const PORT = process.env.PORT ?? "3311";
const SHOT = process.env.SHOT_DIR ?? ".";
const base = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  results.push(line);
  if (process.env.VERBOSE) console.error(line);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["microphone"], { origin: base });
const page = await context.newPage();
const errors = [];
// The seeded audio document has no bytes: its player's failed load is expected.
const ignorable = (text) => /\/api\/video\/|Failed to load resource|net::ERR/.test(text);
page.on("console", (m) => m.type() === "error" && !ignorable(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const tray = () => page.locator('aside[data-track-surface="tray"]');
const selectIn = async (blockId, chars = 30) => {
  await page.evaluate(
    ({ blockId, chars }) => {
      const block = document.querySelector(`[data-block-id="${blockId}"]`);
      const textNode = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.textContent.trim().length > 3 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
      }).nextNode();
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(chars, textNode.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    { blockId, chars },
  );
  await page.locator(`[data-block-id="${blockId}"]`).dispatchEvent("mouseup");
  await page.waitForTimeout(500);
};

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/ai-tools-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // ── Analyze a table from the selection popover ──
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });
  await selectIn(TABLE, 5);
  const analyzeButton = page.locator('[data-selection-popover] button[data-track="analyze"]');
  check("table selection offers Analyze table", (await analyzeButton.count()) === 1);
  check("table Analyze reads 'Analyze table'", (await analyzeButton.textContent())?.includes("Analyze table") === true);
  await analyzeButton.click();
  await page.waitForFunction(() => document.body.innerText.includes("Analysis added"), null, { timeout: 60000 });
  check("toast says the analysis landed", true);
  await page.waitForTimeout(1500);
  const tableNote = tray().getByText("Table analysis", { exact: false }).first();
  await tableNote.waitFor({ timeout: 15000 });
  check("a pending Table analysis note is in the tray", (await tableNote.count()) === 1);
  const trayText = await tray().innerText();
  check("the analysis lists the data rows", trayText.includes("Pages · 2"));
  check("an estimate is marked with ≈", trayText.includes("≈ 80"));

  // ── Analyze a figure: the hold-and-circle gesture opens the figure popover ──
  await page.keyboard.press("Escape");
  const figureImage = page.locator(`[data-block-id="${FIGURE}"] img`).first();
  await figureImage.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const figureBox = await figureImage.boundingBox();
  if (figureBox) {
    const cx = figureBox.x + figureBox.width / 2;
    const cy = figureBox.y + figureBox.height / 2;
    await page.mouse.move(cx + 30, cy);
    await page.mouse.down();
    for (let i = 1; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      await page.mouse.move(cx + 30 * Math.cos(a), cy + 30 * Math.sin(a), { steps: 1 });
      await page.waitForTimeout(10);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  const figureAnalyze = page.locator('[data-selection-popover] button[data-track="analyze"]');
  check("circling the figure offers Analyze figure", figureBox !== null && (await figureAnalyze.count()) === 1 && (await figureAnalyze.textContent())?.includes("Analyze figure") === true);
  await page.keyboard.press("Escape");

  // ── Analyze a figure through the route ──
  const caption = FIGURE_TEXT ?? "";
  const figureRes = await page.request.post(`${base}/api/derive`, {
    data: {
      type: "ANALYZE",
      documentId: DOC,
      notebookId: NB,
      anchor: { blockId: FIGURE, startOffset: 0, endOffset: caption.length, quotedText: caption },
    },
  });
  const figureRaw = (await figureRes.text()).trim();
  let figurePayload = null;
  try {
    figurePayload = JSON.parse(figureRaw);
  } catch {}
  check("figure ANALYZE answers ok with a note id", figureRes.ok() && figurePayload?.ok === true && Boolean(figurePayload.noteId), figureRaw.slice(0, 120));
  check("figure ANALYZE reports the chart kind", figurePayload?.kind === "chart");

  // ── Compare two documents from the document list ──
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });
  await page.locator('button[data-track="document-list"]').click();
  await page.waitForTimeout(400);
  const otherRow = page.locator('button[data-track="document-open"]:not([data-active-row])').first();
  const otherTitle = await otherRow.textContent();
  await otherRow.locator("xpath=..").locator('button[data-track="document-actions"]').click();
  await page.waitForTimeout(300);
  const compareButton = page.locator('button[data-track="document-compare"]').first();
  check("the other document's menu offers Compare with the open document", (await compareButton.count()) === 1);
  await compareButton.click();
  await page.waitForFunction(() => document.body.innerText.includes("Comparison added"), null, { timeout: 60000 });
  check("the notice says the comparison landed", true);
  await page.waitForTimeout(1500);
  const compareNote = tray().getByText("Compare:", { exact: false }).first();
  await compareNote.waitFor({ timeout: 15000 });
  const compareText = await tray().innerText();
  check("a pending Compare note names both documents", compareText.includes("Compare:") && compareText.includes((otherTitle ?? "").slice(0, 12)));
  check("the note lists Agree and Only in", compareText.includes("Agree") && compareText.includes("Only in"));

  // ── Voice note from the tray ──
  const section = tray().locator("div.group\\/section").first();
  await section.hover();
  const speak = section.locator('button[data-track="voice-note"]').first();
  check("the section offers Speak", (await speak.count()) === 1);
  await speak.click({ force: true });
  const stopButton = section.locator('button[data-track="voice-note-stop"]');
  await stopButton.waitFor({ timeout: 5000 });
  check("recording starts and offers Stop", (await stopButton.count()) === 1);
  await page.waitForTimeout(2500);
  await stopButton.click({ force: true });
  const voiceNote = tray().getByText("the first point", { exact: false }).first();
  await voiceNote.waitFor({ timeout: 30000 });
  check("the voice note lands pending, cleaned of filler", (await tray().innerText()).includes("Mock voice note, the first point."));

  // ── Ask about a range on the audio document ──
  await page.goto(`${base}/n/${NB}?doc=${AUDIO}`, { waitUntil: "networkidle" });
  const askOpen = page.locator('button[data-track="video-ask-open"]');
  await askOpen.waitFor({ timeout: 20000 });
  await askOpen.click();
  const card = page.locator("[data-ask-range]");
  await card.waitFor({ timeout: 5000 });
  check("the Ask card opens with a range", (await card.locator("input").nth(0).inputValue()) === "0:00");
  await card.locator("input").nth(2).fill("What does the study find?");
  await card.locator('button[data-track="video-ask"]').click();
  await page.waitForFunction(() => document.querySelector("[data-ask-range]")?.innerText.includes("Mock response"), null, { timeout: 60000 });
  check("the answer streams into the card", true);
  const addNote = card.locator('button[data-track="video-ask-add-note"]');
  await addNote.waitFor({ timeout: 5000 });
  await addNote.click();
  await page.waitForFunction(() => document.querySelector("[data-ask-range]")?.innerText.includes("pending"), null, { timeout: 15000 });
  check("Add to notes lands the answer pending", true);

  // ── Translate the Chinese document ──
  await page.goto(`${base}/n/${NB}?doc=${ZH}`, { waitUntil: "networkidle" });
  const bar = page.locator("[data-translation-bar]");
  await bar.waitFor({ timeout: 20000 });
  check("the Translate offer names the document's language", (await bar.innerText()).includes("Chinese"));
  await bar.locator('button[data-track="translate"]').click();
  await page.waitForFunction(() => document.querySelectorAll("[data-translation]").length >= 3, null, { timeout: 30000 });
  const firstTranslation = await page.locator("[data-translation]").first().innerText();
  check("translations read under the blocks, in the reader's language", firstTranslation.startsWith("[EN]"), firstTranslation.slice(0, 40));
  check("the bar credits DeepL", (await bar.innerText()).includes("DeepL"));
  await bar.locator('button[data-track="translate-hide"]').click();
  await page.waitForTimeout(300);
  check("Hide translation removes the lines", (await page.locator("[data-translation]").count()) === 0);
  await bar.locator('button[data-track="translate"]').click();
  await page.waitForFunction(() => document.querySelectorAll("[data-translation]").length >= 3, null, { timeout: 30000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("[data-translation]").length >= 3, null, { timeout: 30000 });
  check("the translation is remembered on reload", true);
  // An English document in the English reader gets no offer.
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 20000 });
  check("an English document gets no Translate offer", (await page.locator("[data-translation-bar]").count()) === 0);

  // ── The assistant's web access ──
  await page.locator('[data-track-surface="sidebar"] [data-track="assistant"]').click();
  await page.waitForTimeout(400);
  const webToggle = page.locator('button[data-track^="assistant-web:"]');
  await webToggle.waitFor({ timeout: 5000 });
  check("Web is on by default", (await webToggle.getAttribute("aria-pressed")) === "true");
  await page.locator('input[placeholder="Ask about this project"]').fill("Is the $42B figure right?");
  await page.locator('button[data-track="assistant-ask:notebook"]').click();
  await page.waitForFunction(() => document.body.innerText.includes("Web sources"), null, { timeout: 60000 });
  const answer = await tray().innerText();
  check("the answer ends with the web sources it used", answer.includes("Web sources") && answer.includes("Mock web source"));
  const link = tray().locator('a[href="https://example.com/mock-source"]');
  check("a web source is a link that opens in a new tab", (await link.count()) === 1 && (await link.getAttribute("target")) === "_blank");
  await webToggle.click();
  check("the toggle turns Web off", (await webToggle.getAttribute("aria-pressed")) === "false");
  await page.screenshot({ path: `${SHOT}/ai-tools-assistant.png` }).catch(() => {});
}
