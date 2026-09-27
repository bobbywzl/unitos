import { chromium } from "playwright-core";
const BASE = "http://localhost:3111";
const SHOT = "/tmp/claude-0/-home-user-unitos/5c4cc702-d4fa-58a3-adb1-0bf46b207d45/scratchpad/r11-b3";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.setDefaultNavigationTimeout(240_000);
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error" && !/CERT|Failed to load/.test(m.text())) errs.push(m.text().slice(0, 200)); });
page.on("request", (r) => { if (r.url().includes("/contents")) console.log("request", r.method(), new Date().toISOString()); });
await page.goto(`${BASE}/n/cmuhjx1t7000b7d66uw3kak3j?doc=cmuhkrigy015n7d665d6izvom`, { waitUntil: "load" });
await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 300_000 });
await new Promise((r) => setTimeout(r, 6000));
for (let i = 0; i < 3; i++) {
  await page.locator('[data-track="contents"]').first().click();
  const open = await page.waitForSelector("nav[data-contents]", { timeout: 5000 }).then(() => true).catch(() => false);
  console.log("click", i, "open:", open, "aria-expanded:", await page.locator('[data-track="contents"]').first().getAttribute("aria-expanded"));
  if (open) break;
}
await page.waitForFunction(() => {
  const nav = document.querySelector("nav[data-contents]");
  return nav && (nav.querySelectorAll('[data-track="contents-part"]').length > 0 || /Generate contents|No contents/.test(nav.textContent ?? ""));
}, null, { timeout: 180_000 }).catch(() => null);
const nav = page.locator("nav[data-contents]");
const parts = await nav.locator('[data-track="contents-part"]').count().catch(() => 0);
const text = (await nav.textContent().catch(() => "")) ?? "";
await page.screenshot({ path: `${SHOT}/contents-menu-block-reader.png` });
let jumped = null;
if (parts > 2) {
  const href = await nav.locator('[data-track="contents-part"]').nth(2).getAttribute("href");
  await nav.locator('[data-track="contents-part"]').nth(2).click();
  jumped = await page.waitForFunction((id) => (document.querySelector(`[data-block-id="${id}"]`)?.classList.contains("anchor-flash") ? true : null), href.replace("#block-", ""), { timeout: 5000 }).then(() => true).catch(() => false);
}
console.log("parts:", parts, "|", text.slice(0, 120), "| jump flashes:", jumped, "| errors:", errs.slice(0, 3));
await browser.close();
