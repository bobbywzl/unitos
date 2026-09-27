// B3 round 11 browser check: the citation card (page editor and block
// reader), the contents in the tabs & outlines panel, and the assistant's
// document context naming pages. Run from the repo root as a copy:
//   cp <this> scripts/qa/r11-b3-ui.mjs && node scripts/qa/r11-b3-ui.mjs; rm scripts/qa/r11-b3-ui.mjs
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

if (!process.env.DATABASE_URL && existsSync(".env")) {
  const m = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(".env", "utf8"));
  if (m) process.env.DATABASE_URL = m[1];
}
const BASE = "http://localhost:3111";
const SHOT = process.env.SHOT_DIR ?? "/tmp/r11-b3";
mkdirSync(SHOT, { recursive: true });
const NB = process.env.NB ?? "cmuk5p55q00do7d6lcs7kgxih";
const TABBY = { nb: "cmuhjx1t7000b7d66uw3kak3j", doc: "cmuhkrigy015n7d665d6izvom" };
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const db = new PrismaClient();

let passed = 0;
let failed = 0;
const check = (ok, name, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 90) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);

// A page whose hyperlinks are its references (no reference list).
const LINKS_PORT = 3482;
const run = Date.now();
const linksHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Deltas and Their Dams ${run}</title></head>
<body><article><h1>Deltas and Their Dams ${run}</h1>
<p>Sediment behind dams is the first cause, as <a href="https://www.nature.com/articles/ngeo629">a survey of thirty-three deltas</a> showed. The second is pumping, which lowers the ground faster than the sea rises, and the third is the levees that send the mud to deep water instead of the marsh. Run ${run}.</p>
<h2>Measurements</h2>
<p>The loss is measured from satellites, as <a href="https://www.usgs.gov/centers/wetland-and-aquatic-research-center">the survey's wetland center</a> describes it, and from cores taken across the marsh every season. Each core records the mud a flood left behind.</p>
<p>${"Deltas hold a tenth of the world's people on a sliver of its land. ".repeat(6)}</p>
<h2>What comes next</h2>
<p>${"Rebuilding a delta means letting the river flood again, in places and at times people choose. ".repeat(5)}</p>
<p>${"A river left to itself builds land where it slows. ".repeat(6)}</p>
</article></body></html>`;

async function addUrl(url) {
  const res = await fetch(`${BASE}/api/documents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, notebookId: NB }),
  });
  const lines = (await res.text()).split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return {};
    }
  });
  return lines.findLast((l) => l.id || l.error) ?? null;
}

async function open(page, nb, doc, pageEditor = true) {
  await page.goto(`${BASE}/n/${nb}?doc=${doc}`, { waitUntil: "domcontentloaded" });
  if (pageEditor) {
    await page.waitForFunction(() => document.querySelector(".docs-prose")?.textContent.trim().length > 0, null, { timeout: 120_000 });
    await page.waitForFunction(() => Boolean(window.__docsEditor) && !window.__docsEditor.isDestroyed, null, { timeout: 60_000 });
  } else {
    await page.waitForSelector("article.reader-prose [data-block-id]", { timeout: 120_000 });
  }
  await sleep(1200);
}

