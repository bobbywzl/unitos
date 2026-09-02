// Click telemetry check (SPEC.md §7): drive the reader in headless Chromium,
// check that clicks on the marked controls post to /api/clicks with the right
// surface, then screenshot the admin clicks page in both themes and both
// languages. Run against a local app on port 3311 with ADMIN_PASSWORD=admin:
//   node scripts/qa/ui-clicks.mjs <notebookId> <documentId>
// The ids come from scripts/qa/seed.mjs. Screenshots land in .qa/.
import { chromium } from "playwright-core";
import { mkdirSync, readdirSync } from "node:fs";

const [NB, DOC] = process.argv.slice(2);
if (!NB || !DOC) {
  console.error("usage: node scripts/qa/ui-clicks.mjs <notebookId> <documentId>");
  process.exit(2);
}
const base = "http://localhost:3311";
const out = ".qa";
mkdirSync(out, { recursive: true });
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
const dir = readdirSync(browsers).find((d) => d.startsWith("chromium-"));
const browser = await chromium.launch({ executablePath: `${browsers}/${dir}/chrome-linux/chrome` });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

const posts = [];
page.on("request", (r) => {
  if (r.url().endsWith("/api/clicks") && r.method() === "POST") posts.push(JSON.parse(r.postData() ?? "{}"));
});
const statuses = [];
page.on("response", (r) => {
  if (r.url().endsWith("/api/clicks")) statuses.push(r.status());
});
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
const click = async (selector) => {
  await page.click(selector, { timeout: 5000 });
  await page.waitForTimeout(150);
};

await page.goto(`${base}/n/${NB}?doc=${DOC}`, { waitUntil: "networkidle" });
check("workspace renders", (await page.locator("[data-track-surface='sidebar']").count()) === 1);

// Sidebar.
await click("[data-track-surface='sidebar'] [data-track='distill']");
await click("[data-track-surface='sidebar'] [data-track='annotations']");
await click("[data-track-surface='sidebar'] [data-track='edits']");
await click("[data-track-surface='sidebar'] [data-track='notes']");
await click("[data-track-surface='sidebar'] [data-track='graph']");
await click("[data-track='graph-close']");

// Top bar.
await click("[data-track-surface='topbar'] [data-track='guide']");
await click("[data-track='guide-close']");
await click("[data-track-surface='topbar'] [data-track='history']");
await page.keyboard.press("Escape");
await click("[data-track-surface='topbar'] [data-track='add-document']");
await click("[data-track='add-dialog-close']");
await click("[data-track-surface='topbar'] [data-track='document-list']");
await page.keyboard.press("Escape");

// Article menu.
await click("[data-track-surface='article-menu'] [data-track='search']");
await page.keyboard.press("Escape");

// AI toolbar: select text in a paragraph, then use the popover.
await page.evaluate(() => {
  const blocks = document.querySelectorAll("[data-block-id]");
  const p = blocks[1];
  const textNode = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, Math.min(30, textNode.textContent.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});
await page.locator("[data-block-id] >> nth=1").dispatchEvent("mouseup");
await page.waitForTimeout(400);
const popover = await page.locator("[data-track-surface='ai-toolbar']").count();
check("popover appears on selection", popover > 0, String(popover));
await click("[data-track-surface='ai-toolbar'] [data-track='comment']");
await click("[data-track-surface='ai-toolbar'] [data-track='comment']");
await click("[data-track-surface='ai-toolbar'] [data-track='highlight'] >> nth=0");
await page.waitForTimeout(500);

// Reader: the Distill button at the top right, then close the distilled page.
await click("[data-track-surface='reader'] div.sticky [data-track='distill']");
await click("[data-track='distill-page-close']");

// The batch flushes 4 seconds after the first click.
await page.waitForTimeout(5000);
const sent = posts.flatMap((p) => p.clicks ?? []);
check("clicks posted", sent.length > 0, `${posts.length} post(s), ${sent.length} clicks, statuses ${statuses.join(",")}`);
check("every post accepted", statuses.length > 0 && statuses.every((s) => s === 201), statuses.join(","));
const has = (surface, control) => sent.some((c) => c.surface === surface && c.control === control);
check("sidebar distill recorded", has("sidebar", "distill"));
check("sidebar graph recorded", has("sidebar", "graph"));
check("graph close recorded as sidebar", has("sidebar", "graph-close"));
check("topbar guide recorded", has("topbar", "guide"));
check("guide close recorded as topbar", has("topbar", "guide-close"));
check("topbar history recorded", has("topbar", "history"));
check("topbar add-document recorded", has("topbar", "add-document"));
check("add dialog close recorded as topbar", has("topbar", "add-dialog-close"));
check("article-menu search recorded", has("article-menu", "search"));
check("ai-toolbar comment recorded", has("ai-toolbar", "comment"));
check("ai-toolbar highlight recorded", has("ai-toolbar", "highlight"));
check("reader distill recorded", has("reader", "distill"));
check("reader distill-page-close recorded", has("reader", "distill-page-close"));
check("notebookId rides along", sent.every((c) => c.notebookId === NB));
console.log("sent:", sent.map((c) => `${c.surface}/${c.control}`).join(" "));

// Page hide flush: a click, then leaving the page, posts with keepalive.
const before = posts.length;
await click("[data-track-surface='sidebar'] [data-track='notes']");
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
check("page hide flushes the batch", posts.length > before, `${posts.length - before} post(s)`);

// Admin: sign in, then the clicks page in both themes and both languages.
await page.goto(`${base}/admin/login`, { waitUntil: "networkidle" });
await page.fill("input[type=password]", process.env.ADMIN_PASSWORD ?? "admin");
await page.click("button[type=submit]");
await page.waitForURL(`${base}/admin`, { timeout: 15000 });
await page.goto(`${base}/admin/clicks`, { waitUntil: "networkidle" });
check("admin clicks page renders", (await page.locator("main.click-charts").count()) === 1);
check("admin clicks tab in nav", (await page.locator("nav a[href='/admin/clicks']").count()) === 1);
const rows = await page.locator("table >> nth=0 >> tbody tr").count();
check("control table has rows", rows > 0, `${rows} rows`);
const segments = await page.locator("svg path").count();
check("daily chart has segments", segments > 0, `${segments} segments`);
await page.screenshot({ path: `${out}/admin-clicks-light.png`, fullPage: true });
await page.evaluate(() => document.documentElement.classList.add("dark"));
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/admin-clicks-dark.png`, fullPage: true });
await context.addCookies([{ name: "dissect-lang", value: "zh", url: base }]);
await page.goto(`${base}/admin/clicks`, { waitUntil: "networkidle" });
check("zh admin clicks page renders", (await page.locator("text=按区域的点击").count()) > 0);
await page.screenshot({ path: `${out}/admin-clicks-zh.png`, fullPage: true });

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(results.join("\n"));
await browser.close();
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
