import { chromium } from "playwright-core";
const base = "http://localhost:3400";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
for (let i = 0; i < 3; i++) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    window.__t = {}; window.__t.click = null;
    const seen = (sel, key) => { if (!window.__t[key] && document.querySelector(sel)) window.__t[key] = performance.now(); };
    new MutationObserver(() => { seen("[data-reader-loading]", "frame"); seen("[data-track-surface='sidebar']", "sidebar"); seen("[data-block-id]", "block"); }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("click", () => { window.__t.click = performance.now(); }, true);
  });
  await page.click(`a[href="/n/${process.env.NB}"]`);
  await page.waitForSelector("[data-track-surface='sidebar']", { timeout: 30000 });
  const pw = await page.evaluate(() => performance.now());
  const t = await page.evaluate(() => window.__t);
  const rel = (v) => (v ? (v - t.click).toFixed(0) : "-");
  console.log(`run ${i}: frame +${rel(t.frame)}ms sidebar in DOM +${rel(t.sidebar)}ms first block +${rel(t.block)}ms; playwright saw sidebar at +${(pw - t.click).toFixed(0)}ms`);
  await page.context().close();
}
await browser.close();
