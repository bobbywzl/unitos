// REV9-06: the admin usage page's Input tokens tile and Tokens sums count
// the cached tokens of rows written since CACHE_COUNTED_APART_SINCE
// (lib/usage.ts), which keep the uncached input alone in inputTokens
// (COST8-02), so every row counts every prompt token. Runs on a COPY of the
// database with a dev server on it (ADMIN_PASSWORD set; the admin cookie is
// set here directly):
//   DB=dissect_r9safe9 BASE=http://localhost:3176 OUT=<dir> LANG_UI=en WIDTH=1440 node scripts/qa/ui-usage-cached.mjs
// Adds 20 usage rows of a cached Stitch answer pass for account rev3-ua and
// deletes them; no other row is touched.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3176";
const DB = process.env.DB ?? "";
if (!DB || DB === "dissect") throw new Error("Set DB to a copy of the database, never the shared one.");
const OUT = process.env.OUT ?? "";
const LANG = process.env.LANG_UI ?? "en";
const WIDTH = Number(process.env.WIDTH ?? 1440);
const SHOT = process.env.SHOT ?? "REV9-06-after";
const PHONE = WIDTH < 600;
const zh = LANG === "zh";
const CUT = "2026-10-08T00:00:00Z";
const q = (sql) =>
  execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", sql], { env: { ...process.env, PGPASSWORD: "postgres" } })
    .toString()
    .trim();
const fmtTok = (v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}k` : String(v));
const PREFIX = `safe9-ue-${Date.now().toString(36)}`;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` | ${detail}` : ""}`);
};
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--disable-dev-shm-usage"] });
try {
  // 20 cached Stitch answer passes on Kimi, as sdkTokens writes them since
  // COST8-02: 4,000 uncached input, 36,000 read from the cache, 800 output.
  const values = Array.from({ length: 20 }, (_, i) => `('${PREFIX}-${i}','rev3-ua','moonshot','kimi-k3','stitch',4000,800,36000,0,0.0348,now(),'answer')`).join(",");
  q(`INSERT INTO "UsageEvent"(id,"userId",provider,model,feature,"inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens","costUsd","createdAt",pass) VALUES ${values}`);
  const rawInput = Number(q(`SELECT sum("inputTokens") FROM "UsageEvent"`));
  const cached = Number(q(`SELECT coalesce(sum("cacheReadTokens"+"cacheWriteTokens"),0) FROM "UsageEvent" WHERE "createdAt" >= '${CUT}'`));
  const rawUser = Number(q(`SELECT sum("inputTokens") FROM "UsageEvent" WHERE "userId"='rev3-ua'`));
  const cachedUser = Number(q(`SELECT coalesce(sum("cacheReadTokens"+"cacheWriteTokens"),0) FROM "UsageEvent" WHERE "userId"='rev3-ua' AND "createdAt" >= '${CUT}'`));
  const email = q(`SELECT email FROM "User" WHERE id='rev3-ua'`);
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: PHONE ? 844 : 900 }, hasTouch: PHONE, isMobile: PHONE });
  await ctx.addCookies([
    { name: "admin-auth", value: "true", url: BASE },
    { name: "dissect-lang", value: LANG, url: BASE },
  ]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/usage`, { waitUntil: "networkidle", timeout: 300000 });
  const tile = page.locator("p", { hasText: zh ? /^输入 token$/ : /^Input tokens$/ }).first().locator("xpath=following-sibling::p").first();
  await tile.waitFor({ timeout: 60000 });
  const shown = (await tile.innerText()).trim();
  console.log(`Input tokens tile: ${shown}; every prompt token ${fmtTok(rawInput + cached)}; the uncached input alone ${fmtTok(rawInput)} (cached since ${CUT.slice(0, 10)}: ${fmtTok(cached)})`);
  check("the Input tokens tile counts the cached tokens of the rows since the cut", shown === fmtTok(rawInput + cached), shown);
  const row = page.locator("tr", { hasText: email }).first();
  await row.waitFor({ timeout: 10000 }).catch(() => {});
  const cells = await row.locator("td").allInnerTexts().catch(() => []);
  console.log(`by-account row for ${email}: ${cells.join(" | ")}; every prompt token ${fmtTok(rawUser + cachedUser)}; the uncached input alone ${fmtTok(rawUser)}`);
  check("the account's Input column counts its cached tokens", cells[2]?.trim() === fmtTok(rawUser + cachedUser), cells[2] ?? "no row");
  if (OUT) await page.screenshot({ path: `${OUT}/${SHOT}-${LANG}-${WIDTH}.png` });
  await ctx.close();
} finally {
  await browser.close();
  q(`DELETE FROM "UsageEvent" WHERE id LIKE '${PREFIX}-%'`);
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAIL`);
process.exit(failed === 0 ? 0 : 1);
