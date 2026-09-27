import { chromium } from "playwright-core";
const BASE = "http://localhost:3111";
const SHOT = "/tmp/claude-0/-home-user-unitos/5c4cc702-d4fa-58a3-adb1-0bf46b207d45/scratchpad/r11-b3";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const scheme of ["dark", "light"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(240_000);
  await page.goto(`${BASE}/n/cmuk5p55q00do7d6lcs7kgxih?doc=cmuk5t6qj00r77d6loiirgopc`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor) && !window.__docsEditor.isDestroyed, null, { timeout: 300_000 });
  await new Promise((r) => setTimeout(r, 1500));
  const cite = page.locator(".docs-prose .docs-citation[data-ref-id]").nth(1);
  let tip = null;
  for (let i = 0; i < 5 && !tip; i++) {
    await page.mouse.move(700, 880);
    await new Promise((r) => setTimeout(r, 400));
    await cite.hover();
    tip = await page.waitForFunction(() => document.getElementById("app-tip")?.textContent || null, null, { timeout: 3000 }).then((h) => h.jsonValue()).catch(() => null);
  }
  await new Promise((r) => setTimeout(r, 600));
  const look = await page.evaluate(() => {
    const t = document.getElementById("app-tip");
    if (!t) return null;
    const cs = getComputedStyle(t);
    return { bg: cs.backgroundColor, fg: cs.color, opacity: cs.opacity, text: t.textContent };
  });
  const box = await page.evaluate(() => { const r = document.getElementById("app-tip")?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; });
  await page.screenshot({ path: `${SHOT}/citation-card-link-${scheme}.png`, clip: box ? { x: Math.max(0, box.x - 200), y: Math.max(0, box.y - 120), width: Math.min(900, box.w + 400), height: box.h + 200 } : undefined });
  console.log(scheme, JSON.stringify(look));
  await context.close();
}
await browser.close();
