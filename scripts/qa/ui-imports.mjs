// UI walk of the imports' risks (the imports design 1.11 and section 5; the
// round 10 plan): a PDF, a web page, and a Markdown file added to a local
// Unitos with the switch on (IMPORT_PAGE_EDITOR=on) open in the page editor,
// and every risk is walked in headless Chromium at a person's pace, in the
// light and the dark theme. R4 and R19 are out (C1: a table is a row per
// cell paragraph). Each check prints PASS or FAIL with its evidence: a
// number, a screenshot path. The timings for the size guard (1.8) print as
// TIME lines.
//
// Beyond the risks, four groups: C2 (the assistant's suggestions on an
// import), EDIT (typing in a highlight, Suggesting, two tabs), AUDIT (the
// design's section 5 checklist, as a Google Docs reader checks it), and AI
// (the Unitos tools, annotations, and notes on an import's text).
//
// Usage:
//   node scripts/qa/ui-imports.mjs [R1 R3 … C2 EDIT AUDIT AI] [--theme light|dark|both] [--keep]
// With nothing named, everything runs. Env: BASE (default
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
const ONLY = new Set(args.filter((a, i) => /^R\d+$|^C2$|^AUDIT$|^AI$|^EDIT$/.test(a) && args[i - 1] !== "--theme"));
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
  return new Promise((resolve, reject) => {
    server.once("error", (err) => reject(new Error(`the fixture server cannot listen on ${FIXTURE_PORT} (${err.code}): set FIXTURE_PORT`)));
    server.listen(FIXTURE_PORT, () => resolve(server));
  });
}

// ── The browser ─────────────────────────────────────────────────────────────

