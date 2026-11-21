// The Sign in button on the front door (/signin), on a phone, a tablet, and a
// desktop, and on the beta notice that opens first. Sign-in must be on:
//   SESSION_SECRET=x RESEND_API_KEY=x EMAIL_FROM=x@y.z EMAIL_ECHO=1 npm run dev -- --port 3311
//   node scripts/qa/ui-signin-button.mjs [outDir]
import { chromium } from "playwright-core";

const OUT = process.argv[2] ?? "scripts/qa/out";
const BASE = process.env.QA_BASE ?? "http://localhost:3311";
let failed = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
const devices = [
  ["phone", { viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ["tablet", { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
  ["desktop", { viewport: { width: 1440, height: 900 } }],
];

for (const [name, options] of devices) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`, { waitUntil: "networkidle", timeout: 120_000 });

  // The beta notice opens first: it carries a Sign in button beside Continue.
  const notice = page.locator('[role="dialog"]');
  await notice.waitFor({ timeout: 10_000 });
  const inNotice = notice.getByRole("link", { name: "Sign in" });
  check(`${name}: the beta notice has a Sign in button`, (await inNotice.count()) === 1);
  await page.screenshot({ path: `${OUT}/signin-${name}-notice.png` });
  await notice.getByRole("button", { name: "Continue" }).click();
  await notice.waitFor({ state: "detached" });

  // The card: Sign in sits right under Start now, as tall and as wide.
  const start = page.getByRole("button", { name: /Start now/ });
  const signin = page.locator("form[action='/api/auth/email/start']").getByRole("link", { name: "Sign in" });
  check(`${name}: Sign in is on the card`, (await signin.count()) === 1);
  const a = await start.boundingBox();
  const b = await signin.boundingBox();
  check(`${name}: Sign in is right under Start now`, b.y > a.y + a.height && b.y - (a.y + a.height) < 16, `gap ${Math.round(b.y - a.y - a.height)}px`);
  check(`${name}: same width and height`, Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1, `${Math.round(b.width)}x${Math.round(b.height)}`);
  check(`${name}: it is on the screen without scrolling`, b.y + b.height <= options.viewport.height, `bottom ${Math.round(b.y + b.height)} of ${options.viewport.height}`);
  check(`${name}: the page does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: `${OUT}/signin-${name}.png` });

  await signin.click();
  await page.waitForURL(/mode=in/);
  check(`${name}: it opens the email and password form`, (await page.locator("input[type=password]").count()) === 1);
  await context.close();
}

await browser.close();
console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
