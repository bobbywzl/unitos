// A page in Chinese: Chinese text from the first paint, no hydration error,
// and the Chinese dictionary chunk loads only there.
import { chromium } from "playwright-core";
const base = "http://localhost:3400";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
for (const lang of ["en", "zh"]) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await context.addCookies([{ name: "dissect-lang", value: lang, domain: "localhost", path: "/" }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  let js = 0;
  page.on("response", async (r) => { if (r.request().resourceType() === "script") { try { js += (await r.body()).length; } catch {} } });
  const html = await (await page.goto(`${base}/`, { waitUntil: "networkidle" })).text();
  const ssrHasZh = /项目/.test(html);
  const text = await page.evaluate(() => document.body.innerText);
  const clientHasZh = /项目/.test(text);
  const newBtn = await page.locator("[data-track='new-project']").innerText();
  console.log(`${lang}: ssr zh=${ssrHasZh} client zh=${clientHasZh} button="${newBtn}" js=${(js/1024).toFixed(0)}KB errors=${errors.length} ${errors.slice(0,2).join(" | ")}`);
  await context.close();
}
await browser.close();
