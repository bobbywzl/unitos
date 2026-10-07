// REV4-02: after an edit to a linked paragraph, the open link panel shows the new passage, though the
// graph's refetch answers 304; the Documents list reads its part titles again after the rev move.
//   node scripts/qa/ui-graph-passages-fresh.mjs <port> <db> [tag] [lang] [width]
// On a sign-in-on server over a database copy seeded with .qa-tmp/stitch/r3/rev/seed.sql (project rev3-p,
// link rev3-l1 on block rev3-b1, account A's session rev3-sa). It edits rev3-b1 and bumps the project's rev,
// as a collaborator's edit does, then puts the block's text back. Refuses the shared database "dissect".
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const port = process.argv[2] || "3161";
const DB = process.argv[3] || "";
const tag = process.argv[4] || "after";
const lang = process.argv[5] || "en";
const width = Number(process.argv[6] || 1440);
if (!DB || DB === "dissect") {
  console.error("Refusing: name a database copy.");
  process.exit(1);
}
const B = `http://localhost:${port}`;
const SHOT = process.env.SHOT ?? "/mnt/project-files/stitch-graph-loop/round-4/safe4";
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "postgres" } }).toString().trim();
const ORIGINAL = sql(`SELECT text FROM "Block" WHERE id='rev3-b1'`);
const EDITED = `${ORIGINAL} An edit after the quote, ${Date.now()}.`;
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
try {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, hasTouch: width < 600, isMobile: width < 600 });
  await ctx.addCookies([
    { name: "dissect-lang", value: lang, url: B },
    { name: "dissect-session", value: "rev3-sa", url: B },
  ]);
  const page = await ctx.newPage();
  const calls = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) calls.push({ path: u.pathname + u.search, status: r.status(), at: Date.now() });
  });
  await page.goto(`${B}/n/rev3-p`, { waitUntil: "networkidle", timeout: 300000 });
  for (let i = 0; i < 6 && (await page.locator(".graph-overlay-in").count()) === 0; i++) {
    await page.locator('[data-track="graph"]').first().click();
    await page.waitForTimeout(1500);
  }
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await page.locator('[data-track="graph-documents"]').first().click();
  await page.locator("[data-graph-documents-list]").waitFor({ timeout: 10000 });
  await page.locator('[data-graph-documents-link="rev3-l1"]').first().click();
  const passages = page.locator("[data-link-passages]");
  await passages.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const before = await passages.innerText();
  check("the passage loads", before.includes(ORIGINAL.slice(0, 20)), before.slice(0, 120));

  const t0 = Date.now();
  sql(`UPDATE "Block" SET text = '${EDITED.replace(/'/g, "''")}' WHERE id='rev3-b1'; UPDATE "Notebook" SET rev = rev + 1 WHERE id='rev3-p'`);
  let after = before;
  for (let i = 0; i < 60 && !after.includes("An edit after the quote"); i++) {
    await page.waitForTimeout(1000);
    after = await passages.innerText().catch(() => after);
  }
  const graphCalls = calls.filter((c) => c.at >= t0 && /\/graph(\?|$)/.test(c.path));
  console.log("graph refetch:", JSON.stringify(graphCalls.map((c) => c.status)));
  check("the open link panel shows the new passage", after.includes("An edit after the quote"), after.slice(0, 160));
  check("the graph's refetch answered 304 (the body did not change)", graphCalls.some((c) => c.status === 304));
  check("the passages were read again once", calls.filter((c) => c.at >= t0 && c.path.includes("/graph/passages")).length === 1);
  await page.screenshot({ path: `${SHOT}/REV4-02-${lang}-${width}-${tag}.png` });
  await page.locator('[data-track="graph-link-panel-back"]').click().catch(() => undefined);
  await page.waitForTimeout(1500);
  check("the Documents list read its part titles again after the rev move", calls.some((c) => c.at >= t0 && c.path.includes("parts=titles")));
} finally {
  sql(`UPDATE "Block" SET text = '${ORIGINAL.replace(/'/g, "''")}' WHERE id='rev3-b1'`);
  await browser.close();
}
console.log(failures === 0 ? "\nall checks pass" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
