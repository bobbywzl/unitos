// Drives the running app against the mock model (scripts/qa/mock-kimi.mjs):
// the note's assistant docked at the bottom of an open note, and Save as note
// under an answer of the assistant panel. Prints PASS/FAIL.
//   NB=<notebook> DOC=<document> NOTE=<accepted note> node scripts/qa/ui-note-assistant.mjs
import { chromium } from "playwright-core";

const [NB, DOC, NOTE] = [process.env.NB, process.env.DOC, process.env.NOTE];
const base = process.env.BASE ?? "http://localhost:3311";
const SHOT = process.env.SHOT_DIR ?? ".";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/note-assistant-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  const tray = page.locator('aside[data-track-surface="tray"]');
  const card = tray.locator(`[data-note-id="${NOTE}"]`);
  await card.waitFor({ timeout: 20000 });

  // ── The note's assistant ──
  await card.locator('button[data-track="note-edit"]').click();
  const editing = tray.locator(`[data-note-id="${NOTE}"][data-note-editing]`);
  await editing.waitFor({ timeout: 5000 });
  const box = editing.locator('textarea[placeholder="Describe any changes you want to make…"]');
  check("an open note has the assistant at its bottom", (await box.count()) === 1);
  const boxRect = await box.boundingBox();
  const doneRect = await editing.locator('button[data-track="note-save"]').boundingBox();
  check("the assistant sits under the note's own buttons", boxRect && doneRect && boxRect.y > doneRect.y);

  await box.fill("What does this note say?");
  await box.press("Enter");
  await editing.getByText("Mock answer about the note").waitFor({ timeout: 30000 });
  check("a question gets a reply and no change", (await editing.locator('button[data-track="note-assistant-apply"]').count()) === 0);

  await box.fill("Group the points by theme");
  await box.press("Enter");
  const apply = editing.locator('button[data-track="note-assistant-apply"]');
  await apply.waitFor({ timeout: 30000 });
  const panelText = await editing.innerText();
  check("a change comes back as a proposed note", panelText.includes("Mock theme"));
  check("a made-up quote is taken out and named", panelText.includes("Taken out: a quote the document does not hold"));
  check("the made-up quote is not in the proposal", !panelText.includes("mask every philosopher wears in public.\n"));
  await page.screenshot({ path: `${SHOT}/note-assistant-proposal.png` });

  const bodyBefore = await editing.locator('[contenteditable="true"]').first().innerText();
  check("nothing changes before Apply", !bodyBefore.includes("Mock theme"));
  await apply.click();
  await page.waitForTimeout(300);
  const bodyAfter = await editing.locator('[contenteditable="true"]').first().innerText();
  check("Apply puts the change into the editor", bodyAfter.includes("Mock theme"));
  await editing.locator('button[data-track="note-assistant-undo"]').click();
  await page.waitForTimeout(300);
  const bodyUndone = await editing.locator('[contenteditable="true"]').first().innerText();
  check("Undo puts the draft back", !bodyUndone.includes("Mock theme"));
  await apply.click();
  await page.waitForTimeout(1500);
  await editing.locator('button[data-track="note-save"]').click();
  await page.waitForTimeout(1000);

  // Closed, the panel folds to one chip, remembered.
  await tray.locator(`[data-note-id="${NOTE}"] button[data-track="note-edit"]`).click();
  await editing.waitFor({ timeout: 5000 });
  const reopened = await editing.locator('[contenteditable="true"]').first().innerText();
  check("Done saves the applied note", reopened.includes("Mock theme"));
  await editing.locator('button[data-track="note-assistant-close"]').click();
  check("Close folds the assistant to a chip", (await editing.locator('button[data-track="note-assistant-open"]').count()) === 1);
  await editing.locator('button[data-track="note-assistant-open"]').click();
  await editing.locator('button[data-track="note-cancel"]').click();

  // ── Save as note under an answer of the assistant panel ──
  await page.locator('[data-track-surface="sidebar"] [data-track="assistant"]').click();
  await page.waitForTimeout(400);
  const ask = page.locator('[data-track-surface="tray"] textarea, [data-track-surface="tray"] input[type="text"]').last();
  await ask.fill("Why does the default payment matter?");
  await ask.press("Enter");
  const save = page.locator('button[data-track="assistant-save-note:assistant"]').last();
  await save.waitFor({ timeout: 60000 });
  check("an answer offers Save as note", true);
  await save.click();
  await page.getByText(/Saved in .* as a pending note/).waitFor({ timeout: 30000 });
  check("Save as note says where the note went", true);
  await page.screenshot({ path: `${SHOT}/save-as-note.png` });
}
