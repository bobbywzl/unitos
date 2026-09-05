// QA check for motion, the Thinking + Stop row, the anchor ladder, and the
// ingest reasons. Needs the dev server on :3000 with the mock Kimi server
// on :3399 (start the dev server with KIMI_API_KEY=mock
// KIMI_BASE_URL=http://localhost:3399/v1) and outbound network for the
// ingest checks. Pass seeded ids and a folder for the screenshots:
//   NB=<notebook id> DOC=<document id> OUT=<dir> node scripts/qa/ui-motion-stop.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const NB = process.env.NB;
const DOC = process.env.DOC;
const OUT = process.env.OUT ?? ".";
const BASE = "http://localhost:3000";
const URL = `${BASE}/n/${NB}?doc=${DOC}`;

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const executablePath = fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
  ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
  : "/opt/pw-browsers/chromium/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await sleep(500);
await shot(page, "01-workspace");

// ── Tray collapse and expand ────────────────────────────────────────────────
const collapseBtn = page.locator('[aria-label="Collapse the notes tray"]');
check("tray collapse button present", (await collapseBtn.count()) === 1);
await collapseBtn.click();
await sleep(150);
await shot(page, "02-tray-mid-collapse");
await sleep(400);
await shot(page, "03-tray-collapsed");
const trayColumn = page.locator(".tray-column");
const collapsedWidth = await trayColumn.evaluate((el) => el.getBoundingClientRect().width);
check("tray column shrinks to 0", collapsedWidth === 0, `width=${collapsedWidth}`);
await page.locator('[aria-label="Expand the notes tray"]').click();
await sleep(450);
const expandedWidth = await trayColumn.evaluate((el) => el.getBoundingClientRect().width);
check("tray column expands back", expandedWidth > 250, `width=${expandedWidth}`);

// ── Tab switch cross-fade ───────────────────────────────────────────────────
await page.locator('nav[aria-label] button[aria-label="Assistant"]').click();
await sleep(120);
await shot(page, "04-tab-assistant-in");
await sleep(300);
check("assistant tab shows Recommended", (await page.getByText("Recommended", { exact: true }).count()) > 0);
await page.locator('nav[aria-label] button[aria-label="Notes"]').click();
await sleep(350);

// ── Document list dropdown ──────────────────────────────────────────────────
await page.locator('button[aria-label="Documents in this project"]').click();
await sleep(250);
await shot(page, "05-document-list");
check("document list open", (await page.locator(".menu-in").count()) > 0);
await page.keyboard.press("Escape");
await sleep(80);
const leaving = await page.locator(".presence-exit").count();
check("document list leaves through Presence", leaving > 0, `exit wrappers=${leaving}`);
await sleep(300);
check("document list gone after exit", (await page.locator(".presence-exit").count()) === 0);

