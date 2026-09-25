// UI verification for Stop on the long runs (SPEC.md §6 "Stop on every long
// run"): Collapse, Generate contents, Translate, the Summary card, Merge with
// AI, and Recommend links. Each run's model call goes to a model that never
// answers (scripts/qa/mock-hang.mjs), so only Stop ends it; each check
// presses Stop, then reads that the call was closed, that the button is back,
// and that nothing was stored.
//
// Usage: DATABASE_URL=... NB=<notebook> DOC=<article> ZH=<Chinese document>
//   CHROME=<chromium> node scripts/qa/ui-stop.mjs
// Runs against a production build (the service worker registers there only).
// With sign-in off, Recommend links needs a User row for the local reader
// (id user-1): the scan records its run against the account.
// Expects scripts/qa/mock-kimi.mjs, scripts/qa/mock-hang.mjs, and the server
// on :3311 started with MOONSHOT_API_KEY=mock
// MOONSHOT_BASE_URL=http://localhost:3399/v1 ANTHROPIC_API_KEY=mock
// ANTHROPIC_BASE_URL=http://localhost:3401/v1 DEEPL_API_KEY=mock:fx
// DEEPL_API_URL=http://localhost:3401, after these rows were written (the
// server reads them when it starts): FeatureModel contents, merge,
// summarize, and connect → claude-opus-5-5. Screenshots land in SHOT_DIR.
import { Prisma, PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const { NB, DOC, ZH } = process.env;
const PORT = process.env.PORT ?? "3311";
const HANG = process.env.MOCK_HANG_URL ?? "http://localhost:3401";
const SHOT = process.env.SHOT_DIR ?? ".";
const base = `http://localhost:${PORT}`;
const db = new PrismaClient();
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
const status = async () => (await fetch(`${HANG}/status`)).json();

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

// Press start, wait for the model call to arrive, press Stop, and read that
// the call was closed. Returns the calls sent and closed.
async function stopRun(label, start, stop, done) {
  const before = await status();
  await start();
  await page.waitForTimeout(2000);
  const during = await status();
  const sent = during.requests - before.requests;
  check(`${label}: the model call is on its way`, sent > 0, `${sent} calls`);
  const stopped = Date.now();
  await stop();
  if (done) await done();
  // The call closes when the server sees the page go: wait up to 8 s.
  let closed = 0;
  while (Date.now() - stopped < 8000) {
    closed = (await status()).closed - before.closed;
    if (closed >= sent) break;
    await page.waitForTimeout(100);
  }
  check(
    `${label}: Stop ends the model call`,
    sent > 0 && closed >= sent,
    `${closed} of ${sent} closed in ${Date.now() - stopped} ms`,
  );
}

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/stop-crash.png` }).catch(() => {});
}
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
await db.$disconnect();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // ── Collapse ──
  await db.document.update({ where: { id: DOC }, data: { collapse: Prisma.DbNull, contents: Prisma.DbNull } });
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  // The service worker (public/sw.js) sees every call: Stop has to reach the
  // server through it.
  const controlled = await page
    .waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 })
    .then(() => true, () => false);
  check("the service worker controls the page", controlled);
  const collapse = page.locator('[data-track="collapse"]');
  await collapse.waitFor({ timeout: 20000 });
  await stopRun(
    "collapse",
    async () => {
      await collapse.click();
      const label = await page.locator('[data-track="collapse-stop"]').innerText();
      check("collapse: the running button reads Collapsing… with Stop", /Collapsing/.test(label) && /Stop/.test(label), label.replace(/\s+/g, " "));
      await page.screenshot({ path: `${SHOT}/stop-collapse.png` });
    },
    () => page.locator('[data-track="collapse-stop"]').click(),
    () => collapse.waitFor({ timeout: 5000 }),
  );
  const collapsed = await db.document.findUnique({ where: { id: DOC }, select: { collapse: true } });
  check("collapse: nothing is saved", collapsed?.collapse === null);
  check("collapse: the article stays whole, no toast", (await page.locator("[data-collapsed]").count()) === 0 && (await page.getByText("could not be collapsed").count()) === 0);

  // ── Generate contents ──
  await page.locator('[data-track="contents"]').click();
  const generate = page.locator('[data-track="contents-generate"]');
  await generate.waitFor({ timeout: 10000 });
  await stopRun(
    "contents",
    async () => {
      await generate.click();
      await page.locator('[data-track="contents-stop"]').waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${SHOT}/stop-contents.png` });
    },
    () => page.locator('[data-track="contents-stop"]').click(),
    () => generate.waitFor({ timeout: 5000 }),
  );
  const contents = await db.document.findUnique({ where: { id: DOC }, select: { contents: true } });
  check("contents: nothing is stored, no message", contents?.contents === null && (await page.getByText("could not be built").count()) === 0);
  await page.keyboard.press("Escape");

  // ── Translate ──
  const zhBlocks = await db.block.findMany({ where: { documentId: ZH }, select: { id: true } });
  await db.blockTranslation.deleteMany({ where: { blockId: { in: zhBlocks.map((b) => b.id) } } });
  await page.goto(`${base}/n/${NB}?doc=${ZH}`, { waitUntil: "networkidle" });
  const translate = page.locator('[data-track="translate"]');
  await translate.waitFor({ timeout: 20000 });
  await stopRun(
    "translate",
    async () => {
      await translate.click();
      await page.locator('[data-track="translate-stop"]').waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${SHOT}/stop-translate.png` });
    },
    () => page.locator('[data-track="translate-stop"]').click(),
    () => translate.waitFor({ timeout: 5000 }),
  );
  const stored = await db.blockTranslation.count({ where: { blockId: { in: zhBlocks.map((b) => b.id) } } });
  check("translate: nothing is stored", stored === 0, `${stored} rows`);

  // ── The Summary card ──
  await db.notebookDocument.update({
    where: { notebookId_documentId: { notebookId: NB, documentId: DOC } },
    data: { summaries: Prisma.DbNull },
  });
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.locator('[data-track-surface="sidebar"] [data-track="assistant"]').first().click();
  const layman = page.locator('[data-track="assistant-recommended:layman"]');
  await layman.waitFor({ timeout: 10000 });
  await stopRun(
    "summary",
    async () => {
      await layman.click();
      await page.locator('[data-track="assistant-recommended-stop"]').waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${SHOT}/stop-summary.png` });
    },
    () => page.locator('[data-track="assistant-recommended-stop"]').click(),
  );
  const summaries = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: NB, documentId: DOC } },
    select: { summaries: true },
  });
  check("summary: nothing is stored, and Stop leaves the card", summaries?.summaries === null && (await page.locator('[data-track="assistant-recommended-stop"]').count()) === 0);

  // ── Merge with AI ──
  const section = await db.section.findFirst({ where: { notebookId: NB, hidden: false }, orderBy: { order: "asc" } });
  const texts = ["Stop check: the first note to merge.", "Stop check: the second note to merge."];
  const ids = [];
  for (const content of texts) {
    const res = await fetch(`${base}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionId: section.id, content, documentId: DOC }),
    });
    ids.push((await res.json()).id);
  }
  const made = await db.note.findMany({ where: { id: { in: ids } }, select: { id: true, content: true } });
  const madeContent = new Map(made.map((n) => [n.id, n.content]));
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.locator('[data-track-surface="sidebar"] [data-track="notes"]').first().click();
  const tray = page.locator('aside[data-track-surface="tray"]');
  await tray.waitFor({ timeout: 20000 });
  // A collapsed note shows its gist, not its words: find the cards by id.
  for (const id of ids) {
    const card = tray.locator(`[data-note-id="${id}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await card.locator('[data-track="note-select"]').first().click();
  }
  const stopTitle = "Stop the merge. Nothing merges, and the notes stay as they were.";
  await stopRun(
    "merge",
    async () => {
      await page.locator('[data-track="notes-merge-ai"]').click();
      await page.locator(`button[data-tip="${stopTitle}"]`).waitFor({ timeout: 5000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${SHOT}/stop-merge.png` });
    },
    () => page.locator(`button[data-tip="${stopTitle}"]`).click(),
  );
  await page.waitForTimeout(1500);
  const kept = await db.note.findMany({ where: { id: { in: ids } }, select: { id: true, content: true } });
  check(
    "merge: nothing merges in the database",
    kept.length === 2 && kept.every((n) => n.content === madeContent.get(n.id)),
    `${kept.length} of 2 notes as they were`,
  );
  let shown = 0;
  for (const id of ids) shown += (await tray.locator(`[data-note-id="${id}"]`).count()) > 0 ? 1 : 0;
  check("merge: both notes come back in the tray", shown === 2, `${shown} of 2 shown`);
  await db.note.deleteMany({ where: { id: { in: ids } } });

  // ── Recommend links ──
  const runsBefore = await db.linkScanRun.count();
  await page.locator('[data-track-surface="sidebar"] [data-track="graph"]').first().click();
  const scan = page.locator('[data-track="graph-recommend-links"]');
  await scan.waitFor({ timeout: 20000 });
  await stopRun(
    "recommend links",
    async () => {
      await scan.click();
      await page.locator('[data-track="graph-recommend-links-stop"]').waitFor({ timeout: 5000 });
      await page.screenshot({ path: `${SHOT}/stop-recommend.png` });
    },
    () => page.locator('[data-track="graph-recommend-links-stop"]').click(),
    () => scan.waitFor({ timeout: 5000 }),
  );
  check("recommend links: the run still counts", (await db.linkScanRun.count()) === runsBefore + 1);
}
