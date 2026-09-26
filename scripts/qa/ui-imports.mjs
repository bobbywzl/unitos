// UI walk of the imports' risks (the imports design 1.11 and section 5; the
// round 10 plan): a PDF, a web page, and a Markdown file added to a local
// Unitos with the switch on (IMPORT_PAGE_EDITOR=on) open in the page editor,
// and every risk is walked in headless Chromium at a person's pace, in the
// light and the dark theme. R4 and R19 are out (C1: a table is a row per
// cell paragraph). Each check prints PASS or FAIL with its evidence: a
// number, a screenshot path. The timings for the size guard (1.8) print as
// TIME lines.
//
// Usage:
//   node scripts/qa/ui-imports.mjs [R1 R3 …] [--theme light|dark|both] [--keep]
// With no risk named, every risk runs. Env: BASE (default
// http://localhost:3111), SHOT_DIR (screenshots; default <tmp>/ui-imports),
// CHROME (default /opt/pw-browsers/chromium), FIXTURE_PORT (default 3490),
// DATABASE_URL (read from .env when unset), ATTENTION (the Attention paper's
// PDF: a path or a URL; default https://arxiv.org/pdf/1706.03762),
// LONG_PAGES (the long PDF's page count; default 150).
// Expects the dev server with IMPORT_PAGE_EDITOR=on, sign-in off, and the
// model mock (scripts/qa/mock-kimi.mjs on :3399). The fixtures are made
// here: a web page, its chart, its images, and a looping video served on
// FIXTURE_PORT (the server fetches localhost directly), a Markdown file, and
// the long PDF printed by Chromium. Every document is added fresh (the
// bytes carry the run's stamp), so dedupe never hands back an older import.
// --keep keeps the run's project; by default it is deleted at the end.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";
import { getDocumentProxy } from "unpdf";

// ── Configuration ───────────────────────────────────────────────────────────

const ROOT = process.cwd();
if (!process.env.DATABASE_URL && existsSync(join(ROOT, ".env"))) {
  const m = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(join(ROOT, ".env"), "utf8"));
  if (m) process.env.DATABASE_URL = m[1];
}
const BASE = process.env.BASE ?? "http://localhost:3111";
const SHOT = process.env.SHOT_DIR ?? join(tmpdir(), "ui-imports");
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium";
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 3490);
const FIXTURE = `http://localhost:${FIXTURE_PORT}`;
const ATTENTION = process.env.ATTENTION ?? "https://arxiv.org/pdf/1706.03762";
const LONG_PAGES = Number(process.env.LONG_PAGES ?? 150);
const args = process.argv.slice(2);
const themeArg = args.includes("--theme") ? args[args.indexOf("--theme") + 1] : "both";
const THEMES = themeArg === "both" ? ["light", "dark"] : [themeArg];
const KEEP = args.includes("--keep");
const ONLY = new Set(args.filter((a, i) => /^R\d+$|^C2$|^AUDIT$|^AI$/.test(a) && args[i - 1] !== "--theme"));
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
mkdirSync(SHOT, { recursive: true });

const db = new PrismaClient();
const results = [];
function record(level, risk, name, detail = "") {
  const line = `${level} ${risk} ${name}${detail ? ` — ${detail}` : ""}`;
  results.push({ level, risk, name, detail, line });
  console.log(line);
}
const pass = (risk, name, detail) => record("PASS", risk, name, detail);
const fail = (risk, name, detail) => record("FAIL", risk, name, detail);
const note = (risk, name, detail) => record("NOTE", risk, name, detail);
const time = (risk, name, detail) => record("TIME", risk, name, detail);
const check = (risk, ok, name, detail) => (ok ? pass : fail)(risk, name, detail);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// ── The app's API and database ──────────────────────────────────────────────

async function api(path, method = "GET", body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text), bytes: text.length };
  } catch {
    return { status: res.status, body: text, bytes: text.length };
  }
}

/** Add a document (SPEC.md §15): a URL, or a file's bytes. The route answers
    NDJSON progress lines, then the result line. */
async function add(notebookId, what) {
  const t0 = Date.now();
  let res;
  if (what.url) {
    res = await fetch(`${BASE}/api/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: what.url, notebookId }),
    });
  } else {
    const form = new FormData();
    form.set("notebookId", notebookId);
    form.set("file", new File([what.bytes], what.name, { type: what.type ?? "application/octet-stream" }));
    res = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  }
  const text = await res.text();
  const lines = text.split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { raw: l };
    }
  });
  const result = lines.findLast((l) => l.id || l.error) ?? { error: `HTTP ${res.status}: ${clip(text, 200)}` };
  const save = lines.find((l) => l.stage === "save");
  let saveDetail = null;
  try {
    saveDetail = save?.detail ? JSON.parse(save.detail) : null;
  } catch {
    saveDetail = save?.detail ?? null;
  }
  return { ...result, ms: Date.now() - t0, stages: lines.filter((l) => l.stage).map((l) => l.stage), saveDetail };
}

async function documentRow(id) {
  return db.document.findUnique({
    where: { id },
    select: { id: true, title: true, richText: true, richTextRev: true, importRev: true, pageSetup: true, pageLabels: true, sourceUrl: true, fileHash: true, handwritten: true, contents: true },
  });
}

/** The paragraph index as stored, each row with a hash of every field. */
async function rowsOf(documentId) {
  const rows = await db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, type: true, text: true, html: true, styles: true, links: true, citations: true, page: true, region: true, mediaId: true, cell: true },
  });
  return rows.map((r) => ({ ...r, hash: createHash("sha1").update(JSON.stringify(r)).digest("hex").slice(0, 12) }));
}

async function editsSince(documentId, since) {
  return db.blockEdit.findMany({ where: { documentId, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, select: { kind: true, blockId: true, before: true, after: true } });
}

async function sourcesOf(documentId) {
  return db.source.findMany({
    where: { documentId },
    orderBy: { note: { createdAt: "asc" } },
    select: { id: true, blockId: true, startOffset: true, endOffset: true, quotedText: true, anchoredText: true, orphaned: true, note: { select: { id: true, derivationType: true, status: true, content: true, color: true, sectionId: true } } },
  });
}

/** The words of a stored row between two offsets. */
async function rowText(blockId) {
  return (await db.block.findUnique({ where: { id: blockId }, select: { text: true, type: true } })) ?? { text: "", type: "" };
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = (
  "river delta sediment channel tide flood plain marsh salt water current basin estuary levee shore coast wave storm season " +
  "measure record survey model estimate sample station gauge flow rate volume load depth width length slope bed bank grain " +
  "the a of and to in that is was for on with as by at from this which these their its over under between during after before " +
  "each every most many few more less higher lower stronger weaker faster slower early late new old wide narrow deep shallow " +
  "shows suggests finds reports compares explains predicts follows returns changes remains holds moves builds erodes carries"
).split(" ");
function sentence(rand, n) {
  const w = Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return `${w.join(" ")}.`;
}
function paragraph(rand, sentences = 5) {
  return Array.from({ length: sentences }, () => sentence(rand, 12 + Math.floor(rand() * 10))).join(" ");
}

/** The web page every web check reads: a kicker, a title, a byline, a
    lede with a citation, headings, a wide SVG chart, a short-captioned
    figure the body names ("Figure 3"), a row of two images, a YouTube embed,
    a looping video, a table with merged cells, lists, a quote, code, a line,
    an equation, and a reference list. */
function articleHtml(run) {
  const rand = rng(7);
  const points = Array.from({ length: 60 }, (_, i) => `${40 + i * 22},${250 - Math.round(80 + 70 * Math.sin(i / 6) + rand() * 30)}`).join(" ");
  const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="300" viewBox="0 0 1400 300" role="img" aria-label="Sediment load chart">
<rect x="0" y="0" width="1400" height="300" fill="none"/>
<line x1="40" y1="260" x2="1360" y2="260" stroke="#333" stroke-width="1"/><line x1="40" y1="20" x2="40" y2="260" stroke="#333" stroke-width="1"/>
<polyline points="${points}" fill="none" stroke="#1f3a5f" stroke-width="3"/>
<text x="44" y="280" font-size="14" fill="#333">2015</text><text x="1320" y="280" font-size="14" fill="#333">2024</text>
<text x="48" y="36" font-size="14" fill="#333">Million tonnes</text></svg>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Quiet Engine of River Deltas</title>
<meta property="og:title" content="The Quiet Engine of River Deltas">
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;font-size:18px;line-height:1.6}
.kicker{font:600 12px/1.4 Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:#a33}
.byline{font:13px Arial,sans-serif;color:#666}figure{margin:28px 0}figcaption{font:13px Arial,sans-serif;color:#555}
.row{display:flex;gap:12px}.row img{width:50%}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}</style></head>
<body><article>
<p class="kicker">SCIENCE</p>
<h1>The Quiet Engine of River Deltas</h1>
<p class="byline">By Ada Writer · May 1, 2025 · run ${run}</p>
<p>River deltas hold a tenth of the world's people on a sliver of its land, and they are sinking faster than the sea is rising. A new survey of forty deltas<sup><a href="#ref1">[1]</a></sup> finds that the sediment which once rebuilt them now stops behind dams, and that the loss is measurable from one flood season to the next.</p>
<h2>Where the sediment goes</h2>
<p>${paragraph(rand)}</p>
<figure><div class="chart">${chart}</div><figcaption>Figure 1. Sediment load reaching the coast, 2015–2024.</figcaption></figure>
<p>${paragraph(rand)} As Figure 3 shows, the loss is steepest where the channels were straightened.</p>
<figure><img src="${FIXTURE}/delta.png?run=${run}" alt="A delta seen from above" width="640" height="360"><figcaption>Figure 3</figcaption></figure>
<p>${paragraph(rand)}</p>
<figure class="row"><img src="${FIXTURE}/left.png?run=${run}" alt="The delta in 2015" width="320" height="180"><img src="${FIXTURE}/right.png?run=${run}" alt="The delta in 2024" width="320" height="180"><figcaption>Figure 4. The same reach in 2015 and in 2024.</figcaption></figure>
<h2>The measurements</h2>
<table><thead><tr><th rowspan="2">Delta</th><th colspan="2">Sediment (Mt a year)</th></tr><tr><th>1990</th><th>2020</th></tr></thead>
<tbody><tr><td>Nile</td><td>120</td><td>12</td></tr><tr><td>Mekong</td><td>160</td><td>75</td></tr><tr><td><p>Mississippi</p><p>and Atchafalaya</p></td><td>400</td><td>145</td></tr></tbody></table>
<p>${paragraph(rand)}</p>
<ul><li>Dams hold back most of the load.</li><li>Levees send what is left to deep water.<ul><li>The marsh gets none of it.</li></ul></li><li>Pumping lowers the ground.</li></ul>
<ol start="3"><li>Third, the sea rises.</li><li>Fourth, storms come more often.</li></ol>
<blockquote><p>A delta is a machine that runs on mud, and we have cut its fuel line.</p></blockquote>
<figure><iframe width="560" height="315" src="https://www.youtube.com/embed/aqz-KE-bpKQ" title="A delta from above" allowfullscreen></iframe><figcaption>Video 1. A delta from above.</figcaption></figure>
<p>${paragraph(rand)}</p>
<figure><video autoplay loop muted playsinline width="480" height="270" src="${FIXTURE}/loop.webm?run=${run}"></video><figcaption>Figure 5. The tide, looped.</figcaption></figure>
<pre><code>load = discharge * concentration
total = sum(load for day in season)</code></pre>
<hr>
<h2>What comes next</h2>
<p>${paragraph(rand)}</p>
<p>${paragraph(rand)}</p>
<h2>References</h2>
<ol><li id="ref1">Syvitski, J. et al. Sinking deltas due to human activities. Nature Geoscience 2, 681–686 (2009).</li></ol>
</article></body></html>`;
}

/** The Markdown file: front matter and a first heading that repeat the title (R10). */
function markdownFile(run) {
  return `---
title: Field Notes on Tidal Marshes
---

# Field Notes on Tidal Marshes

The marsh rises with the tide it traps. Run ${run}. This file checks that the title stands once, and that lists, a table, code, and an equation come through.

## Observations

- Cordgrass grows in the low marsh.
- Salt hay grows higher up.
  - It floods only at spring tides.
- Mudflats edge the channels.

3. Third, the creeks meander.
4. Fourth, the banks slump.

| Station | Elevation (cm) | Change |
|---------|---------------:|--------|
| North   | 42             | +3     |
| South   | 37             | -1     |

\`\`\`
accretion = sediment / area
\`\`\`

$$
E = \\frac{m}{A}
$$

> A marsh keeps pace with the sea only while the mud keeps coming.

---

${paragraph(rng(11), 6)}

${paragraph(rng(12), 6)}
`;
}

/** Media for the web page, drawn in the browser: PNG pictures and a looping
    WebM video recorded from a canvas. */
async function drawMedia(browser) {
  const page = await browser.newPage();
  await page.setContent("<canvas id=c></canvas>");
  const png = async (w, h, hue, label) =>
    Buffer.from(
      await page.evaluate(
        ({ w, h, hue, label }) => {
          const c = document.getElementById("c");
          c.width = w;
          c.height = h;
          const g = c.getContext("2d");
          const grad = g.createLinearGradient(0, 0, w, h);
          grad.addColorStop(0, `hsl(${hue},55%,40%)`);
          grad.addColorStop(1, `hsl(${hue + 40},60%,70%)`);
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.fillStyle = "#fff";
          g.font = `${Math.round(h / 8)}px sans-serif`;
          g.fillText(label, 20, h / 2);
          return c.toDataURL("image/png").split(",")[1];
        },
        { w, h, hue, label },
      ),
      "base64",
    );
  const media = {
    "/delta.png": { type: "image/png", body: await png(1280, 720, 190, "Delta") },
    "/left.png": { type: "image/png", body: await png(640, 360, 30, "2015") },
    "/right.png": { type: "image/png", body: await png(640, 360, 90, "2024") },
  };
  const webm = await page.evaluate(async () => {
    const c = document.getElementById("c");
    c.width = 320;
    c.height = 180;
    const g = c.getContext("2d");
    const stream = c.captureStream(25);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = "#0b3954";
        g.fillRect(0, 0, 320, 180);
        g.fillStyle = "#bfd7ea";
        g.beginPath();
        g.arc(160 + 110 * Math.sin(t * 3), 90, 24, 0, Math.PI * 2);
        g.fill();
        if (t < 1.6) requestAnimationFrame(frame);
        else resolve();
      };
      frame();
    });
    rec.stop();
    await done;
    const buf = await new Blob(chunks, { type: "video/webm" }).arrayBuffer();
    let s = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  });
  media["/loop.webm"] = { type: "video/webm", body: Buffer.from(webm, "base64") };
  await page.close();
  return media;
}

