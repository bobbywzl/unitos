// Drives the running app against the mock model (scripts/qa/mock-kimi.mjs):
// words from a figure (SPEC.md §7). A blank document with a pasted image:
// the image toolbar's Assistant opens the assistant's bar on the image; a
// chip that reads the image answers in the chat card; a chip that says
// "under the image" lands the words under it as the assistant's suggestion,
// and its ✓ keeps them. Prints PASS/FAIL.
//   node scripts/qa/ui-figure-words.mjs
import { chromium } from "playwright-core";

const base = process.env.BASE ?? "http://localhost:3311";
const SHOT = process.env.SHOT_DIR ?? ".";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
const api = async (path, method, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/figure-words-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
  // A picture of a paragraph, as a screenshot of a page would be.
  const shot = await browser.newPage({ viewport: { width: 520, height: 140 } });
  await shot.setContent('<p style="font:18px Georgia;margin:16px">A study led by Jane Gillette (1999) tested college undergraduates on 24 video clips.</p>');
  const png = (await shot.screenshot()).toString("base64");
  await shot.close();

  const nb = await api("/api/notebooks", "POST", { title: `QA figure words ${Date.now()}` });
  const doc = await api("/api/documents/blank", "POST", { notebookId: nb.id, title: "Figure words (QA)" });
  await page.goto(`${base}/n/${nb.id}?doc=${doc.id}`, { waitUntil: "networkidle" });
  const editor = "[data-docs-editor] .ProseMirror";
  await page.waitForSelector(editor, { timeout: 30000 });
  await page.locator(editor).click();
  await page.keyboard.type("Ch 5: Learning words");
  await page.keyboard.press("Enter");
  // Paste the picture.
  await page.locator(editor).evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, png);
  const img = page.locator(`${editor} img`).first();
  await img.waitFor({ timeout: 15000 });
  await page.waitForFunction((sel) => /\/api\/images\//.test(document.querySelector(sel)?.getAttribute("src") ?? ""), `${editor} img`, { timeout: 15000 });
  await img.click();

  // The figure tools a click on the image opens: the Assistant alone.
  const button = page.locator('[data-selection-popover] [data-track="assistant"]');
  await button.waitFor({ timeout: 5000 });
  check("the image's figure tools show the Assistant", await button.isVisible());
  await page.screenshot({ path: `${SHOT}/figure-words-toolbar.png` });
  await button.click();
  const bar = page.locator("[data-assistant-bar]");
  await bar.waitFor({ timeout: 5000 });
  const chips = await bar.locator('button[data-track^="assistant-figure:"]').allTextContents();
  check("the bar on the image offers the two image chips", chips.length === 2 && chips.includes("The text") && chips.includes("The key points"), chips.join(", "));
  await page.screenshot({ path: `${SHOT}/figure-words-bar.png` });

  // A typed question about the image: an answer, nothing in the text.
  await bar.locator("input").fill("Extract the text");
  await bar.locator("input").press("Enter");
  const answer = page.getByText("A study led by Jane Gillette (1999) tested college undergraduates on 24 video clips.", { exact: true }).first();
  await answer.waitFor({ timeout: 20000 });
  check("Extract the text answers in the chat card", await answer.isVisible());
  check("an answer adds nothing to the text", (await page.locator(`${editor} p`, { hasText: "Jane Gillette" }).count()) === 0);
  await page.keyboard.press("Escape");

  // A chip that says under the image: the assistant's suggestion under it.
  await img.click();
  await button.click();
  await bar.waitFor({ timeout: 5000 });
  await bar.locator('button[data-track="assistant-figure:Text"]').click();
  const inserted = page.locator(`${editor} .docs-suggest-insert, ${editor} ins, ${editor} [data-suggestion]`, { hasText: "Jane Gillette" }).first();
  await inserted.waitFor({ timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: `${SHOT}/figure-words-suggestion.png` });
  const order = await page.locator(editor).evaluate((el) => {
    const imgEl = el.querySelector("img");
    const words = [...el.querySelectorAll("p, li")].find((p) => p.textContent?.includes("Jane Gillette"));
    return imgEl && words ? Boolean(imgEl.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
  });
  check("the words land under the image", order === true, String(order));
  check("Put the text under the image gives the text alone, no list", (await page.locator(`${editor} li`).count()) === 0);
  const accept = bar.locator('button[data-track="assistant-suggestions:accept-all"]');
  check("the bar offers Accept for the suggestion", (await accept.count()) === 1);
  await accept.click();
  await page.waitForTimeout(800);
  const pending = await page.locator(editor).evaluate((el) => el.querySelectorAll("[data-suggestion-id], .suggestion-insertion, ins").length);
  check("Accept keeps the words as text, no suggestion left", pending === 0 && (await page.locator(`${editor} p`, { hasText: "Jane Gillette" }).count()) === 1, `pending marks: ${pending}`);
  await page.screenshot({ path: `${SHOT}/figure-words-accepted.png` });

  // The key points chip: the list alone, never the text again.
  await img.click();
  await button.click();
  await bar.waitFor({ timeout: 5000 });
  await bar.locator('button[data-track="assistant-figure:KeyPoints"]').click();
  await page.locator(`${editor} li`, { hasText: "Verbs were harder than nouns" }).first().waitFor({ timeout: 20000 });
  check(
    "Put the key points under the image gives the list alone, not the text again",
    (await page.locator(`${editor} li`).count()) === 2 && (await page.locator(`${editor} p`, { hasText: "Jane Gillette" }).count()) === 1,
  );
  await page.screenshot({ path: `${SHOT}/figure-words-points.png` });
  await fetch(`${base}/api/documents/${doc.id}`, { method: "DELETE" });
}