let browser;
async function newPage(theme = "light", { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await context.newPage();
  const errors = [];
  // The dev server's reloads while files change: a hydration mismatch and
  // two React warnings that any document shows now and then (a blank one
  // too), not the page under test.
  const ignorable = (t) =>
    /ERR_CERT|fonts\.g|Failed to load resource|youtube|ERR_TUNNEL|ERR_PROXY|net::ERR|Hydration failed|Can't perform a React state update on a component that hasn't mounted|Encountered a script tag/.test(t);
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
async function toasts(page) {
  return page.evaluate(() => window.__toasts ?? []);
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


/** Center a figure object and click its media (or its middle), as a person
    clicks a picture. Returns the point pressed. */
async function clickFigure(page, pos) {
  await page.evaluate((p) => window.__docsEditor.view.nodeDOM(p)?.scrollIntoView({ block: "center" }), pos);
  await sleep(600);
  const box = await page.evaluate((p) => {
    const el = window.__docsEditor.view.nodeDOM(p);
    const media = el?.querySelector("img, svg, video, iframe") ?? el;
    return media?.getBoundingClientRect().toJSON() ?? null;
  }, pos);
  if (!box) return null;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 120);
  await clickAt(page, x, y);
  await sleep(600);
  return { x, y };
}

/** Toasts, as the page announces them (the dissect:toast event). */
async function listenToasts(page) {
  await page.evaluate(() => {
    if (window.__toasts) return;
    window.__toasts = [];
    window.addEventListener("dissect:toast", (e) => window.__toasts.push(e.detail?.text ?? JSON.stringify(e.detail)), true);
  });
}


/** Scroll each figure object into view and wait for its image, as a person
    scrolls through: lazy images load only near the view. Returns
    {loaded, total}. */
async function loadFigureImages(page) {
  const figs = await figures(page);
  let loaded = 0;
  let total = 0;
  for (const f of figs) {
    await page.evaluate((p) => window.__docsEditor.view.nodeDOM(p)?.scrollIntoView({ block: "center" }), f.pos);
    const ok = await page
      .waitForFunction((p) => {
        const imgs = [...(window.__docsEditor.view.nodeDOM(p)?.querySelectorAll("img") ?? [])];
        return imgs.length === 0 ? "none" : imgs.every((i) => i.complete && i.naturalWidth > 0) ? "ok" : null;
      }, f.pos, { timeout: 15_000 })
      .then((h) => h.jsonValue())
      .catch(() => "failed");
    if (ok === "none") continue;
    total++;
    if (ok === "ok") loaded++;
  }
  return { loaded, total };
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


/** What a person sees at the top of the page: the first block under the
    page editor's header (title row, toolbar, ruler), and how far its top
    stands from the header's bottom. The reader's own reading line
    (lib/reading-position.ts, 80 px under the pane's top) lies under that
    header; this is the line in view. Runs in the page. */
function readingLine() {
  const header = document.querySelector(".docs-header")?.getBoundingClientRect();
  const top = (header ? header.bottom : 0) + 8;
  const els = [...document.querySelectorAll(".docs-prose [data-block-id]")];
  const hit = els.find((e) => e.getBoundingClientRect().bottom > top);
  let saved = null;
  try {
    saved = Object.entries(sessionStorage).find(([k]) => k.startsWith("unitos-reader-position:"))?.[1] ?? null;
  } catch {
    saved = null;
  }
  return hit ? { id: hit.dataset.blockId, dy: Math.round(hit.getBoundingClientRect().top - top), text: hit.textContent.slice(0, 40), saved: saved ? JSON.parse(saved).blockId : null } : null;
}

// ── The run's documents ─────────────────────────────────────────────────────

const ctx = { notebookId: null, sectionId: null, docs: {}, bytes: {}, media: null };

async function prepare() {
  browser = await chromium.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
  ctx.media = await drawMedia(browser);
  const files = { ...ctx.media };
  files["/article.html"] = { type: "text/html; charset=utf-8", body: Buffer.from(articleHtml(STAMP)) };
  files["/article-2.html"] = { type: "text/html; charset=utf-8", body: Buffer.from(articleHtml(`${STAMP}-2`)) };
  ctx.server = await serveFixtures(files);
  mkdirSync(join(SHOT, "fixtures"), { recursive: true });
  for (const [path, file] of Object.entries(files)) writeFileSync(join(SHOT, "fixtures", path.slice(1)), file.body);
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
  const { page, context } = await newPage(THEMES[0]);
  for (const kind of ["pdf", "url", "markdown"]) {
    const added = await doc(kind);
    const row = await documentRow(added.id);
    const versions = await db.documentVersion.findMany({ where: { documentId: added.id }, select: { rev: true, name: true } });
    const figureMedia = await db.figureMedia.count({ where: { documentId: added.id } });
    check("SETUP", Boolean(row?.richText) && typeof row?.importRev === "number" && row.importRev === row.richTextRev, `a ${kind} add is an import`, `richText ${row?.richText ? "set" : "null"}, richTextRev ${row?.richTextRev}, importRev ${row?.importRev}, add ${added.ms} ms, figure media ${figureMedia}, versions ${JSON.stringify(versions)}`);
    check("SETUP", versions.some((v) => v.name === "Imported"), `a ${kind} import keeps the version "Imported"`, JSON.stringify(versions));
    const times = await open(page, ctx.notebookId, added.id);
    check("SETUP", await isPageEditor(page), `a ${kind} import opens in the page editor`, `text after ${times.text} ms, the editor after ${times.ready} ms`);
  }
  await context.close();
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
    frame: Boolean(document.querySelector(".docs-shell .docs-title-row")),
    says: [...document.querySelectorAll(".docs-shell p, .docs-shell div")].map((e) => e.textContent).find((t) => /can.t show/.test(t ?? "")) ?? null,
    title: document.querySelector(".docs-title-row")?.textContent.slice(0, 60) ?? null,
  }));
  const path = await shot(page, `R2-unknown-node-${theme}`);
  const stored = await documentRow(added.id);
  const kept = JSON.stringify(stored.richText).includes("futureObject");
  check("R2", loads <= 2 && (state.prose > 0 || state.frame) && kept, `(${theme}) a stored node this build lacks: the frame or the page shows, it reloads at most once, the stored copy keeps the node`, `loads ${loads}, prose ${state.prose} chars, frame ${state.frame}, says "${clip(state.says, 90)}", stored keeps it ${kept}, ${path}`);
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
  if (await colors.count()) await colors.first().click();
  let sources = await sourcesOf(added.id);
  for (let i = 0; i < 40 && sources.length <= sourcesBefore; i++) {
    await sleep(500);
    sources = await sourcesOf(added.id);
  }
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
  // Backspace at the page start, in Editing, as a person holds it: each press
  // takes the letter before the page start, and the page start stays.
  await setMode(page, "editing");
  const again = (await pageStarts(page)).find((x) => x.page === s.page);
  await clickPos(page, again.pos + 1);
  const textBefore = await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, again.pos);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Backspace");
    await sleep(200);
  }
  const afterBackspace = (await pageStarts(page)).filter((x) => x.page === s.page);
  const textAfter = afterBackspace.length ? await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, afterBackspace[0].pos) : "";
  check("R3", afterBackspace.length === 1 && textAfter.length === textBefore.length - 3, `(${theme}) three Backspaces at p. ${s.page} take three letters before it and keep the page start`, `page starts for p. ${s.page}: ${afterBackspace.length}; words ${textBefore.length} → ${textAfter.length}; before it now "${afterBackspace[0]?.before.slice(-12) ?? ""}"`);
  await page.keyboard.press("Control+z");
  await sleep(300);
  // A page that begins at a paragraph's start: Backspace joins the paragraph
  // to the one above, and the page start stays where its words begin.
  const opening = (await pageStarts(page)).find((x) => x.page > 1 && x.on === "paragraph" && x.before === "" && x.after.length > 10);
  if (opening) {
    const count = () => page.evaluate(() => {
      let n = 0;
      window.__docsEditor.state.doc.descendants((node) => {
        if (node.isTextblock) n++;
        return !node.isTextblock;
      });
      return n;
    });
    const paragraphs = await count();
    await clickPos(page, opening.pos + 1);
    await page.keyboard.press("Backspace");
    await sleep(300);
    const joined = (await pageStarts(page)).filter((x) => x.page === opening.page);
    const paragraphsAfter = await count();
    check("R3", joined.length === 1 && paragraphsAfter === paragraphs - 1 && joined[0].before.length > 0, `(${theme}) Backspace at a paragraph that opens with p. ${opening.page} joins it to the one above, the page start kept`, `paragraphs ${paragraphs} → ${paragraphsAfter}; p. ${opening.page} now after "${joined[0]?.before.slice(-15) ?? ""}"`);
    await page.keyboard.press("Control+z");
    await sleep(300);
  }
  // A deletion that takes the page start with words on both sides.
  const cur = (await pageStarts(page)).find((x) => x.page === s.page) ?? again;
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
  await clickFigure(page, fig3.pos);
  const tools = await popoverOpen(page);
  const analyze = page.locator('[data-selection-popover] [data-track="analyze"]');
  check("R5", tools && (await analyze.count()) > 0, `(${theme}) a click on a figure opens its tools with Analyze`, `toolbar ${tools}`);
  if (await analyze.count()) {
    await analyze.click();
    for (let i = 0; i < 60 && !(await sourcesOf(added.id)).some((x) => x.blockId === fig3.blockId); i++) await sleep(500);
    await sleep(1500);
  }
  let sources = await sourcesOf(added.id);
  const src = sources.find((s) => s.blockId === fig3.blockId);
  check("R5", Boolean(src), `(${theme}) Analyze anchors to the figure's row`, src ? `quote "${src.quotedText}" ${src.note.derivationType}` : JSON.stringify(sources.map((s) => s.quotedText)));
  // The ring in the kind color, the label chip, data-source-id: painted once
  // the stored annotation is on screen, with the figure no longer selected.
  await page.keyboard.press("Escape");
  await page.waitForFunction((p) => window.__docsEditor.view.nodeDOM(p)?.hasAttribute("data-source-id"), fig3.pos, { timeout: 20_000 }).catch(() => {});
  const ring = await page.evaluate((p) => {
    const el = window.__docsEditor.view.nodeDOM(p);
    if (!el) return null;
    const f = el.getBoundingClientRect();
    const label = [...document.querySelectorAll(".docs-object-label")].find((c) => {
      const r = c.getBoundingClientRect();
      return Math.abs(r.top - f.top) < 40 && r.width > 0;
    });
    return { sourceId: el.getAttribute("data-source-id"), ring: el.getAttribute("style"), shadow: getComputedStyle(el).boxShadow.slice(0, 60), label: label?.textContent ?? null };
  }, fig3.pos);
  const ringShot = await shot(page, `R5-analyze-ring-${theme}`);
  check("R5", Boolean(ring?.sourceId) && /kind-analyze/.test(ring?.ring ?? "") && Boolean(ring?.label), `(${theme}) the analyzed figure rings in the kind color with its label chip and data-source-id`, `${JSON.stringify(ring)} ${ringShot}`);
  if (!src) {
    await context.close();
    return;
  }
  // Delete the figure in Editing, as a person: a click on it, Escape for its
  // tools, Delete.
  await setMode(page, "editing");
  const pick = async (caption) => {
    const f = (await figures(page)).find((x) => (x.caption ?? "").trim() === caption);
    if (!f) return null;
    const selected = () => page.evaluate((p) => {
      const sel = window.__docsEditor.state.selection;
      return sel.constructor.name === "NodeSelection" && sel.from === p;
    }, f.pos);
    await clickFigure(page, f.pos);
    await page.keyboard.press("Escape");
    await sleep(200);
    // A press that closed an open card selects nothing: a person presses again.
    if (!(await selected())) {
      note("R5", `(${theme}) the first press on "${caption}" did not select it`, "a second press does");
      await clickFigure(page, f.pos);
      await page.keyboard.press("Escape");
      await sleep(200);
    }
    return f;
  };
  await pick("Figure 3");
  const beforeDelete = await page.evaluate(() => {
    const sel = window.__docsEditor.state.selection;
    return `${sel.constructor.name} ${sel.from}-${sel.to}, focus ${document.activeElement?.className?.slice?.(0, 30) ?? document.activeElement?.tagName}`;
  });
  await page.keyboard.press("Delete");
  await waitSaved(page);
  await sleep(1500);
  sources = await sourcesOf(added.id);
  const afterDelete = sources.find((s) => s.id === src.id);
  const movedTo = afterDelete && !afterDelete.orphaned ? await rowText(afterDelete.blockId) : null;
  const gone = !(await figures(page)).some((f) => (f.caption ?? "").trim() === "Figure 3");
  check("R5", gone && afterDelete?.orphaned === true, `(${theme}) deleting the figure orphans its annotation (never moves it into "As Figure 3 shows")`, afterDelete ? `before Delete: ${beforeDelete}; figure gone ${gone}, orphaned ${afterDelete.orphaned}${movedTo ? `, now on ${movedTo.type} "${clip(movedTo.text, 60)}"` : ""}` : "source gone");
  // Ctrl+Z brings the figure and its annotation back.
  await page.keyboard.press("Control+z");
  await waitSaved(page);
  await sleep(1500);
  sources = await sourcesOf(added.id);
  const back = sources.find((s) => s.id === src.id);
  const figsBack = await figures(page);
  const onFigure = back && figsBack.some((f) => f.blockId === back.blockId);
  check("R5", Boolean(back && !back.orphaned && onFigure), `(${theme}) Ctrl+Z brings the figure back and its annotation with it`, back ? `orphaned ${back.orphaned}, on a figure ${onFigure}` : "source gone");
  // Cut and paste the figure under the heading "The measurements": it moves,
  // and the annotation follows it.
  const index = async () => page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.forEach((n) => out.push(n.type.name === "figure" ? `F:${n.attrs.caption.trim()}` : n.textContent.slice(0, 20)));
    return { figure: out.indexOf("F:Figure 3"), heading: out.indexOf("The measurements") };
  });
  const before = await index();
  if (await pick("Figure 3")) {
    await page.keyboard.press("Control+x");
    await sleep(500);
    const target = await find(page, "The measurements");
    await clickPos(page, target.to);
    const caret = await page.evaluate(() => window.__docsEditor.state.selection.$from.parent.textContent.slice(0, 20));
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    await waitSaved(page);
    await sleep(1500);
    const after = await index();
    const moved = (await figures(page)).find((f) => f.caption?.trim() === "Figure 3");
    sources = await sourcesOf(added.id);
    const followed = sources.find((s) => s.id === src.id);
    check("R5", Boolean(moved && after.figure > after.heading && followed && !followed.orphaned && followed.blockId === moved.blockId), `(${theme}) cut and paste moves the figure under "The measurements" and the annotation follows it`, `caret in "${caret}"; figure at ${before.figure} → ${after.figure} (heading ${after.heading}); source on ${followed?.blockId === moved?.blockId ? "the moved figure" : followed?.blockId} orphaned ${followed?.orphaned}`);
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
  await clickFigure(page, figs[0].pos);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+c");
  await sleep(400);
  const copied = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      const html = items[0]?.types.includes("text/html") ? await (await items[0].getType("text/html")).text() : "";
      return { html: html.includes("data-docs-figure"), media: /data-media-id="[^"]+"/.exec(html)?.[0] ?? null };
    } catch (e) {
      return { error: String(e) };
    }
  });
  note("R6", `(${theme}) the clipboard after Ctrl+C on a figure`, JSON.stringify(copied));
  await open(page, ctx.notebookId, target.id);
  await listenToasts(page);
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
  await page.waitForFunction(() => (document.querySelector('[data-side-card="explain"]')?.textContent ?? "").includes("Mock"), null, { timeout: 45_000 }).catch(() => {});
  const explain = await page.locator('[data-side-card="explain"]').first().innerText().catch(() => "");
  check("R7", explain.length > 20, `(${theme}) Explain answers in Viewing`, clip(explain, 80));
  const kinds = (await sourcesOf(added.id)).map((s) => s.note.derivationType ?? (s.note.color ? `highlight:${s.note.color}` : "comment"));
  note("R7", `(${theme}) annotations made in Viewing`, kinds.join(", "));
  // The queue's keys reach the notes tray.
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 450);
  await sleep(300);
  const focusBefore = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}.${String(a.className).slice(0, 40)}${a.closest("[data-comment-card]") ? " (in a comment card)" : ""}` : "none";
  });
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
  check("R7", (counts.ACCEPTED ?? 0) >= 1 && (counts.REJECTED ?? 0) >= 1, `(${theme}) in Viewing, j k Enter Backspace act on the pending notes`, `${JSON.stringify(counts)}; focus before the keys: ${focusBefore}`);
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
  // The document list asks first: ⋮ on the document's row, Re-parse, and
  // the question; Keep the edits keeps them.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  await sleep(800);
  let asked = null;
  await page.locator('[data-track="strip-documents"], [data-track="document-list"]').first().click().catch(() => {});
  await sleep(700);
  // The open document's row is the active one; its ⋮ stands beside it.
  const actions = page.locator('[data-track="document-open"][data-active-row]').first().locator("xpath=..").locator('[data-track="document-actions"]').first();
  if (await actions.count()) {
    await actions.click();
    await sleep(500);
    await page.locator('[data-track="document-reparse"]').first().click().catch(() => {});
    await sleep(600);
    asked = await page.evaluate(() => {
      const keep = document.querySelector('[data-track="document-reparse-keep"]');
      return keep ? keep.closest('[role="group"]')?.textContent ?? "" : null;
    });
    await shot(page, "R8-reparse-asks");
    await page.locator('[data-track="document-reparse-keep"]').first().click().catch(() => {});
    await sleep(1500);
  }
  const keptAfterNo = JSON.stringify((await documentRow(added.id)).richText).includes("(edited)");
  check("R8", Boolean(asked && /edit/i.test(asked)) && keptAfterNo, "Re-parse on an edited import asks first, and Keep keeps the edit", `${clip(asked ?? "no question found", 160)}; edit kept ${keptAfterNo}`);
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
    const suggest = await api(`/api/documents/${added.id}/suggest`, "POST", { notebookId: ctx.notebookId, command: "Shorten this paragraph.", blockIds: [block.id] });
    check("R9", suggest.status === 403, "the assistant's suggest route refuses a shared import with 403", `HTTP ${suggest.status} ${clip(JSON.stringify(suggest.body), 100)}`);
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
  // Its own copy: the paste and the deletion below change it.
  const pdf = await fresh("pdf", "-r11");
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
  // Two long PDFs: about 150 pages (near the guard's 1,500 rows) and about
  // 200 pages (past it). Each add says which form it took; the one in the
  // page editor is timed as the paper was.
  for (const target of [LONG_PAGES, Math.round(LONG_PAGES * 1.35)]) {
    const long = await longPdf(browser, target, `${STAMP}-${target}`);
    const added = await add(ctx.notebookId, { bytes: long.bytes, name: `long-${long.pages}-${STAMP}.pdf`, type: "application/pdf" });
    const row = added.id ? await documentRow(added.id) : null;
    const rows = added.id ? await db.block.count({ where: { documentId: added.id } }) : 0;
    const json = row?.richText ? JSON.stringify(row.richText).length : 0;
    time("R11", `the ${long.pages}-page PDF's add`, `${added.ms} ms, ${rows} rows, ${row?.richText ? `rich text ${json} chars` : "a block document"}, stages ${added.stages.join(" ")}, save detail ${clip(JSON.stringify(added.saveDetail), 120)}`);
    const past = rows > 1500 || json > 1_500_000;
    if (!row) {
      fail("R11", `the ${long.pages}-page PDF adds`, added.error ?? "no id");
      continue;
    }
    if (row.richText) {
      check("R11", !past, `the ${long.pages}-page PDF (${rows} rows) is under the guard and opens in the page editor`, `${rows} rows, ${json} chars`);
      const { page: longPage, context: longContext } = await newPage(theme);
      const opens = [];
      for (let i = 0; i < 2; i++) opens.push(await open(longPage, ctx.notebookId, added.id));
      await setMode(longPage, "editing");
      await installLatency(longPage);
      const mid = await longPage.evaluate(() => {
        const ed = window.__docsEditor;
        let pos = null;
        let n = 0;
        const half = Math.floor(ed.state.doc.childCount / 2);
        ed.state.doc.forEach((node, offset) => {
          if (pos === null && n >= half && node.type.name === "paragraph" && node.textContent.length > 40) pos = offset + 21;
          n++;
        });
        return pos;
      });
      await clickPos(longPage, mid);
      for (let i = 0; i < 24; i++) {
        await longPage.keyboard.press(i % 4 === 3 ? "Backspace" : "k");
        await sleep(110);
      }
      for (let i = 0; i < 6; i++) {
        await longPage.keyboard.press("Enter");
        await sleep(160);
        await longPage.keyboard.press("Backspace");
        await sleep(160);
      }
      const lat = await longPage.evaluate(() => window.__lat);
      const saved = longPage.waitForResponse((r) => r.url().includes("/rich-text") && r.request().method() === "PUT", { timeout: 60_000 }).catch(() => null);
      const t0 = Date.now();
      await longPage.keyboard.type("z");
      const resp = await saved;
      const stored = (await documentRow(added.id)).richText;
      time("R11", `the ${long.pages}-page import in the page editor`, `open to text/editor ${opens.map((o) => `${o.text}/${o.ready}`).join(", ")} ms; letters ${stats(lat.filter((l) => l.key.length === 1).map((l) => l.ms))}; Enter ${stats(lat.filter((l) => l.key === "Enter").map((l) => l.ms))}; a save answered ${resp?.status() ?? "none"} after ${Date.now() - t0} ms; stored ${JSON.stringify(stored).length} chars after the editor's saves (${json} at import)`);
      await longContext.close();
    } else {
      check("R11", past, `the size guard keeps the ${long.pages}-page PDF (${rows} rows) a block document`, `rows ${rows}`);
      check("R11", JSON.stringify(added.saveDetail ?? {}).includes("size"), `the add's save stage says the size guard kept the ${long.pages}-page PDF a block document`, clip(JSON.stringify(added.saveDetail), 160));
    }
  }
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
  const t0 = Date.now();
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 120_000 });
  const mounted = Date.now() - t0;
  await sleep(8000);
  const back = await page.evaluate(readingLine);
  const path = await shot(page, `R12-position-after-reload-${theme}`);
  check("R12", Boolean(at && back && at.id === back.id && Math.abs(at.dy - back.dy) < 40), `(${theme}) scrolled to p. ${twelve.page}, reloaded: the same line is at the top`, `position saved ${saved?.status() ?? "no PUT"}; the editor mounted ${mounted} ms after the reload; before ${JSON.stringify(at)}, after ${JSON.stringify(back)} ${path}`);
  await context.close();
};