/** A long article PDF printed by Chromium: headings, paragraphs that run
    across pages, lists, tables, and figures, about `pages` pages. */
async function longPdf(browser, pages, run) {
  const page = await browser.newPage();
  const make = async (sections) => {
    const rand = rng(99);
    const img = (hue) =>
      `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200"><rect width="480" height="200" fill="hsl(${hue},50%,60%)"/><circle cx="${100 + hue}" cy="100" r="60" fill="#fff"/></svg>`).toString("base64")}`;
    let body = `<h1 style="font-size:24pt">A Long Survey of Delta Sediment (${run})</h1><p><i>${paragraph(rand, 4)}</i></p>`;
    for (let s = 1; s <= sections; s++) {
      body += `<h2>${s} ${sentence(rand, 4).replace(/\.$/, "")}</h2>`;
      for (let p = 0; p < 4; p++) body += `<p>${paragraph(rand, 5 + Math.floor(rand() * 3))}</p>`;
      if (s % 3 === 0) body += `<ul>${Array.from({ length: 4 }, () => `<li>${sentence(rand, 9)}</li>`).join("")}</ul>`;
      if (s % 7 === 0) body += `<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Station</th><th>Load</th><th>Change</th></tr>${Array.from({ length: 4 }, (_, i) => `<tr><td>S${s}-${i}</td><td>${(rand() * 100).toFixed(1)}</td><td>${(rand() * 10 - 5).toFixed(1)}</td></tr>`).join("")}</table>`;
      if (s % 5 === 0) body += `<figure style="margin:12pt 0"><img src="${img((s * 37) % 360)}" width="360"><figcaption>Figure ${s / 5}: ${sentence(rand, 8)}</figcaption></figure>`;
    }
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><title>Long survey</title><style>body{font:11pt/1.35 "Times New Roman",serif}h2{font-size:14pt;margin:14pt 0 6pt}p{margin:0 0 8pt;text-align:justify}</style></head><body>${body}</body></html>`);
    return Buffer.from(await page.pdf({ format: "Letter", margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" } }));
  };
  let sections = Math.round(pages * 0.62);
  let pdf = await make(sections);
  let count = (await getDocumentProxy(new Uint8Array(pdf))).numPages;
  if (Math.abs(count - pages) > 3) {
    sections = Math.max(1, Math.round((sections * pages) / count));
    pdf = await make(sections);
    count = (await getDocumentProxy(new Uint8Array(pdf))).numPages;
  }
  await page.close();
  return { bytes: pdf, pages: count };
}

/** A PDF's bytes with the run's stamp after its end: a fresh file hash, the
    same pages. */
function stamped(bytes, tag) {
  return Buffer.concat([Buffer.from(bytes), Buffer.from(`\n% unitos qa ${tag}\n`)]);
}

async function attentionBytes() {
  if (!/^https?:/.test(ATTENTION)) return readFileSync(ATTENTION);
  const res = await fetch(ATTENTION);
  if (!res.ok) throw new Error(`the Attention paper: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function serveFixtures(files) {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", FIXTURE).pathname;
    const file = files[path];
    if (!file) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": file.type, "cache-control": "no-store", "access-control-allow-origin": "*" });
    res.end(file.body);
  });
  return new Promise((resolve) => server.listen(FIXTURE_PORT, () => resolve(server)));
}

// ── The browser ─────────────────────────────────────────────────────────────

let browser;
async function newPage(theme = "light", { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  const ignorable = (t) => /ERR_CERT|fonts\.g|Failed to load resource|youtube|ERR_TUNNEL|ERR_PROXY|net::ERR/.test(t);
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !ignorable(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  const responses = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(BASE)) responses.push({ url: u.replace(BASE, ""), status: r.status(), method: r.request().method() });
  });
  return { context, page, errors, responses };
}

async function shot(page, name) {
  const path = join(SHOT, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Open a document in the reader; the page editor stands when its editor
    is on window (development builds). Times from the start of the
    navigation to the first words, and to the editor. */
async function open(page, notebookId, documentId, { wait = true } = {}) {
  const t0 = Date.now();
  await page.goto(`${BASE}/n/${notebookId}?doc=${documentId}`, { waitUntil: "domcontentloaded" });
  if (!wait) return {};
  await page.waitForFunction(() => {
    const prose = document.querySelector(".docs-prose");
    return prose && prose.textContent.trim().length > 0;
  }, null, { timeout: 120_000 });
  const text = Date.now() - t0;
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(700);
  return { text, ready: Date.now() - t0 };
}

async function isPageEditor(page) {
  return page.evaluate(() => Boolean(document.querySelector(".docs-prose")) && !document.querySelector("article.reader-prose [data-block-id]:not(.docs-prose *)"));
}

async function mode(page) {
  return page.evaluate(() => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") ?? null);
}
async function setMode(page, to) {
  await page.click('[data-track="docs:mode"]');
  await sleep(250);
  const item = page.locator(`[data-track="docs:mode:${to}"]`);
  const disabled = await item.evaluate((el) => el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled")).catch(() => null);
  if (disabled) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.click();
  await sleep(400);
  return true;
}

async function waitSaved(page, timeout = 30_000) {
  await sleep(300);
  await page.waitForFunction(() => {
    const el = document.querySelector(".docs-status");
    return el && el.classList.contains("docs-status-saved");
  }, null, { timeout });
}

/** Every text position of a needle in the editor's document. */
async function find(page, needle, nth = 0) {
  return page.evaluate(
    ({ needle, nth }) => {
      const ed = window.__docsEditor;
      const hits = [];
      ed.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        // The words of the block with its atoms as zero-width places.
        let text = "";
        const map = [];
        node.forEach((child, offset) => {
          if (child.isText) {
            for (let i = 0; i < child.text.length; i++) map.push(pos + 1 + offset + i);
            text += child.text;
          }
        });
        let i = text.indexOf(needle);
        while (i >= 0) {
          hits.push({ from: map[i], to: map[i + needle.length - 1] + 1 });
          i = text.indexOf(needle, i + 1);
        }
        return false;
      });
      return hits[nth] ?? null;
    },
    { needle, nth },
  );
}
async function coords(page, pos) {
  return page.evaluate((p) => {
    const c = window.__docsEditor.view.coordsAtPos(p);
    return { x: c.left, y: (c.top + c.bottom) / 2, top: c.top, bottom: c.bottom };
  }, pos);
}
async function reveal(page, pos) {
  let c = await coords(page, pos);
  const vh = await page.evaluate(() => innerHeight);
  if (c.y < 200 || c.y > vh - 100) {
    await page.evaluate((p) => {
      const dom = window.__docsEditor.view.domAtPos(p);
      const el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
      el.scrollIntoView({ block: "center" });
    }, pos);
    await sleep(500);
    c = await coords(page, pos);
  }
  return c;
}
async function clickAt(page, x, y) {
  await page.mouse.move(x - 20, y - 8);
  await page.mouse.move(x, y, { steps: 6 });
  await sleep(80);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  await sleep(250);
}
async function clickPos(page, pos) {
  const c = await reveal(page, pos);
  await clickAt(page, c.x + 0.5, c.y);
}
/** Select with the mouse, like a person: press at `from`, drag to `to`. */
async function dragSelect(page, from, to) {
  const a = await reveal(page, from);
  const b = await coords(page, to);
  await page.mouse.move(a.x - 20, a.y - 10);
  await page.mouse.move(a.x + 0.5, a.y, { steps: 6 });
  await sleep(90);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 8 });
  await page.mouse.move(b.x - 0.5, b.y, { steps: 8 });
  await sleep(80);
  await page.mouse.up();
  await sleep(600);
}
async function selectWords(page, needle, nth = 0) {
  const r = await find(page, needle, nth);
  if (!r) throw new Error(`not in the page: "${needle}"`);
  await dragSelect(page, r.from, r.to);
  return r;
}
async function popoverOpen(page) {
  return page.locator("[data-selection-popover]").first().isVisible().catch(() => false);
}
async function tool(page, track) {
  const el = page.locator(`[data-selection-popover] [data-track="${track}"]`).first();
  await el.waitFor({ state: "visible", timeout: 8000 });
  await el.click();
  await sleep(500);
}

/** The editor's page starts, in order: an inline atom or a block's attribute. */
async function pageStarts(page) {
  return page.evaluate(() => {
    const out = [];
    const ed = window.__docsEditor;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === "pageStart") {
        const $p = ed.state.doc.resolve(pos);
        const block = $p.parent;
        let before = "";
        let after = "";
        let seen = false;
        block.forEach((child, offset) => {
          const t = child.isText ? child.text : "";
          if ($p.parentOffset === offset) seen = true;
          else if (seen) after += t;
          else before += t;
        });
        out.push({ pos, page: node.attrs.page, on: block.type.name, blockId: block.attrs.blockId ?? null, before: before.slice(-40), after: after.slice(0, 40) });
      } else if (typeof node.attrs?.pageStart === "number") {
        out.push({ pos, page: node.attrs.pageStart, on: node.type.name, blockId: node.attrs.blockId ?? null, before: "", after: node.textContent.slice(0, 40) });
      }
      return true;
    });
    return out;
  });
}
/** The drawn label of a page start ("p. 7"), from its element's ::before or text. */
async function pageStartLabel(page, pos) {
  return page.evaluate((p) => {
    const ed = window.__docsEditor;
    const dom = ed.view.nodeDOM(p);
    if (!dom || dom.nodeType !== 1) return null;
    const before = getComputedStyle(dom, "::before").content;
    const after = getComputedStyle(dom, "::after").content;
    const r = dom.getBoundingClientRect();
    return { before, after, text: dom.textContent, attrs: [...dom.attributes].map((a) => `${a.name}=${a.value}`).join(" "), x: r.left, y: r.top, display: getComputedStyle(dom, "::before").display };
  }, pos);
}
async function figures(page) {
  return page.evaluate(() => {
    const out = [];
    const ed = window.__docsEditor;
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name !== "figure") return true;
      const dom = ed.view.nodeDOM(pos);
      const r = dom?.getBoundingClientRect?.();
      out.push({ pos, blockId: node.attrs.blockId, mediaId: node.attrs.mediaId, caption: node.attrs.caption, page: node.attrs.page, rect: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null, html: dom?.outerHTML?.slice(0, 300) ?? null });
      return false;
    });
    return out;
  });
}
async function editorJson(page) {
  return page.evaluate(() => window.__docsEditor.getJSON());
}
async function toasts(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="status"], [data-toast], .docs-toast')].map((e) => e.textContent.trim()).filter(Boolean));
}


/** Run a page editor command by its label through Search the menus (Alt+/),
    as a person does. False when the field did not open. */
async function menuCommand(page, label) {
  await page.evaluate(() => window.__docsEditor.commands.focus());
  await page.keyboard.press("Alt+/");
  await sleep(400);
  const field = page.locator('input[aria-label="Search the menus"], input[placeholder*="Search the menus"]').first();
  if (!(await field.count())) return false;
  await field.fill(label);
  await sleep(500);
  await page.keyboard.press("Enter");
  await sleep(500);
  return true;
}

/** Key-to-paint latency of the page editor: keydown to the frame after the
    editor's DOM changes. */
async function installLatency(page) {
  await page.evaluate(() => {
    window.__lat = [];
    let pending = null;
    document.addEventListener("keydown", (e) => {
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") pending = { key: e.key, t: performance.now() };
    }, true);
    new MutationObserver(() => {
      if (!pending) return;
      const p = pending;
      pending = null;
      requestAnimationFrame(() => setTimeout(() => window.__lat.push({ key: p.key, ms: performance.now() - p.t }), 0));
    }).observe(window.__docsEditor.view.dom, { characterData: true, childList: true, subtree: true });
  });
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return "none";
  const q = (f) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * f))]);
  return `median ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${Math.round(s.at(-1))} ms (n ${s.length})`;
}


/** The block at the reading line (lib/reading-position.ts): 80 px under the
    top edge of the pane that scrolls the page, and how far its top stands
    from the line. Runs in the page. */
function readingLine() {
  const prose = document.querySelector(".docs-prose");
  let pane = prose?.parentElement ?? null;
  while (pane && !(/(auto|scroll)/.test(getComputedStyle(pane).overflowY) && pane.scrollHeight > pane.clientHeight)) pane = pane.parentElement;
  const top = (pane ? Math.max(0, pane.getBoundingClientRect().top) : 0) + 80;
  const els = [...document.querySelectorAll(".docs-prose [data-block-id]")];
  const hit = els.find((e) => e.getBoundingClientRect().bottom > top);
  return hit ? { id: hit.dataset.blockId, dy: Math.round(hit.getBoundingClientRect().top - top), text: hit.textContent.slice(0, 40), scrollTop: pane?.scrollTop ?? null } : null;
}

// ── The run's documents ─────────────────────────────────────────────────────

const ctx = { notebookId: null, sectionId: null, docs: {}, bytes: {}, media: null, long: null };

async function prepare() {
  browser = await chromium.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
  ctx.media = await drawMedia(browser);
  const files = { ...ctx.media };
  files["/article.html"] = { type: "text/html; charset=utf-8", body: Buffer.from(articleHtml(STAMP)) };
  files["/article-2.html"] = { type: "text/html; charset=utf-8", body: Buffer.from(articleHtml(`${STAMP}-2`)) };
  ctx.server = await serveFixtures(files);
  const nb = await api("/api/notebooks", "POST", { title: `QA imports ${STAMP}` });
  if (nb.status !== 200 && nb.status !== 201) throw new Error(`project: HTTP ${nb.status} ${clip(JSON.stringify(nb.body), 200)}`);
  ctx.notebookId = nb.body.id;
  const section = await db.section.findFirst({ where: { notebookId: ctx.notebookId }, orderBy: { order: "asc" } });
  ctx.sectionId = section?.id ?? null;
  ctx.bytes.attention = await attentionBytes();
  console.log(`project ${ctx.notebookId} · fixtures on ${FIXTURE} · shots in ${SHOT}`);
}

/** A fresh import of one of the fixtures; `tag` makes its bytes or address new. */
async function fresh(kind, tag = "") {
  const t = `${STAMP}${tag}`;
  let added;
  if (kind === "pdf") added = await add(ctx.notebookId, { bytes: stamped(ctx.bytes.attention, t), name: `attention-${t}.pdf`, type: "application/pdf" });
  else if (kind === "url") added = await add(ctx.notebookId, { url: `${FIXTURE}/article.html?run=${t}` });
  else if (kind === "markdown") added = await add(ctx.notebookId, { bytes: Buffer.from(markdownFile(t)), name: `marsh-notes-${t}.md`, type: "text/markdown" });
  else throw new Error(kind);
  if (!added.id) throw new Error(`add ${kind}: ${added.error ?? "no id"}`);
  return added;
}

async function doc(kind) {
  if (!ctx.docs[kind]) ctx.docs[kind] = await fresh(kind);
  return ctx.docs[kind];
}

// ── The risks ───────────────────────────────────────────────────────────────

const RISKS = {};

// The switch: each fixture becomes an import (rich text, importRev 0, the
// "Imported" version) and opens in the page editor.
RISKS.SETUP = async () => {
  for (const kind of ["pdf", "url", "markdown"]) {
    const added = await doc(kind);
    const row = await documentRow(added.id);
    const versions = await db.documentVersion.findMany({ where: { documentId: added.id }, select: { rev: true, name: true } });
    const figureMedia = await db.figureMedia.count({ where: { documentId: added.id } });
    check("SETUP", Boolean(row?.richText) && typeof row?.importRev === "number" && row.importRev === row.richTextRev, `a ${kind} add is an import`, `richText ${row?.richText ? "set" : "null"}, richTextRev ${row?.richTextRev}, importRev ${row?.importRev}, add ${added.ms} ms, figure media ${figureMedia}, versions ${JSON.stringify(versions)}`);
    check("SETUP", versions.some((v) => v.name === "Imported"), `a ${kind} import keeps the version "Imported"`, JSON.stringify(versions));
  }
};

// R1: the first save after an import rewrites no row but the one typed in.
RISKS.R1 = async (theme) => {
  for (const kind of ["pdf", "url", "markdown"]) {
    const added = await fresh(kind, `-r1${theme[0]}`);
    const { page, errors, context } = await newPage(theme);
    await open(page, ctx.notebookId, added.id);
    // The editor's own copy against the stored rows: what a save would derive.
    const before = await rowsOf(added.id);
    const since = new Date();
    const target = before.find((r) => r.type === "PARAGRAPH" && r.text.length > 60 && !r.cell) ?? before.find((r) => r.type === "PARAGRAPH");
    await setMode(page, "editing");
    const at = await find(page, target.text.slice(-12));
    await clickPos(page, at.to);
    await page.keyboard.type("x");
    await waitSaved(page);
    await sleep(800);
    const after = await rowsOf(added.id);
    const edits = await editsSince(added.id, since);
    const changed = after.filter((r) => before.find((b) => b.id === r.id)?.hash !== r.hash);
    const gone = before.filter((b) => !after.some((r) => r.id === b.id));
    const kinds = edits.map((e) => e.kind);
    const ok = changed.length === 1 && changed[0].id === target.id && gone.length === 0 && after.length === before.length && kinds.length === 1 && kinds[0] === "TEXT_EDIT";
    const detail = `${before.length} rows; changed ${changed.length} (${changed.slice(0, 3).map((r) => `${r.type} "${clip(r.text, 30)}"`).join(", ")}), removed ${gone.length}, added ${after.length - before.length + gone.length}; history ${JSON.stringify(kinds.slice(0, 6))}`;
    check("R1", ok, `${kind} (${theme}): one letter typed changes one row and writes one TEXT_EDIT`, detail);
    if (!ok && changed.length > 1) {
      // Why the other rows moved: the first field that differs.
      const r = changed.find((c) => c.id !== target.id);
      const b = before.find((x) => x.id === r?.id);
      if (r && b) {
        const field = ["type", "text", "html", "styles", "links", "citations", "page", "region", "mediaId", "cell", "order"].find((k) => JSON.stringify(r[k]) !== JSON.stringify(b[k]));
        note("R1", `${kind}: first other row that changed`, `${r.type} ${field}: ${clip(JSON.stringify(b[field]), 80)} → ${clip(JSON.stringify(r[field]), 80)}`);
      }
    }
    if (errors.length) note("R1", `${kind}: console`, errors.slice(0, 2).join(" | "));
    await context.close();
  }
};

// R2: a stored node this build does not know: the frame stands and the page
// reloads once, never a blank pane, and nothing is saved over it.
RISKS.R2 = async (theme) => {
  const added = await fresh("markdown", `-r2${theme[0]}`);
  const row = await documentRow(added.id);
  const alien = { type: "futureObject", attrs: { blockId: `qa${STAMP}alien` }, content: [{ type: "text", text: "Words of a node from a newer build." }] };
  const rich = { ...row.richText, content: [...row.richText.content, alien] };
  await db.document.update({ where: { id: added.id }, data: { richText: rich } });
  const { page, errors, context } = await newPage(theme);
  let loads = 0;
  page.on("load", () => loads++);
  await open(page, ctx.notebookId, added.id, { wait: false });
  await sleep(9000);
  const state = await page.evaluate(() => ({
    prose: document.querySelector(".docs-prose")?.textContent.length ?? 0,
    frame: Boolean(document.querySelector(".docs-frame, [data-docs-frame]")),
    body: document.body.innerText.length,
    title: document.querySelector(".docs-title, [data-docs-title]")?.textContent ?? null,
  }));
  const path = await shot(page, `R2-unknown-node-${theme}`);
  const stored = await documentRow(added.id);
  const kept = JSON.stringify(stored.richText).includes("futureObject");
  check("R2", loads <= 2 && (state.prose > 0 || state.frame) && kept, `(${theme}) a stored node this build lacks: the frame or the page shows, it reloads at most once, the stored copy keeps the node`, `loads ${loads}, prose ${state.prose} chars, frame ${state.frame}, stored keeps it ${kept}, ${path}`);
  if (errors.length) note("R2", "console", errors.slice(0, 3).join(" | "));
  await context.close();
  await db.document.update({ where: { id: added.id }, data: { richText: row.richText } });
};

// R3: a selection across a page start anchors the same words after a
// reload; a copy holds the words only; Backspace at a page start keeps it.
RISKS.R3 = async (theme) => {
  const added = await fresh("pdf", `-r3${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  const starts = await pageStarts(page);
  const inline = starts.filter((s) => s.on === "paragraph" && s.before.length >= 20 && s.after.length >= 20);
  check("R3", starts.length > 0, `(${theme}) the PDF import shows page starts`, `${starts.length}: ${starts.slice(0, 16).map((s) => `p. ${s.page}${s.on === "paragraph" || s.on === "heading" ? "" : `[${s.on}]`}`).join(" ")}`);
  if (!inline.length) {
    fail("R3", "a page start inside a paragraph", "none found");
    await context.close();
    return;
  }
  const s = inline[0];
  const label = await pageStartLabel(page, s.pos);
  note("R3", `the page start p. ${s.page} draws`, JSON.stringify(label));
  // Select from 20 characters before the page start to 20 after.
  const from = s.pos - 20;
  const to = s.pos + 1 + 20;
  await dragSelect(page, from, to);
  const selected = await page.evaluate(() => window.getSelection().toString());
  const words = `${s.before.slice(-20)}${s.after.slice(0, 20)}`;
  const toolbar = await popoverOpen(page);
  check("R3", toolbar, `(${theme}) a selection across p. ${s.page} opens the toolbar in Viewing`, `selection "${clip(selected, 60)}"`);
  // The clipboard: the words only.
  await page.keyboard.press("Control+c");
  await sleep(300);
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `(${e.message})`);
  check("R3", copied.replace(/\s+/g, " ").trim() === words.replace(/\s+/g, " ").trim() && !/p\.\s*\d/.test(copied), `(${theme}) Ctrl+C across p. ${s.page} copies the words alone`, `copied "${clip(copied, 80)}", words "${clip(words, 80)}"`);
  // Highlight, reload, and read the mark's words.
  const sourcesBefore = (await sourcesOf(added.id)).length;
  const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
  if (await colors.count()) {
    await colors.first().click();
    await sleep(1500);
  }
  const sources = await sourcesOf(added.id);
  const made = sources.slice(sourcesBefore);
  check("R3", made.length === 1 && made[0].quotedText === words, `(${theme}) the highlight's quote is the words across the page start`, made.length ? `quote "${clip(made[0].quotedText, 80)}" at ${made[0].startOffset}-${made[0].endOffset} of ${made[0].blockId}` : "no source stored");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(2500);
  const painted = made.length
    ? await page.evaluate((id) => [...document.querySelectorAll(`[data-source-id="${id}"]`)].map((e) => e.textContent).join(""), made[0].id)
    : "";
  const path = await shot(page, `R3-mark-across-page-start-${theme}`);
  check("R3", made.length > 0 && painted.replace(/\s+/g, "") === words.replace(/\s+/g, ""), `(${theme}) after a reload the mark covers the same words`, `painted "${clip(painted, 80)}", ${path}`);
  // Backspace at the page start, and a deletion across it, in Editing.
  await setMode(page, "editing");
  const again = (await pageStarts(page)).find((x) => x.page === s.page);
  await clickPos(page, again.pos + 1);
  const textBefore = await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, again.pos);
  await page.keyboard.press("Backspace");
  await sleep(500);
  const afterBackspace = (await pageStarts(page)).filter((x) => x.page === s.page);
  const textAfter = afterBackspace.length ? await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, afterBackspace[0].pos) : "";
  check("R3", afterBackspace.length === 1, `(${theme}) Backspace at p. ${s.page} keeps the page start`, `page starts for p. ${s.page}: ${afterBackspace.length}; words ${textBefore.length} → ${textAfter.length}`);
  // A deletion that takes the page start with words on both sides.
  const cur = afterBackspace[0] ?? again;
  await dragSelect(page, cur.pos - 6, cur.pos + 7);
  await page.keyboard.press("Delete");
  await sleep(500);
  const afterDelete = (await pageStarts(page)).filter((x) => x.page === s.page);
  check("R3", afterDelete.length === 1, `(${theme}) a deletion across p. ${s.page} puts the page start back where it closed`, `page starts for p. ${s.page}: ${afterDelete.length}${afterDelete[0] ? `, before "${afterDelete[0].before.slice(-12)}" after "${afterDelete[0].after.slice(0, 12)}"` : ""}`);
  // Undo both, and wait for the save.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await waitSaved(page).catch(() => {});
  if (errors.length) note("R3", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R5: a figure's annotation orphans when its figure goes, never moves into
// a paragraph that names the figure; Ctrl+Z brings it back; cut and paste
// carries it.
RISKS.R5 = async (theme) => {
  const added = await fresh("url", `-r5${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  const figs = await figures(page);
  const fig3 = figs.find((f) => (f.caption ?? "").trim() === "Figure 3");
  check("R5", Boolean(fig3), `(${theme}) the web page's figure captioned "Figure 3" is a figure object`, figs.map((f) => `"${clip(f.caption, 20)}"`).join(", "));
  if (!fig3) {
    await context.close();
    return;
  }
  // A click on the figure opens its tools; Analyze.
  const box = await reveal(page, fig3.pos).then(() => page.evaluate((p) => window.__docsEditor.view.nodeDOM(p).getBoundingClientRect().toJSON(), fig3.pos));
  await clickAt(page, box.x + box.width / 2, box.y + box.height / 3);
  await sleep(800);
  const tools = await popoverOpen(page);
  const analyze = page.locator('[data-selection-popover] [data-track="analyze"]');
  check("R5", tools && (await analyze.count()) > 0, `(${theme}) a click on a figure opens its tools with Analyze`, `toolbar ${tools}`);
  if (await analyze.count()) {
    await analyze.click();
    await sleep(6000);
  }
  let sources = await sourcesOf(added.id);
  const src = sources.find((s) => s.blockId === fig3.blockId);
  check("R5", Boolean(src), `(${theme}) Analyze anchors to the figure's row`, src ? `quote "${src.quotedText}" ${src.note.derivationType}` : JSON.stringify(sources.map((s) => s.quotedText)));
  const ring = await page.evaluate((p) => {
    const el = window.__docsEditor.view.nodeDOM(p);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const inner = el.querySelector("[data-source-id]") ?? (el.hasAttribute("data-source-id") ? el : null);
    return { outline: cs.outlineColor + " " + cs.outlineStyle, boxShadow: cs.boxShadow.slice(0, 80), sourceId: inner?.getAttribute("data-source-id") ?? el.closest("[data-source-id]")?.getAttribute("data-source-id") ?? null, label: el.parentElement?.querySelector("[data-anchor-skip]")?.textContent ?? null };
  }, fig3.pos);
  const ringShot = await shot(page, `R5-analyze-ring-${theme}`);
  check("R5", Boolean(ring?.sourceId), `(${theme}) the analyzed figure carries data-source-id and a ring`, `${JSON.stringify(ring)} ${ringShot}`);
  if (!src) {
    await context.close();
    return;
  }
  // Delete the figure in Editing.
  await setMode(page, "editing");
  await page.evaluate((p) => {
    const ed = window.__docsEditor;
    ed.chain().setNodeSelection(p).run();
  }, fig3.pos);
  await page.keyboard.press("Delete");
  await waitSaved(page);
  await sleep(1500);
  sources = await sourcesOf(added.id);
  const afterDelete = sources.find((s) => s.id === src.id);
  const movedTo = afterDelete && !afterDelete.orphaned ? await rowText(afterDelete.blockId) : null;
  check("R5", afterDelete?.orphaned === true, `(${theme}) deleting the figure orphans its annotation (never moves it into "As Figure 3 shows")`, afterDelete ? `orphaned ${afterDelete.orphaned}${movedTo ? `, now on ${movedTo.type} "${clip(movedTo.text, 60)}"` : ""}` : "source gone");
  // Ctrl+Z brings the figure and its annotation back.
  await page.keyboard.press("Control+z");
  await waitSaved(page);
  await sleep(1500);
  sources = await sourcesOf(added.id);
  const back = sources.find((s) => s.id === src.id);
  const figsBack = await figures(page);
  const onFigure = back && figsBack.some((f) => f.blockId === back.blockId);
  check("R5", Boolean(back && !back.orphaned && onFigure), `(${theme}) Ctrl+Z brings the figure back and its annotation with it`, back ? `orphaned ${back.orphaned}, on a figure ${onFigure}` : "source gone");
  // Cut and paste the figure after the next heading: the annotation follows.
  const fig = figsBack.find((f) => f.caption?.trim() === "Figure 3");
  if (fig) {
    await page.evaluate((p) => window.__docsEditor.chain().setNodeSelection(p).run(), fig.pos);
    await page.keyboard.press("Control+x");
    await sleep(400);
    const target = await find(page, "The measurements");
    await clickPos(page, target.to);
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    await waitSaved(page);
    await sleep(1500);
    const moved = (await figures(page)).find((f) => f.caption?.trim() === "Figure 3");
    sources = await sourcesOf(added.id);
    const followed = sources.find((s) => s.id === src.id);
    check("R5", Boolean(moved && followed && !followed.orphaned && followed.blockId === moved.blockId), `(${theme}) cut and paste moves the figure and the annotation follows it`, `figure pasted ${Boolean(moved)} (id ${moved?.blockId}), source on ${followed?.blockId} orphaned ${followed?.orphaned}`);
    await shot(page, `R5-after-cut-paste-${theme}`);
  }
  if (errors.length) note("R5", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R6: figure html from the client: a save with another document's mediaId,
// or with an html attribute, keeps neither; a figure pasted into another
// document does not paste, and a toast says so.
RISKS.R6 = async (theme) => {
  const web = await doc("url");
  const pdf = await doc("pdf");
  const stored = await documentRow(web.id);
  const foreign = await db.figureMedia.findFirst({ where: { documentId: pdf.id }, select: { id: true } });
  const own = await db.figureMedia.findFirst({ where: { documentId: web.id }, select: { id: true } });
  if (theme === THEMES[0] && foreign && own) {
    const crafted = {
      ...stored.richText,
      content: [
        ...stored.richText.content,
        { type: "figure", attrs: { blockId: `qa${STAMP}f1`, mediaId: foreign.id, caption: "Foreign figure", page: null, region: null } },
        { type: "figure", attrs: { blockId: `qa${STAMP}f2`, mediaId: own.id, caption: "Own figure", html: '<img src="x" onerror="alert(1)">', page: null, region: null } },
      ],
    };
    const put = await api(`/api/documents/${web.id}/rich-text`, "PUT", { richText: crafted, rev: stored.richTextRev });
    const after = await documentRow(web.id);
    const json = JSON.stringify(after.richText);
    check("R6", !json.includes(foreign.id), "a save with another document's mediaId drops that figure", `PUT ${put.status}; stored holds the foreign mediaId: ${json.includes(foreign.id)}`);
    check("R6", !json.includes("onerror"), "a save with an html attribute on a figure keeps no html", `stored holds the html: ${json.includes("onerror")}`);
    // Put the stored copy back as it was.
    const fresh2 = await documentRow(web.id);
    await api(`/api/documents/${web.id}/rich-text`, "PUT", { richText: stored.richText, rev: fresh2.richTextRev });
  }
  // Paste a figure into another import.
  const target = await fresh("markdown", `-r6${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, web.id);
  const figs = await figures(page);
  if (!figs.length) {
    fail("R6", `(${theme}) a figure to copy`, "none");
    await context.close();
    return;
  }
  await setMode(page, "editing");
  await page.evaluate((p) => window.__docsEditor.chain().setNodeSelection(p).run(), figs[0].pos);
  await page.keyboard.press("Control+c");
  await sleep(300);
  await open(page, ctx.notebookId, target.id);
  await setMode(page, "editing");
  const at = await find(page, "Observations");
  await clickPos(page, at.to);
  const before = (await figures(page)).length;
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+v");
  await sleep(1200);
  const after = (await figures(page)).length;
  const said = await toasts(page);
  const path = await shot(page, `R6-paste-figure-${theme}`);
  check("R6", after === before, `(${theme}) a figure from another document does not paste`, `figures ${before} → ${after}, ${path}`);
  check("R6", said.length > 0, `(${theme}) a toast says why`, said.join(" | ") || "no toast");
  if (errors.length) note("R6", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R7: Viewing on open shows comments, opens the toolbar, and leaves the
// queue's keys to the notes tray; Editing types them.
RISKS.R7 = async (theme) => {
  const added = await fresh("url", `-r7${theme[0]}`);
  // Two pending notes on the import, for the queue's keys.
  const rows = await rowsOf(added.id);
  const para = rows.find((r) => r.type === "PARAGRAPH" && r.text.length > 80);
  const pending = [];
  for (let i = 0; i < 3; i++) {
    const n = await db.note.create({
      data: {
        sectionId: ctx.sectionId,
        content: `Pending ${i + 1} (${theme}): the lede's claim.`,
        status: "PENDING",
        derivationType: "EXTRACT",
        order: 1000 + i,
        documentId: added.id,
        sources: { create: { documentId: added.id, blockId: para.id, startOffset: 0, endOffset: 30, quotedText: para.text.slice(0, 30), prefix: "", suffix: para.text.slice(30, 62) } },
      },
    });
    pending.push(n.id);
  }
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  const m = await mode(page);
  const focusInPage = await page.evaluate(() => Boolean(document.activeElement?.closest(".ProseMirror")));
  check("R7", m === "viewing" && !focusInPage, `(${theme}) a new import opens in Viewing, the page not focused`, `mode ${m}, focus in page ${focusInPage}`);
  // A comment in Viewing.
  await selectWords(page, "sinking faster than the sea is rising");
  check("R7", await popoverOpen(page), `(${theme}) a selection in Viewing opens the toolbar`, "");
  await tool(page, "comment");
  await page.keyboard.type("A comment made in Viewing.");
  const posted = Date.now();
  await page.keyboard.press("Enter");
  // The comment's card stands in the margin once the note is stored.
  await page.waitForFunction(() => [...document.querySelectorAll("[data-comment-card]")].some((c) => c.getClientRects().length && c.textContent.includes("made in Viewing")), null, { timeout: 15_000 }).catch(() => {});
  const cardMs = Date.now() - posted;
  const card = await page.evaluate(() => [...document.querySelectorAll("[data-comment-card]")].filter((c) => c.getClientRects().length).map((c) => c.textContent.slice(0, 80)));
  const commentShot = await shot(page, `R7-comment-in-viewing-${theme}`);
  check("R7", card.some((c) => c.includes("Viewing")), `(${theme}) the comment's card shows in Viewing`, `${card.length} cards after ${cardMs} ms ${clip(card.join(" | "), 100)} ${commentShot}`);
  // Highlight and Explain in Viewing.
  await selectWords(page, "the sediment which once rebuilt them");
  const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
  if (await colors.count()) await colors.first().click();
  await sleep(1200);
  await selectWords(page, "the loss is measurable from one flood season to the next");
  await tool(page, "explain");
  await sleep(4000);
  const explain = await page.locator('[data-side-card="explain"]').first().innerText().catch(() => "");
  check("R7", explain.length > 20, `(${theme}) Explain answers in Viewing`, clip(explain, 80));
  const kinds = (await sourcesOf(added.id)).map((s) => s.note.derivationType ?? (s.note.color ? `highlight:${s.note.color}` : "comment"));
  note("R7", `(${theme}) annotations made in Viewing`, kinds.join(", "));
  // The queue's keys reach the notes tray.
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 450);
  await sleep(300);
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  await page.keyboard.press("k");
  await page.keyboard.press("Enter");
  await sleep(1200);
  await page.keyboard.press("j");
  await page.keyboard.press("Backspace");
  await sleep(1500);
  const statuses = await db.note.findMany({ where: { id: { in: pending } }, select: { status: true } });
  const counts = statuses.reduce((m2, s) => ({ ...m2, [s.status]: (m2[s.status] ?? 0) + 1 }), {});
  check("R7", (counts.ACCEPTED ?? 0) >= 1 && (counts.REJECTED ?? 0) >= 1, `(${theme}) in Viewing, j k Enter Backspace act on the pending notes`, JSON.stringify(counts));
  // Editing: the same keys type.
  await setMode(page, "editing");
  const at = await find(page, "What comes next");
  await clickPos(page, at.to);
  await page.keyboard.type(" jk");
  await sleep(300);
  const typed = await page.evaluate(() => window.__docsEditor.state.doc.textContent.includes("What comes next jk"));
  const statusesAfter = await db.note.findMany({ where: { id: { in: pending } }, select: { status: true } });
  check("R7", typed && JSON.stringify(statusesAfter) === JSON.stringify(statuses), `(${theme}) in Editing the same keys type in the page`, `typed ${typed}`);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await waitSaved(page).catch(() => {});
  // Editing is remembered on a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(800);
  check("R7", (await mode(page)) === "editing", `(${theme}) Editing is remembered on a reload`, `mode ${await mode(page)}`);
  if (errors.length) note("R7", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R8: no re-parse loses edits: the manual one asks, the silent ones skip an
// edited import, a shape switch to pages leaves the page editor.
RISKS.R8 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const added = await fresh("url", "-r8");
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  await setMode(page, "editing");
  const at = await find(page, "What comes next");
  await clickPos(page, at.to);
  await page.keyboard.type(" (edited)");
  await waitSaved(page);
  await sleep(500);
  // The route: 409 without replaceEdits.
  const refused = await api(`/api/documents/${added.id}/reparse`, "POST", {});
  const stillEdited = JSON.stringify((await documentRow(added.id)).richText).includes("(edited)");
  check("R8", refused.status === 409 && stillEdited, "a re-parse of an edited import answers 409 and keeps the edit", `HTTP ${refused.status} ${clip(JSON.stringify(refused.body), 100)}; edit kept ${stillEdited}`);
  // A stale address added again: the edited import is not re-parsed over.
  await db.document.update({ where: { id: added.id }, data: { parserVersion: 1 } });
  const again = await add(ctx.notebookId, { url: `${FIXTURE}/article.html?run=${STAMP}-r8` });
  const keptAfterAdd = JSON.stringify((await documentRow(added.id)).richText).includes("(edited)");
  check("R8", keptAfterAdd, "a stale address added again never re-parses over an edited import", `the add gave ${again.id === added.id ? "the same document" : `another document (${again.id})`}, edit kept ${keptAfterAdd}`);
  // The document menu asks first.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(800);
  const menu = page.locator('[data-track="document-menu"], [data-track="document-actions"], [aria-label="Document actions"]').first();
  let asked = null;
  if (await menu.count()) {
    await menu.click();
    await sleep(300);
    const reparse = page.locator('[data-track^="document-reparse"]').first();
    if (await reparse.count()) {
      await reparse.click();
      await sleep(800);
      asked = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((d) => d.textContent).join(" | "));
      await shot(page, "R8-reparse-asks");
    }
  }
  check("R8", Boolean(asked && /edit/i.test(asked)), "Re-parse on an edited import asks first", clip(asked ?? "no menu or no dialog found", 160));
  // Yes: replaceEdits; the version "Before re-parse" holds the edit.
  const replaced = await api(`/api/documents/${added.id}/reparse`, "POST", { replaceEdits: true });
  const versions = await db.documentVersion.findMany({ where: { documentId: added.id }, select: { name: true, richText: true } });
  const before = versions.find((v) => v.name === "Before re-parse");
  check("R8", replaced.status === 200 && Boolean(before) && JSON.stringify(before?.richText ?? "").includes("(edited)"), "Yes replaces the edits and the version \"Before re-parse\" holds them", `HTTP ${replaced.status}; versions ${versions.map((v) => v.name ?? "·").join(", ")}`);
  // The shape switch: a PDF re-parsed as handwritten pages leaves the page editor.
  const pdf = await fresh("pdf", "-r8");
  const shape = await api(`/api/documents/${pdf.id}/reparse`, "POST", { as: "handwritten", replaceEdits: true });
  const pdfRow = await documentRow(pdf.id);
  const pageRows = await db.block.count({ where: { documentId: pdf.id, type: "PAGE" } });
  check("R8", !pdfRow.richText && pdfRow.handwritten && pageRows > 0 && pdfRow.importRev === null, "a shape switch to pages clears the rich text and builds PAGE rows", `HTTP ${shape.status}; richText ${pdfRow.richText ? "kept" : "cleared"}, handwritten ${pdfRow.handwritten}, PAGE rows ${pageRows}, importRev ${pdfRow.importRev}`);
  await open(page, ctx.notebookId, pdf.id, { wait: false });
  await sleep(6000);
  const view = await page.evaluate(() => ({ docs: Boolean(document.querySelector(".docs-prose")), pages: document.querySelectorAll('[data-page-block], .page-block, img[src*="/page/"]').length }));
  await shot(page, "R8-shape-switch-pages");
  check("R8", !view.docs, "after the switch the reader shows pages, not the page editor", JSON.stringify(view));
  if (errors.length) note("R8", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R9: an import another account's project holds is not editable here, the
// server refuses the save, and dedupe never hands out an edited import.
RISKS.R9 = async (theme) => {
  const added = await fresh("pdf", `-r9${theme[0]}`);
  const other = await db.notebook.create({ data: { title: `QA other account ${STAMP}`, userId: "qa-other-account", sections: { create: { title: "Notes", order: 0 } } } });
  await db.notebookDocument.create({ data: { notebookId: other.id, documentId: added.id } });
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  await page.click('[data-track="docs:mode"]');
  await sleep(400);
  const menu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-track^="docs:mode:"]')].map((el) => ({ track: el.dataset.track, disabled: el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled") }));
    const reason = [...document.querySelectorAll(".docs-menu-modes p")].map((p) => p.textContent).join(" ");
    return { items, reason };
  });
  const path = await shot(page, `R9-shared-mode-menu-${theme}`);
  await page.keyboard.press("Escape");
  const editingOff = menu.items.filter((i) => i.track !== "docs:mode:viewing").every((i) => i.disabled);
  check("R9", editingOff && menu.reason.length > 10, `(${theme}) on a shared import Editing and Suggesting are off, with the reason`, `${JSON.stringify(menu.items)} "${clip(menu.reason, 100)}" ${path}`);
  if (theme === THEMES[0]) {
    const row = await documentRow(added.id);
    const put = await api(`/api/documents/${added.id}/rich-text`, "PUT", { richText: row.richText, rev: row.richTextRev });
    check("R9", put.status === 403, "the rich-text save refuses a shared import with 403", `HTTP ${put.status} ${clip(JSON.stringify(put.body), 100)}`);
    const block = await db.block.findFirst({ where: { documentId: added.id, type: "PARAGRAPH" }, select: { id: true, text: true } });
    const patch = await api(`/api/blocks/${block.id}`, "PATCH", { text: `${block.text} (server edit)` });
    check("R9", patch.status === 403, "a server-side edit (the block route) refuses a shared import with 403", `HTTP ${patch.status}`);
    const suggest = await api(`/api/documents/${added.id}/suggest`, "POST", { command: "shorten", blockIds: [block.id] });
    check("R9", suggest.status === 403, "the assistant's suggest route refuses a shared import with 403", `HTTP ${suggest.status}`);
    // Dedupe: an edited import is never handed to another add.
    const solo = await fresh("pdf", "-r9dedupe");
    const soloRow = await documentRow(solo.id);
    await api(`/api/documents/${solo.id}/rich-text`, "PUT", { richText: { ...soloRow.richText, content: [...soloRow.richText.content, { type: "paragraph", attrs: { blockId: `qa${STAMP}edit` }, content: [{ type: "text", text: "An edit by another reader." }] }] }, rev: soloRow.richTextRev });
    const second = await add(ctx.notebookId, { bytes: stamped(ctx.bytes.attention, `${STAMP}-r9dedupe`), name: "attention-again.pdf", type: "application/pdf" });
    const secondRow = second.id ? await documentRow(second.id) : null;
    check("R9", second.id && second.id !== solo.id && secondRow?.importRev === secondRow?.richTextRev, "the same PDF added after an edit gives an unedited import", `first ${solo.id}, second ${second.id} (deduped ${second.deduped}), second rev ${secondRow?.richTextRev}/${secondRow?.importRev}`);
    const unedited = await add(ctx.notebookId, { bytes: stamped(ctx.bytes.attention, `${STAMP}-r9dedupe`), name: "attention-third.pdf", type: "application/pdf" });
    check("R9", unedited.id === second.id && unedited.deduped === true, "an unedited import is handed out again", `third ${unedited.id} deduped ${unedited.deduped}`);
  }
  // The assistant's bar offers no edit commands on the shared import (C2).
  await selectWords(page, "attention").catch(() => {});
  const assistant = page.locator('[data-selection-popover] [data-track="assistant"]').first();
  if (await assistant.count()) {
    await assistant.click();
    await sleep(600);
    const chips = await page.locator('[data-track^="assistant-command:"]').count();
    check("R9", chips === 0, `(${theme}) the assistant offers no edit commands on a shared import`, `${chips} command chips`);
  }
  if (errors.length) note("R9", "console", errors.slice(0, 3).join(" | "));
  await context.close();
  await db.notebookDocument.deleteMany({ where: { notebookId: other.id } });
  await db.notebook.delete({ where: { id: other.id } });
};

