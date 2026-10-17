// ANS7-05: a generated page's quote parts, before (round 6 code: "157." a
// list item, quotes plain) and after (one italic paragraph each). Opens the
// two pages Stitch wrote for W1 in the reader and screenshots the Nietzsche
// section, en and zh, 1440 and 390. Reads only.
//
//   BASE=http://localhost:3177 NB=<project> BEFORE=<doc> AFTER=<doc> OUT=<dir> node scripts/qa/ui-graph-quote7.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3177";
const { NB, BEFORE, AFTER } = process.env;
const OUT = process.env.OUT ?? "/tmp/quote7";
fs.mkdirSync(OUT, { recursive: true });
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};
for (const lang of ["en", "zh"]) {
  for (const width of [1440, 390]) {
    for (const [mode, doc] of [["before", BEFORE], ["after", AFTER]]) {
      const ctx = await browser.newContext({ viewport: { width, height: width < 640 ? 844 : 900 }, ...(width < 640 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      await ctx.addCookies([{ name: "dissect-lang", value: lang, url: BASE }]);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/n/${NB}?doc=${doc}`, { waitUntil: "domcontentloaded", timeout: 240000 });
      const q = page.getByText("The thought of suicide is a great consolation", { exact: false }).first();
      await q.waitFor({ timeout: 180000 });
      await q.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -200));
      await page.waitForTimeout(800);
      const info = await q.evaluate((el) => {
        const li = el.closest("li, ol, ul");
        const em = el.closest("em, i") ?? el.querySelector("em, i");
        return { list: !!li, italic: !!em || getComputedStyle(el).fontStyle === "italic", text: el.textContent?.slice(0, 12) ?? "" };
      });
      const file = `${OUT}/ANS7-05-${mode}-${lang}-${width}.png`;
      await page.screenshot({ path: file });
      if (mode === "after") {
        check(!info.list, `${lang} ${width}: "157." quote is not a list item`, JSON.stringify(info));
        check(info.italic, `${lang} ${width}: the quote is italic`, JSON.stringify(info));
      } else console.log(`before ${lang} ${width}: ${JSON.stringify(info)}`);
      await ctx.close();
    }
  }
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
