// Drives the running app against the mock model (scripts/qa/mock-kimi.mjs):
// every assistant surface keeps its conversation (SPEC.md §21) — closing it,
// leaving the page, a reload, and another browser keep it; Clear
// conversation removes it. Prints PASS/FAIL.
//   NB=<notebook> DOC=<document> AUDIO=<transcribed audio document> NOTE=<note> \
//     node scripts/qa/ui-kept-chat.mjs
import { chromium } from "playwright-core";

const { NB, DOC, AUDIO, NOTE } = process.env;
const base = process.env.BASE ?? "http://localhost:3111";
const SHOT = process.env.SHOT_DIR ?? ".";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
// Clear conversation asks first.
page.on("dialog", (d) => void d.accept());

const settle = (ms = 1200) => page.waitForTimeout(ms);

try {
  await otherAccount();
  await media();
  await askRange();
  await stitch();
  await noteAssistant();
  await sidePanel();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/kept-chat-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

/** A fresh browser: no tab memory, no local copy — the server's copy alone. */
async function otherDevice(url, fn) {
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await other.newPage();
  await p.goto(url, { waitUntil: "networkidle" });
  try {
    return await fn(p);
  } finally {
    await other.close();
  }
}

async function media() {
  const url = `${base}/n/${NB}?doc=${AUDIO}`;
  await page.goto(url, { waitUntil: "networkidle" });
  const open = page.locator('button[data-track="video-assistant"]');
  await open.click();
  const box = page.locator('input[aria-label="Assistant"]');
  await box.fill("What is the main claim of this recording?");
  await box.press("Enter");
  await page.locator('button[data-track="video-assistant-clear"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-track="video-assistant-send"] svg'), null, { timeout: 30000 });
  await settle();
  const card = () => page.locator('button[data-track="video-assistant-close"]').locator("xpath=ancestor::div[contains(@class,'shadow-float')][1]");
  const answered = await card().innerText();
  await page.screenshot({ path: `${SHOT}/media-1-answered.png` });

  // Close and open the card.
  await page.locator('button[data-track="video-assistant-close"]').click();
  await open.click();
  check("media: closing the card keeps the conversation", (await card().innerText()).includes("What is the main claim"));

  // Leave for another document and come back (client navigation).
  await page.evaluate((u) => window.history.pushState(null, "", u), `/n/${NB}?doc=${DOC}`);
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.goBack({ waitUntil: "networkidle" });
  await page.locator('button[data-track="video-assistant"]').click();
  await settle();
  check("media: leaving the page and coming back keeps it", (await card().innerText()).includes("What is the main claim"));

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('button[data-track="video-assistant"]').click();
  await settle();
  const afterReload = await card().innerText();
  check("media: a reload keeps it, answer included", afterReload.includes("What is the main claim") && afterReload.length >= answered.length - 20);
  await page.screenshot({ path: `${SHOT}/media-2-after-reload.png` });

  const elsewhere = await otherDevice(url, async (p) => {
    await p.locator('button[data-track="video-assistant"]').click();
    await p.waitForTimeout(1500);
    return p.locator('input[aria-label="Assistant"]').locator("xpath=ancestor::div[contains(@class,'shadow-float')][1]").innerText();
  });
  check("media: another browser shows it", elsewhere.includes("What is the main claim"));

  // A reply that lands after the card closed still lands.
  await box.fill("Say it in one line");
  await box.press("Enter");
  await page.locator('button[data-track="video-assistant-close"]').click();
  await page.waitForTimeout(6000);
  await open.click();
  await settle();
  const late = await card().innerText();
  const lines = late.split("Say it in one line");
  check("media: a reply that lands after the card closed is kept", lines.length === 2 && lines[1].trim().length > 20, lines[1]?.slice(0, 80));

  // Typed words survive a reload.
  await box.fill("half a question");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('button[data-track="video-assistant"]').click();
  check("media: unsent words survive a reload", (await page.locator('input[aria-label="Assistant"]').inputValue()) === "half a question");
  await page.locator('input[aria-label="Assistant"]').fill("");

  // Clear conversation removes it, here and on the server.
  await page.locator('button[data-track="video-assistant-clear"]').click();
  await settle();
  check("media: Clear empties the card", !(await card().innerText()).includes("What is the main claim"));
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('button[data-track="video-assistant"]').click();
  await settle();
  check("media: a cleared conversation stays cleared after a reload", !(await card().innerText()).includes("What is the main claim"));
  await page.locator('button[data-track="video-assistant-close"]').click();
}

