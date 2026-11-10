// The notes loop (SPEC.md §25): the notes tray, the notes full page, and a
// section's board pressed on in a browser — a note written, edited, folded,
// deleted and taken back, two notes joined and taken back, a pending note
// accepted and one rejected, a section added and renamed, a note held and
// dragged, a board's tiles moved. Each step records page errors, console
// errors, failed requests, red error lines, and the crash page.
//
//   node scripts/qa/notes-loop.mjs <shots dir> [step,step,...]
// Env: QA_BASE, QA_NOTEBOOK, QA_TEXT_DOC (see tools-loop.mjs).
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
const OUT = process.argv[2];
const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
let errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/hmr|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 240)}`);
});
page.on("response", (r) => {
  if (r.status() >= 400 && !/hmr|_next/.test(r.url())) errors.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
});
const results = [];
const uiErrors = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".text-red-600, .text-red-500, [role=alert]")]
      .filter((e) => !e.closest("button") && e.tagName !== "BUTTON")
      .map((e) => e.textContent?.trim() ?? "")
      .filter((t) => t && t.length < 300),
  );
async function step(name, fn) {
  if (only && !only.has(name)) return;
  errors = [];
  let outcome = "ok";
  let detail = "";
  try {
    detail = (await fn()) ?? "";
  } catch (e) {
    outcome = "threw";
    detail = String(e.message ?? e).split("\n")[0].slice(0, 200);
  }
  const crashed = (await page.locator("text=stopped on an error").count()) > 0;
  const ui = await uiErrors().catch(() => []);
  const bad = crashed || errors.length > 0 || ui.length > 0 || outcome !== "ok";
  await page.screenshot({ path: `${OUT}/notes-${name.replace(/[^a-z0-9]+/gi, "-")}.png` }).catch(() => {});
  if (bad) await page.screenshot({ path: `${OUT}/fail-${Date.now()}-notes-${name.replace(/[^a-z0-9]+/gi, "-")}.png` }).catch(() => {});
  results.push({ name, outcome: crashed ? "CRASH" : bad ? "ERROR" : "ok" });
  console.log(`${crashed ? "CRASH" : bad ? "ERROR" : "ok   "} ${name}${detail ? " — " + detail : ""}`);
  for (const e of errors) console.log("     ", e);
  for (const u of ui) console.log("      ui:", u);
  if (crashed || /context was destroyed|Target closed|net::ERR/i.test(detail)) await page.reload({ waitUntil: "networkidle" }).catch(() => {});
}
const tray = page.locator("aside").first();
const noteCount = () => tray.locator("[data-note-id]").count();
const stamp = Date.now().toString(36);

await page.goto(`${BASE}/n/${NB}?doc=${TEXT_DOC}`, { waitUntil: "networkidle" });
await page.locator('[data-track="notes"]:visible').first().click();
await page.waitForTimeout(500);

await step("note: write", async () => {
  const before = await noteCount();
  await tray.locator('[data-track="section-add-note"]').first().click();
  const box = tray.locator('[contenteditable="true"], textarea').last();
  await box.waitFor({ timeout: 5000 });
  await box.click();
  await page.keyboard.type(`# QA note ${stamp}\nFirst line of the body.\n- a point\n- another point`);
  await tray.locator('[data-track="note-compose-save"], [data-track="note-save"]').first().click();
  await page.waitForTimeout(1200);
  const after = await noteCount();
  if (after !== before + 1) throw new Error(`notes ${before} → ${after}`);
  return `notes ${before} → ${after}`;
});
await step("note: write a second", async () => {
  await tray.locator('[data-track="section-add-note"]').first().click();
  const box = tray.locator('[contenteditable="true"], textarea').last();
  await box.waitFor({ timeout: 5000 });
  await box.click();
  await page.keyboard.type(`Second QA note ${stamp}, one paragraph.`);
  await tray.locator('[data-track="note-compose-save"], [data-track="note-save"]').first().click();
  await page.waitForTimeout(1200);
  return `notes ${await noteCount()}`;
});
const mine = () => tray.locator("[data-note-id]").filter({ hasText: stamp });
// A note folds to one line; its words, and Copy, History, and Delete, show
// once it is open.
// A collapsed row is its line alone: the pencil, the jump, and the first
// select circle are on the open note.
const openCard = async (card) => {
  if (!(await card.locator('[data-track="note-delete"]').count())) {
    await card.locator('[data-track="note-collapse"]').first().click();
    await page.waitForTimeout(300);
  }
};
const closeCard = async (card) => {
  if (await card.locator('[data-track="note-delete"]').count()) {
    await card.locator('[data-track="note-collapse"]').first().click();
    await page.waitForTimeout(250);
  }
};
await step("note: edit", async () => {
  const id = await mine().first().getAttribute("data-note-id");
  const card = tray.locator(`[data-note-id="${id}"]`);
  await openCard(card);
  await card.locator('[data-track="note-edit"]').first().click();
  const box = card.locator('[contenteditable="true"], textarea').last();
  await box.waitFor({ timeout: 5000 });
  await box.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Edited.");
  await tray.locator('[data-track="note-save"]:visible').first().click();
  await page.waitForTimeout(1200);
  await openCard(card);
  const shown = (await card.innerText()).includes("Edited.");
  await closeCard(card);
  if (!shown) throw new Error("the edit does not show in the open note");
  return "edited";
});
await step("note: fold and open", async () => {
  const card = mine().first();
  for (let i = 0; i < 2; i++) {
    await card.locator('[data-track="note-collapse"]').first().click();
    await page.waitForTimeout(250);
  }
  return "folded and opened";
});
await step("note: delete and undo", async () => {
  const before = await noteCount();
  const id = await mine().first().getAttribute("data-note-id");
  const card = tray.locator(`[data-note-id="${id}"]`);
  await openCard(card);
  await card.locator('[data-track="note-delete"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(500);
  const gone = await noteCount();
  await page.locator('[data-track="undo-delete"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
  const back = await noteCount();
  if (gone !== before - 1 || back !== before) throw new Error(`notes ${before} → ${gone} → ${back}`);
  await closeCard(tray.locator(`[data-note-id="${id}"]`));
  return `notes ${before} → ${gone} → ${back}`;
});
await step("notes: join two and undo", async () => {
  const before = await noteCount();
  const cards = mine();
  if ((await cards.count()) < 2) throw new Error("two notes needed");
  for (const i of [0, 1]) {
    // The first circle is on an open note; once one note is selected,
    // every row shows its circle.
    if (!(await cards.nth(i).locator('[data-track="note-select"]').count())) await openCard(cards.nth(i));
    await cards.nth(i).locator('[data-track="note-select"]').first().click();
    await page.waitForTimeout(150);
  }
  await page.locator('[data-track="notes-merge"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  const joined = await noteCount();
  await page.locator('[data-track="undo-merge"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(1200);
  const back = await noteCount();
  if (joined !== before - 1 || back !== before) throw new Error(`notes ${before} → ${joined} → ${back}`);
  await page.locator('[data-track="notes-clear-selection"]').first().click({ timeout: 2000 }).catch(() => {});
  return `notes ${before} → ${joined} → ${back}`;
});
await step("notes: merge with AI and undo", async () => {
  const before = await noteCount();
  const cards = mine();
  for (const i of [0, 1]) {
    // The first circle is on an open note; once one note is selected,
    // every row shows its circle.
    if (!(await cards.nth(i).locator('[data-track="note-select"]').count())) await openCard(cards.nth(i));
    await cards.nth(i).locator('[data-track="note-select"]').first().click();
    await page.waitForTimeout(150);
  }
  await page.locator('[data-track="notes-merge-ai"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(6000);
  const merged = await noteCount();
  const undo = page.locator('[data-track="undo-merge"]').first();
  if (await undo.count()) await undo.click();
  await page.waitForTimeout(1500);
  await page.locator('[data-track="notes-clear-selection"]').first().click({ timeout: 2000 }).catch(() => {});
  return `notes ${before} → ${merged} → ${await noteCount()}`;
});
await step("note: hold and drag", async () => {
  // The hold picks the note up; the move carries it under the next one.
  const cards = mine();
  const a = await cards.nth(0).boundingBox();
  const b = await cards.nth(1).boundingBox();
  if (!a || !b) throw new Error("two notes needed");
  await page.mouse.move(a.x + a.width / 2, a.y + 14);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.move(a.x + a.width / 2, a.y + 40, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height + 30, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(1200);
  const undo = page.locator('[data-track="undo-merge"]').first();
  if (await undo.count()) await undo.click().catch(() => {});
  return `notes ${await noteCount()}`;
});
await step("pending: accept and reject", async () => {
  const accept = tray.locator('[data-track="note-accept"]').first();
  const reject = tray.locator('[data-track="note-reject"]').first();
  const had = `${await accept.count()}/${await reject.count()}`;
  if (await reject.count()) {
    await reject.click();
    await page.waitForTimeout(500);
    await page.locator('[data-track="undo-reject"]').first().click({ timeout: 6000 });
    await page.waitForTimeout(700);
  }
  return `pending controls ${had}`;
});
await step("notes full page: open", async () => {
  await tray.locator('[data-track="notes-full-page"]').first().click();
  await page.waitForURL(/\/notes/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  return page.url().replace(BASE, "");
});
await step("notes full page: write", async () => {
  const count = () => page.locator("[data-note-id]").count();
  const before = await count();
  const add = page.locator('[data-track="section-add-note"]').first();
  await add.click();
  const box = page.locator('[contenteditable="true"], textarea').last();
  await box.waitFor({ timeout: 5000 });
  await box.click();
  await page.keyboard.type(`Full page QA note ${stamp}.`);
  await page.locator('[data-track="note-compose-save"], [data-track="note-save"]').first().click();
  await page.waitForTimeout(1200);
  // A folded note shows its first words cut to the row: the count says it landed.
  const after = await count();
  if (after !== before + 1) throw new Error(`notes ${before} → ${after}`);
  return `notes ${before} → ${after}`;
});
await step("board: open and move tiles", async () => {
  await page.locator('[data-track="section-board"]').first().click();
  await page.waitForTimeout(1200);
  const tiles = page.locator("[data-tile-id], [data-note-id]").filter({ hasText: /\S/ });
  const n = await tiles.count();
  if (n >= 2) {
    const a = await tiles.nth(0).boundingBox();
    const b = await tiles.nth(1).boundingBox();
    if (a && b) {
      await page.mouse.move(a.x + a.width / 2, a.y + 20);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.move(a.x + a.width / 2 + 20, a.y + 40, { steps: 5 });
      await page.mouse.move(b.x + b.width + 10, b.y + b.height / 2, { steps: 14 });
      await page.waitForTimeout(300);
      await page.mouse.up();
      await page.waitForTimeout(1000);
    }
  }
  for (const [width, height] of [[1100, 800], [1700, 1100], [820, 900], [1500, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
  }
  return `tiles ${n}`;
});
await step("board: close", async () => {
  await page.locator('[data-track="board-close"]').first().click({ timeout: 5000 });
  await page.waitForTimeout(600);
  return "closed";
});
await step("section: add, rename, delete, undo", async () => {
  const add = page.getByRole("button", { name: /add (a )?section|new section/i }).first();
  if (!(await add.count())) return "no Add section control on this page";
  await add.click();
  const input = page.locator("input:focus, input[placeholder*='ection']").first();
  await input.fill(`QA section ${stamp}`);
  await input.press("Enter");
  await page.waitForTimeout(1000);
  if (!(await page.locator("body").innerText()).toLowerCase().includes(`qa section ${stamp}`)) throw new Error("the section does not show");
  return "added";
});
await step("clean up", async () => {
  // The run's notes go: the next round starts the same.
  const ids = await page.evaluate((s) => [...document.querySelectorAll("[data-note-id]")].filter((e) => e.textContent?.includes(s)).map((e) => e.getAttribute("data-note-id")), stamp);
  for (const id of new Set(ids)) await page.request.delete(`${BASE}/api/notes/${id}`).catch(() => {});
  return `removed ${new Set(ids).size}`;
});
console.log("\nSUMMARY:", results.map((r) => `${r.outcome}:${r.name}`).join("  "));
await browser.close();
