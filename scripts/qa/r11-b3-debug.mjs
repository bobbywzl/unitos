import { chromium } from "playwright-core";
const BASE = "http://localhost:3111";
const SHOT = "/tmp/claude-0/-home-user-unitos/5c4cc702-d4fa-58a3-adb1-0bf46b207d45/scratchpad/r11-b3";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(240_000);
  await page.goto(`${BASE}/n/cmuk5p55q00do7d6lcs7kgxih?doc=cmuk5pa7200dy7d6lj1o11nxh`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor) && !window.__docsEditor.isDestroyed, null, { timeout: 300_000 });
  if (!(await page.locator("nav.docs-outline").count())) await page.click(".docs-outline-open");
  const section = page.locator('nav.docs-outline section[aria-label="Contents"]');
  await section.locator(".docs-outline-item").first().waitFor({ timeout: 180_000 });
  await page.evaluate(() => {
    const scroll = document.querySelector(".docs-outline-scroll");
    const sec = document.querySelector('nav.docs-outline section[aria-label="Contents"]');
    scroll.scrollTop += sec.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 40;
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${SHOT}/contents-panel-${scheme}.png` });
  console.log(scheme, "shot");
  await context.close();
}
await browser.close();
