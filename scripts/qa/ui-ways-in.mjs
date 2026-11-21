// The ways into a blocked site (SPEC.md §15), driven against the built app:
// a pasted article (words → the tidy pass, or rich text → the page parse),
// the bookmarklet's post from another origin (a site of its own on :3500),
// and the dialog's panel when a site turns the add away. Run with the mock
// model on :3399 and the app served with MOONSHOT_API_KEY=mock
// MOONSHOT_BASE_URL=http://localhost:3399/v1 ANTHROPIC_API_KEY=mock
// ANTHROPIC_BASE_URL=http://localhost:3399/v1:
//   BASE=http://localhost:3400 NB=<notebookId> node scripts/qa/ui-ways-in.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = process.env.BASE ?? "http://localhost:3400";
const NB = process.env.NB;
if (!NB) {
  console.error("usage: BASE=http://localhost:3400 NB=<notebookId> node scripts/qa/ui-ways-in.mjs");
  process.exit(2);
}
// The bookmarklet as the app builds it: its source, with the one type
// annotation stripped, loaded as a module.
const bookmarkletModule = join(mkdtempSync(join(tmpdir(), "unitos-bookmarklet-")), "bookmarklet.mjs");
writeFileSync(
  bookmarkletModule,
  readFileSync(new URL("../../src/lib/send-page-bookmarklet.ts", import.meta.url), "utf8").replace("(origin: string): string", "(origin)"),
);
const results = [];
const RUN = Date.now();
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