/** Hover an element as a person does and read the app's tooltip. */
async function hoverCard(page, selector, index = 0) {
  const el = page.locator(selector).nth(index);
  await el.scrollIntoViewIfNeeded();
  await sleep(400);
  await page.mouse.move(5, 5);
  await sleep(200);
  await el.hover();
  const tip = await page
    .waitForFunction(() => document.getElementById("app-tip")?.textContent || null, null, { timeout: 5000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  const cls = await page.evaluate(() => document.getElementById("app-tip")?.className ?? "");
  return { tip, cls };
}

async function main() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(linksHtml);
  });
  await new Promise((r) => server.listen(LINKS_PORT, r));
  const docs = await db.notebookDocument.findMany({ where: { notebookId: NB }, include: { document: { select: { id: true, title: true, sourceUrl: true, fileHash: true, references: true } } } });
  const paper = docs.find((d) => d.document.title === "Attention Is All You Need")?.document;
  const web = docs.find((d) => d.document.title === "The Quiet Engine of River Deltas")?.document;
  const md = docs.find((d) => d.document.title === "Field Notes on Tidal Marshes")?.document;
  let links = docs.find((d) => d.document.title.startsWith("Deltas and Their Dams"))?.document;
  if (!links) {
    const added = await addUrl(`http://localhost:${LINKS_PORT}/deltas.html?run=${run}`);
    console.log("added the links page:", JSON.stringify(added)?.slice(0, 200));
    links = added?.id ? await db.document.findUnique({ where: { id: added.id }, select: { id: true, title: true, references: true, importRev: true } }) : null;
  }
  console.log("links page:", links?.id, "references:", JSON.stringify(links?.references)?.slice(0, 300));
  server.close();

  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|net::ERR|fonts\.g|youtube|Hydration failed/.test(m.text())) errors.push(m.text().slice(0, 200));
    });

    // 1. The page editor's citation card: the walk's web page (an entry without a link).
    await open(page, NB, web.id);
    const before = await page.evaluate(() => {
      const ed = window.__docsEditor;
      window.__txCount = 0;
      ed.on("transaction", ({ transaction }) => {
        if (transaction.docChanged) window.__txCount++;
      });
      return JSON.stringify(ed.getJSON());
    });
    const webCard = await hoverCard(page, ".docs-prose .docs-citation[data-ref-id]");
    const ref = (web.references ?? [])[0];
    let path = join(SHOT, `citation-card-page-editor-${theme}.png`);
    await page.screenshot({ path });
    check(webCard.tip === ref?.text && /docs-tip/.test(webCard.cls), `(${theme}) the page editor: hover on a citation shows its reference entry`, `"${clip(webCard.tip)}" ${path}`);
    const after = await page.evaluate(() => ({ doc: JSON.stringify(window.__docsEditor.getJSON()), tx: window.__txCount }));
    check(after.doc === before && after.tx === 0, `(${theme}) the hover changes no words`, `doc same ${after.doc === before}, changing transactions ${after.tx}`);
    await page.mouse.move(5, 5);
    await sleep(300);
    const hidden = await page.evaluate(() => !document.getElementById("app-tip"));
    check(hidden, `(${theme}) the card goes when the pointer leaves`);
    // A click in Viewing still opens the entry in the References section.
    await page.locator(".docs-prose .docs-citation[data-ref-id]").first().click();
    const opened = await page
      .waitForFunction((id) => {
        const el = document.getElementById(`reference-${id}`);
        return Boolean(el && el.getBoundingClientRect().height > 0);
      }, ref?.id, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    check(opened, `(${theme}) a click on it still opens its entry in the References section`);

    // 2. An entry with a link: the entry and its site.
    if (links) {
      await open(page, NB, links.id);
      const count = await page.locator(".docs-prose .docs-citation[data-ref-id]").count();
      const linkCard = await hoverCard(page, ".docs-prose .docs-citation[data-ref-id]");
      path = join(SHOT, `citation-card-link-${theme}.png`);
      await page.screenshot({ path });
      check(count > 0 && /\n(nature\.com|usgs\.gov)$/.test(linkCard.tip ?? ""), `(${theme}) the page editor: an entry with a link shows its site under it`, `${count} citations; "${clip(linkCard.tip)}" ${path}`);
    }

    // 3. The block reader's card: the same words.
    await open(page, TABBY.nb, TABBY.doc, false);
    const tabby = await db.document.findUnique({ where: { id: TABBY.doc }, select: { references: true } });
    const tabbyRef = await page.locator("article.reader-prose .citation-mark").first().getAttribute("href");
    const blockCard = await hoverCard(page, "article.reader-prose .citation-mark");
    const entry = (tabby.references ?? []).find((r) => `#reference-${r.id}` === tabbyRef);
    path = join(SHOT, `citation-card-block-reader-${theme}.png`);
    await page.screenshot({ path });
    const host = entry?.url ? new URL(entry.url).hostname.replace(/^www\./, "") : "";
    check(Boolean(entry) && blockCard.tip === (host && !entry.text.includes(host) ? `${entry.text}\n${host}` : entry.text), `(${theme}) the block reader: the same card, its entry and its site`, `"${clip(blockCard.tip, 120)}" ${path}`);

    // 4. The contents in the tabs & outlines panel: the paper's stored parts.
    await open(page, NB, paper.id);
    if (!(await page.locator("nav.docs-outline").count())) await page.click(".docs-outline-open");
    const section = page.locator('nav.docs-outline section[aria-label="Contents"]');
    await section.locator(".docs-outline-item").first().waitFor({ timeout: 120_000 });
    const stored = await db.document.findUnique({ where: { id: paper.id }, select: { contents: true } });
    const listed = await section.locator(".docs-outline-item").allTextContents();
    await section.scrollIntoViewIfNeeded();
    path = join(SHOT, `contents-panel-${theme}.png`);
    await page.screenshot({ path });
    check(listed.length > 0 && listed.length === stored.contents.length && listed[0] === stored.contents[0].title, `(${theme}) the panel lists the paper's stored parts under the headings`, `${listed.length} of ${stored.contents.length}: ${listed.slice(0, 4).join(" | ")} ${path}`);
    const target = stored.contents[Math.min(5, stored.contents.length - 1)];
    await section.locator(".docs-outline-item").nth(Math.min(5, stored.contents.length - 1)).click();
    const jumped = await page
      .waitForFunction((id) => {
        const el = document.querySelector(`.docs-prose [data-block-id="${id}"]`);
        const header = document.querySelector(".docs-canvas")?.getBoundingClientRect().top ?? 0;
        if (!el) return null;
        const top = el.getBoundingClientRect().top;
        return el.classList.contains("anchor-flash") && top >= header - 4 && top < header + 160 ? Math.round(top - header) : null;
      }, target.blockId, { timeout: 5000 })
      .then((h) => h.jsonValue())
      .catch(() => null);
    const current = await section.locator(".docs-outline-current").allTextContents();
    path = join(SHOT, `contents-jump-${theme}.png`);
    await page.screenshot({ path });
    check(jumped !== null && current.includes(target.title), `(${theme}) a press on a part scrolls its start to the top and flashes it`, `"${target.title}" ${jumped}px under the canvas top; current "${current.join("")}" ${path}`);

    // 5. With none stored: the ask, Generate contents, and the parts.
    await db.$executeRawUnsafe(`UPDATE "Document" SET contents = NULL WHERE id = $1`, md.id);
    await open(page, NB, md.id);
    if (!(await page.locator("nav.docs-outline").count())) await page.click(".docs-outline-open");
    const mdSection = page.locator('nav.docs-outline section[aria-label="Contents"]');
    const button = mdSection.locator('[data-track="contents-generate"]');
    await button.waitFor({ timeout: 120_000 });
    path = join(SHOT, `contents-ask-${theme}.png`);
    await page.screenshot({ path });
    const ask = await mdSection.textContent();
    check(/Generate the contents\?/.test(ask ?? ""), `(${theme}) with none stored, the panel asks and offers Generate contents`, `"${clip(ask, 140)}" ${path}`);
    await button.click();
    await mdSection.locator(".docs-outline-item").first().waitFor({ timeout: 180_000 });
    const made = await mdSection.locator(".docs-outline-item").allTextContents();
    const storedMd = await db.document.findUnique({ where: { id: md.id }, select: { contents: true } });
    path = join(SHOT, `contents-generated-${theme}.png`);
    await page.screenshot({ path });
    check(made.length > 0 && made.length === (storedMd.contents ?? []).length, `(${theme}) Generate contents writes the parts and the panel lists them`, `${made.join(" | ")} ${path}`);

    check(errors.length === 0, `(${theme}) no page errors`, errors.slice(0, 3).join(" · "));
    await context.close();
  }
  await browser.close();

  // 6. The assistant (the mock) on the paper: its document context names pages.
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notebookId: NB, scope: "document", documentId: paper.id, task: "ask", question: "On which page is Table 3?" }),
  });
  const body = await res.text();
  const digest = await db.notebookDigest.findUnique({ where: { notebookId: NB } });
  const docPart = digest?.parts?.documents?.find((d) => d.id === paper.id);
  const lines = (docPart?.text ?? "").split("\n").filter((l) => l.startsWith("[block "));
  const paged = lines.filter((l) => / p\. [^)]+\)$/.test(l));
  check(res.ok && lines.length > 0 && paged.length === lines.length, "the assistant's context for the paper names each row's page", `HTTP ${res.status}; ${paged.length} of ${lines.length} lines; e.g. ${lines[1]} · ${lines.find((l) => l.includes("table ")) ?? ""}; answer ${clip(body, 80)}`);
  const webPart = digest?.parts?.documents?.find((d) => d.id === web.id);
  const webLines = (webPart?.text ?? "").split("\n").filter((l) => l.startsWith("[block "));
  check(webLines.length > 0 && webLines.every((l) => !/ p\. /.test(l)), "a web page's lines name no pages", `${webLines.length} lines, e.g. ${webLines[1]}`);

  await db.$disconnect();
  console.log(`${passed} passed, ${failed} failed`);
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
