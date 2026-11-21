// Stitch in the graph (SPEC.md §22), in a real browser against the stand-in
// model: two documents are picked, a command to extract is answered in the
// box with no link made, the request names only the picked documents, and a
// ¶ chip in the answer opens the cited document at its block.
//
//   node scripts/qa/ui-stitch.mjs <notebookId> <documentId> [outDir]
//
// The app runs on :3311 with sign-in off and the stand-in model
// (scripts/qa/tools-loop.mjs's header).
import { chromium } from "playwright-core";

const [NB, DOC, OUT = "scripts/qa/out"] = process.argv.slice(2);
if (!NB || !DOC) {
  console.error("usage: node scripts/qa/ui-stitch.mjs <notebookId> <documentId> [outDir]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3311";
let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`${BASE}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle", timeout: 120_000 });
await page.locator('[data-track="graph"]').first().click();
const box = page.locator('[role="region"][aria-label="Stitch"]');
await box.waitFor({ timeout: 30_000 });
// A conversation an earlier run kept is cleared first.
const clear = page.locator('button[data-track="stitch-clear"]');
if (await clear.count()) {
  await clear.click();
  const confirm = page.getByRole("button", { name: /^Clear/ }).last();
  if (await confirm.count()) await confirm.click().catch(() => {});
  await page.waitForTimeout(600);
}
const recommendedCount = async () => Number(await page.locator('[data-track="graph-recommended-links"] span').last().innerText());
const linksBefore = await recommendedCount();

// The chips say what each makes.
const chips = await box.locator('[data-track^="stitch-suggest"]').allInnerTexts();
check("the chips: extract, find, link, write a page", /^Extract/.test(chips[0]) && /^Find/.test(chips[1]) && /^Link/.test(chips[2]) && /^Write one page/.test(chips[3]), chips.join(" | "));

// Pick two documents in the graph.
await box.locator('[data-track="stitch-pick"]').click();
const nodes = page.locator(".react-flow__node");
const nodeCount = await nodes.count();
await nodes.nth(0).click();
await nodes.nth(1).click();
await box.locator('[data-track="stitch-pick"]').click();
check("the box says two documents are picked", /2 documents picked/.test(await box.innerText()));
// The pick as the app keeps it for the tab.
const ids = await page.evaluate((nb) => JSON.parse(sessionStorage.getItem(`unitos-stitch-pick-${nb}`) ?? "[]"), NB);
check("the project has more documents than the pick", nodeCount > 2 && ids.length === 2, `${nodeCount} nodes, ${ids.length} picked`);

let sent = null;
page.on("request", (r) => {
  if (r.method() === "POST" && r.url().endsWith(`/api/notebooks/${NB}/stitch`)) sent = JSON.parse(r.postData() ?? "{}");
});
await box.locator("textarea").fill("Extract the points where the documents talk about customer experience");
await box.locator('[data-track="stitch-send"]').click();
await page.waitForFunction(() => /Mock point one/.test(document.querySelector('[role="region"][aria-label="Stitch"]')?.textContent ?? ""), null, { timeout: 120_000 });
await page.waitForTimeout(800);
const text = await box.innerText();
check("the request names the two picked documents and no other", Array.isArray(sent?.documentIds) && sent.documentIds.length === 2 && sent.documentIds.every((id) => ids.includes(id)), JSON.stringify(sent?.documentIds));
check("the answer is in the box, by document, point by point", /Mock document one/.test(text) && /Mock point two/.test(text));
check("no link is proposed", !/links? proposed/i.test(text) && (await recommendedCount()) === linksBefore, `recommended links ${linksBefore} -> ${await recommendedCount()}`);
check("no page is written", !/Page written/i.test(text));
check("an answer carries no Nothing was stored line", !/Nothing was stored/i.test(text));
check("it says which documents were read: the two picked", /Read 2 of 2 documents/.test(text), text.match(/Read \d+ of \d+ documents/)?.[0] ?? "");
await page.screenshot({ path: `${OUT}/stitch-extract.png` });

// A ¶ chip opens the cited document at the block, and the graph closes.
const chip = box.locator('a[href^="#dissect-block-"], button:has-text("¶")').first();
check("the answer carries block chips", (await chip.count()) === 1);
await chip.click();
await page.waitForURL(/[?&]block=/, { timeout: 30_000 });
const url = new URL(page.url());
check("a chip opens the cited document at its block", ids.includes(url.searchParams.get("doc")) && Boolean(url.searchParams.get("block")), url.search);
await page.waitForTimeout(1500);
check("the graph closed on the way", (await page.locator('[role="region"][aria-label="Stitch"]').count()) === 0);
check("the block is on the page", (await page.locator(`[data-block-id="${url.searchParams.get("block")}"]`).count()) >= 1);
await page.screenshot({ path: `${OUT}/stitch-chip-opened.png` });

// A command to link, with the same pick: the link is proposed.
await page.locator('[data-track="graph"]').first().click();
await box.waitFor({ timeout: 30_000 });
check("the pick is kept", /2 documents picked/.test(await box.innerText()));
check("the conversation is kept: the answer is still in the box", /Mock point one/.test(await box.innerText()));
await box.locator("textarea").fill("Link the passages that make the same claim");
await box.locator('[data-track="stitch-send"]').click();
await page.waitForFunction(() => /links? proposed|already|Mock point one[\s\S]*Mock point one/.test(document.querySelector('[role="region"][aria-label="Stitch"]')?.textContent ?? ""), null, { timeout: 120_000 });
await page.waitForTimeout(1500);
const after = await recommendedCount();
check("a command to link proposes a link", /1 link proposed, between the documents read/.test(await box.innerText()) && after === linksBefore + 1, `recommended links ${linksBefore} -> ${after}`);

// A reload keeps the conversation and its results.
await page.reload({ waitUntil: "networkidle" });
await page.locator('[data-track="graph"]').first().click();
await box.waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);
const kept = await box.innerText();
check("a reload keeps both turns and what each read", /Extract the points/.test(kept) && /Link the passages/.test(kept) && (kept.match(/Read 2 of 2 documents/g) ?? []).length === 2);

// The link this run proposed is dismissed, the way a reader does it, so the
// check can run again.
await page.locator('[data-track="graph-recommended-links"]').click();
await page.getByRole("button", { name: "Dismiss", exact: true }).first().click();
await page.waitForFunction((n) => Number([...document.querySelectorAll('[data-track="graph-recommended-links"] span')].at(-1)?.textContent) === n, linksBefore, { timeout: 30_000 });
check("the proposed link is dismissed", (await recommendedCount()) === linksBefore);

await browser.close();
console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