// R10: a Markdown file whose front matter and first heading repeat the title
// shows one Title.
RISKS.R10 = async (theme) => {
  const added = await doc("markdown");
  const { page, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  const outline = await page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.forEach((n) => out.push(`${n.attrs?.docStyle ?? n.type.name}${n.attrs?.level ? n.attrs.level : ""}: ${n.textContent.slice(0, 40)}`));
    return out.slice(0, 6);
  });
  const titles = outline.filter((l) => /Field Notes on Tidal Marshes/.test(l));
  const path = await shot(page, `R10-one-title-${theme}`);
  check("R10", titles.length === 1 && /^title/.test(titles[0]), `(${theme}) the title stands once, as the Title`, `${outline.join(" | ")} ${path}`);
  await context.close();
};

// R11: speed on the paper and on a long PDF, and the size guard.
RISKS.R11 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const pdf = await doc("pdf");
  const rows = await db.block.count({ where: { documentId: pdf.id } });
  const json = JSON.stringify((await documentRow(pdf.id)).richText).length;
  time("R11", "the Attention paper's add", `${pdf.ms} ms, ${rows} rows, ${json} JSON chars`);
  const { page, context } = await newPage(theme);
  const opened = [];
  for (let i = 0; i < 3; i++) opened.push(await open(page, ctx.notebookId, pdf.id));
  time("R11", "the Attention paper: open to text, open to the editor", `${opened.map((o) => `${o.text}/${o.ready}`).join(", ")} ms`);
  await setMode(page, "editing");
  await installLatency(page);
  const para = await find(page, "Recurrent neural networks");
  await clickPos(page, para?.to ?? 50);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i % 3 === 2 ? "Backspace" : "a");
    await sleep(90);
  }
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Enter");
    await sleep(120);
    await page.keyboard.press("Backspace");
    await sleep(120);
  }
  const lat = await page.evaluate(() => window.__lat);
  time("R11", "the Attention paper in Editing: key to paint", `letters ${stats(lat.filter((l) => l.key.length === 1).map((l) => l.ms))}; Enter ${stats(lat.filter((l) => l.key === "Enter").map((l) => l.ms))}; Backspace ${stats(lat.filter((l) => l.key === "Backspace").map((l) => l.ms))}`);
  await waitSaved(page).catch(() => {});
  // A 400-paragraph paste, then its save.
  const html = Array.from({ length: 400 }, (_, i) => `<p>Pasted paragraph ${i + 1}: ${sentence(rng(i), 14)}</p>`).join("");
  await page.evaluate(async (h) => {
    const item = new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([h.replace(/<[^>]+>/g, "\n")], { type: "text/plain" }) });
    await navigator.clipboard.write([item]);
  }, html);
  const t0 = Date.now();
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.__docsEditor.state.doc.textContent.includes("Pasted paragraph 400"), null, { timeout: 60_000 });
  const pasted = Date.now() - t0;
  const saveReq = page.waitForResponse((r) => r.url().includes("/rich-text") && r.request().method() === "PUT", { timeout: 120_000 }).catch(() => null);
  const resp = await saveReq;
  const saved = Date.now() - t0;
  time("R11", "a 400-paragraph paste into the paper", `in the page after ${pasted} ms; the save answered ${resp?.status() ?? "none"} after ${saved} ms`);
  await waitSaved(page, 120_000).catch(() => {});
  // Select all and Delete, then undo.
  await page.keyboard.press("Control+a");
  const t1 = Date.now();
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => window.__docsEditor.state.doc.textContent.length < 50, null, { timeout: 60_000 }).catch(() => {});
  const deleted = Date.now() - t1;
  await page.keyboard.press("Control+z");
  await page.waitForFunction(() => window.__docsEditor.state.doc.textContent.length > 1000, null, { timeout: 60_000 }).catch(() => {});
  time("R11", "Select all + Delete on the paper, then Ctrl+Z", `delete ${deleted} ms, undo ${Date.now() - t1 - deleted} ms`);
  await waitSaved(page, 120_000).catch(() => {});
  const starts = await pageStarts(page);
  check("R11", starts.length >= 12, "after Select all + Delete and Ctrl+Z the page starts are back", `${starts.length} page starts`);
  await context.close();
  // The long PDF: the size guard keeps it a block document.
  if (!ctx.long) ctx.long = await longPdf(browser, LONG_PAGES, STAMP);
  const long = await add(ctx.notebookId, { bytes: ctx.long.bytes, name: `long-${ctx.long.pages}-${STAMP}.pdf`, type: "application/pdf" });
  const longRow = long.id ? await documentRow(long.id) : null;
  const longRows = long.id ? await db.block.count({ where: { documentId: long.id } }) : 0;
  time("R11", `the ${ctx.long.pages}-page PDF's add`, `${long.ms} ms, ${longRows} rows, stages ${long.stages.join(" ")}`);
  check("R11", Boolean(longRow) && !longRow.richText, `the size guard keeps the ${ctx.long.pages}-page PDF a block document`, `richText ${longRow?.richText ? "set" : "null"}; the add's save detail ${clip(JSON.stringify(long.saveDetail), 160)}`);
  check("R11", JSON.stringify(long.saveDetail ?? {}).includes("size"), "the add's save stage says the size guard kept a block document", clip(JSON.stringify(long.saveDetail), 160));
};

