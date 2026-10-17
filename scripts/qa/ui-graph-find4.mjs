// COST4-02: the Find list with the smaller first answer. On a project past
// FIND_TOP documents, the first 30 rows carry one passage, the rest their
// count; a row past them loads its passage when it scrolls into view.
// Screenshots en/zh × 1440/390.
//   BASE=http://localhost:3165 NB=<project> Q=the OUT=<dir> TAG=-after node scripts/qa/ui-graph-find4.mjs
import { chromium } from "playwright-core";
const BASE = process.env.BASE ?? "http://localhost:3165";
const NB = process.env.NB;
const Q = process.env.Q ?? "the";
const OUT = process.env.OUT ?? ".";
const TAG = process.env.TAG ?? "";
const CHECK = process.env.CHECK !== "0";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
for (const lang of ["en", "zh"]) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const tag = `${w}-${lang}`;
    const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, isMobile: w < 500 });
    await context.addCookies([{ name: "dissect-lang", value: lang, url: BASE }]);
    const page = await context.newPage();
    const finds = [];
    page.on("request", (r) => r.url().includes("/find?") && finds.push(r.url()));
    await page.goto(`${BASE}/n/${NB}?graph=1&graphFind=${encodeURIComponent(Q)}`, { waitUntil: "networkidle", timeout: 300000 });
    await page.locator("[data-graph-find-group]").first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/COST4-02-find-${tag}${TAG}.png` });
    if (CHECK) {
      const groups = await page.locator("[data-graph-find-group]").count();
      const withPassage = await page.locator("[data-graph-find-group]:has([data-graph-find-passage])").count();
      check(`${tag}: rows`, groups > 0, `${groups} rows, ${withPassage} with a passage before scrolling`);
      const first = await page.locator("[data-graph-find-group]").first().locator("[data-graph-find-passage]").count();
      check(`${tag}: the first row shows one passage`, first === 1, String(first));
      if (groups > 30) {
        const row = page.locator("[data-graph-find-group]").nth(40);
        const before = await row.locator("[data-graph-find-passage]").count();
        await row.scrollIntoViewIfNeeded();
        await row.locator("[data-graph-find-passage]").first().waitFor({ timeout: 20000 }).catch(() => {});
        const after = await row.locator("[data-graph-find-passage]").count();
        const marked = await row.locator("mark").first().innerText().catch(() => "");
        check(`${tag}: row 41 loads its passage on view`, before === 0 && after === 1 && marked.toLowerCase() === Q.toLowerCase(), `${before} -> ${after}, mark "${marked}"`);
        await page.screenshot({ path: `${OUT}/COST4-02-find-scrolled-${tag}${TAG}.png` });
        const more = row.locator("button", { hasText: /more|还有/ });
        if (await more.count()) {
          await more.first().click();
          await page.waitForTimeout(1500);
          const n = await row.locator("[data-graph-find-passage]").count();
          check(`${tag}: + more reads the next ten`, n === 11, String(n));
        }
        check(`${tag}: the scroll loaded rows one call each, with limit=1`, finds.filter((u) => u.includes("limit=1")).length >= 1, `${finds.length} find calls`);
      }
    }
    await context.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
