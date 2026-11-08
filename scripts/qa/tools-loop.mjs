// The AI tool loop (SPEC.md §25): every AI tool of the reader runs in a
// browser against the mock models, and each step records page errors,
// console errors, failed requests, red error lines, and the crash page, so
// a round says which tool broke and how. Zero external calls.
//
// Run:
//   node scripts/qa/mock-kimi.mjs &
//   MOONSHOT_API_KEY=mock MOONSHOT_BASE_URL=http://localhost:3399/v1 \
//   ANTHROPIC_API_KEY=mock ANTHROPIC_BASE_URL=http://localhost:3399/v1 \
//   DATABASE_URL=... npm run dev -- --port 3111 &
//   node scripts/qa/seed.mjs            # the text documents and the projects
//   node scripts/qa/seed-page.mjs       # one handwritten page for Highlight & ask
//   node scripts/qa/tools-loop.mjs <shots dir> [step,step,...]
// Env: QA_BASE (http://localhost:3111), QA_NOTEBOOK, QA_TEXT_DOC, QA_PAGE_DOC,
// QA_PAGE_BLOCK — the ids seed.mjs and seed-page.mjs print.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require("/usr/local/lib/node_modules_global/playwright");
  }
})();
const BASE = process.env.QA_BASE ?? "http://localhost:3111";
const NB = process.env.QA_NOTEBOOK ?? "cmw37ayxp000m7dy9991ih6n2";
const TEXT_DOC = process.env.QA_TEXT_DOC ?? "cmw37ayx200007dy9nukvhxy8";
const PAGE_DOC = process.env.QA_PAGE_DOC ?? "qa-handwritten-doc";
const BLOCK = process.env.QA_PAGE_BLOCK ?? "qa-page-1";
const OUT = process.argv[2]; const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
let errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("console", (m) => { if (m.type() === "error" && !/hmr|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 240)}`); });
page.on("response", (r) => { if (r.status() >= 400 && !/hmr|_next/.test(r.url())) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
const results = [];
// Red lines that are not errors: a red control (Delete, Remove ¶), and the
// lines that report a skipped document.
async function uiErrors() {
  return page.evaluate(() => [...document.querySelectorAll(".text-red-600, .text-red-500, [role=alert]")].filter((e) => !e.closest("button") && e.tagName !== "BUTTON").map((e) => e.textContent?.trim() ?? "").filter((t) => t && t.length < 300 && !/^Not read:/.test(t)));
}
// A card that is still running: wait for it to settle before reading it.
async function settle(ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const busy = await page.evaluate(() => /Thinking|…$|ING…/.test([...document.querySelectorAll("[data-selection-popover], [data-side-card], aside")].map((e) => e.innerText).join("\n")));
    if (!busy) return;
    await page.waitForTimeout(500);
  }
}
async function step(name, fn) {
  if (only && !only.has(name)) return;
  errors = [];
  let outcome = "ok", detail = "";
  try { detail = (await fn()) ?? ""; } catch (e) { outcome = "threw"; detail = String(e.message ?? e).split("\n")[0].slice(0, 200); }
  const crashed = (await page.locator("text=stopped on an error").count()) > 0;
  const ui = await uiErrors();
  await page.screenshot({ path: `${OUT}/tool-${name.replace(/[^a-z0-9]+/gi, "-")}.png` }).catch(() => {});
  const bad = crashed || errors.length > 0 || ui.length > 0 || outcome !== "ok";
  results.push({ name, outcome: crashed ? "CRASH" : bad ? "ERROR" : "ok", detail, errors: [...errors], ui });
  console.log(`${crashed ? "CRASH" : bad ? "ERROR" : "ok   "} ${name}${detail ? " — " + detail : ""}`);
  for (const e of errors) console.log("     ", e);
  for (const u of ui) console.log("      ui:", u);
  if (crashed) { await page.reload({ waitUntil: "networkidle" }); }
}
const openText = async () => { await page.goto(`${BASE}/n/${NB}?doc=${TEXT_DOC}`, { waitUntil: "networkidle" }); await page.waitForTimeout(500); };
async function selectWords(text, from = 20, to = 220) {
  await page.keyboard.press("Escape");
  const para = page.locator("[data-block-id]").filter({ hasText: text }).first();
  await para.scrollIntoViewIfNeeded();
  const b = await para.boundingBox();
  await page.mouse.move(b.x + from, b.y + 10); await page.mouse.down();
  await page.mouse.move(b.x + to, b.y + 12, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(400);
}
async function waitCard(kindText, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const txt = await page.evaluate(() => [...document.querySelectorAll("[data-selection-popover], [data-side-card]")].map((e) => e.innerText).join("\n"));
    if (kindText.test(txt)) return txt.slice(0, 160).replace(/\n/g, " | ");
    await page.waitForTimeout(400);
  }
  throw new Error(`no result for ${kindText}`);
}
const closeCards = async () => { for (let i = 0; i < 3; i++) await page.keyboard.press("Escape"); await page.waitForTimeout(200); };

await openText();
await step("explain", async () => { await selectWords("Alice study"); await page.locator('[data-track="explain"]').first().click(); const r = await waitCard(/EXPLANATION[\s\S]{20,}/); await settle(); return r; });
await step("explain: continue", async () => { await page.locator('[data-track="explain-continue"]').first().click(); const box = page.locator('[data-side-card] textarea, [data-selection-popover] textarea').last(); await box.waitFor({ timeout: 5000 }); await box.fill("say it simpler"); await box.press("Enter"); const r = await waitCard(/say it simpler[\s\S]{10,}/); await settle(); return r; });
await step("explain: regenerate", async () => { await page.locator('[data-track="tool-card-more"]').first().click(); await page.locator('[data-track="explain-regenerate"]').click(); await page.waitForTimeout(3000); const r = await waitCard(/EXPLA(NATION|IN\+)[\s\S]{20,}/); await settle(); return r; });
await step("explain: delete", async () => { await page.locator('[data-track="explain-delete"]').first().click(); await page.waitForTimeout(800); return `cards left ${await page.locator("[data-side-card]").count()}`; });
await step("simplify", async () => { await closeCards(); await selectWords("Every natural experiment"); await page.locator('[data-track="simplify"]').first().click(); const r = await waitCard(/SIMPLIF[\s\S]{20,}/i); await settle(); return r; });
await step("simplify: delete", async () => { await page.locator('[data-track="simplify-delete"]').first().click(); await page.waitForTimeout(800); return "done"; });
await step("define", async () => { await closeCards(); const r = await page.evaluate(() => { const el = [...document.querySelectorAll("[data-block-id]")].find((e) => e.textContent?.includes("Alice study")); el?.scrollIntoView({ block: "center" }); const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = walker.nextNode())) { const i = n.textContent.indexOf("Alice"); if (i >= 0) { const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + 5); const b = range.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; } } return null; }); if (!r) throw new Error("word not found"); await page.mouse.move(r.x + 1, r.y + r.h / 2); await page.mouse.down(); await page.mouse.move(r.x + r.w - 1, r.y + r.h / 2, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500); await page.locator('[data-track="define"]').first().click(); const res = await waitCard(/DEFIN[\s\S]{10,}/i); await settle(); return res; });
await step("selection chat (assistant-run)", async () => { await closeCards(); await selectWords("Firefox and Yahoo"); await page.locator('[data-track="assistant"]').first().click(); await page.waitForTimeout(500); const box = page.locator('[data-selection-popover] textarea, [data-side-card] textarea').last(); await box.fill("what does this show?"); await box.press("Enter"); const r = await waitCard(/what does this show[\s\S]{20,}/i); await settle(); return r; });
await step("visualize", async () => { await closeCards(); await selectWords("One-line answer"); await page.locator('[data-track="visualize"]').first().click(); await page.waitForTimeout(500); const confirm = page.locator('[data-track="visualize-confirm"]'); if (await confirm.count()) await confirm.click(); const r = await waitCard(/VISUALIZ[\s\S]{10,}/i, 40000); await settle(60000); return r; });
await step("comment", async () => { await closeCards(); await selectWords("Default payments"); await page.locator('[data-track="comment"]').first().click(); const box = page.locator('[data-selection-popover] textarea, [data-side-card] textarea').last(); await box.fill("QA comment"); await page.locator('[data-track="comment-save"]').click(); await page.waitForTimeout(1500); return "saved"; });
await step("highlight color", async () => { await closeCards(); await selectWords("Per-query gap"); const dot = page.locator('[data-track^="highlight:"]').first(); await dot.click(); await page.waitForTimeout(1500); return `marks ${await page.locator("mark[data-source-id]").count()}`; });
await step("add to notes", async () => { await closeCards(); await selectWords("Two-thirds"); await page.locator('[data-track="add-to-notes"]').first().click(); await page.waitForTimeout(600); const sec = page.locator('[data-track="add-to-notes-section"]'); if (await sec.count()) await sec.first().click(); await page.waitForTimeout(1500); return "done"; });
await step("sidebar assistant", async () => { await closeCards(); await page.locator('aside [data-track="assistant"], [data-track-surface="sidebar"] [data-track="assistant"]').first().click().catch(async () => page.locator('[data-track="assistant"]').last().click()); await page.waitForTimeout(800); const box = page.locator("aside textarea, [data-track-surface=\"tray\"] textarea").last(); await box.fill("What is the main claim of this memo?"); await box.press("Enter"); await page.waitForTimeout(6000); const txt = await page.evaluate(() => document.querySelector("aside")?.innerText ?? ""); if (!/main claim[\s\S]{40,}/i.test(txt)) throw new Error("no assistant answer"); return txt.slice(0, 120).replace(/\n/g, " | "); });
await step("extract (distill)", async () => { await page.locator('[data-track="distill"]').first().click(); await page.waitForTimeout(800); await page.getByRole("button", { name: "Extract from the article" }).click(); const box = page.getByPlaceholder("What should this article answer?").first(); await box.fill("How much does Google pay for the default?"); const run = page.locator('[data-track="distill-page-run"]'); if (await run.count()) await run.click(); else await box.press("Enter"); await page.waitForTimeout(8000); await settle(); const txt = await page.evaluate(() => document.body.innerText); if (!/\$42 billion/.test(txt)) throw new Error("no extraction with the quote"); await page.locator('[data-track="distill-page-close"]').click(); await page.waitForTimeout(500); return "extraction shown"; });
await step("collapse", async () => { await page.locator('[data-track="collapse"]').first().click(); await page.waitForTimeout(10000); const txt = await page.evaluate(() => document.body.innerText); return /core|Collapse/i.test(txt) ? "collapsed" : "unclear"; });
await step("collapse off", async () => { const off = page.locator('[data-track="collapse-off"], [data-track="collapse"]').first(); await off.click(); await page.waitForTimeout(1000); return "done"; });
await step("breakwork assistant", async () => { await page.keyboard.press("Escape"); await page.locator('[data-track="structure"]').first().click(); await page.locator('[data-track="structure-add-bucket"]').waitFor(); await page.waitForTimeout(2500); await page.locator('[data-track="structure-suggest:parts"], [data-track^="structure-suggest:"]').first().click(); await page.locator('[data-track="structure-send"]').click(); await page.waitForTimeout(12000); const apply = page.locator('[data-track="structure-apply"]'); if (!(await apply.count())) throw new Error("no proposal"); await apply.first().click(); await page.waitForTimeout(2000); return `buckets ${await page.locator(".structure-bucket").count()}`; });
await step("breakwork close", async () => { await page.locator('[data-track="structure-close"]').click(); await page.waitForTimeout(800); return "closed"; });
await step("stitch", async () => { await page.locator('[data-track="graph"]').first().click(); await page.waitForTimeout(3000); const box = page.locator("textarea").last(); await box.fill("Gather the passages about default payments"); await page.locator('[data-track="stitch-send"]').click(); await page.waitForTimeout(15000); const txt = await page.evaluate(() => document.body.innerText); return /payment/i.test(txt) ? "answered" : "unclear"; });
// Pages: Highlight & ask
await step("page: open", async () => { await page.goto(`${BASE}/n/${NB}?doc=${PAGE_DOC}`, { waitUntil: "networkidle" }); await page.waitForFunction((s) => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, `[data-block-id="${BLOCK}"] img`); return "loaded"; });
const swipe = async (y) => { const box = await page.locator(`[data-block-id="${BLOCK}"] div[style*="touch-action"]`).boundingBox(); await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * y); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * y, { steps: 15 }); await page.mouse.up(); await page.waitForTimeout(300); };
await step("page: explain", async () => { await swipe(0.19); await page.locator('[data-track="page-explain"]').click(); await page.waitForTimeout(8000); const txt = await page.locator("[data-selection-popover]").innerText(); if (txt.length < 60) throw new Error("no answer"); return txt.slice(0, 100).replace(/\n/g, " | "); });
await step("page: ask", async () => { await page.locator('[data-track="page-answer-close"]').click().catch(() => {}); await swipe(0.26); await page.locator("[data-selection-popover] textarea").fill("what number is here?"); await page.locator('[data-track="page-ask"]').click(); await page.waitForTimeout(8000); const txt = await page.locator("[data-selection-popover]").innerText(); if (txt.length < 60) throw new Error("no answer"); return txt.slice(0, 100).replace(/\n/g, " | "); });
await step("page: comment", async () => { await page.locator('[data-track="page-answer-close"]').click().catch(() => {}); await swipe(0.33); await page.locator("[data-selection-popover] textarea").fill("QA page comment"); await page.locator('[data-track="page-comment"]').click(); await page.waitForTimeout(2000); return "saved"; });
await step("page: color", async () => { await swipe(0.4); await page.locator('[data-track="page-highlight:gold"]').click(); await page.waitForTimeout(2000); return `marks ${await page.locator(`[data-block-id="${BLOCK}"] [data-source-id]`).count()}`; });
console.log("\nSUMMARY:", results.map((r) => `${r.outcome}:${r.name}`).join("  "));
await browser.close();