// R12: the reading position of a long import survives a reload.
RISKS.R12 = async (theme) => {
  const pdf = await doc("pdf");
  const { page, context } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const starts = await pageStarts(page);
  const twelve = starts.find((s) => s.page === 12) ?? starts.at(-3);
  const put = page.waitForResponse((r) => r.url().includes("/position") && r.request().method() === "PUT", { timeout: 20_000 }).catch(() => null);
  await page.evaluate((p) => {
    const ed = window.__docsEditor;
    const dom = ed.view.domAtPos(p);
    const el = dom.node.nodeType === 1 ? dom.node : dom.node.parentElement;
    el.scrollIntoView({ block: "start" });
  }, twelve.pos);
  await page.mouse.wheel(0, -60);
  await sleep(2500);
  const saved = await put;
  const at = await page.evaluate(readingLine);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(4000);
  const back = await page.evaluate(readingLine);
  const path = await shot(page, `R12-position-after-reload-${theme}`);
  check("R12", Boolean(at && back && at.id === back.id && Math.abs(at.dy - back.dy) < 40), `(${theme}) scrolled to p. ${twelve.page}, reloaded: the same line is at the top`, `position saved ${saved?.status() ?? "no PUT"}; before ${JSON.stringify(at)}, after ${JSON.stringify(back)} ${path}`);
  await context.close();
};

