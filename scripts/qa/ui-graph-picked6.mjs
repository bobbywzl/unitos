// ANS6-02 on the graph of "Linda WALK5": two documents picked, one Stitch
// question; the result's line says how many documents the pick left out
// ("Read 2 of 2 picked · 5 not picked"), en and zh, 1440 and 390 px.
//
//   BASE=http://localhost:3163 OUT=<dir> MODE=after LANG_UI=en node scripts/qa/ui-graph-picked6.mjs
// MODE=before (BASE=http://localhost:3111) takes the screenshots only. The
// mock model stores one link and one page per command: run "after" on a
// copy of the database. Sign-in off.

import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3163";
const OUT = process.env.OUT ?? "/tmp/picked6";
const MODE = process.env.MODE ?? "after";
const LANG = process.env.LANG_UI ?? "en";
const NB = "cmuyh40a8005b7dv2ln1r7tiv";
const ARTHUR = "cmuyh403g00097dv23o7i2w5d";
const BOOK2 = "cmuyh403z002o7dv278aqhyeb";
const after = MODE === "after";
const zh = LANG === "zh";
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};
const exe = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });

for (const w of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w < 640 ? 844 : 900 }, ...(w < 640 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.addCookies([{ name: "dissect-lang", value: LANG, url: BASE }]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`${BASE}/n/${NB}?graph=1`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 120000 });
  await page.waitForTimeout(1800);
  for (const id of [ARTHUR, BOOK2]) {
    await page.locator(`.react-flow__node[data-id="${id}"]`).focus();
    await page.keyboard.press(" ");
    await page.waitForTimeout(300);
  }
  if (w < 640) await page.locator('[data-track="stitch-expand"], [aria-label="Open Stitch"], [aria-label="展开缝合"]').first().click().catch(() => {});
  const input = page.locator('[data-track="stitch-send"]').locator("xpath=ancestor::form[1]").locator("textarea");
  await input.fill(zh ? "叔本华说同情有什么作用？" : "What does Schopenhauer say pity does?");
  await page.click('[data-track="stitch-send"]');
  const line = page.locator('[data-track="stitch-documents-read"]').last();
  await line.waitFor({ timeout: 120000 }).catch(() => {});
  const text = (await line.innerText().catch(() => "")).trim();
  console.log(`  ${w} ${LANG}: "${text}"`);
  if (after) check(zh ? /已读 2 \/ 2 篇选取的文档 · 5 篇未选取/.test(text) : /^Read 2 of 2 picked · 5 not picked$/.test(text), `${w} ${LANG}: the line says the documents not picked`, text);
  const box = await line.boundingBox();
  check(!!box && box.x >= 0 && box.x + box.width <= w, `${w} ${LANG}: the line fits the width`, JSON.stringify(box));
  await line.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/ANS6-02-${MODE}-${w}-${LANG}.png` });
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