async function askRange() {
  await page.goto(`${base}/n/${NB}?doc=${AUDIO}`, { waitUntil: "networkidle" });
  await page.locator('button[data-track="video-ask-open"]').click();
  const panel = page.locator("[data-ask-range]");
  await panel.locator('input[aria-label="Ask about a range"]').fill("Who pays for the default?");
  await panel.locator('button[data-track="video-ask"]').click();
  await panel.locator('button[data-track="video-ask-regenerate"]').waitFor({ timeout: 30000 });
  await settle();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('button[data-track="video-ask-open"]').click();
  await settle();
  const text = await page.locator("[data-ask-range]").innerText();
  check("ask: a reload keeps the question and its answer", text.includes("0:") && (await page.locator('[data-ask-range] button[data-track="video-ask-regenerate"]').count()) === 1);
  await page.screenshot({ path: `${SHOT}/ask-after-reload.png` });
  await page.locator('[data-ask-range] button[data-track="video-ask-clear"]').click();
  await settle();
  check("ask: Clear removes the answer", (await page.locator('[data-ask-range] button[data-track="video-ask-regenerate"]').count()) === 0);
}

async function stitch() {
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.locator('button[data-track="graph"]').click();
  const box = page.locator('textarea[aria-label="Stitch"]');
  await box.waitFor({ timeout: 20000 });
  await box.fill("Find the contradictions between these documents");
  await page.locator('button[data-track="stitch-send"]').click();
  await page.locator('button[data-track="stitch-clear"]').waitFor({ timeout: 90000 });
  await settle();
  const region = page.locator('[role="region"][aria-label="Stitch"]');
  await page.screenshot({ path: `${SHOT}/stitch-1-answered.png` });
  await page.locator('button[data-track="graph-close"]').click();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('button[data-track="graph"]').click();
  await region.waitFor({ timeout: 20000 });
  await settle();
  const text = await region.innerText();
  check("stitch: a reload keeps the conversation and its result", text.includes("Find the contradictions") && /documents? read|read/i.test(text));
  await page.screenshot({ path: `${SHOT}/stitch-2-after-reload.png` });
  await page.locator('button[data-track="stitch-clear"]').click();
  await settle();
  check("stitch: Clear removes it", !(await region.innerText()).includes("Find the contradictions"));
  await page.locator('button[data-track="graph-close"]').click();
}

async function noteAssistant() {
  await page.goto(`${base}/n/${NB}/notes`, { waitUntil: "networkidle" });
  const card = page.locator(`[data-note-id="${NOTE}"]`).first();
  await card.waitFor({ timeout: 20000 });
  await card.locator('button[data-track="note-edit"]').click();
  const editing = page.locator(`[data-note-id="${NOTE}"][data-note-editing]`);
  await editing.waitFor({ timeout: 5000 });
  const box = editing.locator('textarea[placeholder="Describe any changes you want to make…"]');
  await box.fill("What does this note say?");
  await box.press("Enter");
  await editing.getByText("Mock answer about the note").waitFor({ timeout: 30000 });
  await settle();
  await editing.locator('button[data-track="note-cancel"]').click();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`[data-note-id="${NOTE}"] button[data-track="note-edit"]`).first().click();
  await editing.waitFor({ timeout: 5000 });
  await settle();
  check("note: a reload keeps the note's conversation", (await editing.innerText()).includes("Mock answer about the note"));
  await page.screenshot({ path: `${SHOT}/note-after-reload.png` });
  await editing.locator('button[data-track="note-assistant-clear"]').click();
  await settle();
  check("note: Clear removes it", !(await editing.innerText()).includes("Mock answer about the note"));
  await editing.locator('button[data-track="note-cancel"]').click();
}

async function sidePanel() {
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  await page.locator('[data-track="assistant"]').first().click();
  await settle(600);
  const ask = page.locator('[data-track-surface="tray"] textarea').last();
  await ask.fill("Kept question about the default payments");
  await ask.press("Enter");
  // Leave at once: the question is saved before the answer lands.
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-track="assistant"]').first().click();
  await settle(2000);
  check("side assistant: a question sent just before a reload is kept", (await page.locator('[data-track-surface="tray"]').innerText()).includes("Kept question about the default payments"));
  await page.screenshot({ path: `${SHOT}/side-after-reload.png` });
}

// An unsaved copy another account left on this browser is never shown or
// saved as this account's: it is parked under that account's name.
async function otherAccount() {
  const key = `unitos-kept-chat:${NB}|media:${AUDIO}`;
  await page.goto(`${base}/n/${NB}`, { waitUntil: "networkidle" });
  await page.evaluate(
    (k) => localStorage.setItem(k, JSON.stringify({ turns: [{ role: "user", content: "Another account's question" }], at: Date.now(), account: "someone-else" })),
    key,
  );
  await page.goto(`${base}/n/${NB}?doc=${AUDIO}`, { waitUntil: "networkidle" });
  await page.locator('button[data-track="video-assistant"]').click();
  await settle(2000);
  const shown = await page.locator('button[data-track="video-assistant-close"]').locator("xpath=ancestor::div[contains(@class,'shadow-float')][1]").innerText();
  check("account: another account's unsaved copy is not shown", !shown.includes("Another account's question"));
  const parked = await page.evaluate((k) => localStorage.getItem(`unitos-kept-chat:someone-else|${k.slice("unitos-kept-chat:".length)}`), key);
  check("account: it is parked under that account", Boolean(parked && parked.includes("Another account's question")));
  await page.locator('button[data-track="video-assistant-close"]').click();
}