// R13: the figure image URLs: the finishing step's list, the page's
// requests, and the offline copy agree.
RISKS.R13 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const pdf = await fresh("pdf", "-r13");
  const finish = await api(`/api/documents/${pdf.id}/finish`, "POST", {});
  const listed = JSON.stringify(finish.body).match(/\/api\/documents\/[^"\s]+\/figure\/[^"\s?]+/g) ?? [];
  const { page, context, responses } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const figs = await figures(page);
  for (const f of figs) {
    await reveal(page, f.pos);
    await sleep(300);
  }
  await sleep(2000);
  const requested = [...new Set(responses.filter((r) => /\/figure\//.test(r.url)).map((r) => r.url.split("?")[0]))];
  const bad = responses.filter((r) => /\/figure\//.test(r.url) && r.status >= 400);
  const same = listed.length > 0 && requested.every((u) => listed.includes(u));
  check("R13", same && bad.length === 0, "the finishing step lists the figure URLs the page requests", `listed ${listed.length}, requested ${requested.length}${requested.filter((u) => !listed.includes(u)).slice(0, 2).map((u) => `; not listed ${u}`).join("")}${bad.length ? `; ${bad.length} failed (${bad[0].status})` : ""}; finish HTTP ${finish.status}`);
  const loaded = await page.evaluate(() => [...document.querySelectorAll(".docs-prose img")].map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 })));
  check("R13", loaded.length > 0 && loaded.every((i) => i.ok), "every figure image of the PDF import loads", `${loaded.filter((i) => i.ok).length} of ${loaded.length}`);
  // Save the project for offline, then open it offline.
  const save = page.locator('[data-track="offline-save"]').first();
  if (await save.count()) {
    await save.click();
    await sleep(15000);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    await sleep(6000);
    const offline = await page.evaluate(() => ({ prose: document.querySelector(".docs-prose")?.textContent.length ?? 0, imgs: [...document.querySelectorAll(".docs-prose img")].map((i) => i.complete && i.naturalWidth > 0) }));
    const path = await shot(page, "R13-offline");
    check("R13", offline.prose > 0 && offline.imgs.length > 0 && offline.imgs.every(Boolean), "offline, the import opens with every figure", `${JSON.stringify({ prose: offline.prose, figures: `${offline.imgs.filter(Boolean).length}/${offline.imgs.length}` })} ${path}`);
    await context.setOffline(false);
  } else note("R13", "Save for offline", "no offline-save control on this page");
  await context.close();
};