// ── Selection popover ───────────────────────────────────────────────────────
async function selectInBlock(index, chars) {
  await page.evaluate(
    ({ index, chars }) => {
      const blocks = document.querySelectorAll("[data-block-id]");
      const p = blocks[index];
      const textNode = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(chars, textNode.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    },
    { index, chars },
  );
  await page.locator(`[data-block-id] >> nth=${index}`).dispatchEvent("mouseup");
  await sleep(400);
}
await selectInBlock(1, 40);
check("popover appears", (await page.locator("[data-selection-popover]").count()) > 0);
await shot(page, "06-popover");

// Assistant box folds open; a turn shows Thinking; Stop ends it.
await page.route("**/api/assistant/act", async (route) => {
  await sleep(6000);
  try {
    await route.continue();
  } catch {
    // Stop aborted the request; nothing to continue.
  }
});
await page.locator("[data-selection-popover]").getByRole("button", { name: "Assistant", exact: true }).click();
await sleep(350);
await shot(page, "07-popover-assistant-open");
const box = page.locator("[data-selection-popover] textarea").first();
await box.fill("what does this mean");
await box.press("Enter");
await sleep(600);
const thinking = page.locator('[data-selection-popover] [role="status"]');
check("popover shows Thinking while the turn runs", (await thinking.count()) > 0);
await shot(page, "08-popover-thinking");
await page.locator('[aria-label^="Stop the assistant"]').first().click();
await sleep(300);
check("Stop ends the Thinking row", (await thinking.count()) === 0);
check("stopped command stays in the box", (await box.inputValue()) === "what does this mean");
await page.unroute("**/api/assistant/act");
await page.keyboard.press("Escape");
await sleep(300);

// ── Explain: Thinking + Stop, then a real streamed answer ──────────────────
await page.route("**/api/derive", async (route) => {
  await sleep(6000);
  try {
    await route.continue();
  } catch {
    // Stop aborted the request; nothing to continue.
  }
});
await selectInBlock(2, 50);
await page.locator("[data-selection-popover]").getByRole("button", { name: "Explain", exact: true }).click();
await sleep(600);
const explainCard = page.locator('[data-side-card="explain"]');
check("explain card opens", (await explainCard.count()) === 1);
check("explain card shows Thinking", (await explainCard.locator('[role="status"]').count()) > 0);
await shot(page, "09-explain-thinking");
await explainCard.getByRole("button", { name: "Stop" }).click();
await sleep(500);
check("stopped empty explain card closes", (await explainCard.count()) === 0);
await page.unroute("**/api/derive");
await selectInBlock(2, 50);
await page.locator("[data-selection-popover]").getByRole("button", { name: "Explain", exact: true }).click();
await page.waitForFunction(
  () => document.querySelector('[data-side-card="explain"] .prose') !== null,
  null,
  { timeout: 20000 },
);
await sleep(300);
await shot(page, "10-explain-answer");
check("explain streams an answer", (await explainCard.locator(".prose").count()) === 1);
await explainCard.getByRole("button", { name: "Close" }).click();
await sleep(100);
check("explain card leaves through Presence", (await page.locator(".presence-exit-bubble").count()) > 0);
await sleep(400);

// ── Distill page fades in and out ───────────────────────────────────────────
await page.locator('[title="Open the distilled page"]').click();
await sleep(400);
check("distill page open", (await page.getByPlaceholder(/answer/i).count()) > 0);
await shot(page, "11-distill-page");
await page.keyboard.press("Escape");
await sleep(80);
check("distill page leaves through Presence", (await page.locator(".presence-exit-fade").count()) > 0);
await sleep(400);

// ── Guide dialog ────────────────────────────────────────────────────────────
await page.locator('[aria-label="Guide"]').click();
await sleep(350);
// .dialog-in: the app's dialog, not Next's dev error overlay (also role=dialog).
check("guide dialog opens", (await page.locator(".dialog-in").count()) > 0);
await shot(page, "12-guide");
await page.keyboard.press("Escape");
await sleep(700);
check("guide dialog closes", (await page.locator(".dialog-in").count()) === 0);

// ── Anchor ladder: a stale block id with the right quote still resolves ─────
const ladder = await page.evaluate(
  async ({ NB, DOC }) => {
    const p = document.querySelectorAll("[data-block-id]")[1];
    const blockId = p.dataset.blockId;
    const text = p.textContent;
    const quotedText = text.slice(10, 40);
    const body = {
      notebookId: NB,
      documentId: DOC,
      anchor: {
        blockId: "stale-block-id-after-reparse",
        startOffset: 10,
        endOffset: 40,
        quotedText,
        prefix: text.slice(0, 10),
        suffix: text.slice(40, 72),
      },
      color: "sage",
    };
    const res = await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    const explain = await fetch("/api/derive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "EXPLAIN", notebookId: NB, documentId: DOC, anchor: body.anchor }),
    });
    const explainText = await explain.text();
    return {
      status: res.status,
      blockId: json?.sources?.[0]?.blockId,
      realBlockId: blockId,
      quotedText: json?.sources?.[0]?.quotedText,
      explainStatus: explain.status,
      explainHead: explainText.slice(0, 80),
    };
  },
  { NB, DOC },
);
check(
  "stale block id + quote resolves for a highlight",
  (ladder.status === 201 || ladder.status === 200) && ladder.blockId === ladder.realBlockId,
  JSON.stringify(ladder),
);
check("stale block id + quote resolves for Explain", ladder.explainStatus === 200, `status=${ladder.explainStatus}`);

// ── Ingest reasons ──────────────────────────────────────────────────────────
async function ingest(url) {
  return page.evaluate(
    async ({ NB, url }) => {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, notebookId: NB }),
      });
      const text = await res.text();
      const lines = text.trim().split("\n").map((l) => JSON.parse(l));
      return { status: res.status, last: lines[lines.length - 1], stages: lines.filter((l) => l.stage) };
    },
    { NB, url },
  );
}
const reuters = await ingest(
  "https://www.reuters.com/legal/government/anthropic-plans-publicly-unveil-ipo-prospectus-after-labor-day-information-2026-08-27/",
);
check("Reuters says why", typeof reuters.last.error === "string" && /reuters\.com/.test(reuters.last.error), reuters.last.error);
const missing = await ingest("https://example.com/no-such-page-xyz");
check("404 says not found", /no page at this link/.test(missing.last.error ?? ""), missing.last.error);
const nowhere = await ingest("https://this-host-does-not-exist-unitos.invalid/page");
check("unreachable says so", /could not be reached/.test(nowhere.last.error ?? ""), nowhere.last.error);
const pdfLink = await ingest("https://arxiv.org/pdf/1706.03762v7");
check("PDF link adds the PDF", typeof pdfLink.last.id === "string", JSON.stringify(pdfLink.last).slice(0, 160));
const review = await page.evaluate(
  async ({ NB }) => {
    const res = await fetch("/api/uploads/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebookId: NB,
        url: "https://www.reuters.com/legal/government/anthropic-plans-publicly-unveil-ipo-prospectus-after-labor-day-information-2026-08-27/",
      }),
    });
    const text = await res.text();
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    return lines[lines.length - 1];
  },
  { NB },
);
check("upload review says why", /reuters\.com/.test(review.error ?? ""), review.error);

await browser.close();
console.log(results.join("\n"));
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log("  " + e.slice(0, 300));
