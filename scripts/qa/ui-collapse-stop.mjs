// UI verification for Stop on Collapse (SPEC.md §28): while the cores are
// written the button reads Collapsing… with a Stop pill, and a press stops
// the run — the request and the model call end, nothing is saved, and the
// article stays whole with no toast.
//
// Usage: DATABASE_URL=... NB=<notebook> DOC=<article> CHROME=<chromium>
//   node scripts/qa/ui-collapse-stop.mjs
// Expects the server on :3311 with ANTHROPIC_API_KEY=mock and
// ANTHROPIC_BASE_URL=http://localhost:3401/v1, and scripts/qa/mock-hang.mjs
// running: the Collapse call never answers, so only Stop ends it.
// Screenshots land in SHOT_DIR (default .).
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const { NB, DOC } = process.env;
const PORT = process.env.PORT ?? "3311";
const HANG = process.env.MOCK_HANG_URL ?? "http://localhost:3401";
const SHOT = process.env.SHOT_DIR ?? ".";
const base = `http://localhost:${PORT}`;
const db = new PrismaClient();
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
const status = async () => (await fetch(`${HANG}/status`)).json();

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

try {
  await db.document.update({ where: { id: DOC }, data: { collapse: null } });
  await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
  const button = page.locator('[data-track="collapse"]');
  await button.waitFor({ timeout: 20000 });
  const before = await status();
  await button.click();
  const stop = page.locator('[data-track="collapse-stop"]');
  await stop.waitFor({ timeout: 5000 });
  const label = await stop.innerText();
  check("the running button reads Collapsing… with Stop", /Collapsing/.test(label) && /Stop/.test(label), label.replace(/\s+/g, " "));
  // The route reaches the model, which holds the call open.
  await page.waitForTimeout(2000);
  const during = await status();
  const sent = during.requests - before.requests;
  check("the model call is on its way", sent > 0, `${sent} calls`);
  await page.screenshot({ path: `${SHOT}/collapse-running.png` });
  await stop.click();
  await button.waitFor({ timeout: 5000 });
  check("Stop brings the Collapse button back", (await button.count()) === 1);
  await page.waitForTimeout(2000);
  const after = await status();
  check("Stop ends the model call", after.closed - before.closed >= sent && sent > 0, `${after.closed - before.closed} of ${sent} closed`);
  const row = await db.document.findUnique({ where: { id: DOC }, select: { collapse: true } });
  check("nothing is saved", row?.collapse === null);
  check("the article stays whole", (await page.locator("[data-collapsed]").count()) === 0);
  check("no toast", (await page.getByText("could not be collapsed").count()) === 0);
  await page.screenshot({ path: `${SHOT}/collapse-stopped.png` });
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
}
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
await browser.close();
await db.$disconnect();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);