// R14: a chart wider than the text stays in the text width; typing beside an
// embed types in the page; videos play near the view only.
RISKS.R14 = async (theme) => {
  const web = await fresh("url", `-r14${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, web.id);
  const layout = await page.evaluate(() => {
    const prose = document.querySelector(".docs-prose");
    const text = prose.getBoundingClientRect();
    const figs = [...prose.querySelectorAll(".docs-figure")].map((f) => {
      const r = f.getBoundingClientRect();
      const svg = f.querySelector("svg");
      return { w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), svg: svg ? Math.round(svg.getBoundingClientRect().width) : null, video: Boolean(f.querySelector("video")), iframe: Boolean(f.querySelector("iframe")) };
    });
    return { text: { left: Math.round(text.left), right: Math.round(text.right), w: Math.round(text.width) }, figs };
  });
  const chart = layout.figs.find((f) => f.svg);
  check("R14", Boolean(chart) && chart.right <= layout.text.right + 2 && chart.left >= layout.text.left - 2, `(${theme}) the 1400 px chart stays inside the text width`, `text ${layout.text.left}–${layout.text.right}; chart ${chart ? `${chart.left}–${chart.right} (svg ${chart.svg})` : "none"}`);
  // Typing beside the embed.
  await setMode(page, "editing");
  const cap = await find(page, "Video 1").catch(() => null);
  const para = await page.evaluate(() => {
    const ed = window.__docsEditor;
    let pos = null;
    let seen = false;
    ed.state.doc.descendants((n, p) => {
      if (pos !== null) return false;
      if (n.type.name === "figure" && /Video 1/.test(n.attrs.caption ?? "")) seen = true;
      else if (seen && n.isTextblock && n.textContent.length > 20) pos = p + 1;
      return !n.isTextblock;
    });
    return pos;
  });
  if (para !== null) {
    await clickPos(page, para);
    await page.keyboard.press("Home");
    await page.keyboard.type("QQ");
    await sleep(300);
    const where = await page.evaluate(() => ({ active: document.activeElement?.tagName, inPage: Boolean(document.activeElement?.closest(".ProseMirror")), typed: window.__docsEditor.state.doc.textContent.includes("QQ") }));
    check("R14", where.inPage && where.typed, `(${theme}) typing beside the embed types in the page`, JSON.stringify(where));
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
  } else fail("R14", `(${theme}) a paragraph after the embed`, `none (caption found ${Boolean(cap)})`);
  // Videos: paused far from the view, playing near it.
  const far = await page.evaluate(() => [...document.querySelectorAll(".docs-prose video")].map((v) => ({ paused: v.paused, top: Math.round(v.getBoundingClientRect().top) })));
  await page.evaluate(() => document.querySelector(".docs-prose video")?.scrollIntoView({ block: "center" }));
  await sleep(2500);
  const near = await page.evaluate(() => [...document.querySelectorAll(".docs-prose video")].map((v) => ({ paused: v.paused, time: v.currentTime, top: Math.round(v.getBoundingClientRect().top) })));
  const path = await shot(page, `R14-video-${theme}`);
  check("R14", near.length > 0 && near.some((v) => !v.paused || v.time > 0), `(${theme}) a looping video plays once near the view`, `far ${JSON.stringify(far)}, near ${JSON.stringify(near)} ${path}`);
  if (far.length && far.some((v) => v.top > 1200 && !v.paused)) fail("R14", `(${theme}) a video far below the view waits`, JSON.stringify(far));
  await waitSaved(page).catch(() => {});
  if (errors.length) note("R14", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R15: a re-parse keeps the old figure media while a version holds them:
// Restore "Imported" shows the figures.
RISKS.R15 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const web = await fresh("url", "-r15");
  const oldMedia = await db.figureMedia.findMany({ where: { documentId: web.id }, select: { id: true } });
  const re = await api(`/api/documents/${web.id}/reparse`, "POST", {});
  const media = await db.figureMedia.findMany({ where: { documentId: web.id }, select: { id: true } });
  const kept = oldMedia.every((m) => media.some((x) => x.id === m.id));
  check("R15", re.status === 200 && kept, "a re-parse keeps the figure media the version \"Imported\" points at", `HTTP ${re.status}; media ${oldMedia.length} → ${media.length}, old kept ${kept}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, web.id);
  const versions = await api(`/api/documents/${web.id}/versions`);
  const imported = Array.isArray(versions.body) ? versions.body.find((v) => v.name === "Imported") : (versions.body.versions ?? []).find((v) => v.name === "Imported");
  if (!imported) {
    fail("R15", "the version \"Imported\" is listed", clip(JSON.stringify(versions.body), 200));
    await context.close();
    return;
  }
  const v = await api(`/api/documents/${web.id}/versions/${imported.id}`);
  const restored = v.body.richText ?? v.body.version?.richText;
  const row = await documentRow(web.id);
  const put = await api(`/api/documents/${web.id}/rich-text`, "PUT", { richText: restored, rev: row.richTextRev });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(3000);
  const figs = await figures(page);
  const shown = await page.evaluate(() => [...document.querySelectorAll(".docs-prose figure img, .docs-prose figure svg")].filter((m) => m.getBoundingClientRect().width > 20).length);
  const path = await shot(page, "R15-restored-imported");
  check("R15", put.status === 200 && figs.length > 0 && figs.every((f) => oldMedia.some((m) => m.id === f.mediaId)) && shown > 0, "Restore \"Imported\" after a re-parse: the figures show", `PUT ${put.status}; ${figs.length} figure objects, ${shown} media drawn ${path}`);
  if (errors.length) note("R15", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R16: dark mode: each chart on its plate.
RISKS.R16 = async (theme) => {
  if (theme !== "dark") return;
  const web = await doc("url");
  const pdf = await doc("pdf");
  for (const d of [web, pdf]) {
    const { page, context } = await newPage("dark");
    await open(page, ctx.notebookId, d.id);
    const figs = await figures(page);
    const plates = [];
    for (const f of figs.slice(0, 4)) {
      await reveal(page, f.pos);
      await sleep(600);
      plates.push(await page.evaluate((p) => {
        const el = window.__docsEditor.view.nodeDOM(p);
        const media = el?.querySelector("svg, img");
        if (!media) return null;
        // The first painted background behind the media.
        let node = media;
        let bg = "none";
        while (node && node !== el.parentElement) {
          const c = getComputedStyle(node).backgroundColor;
          if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
            bg = c;
            break;
          }
          node = node.parentElement;
        }
        return { tag: media.tagName, bg };
      }, f.pos));
      await shot(page, `R16-dark-${d === web ? "web" : "pdf"}-figure-${plates.length}`);
    }
    const light = (c) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c ?? "");
      return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 200 : false;
    };
    const svgs = plates.filter((p) => p?.tag?.toLowerCase() === "svg");
    check("R16", svgs.length === 0 || svgs.every((p) => light(p.bg)), `dark: each chart of the ${d === web ? "web page" : "PDF"} sits on a light plate`, JSON.stringify(plates));
    await context.close();
  }
};

