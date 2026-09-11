// Drives the built app: the Companions list under Projects on the dashboard
// (SPEC.md §23). Checks every companion renders, opens in a new tab carrying
// nothing about the reader, and — the one that rots over time — that every
// link still answers. Prints PASS/FAIL.
import { chromium } from "playwright-core";

const URL = "http://localhost:3311/";
const SHOT = process.env.SHOT_DIR ?? ".";

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1300 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && !m.text().includes('unique "key"') && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });

try {
  await run();
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
  await page.screenshot({ path: `${SHOT}/companions-crash.png` }).catch(() => {});
}
check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL") || r.startsWith("CRASH")) ? 1 : 0);

async function run() {
await page.waitForSelector('a[data-track^="companion-"]', { timeout: 15000 });
const rows = await page.$$eval('a[data-track^="companion-"]', (els) =>
  els.map((e) => ({
    id: e.getAttribute("data-track"),
    href: e.getAttribute("href"),
    target: e.getAttribute("target"),
    rel: e.getAttribute("rel"),
    text: e.textContent.trim(),
  })),
);
check("the list renders", rows.length > 0, `${rows.length} companions`);
check("both groups show", (await page.locator("section h2 + p + div > div").count()) === 2);
check(
  "every one opens in a new tab, carrying nothing",
  rows.every((r) => r.target === "_blank" && r.rel === "noopener noreferrer"),
);
check(
  "every one says what it is for",
  rows.every((r) => r.text.length > 20),
);
check(
  "every link is https",
  rows.every((r) => r.href?.startsWith("https://")),
  rows.filter((r) => !r.href?.startsWith("https://")).map((r) => r.href).join(" "),
);
await page.screenshot({ path: `${SHOT}/companions.png`, fullPage: true });

// Link rot: every companion still answers. A companion that stops answering is
// a companion to drop or replace, not one to leave on the dashboard.
const dead = [];
for (const row of rows) {
  try {
    const res = await fetch(row.href, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (unitos qa)" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) dead.push(`${row.href} → ${res.status}`);
  } catch (e) {
    dead.push(`${row.href} → ${String(e).split("\n")[0]}`);
  }
}
check("every link still answers", dead.length === 0, dead.join(" | "));
}