// R13: the figure image URLs: the finishing step's list, the page's
// requests, and the offline copy agree.
RISKS.R13 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const pdf = await fresh("pdf", "-r13");
  const finish = await api(`/api/documents/${pdf.id}/finish`);
  const listed = JSON.stringify(finish.body).match(/\/api\/documents\/[^"\s]+\/figure\/[^"\s?]+/g) ?? [];
  const { page, context, responses } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const images = await loadFigureImages(page);
  const requested = [...new Set(responses.filter((r) => /\/figure\//.test(r.url)).map((r) => r.url.split("?")[0]))];
  const bad = responses.filter((r) => /\/figure\//.test(r.url) && r.status >= 400);
  const same = listed.length > 0 && requested.length > 0 && requested.every((u) => listed.includes(u)) && listed.every((u) => requested.includes(u));
  check("R13", same && bad.length === 0, "the finishing step lists the figure URLs the page requests", `finish HTTP ${finish.status}; listed ${listed.length}, requested ${requested.length}${requested.filter((u) => !listed.includes(u)).slice(0, 2).map((u) => `; not listed ${u}`).join("")}${listed.filter((u) => !requested.includes(u)).slice(0, 2).map((u) => `; not requested ${u}`).join("")}${bad.length ? `; ${bad.length} failed (${bad[0].status})` : ""}`);
  check("R13", images.total > 0 && images.loaded === images.total, "every figure image of the PDF import loads in view", `${images.loaded} of ${images.total}`);
  // The offline copy (lib/offline/saved.ts) collects the assets it finds in
  // the page: every figure URL must stand in the page's HTML. Opening the
  // copy offline needs the service worker, which registers in production only.
  const html = await fetch(`${BASE}/n/${ctx.notebookId}?doc=${pdf.id}`).then((r) => r.text());
  const found = new Set(html.match(/\/api\/(?:images\/[A-Za-z0-9_-]+|documents\/[A-Za-z0-9_-]+\/(?:figure|page)\/[A-Za-z0-9_-]+)/g) ?? []);
  const media = await db.figureMedia.findMany({ where: { documentId: pdf.id }, select: { id: true } });
  const missing = media.filter((m) => !found.has(`/api/documents/${pdf.id}/figure/${m.id}`));
  check("R13", missing.length === 0, "the page holds every figure URL the offline copy saves", `${media.length - missing.length} of ${media.length} figure URLs in the page (offline itself is not testable here: the service worker registers in production only)`);
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
  const videoState = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".docs-prose .docs-figure")].filter((f) => /Figure 5/.test(f.textContent)).map((f) => {
        const v = f.querySelector("video");
        return v
          ? { paused: v.paused, time: Math.round(v.currentTime * 10) / 10, ready: v.readyState, network: v.networkState, error: v.error?.code ?? null, src: (v.currentSrc || v.getAttribute("src") || "").slice(0, 60), top: Math.round(v.getBoundingClientRect().top), shown: f.textContent.slice(0, 60) }
          : { video: false, shown: f.textContent.slice(0, 80), top: Math.round(f.getBoundingClientRect().top) };
      }),
    );
  await page.evaluate(() => document.querySelector(".docs-prose")?.closest("[class*=overflow]")?.scrollTo?.(0, 0));
  const far = await videoState();
  const fig5 = (await figures(page)).find((f) => /Figure 5/.test(f.caption ?? ""));
  if (fig5) await page.evaluate((p) => window.__docsEditor.view.nodeDOM(p)?.scrollIntoView({ block: "center" }), fig5.pos);
  await sleep(3500);
  const near = await videoState();
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
  const shown = await page.evaluate(() => [...document.querySelectorAll(".docs-prose .docs-figure")].filter((f) => [...f.querySelectorAll("img, svg, iframe, video")].some((m) => m.getBoundingClientRect().width > 20)).length);
  const path = await shot(page, "R15-restored-imported");
  check("R15", put.status === 200 && figs.length > 0 && figs.every((f) => oldMedia.some((m) => m.id === f.mediaId)) && shown === figs.length, "Restore \"Imported\" after a re-parse: every figure shows its media", `PUT ${put.status}; ${figs.length} figure objects on the old media, ${shown} drawing their media ${path}`);
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
  await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${pdf.id}&view=side&doc2=${web.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".docs-prose").length === 2, null, { timeout: 90_000 }).catch(() => {});
  await sleep(2500);
  const panes = await page.evaluate(() => [...document.querySelectorAll(".docs-prose")].length);
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
  await open(page, ctx.notebookId, pdf.id);
  // Every answer the page takes after a note: the refresh is a fetch of the
  // page's own address (a server component payload).
  const sizes = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes(`/n/${ctx.notebookId}`) || r.request().resourceType() === "document") return;
    const body = await r.body().catch(() => null);
    if (body) sizes.push({ u: u.replace(BASE, "").slice(0, 60), kb: Math.round(body.length / 1024) });
  });
  const at = await find(page, "Recurrent neural networks");
  if (at) {
    await dragSelect(page, at.from, at.to);
    const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
    if (await colors.count()) await colors.first().click();
  }
  await sleep(8000);
  const full = await fetch(`${BASE}/n/${ctx.notebookId}?doc=${pdf.id}`).then((r) => r.text());
  time("R18", "the refresh payload on the paper after a note", `${sizes.length ? sizes.map((x) => `${x.kb} KB`).join(", ") : "no refresh seen"}; the full page ${Math.round(full.length / 1024)} KB`);
  check("R18", sizes.length > 0 && sizes.every((x) => x.kb < 1024), "the refresh after a note stays under 1 MB on the 15-page paper", JSON.stringify(sizes.slice(0, 4)));
  await context.close();
};