// A site of its own: an article page, and a door that turns readers away.
const ARTICLE = `<!doctype html><html><head><title>The Rent Is Too High — Daily Ledger</title></head><body>
<nav><a href="/">Home</a> <a href="/subscribe">Subscribe</a> <a href="/login">Sign in</a></nav>
<div class="cookie">We use cookies. Accept all</div>
<article><h1>The Rent Is Too High</h1><p class="byline">By Ada Lovelace · 3 November 2026</p>
<p>Rents in the capital rose eleven percent last year, the fastest climb since records began in 1994. The city's own survey puts the median one-bedroom at 2,300 a month.</p>
<h2>Why now</h2>
<p>Three things moved at once: interest rates, a construction slowdown, and a return of students after two quiet years. None of them is new, but together they bit.</p>
<figure><img src="/chart.png" alt="chart"><figcaption>Median rents by borough, 2020 to 2026</figcaption></figure>
<p>The council's answer is a cap on increases, which landlords say will shrink supply further. Economists on both sides cite Stockholm.</p>
</article>
<aside>Related: Ten flats under 1,500 · Comments (241) · Share on X</aside>
<footer>© Daily Ledger. Newsletter: sign up.</footer></body></html>`;
const site = http.createServer((req, res) => {
  if (req.url.startsWith("/article")) { res.writeHead(200, { "content-type": "text/html" }); res.end(ARTICLE); return; }
  if (req.url.startsWith("/paywalled")) { res.writeHead(403, { "content-type": "text/html" }); res.end("<html><body>Access denied</body></html>"); return; }
  res.writeHead(404); res.end();
}).listen(3500);

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function ingest(body) {
  const res = await page.request.post(`${base}/api/documents`, { data: { notebookId: NB, ...body } });
  const lines = (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  return { status: res.status(), last: lines[lines.length - 1], lines };
}
// The document's blocks as the reader draws them: one data-block-id each.
async function blocksOf(id) {
  const res = await page.request.get(`${base}/n/${NB}?doc=${id}`);
  if (!res.ok()) return null;
  const html = await res.text();
  return html.match(/data-block-id="/g) ?? [];
}
const made = [];

try {
  // 1. Words pasted: the tidy pass (the mock answers JSON) or paragraphs.
  const plain = "Home Subscribe Sign in\nWe use cookies. Accept all\nThe Rent Is Too High\nBy Ada Lovelace · 3 November 2026\nRents in the capital rose eleven percent last\nyear, the fastest climb since records began in 1994.\n\nWhy now\nThree things moved at once: interest rates, a construction slowdown, and a return of students.\n\nRelated: Ten flats under 1,500 · Comments (241)";
  let r = await ingest({ text: plain, title: "The Rent Is Too High", url: `http://localhost:3500/article-1-${RUN}` });
  check("paste words: added", r.status === 200 && r.last.id, JSON.stringify(r.last).slice(0, 120));
  if (r.last.id) made.push(r.last.id);
  const pasteId = r.last.id;

  // 2. Rich text pasted: the page parse, no fetch.
  r = await ingest({ html: ARTICLE, url: `http://localhost:3500/article-2-${RUN}` });
  check("paste rich text: added", r.status === 200 && r.last.id, JSON.stringify(r.last).slice(0, 120));
  check("paste rich text: the page's title", r.last.title === "The Rent Is Too High", r.last.title);
  if (r.last.id) made.push(r.last.id);

  // 3. The same address again asks first (a repeat add).
  r = await ingest({ html: ARTICLE, url: `http://localhost:3500/article-2-${RUN}` });
  check("paste rich text again: asks first", r.status === 409 || (r.last && r.last.duplicate), `${r.status} ${JSON.stringify(r.last).slice(0, 80)}`);

  // 4. A blocked link: the last line carries the code.
  r = await ingest({ url: "http://localhost:3500/paywalled" });
  check("blocked link: code blocked", r.last.code === "blocked", JSON.stringify(r.last).slice(0, 160));

  // 5. The bookmarklet from the site's origin: a form post without the
  //    session cookie lands on /share with the page staged.
  await page.goto(`http://localhost:3500/article-${RUN}`, { waitUntil: "load" });
  const { sendPageBookmarklet } = await import(`file://${bookmarkletModule}`);
  const href = sendPageBookmarklet(base);
  const code = decodeURIComponent(href.replace(/^javascript:/, ""));
  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 15000 }), page.evaluate(code)]);
  await popup.waitForLoadState("networkidle");
  const shareUrl = popup.url();
  check("bookmarklet: lands on /share with the page", /\/share\?u=[a-z0-9-]+&k=page/.test(shareUrl), shareUrl.slice(0, 100));
  check("bookmarklet: the share page names the page", (await popup.textContent("body")).includes("The Rent Is Too High"));
  const addButton = popup.locator("button", { hasText: /^Add$/ }).first();
  if (await addButton.count()) {
    await addButton.click();
    await popup.waitForURL(/\/n\//, { timeout: 60000 }).catch(() => {});
    check("bookmarklet: Add opens the document", /\/n\//.test(popup.url()), popup.url().slice(0, 100));
    const m = popup.url().match(/doc=([a-z0-9]+)/); if (m) made.push(m[1]);
  } else check("bookmarklet: Add button", false, "no Add button");
  await popup.close();

  // 6. The dialog: Paste an article → queue → Continue → the document opens.
  await page.goto(`${base}/n/${NB}`, { waitUntil: "networkidle" });
  await page.click("[data-track-surface='topbar'] [data-track='add-document']");
  await page.click("[data-track='add-paste']");
  await page.fill("[data-track='add-paste-text']", plain);
  await page.fill("[data-track='add-paste-title']", "Pasted from the dialog");
  await page.click("[data-track='add-paste-queue']");
  check("dialog: the paste is queued", (await page.locator("text=Pasted from the dialog").count()) > 0);
  await page.click("[data-track='add-continue']");
  await page.waitForURL(/doc=/, { timeout: 60000 }).catch(() => {});
  check("dialog: the pasted article opens", /doc=/.test(page.url()), page.url().slice(0, 120));
  const m2 = page.url().match(/doc=([a-z0-9]+)/); if (m2) made.push(m2[1]);

  // 7. The dialog: a blocked link opens the ways in.
  await page.goto(`${base}/n/${NB}`, { waitUntil: "networkidle" });
  await page.click("[data-track-surface='topbar'] [data-track='add-document']");
  await page.fill("[data-track='add-url']", "http://localhost:3500/paywalled");
  await page.click("[data-track='add-continue']");
  await page.waitForSelector("[data-track='upload-edit']", { timeout: 60000 });
  await page.click("[data-track='upload-edit']");
  await page.waitForTimeout(500);
  check("dialog: a blocked link opens the ways in", (await page.locator("[data-track='add-send-page-bookmarklet']").count()) > 0);
  check("dialog: the bookmarklet carries the origin", ((await page.locator("[data-track='add-send-page-bookmarklet']").getAttribute("href")) ?? "").includes(encodeURIComponent(`${base}/share/target`)));
  const text = pasteId ? await blocksOf(pasteId) : null;
  if (text) check("paste words: blocks", Array.isArray(text) && text.length > 2, `${text?.length} blocks`);
} catch (e) {
  results.push(`CRASH ${String(e).split("\n")[0]}`);
}
check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(results.join("\n"));
console.log("MADE " + made.join(" "));
site.close();
await browser.close();
