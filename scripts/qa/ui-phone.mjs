// The phone page (SPEC.md §33) at an iPhone's size: a typed note is added
// and stored, a draft survives a reload, a failed add keeps the words, a
// note opens to edit and saves, and the assistant answers at Project scope
// and keeps the conversation. The reader's chrome (rail, tray) is absent.
//
//   node scripts/qa/ui-phone.mjs <notebookId> [outDir]
//
// The app runs on :3311 with sign-in off and the mock model
// (scripts/qa/tools-loop.mjs's header).
import { chromium } from "playwright-core";

const [NB, OUT = "scripts/qa/out"] = process.argv.slice(2);
if (!NB) {
  console.error("usage: node scripts/qa/ui-phone.mjs <notebookId> [outDir]");
  process.exit(2);
}
const BASE = process.env.QA_BASE ?? "http://localhost:3311";

let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const open = async () => {
  await page.goto(`${BASE}/phone?p=${NB}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector("[data-phone-box]");
};
await open();

check("no side bar, no rail, no reader", (await page.locator('nav[data-nudge="rail"], [data-reader-root]').count()) === 0);
check("the page does not scroll sideways", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check("two tabs: Notes and Assistant", (await page.locator('[role="tab"]').count()) === 2);

// 1. A draft survives a reload.
const stamp = Date.now().toString(36);
const words = `Phone note ${stamp}: the default slot is an auction.`;
await page.fill("[data-phone-box]", words);
await open();
check("a draft survives a reload", (await page.inputValue("[data-phone-box]")) === words);

// 2. An add the server refuses keeps the words in the box.
await page.route("**/api/notes", (route) => route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"Viewing only"}' }));
await page.click('[data-track="phone-add-note"]');
await page.waitForSelector('[data-phone-page] [role="alert"]');
check("a refused add keeps the words in the box", (await page.inputValue("[data-phone-box]")) === words);
await page.unroute("**/api/notes");

// 3. With the network down the note waits in the offline queue and shows so.
await page.route("**/api/notes", (route) => route.abort());
await page.click('[data-track="phone-add-note"]');
await page.waitForFunction(() => document.querySelector("[data-phone-box]").value === "");
const waiting = await page.locator("[data-phone-note]").first().innerText();
check("with the network down the note waits and says so", waiting.includes(stamp) && /network/i.test(waiting), waiting.slice(0, 70));
await page.unroute("**/api/notes");

// 4. With the network back the queue sends it: stored once, at the top.
await open();
await page.waitForTimeout(2500);
await open();
const first = await page.locator("[data-phone-note]").first().innerText();
check("the note shows at the top of the section", first.includes(stamp), first.slice(0, 60));
const count = await page.locator("[data-phone-note]", { hasText: stamp }).count();
check("the note is stored once", count === 1, `${count} found`);
check("the draft is gone once the note is stored", (await page.inputValue("[data-phone-box]")) === "");

// 5. A note typed with the network up is stored at once.
const direct = `Second entry ${stamp}.`;
await page.fill("[data-phone-box]", direct);
await page.click('[data-track="phone-add-note"]');
await page.waitForFunction(() => document.querySelector("[data-phone-box]").value === "");
await open();
check("a note added with the network up is stored once", (await page.locator("[data-phone-note]", { hasText: `Second entry ${stamp}` }).count()) === 1);
await page.screenshot({ path: `${OUT}/phone-1-notes.png` });

// 6. A note opens to edit and saves.
await page.locator("[data-phone-note]", { hasText: `Phone note ${stamp}` }).click();
await page.waitForSelector("[data-phone-edit]");
await page.fill("[data-phone-edit]", `${words}\n\nEdited on the phone.`);
await page.screenshot({ path: `${OUT}/phone-2-edit.png` });
await page.click('[data-track="phone-save-note"]');
await page.waitForSelector("[data-phone-edit]", { state: "detached" });
await open();
const edited = await page.locator("[data-phone-note]", { hasText: `Phone note ${stamp}` }).innerText();
check("an edited note saves", edited.includes("Edited on the phone."), edited.slice(0, 80));

// 7. The assistant answers and the conversation is kept.
await page.click('[data-track="phone-tab:assistant"]');
await page.fill("[data-phone-ask]", `What is the main claim? (${stamp})`);
await page.click('[data-track="phone-ask"]');
await page.waitForFunction(() => document.querySelectorAll("[data-phone-chat] > div").length > 0 && !document.querySelector('[data-phone-chat] [role="status"]'), null, { timeout: 90_000 });
const answer = await page.locator("[data-phone-chat] > div").last().innerText();
check("the assistant answers", answer.trim().length > 20, answer.slice(0, 80));
check("the assistant shows no error", (await page.locator('[data-phone-page] [role="alert"]').count()) === 0, await page.locator('[data-phone-page] [role="alert"]').allInnerTexts().then((a) => a.join(" | ")));
await page.screenshot({ path: `${OUT}/phone-3-assistant.png` });
await open();
await page.click('[data-track="phone-tab:assistant"]');
await page.waitForTimeout(1200);
const kept = await page.locator("[data-phone-chat]").innerText();
check("the conversation is kept through a reload", kept.includes(stamp));

await browser.close();
console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