// R20: after a re-parse the figures show their new crops, no 404.
RISKS.R20 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const pdf = await fresh("pdf", "-r20");
  const { page, errors, context, responses } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  // A highlight before the re-parse: an unedited import keeps its ids where
  // the words match, so the highlight stays exact.
  const at = await find(page, "Recurrent neural networks");
  if (at) {
    await dragSelect(page, at.from, at.to);
    const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
    if (await colors.count()) await colors.first().click();
  }
  let before = null;
  for (let i = 0; i < 30 && !before; i++) {
    before = (await sourcesOf(pdf.id)).find((x) => x.quotedText === "Recurrent neural networks") ?? null;
    if (!before) await sleep(500);
  }
  const re = await api(`/api/documents/${pdf.id}/reparse`, "POST", {});
  const afterSrc = before ? (await sourcesOf(pdf.id)).find((x) => x.id === before.id) : null;
  check("R20", Boolean(before && afterSrc && !afterSrc.orphaned && afterSrc.blockId === before.blockId && afterSrc.startOffset === before.startOffset), "a re-parse of an unedited import keeps a highlight exact (the same row, the same offsets)", before ? `before ${before.blockId} ${before.startOffset}-${before.endOffset}; after ${afterSrc?.blockId} ${afterSrc?.startOffset}-${afterSrc?.endOffset} orphaned ${afterSrc?.orphaned}` : "no highlight made");
  await sleep(10000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
  const images = await loadFigureImages(page);
  const failed = responses.filter((r) => /\/figure\//.test(r.url) && r.status >= 400);
  check("R20", re.status === 200 && failed.length === 0 && images.total > 0 && images.loaded === images.total, "after a re-parse every figure loads its new crop, no 404", `HTTP ${re.status}; ${images.loaded}/${images.total} images; failed ${failed.map((f) => `${f.status} ${f.url}`).slice(0, 2).join(" ")}`);
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

// EDIT: editing an import where the Unitos layer meets the page editor:
// typing inside a highlight, a person's suggestion (Suggesting mode) and its
// Accept, and two tabs on one import (live sync) with page starts.
RISKS.EDIT = async (theme) => {
  const pdf = await fresh("pdf", `-edit${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  // A highlight, then words typed inside it: the mark grows, the quote stays.
  const at = await find(page, "Recurrent neural networks, long short-term memory");
  await dragSelect(page, at.from, at.to);
  const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
  if (await colors.count()) await colors.first().click();
  let hl = null;
  for (let i = 0; i < 30 && !hl; i++) {
    hl = (await sourcesOf(pdf.id)).find((x) => x.quotedText.startsWith("Recurrent neural networks")) ?? null;
    if (!hl) await sleep(500);
  }
  await setMode(page, "editing");
  const inside = await find(page, "neural networks");
  await clickPos(page, inside.from + 6);
  await page.keyboard.type("QA ");
  await waitSaved(page);
  await sleep(2500);
  const moved = hl ? (await sourcesOf(pdf.id)).find((x) => x.id === hl.id) : null;
  const painted = hl ? await page.evaluate((id) => [...document.querySelectorAll(`.docs-prose [data-source-id="${id}"]`)].map((e) => e.textContent).join(""), hl.id) : "";
  check("EDIT", Boolean(moved && !moved.orphaned && moved.quotedText === hl.quotedText && (moved.anchoredText ?? "").includes("neural QA networks") && painted.includes("neural QA networks")), `(${theme}) words typed inside a highlight: the mark grows over them, the quote stays`, moved ? `quote "${clip(moved.quotedText, 40)}", anchored "${clip(moved.anchoredText, 50)}", painted "${clip(painted, 50)}"` : "no highlight");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await waitSaved(page).catch(() => {});
  // Suggesting: a person's suggestion across a page start, then Accept.
  const s = (await pageStarts(page)).find((x) => x.on === "paragraph" && x.before.length >= 20 && x.after.length >= 20);
  const rowsBefore = await rowsOf(pdf.id);
  await setMode(page, "suggesting");
  await dragSelect(page, s.pos - 8, s.pos + 1 + 8);
  await page.keyboard.type("SUGGESTED");
  await waitSaved(page).catch(() => {});
  await sleep(1500);
  const marks = await page.evaluate(() => [...document.querySelectorAll(".docs-prose [data-suggestion]")].map((e) => e.textContent).join("|"));
  const starts = (await pageStarts(page)).filter((x) => x.page === s.page);
  const rowsAfter = await rowsOf(pdf.id);
  const changedRows = rowsAfter.filter((r) => rowsBefore.find((b) => b.id === r.id)?.hash !== r.hash);
  const suggestShot = await shot(page, `EDIT-suggestion-across-page-start-${theme}`);
  check("EDIT", marks.includes("SUGGESTED") && starts.length === 1 && changedRows.length === 1, `(${theme}) a person's suggestion across p. ${s.page}: drawn as a suggestion, the page start kept, one row changed`, `marks "${clip(marks, 80)}"; page starts ${starts.length}; rows changed ${changedRows.length} ${suggestShot}`);
  await menuCommand(page, "Accept all suggestions");
  await waitSaved(page).catch(() => {});
  await sleep(1000);
  const accepted = await page.evaluate((p) => window.__docsEditor.state.doc.resolve(p).parent.textContent, (await pageStarts(page)).find((x) => x.page === s.page)?.pos ?? s.pos);
  check("EDIT", accepted.includes("SUGGESTED") && (await pageStarts(page)).filter((x) => x.page === s.page).length === 1, `(${theme}) Accept keeps p. ${s.page} and the suggested words`, clip(accepted, 90));
  // Two tabs on one import: words typed in one reach the other, and the
  // other's page starts stay.
  await setMode(page, "editing");
  const second = await newPage(theme);
  await open(second.page, ctx.notebookId, pdf.id);
  const startsB = (await pageStarts(second.page)).length;
  const intro = await find(page, "1 Introduction");
  await clickPos(page, intro.to);
  await page.keyboard.type(" (live)");
  await waitSaved(page).catch(() => {});
  const arrived = await second.page.waitForFunction(() => window.__docsEditor.state.doc.textContent.includes("1 Introduction (live)"), null, { timeout: 30_000 }).then(() => true).catch(() => false);
  const startsAfter = (await pageStarts(second.page)).length;
  const liveShot = await shot(second.page, `EDIT-live-second-tab-${theme}`);
  check("EDIT", arrived && startsAfter === startsB, `(${theme}) words typed in one tab reach the other tab of the import, its page starts kept`, `arrived ${arrived}; page starts ${startsB} → ${startsAfter} ${liveShot}`);
  await second.context.close();
  if (errors.length) note("EDIT", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// AUDIT: the audit checklist (design section 5), as a Google Docs reader
// checks an import: the chrome and the pages, the outline, page numbers and
// the scroll tip, print, word count, Version history, downloads, and the
// web page's lists, table, code, quote, line, equation, and figures.
RISKS.AUDIT = async (theme) => {
  const pdf = await doc("pdf");
  const web = await doc("url");
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, pdf.id);
  const chrome = await page.evaluate(() => {
    const sheet = document.querySelector("[data-docs-page-sheet]");
    const line = document.querySelector(".docs-title-row")?.textContent ?? "";
    return {
      titleRow: Boolean(document.querySelector(".docs-title-row")),
      toolbar: Boolean(document.querySelector(".docs-toolbar")),
      ruler: Boolean(document.querySelector(".docs-ruler")),
      vruler: Boolean(document.querySelector(".docs-vruler")),
      sheets: document.querySelectorAll("[data-docs-page-sheet]").length,
      width: sheet ? Math.round(sheet.getBoundingClientRect().width) : null,
      height: sheet ? Math.round(sheet.getBoundingClientRect().height) : null,
      line: line.replace(/\s+/g, " ").slice(0, 120),
    };
  });
  const chromeShot = await shot(page, `AUDIT-pdf-chrome-${theme}`);
  check("AUDIT", chrome.titleRow && chrome.toolbar && chrome.ruler && chrome.vruler && chrome.sheets >= 15 && Math.abs(chrome.width - 816) <= 2 && Math.abs(chrome.height - 1056) <= 2, `(${theme}) the PDF reads as a Doc: title row, toolbar, rulers, pages at the paper's size`, `${JSON.stringify(chrome)} ${chromeShot}`);
  check("AUDIT", /PDF · 15 pages/.test(chrome.line), `(${theme}) the import line says "PDF · 15 pages"`, chrome.line);
  // The tabs & outlines panel lists the Title and the headings.
  const openOutline = page.locator('[data-track="docs:outline-open"]').first();
  if (await openOutline.count()) {
    await openOutline.click();
    await sleep(700);
    const items = await page.evaluate(() => [...document.querySelectorAll(".docs-outline-list [aria-label]")].map((e) => e.getAttribute("aria-label")));
    const outlineShot = await shot(page, `AUDIT-outline-${theme}`);
    check("AUDIT", items.some((i) => /Attention Is All You Need/.test(i)) && items.some((i) => /Introduction/.test(i)), `(${theme}) the outline lists the Title and the headings`, `${items.length}: ${items.slice(0, 5).join(" | ")} ${outlineShot}`);
    await page.locator('[data-track="docs:outline-close"]').first().click().catch(() => {});
    await sleep(400);
  }
  // Page numbers at the first, a middle, and the last page, in the margin.
  const starts = await pageStarts(page);
  const picks = [starts[0], starts[Math.floor(starts.length / 2)], starts.at(-1)].filter(Boolean);
  const drawn = [];
  for (const st of picks) {
    await page.evaluate((p) => {
      const el = window.__docsEditor.view.nodeDOM(p) ?? window.__docsEditor.view.domAtPos(p).node;
      (el.nodeType === 1 ? el : el.parentElement).scrollIntoView({ block: "center" });
    }, st.pos);
    await sleep(500);
    const label = await page.evaluate((p) => {
      const view = window.__docsEditor.view;
      const node = view.state.doc.nodeAt(p);
      const el = node?.type.name === "pageStart" ? view.nodeDOM(p) : view.nodeDOM(p);
      const text = document.querySelector(".docs-prose").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const before = getComputedStyle(el, "::before");
      return { content: before.content, left: Math.round(r.left), textLeft: Math.round(text.left), top: Math.round(r.top), label: el.getAttribute("data-page-label") };
    }, st.pos);
    const crop = await page.screenshot({ path: join(SHOT, `AUDIT-page-start-p${st.page}-${theme}.png`), clip: { x: Math.max(0, label.textLeft - 140), y: Math.max(0, label.top - 60), width: 700, height: 140 } }).then(() => join(SHOT, `AUDIT-page-start-p${st.page}-${theme}.png`));
    drawn.push({ page: st.page, on: st.on, ...label, crop });
  }
  check("AUDIT", drawn.every((d) => d.label === `p. ${d.page}` && (d.content.includes(`p. ${d.page}`) || d.on !== "paragraph")), `(${theme}) "p. N" stands at the first, a middle, and the last page`, drawn.map((d) => `p. ${d.page} [${d.on}] label "${d.label}" ::before ${d.content} ${d.crop}`).join(" | "));
  // The scroll tip reads the PDF's page in view.
  const seven = starts.find((x) => x.page === 7);
  if (seven) {
    await page.evaluate((p) => window.__docsEditor.view.domAtPos(p).node.parentElement?.scrollIntoView({ block: "center" }), seven.pos);
    await sleep(500);
    const edge = await page.evaluate(() => {
      const prose = document.querySelector(".docs-prose");
      let pane = prose.parentElement;
      while (pane && !(/(auto|scroll)/.test(getComputedStyle(pane).overflowY) && pane.scrollHeight > pane.clientHeight)) pane = pane.parentElement;
      const r = pane.getBoundingClientRect();
      return { x: r.right - 6, y: r.top + r.height / 2 };
    });
    await page.mouse.move(edge.x - 40, edge.y);
    await page.mouse.move(edge.x, edge.y, { steps: 5 });
    await sleep(600);
    const tip = await page.evaluate(() => document.querySelector(".docs-page-indicator")?.textContent ?? null);
    const tipShot = await shot(page, `AUDIT-scroll-tip-${theme}`);
    check("AUDIT", /^p\. \d+ of 15$/.test(tip ?? ""), `(${theme}) the scroll tip reads the PDF's page in view`, `"${tip}" ${tipShot}`);
  }
  // Print: page starts and marks do not print.
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate(() => {
    const el = document.querySelector(".docs-page-start");
    const cs = el ? getComputedStyle(el, "::before") : null;
    return el ? { display: getComputedStyle(el).display, before: cs.display, content: cs.content, visibility: cs.visibility } : null;
  });
  await page.emulateMedia({ media: "screen" });
  check("AUDIT", Boolean(printed) && (printed.display === "none" || printed.before === "none" || printed.content === "none" || printed.visibility === "hidden"), `(${theme}) page starts do not print`, JSON.stringify(printed));
  // Word count: page starts add no words. Viewing first, as the import opens.
  const wordCount = async () => {
    await page.evaluate(() => window.__docsEditor.commands.focus());
    await page.keyboard.press("Control+Shift+c");
    await sleep(800);
    return page.evaluate(() => [...document.querySelectorAll(".docs-wc-table tr")].map((r) => r.textContent.trim()));
  };
  let wc = await wordCount();
  if (wc.length === 0) {
    note("AUDIT", `(${theme}) Ctrl+Shift+C opens no word count in Viewing`, "Editing tried next");
    await setMode(page, "editing");
    wc = await wordCount();
  }
  const own = await page.evaluate(() => {
    const ed = window.__docsEditor;
    let words = 0;
    ed.state.doc.descendants((n) => {
      if (n.isText) words += (n.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-–—]*/gu) ?? []).length;
      return true;
    });
    return words;
  });
  const wcShot = await shot(page, `AUDIT-word-count-${theme}`);
  const counted = Number((wc.find((r) => /^Words/.test(r)) ?? "").replace(/\D+/g, ""));
  check("AUDIT", counted > 0 && Math.abs(counted - own) / own < 0.05, `(${theme}) the word count counts the words, not the page starts`, `dialog ${JSON.stringify(wc)}; the text's words ${own} ${wcShot}`);
  await page.keyboard.press("Escape");
  await sleep(300);
  // Version history, from the clock at the title row's right end.
  await page.locator('[data-track="docs:version-history"]').first().click().catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".docs-versions-list .docs-versions-pick").length > 0, null, { timeout: 30_000 }).catch(() => {});
  await sleep(500);
  const versions = await page.evaluate(() => [...document.querySelectorAll(".docs-versions-list .docs-versions-pick")].map((b) => b.textContent.trim()));
  const importedPick = page.locator(".docs-versions-list .docs-versions-pick", { hasText: "Imported" }).first();
  let versionView = null;
  if (await importedPick.count()) {
    await importedPick.click();
    await page.waitForFunction(() => document.querySelectorAll(".docs-versions-page .docs-figure").length > 0, null, { timeout: 30_000 }).catch(() => {});
    await sleep(1500);
    versionView = await page.evaluate(() => {
      const view = document.querySelector(".docs-versions-page");
      return view ? { figures: view.querySelectorAll(".docs-figure").length, images: [...view.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 0).length, pageStarts: view.querySelectorAll("[data-page-start]").length, words: view.textContent.length } : null;
    });
  }
  const versionShot = await shot(page, `AUDIT-version-imported-${theme}`);
  check("AUDIT", versions.some((v) => /Imported/.test(v)) && (versionView?.figures ?? 0) >= 12 && (versionView?.images ?? 0) > 0, `(${theme}) Version history lists "Imported" and its view draws the figures`, `${JSON.stringify(versions.slice(0, 4))}; view ${JSON.stringify(versionView)} ${versionShot}`);
  await page.keyboard.press("Escape");
  await page.locator(".docs-versions-bar button").first().click().catch(() => {});
  await sleep(800);
  // Downloads: Word from the server, Markdown in the browser.
  if (theme === THEMES[0]) {
    const docx = await fetch(`${BASE}/api/documents/${pdf.id}/export?format=docx`);
    const bytes = Buffer.from(await docx.arrayBuffer());
    let xml = "";
    try {
      const { unzipSync, strFromU8 } = await import("fflate");
      xml = strFromU8(unzipSync(new Uint8Array(bytes))["word/document.xml"] ?? new Uint8Array());
    } catch (e) {
      xml = `(unzip failed: ${e.message})`;
    }
    const docText = xml.replace(/<[^>]+>/g, " ");
    check("AUDIT", docx.status === 200 && /Attention Is All You Need/.test(docText) && /Scaled Dot-Product Attention/.test(docText) && !/\bp\. 4\b/.test(docText), "the Word download holds the paper's words and no page labels", `HTTP ${docx.status}, ${bytes.length} bytes, pictures ${(xml.match(/<pic:pic/g) ?? []).length}`);
    note("AUDIT", "figures in the Word download", `${(xml.match(/<pic:pic/g) ?? []).length} pictures for 12 figure objects (design: round 2)`);
    const download = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
    if (!(await menuCommand(page, "Download: Markdown (.md)"))) {
      note("AUDIT", "Search the menus (and with it File > Download) is not on the toolbar in Viewing", "Editing tried next");
      await setMode(page, "editing");
      await menuCommand(page, "Download: Markdown (.md)");
    }
    const file = await download;
    const md = file ? readFileSync(await file.path(), "utf8") : "";
    check("AUDIT", md.includes("Attention Is All You Need") && !/\bp\. \d+\b/.test(md), "the Markdown download holds the words and no page labels", `${md.length} characters; figure captions ${(md.match(/Figure \d+:/g) ?? []).length}`);
  }
  // Make a copy is off for an import, and says why.
  if ((await mode(page)) !== "editing") await setMode(page, "editing");
  await menuCommand(page, "Make a copy");
  await sleep(800);
  const copyDialog = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.textContent).join(" | "));
  const copyShot = await shot(page, `AUDIT-make-a-copy-${theme}`);
  check("AUDIT", /off for an import/.test(copyDialog), `(${theme}) Make a copy is off for an import, with the reason`, `${clip(copyDialog, 140)} ${copyShot}`);
  await page.keyboard.press("Escape");
  await sleep(300);
  // The web page: pageless; lists, the table's merged cells, code, a quote,
  // a line, and every figure's media.
  await open(page, ctx.notebookId, web.id);
  const shape = await page.evaluate(() => {
    const prose = document.querySelector(".docs-prose");
    const th = [...prose.querySelectorAll("th")];
    const figs = [...prose.querySelectorAll(".docs-figure")].map((f) => {
      const img = [...f.querySelectorAll("img")];
      return { media: f.querySelector("img, svg, video, iframe")?.tagName ?? null, loaded: img.every((i) => i.complete && i.naturalWidth > 0), caption: f.textContent.trim().slice(0, 24) };
    });
    const kicker = [...prose.querySelectorAll("p")].find((p) => p.textContent.trim() === "SCIENCE");
    return {
      pageless: Boolean(document.querySelector('.docs-canvas[data-pageless="true"]')),
      nested: prose.querySelectorAll("ul ul").length,
      ol3: prose.querySelector('ol[start="3"]') ? true : false,
      rowspan: th.some((c) => c.getAttribute("rowspan") === "2"),
      colspan: th.some((c) => c.getAttribute("colspan") === "2"),
      region: prose.querySelectorAll("table").length ? [...prose.querySelector("table").querySelectorAll("th, td")].filter((c) => c.textContent.trim() === "Delta").length : 0,
      code: prose.querySelectorAll("pre").length,
      quote: prose.querySelectorAll("blockquote").length,
      hr: prose.querySelectorAll("hr").length,
      figs,
      kickerSize: kicker ? getComputedStyle(kicker.querySelector("span") ?? kicker).fontSize : null,
      references: document.querySelector('[data-track="references"], .references, [data-references]') ? true : Boolean([...document.querySelectorAll("h2, h3")].find((h) => /References/.test(h.textContent) && !h.closest(".docs-prose"))),
    };
  });
  const webShot = await shot(page, `AUDIT-web-${theme}`);
  check("AUDIT", shape.pageless && shape.nested >= 1 && shape.ol3 && shape.rowspan && shape.colspan && shape.region === 1 && shape.code >= 1 && shape.quote >= 1 && shape.hr >= 1, `(${theme}) the web page: pageless, a nested list, a list from 3, the table's merged cells once, code, a quote, a line`, `${JSON.stringify({ ...shape, figs: undefined })} ${webShot}`);
  check("AUDIT", shape.figs.length === 5 && shape.figs.every((f) => f.media) && shape.figs.filter((f) => f.media === "IMG").every((f) => f.loaded), `(${theme}) every figure of the web page draws its media`, JSON.stringify(shape.figs));
  check("AUDIT", Boolean(shape.references), `(${theme}) the References section stands under the page`, `${shape.references}`);
  if (errors.length) note("AUDIT", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// AI: the AI tools, annotations, and notes on an import's text, as a Unitos
// reader uses them: Explain across a page start, Add to notes and the
// note's jump back, Analyze on a PDF figure and the Annotations tab's Jump,
// a selection over a figure, a highlight in a table cell, Define.
RISKS.AI = async (theme) => {
  const pdf = await fresh("pdf", `-ai${theme[0]}`);
  const { page, errors, context } = await newPage(theme);
  const derives = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/derive") && r.method() === "POST") {
      try {
        derives.push(JSON.parse(r.postData() ?? "{}"));
      } catch {
        // not JSON
      }
    }
  });
  await open(page, ctx.notebookId, pdf.id);
  const inline = (await pageStarts(page)).filter((x) => x.on === "paragraph" && x.before.length >= 30 && x.after.length >= 30);
  // Explain across a page start.
  const a = inline[0];
  await dragSelect(page, a.pos - 30, a.pos + 1 + 30);
  const wordsA = `${a.before.slice(-30)}${a.after.slice(0, 30)}`;
  await tool(page, "explain");
  await page.waitForFunction(() => (document.querySelector('[data-side-card="explain"]')?.textContent ?? "").includes("Mock"), null, { timeout: 45_000 }).catch(() => {});
  const explain = derives.find((d) => d.type === "EXPLAIN");
  check("AI", explain?.anchor?.quotedText === wordsA, `(${theme}) Explain across p. ${a.page} sends the words alone`, `quote "${clip(explain?.anchor?.quotedText, 70)}"`);
  let sources = await sourcesOf(pdf.id);
  for (let i = 0; i < 40 && !sources.some((x) => x.note.derivationType === "EXPLAIN"); i++) {
    await sleep(500);
    sources = await sourcesOf(pdf.id);
  }
  const ex = sources.find((x) => x.note.derivationType === "EXPLAIN");
  if (ex) {
    await page.waitForFunction((id) => document.querySelectorAll(`.docs-prose [data-source-id="${id}"]`).length > 0, ex.id, { timeout: 20_000 }).catch(() => {});
    const painted = await page.evaluate((id) => [...document.querySelectorAll(`.docs-prose [data-source-id="${id}"]`)].map((e) => e.textContent), ex.id);
    const shotA = await shot(page, `AI-explain-mark-across-page-start-${theme}`);
    check("AI", painted.join("").replace(/\s+/g, "") === wordsA.replace(/\s+/g, "") && painted.length >= 2, `(${theme}) Explain's mark paints on both sides of p. ${a.page}`, `${painted.length} pieces "${clip(painted.join("|"), 80)}" ${shotA}`);
  } else fail("AI", `(${theme}) Explain stores its annotation`, JSON.stringify(sources.map((x) => x.note.derivationType)));
  await page.keyboard.press("Escape");
  // Add to notes across another page start; the note's jump flashes the words.
  const b = inline[1] ?? inline[0];
  await dragSelect(page, b.pos - 25, b.pos + 1 + 25);
  const wordsB = `${b.before.slice(-25)}${b.after.slice(0, 25)}`;
  await tool(page, "add-to-notes");
  const section = page.locator('[data-track="add-to-notes-section"]').first();
  if (await section.count()) await section.click();
  let noteSrc = null;
  for (let i = 0; i < 40 && !noteSrc; i++) {
    noteSrc = (await sourcesOf(pdf.id)).find((x) => x.quotedText === wordsB && x.note.sectionId === ctx.sectionId) ?? null;
    if (!noteSrc) await sleep(500);
  }
  check("AI", Boolean(noteSrc), `(${theme}) Add to notes across p. ${b.page} quotes the words alone`, noteSrc ? `quote "${clip(noteSrc.quotedText, 60)}"` : "no note");
  if (noteSrc) {
    await page.evaluate(() => document.querySelector(".docs-prose")?.closest("[class*=overflow]")?.scrollTo?.(0, 0));
    await page.evaluate(() => {
      const prose = document.querySelector(".docs-prose");
      let pane = prose.parentElement;
      while (pane && !(/(auto|scroll)/.test(getComputedStyle(pane).overflowY) && pane.scrollHeight > pane.clientHeight)) pane = pane.parentElement;
      pane?.scrollTo(0, 0);
    });
    await sleep(600);
    const jump = page.locator(`[data-note-id="${noteSrc.note.id}"] [data-track="note-jump"]`).first();
    await jump.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    if (await jump.count()) {
      await jump.click();
      const flashed = await page.waitForFunction(() => {
        const els = [...document.querySelectorAll(".docs-prose .anchor-flash")];
        return els.length ? els.map((e) => e.textContent).join("") : null;
      }, null, { timeout: 15_000 }).then((h) => h.jsonValue()).catch(() => null);
      const shotB = await shot(page, `AI-note-jump-flash-${theme}`);
      check("AI", Boolean(flashed) && flashed.replace(/\s+/g, "").includes(wordsB.replace(/\s+/g, "").slice(5, 30)), `(${theme}) the note's jump flashes its words across p. ${b.page}`, `flashed "${clip(flashed, 70)}" ${shotB}`);
    } else fail("AI", `(${theme}) the note's jump`, "no note-jump control on the note");
  }
  // Analyze a PDF figure: its crop; the ring; the Annotations tab's Jump.
  const fig = (await figures(page)).find((f) => /Figure 1/.test(f.caption ?? "")) ?? (await figures(page))[0];
  await clickFigure(page, fig.pos);
  if (!(await popoverOpen(page))) {
    note("AI", `(${theme}) the first press on the PDF figure opened nothing`, "a second press opens its tools");
    await clickFigure(page, fig.pos);
  }
  const analyze = page.locator('[data-selection-popover] [data-track="analyze"]').first();
  if (await analyze.count()) {
    await analyze.click();
    let an = null;
    for (let i = 0; i < 60 && !an; i++) {
      an = (await sourcesOf(pdf.id)).find((x) => x.note.derivationType === "ANALYZE") ?? null;
      if (!an) await sleep(500);
    }
    const req = derives.find((d) => d.type === "ANALYZE");
    check("AI", Boolean(an) && an.blockId === fig.blockId, `(${theme}) Analyze on a PDF figure anchors to the figure`, `request ${clip(JSON.stringify(req?.anchor ?? req ?? null), 100)}`);
    await page.keyboard.press("Escape");
    await page.waitForFunction((p) => window.__docsEditor.view.nodeDOM(p)?.hasAttribute("data-source-id"), fig.pos, { timeout: 20_000 }).catch(() => {});
    const tab = page.locator('[data-track="annotations"]').first();
    if (await tab.count()) {
      await tab.click();
      await sleep(1200);
      // The analysis's row: its "…" menu holds Jump.
      const row = page.locator('[data-track="annotation-menu"]').last();
      if (await row.count()) {
        await row.click();
        await sleep(500);
      }
      const jumpA = page.locator('[data-track="annotation-jump"]').first();
      if (await jumpA.count()) {
        await jumpA.click();
        const flashedFig = await page.waitForFunction((p) => window.__docsEditor.view.nodeDOM(p)?.classList.contains("anchor-flash"), fig.pos, { timeout: 10_000 }).then(() => true).catch(() => false);
        const shotC = await shot(page, `AI-annotations-jump-figure-${theme}`);
        check("AI", flashedFig, `(${theme}) the Annotations tab's Jump flashes the analyzed figure`, shotC);
      } else fail("AI", `(${theme}) the Annotations tab lists the analysis with Jump`, "no annotation-jump");
    }
  } else fail("AI", `(${theme}) a click on a PDF figure opens Analyze`, "no Analyze");
  // A selection over a figure leaves the figure out, and the toolbar says so.
  const around = await page.evaluate((p) => {
    const doc = window.__docsEditor.state.doc;
    const $p = doc.resolve(p);
    const before = $p.nodeBefore;
    const after = doc.nodeAt(p + doc.nodeAt(p).nodeSize);
    return { from: p - 12, to: p + doc.nodeAt(p).nodeSize + 13, before: before?.textContent.slice(-11), after: after?.textContent.slice(0, 12) };
  }, fig.pos);
  await page.keyboard.press("Escape");
  // The figure is taller than the view: a person selects over it with the
  // keys, in Editing — a click before it, Shift held, down past it; the
  // toolbar opens when Shift is let go.
  await setMode(page, "editing");
  await clickPos(page, around.from);
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowDown");
    await sleep(120);
  }
  await page.keyboard.up("Shift");
  await sleep(900);
  const selected = await page.evaluate(() => {
    const sel = window.__docsEditor.state.selection;
    let figure = false;
    window.__docsEditor.state.doc.nodesBetween(sel.from, sel.to, (n) => {
      if (n.type.name === "figure") figure = true;
    });
    return { from: sel.from, to: sel.to, figure };
  });
  const leftOut = await page.evaluate(() => document.querySelector("[data-selection-popover]")?.textContent.includes("left out") ?? false);
  const shotD = await shot(page, `AI-selection-over-figure-${theme}`);
  check("AI", selected.figure && leftOut, `(${theme}) a selection over a figure: the toolbar says images, figures, and equations are left out`, `selection ${JSON.stringify(selected)} ${shotD}`);
  await page.keyboard.press("Escape");
  // A highlight in a table cell paints in the cell after a reload.
  const cell = await page.evaluate(() => {
    let hit = null;
    window.__docsEditor.state.doc.descendants((n, p) => {
      if (hit) return false;
      if ((n.type.name === "tableCell" || n.type.name === "tableHeader") && /Self-Attention/.test(n.textContent)) hit = { from: p + 2, text: n.textContent };
      return !hit;
    });
    return hit;
  });
  if (cell) {
    const at = await find(page, "Self-Attention");
    await dragSelect(page, at.from, at.to);
    const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
    if (await colors.count()) await colors.nth(1).click();
    let hl = null;
    for (let i = 0; i < 30 && !hl; i++) {
      hl = (await sourcesOf(pdf.id)).find((x) => x.quotedText === "Self-Attention") ?? null;
      if (!hl) await sleep(500);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 60_000 });
    await sleep(3000);
    const inCell = hl ? await page.evaluate((id) => [...document.querySelectorAll(`.docs-prose [data-source-id="${id}"]`)].map((e) => ({ text: e.textContent, inCell: Boolean(e.closest("td, th")) })), hl.id) : [];
    check("AI", inCell.length > 0 && inCell.every((m) => m.inCell) && inCell.map((m) => m.text).join("") === "Self-Attention", `(${theme}) a highlight in a table cell paints in the cell after a reload`, JSON.stringify(inCell));
  }
  // Define one word.
  const word = await find(page, "transduction");
  if (word) {
    await dragSelect(page, word.from, word.to);
    const define = page.locator('[data-selection-popover] [data-track="define"]').first();
    if (await define.count()) {
      await define.click();
      const text = await page.waitForFunction(() => {
        const t = document.querySelector("[data-definition]")?.textContent ?? "";
        return t.length > 30 && !document.querySelector('[data-definition] [role="status"]') ? t : null;
      }, null, { timeout: 30_000 }).then((h) => h.jsonValue()).catch(() => null);
      check("AI", Boolean(text), `(${theme}) Define answers on an import`, clip(text, 80));
    } else fail("AI", `(${theme}) Define is the first row for one word`, "no define");
  }
  if (errors.length) note("AI", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
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