// R17: Side by Side with a PDF and a web page.
RISKS.R17 = async (theme) => {
  const pdf = await doc("pdf");
  const web = await doc("url");
  const { page, errors, context } = await newPage(theme, { width: 1680, height: 1000 });
  await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${pdf.id}&split=${web.id}`, { waitUntil: "domcontentloaded" });
  await sleep(8000);
  let panes = await page.evaluate(() => [...document.querySelectorAll(".docs-prose")].length);
  if (panes < 2) {
    // The split opens from the document list's side-by-side control.
    const split = page.locator('[data-track="view:split"], [data-track="pane-document:right"]').first();
    if (await split.count()) {
      await split.click();
      await sleep(1500);
    }
    panes = await page.evaluate(() => [...document.querySelectorAll(".docs-prose")].length);
  }
  const path = await shot(page, `R17-side-by-side-${theme}`);
  check("R17", panes === 2, `(${theme}) Side by Side shows the PDF and the web page in two page editors`, `${panes} page editors ${path}`);
  if (panes === 2) {
    const starts = await page.evaluate(() => [...document.querySelectorAll(".docs-prose")].map((p) => p.querySelectorAll(".docs-page-start[data-page-start]").length));
    check("R17", starts[0] > 0 || starts[1] > 0, `(${theme}) the PDF's page starts draw in its pane`, JSON.stringify(starts));
  }
  if (errors.length) note("R17", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R18: the refresh after a note: its payload on the paper.
RISKS.R18 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const pdf = await doc("pdf");
  const { page, context } = await newPage(theme);
  const sizes = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes(`/n/${ctx.notebookId}`) && (r.request().headers()["rsc"] || u.includes("_rsc"))) {
      const body = await r.body().catch(() => null);
      if (body) sizes.push(body.length);
    }
  });
  await open(page, ctx.notebookId, pdf.id);
  await selectWords(page, "Recurrent neural networks").catch(() => {});
  const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
  if (await colors.count()) await colors.first().click();
  await sleep(5000);
  const page0 = await fetch(`${BASE}/n/${ctx.notebookId}?doc=${pdf.id}`).then((r) => r.text());
  time("R18", "the refresh payload on the paper", `${sizes.length ? sizes.map((s) => `${(s / 1024).toFixed(0)} KB`).join(", ") : "no RSC refresh seen"}; the full page ${(page0.length / 1024).toFixed(0)} KB`);
  check("R18", sizes.every((s) => s < 1024 * 1024) && page0.length < 1024 * 1024 * 2, "the refresh stays under 1 MB on the 15-page paper", sizes.join(", "));
  await context.close();
};

// R20: after a re-parse the figures show their new crops, no 404.
RISKS.R20 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const pdf = await fresh("pdf", "-r20");
  const { page, errors, context, responses } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const re = await api(`/api/documents/${pdf.id}/reparse`, "POST", {});
  await sleep(10000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  const figs = await figures(page);
  for (const f of figs) {
    await reveal(page, f.pos);
    await sleep(250);
  }
  await sleep(2000);
  const failed = responses.filter((r) => /\/figure\//.test(r.url) && r.status >= 400);
  const loaded = await page.evaluate(() => [...document.querySelectorAll(".docs-prose img")].map((i) => i.complete && i.naturalWidth > 0));
  check("R20", re.status === 200 && failed.length === 0 && loaded.every(Boolean), "after a re-parse every figure loads its new crop, no 404", `HTTP ${re.status}; ${loaded.filter(Boolean).length}/${loaded.length} images; failed ${failed.map((f) => `${f.status} ${f.url}`).slice(0, 2).join(" ")}`);
  if (errors.length) note("R20", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R21: a kicker above the Title: the stored contents never make the Title a part.
RISKS.R21 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const web = await doc("url");
  for (let i = 0; i < 20; i++) {
    const row = await documentRow(web.id);
    if (Array.isArray(row.contents) && row.contents.length) break;
    await sleep(1500);
  }
  const row = await documentRow(web.id);
  const titleRow = (await rowsOf(web.id)).find((r) => r.type === "HEADING" && r.text === "The Quiet Engine of River Deltas");
  const parts = Array.isArray(row.contents) ? row.contents : [];
  const titlePart = parts.find((p) => p.blockId === titleRow?.id);
  check("R21", parts.length > 0 && !titlePart, "a kicker above the Title: the Title is not a part of the contents", `${parts.length} parts: ${parts.slice(0, 4).map((p) => `"${clip(p.title, 30)}"`).join(", ")}${titlePart ? `; the Title is part "${titlePart.title}"` : ""}`);
};

// R22: dragging a figure object in Editing keeps it in place; cut and paste
// moves it (R5 covers the paste).
RISKS.R22 = async (theme) => {
  const web = await fresh("url", `-r22${theme[0]}`);
  const { page, context } = await newPage(theme);
  await open(page, ctx.notebookId, web.id);
  await setMode(page, "editing");
  const figs = await figures(page);
  const f = figs.find((x) => /Figure 4/.test(x.caption ?? "")) ?? figs[0];
  const order = async () => (await figures(page)).map((x) => x.caption);
  const before = await order();
  await reveal(page, f.pos);
  const box = await page.evaluate((p) => window.__docsEditor.view.nodeDOM(p).getBoundingClientRect().toJSON(), f.pos);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 300, { steps: 20 });
  await page.mouse.up();
  await sleep(800);
  const after = await order();
  const text = await page.evaluate(() => window.__docsEditor.state.doc.textContent.length);
  check("R22", JSON.stringify(before) === JSON.stringify(after), `(${theme}) a drag on a figure object in Editing leaves it in place`, `order kept ${JSON.stringify(before) === JSON.stringify(after)}; words ${text}`);
  await context.close();
};

// R23: Find matches a phrase across a page start.
RISKS.R23 = async (theme) => {
  const pdf = await doc("pdf");
  const { page, context } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const s = (await pageStarts(page)).find((x) => x.on === "paragraph" && x.before.length >= 12 && x.after.length >= 12);
  const phrase = `${s.before.slice(-12)}${s.after.slice(0, 12)}`.trim();
  await page.click(".docs-prose");
  await page.keyboard.press("Control+f");
  await sleep(400);
  await page.keyboard.type(phrase, { delay: 20 });
  await sleep(1200);
  const count = await page.evaluate(() => document.querySelector(".docs-find-counter")?.textContent ?? "");
  const path = await shot(page, `R23-find-across-page-start-${theme}`);
  check("R23", /\b1 of 1\b/.test(count), `(${theme}) Find matches "${phrase}" across p. ${s.page}`, `bar "${clip(count, 60)}" ${path}`);
  await page.keyboard.press("Escape");
  await context.close();
};

// C2: the assistant's suggestions on an import: a page start passes, a
// figure is an object, the landing switches Viewing to Editing, Accept
// keeps "p. N". First the landing's own ops (window.__applyAssistantOps),
// then the assistant's bar with the model mock, as a person uses it.
RISKS.C2 = async (theme) => {
  const pdf = await fresh("pdf", `-c2${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const s = (await pageStarts(page)).find((x) => x.on === "paragraph" && x.before.length >= 30 && x.after.length >= 30);
  const base = await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, s.pos);
  const fig = (await figures(page))[0];
  // One word changed on each side of the page start.
  const changed = base.replace(/\bthe\b/, "one").replace(/\bthe\b(?![\s\S]*\bthe\b)/, "one");
  const ops = [
    { i: 0, op: "rewrite_block", blockId: s.blockId, base, text: changed, why: "QA: a word changed on each side of a page start." },
    { i: 1, op: "rewrite_block", blockId: fig.blockId, base: fig.caption, text: "A new caption", why: "QA: a caption is the figure's." },
  ];
  const landed = await page.evaluate((o) => (window.__applyAssistantOps ? window.__applyAssistantOps(o) : null), ops);
  await sleep(1200);
  const m = await mode(page);
  check("C2", Array.isArray(landed?.ids) && landed.ids.length > 0, `(${theme}) a rewrite across p. ${s.page} lands`, clip(JSON.stringify(landed), 160));
  check("C2", (landed?.skipped ?? []).some((k) => k.i === 1 && k.reason === "object"), `(${theme}) an op on a figure is skipped as "object"`, clip(JSON.stringify(landed?.skipped), 120));
  check("C2", m === "editing", `(${theme}) suggestions landing on an import in Viewing switch it to Editing`, `mode ${m}`);
  const still = (await pageStarts(page)).filter((x) => x.page === s.page);
  check("C2", still.length === 1, `(${theme}) the pending suggestion across p. ${s.page} keeps the page start`, `${still.length}${still[0] ? ` before "${still[0].before.slice(-15)}" after "${still[0].after.slice(0, 15)}"` : ""}`);
  const pendingShot = await shot(page, `C2-pending-across-page-start-${theme}`);
  // Accept all suggestions (Search the menus): the words change, "p. N"
  // stays where the page begins.
  const accepted = await menuCommand(page, "Accept all suggestions");
  await sleep(800);
  const after = (await pageStarts(page)).filter((x) => x.page === s.page);
  const text = await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, after[0]?.pos ?? s.pos);
  const acceptShot = await shot(page, `C2-accepted-across-page-start-${theme}`);
  check("C2", after.length === 1 && text === changed, `(${theme}) Accept keeps "p. ${s.page}" and takes the new words`, `accept ${accepted}; page starts ${after.length}; words ${text === changed ? "the suggestion's" : `"${clip(text, 60)}"`} ${pendingShot} ${acceptShot}`);
  await waitSaved(page).catch(() => {});
  // The bar, as a person uses it: select words across the page start, the
  // toolbar's Assistant, the Shorten chip; the mock's suggestion lands.
  const s2 = (await pageStarts(page)).find((x) => x.page !== s.page && x.on === "paragraph" && x.before.length >= 30 && x.after.length >= 30);
  if (s2) {
    await dragSelect(page, s2.pos - 25, s2.pos + 1 + 25);
    const assistant = page.locator('[data-selection-popover] [data-track="assistant"]').first();
    if (await assistant.count()) {
      await assistant.click();
      await sleep(800);
      const chips = await page.evaluate(() => [...document.querySelectorAll('[data-track^="assistant-command:"]')].map((b) => b.dataset.track));
      const bar = await page.evaluate(() => Boolean(document.querySelector("[data-assistant-bar]")));
      check("C2", bar && chips.length >= 7, `(${theme}) on an import the toolbar's Assistant opens the bar with the seven commands`, `bar ${bar}, chips ${chips.length}`);
      const shorten = page.locator('[data-track="assistant-command:shorten"], [data-track^="assistant-command:"]').first();
      if (await shorten.count()) {
        await shorten.click();
        await page.waitForFunction(() => document.querySelectorAll(".docs-prose [data-suggestion]").length > 0, null, { timeout: 60_000 }).catch(() => {});
        await sleep(1000);
        const marks = await page.evaluate(() => [...document.querySelectorAll(".docs-prose [data-suggestion]")].map((e) => e.textContent).join(" | "));
        const kept = (await pageStarts(page)).filter((x) => x.page === s2.page).length;
        const barShot = await shot(page, `C2-bar-shorten-${theme}`);
        check("C2", marks.length > 0 && kept === 1, `(${theme}) Shorten across p. ${s2.page} lands suggestions and keeps the page start`, `suggested "${clip(marks, 80)}", page starts ${kept} ${barShot}`);
        const reject = page.locator('[data-assistant-bar] button:has-text("Reject")').first();
        if (await reject.count()) await reject.click();
        await sleep(600);
      }
    } else fail("C2", `(${theme}) the toolbar's Assistant`, "no Assistant in the toolbar");
  }
  await waitSaved(page).catch(() => {});
  if (errors.length) note("C2", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await prepare();
  const names = Object.keys(RISKS).filter((n) => n === "SETUP" || ONLY.size === 0 || ONLY.has(n));
  for (const theme of THEMES) {
    for (const name of names) {
      if (name === "SETUP" && theme !== THEMES[0]) continue;
      try {
        await RISKS[name](theme);
      } catch (err) {
        record("FAIL", name, `(${theme}) crashed`, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
      }
    }
  }
}

main()
  .catch((err) => record("FAIL", "RUN", "crashed", String(err?.stack ?? err).split("\n").slice(0, 4).join(" | ")))
  .finally(async () => {
    const failed = results.filter((r) => r.level === "FAIL").length;
    const passed = results.filter((r) => r.level === "PASS").length;
    console.log(`\n${passed} passed, ${failed} failed, ${results.filter((r) => r.level === "TIME").length} timings`);
    writeFileSync(join(SHOT, `results-${STAMP}.json`), JSON.stringify(results, null, 1));
    if (!KEEP && ctx.notebookId) {
      try {
        await api(`/api/notebooks/${ctx.notebookId}`, "DELETE");
      } catch {
        // The project stays; it is named by the run's stamp.
      }
    }
    await browser?.close().catch(() => {});
    ctx.server?.close();
    await db.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
