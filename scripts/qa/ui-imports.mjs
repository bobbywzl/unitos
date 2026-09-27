// UI walk of the imports' risks (the imports design 1.11 and section 5; the
// round 10 and round 11 plans): a PDF, a web page, and a Markdown file added
// to a local Unitos with the switch on (IMPORT_PAGE_EDITOR=on) open in the
// page editor, and every risk is walked in headless Chromium at a person's
// pace, in the light and the dark theme. R4 and R19 are out (C1: a table is
// a row per cell paragraph). Each check prints PASS or FAIL with its
// evidence: a number, a screenshot path. The timings for the size guard
// (1.8) print as TIME lines.
//
// Beyond the risks: C2 (the assistant's suggestions on an import), EDIT
// (typing in a highlight, Suggesting, two tabs), AUDIT (the design's
// section 5 checklist, as a Google Docs reader checks it), and AI (the
// Unitos tools, annotations, and notes on an import's text).
//
// A check waits for the state it checks (a mark, a toolbar, a saved copy, a
// scroll position), never a fixed time, and a scroll puts a position exactly
// where the check reads it. A group with a failure runs once more at the
// end, alone (fresh documents, a fresh browser): a failure counts only when
// it fails again there; one that passes alone prints as FLAKY with both
// evidences.
//
// Usage:
//   node scripts/qa/ui-imports.mjs [R1 R3 … C2 EDIT AUDIT AI] [--theme light|dark|both] [--keep] [--once]
// With nothing named, everything runs. --once skips the run alone. Env: BASE
// (default http://localhost:3111), SHOT_DIR (screenshots; default
// <tmp>/ui-imports), CHROME (default /opt/pw-browsers/chromium),
// FIXTURE_PORT (default 3490), DATABASE_URL (read from .env when unset),
// ATTENTION (the Attention paper's PDF: a path or a URL; default
// https://arxiv.org/pdf/1706.03762), LONG_PAGES (the long PDF's page count;
// default 150).
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
const ONCE = args.includes("--once");
const ONLY = new Set(args.filter((a, i) => /^[A-Z][A-Z0-9]*$/.test(a) && args[i - 1] !== "--theme"));
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
mkdirSync(SHOT, { recursive: true });

const db = new PrismaClient();
const results = [];
function record(level, risk, name, detail = "") {
  const line = `${level} ${risk} ${name}${detail ? ` — ${detail}` : ""}`;
  results.push({ level, risk, name, detail, line, alone: ctx.alone });
  console.log(ctx.alone ? `  alone: ${line}` : line);
}
const pass = (risk, name, detail) => record("PASS", risk, name, detail);
const fail = (risk, name, detail) => record("FAIL", risk, name, detail);
const note = (risk, name, detail) => record("NOTE", risk, name, detail);
const time = (risk, name, detail) => record("TIME", risk, name, detail);
const check = (risk, ok, name, detail) => (ok ? pass : fail)(risk, name, detail);
/** A person's pace between two keys or two moves; never a wait for a state. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 80) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const squash = (s) => String(s ?? "").replace(/\s+/g, "");

// ── Waiting ─────────────────────────────────────────────────────────────────

/** Poll `fn` until it gives a truthy value or `ms` pass: its last value
    either way, so a failure prints what was there. */
async function until(fn, ms = 20_000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() >= end) return value;
    await sleep(every);
  }
}
/** Wait in the page for `fn(arg)` to be truthy: its value, or null after `ms`. */
function waitIn(page, fn, arg, ms = 20_000) {
  return page
    .waitForFunction(fn, arg, { timeout: ms, polling: 100 })
    .then((h) => h.jsonValue())
    .catch(() => null);
}

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
    select: { id: true, blockId: true, startOffset: true, endOffset: true, quotedText: true, anchoredText: true, orphaned: true, layer: true, note: { select: { id: true, derivationType: true, status: true, content: true, color: true, sectionId: true } } },
  });
}

/** The first stored source of a document that meets `test`, waited for. */
async function sourceWhere(documentId, test, ms = 30_000) {
  return (await until(async () => (await sourcesOf(documentId)).find(test) ?? null, ms, 400)) ?? null;
}

/** The words of a stored row. */
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
    a looping video, a figure on a box the page paints, a table with merged
    cells, lists, a quote, code, a line, an equation, and a reference list. */
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
.row{display:flex;gap:12px}.row img{width:50%}.boxed{background:#f8f9fa;padding:12px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}</style></head>
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
<figure class="boxed"><img src="${FIXTURE}/gauge.png?run=${run}" alt="A gauge station" width="480" height="270"><figcaption>Figure 6. A gauge station, on the box the page paints.</figcaption></figure>
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
    "/gauge.png": { type: "image/png", body: await png(480, 270, 260, "Gauge") },
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

/** What every page of the walk has before its own scripts run
    (window.__qa): the page editor's pane, the band of it a person sees
    under the header, exact scrolling, and the layout holding still. */
function qaHelpers() {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const qa = {
    /** The scrolling pane around an element, the page editor's by default. */
    pane(el) {
      let p = (el ?? document.querySelector(".docs-prose"))?.parentElement ?? null;
      while (p && !(/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)) p = p.parentElement;
      return p;
    },
    /** The part of the pane a person sees and presses: under the page
        editor's header (title row, toolbar, ruler), above the pane's foot. */
    band(el) {
      const view = el ?? window.__docsEditor.view.dom;
      const r = qa.pane(view).getBoundingClientRect();
      const header = view.closest("[data-docs-editor]")?.querySelector(".docs-header")?.getBoundingClientRect().bottom ?? r.top;
      return { top: Math.max(r.top, header) + 8, bottom: r.bottom - 8 };
    },
    /** Until the pane's height, the page's, and the sheets hold still for 300 ms. */
    async settle(ms = 15_000) {
      const prose = document.querySelector(".docs-prose");
      const measure = () => `${qa.pane(prose)?.scrollHeight}:${Math.round(prose?.getBoundingClientRect().height ?? 0)}:${document.querySelectorAll("[data-docs-page-sheet]").length}`;
      const end = performance.now() + ms;
      let last = measure();
      let since = performance.now();
      while (performance.now() < end) {
        await frame();
        const now = measure();
        if (now !== last) {
          last = now;
          since = performance.now();
        } else if (performance.now() - since >= 300) return true;
      }
      return false;
    },
    /** Scroll the pane until `y()` (client px) reads `at`, frame by frame:
        a layout that moves under the scroll is followed. */
    async place(y, at, el) {
      const pane = qa.pane(el);
      for (let i = 0; i < 12; i++) {
        const d = y() - at;
        if (Math.abs(d) < 1.5) break;
        const before = pane.scrollTop;
        pane.scrollTop = before + d;
        await frame();
        await frame();
        if (pane.scrollTop === before) break; // the pane's end
      }
    },
    /** Position `pos` at `at` (client px; the band's middle by default):
        its coords. A paragraph across a page break is taller than the
        screen, so the position itself is placed, never its element. */
    async show(pos, at) {
      const view = window.__docsEditor.view;
      const b = qa.band(view.dom);
      const mid = () => {
        const c = view.coordsAtPos(pos);
        return (c.top + c.bottom) / 2;
      };
      await qa.place(mid, at ?? (b.top + b.bottom) / 2, view.dom);
      const c = view.coordsAtPos(pos);
      return { x: c.left, y: (c.top + c.bottom) / 2, top: c.top, bottom: c.bottom };
    },
    /** An element's middle at the band's middle: its box. */
    async showEl(el) {
      const b = qa.band();
      await qa.place(() => {
        const r = el.getBoundingClientRect();
        return (r.top + r.bottom) / 2;
      }, (b.top + b.bottom) / 2, el);
      return el.getBoundingClientRect().toJSON();
    },
    /** A node's box in the band: centered when it fits, else its top at the band's top. */
    async showNode(pos) {
      const view = window.__docsEditor.view;
      const el = view.nodeDOM(pos);
      if (!el || el.nodeType !== 1) return null;
      const b = qa.band(view.dom);
      const box = () => el.getBoundingClientRect();
      const fits = box().height <= b.bottom - b.top - 40;
      await qa.place(() => (fits ? box().top + box().height / 2 : box().top), fits ? (b.top + b.bottom) / 2 : b.top + 24, view.dom);
      return box().toJSON();
    },
    /** Where a person presses a figure: the middle of its media's part in
        the band, and whether that point is the figure's. */
    figurePoint(pos) {
      const view = window.__docsEditor.view;
      const el = view.nodeDOM(pos);
      const media = el?.querySelector("img, svg, video, iframe") ?? el;
      if (!media) return null;
      const b = qa.band(view.dom);
      const r = media.getBoundingClientRect();
      const top = Math.max(r.top, b.top);
      const bottom = Math.min(r.bottom, b.bottom, top + 240);
      const x = r.left + r.width / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, ours: Boolean(hit && el.contains(hit)), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null };
    },
    /** The words of the text block around position `pos`. */
    blockText(pos) {
      return window.__docsEditor.state.doc.resolve(pos).parent.textContent;
    },
    /** The pieces of the page's marks whose `attr` is `id`. */
    marked(id, attr = "data-source-id") {
      return [...document.querySelectorAll(`.docs-prose [${attr}="${CSS.escape(id)}"]`)].map((e) => e.textContent);
    },
    /** The app's reading line (lib/reading-position.ts): 80 px under the
        pane's top edge. The block on it, how far its top stands from it,
        and the tab's saved copy. */
    readingLine() {
      const top = qa.pane().getBoundingClientRect().top + 80;
      const hit = [...document.querySelectorAll(".docs-prose [data-block-id]")].find((e) => e.getBoundingClientRect().bottom > top);
      let saved = null;
      try {
        saved = Object.entries(sessionStorage).find(([k]) => k.startsWith("unitos-reader-position:"))?.[1] ?? null;
      } catch {
        saved = null;
      }
      return hit ? { id: hit.dataset.blockId, dy: Math.round(hit.getBoundingClientRect().top - top), text: hit.textContent.slice(0, 40), saved: saved ? JSON.parse(saved).blockId : null } : null;
    },
  };
  window.__qa = qa;
}

let browser;
async function launch() {
  browser = await chromium.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
}
async function newPage(theme = "light", { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await context.addInitScript(qaHelpers);
  // A dev server under load answers slowly: a navigation or an action waits long before it fails.
  context.setDefaultNavigationTimeout(120_000);
  context.setDefaultTimeout(60_000);
  const page = await context.newPage();
  const errors = [];
  // The dev server's reloads while files change: a hydration mismatch and
  // two React warnings that any document shows now and then (a blank one
  // too), not the page under test.
  const ignorable = (t) =>
    /ERR_CERT|fonts\.g|Failed to load resource|youtube|ERR_TUNNEL|ERR_PROXY|net::ERR|Hydration failed|Can't perform a React state update on a component that hasn't mounted|Encountered a script tag/.test(t);
  page.on("pageerror", (e) => {
    if (!ignorable(e.message)) errors.push(`pageerror: ${e.message}`);
  });
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

/** Open a document in the reader and wait for the page editor (its editor
    is on window in development builds) and a layout that holds still.
    Times from the navigation to the first words, and to the editor. */
async function open(page, notebookId, documentId, { wait = true } = {}) {
  const t0 = Date.now();
  await page.goto(`${BASE}/n/${notebookId}?doc=${documentId}`, { waitUntil: "domcontentloaded" });
  return wait ? ready(page, t0) : {};
}
async function ready(page, t0 = Date.now()) {
  await page.waitForFunction(() => document.querySelector(".docs-prose")?.textContent.trim().length > 0, null, { timeout: 120_000 });
  const text = Date.now() - t0;
  await page.waitForFunction(() => Boolean(window.__docsEditor) && !window.__docsEditor.isDestroyed, null, { timeout: 60_000 });
  const times = { text, ready: Date.now() - t0 };
  await page.evaluate(() => window.__qa.settle());
  return times;
}
async function reload(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  return ready(page);
}

async function isPageEditor(page) {
  return page.evaluate(() => Boolean(document.querySelector(".docs-prose")) && !document.querySelector("article.reader-prose [data-block-id]:not(.docs-prose *)"));
}

async function mode(page) {
  return page.evaluate(() => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") ?? null);
}
/** The mode menu's item, as a person picks it; false when it is off. */
async function setMode(page, to) {
  await page.click('[data-track="docs:mode"]');
  const item = page.locator(`[data-track="docs:mode:${to}"]`);
  await item.waitFor({ state: "visible", timeout: 10_000 });
  const disabled = await item.evaluate((el) => el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled")).catch(() => null);
  if (disabled) {
    await page.keyboard.press("Escape");
    return false;
  }
  await item.click();
  await waitIn(page, (m) => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") === m, to, 10_000);
  return true;
}

/** The save caught up: the status says saved and the stored copy is the
    one on screen (in the editor's form). */
async function waitSaved(page, ms = 30_000) {
  const ok = await until(
    () =>
      page
        .evaluate(async () => {
          if (!document.querySelector(".docs-status-saved")) return false;
          const id = new URLSearchParams(location.search).get("doc");
          const res = await fetch(`/api/documents/${id}/rich-text`, { cache: "no-store" });
          if (!res.ok) return false;
          const { richText } = await res.json();
          const ed = window.__docsEditor;
          return JSON.stringify(ed.schema.nodeFromJSON(richText).toJSON()) === JSON.stringify(ed.getJSON());
        })
        .catch(() => false),
    ms,
    300,
  );
  if (!ok) throw new Error(`not saved in ${ms / 1000} s`);
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
/** A position in the band, scrolled to its middle only when it is not. */
async function reveal(page, pos) {
  const c = await coords(page, pos);
  const b = await page.evaluate(() => window.__qa.band());
  if (c.top >= b.top + 30 && c.bottom <= b.bottom - 60) return c;
  return page.evaluate((p) => window.__qa.show(p), pos);
}
async function clickAt(page, x, y) {
  await page.mouse.move(x - 20, y - 8);
  await page.mouse.move(x, y, { steps: 6 });
  await sleep(80);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}
/** A click at a text position; in an editable page, the caret lands there
    (a person clicks again when the first click did not take). */
async function clickPos(page, pos) {
  const caretAt = () => page.evaluate((p) => {
    const ed = window.__docsEditor;
    return !ed.isEditable || Math.abs(ed.state.selection.head - p) <= 1;
  }, pos);
  for (let i = 0; i < 2; i++) {
    const c = await reveal(page, pos);
    await clickAt(page, c.x + 0.5, c.y);
    if (await until(caretAt, 3000, 100)) return true;
  }
  return false;
}
/** Select with the mouse, like a person: press at `from`, drag to `to`;
    then wait for the selection, and for the toolbar (true when it opened). */
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
  await waitIn(page, () => window.getSelection().toString().length > 0 || !window.__docsEditor.state.selection.empty, null, 5000);
  return toolbar(page);
}
async function selectWords(page, needle, nth = 0) {
  const r = await find(page, needle, nth);
  if (!r) throw new Error(`not in the page: "${needle}"`);
  await dragSelect(page, r.from, r.to);
  return r;
}
/** Select words drawn over the editor's text (a core, a card), as a
    person drags across them: the element `selector` finds, then `needle`
    in its words. True when the toolbar opened. */
async function dragWords(page, selector, needle) {
  const at = await page.evaluate(async ({ selector, needle }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    await window.__qa.showEl(el);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = "";
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ n, at: text.length });
      text += n.data;
    }
    const i = text.indexOf(needle);
    if (i < 0) return null;
    const point = (k) => {
      const hit = nodes.findLast((x) => x.at <= k);
      return [hit.n, k - hit.at];
    };
    const range = document.createRange();
    range.setStart(...point(i));
    range.setEnd(...point(i + needle.length - 1));
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const first = rects[0];
    const last = rects.at(-1);
    return { a: { x: first.left + 1, y: first.top + first.height / 2 }, b: { x: last.right + 2, y: last.top + last.height / 2 } };
  }, { selector, needle });
  if (!at) return false;
  await page.mouse.move(at.a.x - 20, at.a.y - 10);
  await page.mouse.move(at.a.x, at.a.y, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(at.b.x, at.b.y, { steps: 12 });
  await page.mouse.up();
  return toolbar(page);
}
/** Point at the first element `selector` finds, placed in the band: the
    app's tooltip then, or null. */
async function hoverTip(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? window.__qa.showEl(el) : null;
  }, selector);
  if (!box) return null;
  await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  const tip = await waitIn(page, () => document.querySelector("#app-tip")?.textContent || null, null, 5000);
  await page.mouse.move(5, 450);
  return tip;
}
/** The text toolbar (or a figure's tools) is open: waited for, `ms` at most. */
async function toolbar(page, ms = 6000) {
  return Boolean(await waitIn(page, () => {
    const bar = document.querySelector("[data-layer-toolbar]");
    return Boolean(bar && bar.getClientRects().length && bar.querySelector("[data-track]"));
  }, null, ms));
}
async function popoverOpen(page) {
  return page.locator("[data-layer-toolbar]").first().isVisible().catch(() => false);
}
/** A tool of the open toolbar, pressed. */
async function tool(page, track) {
  const el = page.locator(`[data-selection-popover] [data-track="${track}"]`).first();
  await el.waitFor({ state: "visible", timeout: 8000 }).catch(async (e) => {
    await shot(page, `no-tool-${track}`);
    throw e;
  });
  await el.click();
}
/** Escape until no toolbar and no card stands over the page. */
async function calm(page) {
  for (let i = 0; i < 3; i++) {
    const open = await page.evaluate(() => [...document.querySelectorAll("[data-selection-popover]")].some((e) => e.getClientRects().length));
    if (!open) return;
    await page.keyboard.press("Escape");
    await waitIn(page, () => ![...document.querySelectorAll("[data-selection-popover]")].some((e) => e.getClientRects().length), null, 1500);
  }
}
/** The toolbar's `nth` highlight color on the selection: the sources it
    stored, waited for. */
async function pressHighlight(page, documentId, nth = 0) {
  const before = new Set((await sourcesOf(documentId)).map((s) => s.id));
  const colors = page.locator('[data-selection-popover] [data-track^="highlight:"]');
  if (!(await colors.count())) return [];
  await colors.nth(nth).click();
  return (await until(async () => {
    const made = (await sourcesOf(documentId)).filter((s) => !before.has(s.id));
    return made.length ? made : null;
  }, 20_000, 400)) ?? [];
}
async function highlight(page, documentId, from, to, nth = 0) {
  await dragSelect(page, from, to);
  return pressHighlight(page, documentId, nth);
}
/** The words of a mark once they read `want` (spaces aside), waited for:
    the pieces as they stand then. */
async function painted(page, id, want, { attr = "data-source-id", ms = 30_000, includes = false } = {}) {
  return (await waitIn(page, ({ id, want, attr, includes }) => {
    const pieces = window.__qa.marked(id, attr);
    const words = pieces.join("").replace(/\s+/g, "");
    return (includes ? words.includes(want) : words === want) ? pieces : null;
  }, { id, want: squash(want), attr, includes }, ms)) ?? (await page.evaluate(({ id, attr }) => window.__qa.marked(id, attr), { id, attr }));
}
/** A side card's words once the model's answer is in. */
async function sideCard(page, kind, ms = 45_000) {
  return waitIn(page, (k) => {
    const t = document.querySelector(`[data-side-card="${k}"]`)?.textContent ?? "";
    return t.includes("Mock") ? t : null;
  }, kind, ms);
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
/** The ink (pixels unlike the page's ground) in the page's left margin,
    level with the line at `pos` and `lines` lines down: where page numbers
    draw, whatever draws them. */
async function marginInk(page, pos, lines = 1) {
  // The labels are placed a frame after a change: the layout holds first.
  await page.evaluate(() => window.__qa.settle());
  const clip = await page.evaluate(({ p, lines }) => {
    const view = window.__docsEditor.view;
    const c = view.coordsAtPos(p);
    const left = view.dom.getBoundingClientRect().left;
    return { x: Math.max(0, left - 100), y: Math.max(0, c.top - 3), width: 94, height: (c.bottom - c.top) * lines + 6 };
  }, { p: pos, lines });
  const png = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const ground = lum(0);
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(lum(i) - ground) > 50) ink++;
    return ink;
  }, png.toString("base64"));
}
/** Page starts inside a paragraph with at least `n` characters on each side. */
async function inlineStarts(page, n) {
  return (await pageStarts(page)).filter((s) => s.on === "paragraph" && s.before.length >= n && s.after.length >= n);
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
async function figureBy(page, test) {
  const figs = await figures(page);
  return figs.find((f) => test(f.caption ?? "")) ?? null;
}

/** Toasts, as the page announces them (the dissect:toast event). */
async function listenToasts(page) {
  await page.evaluate(() => {
    if (window.__toasts) return;
    window.__toasts = [];
    window.addEventListener("dissect:toast", (e) => window.__toasts.push(e.detail?.text ?? JSON.stringify(e.detail)), true);
  });
}
async function toasts(page) {
  return page.evaluate(() => window.__toasts ?? []);
}

/** Search the menus (Alt+/) with `query` typed: its rows, or null when the
    field did not open. */
async function searchMenus(page, query) {
  await page.evaluate(() => window.__docsEditor.commands.focus());
  await page.keyboard.press("Alt+/");
  const field = page.locator(".docs-search-open input").first();
  if (!(await field.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false))) return null;
  await field.fill(query);
  await waitIn(page, () => document.querySelector(".docs-search-row, .docs-search-empty"), null, 5000);
  return page.evaluate(() =>
    [...document.querySelectorAll(".docs-search-row")].map((r) => ({
      label: r.querySelector(".docs-search-label")?.textContent ?? "",
      where: r.querySelector(".docs-search-where")?.textContent ?? "",
      off: r.getAttribute("aria-disabled") === "true",
      note: r.querySelector(".docs-search-note")?.textContent ?? "",
    })),
  );
}
/** Run a page editor command by its label through Search the menus, as a
    person does. False when the field did not open or the command is off. */
async function menuCommand(page, label) {
  const rows = await searchMenus(page, label);
  if (!rows) return false;
  const i = Math.max(0, rows.findIndex((r) => r.label === label));
  if (!rows[i] || rows[i].off) {
    await page.keyboard.press("Escape");
    return false;
  }
  await page.locator(".docs-search-row").nth(i).click();
  await waitIn(page, () => !document.querySelector(".docs-search-open"), null, 5000);
  return true;
}
/** A File > Download command's file: its name and bytes, or null. */
async function download(page, label) {
  const file = page.waitForEvent("download", { timeout: 120_000 }).catch(() => null);
  const ran = await menuCommand(page, label);
  const d = ran ? await file : null;
  return d ? { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) } : null;
}
/** The clipboard's plain text once it holds some. */
async function clipboardText(page) {
  return until(() => page.evaluate(() => navigator.clipboard.readText()).catch((e) => `(${e.message})`), 3000, 150);
}

/** Center a figure object in the band and press its media (the part in
    view), as a person clicks a picture: the point, and whether the point
    was the figure's. */
async function clickFigure(page, pos) {
  await page.evaluate((p) => window.__qa.showNode(p), pos);
  const at = await page.evaluate((p) => window.__qa.figurePoint(p), pos);
  if (!at) return null;
  await clickAt(page, at.x, at.y);
  return at;
}

/** Scroll each figure object into view and wait for its image, as a person
    scrolls through: lazy images load only near the view. Returns
    {loaded, total, ms (each image's wait), failed (captions)}. */
async function loadFigureImages(page, timeout = 30_000) {
  const figs = await figures(page);
  let loaded = 0;
  let total = 0;
  const ms = [];
  const failed = [];
  for (const f of figs) {
    await page.evaluate((p) => window.__qa.showNode(p), f.pos);
    const t0 = Date.now();
    const ok = await page
      .waitForFunction((p) => {
        const imgs = [...(window.__docsEditor.view.nodeDOM(p)?.querySelectorAll("img") ?? [])];
        return imgs.length === 0 ? "none" : imgs.every((i) => i.complete && i.naturalWidth > 0) ? "ok" : null;
      }, f.pos, { timeout })
      .then((h) => h.jsonValue())
      .catch(() => "failed");
    if (ok === "none") continue;
    total++;
    if (ok === "ok") {
      loaded++;
      ms.push(Date.now() - t0);
    } else failed.push(clip(f.caption, 24));
  }
  return { loaded, total, ms, failed };
}

/** The scroll tip, as a person reads it: the pointer at the pane's right
    edge. Null when none shows. */
async function scrollTip(page) {
  const edge = await page.evaluate(() => {
    const r = window.__qa.pane().getBoundingClientRect();
    return { x: r.right - 6, y: r.top + r.height / 2 };
  });
  await page.mouse.move(edge.x - 40, edge.y);
  await page.mouse.move(edge.x, edge.y, { steps: 5 });
  const tip = await waitIn(page, () => document.querySelector(".docs-page-indicator")?.textContent || null, null, 5000);
  await page.mouse.move(edge.x - 300, edge.y);
  return tip;
}
/** Place a page start `dy` px above the pane's middle, where the tip reads. */
async function placeAboveMiddle(page, pos, dy = 60) {
  await page.evaluate(async ({ p, dy }) => {
    const view = window.__docsEditor.view;
    const r = window.__qa.pane(view.dom).getBoundingClientRect();
    const middle = r.top + window.__qa.pane(view.dom).clientHeight / 2;
    const el = view.nodeDOM(p);
    const top = () => (el?.nodeType === 1 ? el.getBoundingClientRect().top : view.coordsAtPos(p).top);
    await window.__qa.place(top, middle - dy, view.dom);
  }, { p: pos, dy });
}

/** Version history from the clock at the title row's right end: the listed versions. */
async function openVersions(page) {
  await page.locator('[data-track="docs:version-history"]').first().click().catch(() => {});
  await waitIn(page, () => document.querySelectorAll(".docs-versions-list .docs-versions-pick").length > 0, null, 30_000);
  return page.evaluate(() => [...document.querySelectorAll(".docs-versions-list .docs-versions-pick")].map((b) => b.textContent.trim()));
}
async function closeVersions(page) {
  await page.keyboard.press("Escape");
  await page.locator(".docs-versions-bar button").first().click().catch(() => {});
  await waitIn(page, () => !document.querySelector(".docs-versions"), null, 10_000);
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

// ── The run's documents ─────────────────────────────────────────────────────

// `alone` is the run alone's mark ("" on the first run): every fixture's
// bytes and address carry it, so the run alone adds its documents fresh.
const ctx = { notebookId: null, sectionId: null, docs: {}, bytes: {}, media: null, alone: "" };
const tagged = (tag = "") => `${STAMP}${ctx.alone}${tag}`;

async function prepare() {
  await launch();
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
  const t = tagged(tag);
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
    const stored = async () => JSON.stringify((await documentRow(added.id)).richText).length;
    const size = await stored();
    const since = new Date();
    const target = before.find((r) => r.type === "PARAGRAPH" && r.text.length > 60 && !r.cell) ?? before.find((r) => r.type === "PARAGRAPH");
    await setMode(page, "editing");
    const at = await find(page, target.text.slice(-12));
    await clickPos(page, at.to);
    await page.keyboard.type("x");
    await waitSaved(page);
    const after = await rowsOf(added.id);
    const edits = (await until(async () => {
      const e = await editsSince(added.id, since);
      return e.length ? e : null;
    }, 5000)) ?? [];
    const changed = after.filter((r) => before.find((b) => b.id === r.id)?.hash !== r.hash);
    const gone = before.filter((b) => !after.some((r) => r.id === b.id));
    const kinds = edits.map((e) => e.kind);
    const ok = changed.length === 1 && changed[0].id === target.id && gone.length === 0 && after.length === before.length && kinds.length === 1 && kinds[0] === "TEXT_EDIT";
    const detail = `${before.length} rows; changed ${changed.length} (${changed.slice(0, 3).map((r) => `${r.type} "${clip(r.text, 30)}"`).join(", ")}), removed ${gone.length}, added ${after.length - before.length + gone.length}; history ${JSON.stringify(kinds.slice(0, 6))}`;
    check("R1", ok, `${kind} (${theme}): one letter typed changes one row and writes one TEXT_EDIT`, detail);
    // The save keeps the stored copy compact: attributes at their default stay out.
    const saved = await stored();
    check("R1", saved <= size * 1.01 + 100, `${kind} (${theme}): the first save keeps the stored rich text compact`, `${size} → ${saved} characters`);
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
  const alien = { type: "futureObject", attrs: { blockId: `qa${tagged("alien")}` }, content: [{ type: "text", text: "Words of a node from a newer build." }] };
  const rich = { ...row.richText, content: [...row.richText.content, alien] };
  await db.document.update({ where: { id: added.id }, data: { richText: rich } });
  const { page, errors, context } = await newPage(theme);
  let loads = 0;
  page.on("load", () => loads++);
  await open(page, ctx.notebookId, added.id, { wait: false });
  // The one reload, then the frame with the reason: no reload after it.
  await waitIn(page, () => /can.t show/.test(document.querySelector('[role="alert"]')?.textContent ?? ""), null, 30_000);
  const state = await page.evaluate(() => ({
    prose: document.querySelector(".docs-prose")?.textContent.length ?? 0,
    frame: Boolean(document.querySelector(".docs-title-row")),
    says: document.querySelector('[role="alert"]')?.textContent ?? null,
  }));
  const path = await shot(page, `R2-unknown-node-${theme}`);
  const stored = await documentRow(added.id);
  const kept = JSON.stringify(stored.richText).includes("futureObject");
  check("R2", loads <= 2 && (state.prose > 0 || (state.frame && /can.t show/.test(state.says ?? ""))) && kept, `(${theme}) a stored node this build lacks: the frame or the page shows, it reloads at most once, the stored copy keeps the node`, `loads ${loads}, prose ${state.prose} chars, frame ${state.frame}, says "${clip(state.says, 90)}", stored keeps it ${kept}, ${path}`);
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
  const inline = await inlineStarts(page, 20);
  check("R3", starts.length > 0, `(${theme}) the PDF import shows page starts`, `${starts.length}: ${starts.slice(0, 16).map((s) => `p. ${s.page}${s.on === "paragraph" || s.on === "heading" ? "" : `[${s.on}]`}`).join(" ")}`);
  if (!inline.length) {
    fail("R3", "a page start inside a paragraph", "none found");
    await context.close();
    return;
  }
  const s = inline[0];
  // Select from 20 characters before the page start to 20 after.
  const from = s.pos - 20;
  const to = s.pos + 1 + 20;
  const opened = await dragSelect(page, from, to);
  const selected = await page.evaluate(() => window.getSelection().toString());
  const words = `${s.before.slice(-20)}${s.after.slice(0, 20)}`;
  check("R3", opened, `(${theme}) a selection across p. ${s.page} opens the toolbar in Viewing`, `selection "${clip(selected, 60)}"`);
  // The clipboard: the words only.
  await page.keyboard.press("Control+c");
  const copied = await clipboardText(page);
  check("R3", squash(copied) === squash(words) && !/p\.\s*\d/.test(copied), `(${theme}) Ctrl+C across p. ${s.page} copies the words alone`, `copied "${clip(copied, 80)}", words "${clip(words, 80)}"`);
  // Highlight, reload, and read the mark's words. The toolbar stays open
  // after Ctrl+C; when it does not, the words are selected again.
  if (!(await popoverOpen(page))) {
    note("R3", `(${theme}) the toolbar closed after Ctrl+C`, "the words are selected again");
    await dragSelect(page, from, to);
  }
  const made = await pressHighlight(page, added.id);
  check("R3", made.length === 1 && made[0].quotedText === words, `(${theme}) the highlight's quote is the words across the page start`, made.length ? `quote "${clip(made[0].quotedText, 80)}" at ${made[0].startOffset}-${made[0].endOffset} of ${made[0].blockId}` : "no source stored");
  await reload(page);
  const marks = made.length ? await painted(page, made[0].id, words) : [];
  const path = await shot(page, `R3-mark-across-page-start-${theme}`);
  check("R3", made.length > 0 && squash(marks.join("")) === squash(words), `(${theme}) after a reload the mark covers the same words`, `painted "${clip(marks.join(""), 80)}", ${path}`);
  // Backspace at the page start, in Editing, as a person holds it: each press
  // takes the letter before the page start, and the page start stays.
  await setMode(page, "editing");
  const again = (await pageStarts(page)).find((x) => x.page === s.page);
  await clickPos(page, again.pos + 1);
  const textBefore = await page.evaluate((p) => window.__qa.blockText(p), again.pos);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Backspace");
    await sleep(150);
  }
  const afterBackspace = (await pageStarts(page)).filter((x) => x.page === s.page);
  const textAfter = afterBackspace.length ? await page.evaluate((p) => window.__qa.blockText(p), afterBackspace[0].pos) : "";
  check("R3", afterBackspace.length === 1 && textAfter.length === textBefore.length - 3, `(${theme}) three Backspaces at p. ${s.page} take three letters before it and keep the page start`, `page starts for p. ${s.page}: ${afterBackspace.length}; words ${textBefore.length} → ${textAfter.length}; before it now "${afterBackspace[0]?.before.slice(-12) ?? ""}"`);
  await page.keyboard.press("Control+z");
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
    const joined = (await pageStarts(page)).filter((x) => x.page === opening.page);
    const paragraphsAfter = await count();
    check("R3", joined.length === 1 && paragraphsAfter === paragraphs - 1 && joined[0].before.length > 0, `(${theme}) Backspace at a paragraph that opens with p. ${opening.page} joins it to the one above, the page start kept`, `paragraphs ${paragraphs} → ${paragraphsAfter}; p. ${opening.page} now after "${joined[0]?.before.slice(-15) ?? ""}"`);
    await page.keyboard.press("Control+z");
  }
  // A deletion that takes the page start with words on both sides.
  const cur = (await pageStarts(page)).find((x) => x.page === s.page) ?? again;
  await dragSelect(page, cur.pos - 6, cur.pos + 7);
  await page.keyboard.press("Delete");
  const afterDelete = (await pageStarts(page)).filter((x) => x.page === s.page);
  check("R3", afterDelete.length === 1, `(${theme}) a deletion across p. ${s.page} puts the page start back where it closed`, `page starts for p. ${s.page}: ${afterDelete.length}${afterDelete[0] ? `, before "${afterDelete[0].before.slice(-12)}" after "${afterDelete[0].after.slice(0, 12)}"` : ""}`);
  // Undo both, and wait for the save.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await waitSaved(page).catch(() => {});
  // Two page starts on one line (the words of a whole page deleted) draw
  // both numbers: twice the ink of one number in the margin.
  const [one, two] = (await pageStarts(page)).filter((x) => x.on === "paragraph" && x.page > 1).slice(0, 2);
  await page.evaluate((p) => window.__qa.show(p), one.pos);
  const single = await marginInk(page, one.pos);
  await page.evaluate(({ from, to }) => window.__docsEditor.commands.setTextSelection({ from, to }), { from: one.pos + 1, to: two.pos });
  await page.keyboard.press("Delete");
  const joined = (await pageStarts(page)).filter((x) => x.page === one.page || x.page === two.page);
  const oneLine = joined.length === 2 && (await page.evaluate(([a, b]) => Math.abs(window.__docsEditor.view.coordsAtPos(a).top - window.__docsEditor.view.coordsAtPos(b).top) < 4, joined.map((x) => x.pos)));
  await page.evaluate((p) => window.__qa.show(p), joined[0].pos);
  const both = await marginInk(page, joined[0].pos, 2);
  const bothShot = await shot(page, `R3-two-page-starts-one-line-${theme}`);
  check("R3", oneLine && both > single * 1.6, `(${theme}) two page starts on one line draw both numbers`, `p. ${one.page} and p. ${two.page} on one line ${oneLine}; margin ink ${both} against ${single} for one number ${bothShot}`);
  await page.keyboard.press("Control+z");
  await waitSaved(page).catch(() => {});
  // A page start in a table's second column (a stored text, as a PDF whose
  // page begins there gives it) draws in the page's margin, not in the
  // table: p. 9 moved into the second column of the table on p. 8.
  const row = await documentRow(added.id);
  const moved = JSON.parse(JSON.stringify(row.richText));
  const pagesIn = (n) => (n.type === "pageStart" ? [n.attrs?.page] : (n.content ?? []).flatMap(pagesIn));
  const at8 = moved.content.findIndex((n) => pagesIn(n).includes(8));
  const at9 = moved.content.findIndex((n) => pagesIn(n).includes(9));
  const table = moved.content.find((n, i) => i > at8 && i < at9 && n.type === "table");
  const cell = table?.content?.[1]?.content?.[1]?.content?.[0];
  if (cell) {
    const lift = (n) => {
      const start = n.content?.find((c) => c.type === "pageStart" && c.attrs?.page === 9);
      if (start) n.content = n.content.filter((c) => c !== start);
      return start ?? (n.content ?? []).map(lift).find(Boolean);
    };
    cell.content = [lift(moved.content[at9]), ...(cell.content ?? [])];
    await db.document.update({ where: { id: added.id }, data: { richText: moved } });
    await reload(page);
    const inCell = (await pageStarts(page)).find((x) => x.page === 9);
    await page.evaluate((p) => window.__qa.show(p), inCell.pos);
    const ink = await marginInk(page, inCell.pos);
    const cellShot = await shot(page, `R3-page-start-in-second-column-${theme}`);
    check("R3", ink > single * 0.6, `(${theme}) a page start in a table's second column draws its number in the page's margin`, `margin ink ${ink} against ${single} for a paragraph's number ${cellShot}`);
    await db.document.update({ where: { id: added.id }, data: { richText: row.richText } });
  } else note("R3", `(${theme}) a table between p. 8 and p. 9 to hold p. 9`, `p. 8 at ${at8}, p. 9 at ${at9}, table ${Boolean(table)}`);
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
  const pressed = await clickFigure(page, fig3.pos);
  const tools = await toolbar(page);
  const analyze = page.locator('[data-selection-popover] [data-track="analyze"]');
  check("R5", tools && (await analyze.count()) > 0, `(${theme}) a click on a figure opens its tools with Analyze`, `toolbar ${tools}; pressed ${JSON.stringify(pressed)}`);
  if (await analyze.count()) await analyze.first().click();
  const src = await sourceWhere(added.id, (x) => x.blockId === fig3.blockId, 30_000);
  check("R5", Boolean(src), `(${theme}) Analyze anchors to the figure's row`, src ? `quote "${src.quotedText}" ${src.note.derivationType}` : JSON.stringify((await sourcesOf(added.id)).map((s) => s.quotedText)));
  // The ring in the kind color, the label chip, data-source-id: painted once
  // the stored annotation is on screen, with the figure no longer selected.
  await calm(page);
  await waitIn(page, (p) => window.__docsEditor.view.nodeDOM(p)?.hasAttribute("data-source-id"), fig3.pos);
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
  // A second annotation (Explain, from the figure's tools): a jump to it,
  // as the Annotations tab's Jump fires it, brings the figure itself to the
  // middle of the view, not its label.
  await calm(page);
  await clickFigure(page, fig3.pos);
  if (await toolbar(page)) await tool(page, "explain");
  const second = await sourceWhere(added.id, (x) => x.blockId === fig3.blockId && x.note.derivationType === "EXPLAIN", 30_000);
  if (second) {
    await calm(page);
    await waitIn(page, (id) => document.querySelector(`.docs-object-label [data-source-id="${id}"]`), second.id);
    await page.evaluate(() => {
      window.__qa.pane().scrollTop = 0;
    });
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("dissect:flash-source", { detail: { sourceId: id } })), second.id);
    const middle = await page.evaluate(() => {
      const r = window.__qa.pane().getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    });
    const off = await until(() => page.evaluate(({ p, middle }) => {
      const r = window.__docsEditor.view.nodeDOM(p).getBoundingClientRect();
      const d = Math.round((r.top + r.bottom) / 2 - middle);
      return Math.abs(d) < 60 ? { d } : null;
    }, { p: fig3.pos, middle }), 10_000) ?? { d: await page.evaluate(({ p, middle }) => Math.round(window.__docsEditor.view.nodeDOM(p).getBoundingClientRect().top - middle), { p: fig3.pos, middle }) };
    const label = await page.evaluate(() => document.querySelector(".docs-object-label")?.textContent ?? null);
    const jumpShot = await shot(page, `R5-jump-second-annotation-${theme}`);
    check("R5", Math.abs(off.d) < 60 && /A1.*A2|A2.*A1/.test(label ?? ""), `(${theme}) a jump to the figure's second annotation brings the figure to the middle of the view`, `label "${label}"; the figure's middle ${off.d} px from the pane's ${jumpShot}`);
  } else fail("R5", `(${theme}) Explain from the figure's tools stores a second annotation`, JSON.stringify((await sourcesOf(added.id)).map((x) => x.note.derivationType)));
  // A link across texts that ends on the figure (the Markdown import's words
  // to it) draws on the figure object: its ring and a link in its chip.
  const md = await doc("markdown");
  const from = (await rowsOf(md.id)).find((r) => r.text.startsWith("The marsh rises"));
  const link = await db.docLink.create({ data: { fromDocumentId: md.id, fromBlockId: from.id, startOffset: 0, endOffset: 22, quotedText: from.text.slice(0, 22), prefix: "", suffix: from.text.slice(22, 54), toDocumentId: added.id, toBlockId: fig3.blockId, toStartOffset: 0, toEndOffset: fig3.caption.length, toQuotedText: fig3.caption, toPrefix: "", toSuffix: "", createdById: "user-1" } });
  await reload(page);
  const linked = (await waitIn(page, ({ p, id }) => {
    const el = window.__docsEditor.view.nodeDOM(p);
    const chip = [...document.querySelectorAll(".docs-object-label")].find((c) => Math.abs(c.getBoundingClientRect().top - el.getBoundingClientRect().top) < 40);
    return el.getAttribute("data-link-id") === id || chip?.querySelector('[data-docs-open="link"]') ? { ring: el.getAttribute("data-link-id") === id, chipLink: Boolean(chip?.querySelector('[data-docs-open="link"]')), style: el.getAttribute("style") } : null;
  }, { p: fig3.pos, id: link.id }, 20_000)) ?? { ring: false, chipLink: false };
  const linkShot = await shot(page, `R5-link-to-figure-${theme}`);
  check("R5", linked.ring && linked.chipLink, `(${theme}) a link across texts that ends on a figure draws on the figure: its ring and the link in its chip`, `${JSON.stringify(linked)} ${linkShot}`);
  // Delete the figure in Editing, as a person: a click on it, Escape for its
  // tools, Delete.
  await setMode(page, "editing");
  const selectedAt = (p) => page.evaluate((q) => {
    const sel = window.__docsEditor.state.selection;
    return sel.constructor.name === "NodeSelection" && sel.from === q;
  }, p);
  // A press: its tools open; Escape closes them and keeps the figure selected.
  const press = async (f) => {
    await calm(page);
    const at = await clickFigure(page, f.pos);
    const opened = await toolbar(page);
    await page.keyboard.press("Escape");
    await waitIn(page, () => !document.querySelector("[data-layer-toolbar]"), null, 3000);
    const selected = Boolean(await until(() => selectedAt(f.pos), 2000, 100));
    return { opened, selected, at };
  };
  let first = true;
  const pick = async (caption) => {
    const f = await figureBy(page, (c) => c.trim() === caption);
    if (!f) return null;
    let took = await press(f);
    if (first) {
      // Twice: the second press is on the selected figure.
      first = false;
      const again = await press(f);
      check("R5", took.opened && took.selected && again.opened && again.selected, `(${theme}) in Editing a press on "${caption}" opens its tools and Escape keeps it selected, a second press too`, `first: tools ${took.opened}, selected ${took.selected}; second: tools ${again.opened}, selected ${again.selected}; pressed ${JSON.stringify(took.at)}`);
      took = again;
    }
    // A person presses again when the press took nothing.
    if (!took.selected) await press(f);
    return f;
  };
  await pick("Figure 3");
  const beforeDelete = await page.evaluate(() => {
    const sel = window.__docsEditor.state.selection;
    return `${sel.constructor.name} ${sel.from}-${sel.to}, focus ${document.activeElement?.className?.slice?.(0, 30) ?? document.activeElement?.tagName}`;
  });
  await page.keyboard.press("Delete");
  await waitSaved(page);
  const afterDelete = await sourceWhere(added.id, (s) => s.id === src.id && s.orphaned, 10_000) ?? (await sourcesOf(added.id)).find((s) => s.id === src.id);
  const movedTo = afterDelete && !afterDelete.orphaned ? await rowText(afterDelete.blockId) : null;
  const gone = !(await figures(page)).some((f) => (f.caption ?? "").trim() === "Figure 3");
  check("R5", gone && afterDelete?.orphaned === true, `(${theme}) deleting the figure orphans its annotation (never moves it into "As Figure 3 shows")`, afterDelete ? `before Delete: ${beforeDelete}; figure gone ${gone}, orphaned ${afterDelete.orphaned}${movedTo ? `, now on ${movedTo.type} "${clip(movedTo.text, 60)}"` : ""}` : "source gone");
  // Ctrl+Z brings the figure and its annotation back.
  await page.keyboard.press("Control+z");
  await waitSaved(page);
  const figsBack = await figures(page);
  const back = await sourceWhere(added.id, (s) => s.id === src.id && !s.orphaned && figsBack.some((f) => f.blockId === s.blockId), 10_000);
  check("R5", Boolean(back), `(${theme}) Ctrl+Z brings the figure back and its annotation with it`, back ? `on ${back.blockId}` : JSON.stringify((await sourcesOf(added.id)).filter((s) => s.id === src.id).map((s) => ({ orphaned: s.orphaned, blockId: s.blockId }))));
  // Cut and paste the figure under the heading "The measurements": it moves,
  // and the annotation follows it.
  const index = async () => page.evaluate(() => {
    const out = [];
    window.__docsEditor.state.doc.forEach((n) => out.push(n.type.name === "figure" ? `F:${n.attrs.caption.trim()}` : n.textContent.slice(0, 20)));
    return { figure: out.indexOf("F:Figure 3"), heading: out.indexOf("The measurements") };
  });
  const before = await index();
  const cut = await pick("Figure 3");
  if (cut) {
    await page.keyboard.press("Control+x");
    await waitIn(page, (id) => {
      let found = false;
      window.__docsEditor.state.doc.descendants((n) => {
        if (n.attrs?.blockId === id) found = true;
        return !found;
      });
      return !found;
    }, cut.blockId, 5000);
    const target = await find(page, "The measurements");
    await clickPos(page, target.to);
    const caret = await page.evaluate(() => window.__docsEditor.state.selection.$from.parent.textContent.slice(0, 20));
    await page.keyboard.press("End");
    await page.keyboard.press("Control+v");
    await waitSaved(page);
    const after = await index();
    const moved = await figureBy(page, (c) => c.trim() === "Figure 3");
    const followed = moved ? await sourceWhere(added.id, (s) => s.id === src.id && !s.orphaned && s.blockId === moved.blockId, 10_000) : null;
    const now = (await sourcesOf(added.id)).find((s) => s.id === src.id);
    check("R5", Boolean(moved && after.figure > after.heading && followed), `(${theme}) cut and paste moves the figure under "The measurements" and the annotation follows it`, `caret in "${caret}"; figure at ${before.figure} → ${after.figure} (heading ${after.heading}); source on ${now?.blockId === moved?.blockId ? "the moved figure" : now?.blockId} orphaned ${now?.orphaned}`);
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
        { type: "figure", attrs: { blockId: `qa${tagged("f1")}`, mediaId: foreign.id, caption: "Foreign figure", page: null, region: null } },
        { type: "figure", attrs: { blockId: `qa${tagged("f2")}`, mediaId: own.id, caption: "Own figure", html: '<img src="x" onerror="alert(1)">', page: null, region: null } },
      ],
    };
    const put = await api(`/api/documents/${web.id}/rich-text`, "PUT", { richText: crafted, rev: stored.richTextRev });
    const after = await documentRow(web.id);
    const json = JSON.stringify(after.richText);
    check("R6", put.status === 200 && !json.includes(foreign.id), "a save with another document's mediaId drops that figure", `PUT ${put.status}; stored holds the foreign mediaId: ${json.includes(foreign.id)}`);
    check("R6", put.status === 200 && !json.includes("onerror"), "a save with an html attribute on a figure keeps no html", `stored holds the html: ${json.includes("onerror")}`);
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
  const copied = await until(() => page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      const html = items[0]?.types.includes("text/html") ? await (await items[0].getType("text/html")).text() : "";
      return html ? { html: html.includes("data-docs-figure"), media: /data-media-id="[^"]+"/.exec(html)?.[0] ?? null } : null;
    } catch (e) {
      return { error: String(e) };
    }
  }), 3000, 150);
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
  const said = (await until(async () => {
    const t = await toasts(page);
    return t.length ? t : null;
  }, 5000, 150)) ?? [];
  const after = (await figures(page)).length;
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
  // Three pending notes on the import, for the queue's keys.
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
  const statusCount = async () => (await db.note.findMany({ where: { id: { in: pending } }, select: { status: true } })).reduce((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {});
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
  await waitIn(page, () => [...document.querySelectorAll("[data-comment-card]")].some((c) => c.getClientRects().length && c.textContent.includes("made in Viewing")), null, 15_000);
  const cardMs = Date.now() - posted;
  const card = await page.evaluate(() => [...document.querySelectorAll("[data-comment-card]")].filter((c) => c.getClientRects().length).map((c) => c.textContent.slice(0, 80)));
  const commentShot = await shot(page, `R7-comment-in-viewing-${theme}`);
  check("R7", card.some((c) => c.includes("Viewing")), `(${theme}) the comment's card shows in Viewing`, `${card.length} cards after ${cardMs} ms ${clip(card.join(" | "), 100)} ${commentShot}`);
  // Highlight and Explain in Viewing.
  const hl = await find(page, "the sediment which once rebuilt them");
  await highlight(page, added.id, hl.from, hl.to);
  await selectWords(page, "the loss is measurable from one flood season to the next");
  await tool(page, "explain");
  const explain = (await sideCard(page, "explain")) ?? (await page.locator('[data-side-card="explain"]').first().innerText().catch(() => ""));
  check("R7", explain.length > 20, `(${theme}) Explain answers in Viewing`, clip(explain, 80));
  const kinds = (await sourcesOf(added.id)).map((s) => s.note.derivationType ?? (s.note.color ? `highlight:${s.note.color}` : "comment"));
  note("R7", `(${theme}) annotations made in Viewing`, kinds.join(", "));
  // The queue's keys reach the notes tray.
  await calm(page);
  await page.mouse.click(5, 450);
  const focusBefore = await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}.${String(a.className).slice(0, 40)}${a.closest("[data-comment-card]") ? " (in a comment card)" : ""}` : "none";
  });
  for (const key of ["k", "k", "k", "Enter"]) {
    await page.keyboard.press(key);
    await sleep(120);
  }
  await until(async () => (await statusCount()).ACCEPTED >= 1, 10_000);
  await page.keyboard.press("j");
  await sleep(120);
  await page.keyboard.press("Backspace");
  const counts = (await until(async () => {
    const c = await statusCount();
    return c.REJECTED >= 1 ? c : null;
  }, 10_000)) ?? (await statusCount());
  check("R7", (counts.ACCEPTED ?? 0) >= 1 && (counts.REJECTED ?? 0) >= 1, `(${theme}) in Viewing, j k Enter Backspace act on the pending notes`, `${JSON.stringify(counts)}; focus before the keys: ${focusBefore}`);
  // Editing: the same keys type.
  await setMode(page, "editing");
  const at = await find(page, "What comes next");
  await clickPos(page, at.to);
  await page.keyboard.type(" jk");
  const typed = await page.evaluate(() => window.__docsEditor.state.doc.textContent.includes("What comes next jk"));
  const countsAfter = await statusCount();
  check("R7", typed && JSON.stringify(countsAfter) === JSON.stringify(counts), `(${theme}) in Editing the same keys type in the page`, `typed ${typed}; notes ${JSON.stringify(countsAfter)}`);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await waitSaved(page).catch(() => {});
  // Editing is remembered on a reload.
  await reload(page);
  const remembered = await until(async () => (await mode(page)) === "editing", 5000);
  check("R7", remembered, `(${theme}) Editing is remembered on a reload`, `mode ${await mode(page)}`);
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
  const edited = async () => JSON.stringify((await documentRow(added.id)).richText).includes("(edited)");
  // The route: 409 without replaceEdits.
  const refused = await api(`/api/documents/${added.id}/reparse`, "POST", {});
  const stillEdited = await edited();
  check("R8", refused.status === 409 && stillEdited, "a re-parse of an edited import answers 409 and keeps the edit", `HTTP ${refused.status} ${clip(JSON.stringify(refused.body), 100)}; edit kept ${stillEdited}`);
  // A stale address added again: the edited import is not re-parsed over.
  await db.document.update({ where: { id: added.id }, data: { parserVersion: 1 } });
  const again = await add(ctx.notebookId, { url: `${FIXTURE}/article.html?run=${tagged("-r8")}` });
  const keptAfterAdd = await edited();
  check("R8", keptAfterAdd, "a stale address added again never re-parses over an edited import", `the add gave ${again.id === added.id ? "the same document" : `another document (${again.id})`}, edit kept ${keptAfterAdd}`);
  // The document list asks first: ⋮ on the document's row, Re-parse, and
  // the question; Keep the edits keeps them.
  await reload(page);
  let asked = null;
  await page.locator('[data-track="strip-documents"], [data-track="document-list"]').first().click().catch(() => {});
  // The open document's row is the active one; its ⋮ stands beside it.
  const actions = page.locator('[data-track="document-open"][data-active-row]').first().locator("xpath=..").locator('[data-track="document-actions"]').first();
  await actions.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  if (await actions.count()) {
    await actions.click();
    await page.locator('[data-track="document-reparse"]').first().click({ timeout: 5000 }).catch(() => {});
    asked = await waitIn(page, () => document.querySelector('[data-track="document-reparse-keep"]')?.closest('[role="group"]')?.textContent || null, null, 10_000);
    await shot(page, "R8-reparse-asks");
    await page.locator('[data-track="document-reparse-keep"]').first().click().catch(() => {});
    await waitIn(page, () => !document.querySelector('[data-track="document-reparse-keep"]'), null, 5000);
  }
  const keptAfterNo = await edited();
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
  // The reader's pages: its page blocks draw.
  const view = (await waitIn(page, () => {
    const pages = document.querySelectorAll('article [data-block-id], [data-page-block], img[src*="/page/"]').length;
    return pages > 0 ? { docs: Boolean(document.querySelector(".docs-prose")), pages } : null;
  }, null, 60_000)) ?? (await page.evaluate(() => ({ docs: Boolean(document.querySelector(".docs-prose")), pages: 0 })));
  await shot(page, "R8-shape-switch-pages");
  check("R8", !view.docs && view.pages > 0, "after the switch the reader shows pages, not the page editor", JSON.stringify(view));
  if (errors.length) note("R8", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R9: an import another account's project holds is not editable here, the
// server refuses the save, and dedupe never hands out an edited import.
RISKS.R9 = async (theme) => {
  const added = await fresh("pdf", `-r9${theme[0]}`);
  const other = await db.notebook.create({ data: { title: `QA other account ${tagged()}`, userId: "qa-other-account", sections: { create: { title: "Notes", order: 0 } } } });
  await db.notebookDocument.create({ data: { notebookId: other.id, documentId: added.id } });
  const { page, errors, context } = await newPage(theme);
  await open(page, ctx.notebookId, added.id);
  await page.click('[data-track="docs:mode"]');
  await waitIn(page, () => document.querySelectorAll('[data-track^="docs:mode:"]').length > 0, null, 10_000);
  const menu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-track^="docs:mode:"]')].map((el) => ({ track: el.dataset.track, disabled: el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled") }));
    const reason = [...document.querySelectorAll(".docs-menu-modes p")].map((p) => p.textContent).join(" ");
    return { items, reason };
  });
  const path = await shot(page, `R9-shared-mode-menu-${theme}`);
  await page.keyboard.press("Escape");
  const editingOff = menu.items.filter((i) => i.track !== "docs:mode:viewing").every((i) => i.disabled);
  check("R9", editingOff && menu.reason.length > 10, `(${theme}) on a shared import Editing and Suggesting are off, with the reason`, `${JSON.stringify(menu.items)} "${clip(menu.reason, 100)}" ${path}`);
  // Search the menus says the same.
  const rows = ((await searchMenus(page, "mode")) ?? []).filter((r) => /^(Editing|Suggesting) mode$/.test(r.label));
  const searchShot = await shot(page, `R9-shared-search-menus-${theme}`);
  await page.keyboard.press("Escape");
  check("R9", rows.length === 2 && rows.every((r) => r.off && r.note.length > 10), `(${theme}) on a shared import Search the menus shows Editing mode and Suggesting mode off, with the reason`, `${JSON.stringify(rows.map((r) => ({ label: r.label, off: r.off, note: clip(r.note, 50) })))} ${searchShot}`);
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
    await api(`/api/documents/${solo.id}/rich-text`, "PUT", { richText: { ...soloRow.richText, content: [...soloRow.richText.content, { type: "paragraph", attrs: { blockId: `qa${tagged("edit")}` }, content: [{ type: "text", text: "An edit by another reader." }] }] }, rev: soloRow.richTextRev });
    const second = await add(ctx.notebookId, { bytes: stamped(ctx.bytes.attention, tagged("-r9dedupe")), name: "attention-again.pdf", type: "application/pdf" });
    const secondRow = second.id ? await documentRow(second.id) : null;
    check("R9", second.id && second.id !== solo.id && secondRow?.importRev === secondRow?.richTextRev, "the same PDF added after an edit gives an unedited import", `first ${solo.id}, second ${second.id} (deduped ${second.deduped}), second rev ${secondRow?.richTextRev}/${secondRow?.importRev}`);
    const unedited = await add(ctx.notebookId, { bytes: stamped(ctx.bytes.attention, tagged("-r9dedupe")), name: "attention-third.pdf", type: "application/pdf" });
    check("R9", unedited.id === second.id && unedited.deduped === true, "an unedited import is handed out again", `third ${unedited.id} deduped ${unedited.deduped}`);
  }
  // The assistant offers no edit commands on the shared import (C2).
  await selectWords(page, "attention").catch(() => {});
  const assistant = page.locator('[data-selection-popover] [data-track="assistant"]').first();
  if (await assistant.count()) {
    await assistant.click();
    // Its own box (Viewing only): no command chip; a typed change lands
    // nothing, and its plan holds no edit.
    const field = page.locator("[data-layer-toolbar] textarea").first();
    await field.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    const chips = await page.locator('[data-track^="assistant-command:"]').count();
    const answered = page.waitForResponse((r) => r.url().includes("/api/assistant") && r.request().method() === "POST", { timeout: 60_000 }).catch(() => null);
    await field.fill("Shorten this paragraph.").catch(() => {});
    await page.keyboard.press("Enter");
    const res = await answered;
    const body = res ? await res.text().catch(() => "") : "";
    const edits = [...body.matchAll(/"type":"(edit_block|insert_paragraph|remove_block|format_block|style|suggest)"/g)].map((m) => m[1]);
    const landed = await page.evaluate(() => document.querySelectorAll(".docs-prose [data-suggestion]").length);
    check("R9", chips === 0 && res?.status() === 200 && edits.length === 0 && landed === 0, `(${theme}) the assistant offers no edit on a shared import: no command chips, and a typed change plans no edit`, `${chips} command chips; answer HTTP ${res?.status() ?? "none"}; edit actions ${JSON.stringify(edits)}; suggestions in the page ${landed}`);
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
  const saveReq = page.waitForResponse((r) => r.url().includes("/rich-text") && r.request().method() === "PUT", { timeout: 120_000 }).catch(() => null);
  const t0 = Date.now();
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.__docsEditor.state.doc.textContent.includes("Pasted paragraph 400"), null, { timeout: 60_000 });
  const pasted = Date.now() - t0;
  const resp = await saveReq;
  time("R11", "a 400-paragraph paste into the paper", `in the page after ${pasted} ms; the save answered ${resp?.status() ?? "none"} after ${Date.now() - t0} ms`);
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
    const long = await longPdf(browser, target, tagged(`-${target}`));
    const added = await add(ctx.notebookId, { bytes: long.bytes, name: `long-${long.pages}-${tagged()}.pdf`, type: "application/pdf" });
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
      await waitSaved(longPage, 60_000).catch(() => {});
      const stored = (await documentRow(added.id)).richText;
      time("R11", `the ${long.pages}-page import in the page editor`, `open to text/editor ${opens.map((o) => `${o.text}/${o.ready}`).join(", ")} ms; letters ${stats(lat.filter((l) => l.key.length === 1).map((l) => l.ms))}; Enter ${stats(lat.filter((l) => l.key === "Enter").map((l) => l.ms))}; a save answered ${resp?.status() ?? "none"} after ${Date.now() - t0} ms; stored ${JSON.stringify(stored).length} chars after the editor's saves (${json} at import)`);
      await longContext.close();
    } else {
      // A block document stores no rich text: the guard's measure (the
      // converter's rows and bytes) is not in the database, so the add's
      // own detail says why.
      check("R11", !row?.richText && rows > 0, `the size guard keeps the ${long.pages}-page PDF (${rows} rows) a block document`, `rows ${rows}`);
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
  // A person's scroll to p. 12: the wheel, so the reader saves the place.
  await page.evaluate((p) => window.__qa.show(p, window.__qa.band().top + 40), twelve.pos);
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, -60);
  const saved = await put;
  // The tab's copy names the block on the reading line.
  const at = await waitIn(page, () => {
    const line = window.__qa.readingLine();
    return line && line.saved === line.id ? line : null;
  }, null, 10_000) ?? (await page.evaluate(() => window.__qa.readingLine()));
  await page.reload({ waitUntil: "domcontentloaded" });
  const t0 = Date.now();
  await page.waitForFunction(() => Boolean(window.__docsEditor), null, { timeout: 120_000 });
  const mounted = Date.now() - t0;
  // The reader restores the place and holds it while the layout settles.
  const back = (await waitIn(page, (want) => {
    const line = window.__qa.readingLine();
    return line && line.id === want.id && Math.abs(line.dy - want.dy) < 40 ? line : null;
  }, at, 30_000)) ?? (await page.evaluate(() => window.__qa.readingLine()));
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
  check("R13", images.total > 0 && images.loaded === images.total, "every figure image of the PDF import loads in view", `${images.loaded} of ${images.total}${images.failed.length ? `; not in 30 s: ${images.failed.join(", ")}` : ""}`);
  time("R13", "a PDF figure's crop, from scrolled into view to drawn", stats(images.ms));
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
  // Before anything scrolls near the video.
  const far = await videoState();
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
    const where = await page.evaluate(() => ({ active: document.activeElement?.tagName, inPage: Boolean(document.activeElement?.closest(".ProseMirror")), typed: window.__docsEditor.state.doc.textContent.includes("QQ") }));
    check("R14", where.inPage && where.typed, `(${theme}) typing beside the embed types in the page`, JSON.stringify(where));
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
  } else fail("R14", `(${theme}) a paragraph after the embed`, "none");
  const fig5 = await figureBy(page, (c) => /Figure 5/.test(c));
  if (fig5) await page.evaluate((p) => window.__qa.showNode(p), fig5.pos);
  await waitIn(page, () => [...document.querySelectorAll(".docs-prose .docs-figure video")].some((v) => !v.paused || v.currentTime > 0), null, 20_000);
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
  // The page sends the media its text names, never an older parse's;
  // Version history fetches the media a version names when it shows it.
  const named = new Set([...JSON.stringify((await documentRow(web.id)).richText).matchAll(/"mediaId":"([^"]+)"/g)].map((m) => m[1]));
  const html = await fetch(`${BASE}/n/${ctx.notebookId}?doc=${web.id}`).then((r) => r.text());
  const sent = media.filter((m) => html.includes(m.id)).map((m) => m.id);
  check("R15", named.size > 0 && sent.length === named.size && sent.every((id) => named.has(id)), "after a re-parse the page sends only the media its text names", `${sent.length} of ${media.length} media rows in the page (${Math.round(html.length / 1024)} KB); the text names ${named.size}`);
  await openVersions(page);
  await page.locator(".docs-versions-list .docs-versions-pick", { hasText: "Imported" }).last().click().catch(() => {});
  await waitIn(page, () => document.querySelector(".docs-versions-page .docs-figure"), null, 30_000);
  // As a person scrolls through: a lazy image loads near the view.
  const drawnOld = await page.evaluate(async () => {
    const figs = [...document.querySelectorAll(".docs-versions-page .docs-figure")];
    let drawn = 0;
    for (const f of figs) {
      f.scrollIntoView({ block: "center" });
      const media = [...f.querySelectorAll("img, svg, video, iframe")];
      await Promise.race([Promise.all(media.filter((m) => m.tagName === "IMG").map((m) => m.decode().catch(() => {}))), new Promise((r) => setTimeout(r, 10_000))]);
      if (media.some((m) => m.tagName !== "IMG" || (m.complete && m.naturalWidth > 0))) drawn++;
    }
    return { figures: figs.length, drawn };
  });
  const versionShot = await shot(page, "R15-version-imported-media");
  check("R15", drawnOld.figures === oldMedia.length && drawnOld.drawn === oldMedia.length, "Version history shows \"Imported\" with the media it names", `${JSON.stringify(drawnOld)} of ${oldMedia.length} ${versionShot}`);
  await closeVersions(page);
  const versions = await api(`/api/documents/${web.id}/versions`);
  // Newest first: the original import's version is the last "Imported".
  const listed = Array.isArray(versions.body) ? versions.body : (versions.body.versions ?? []);
  const imported = listed.filter((v) => v.name === "Imported").at(-1);
  if (!imported) {
    fail("R15", "the version \"Imported\" is listed", clip(JSON.stringify(versions.body), 200));
    await context.close();
    return;
  }
  const v = await api(`/api/documents/${web.id}/versions/${imported.id}`);
  const restored = v.body.richText ?? v.body.version?.richText;
  const row = await documentRow(web.id);
  const put = await api(`/api/documents/${web.id}/rich-text`, "PUT", { richText: restored, rev: row.richTextRev });
  await reload(page);
  const figs = await figures(page);
  // Each figure draws its media once it loads: waited for, figure by figure.
  for (const f of figs) {
    await page.evaluate((p) => window.__qa.showNode(p), f.pos);
    await waitIn(page, (p) => {
      const el = window.__docsEditor.view.nodeDOM(p);
      return [...(el?.querySelectorAll("img, svg, iframe, video") ?? [])].some((m) => m.getBoundingClientRect().width > 20 && (m.tagName !== "IMG" || (m.complete && m.naturalWidth > 0)));
    }, f.pos, 15_000);
  }
  const drawing = await page.evaluate(() =>
    [...document.querySelectorAll(".docs-prose .docs-figure")].map((f) => ({
      caption: f.textContent.trim().slice(-24),
      drawn: [...f.querySelectorAll("img, svg, iframe, video")].some((m) => m.getBoundingClientRect().width > 20 && !(m.tagName === "VIDEO" && m.readyState === 0 && m.closest("[hidden]"))),
      says: f.textContent.includes("not loading") ? "not loading" : null,
    })),
  );
  const shown = drawing.filter((d) => d.drawn && !d.says).length;
  const path = await shot(page, "R15-restored-imported");
  check("R15", put.status === 200 && figs.length > 0 && figs.every((f) => oldMedia.some((m) => m.id === f.mediaId)) && shown === figs.length, "Restore \"Imported\" after a re-parse: every figure shows its media", `PUT ${put.status}; ${figs.length} figure objects on the old media, ${shown} drawing their media${drawing.filter((d) => !d.drawn || d.says).map((d) => `; not drawn "${d.caption}"${d.says ? ` (${d.says})` : ""}`).join("")} ${path}`);
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
      await page.evaluate((p) => window.__qa.showNode(p), f.pos);
      plates.push(await waitIn(page, (p) => {
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
      }, f.pos, 10_000));
      await shot(page, `R16-dark-${d === web ? "web" : "pdf"}-figure-${plates.length}`);
    }
    const light = (c) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c ?? "");
      return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 > 200 : false;
    };
    const svgs = plates.filter((p) => p?.tag?.toLowerCase() === "svg");
    check("R16", svgs.length === 0 || svgs.every((p) => light(p.bg)), `dark: each chart of the ${d === web ? "web page" : "PDF"} sits on a light plate`, JSON.stringify(plates));
    // A caption on the light box the page painted keeps dark words.
    const boxed = d === web ? await figureBy(page, (c) => /Figure 6/.test(c)) : null;
    if (boxed) {
      await page.evaluate((p) => window.__qa.showNode(p), boxed.pos);
      const legible = await page.evaluate((p) => {
        const el = window.__docsEditor.view.nodeDOM(p);
        const box = [...el.querySelectorAll("figure, div")].find((e) => /background/.test(e.getAttribute("style") ?? ""));
        const caption = [...el.querySelectorAll("figcaption, p, span")].findLast((e) => /Figure 6/.test(e.textContent));
        if (!box || !caption) return { box: Boolean(box), caption: Boolean(caption) };
        const lum = (c) => {
          const [r, g, b] = (/rgba?\((\d+), (\d+), (\d+)/.exec(c) ?? [0, 0, 0, 0]).slice(1).map((v) => {
            const x = Number(v) / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const background = getComputedStyle(box).backgroundColor;
        const color = getComputedStyle(caption).color;
        const [hi, lo] = [lum(background), lum(color)].sort((a, b) => b - a);
        return { background, color, contrast: Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10 };
      }, boxed.pos);
      const boxShot = await shot(page, "R16-dark-web-figure-painted-box");
      check("R16", (legible.contrast ?? 0) >= 4.5, "dark: a web figure's caption on the box the page painted stays legible", `${JSON.stringify(legible)} ${boxShot}`);
    }
    await context.close();
  }
};

// R17: Side by Side with a PDF and a web page.
RISKS.R17 = async (theme) => {
  const pdf = await doc("pdf");
  const web = await doc("url");
  const { page, errors, context } = await newPage(theme, { width: 1680, height: 1000 });
  await page.goto(`${BASE}/n/${ctx.notebookId}?doc=${pdf.id}&view=side&doc2=${web.id}`, { waitUntil: "domcontentloaded" });
  await waitIn(page, () => document.querySelectorAll(".docs-prose").length === 2, null, 90_000);
  const starts = (await waitIn(page, () => {
    const n = [...document.querySelectorAll(".docs-prose")].map((p) => p.querySelectorAll(".docs-page-start[data-page-start]").length);
    return n.length === 2 && (n[0] > 0 || n[1] > 0) ? n : null;
  }, null, 20_000)) ?? (await page.evaluate(() => [...document.querySelectorAll(".docs-prose")].map((p) => p.querySelectorAll(".docs-page-start[data-page-start]").length)));
  const panes = starts.length;
  const path = await shot(page, `R17-side-by-side-${theme}`);
  check("R17", panes === 2, `(${theme}) Side by Side shows the PDF and the web page in two page editors`, `${panes} page editors ${path}`);
  if (panes === 2) check("R17", starts[0] > 0 || starts[1] > 0, `(${theme}) the PDF's page starts draw in its pane`, JSON.stringify(starts));
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
  let last = 0;
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes(`/n/${ctx.notebookId}`) || r.request().resourceType() === "document") return;
    const body = await r.body().catch(() => null);
    if (body) {
      sizes.push({ u: u.replace(BASE, "").slice(0, 60), kb: Math.round(body.length / 1024) });
      last = Date.now();
    }
  });
  const at = await find(page, "Recurrent neural networks");
  if (at) await highlight(page, pdf.id, at.from, at.to);
  // The refresh, then a quiet second: no further payload on its way.
  await until(() => sizes.length > 0 && Date.now() - last > 1500, 30_000);
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
  const before = at ? (await highlight(page, pdf.id, at.from, at.to)).find((x) => x.quotedText === "Recurrent neural networks") ?? null : null;
  const re = await api(`/api/documents/${pdf.id}/reparse`, "POST", {});
  const afterSrc = before ? (await sourcesOf(pdf.id)).find((x) => x.id === before.id) : null;
  check("R20", Boolean(before && afterSrc && !afterSrc.orphaned && afterSrc.blockId === before.blockId && afterSrc.startOffset === before.startOffset), "a re-parse of an unedited import keeps a highlight exact (the same row, the same offsets)", before ? `before ${before.blockId} ${before.startOffset}-${before.endOffset}; after ${afterSrc?.blockId} ${afterSrc?.startOffset}-${afterSrc?.endOffset} orphaned ${afterSrc?.orphaned}` : "no highlight made");
  await reload(page);
  const images = await loadFigureImages(page);
  const failed = responses.filter((r) => /\/figure\//.test(r.url) && r.status >= 400);
  check("R20", re.status === 200 && failed.length === 0 && images.total > 0 && images.loaded === images.total, "after a re-parse every figure loads its new crop, no 404", `HTTP ${re.status}; ${images.loaded}/${images.total} images (${stats(images.ms)})${images.failed.length ? `; not in 30 s: ${images.failed.join(", ")}` : ""}; HTTP errors ${failed.map((f) => `${f.status} ${f.url}`).slice(0, 2).join(" ") || "none"}`);
  if (errors.length) note("R20", "console", errors.slice(0, 3).join(" | "));
  await context.close();
};

// R21: a kicker above the Title: the stored contents never make the Title a part.
RISKS.R21 = async (theme) => {
  if (theme !== THEMES[0]) return;
  const web = await doc("url");
  const row = await until(async () => {
    const r = await documentRow(web.id);
    return Array.isArray(r.contents) && r.contents.length ? r : null;
  }, 30_000, 1000) ?? (await documentRow(web.id));
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
  const f = (await figureBy(page, (c) => /Figure 4/.test(c))) ?? (await figures(page))[0];
  const order = async () => (await figures(page)).map((x) => x.caption);
  const before = await order();
  const box = await page.evaluate((p) => window.__qa.showNode(p), f.pos);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 300, { steps: 20 });
  await page.mouse.up();
  // A drop would change the document: the layout holds still, and then the order is read.
  await page.evaluate(() => window.__qa.settle());
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
  const s = (await inlineStarts(page, 12))[0];
  const phrase = `${s.before.slice(-12)}${s.after.slice(0, 12)}`.trim();
  await page.click(".docs-prose");
  await page.keyboard.press("Control+f");
  await page.locator(".docs-findbar input").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await page.keyboard.type(phrase, { delay: 20 });
  const count = (await waitIn(page, () => {
    const t = document.querySelector(".docs-find-counter")?.textContent ?? "";
    return /\b1 of 1\b/.test(t) ? t : null;
  }, null, 10_000)) ?? (await page.evaluate(() => document.querySelector(".docs-find-counter")?.textContent ?? ""));
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
  const s = (await inlineStarts(page, 30))[0];
  const base = await page.evaluate((p) => window.__qa.blockText(p), s.pos);
  const fig = (await figures(page))[0];
  // One word changed on each side of the page start.
  const changed = base.replace(/\bthe\b/, "one").replace(/\bthe\b(?![\s\S]*\bthe\b)/, "one");
  const ops = [
    { i: 0, op: "rewrite_block", blockId: s.blockId, base, text: changed, why: "QA: a word changed on each side of a page start." },
    { i: 1, op: "rewrite_block", blockId: fig.blockId, base: fig.caption, text: "A new caption", why: "QA: a caption is the figure's." },
  ];
  const landed = await page.evaluate((o) => (window.__applyAssistantOps ? window.__applyAssistantOps(o) : null), ops);
  const switched = await until(async () => (await mode(page)) === "editing", 10_000);
  check("C2", Array.isArray(landed?.ids) && landed.ids.length > 0, `(${theme}) a rewrite across p. ${s.page} lands`, clip(JSON.stringify(landed), 160));
  check("C2", (landed?.skipped ?? []).some((k) => k.i === 1 && k.reason === "object"), `(${theme}) an op on a figure is skipped as "object"`, clip(JSON.stringify(landed?.skipped), 120));
  check("C2", switched, `(${theme}) suggestions landing on an import in Viewing switch it to Editing`, `mode ${await mode(page)}`);
  const still = (await pageStarts(page)).filter((x) => x.page === s.page);
  check("C2", still.length === 1, `(${theme}) the pending suggestion across p. ${s.page} keeps the page start`, `${still.length}${still[0] ? ` before "${still[0].before.slice(-15)}" after "${still[0].after.slice(0, 15)}"` : ""}`);
  const pendingShot = await shot(page, `C2-pending-across-page-start-${theme}`);
  // Accept all suggestions (Search the menus): the words change, "p. N"
  // stays where the page begins.
  const accepted = await menuCommand(page, "Accept all suggestions");
  await waitIn(page, () => !document.querySelector(".docs-prose [data-suggestion]"), null, 10_000);
  const after = (await pageStarts(page)).filter((x) => x.page === s.page);
  const text = await page.evaluate((p) => window.__qa.blockText(p), after[0]?.pos ?? s.pos);
  const acceptShot = await shot(page, `C2-accepted-across-page-start-${theme}`);
  check("C2", after.length === 1 && text === changed, `(${theme}) Accept keeps "p. ${s.page}" and takes the new words`, `accept ${accepted}; page starts ${after.length}; words ${text === changed ? "the suggestion's" : `"${clip(text, 60)}"`} ${pendingShot} ${acceptShot}`);
  await waitSaved(page).catch(() => {});
  // The bar, as a person uses it: select words across the page start, the
  // toolbar's Assistant, the Shorten chip; the mock's suggestion lands.
  const s2 = (await inlineStarts(page, 30)).find((x) => x.page !== s.page);
  if (s2) {
    await dragSelect(page, s2.pos - 25, s2.pos + 1 + 25);
    const assistant = page.locator('[data-selection-popover] [data-track="assistant"]').first();
    if (await assistant.count()) {
      await assistant.click();
      const chips = (await waitIn(page, () => {
        const c = [...document.querySelectorAll('[data-track^="assistant-command:"]')].map((b) => b.dataset.track);
        return document.querySelector("[data-assistant-bar]") && c.length >= 7 ? c : null;
      }, null, 10_000)) ?? [];
      const bar = await page.evaluate(() => Boolean(document.querySelector("[data-assistant-bar]")));
      check("C2", bar && chips.length >= 7, `(${theme}) on an import the toolbar's Assistant opens the bar with the seven commands`, `bar ${bar}, chips ${chips.length}`);
      const shorten = page.locator('[data-track="assistant-command:shorten"], [data-track^="assistant-command:"]').first();
      if (await shorten.count()) {
        await shorten.click();
        const marks = (await waitIn(page, () => {
          const m = [...document.querySelectorAll(".docs-prose [data-suggestion]")].map((e) => e.textContent).join(" | ");
          return m || null;
        }, null, 60_000)) ?? "";
        const kept = (await pageStarts(page)).filter((x) => x.page === s2.page).length;
        const barShot = await shot(page, `C2-bar-shorten-${theme}`);
        check("C2", marks.length > 0 && kept === 1, `(${theme}) Shorten across p. ${s2.page} lands suggestions and keeps the page start`, `suggested "${clip(marks, 80)}", page starts ${kept} ${barShot}`);
        const reject = page.locator('[data-assistant-bar] button:has-text("Reject")').first();
        if (await reject.count()) await reject.click();
        await waitIn(page, () => !document.querySelector(".docs-prose [data-suggestion]"), null, 10_000);
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
  const hl = (await highlight(page, pdf.id, at.from, at.to)).find((x) => x.quotedText.startsWith("Recurrent neural networks")) ?? null;
  await setMode(page, "editing");
  // Inside the highlight: after "Recurrent neural " (the abstract says
  // "neural networks" first, so the words are found from the highlight).
  await clickPos(page, at.from + "Recurrent neural ".length);
  await page.keyboard.type("QA ");
  await waitSaved(page);
  // The stored anchor grows over the typed words; the page repaints it once
  // it has the save's anchors (a slow server shows the old mark a moment).
  const moved = hl ? await sourceWhere(pdf.id, (x) => x.id === hl.id && (x.anchoredText ?? "").includes("neural QA networks"), 15_000) ?? (await sourcesOf(pdf.id)).find((x) => x.id === hl.id) : null;
  const marks = hl ? await painted(page, hl.id, "neural QA networks", { includes: true }) : [];
  check("EDIT", Boolean(moved && !moved.orphaned && moved.quotedText === hl.quotedText && (moved.anchoredText ?? "").includes("neural QA networks") && marks.join("").includes("neural QA networks")), `(${theme}) words typed inside a highlight: the mark grows over them, the quote stays`, moved ? `quote "${clip(moved.quotedText, 40)}", anchored "${clip(moved.anchoredText, 50)}", painted "${clip(marks.join(""), 50)}"` : "no highlight");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await waitSaved(page).catch(() => {});
  // Suggesting: a person's suggestion across a page start, then Accept.
  const s = (await inlineStarts(page, 20))[0];
  const rowsBefore = await rowsOf(pdf.id);
  await setMode(page, "suggesting");
  await dragSelect(page, s.pos - 8, s.pos + 1 + 8);
  await page.keyboard.type("SUGGESTED");
  await waitSaved(page).catch(() => {});
  const suggested = (await waitIn(page, () => {
    const m = [...document.querySelectorAll(".docs-prose [data-suggestion]")].map((e) => e.textContent).join("|");
    return m.includes("SUGGESTED") ? m : null;
  }, null, 10_000)) ?? "";
  const starts = (await pageStarts(page)).filter((x) => x.page === s.page);
  const rowsAfter = await rowsOf(pdf.id);
  const changedRows = rowsAfter.filter((r) => rowsBefore.find((b) => b.id === r.id)?.hash !== r.hash);
  const suggestShot = await shot(page, `EDIT-suggestion-across-page-start-${theme}`);
  check("EDIT", suggested.includes("SUGGESTED") && starts.length === 1 && changedRows.length === 1, `(${theme}) a person's suggestion across p. ${s.page}: drawn as a suggestion, the page start kept, one row changed`, `marks "${clip(suggested, 80)}"; page starts ${starts.length}; rows changed ${changedRows.length} ${suggestShot}`);
  await menuCommand(page, "Accept all suggestions");
  await waitIn(page, () => !document.querySelector(".docs-prose [data-suggestion]"), null, 10_000);
  await waitSaved(page).catch(() => {});
  const accepted = await page.evaluate((p) => window.__qa.blockText(p), (await pageStarts(page)).find((x) => x.page === s.page)?.pos ?? s.pos);
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
  const arrived = Boolean(await waitIn(second.page, () => window.__docsEditor.state.doc.textContent.includes("1 Introduction (live)"), null, 30_000));
  const startsAfter = (await pageStarts(second.page)).length;
  const liveShot = await shot(second.page, `EDIT-live-second-tab-${theme}`);
  check("EDIT", arrived && startsAfter === startsB, `(${theme}) words typed in one tab reach the other tab of the import, its page starts kept`, `arrived ${arrived}; page starts ${startsB} → ${startsAfter} ${liveShot}`);
  await second.context.close();
  if (errors.length) note("EDIT", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// AUDIT: the audit checklist (design section 5), as a Google Docs reader
// checks an import: the chrome and the pages, the outline, page numbers and
// the scroll tip, print, word count, Version history, and the web page's
// lists, table, code, quote, line, equation, and figures (COPY has the
// downloads).
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
    const items = (await waitIn(page, () => {
      const i = [...document.querySelectorAll(".docs-outline-list [aria-label]")].map((e) => e.getAttribute("aria-label"));
      return i.length ? i : null;
    }, null, 10_000)) ?? [];
    const outlineShot = await shot(page, `AUDIT-outline-${theme}`);
    check("AUDIT", items.some((i) => /Attention Is All You Need/.test(i)) && items.some((i) => /Introduction/.test(i)), `(${theme}) the outline lists the Title and the headings`, `${items.length}: ${items.slice(0, 5).join(" | ")} ${outlineShot}`);
    // Under the headings, the contents (SPEC.md §26): Generate contents,
    // then a part's press jumps to where it starts and flashes it.
    const generate = page.locator('[data-track="contents-generate"]').first();
    if (await generate.isVisible().catch(() => false)) await generate.click();
    const parts = (await waitIn(page, () => {
      const section = [...document.querySelectorAll("section")].find((e) => e.querySelector(":scope > .docs-outline-header"));
      const list = [...(section?.querySelectorAll(".docs-outline-item") ?? [])].map((b) => b.textContent);
      return list.length ? list : null;
    }, null, 60_000)) ?? [];
    const part = parts.find((t) => /Model Architecture/.test(t)) ?? parts[2];
    let jumped = null;
    if (part) {
      await page.locator("section .docs-outline-item", { hasText: part }).first().click();
      jumped = await waitIn(page, (text) => {
        const el = [...document.querySelectorAll(".docs-prose .anchor-flash")].find((e) => e.textContent.includes(text));
        return el ? { top: Math.round(el.getBoundingClientRect().top - window.__qa.band().top) } : null;
      }, part, 10_000);
    }
    const partsShot = await shot(page, `AUDIT-outline-contents-${theme}`);
    check("AUDIT", parts.length >= 3 && Boolean(jumped) && jumped.top > -20 && jumped.top < 200, `(${theme}) the panel lists the contents' parts under the headings; a part's press jumps to it and flashes it`, `${parts.length} parts: ${parts.slice(0, 3).join(" | ")}…; "${part}" ${JSON.stringify(jumped)} ${partsShot}`);
    await page.locator('[data-track="docs:outline-close"]').first().click().catch(() => {});
    await waitIn(page, () => !document.querySelector(".docs-outline-list"), null, 5000);
  }
  // Page numbers at the first, a middle, and the last page, in the margin.
  const starts = await pageStarts(page);
  const picks = [starts[0], starts[Math.floor(starts.length / 2)], starts.at(-1)].filter(Boolean);
  const drawn = [];
  for (const st of picks) {
    await page.evaluate((p) => window.__qa.show(p), st.pos);
    const label = await page.evaluate((p) => {
      const el = window.__docsEditor.view.nodeDOM(p);
      const text = document.querySelector(".docs-prose").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { content: getComputedStyle(el, "::before").content, left: Math.round(r.left), textLeft: Math.round(text.left), top: Math.round(r.top), label: el.getAttribute("data-page-label") };
    }, st.pos);
    const crop = join(SHOT, `AUDIT-page-start-p${st.page}-${theme}.png`);
    await page.screenshot({ path: crop, clip: { x: Math.max(0, label.textLeft - 140), y: Math.max(0, label.top - 60), width: 700, height: 140 } });
    drawn.push({ page: st.page, on: st.on, ...label, crop });
  }
  check("AUDIT", drawn.every((d) => d.label === `p. ${d.page}` && (d.content.includes(`p. ${d.page}`) || d.on !== "paragraph")), `(${theme}) "p. N" stands at the first, a middle, and the last page`, drawn.map((d) => `p. ${d.page} [${d.on}] label "${d.label}" ::before ${d.content} ${d.crop}`).join(" | "));
  // The scroll tip reads the PDF's page in view: p. 7 placed just above
  // the pane's middle, where the tip reads.
  const seven = starts.find((x) => x.page === 7);
  if (seven) {
    await placeAboveMiddle(page, seven.pos);
    const tip = await scrollTip(page);
    const tipShot = await shot(page, `AUDIT-scroll-tip-${theme}`);
    check("AUDIT", tip === "p. 7 of 15", `(${theme}) the scroll tip reads the PDF's page in view`, `"${tip}" ${tipShot}`);
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
  // The dialog's numbers once they hold (its first draw counts one page).
  const wordCount = async () => {
    await page.evaluate(() => window.__docsEditor.commands.focus());
    await page.keyboard.press("Control+Shift+c");
    let last = "[]";
    return (await until(async () => {
      const now = JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".docs-wc-table tr")].map((r) => r.textContent.trim())));
      const held = now === last && now !== "[]";
      last = now;
      return held ? JSON.parse(now) : null;
    }, 5000, 300)) ?? [];
  };
  let wc = await wordCount();
  check("AUDIT", wc.length > 0, `(${theme}) Ctrl+Shift+C opens the word count in Viewing`, wc.length ? "" : "no dialog; Editing tried next");
  if (wc.length === 0) {
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
  await waitIn(page, () => !document.querySelector(".docs-wc-table"), null, 5000);
  // Version history, from the clock at the title row's right end.
  const versions = await openVersions(page);
  const importedPick = page.locator(".docs-versions-list .docs-versions-pick", { hasText: "Imported" }).first();
  let versionView = null;
  if (await importedPick.count()) {
    await importedPick.click();
    versionView = await waitIn(page, () => {
      const view = document.querySelector(".docs-versions-page");
      const images = view ? [...view.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 0).length : 0;
      return view && images > 0 ? { figures: view.querySelectorAll(".docs-figure").length, images, pageStarts: view.querySelectorAll("[data-page-start]").length, words: view.textContent.length } : null;
    }, null, 30_000);
  }
  const versionShot = await shot(page, `AUDIT-version-imported-${theme}`);
  check("AUDIT", versions.some((v) => /Imported/.test(v)) && (versionView?.figures ?? 0) >= 12 && (versionView?.images ?? 0) > 0, `(${theme}) Version history lists "Imported" and its view draws the figures`, `${JSON.stringify(versions.slice(0, 4))}; view ${JSON.stringify(versionView)} ${versionShot}`);
  await closeVersions(page);
  // The web page: pageless; lists, the table's merged cells, code, a quote,
  // a line, and every figure's media.
  await open(page, ctx.notebookId, web.id);
  await loadFigureImages(page, 15_000);
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
      // A pageless import's table fills the text column.
      table: [prose.querySelector("table"), prose].map((e) => Math.round(e.getBoundingClientRect().width)),
    };
  });
  const webShot = await shot(page, `AUDIT-web-${theme}`);
  check("AUDIT", shape.pageless && shape.nested >= 1 && shape.ol3 && shape.rowspan && shape.colspan && shape.region === 1 && shape.code >= 1 && shape.quote >= 1 && shape.hr >= 1, `(${theme}) the web page: pageless, a nested list, a list from 3, the table's merged cells once, code, a quote, a line`, `${JSON.stringify({ ...shape, figs: undefined })} ${webShot}`);
  check("AUDIT", shape.figs.length === 6 && shape.figs.every((f) => f.media) && shape.figs.filter((f) => f.media === "IMG").every((f) => f.loaded), `(${theme}) every figure of the web page draws its media`, JSON.stringify(shape.figs));
  check("AUDIT", Boolean(shape.references), `(${theme}) the References section stands under the page`, `${shape.references}`);
  check("AUDIT", Math.abs(shape.table[0] - shape.table[1]) <= 2, `(${theme}) the web page's table fills the text column`, `table ${shape.table[0]} px, the column ${shape.table[1]} px`);
  const card = await hoverTip(page, ".docs-prose .docs-citation");
  check("AUDIT", /Syvitski/.test(card ?? ""), `(${theme}) a citation's hover card shows its reference entry`, `"${clip(card, 100)}"`);
  const webLine = await page.evaluate(() => {
    const row = document.querySelector(".docs-title-row");
    return { text: (row?.textContent ?? "").replace(/\s+/g, " ").slice(0, 160), link: [...(row?.querySelectorAll("a[href]") ?? [])].map((a) => a.getAttribute("href")).find((h) => /^https?:/.test(h ?? "")) ?? null };
  });
  check("AUDIT", /Imported from/.test(webLine.text) && (webLine.link ?? "").startsWith(FIXTURE), `(${theme}) the web page's import line links to the page`, JSON.stringify(webLine));
  // The Markdown file: pageless; its equation, table, code, quote, line,
  // lists; its import line.
  const md = await doc("markdown");
  await open(page, ctx.notebookId, md.id);
  const mdShape = await page.evaluate(() => {
    const prose = document.querySelector(".docs-prose");
    return {
      pageless: Boolean(document.querySelector('.docs-canvas[data-pageless="true"]')),
      math: prose.querySelectorAll(".katex").length,
      table: prose.querySelectorAll("table").length,
      code: prose.querySelectorAll("pre").length,
      quote: prose.querySelectorAll("blockquote").length,
      hr: prose.querySelectorAll("hr").length,
      ol3: Boolean(prose.querySelector('ol[start="3"]')),
      nested: prose.querySelectorAll("ul ul").length,
      // A section's heading: the parse makes the top section level Heading 1
      // under the Title, so "## Observations" is a heading of any level here.
      h2: [...prose.querySelectorAll("h1, h2, h3")].map((h) => h.textContent),
      line: (document.querySelector(".docs-title-row")?.textContent ?? "").replace(/\s+/g, " ").slice(0, 120),
    };
  });
  const mdShot = await shot(page, `AUDIT-markdown-${theme}`);
  check("AUDIT", mdShape.pageless && mdShape.math >= 1 && mdShape.table === 1 && mdShape.code >= 1 && mdShape.quote >= 1 && mdShape.hr >= 1 && mdShape.ol3 && mdShape.nested >= 1 && mdShape.h2.includes("Observations"), `(${theme}) the Markdown file: pageless, its equation drawn, a table, code, a quote, a line, a list from 3, a nested list`, `${JSON.stringify({ ...mdShape, line: undefined })} ${mdShot}`);
  check("AUDIT", /Text file/.test(mdShape.line), `(${theme}) the Markdown file's import line says "Text file"`, mdShape.line);
  if (theme === THEMES[0]) {
    // A journal's own page names: page starts and the scroll tip draw them.
    const labeled = await fresh("pdf", "-audit");
    const names = ["i", "ii", ...Array.from({ length: 13 }, (_, i) => String(i + 1))];
    await db.document.update({ where: { id: labeled.id }, data: { pageLabels: names } });
    await open(page, ctx.notebookId, labeled.id);
    const drawnNames = [];
    for (const st of (await pageStarts(page)).filter((x) => x.page >= 2 && x.on === "paragraph" && x.after.length > 0).slice(0, 3)) {
      const label = await page.evaluate((p) => window.__docsEditor.view.nodeDOM(p)?.getAttribute?.("data-page-label") ?? null, st.pos);
      drawnNames.push({ page: st.page, label, want: `p. ${names[st.page - 1]}` });
    }
    const seventh = (await pageStarts(page)).find((x) => x.page === 7);
    let namedTip = null;
    if (seventh) {
      await placeAboveMiddle(page, seventh.pos);
      namedTip = await scrollTip(page);
    }
    const labelShot = await shot(page, "AUDIT-journal-page-names");
    check("AUDIT", drawnNames.length > 0 && drawnNames.every((d) => d.label === d.want) && namedTip === "p. 5 of 15", "a PDF's own page names: the page starts and the scroll tip draw them", `${JSON.stringify(drawnNames)}; tip at p. 7 "${namedTip}" ${labelShot}`);
    // Version history: Show changes draws an edit since "Imported"; Restore
    // brings the original's words back with its figures and page starts.
    await setMode(page, "editing");
    const intro = await find(page, "1 Introduction");
    await clickPos(page, intro.to);
    await page.keyboard.type(" (audit edit)");
    await waitSaved(page).catch(() => {});
    await openVersions(page);
    await waitIn(page, () => [...document.querySelectorAll(".docs-versions-page u")].some((u) => u.textContent.includes("audit edit")), null, 20_000);
    const changes = await page.evaluate(() => ({
      heading: document.querySelector(".docs-versions-heading-title")?.textContent ?? null,
      underlined: [...document.querySelectorAll(".docs-versions-page u")].map((u) => u.textContent).join("|").slice(0, 80),
      struck: document.querySelectorAll(".docs-versions-page s").length,
    }));
    const changesShot = await shot(page, "AUDIT-version-show-changes");
    check("AUDIT", changes.underlined.includes("audit edit"), "Version history: Show changes draws the edit made since \"Imported\"", `${JSON.stringify(changes)} ${changesShot}`);
    await page.locator(".docs-versions-list .docs-versions-pick", { hasText: "Imported" }).first().click().catch(() => {});
    await page.locator(".docs-versions-bar button", { hasText: "Restore this version" }).first().click({ timeout: 10_000 }).catch(() => {});
    await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click({ timeout: 10_000 }).catch(() => {});
    await waitIn(page, () => !document.querySelector(".docs-versions") && !window.__docsEditor.state.doc.textContent.includes("(audit edit)"), null, 20_000);
    await waitSaved(page).catch(() => {});
    const restored = await page.evaluate(() => ({ edit: window.__docsEditor.state.doc.textContent.includes("(audit edit)"), open: Boolean(document.querySelector(".docs-versions")) }));
    const restoredStarts = (await pageStarts(page)).length;
    const restoredFigures = (await figures(page)).length;
    const storedAfter = JSON.stringify((await documentRow(labeled.id)).richText).includes("(audit edit)");
    const kept = await db.documentVersion.findMany({ where: { documentId: labeled.id }, select: { name: true, richText: true } });
    const keptEdit = kept.some((v) => JSON.stringify(v.richText).includes("(audit edit)"));
    const restoreShot = await shot(page, "AUDIT-version-restored");
    check("AUDIT", !restored.edit && !restored.open && !storedAfter && restoredStarts === 15 && restoredFigures === 12 && keptEdit, "Restore \"Imported\" brings the original's words back, with its page starts and figures, and a version keeps the edit", `edit in the page ${restored.edit}, stored ${storedAfter}; page starts ${restoredStarts}, figures ${restoredFigures}; a version holds the edit ${keptEdit} (${kept.length} versions) ${restoreShot}`);
  }
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
  const inline = await inlineStarts(page, 30);
  // Explain across a page start.
  const a = inline[0];
  await dragSelect(page, a.pos - 30, a.pos + 1 + 30);
  const wordsA = `${a.before.slice(-30)}${a.after.slice(0, 30)}`;
  await tool(page, "explain");
  await sideCard(page, "explain");
  const explain = derives.find((d) => d.type === "EXPLAIN");
  check("AI", explain?.anchor?.quotedText === wordsA, `(${theme}) Explain across p. ${a.page} sends the words alone`, `quote "${clip(explain?.anchor?.quotedText, 70)}"`);
  const ex = await sourceWhere(pdf.id, (x) => x.note.derivationType === "EXPLAIN");
  if (ex) {
    const marks = await painted(page, ex.id, wordsA);
    const shotA = await shot(page, `AI-explain-mark-across-page-start-${theme}`);
    check("AI", squash(marks.join("")) === squash(wordsA) && marks.length >= 2, `(${theme}) Explain's mark paints on both sides of p. ${a.page}`, `${marks.length} pieces "${clip(marks.join("|"), 80)}" ${shotA}`);
  } else fail("AI", `(${theme}) Explain stores its annotation`, JSON.stringify((await sourcesOf(pdf.id)).map((x) => x.note.derivationType)));
  await calm(page);
  // Add to notes across another page start; the note's jump flashes the words.
  const b = inline[1] ?? inline[0];
  await dragSelect(page, b.pos - 25, b.pos + 1 + 25);
  const wordsB = `${b.before.slice(-25)}${b.after.slice(0, 25)}`;
  await tool(page, "add-to-notes");
  const section = page.locator('[data-track="add-to-notes-section"]').first();
  await section.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await section.count()) await section.click();
  const noteSrc = await sourceWhere(pdf.id, (x) => x.quotedText === wordsB && x.note.sectionId === ctx.sectionId);
  check("AI", Boolean(noteSrc), `(${theme}) Add to notes across p. ${b.page} quotes the words alone`, noteSrc ? `quote "${clip(noteSrc.quotedText, 60)}"` : "no note");
  if (noteSrc) {
    await page.evaluate(() => {
      window.__qa.pane().scrollTop = 0;
    });
    const jump = page.locator(`[data-note-id="${noteSrc.note.id}"] [data-track="note-jump"]`).first();
    await jump.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    if (await jump.count()) {
      await jump.click();
      const flashed = await waitIn(page, () => {
        const els = [...document.querySelectorAll(".docs-prose .anchor-flash")];
        return els.length ? els.map((e) => e.textContent).join("") : null;
      }, null, 15_000);
      const shotB = await shot(page, `AI-note-jump-flash-${theme}`);
      check("AI", Boolean(flashed) && squash(flashed).includes(squash(wordsB).slice(5, 30)), `(${theme}) the note's jump flashes its words across p. ${b.page}`, `flashed "${clip(flashed, 70)}" ${shotB}`);
    } else fail("AI", `(${theme}) the note's jump`, "no note-jump control on the note");
  }
  // Analyze a PDF figure: its crop; the ring; the Annotations tab's Jump.
  await calm(page);
  const fig = (await figureBy(page, (c) => /Figure 1/.test(c))) ?? (await figures(page))[0];
  const pressed = await clickFigure(page, fig.pos);
  const firstPress = await toolbar(page);
  // In Viewing the press draws no selection frame (css/import.css).
  const frame = await page.evaluate((p) => {
    const el = window.__docsEditor.view.nodeDOM(p);
    return { selected: el.classList.contains("ProseMirror-selectednode"), outline: getComputedStyle(el).outlineStyle };
  }, fig.pos);
  const frameShot = await shot(page, `AI-pdf-figure-first-press-${theme}`);
  check("AI", firstPress && frame.outline === "none", `(${theme}) in Viewing the first press on a PDF figure opens its tools, with no selection frame`, `tools ${firstPress}; ${JSON.stringify(frame)}; pressed ${JSON.stringify(pressed)} ${frameShot}`);
  if (!firstPress) {
    await clickFigure(page, fig.pos);
    await toolbar(page);
  }
  const analyze = page.locator('[data-selection-popover] [data-track="analyze"]').first();
  if (await analyze.count()) {
    await analyze.click();
    const an = await sourceWhere(pdf.id, (x) => x.note.derivationType === "ANALYZE", 30_000);
    const req = derives.find((d) => d.type === "ANALYZE");
    check("AI", Boolean(an) && an.blockId === fig.blockId, `(${theme}) Analyze on a PDF figure anchors to the figure`, `request ${clip(JSON.stringify(req?.anchor ?? req ?? null), 100)}`);
    await calm(page);
    await waitIn(page, (p) => window.__docsEditor.view.nodeDOM(p)?.hasAttribute("data-source-id"), fig.pos);
    const tab = page.locator('[data-track="annotations"]').first();
    if (await tab.count()) {
      await tab.click();
      // The analysis's row: its "…" menu holds Jump.
      const row = page.locator('[data-track="annotation-menu"]').last();
      await row.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      if (await row.count()) await row.click();
      const jumpA = page.locator('[data-track="annotation-jump"]').first();
      await jumpA.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (await jumpA.count()) {
        await jumpA.click();
        const flashedFig = Boolean(await waitIn(page, (p) => window.__docsEditor.view.nodeDOM(p)?.classList.contains("anchor-flash"), fig.pos, 10_000));
        const shotC = await shot(page, `AI-annotations-jump-figure-${theme}`);
        check("AI", flashedFig, `(${theme}) the Annotations tab's Jump flashes the analyzed figure`, shotC);
      } else fail("AI", `(${theme}) the Annotations tab lists the analysis with Jump`, "no annotation-jump");
    }
  } else fail("AI", `(${theme}) a click on a PDF figure opens Analyze`, "no Analyze");
  // A selection over a figure leaves the figure out, and the toolbar says so.
  const around = await page.evaluate((p) => {
    const doc = window.__docsEditor.state.doc;
    return { from: p - 12, to: p + doc.nodeAt(p).nodeSize + 13 };
  }, fig.pos);
  await calm(page);
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
  const leftOut = Boolean(await waitIn(page, () => document.querySelector("[data-layer-toolbar]")?.textContent.includes("left out"), null, 6000));
  const selected = await page.evaluate(() => {
    const sel = window.__docsEditor.state.selection;
    let figure = false;
    window.__docsEditor.state.doc.nodesBetween(sel.from, sel.to, (n) => {
      if (n.type.name === "figure") figure = true;
    });
    return { from: sel.from, to: sel.to, figure };
  });
  const shotD = await shot(page, `AI-selection-over-figure-${theme}`);
  check("AI", selected.figure && leftOut, `(${theme}) a selection over a figure: the toolbar says images, figures, and equations are left out`, `selection ${JSON.stringify(selected)} ${shotD}`);
  await calm(page);
  // A highlight in a table cell paints in the cell after a reload.
  const cell = await page.evaluate(() => {
    let hit = null;
    window.__docsEditor.state.doc.descendants((n, p) => {
      if (hit) return false;
      if ((n.type.name === "tableCell" || n.type.name === "tableHeader") && n.textContent.trim() === "Self-Attention") {
        // The cell's first paragraph: its words start one position in.
        hit = { from: p + 2, to: p + 2 + "Self-Attention".length, text: n.textContent };
      }
      return !hit;
    });
    return hit;
  });
  if (cell) {
    const hl = (await highlight(page, pdf.id, cell.from, cell.to, 1)).find((x) => x.quotedText === "Self-Attention") ?? null;
    await reload(page);
    if (hl) await painted(page, hl.id, "Self-Attention");
    const inCell = hl ? await page.evaluate((id) => [...document.querySelectorAll(`.docs-prose [data-source-id="${id}"]`)].map((e) => ({ text: e.textContent, inCell: Boolean(e.closest("td, th")) })), hl.id) : [];
    const stored = hl ? await db.block.findUnique({ where: { id: hl.blockId }, select: { type: true, text: true, cell: true } }) : null;
    const cellShot = await shot(page, `AI-table-cell-highlight-${theme}`);
    check("AI", inCell.length > 0 && inCell.every((m) => m.inCell) && inCell.map((m) => m.text).join("") === "Self-Attention", `(${theme}) a highlight in a table cell paints in the cell after a reload`, `${hl ? `stored on ${stored?.type} "${clip(stored?.text, 30)}" cell ${JSON.stringify(stored?.cell)} at ${hl.startOffset}-${hl.endOffset}, orphaned ${hl.orphaned}` : "no highlight stored"}; painted ${JSON.stringify(inCell)} ${cellShot}`);
  }
  // Define one word.
  const word = await find(page, "transduction");
  if (word) {
    await dragSelect(page, word.from, word.to);
    const define = page.locator('[data-selection-popover] [data-track="define"]').first();
    if (await define.count()) {
      await define.click();
      const text = await waitIn(page, () => {
        const t = document.querySelector("[data-definition]")?.textContent ?? "";
        return t.length > 30 && !document.querySelector('[data-definition] [role="status"]') ? t : null;
      }, null, 30_000);
      check("AI", Boolean(text), `(${theme}) Define answers on an import`, clip(text, 80));
    } else fail("AI", `(${theme}) Define is the first row for one word`, "no define");
  }
  // Simplify, Visualize, and Read aloud in Viewing, as the other tools.
  await calm(page);
  if ((await mode(page)) !== "viewing") await setMode(page, "viewing");
  const simple = await find(page, "The Transformer allows for significantly more parallelization");
  if (simple) {
    await dragSelect(page, simple.from, simple.to);
    await tool(page, "simplify");
    const card = await sideCard(page, "simplify");
    const simplified = await sourceWhere(pdf.id, (x) => x.note.derivationType === "SIMPLIFY", 10_000);
    const simplifyShot = await shot(page, `AI-simplify-${theme}`);
    check("AI", Boolean(card) && simplified?.quotedText === "The Transformer allows for significantly more parallelization", `(${theme}) Simplify answers in Viewing and keeps its quote`, `card "${clip(card, 60)}"; quote "${clip(simplified?.quotedText, 60)}" ${simplifyShot}`);
    await calm(page);
  } else fail("AI", `(${theme}) Simplify's words`, "not in the page");
  const picture = await find(page, "An attention function can be described as mapping a query");
  if (picture) {
    await dragSelect(page, picture.from, picture.to);
    await tool(page, "visualize");
    const drawnSvg = Boolean(await waitIn(page, () => Boolean(document.querySelector('[data-side-card="explain"] svg')), null, 60_000));
    const pictured = await sourceWhere(pdf.id, (x) => x.note.derivationType === "VISUALIZE", 10_000);
    const visualizeShot = await shot(page, `AI-visualize-${theme}`);
    check("AI", drawnSvg && Boolean(pictured), `(${theme}) Visualize draws its picture in Viewing and stores the visualization`, `picture ${drawnSvg}; quote "${clip(pictured?.quotedText, 60)}" ${visualizeShot}`);
    await calm(page);
  } else fail("AI", `(${theme}) Visualize's words`, "not in the page");
  const aloud = await find(page, "Recurrent neural networks, long short-term memory");
  if (aloud) {
    await dragSelect(page, aloud.from, aloud.to);
    const readAloud = page.locator('[data-selection-popover] [data-track="read-aloud"]').first();
    check("AI", (await readAloud.count()) > 0, `(${theme}) Read aloud stands in the toolbar on an import`, `${await readAloud.count()} buttons`);
    await calm(page);
  }
  // A link across texts: from the paper's words to the Markdown import's,
  // both ends painted as a link.
  const md = await doc("markdown");
  const from = await find(page, "sequence transduction models");
  if (from) {
    await dragSelect(page, from.from, from.to);
    const link = page.locator('[data-selection-popover] [data-track="link"]').first();
    if (await link.count()) {
      await link.click();
      // The pending link waits in the tab's storage for its end.
      await waitIn(page, () => {
        try {
          return Boolean(sessionStorage.getItem("unitos-pending-link"));
        } catch {
          return false;
        }
      }, null, 5000);
      await open(page, ctx.notebookId, md.id);
      const to = await find(page, "The marsh rises with the tide it traps");
      await dragSelect(page, to.from, to.to);
      const close = page.locator('[data-track="close-link"]').first();
      await close.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
      if (await close.count()) {
        await close.click();
        const save = page.locator('[data-track="link-card-save"], [data-track="link-card-skip"]').first();
        await save.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
        await save.click().catch(() => {});
      }
      const row = await until(() => db.docLink.findFirst({ where: { fromDocumentId: pdf.id, toDocumentId: md.id }, select: { id: true, quotedText: true, toQuotedText: true } }).catch(() => null), 15_000, 500);
      const here = row ? (await painted(page, row.id, "The marsh rises", { attr: "data-link-id", includes: true })).join("") : "";
      const linkShot = await shot(page, `AI-link-across-texts-${theme}`);
      check("AI", Boolean(row) && here.includes("The marsh rises"), `(${theme}) a link across texts from the paper to the Markdown import paints at its end`, row ? `link ${row.id}: "${clip(row.quotedText, 40)}" → painted "${clip(here, 40)}" ${linkShot}` : "no link stored");
      if (row) {
        await open(page, ctx.notebookId, pdf.id);
        const back = (await painted(page, row.id, "sequence transduction models", { attr: "data-link-id" })).join("");
        check("AI", back.includes("sequence transduction models"), `(${theme}) the link paints at its start in the paper too`, `painted "${clip(back, 40)}"`);
      }
    }
  }
  // The web page: a selection across two table cells, highlighted; and
  // Analyze on the SVG chart.
  const web = await doc("url");
  await open(page, ctx.notebookId, web.id);
  const nile = await find(page, "Nile");
  const mekong = await find(page, "Mekong");
  if (nile && mekong) {
    await dragSelect(page, nile.from, mekong.to);
    const selection = await page.evaluate(() => ({ kind: window.__docsEditor.state.selection.constructor.name, text: window.getSelection().toString().replace(/\s+/g, " ").trim() }));
    const opened = await popoverOpen(page);
    const made = opened ? await pressHighlight(page, web.id, 2) : [];
    await reload(page);
    if (made.length) await waitIn(page, (ids) => new Set([...document.querySelectorAll(".docs-prose [data-source-id]")].filter((e) => ids.includes(e.getAttribute("data-source-id"))).map((e) => e.closest("td, th")?.textContent.trim()).filter(Boolean)).size >= 2, made.map((m) => m.id), 20_000);
    const marks = made.length ? await page.evaluate((ids) => [...document.querySelectorAll(".docs-prose [data-source-id]")].filter((e) => ids.includes(e.getAttribute("data-source-id"))).map((e) => ({ text: e.textContent, cell: e.closest("td, th")?.textContent.trim().slice(0, 12) ?? null })), made.map((m) => m.id)) : [];
    const cellsShot = await shot(page, `AI-highlight-across-cells-${theme}`);
    const cells = new Set(marks.map((p) => p.cell).filter(Boolean));
    check("AI", opened && made.length > 0 && cells.size >= 2, `(${theme}) a highlight across two table cells: its quote, and its marks in both cells after a reload`, `selection ${selection.kind} "${clip(selection.text, 40)}"; toolbar ${opened}; stored ${made.map((m) => `"${clip(m.quotedText, 40)}"`).join(", ") || "none"}; painted in ${[...cells].join(", ") || "no cell"} ${cellsShot}`);
  }
  const chart = await figureBy(page, (c) => /Figure 1/.test(c));
  if (chart) {
    const analyzedBefore = (await sourcesOf(web.id)).filter((x) => x.note.derivationType === "ANALYZE").length;
    await calm(page);
    await clickFigure(page, chart.pos);
    if (!(await toolbar(page))) {
      await clickFigure(page, chart.pos);
      await toolbar(page);
    }
    const analyzeChart = page.locator('[data-selection-popover] [data-track="analyze"]').first();
    if (await analyzeChart.count()) {
      const sent = page.waitForRequest((r) => r.url().endsWith("/api/derive") && r.method() === "POST", { timeout: 15_000 }).catch(() => null);
      await analyzeChart.click();
      const request = await sent;
      const analyzed = (await until(async () => {
        const all = (await sourcesOf(web.id)).filter((x) => x.note.derivationType === "ANALYZE");
        return all.length > analyzedBefore ? all : null;
      }, 30_000)) ?? [];
      const body = request ? JSON.parse(request.postData() ?? "{}") : {};
      const image = JSON.stringify(body).match(/data:image\/[a-z+]+/)?.[0] ?? null;
      const chartShot = await shot(page, `AI-analyze-chart-${theme}`);
      check("AI", analyzed.length > analyzedBefore && analyzed.at(-1).blockId === chart.blockId, `(${theme}) Analyze on the web page's SVG chart anchors to the chart`, `request image ${image ?? "none"}; ${analyzed.length - analyzedBefore} new analyses ${chartShot}`);
    } else fail("AI", `(${theme}) a click on the SVG chart opens Analyze`, "no Analyze");
  }
  if (errors.length) note("AI", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// COLLAPSE: Collapse (SPEC.md §28) in the page editor: the paper and the web
// page collapsed and read whole again; each unit one core in its place (a
// list's lines one, a table one), headings and figures as they are, the
// rich text unchanged; a unit read whole and folded again by its button; a
// highlight on a core after a reload; Editing turns Collapse off.
function collapsedView() {
  const prose = document.querySelector(".docs-prose");
  const shown = (el) => el.getClientRects().length > 0;
  const cores = [...prose.querySelectorAll('.docs-core-slot[data-docs-core="core"]')];
  if (cores.length === 0) return null;
  // Each hidden node and the cores drawn right before it: its unit's.
  const units = [...prose.querySelectorAll(".docs-core-hidden")].map((el) => {
    let n = 0;
    for (let w = el.previousElementSibling; w?.classList.contains("ProseMirror-widget"); w = w.previousElementSibling) if (w.dataset.docsCore === "core") n++;
    return { tag: el.querySelector("table") ? "TABLE" : el.tagName, lines: el.querySelectorAll("li").length, cores: n };
  });
  const headings = [...prose.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  const figures = [...prose.querySelectorAll(".docs-figure")];
  return {
    cores: cores.length,
    units: units.length,
    oneEach: units.every((u) => u.cores === 1),
    lists: units.filter((u) => u.tag === "UL" || u.tag === "OL").map((u) => `${u.lines} lines, ${u.cores} core`),
    tables: units.filter((u) => u.tag === "TABLE").map((u) => `${u.cores} core`),
    headings: `${headings.filter(shown).length} of ${headings.length} shown`,
    figures: `${figures.filter(shown).length} of ${figures.length} shown`,
    hiddenHeadings: headings.filter((h) => h.closest(".docs-core-hidden")).length,
    hiddenFigures: figures.filter((f) => f.closest(".docs-core-hidden") || !shown(f)).length,
    pages: [...prose.querySelectorAll(".docs-core-pages[data-page-label]")].map((e) => e.dataset.pageLabel).slice(0, 5),
    first: cores[0].textContent.slice(0, 60),
  };
}
RISKS.COLLAPSE = async (theme) => {
  for (const kind of ["pdf", "url"]) {
    const added = await fresh(kind, `-collapse${theme[0]}`);
    const { page, errors, context } = await newPage(theme);
    await open(page, ctx.notebookId, added.id);
    const words = await page.evaluate(() => window.__docsEditor.state.doc.textContent);
    const rev = (await documentRow(added.id)).richTextRev;
    const button = page.locator('[data-track="collapse"]').first();
    if (!(await button.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false))) {
      fail("COLLAPSE", `${kind} (${theme}): the Collapse button stands beside Extract`, "none");
      await context.close();
      continue;
    }
    await button.click();
    const view = (await waitIn(page, collapsedView, null, 90_000)) ?? {};
    const collapsedShot = await shot(page, `COLLAPSE-${kind}-collapsed-${theme}`);
    const unchanged = (await page.evaluate(() => window.__docsEditor.state.doc.textContent)) === words && (await documentRow(added.id)).richTextRev === rev;
    check("COLLAPSE", view.cores > 5 && view.oneEach && view.hiddenHeadings === 0 && view.hiddenFigures === 0 && unchanged, `${kind} (${theme}): Collapse draws each unit's core in its place, headings and figures as they are, the rich text unchanged`, `${JSON.stringify({ ...view, lists: undefined, tables: undefined })}; rich text unchanged ${unchanged} ${collapsedShot}`);
    if (kind === "url") check("COLLAPSE", view.lists?.length >= 2 && view.tables?.length >= 1 && view.oneEach, `(${theme}) the web page: a list's lines take one core, a table one core`, JSON.stringify({ lists: view.lists, tables: view.tables }));
    if (kind === "pdf") check("COLLAPSE", view.pages?.length > 0, `(${theme}) a core carries the page numbers of the PDF pages that begin in its unit`, JSON.stringify(view.pages));
    // A unit read whole by its button, then folded again.
    const unit = await page.evaluate(() => document.querySelectorAll('.docs-prose .docs-core-slot[data-docs-core="core"] [data-collapsed][data-block-id]')[2]?.dataset.blockId ?? null);
    if (unit) {
      const slot = (state) => `.docs-prose .docs-core-slot[data-docs-core="${state}"]:has([data-collapsed][data-block-id="${unit}"])`;
      await page.locator(`${slot("core")} [data-track="collapse-expand"]`).click();
      const whole = Boolean(await waitIn(page, (id) => {
        const node = document.querySelector(`.docs-prose [data-block-id="${id}"]:not([data-collapsed])`);
        return node && node.getClientRects().length > 0 && !node.closest(".docs-core-hidden");
      }, unit, 10_000));
      const fold = page.locator(`.docs-prose .docs-core-slot[data-docs-core="words"] [data-track="collapse-fold"]`).first();
      await fold.click().catch(() => {});
      const folded = Boolean(await waitIn(page, (sel) => document.querySelector(sel), slot("core"), 10_000));
      check("COLLAPSE", whole && folded, `${kind} (${theme}): a unit's button reads it whole, and the fold chip folds it again`, `whole ${whole}, folded ${folded}`);
    }
    // A highlight on a core's words, and the page reloaded: Collapse is
    // remembered, the mark paints on the core.
    if (kind === "pdf") {
      const core = await page.evaluate(() => {
        const p = [...document.querySelectorAll('.docs-prose .docs-core-slot[data-docs-core="core"] [data-collapsed][data-block-id]')].find((e) => e.textContent.split(/\s+/).length > 8);
        return p ? { id: p.dataset.blockId, words: p.textContent.replace(/^Mock core:\s*/, "").split(/\s+/).slice(1, 5).join(" ").replace(/[,.;:!?]+$/, "") } : null;
      });
      if (core) {
        const selector = `.docs-prose [data-collapsed][data-block-id="${core.id}"]`;
        const opened = await dragWords(page, selector, core.words);
        const made = opened ? await pressHighlight(page, added.id) : [];
        await reload(page);
        const marks = made.length ? await waitIn(page, ({ selector, id }) => {
          const m = [...document.querySelectorAll(`${selector} [data-source-id="${id}"]`)].map((e) => e.textContent).join("");
          return m || null;
        }, { selector, id: made[0].id }, 30_000) : null;
        const coreShot = await shot(page, `COLLAPSE-core-highlight-${theme}`);
        check("COLLAPSE", made.length === 1 && made[0].layer === "core" && made[0].quotedText === core.words && (marks ?? "").replace(/\s+/g, " ").trim() === core.words, `(${theme}) a highlight on a core's words is the core's, and paints on the core after a reload`, `toolbar ${opened}; stored ${made.map((m) => `"${m.quotedText}" layer ${m.layer}`).join(", ") || "none"}; painted "${marks}" ${coreShot}`);
      }
    }
    // Editing needs the words: Collapse off. Collapse in Editing goes to
    // Viewing; pressed again, the text reads whole.
    await setMode(page, "editing");
    const off = Boolean(await waitIn(page, () => !document.querySelector(".docs-prose .docs-core-slot, .docs-prose .docs-core-hidden") && document.querySelector('[data-track="collapse"]'), null, 10_000));
    await page.locator('[data-track="collapse"]').first().click();
    const back = Boolean(await waitIn(page, () => document.querySelector('[data-track="docs:mode"]')?.getAttribute("data-mode") === "viewing" && document.querySelector('.docs-prose .docs-core-slot[data-docs-core="core"]'), null, 30_000));
    await page.locator('[data-track="collapse-off"]').first().click();
    // Whole: no core drawn; each unit keeps its own button (SPEC.md §28).
    const whole = Boolean(await waitIn(page, () => !document.querySelector('.docs-prose .docs-core-slot[data-docs-core="core"], .docs-prose .docs-core-hidden'), null, 10_000));
    check("COLLAPSE", off && back && whole, `${kind} (${theme}): Editing turns Collapse off; Collapse pressed in Editing turns to Viewing; pressed again, the text reads whole`, `off in Editing ${off}, Viewing and collapsed ${back}, whole again ${whole}`);
    if (errors.length) note("COLLAPSE", `${kind}: console`, errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
    await context.close();
  }
};

// TRANSLATE: in the Chinese reader (the DeepL mock answers "[ZH] <text>"),
// the Translate bar over the paper's first page; each paragraph's
// translation under it, never the page's words (not in the rich text, not
// selected, not copied), printed as the block reader prints it, remembered
// on a reload, gone from a paragraph edited since; the glossary's key
// terms underlined, with the definition on hover and on a press.
RISKS.TRANSLATE = async (theme) => {
  const pdf = await fresh("pdf", `-translate${theme[0]}`);
  // A key term in the abstract's rows, defined in both languages.
  const term = "sequence transduction";
  const termRows = (await rowsOf(pdf.id)).filter((r) => r.type === "PARAGRAPH" && r.text.toLowerCase().includes(term)).slice(0, 3);
  const definitions = { en: "QA: a model that turns one sequence into another.", zh: "QA：把一个序列变成另一个序列的模型。" };
  await db.document.update({ where: { id: pdf.id }, data: { glossary: [{ term, definition: definitions.en, blockIds: termRows.map((r) => r.id), lang: "en", definitions }] } });
  const { page, errors, context } = await newPage(theme);
  await context.addCookies([{ name: "dissect-lang", value: "zh", url: BASE }]);
  await open(page, ctx.notebookId, pdf.id);
  const words = await page.evaluate(() => window.__docsEditor.state.doc.textContent);
  const lines = () => waitIn(page, () => {
    const n = document.querySelectorAll(".docs-prose [data-translation]").length;
    return n > 20 ? n : null;
  }, null, 90_000);
  const translate = page.locator('.docs-banner [data-translation-bar] [data-track="translate"]').first();
  const bar = await translate.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);
  if (bar) await translate.click();
  const count = (await lines()) ?? 0;
  const sample = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".docs-prose p[data-translation]")].find((e) => e.textContent.length > 80);
    return el ? { id: el.dataset.blockId, words: el.textContent, line: el.getAttribute("data-translation"), drawn: getComputedStyle(el, "::after").content } : null;
  });
  const translatedShot = await shot(page, `TRANSLATE-lines-${theme}`);
  check("TRANSLATE", bar && count > 20 && sample?.line === `[ZH] ${sample?.words}` && sample.drawn.includes("[ZH]"), `(${theme}) the Translate bar stands over the paper, and each paragraph's translation reads under it`, `bar ${bar}; ${count} lines; e.g. "${clip(sample?.line, 60)}" ${translatedShot}`);
  // Never the page's words: the rich text, a selection across a line, a copy.
  const inText = (await page.evaluate(() => window.__docsEditor.state.doc.textContent)) !== words;
  const para = sample ? await find(page, sample.words.slice(0, 30)) : null;
  let selected = "";
  let copied = "";
  if (para) {
    const next = await page.evaluate((p) => {
      const $p = window.__docsEditor.state.doc.resolve(p);
      return $p.after($p.depth) + 6;
    }, para.from);
    await dragSelect(page, para.from, next);
    selected = await page.evaluate(() => window.getSelection().toString());
    await page.keyboard.press("Control+c");
    copied = await clipboardText(page);
    await calm(page);
  }
  await page.emulateMedia({ media: "print" });
  const printed = await page.evaluate((id) => getComputedStyle(document.querySelector(`.docs-prose [data-block-id="${id}"]`), "::after").content, sample?.id ?? "");
  await page.emulateMedia({ media: "screen" });
  check("TRANSLATE", sample && !inText && selected.length > 20 && !selected.includes("[ZH]") && !copied.includes("[ZH]") && printed.includes("[ZH]"), `(${theme}) a translation is never the page's words: not in the rich text, not selected, not copied; it prints`, `rich text changed ${inText}; selected "${clip(selected, 50)}"; copied "${clip(copied, 50)}"; printed ${clip(printed, 30)}`);
  // Far down the paper too, and again after a reload, with no press.
  const late = (await pageStarts(page)).find((s) => s.page === 10);
  if (late) await page.evaluate((p) => window.__qa.show(p), late.pos);
  const far = await page.evaluate(() => {
    const b = window.__qa.band();
    return [...document.querySelectorAll(".docs-prose [data-translation]")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.bottom > b.top && r.top < b.bottom;
    }).length;
  });
  await reload(page);
  const again = (await lines()) ?? 0;
  check("TRANSLATE", far > 0 && again > 20, `(${theme}) the translations read on p. 10 too, and come back after a reload`, `${far} in view at p. 10; ${again} after the reload`);
  // Editing shows the words alone; a paragraph edited since reads its words
  // alone back in Viewing.
  if (sample) {
    await setMode(page, "editing");
    const inEditing = await page.evaluate(() => [...document.querySelectorAll(".docs-prose [data-translation]")].filter((e) => getComputedStyle(e, "::after").content.includes("[ZH]")).length);
    const end = await find(page, sample.words.slice(-12));
    await clickPos(page, end.to);
    await page.keyboard.type(" QA");
    await waitSaved(page).catch(() => {});
    await setMode(page, "viewing");
    const after = await waitIn(page, (id) => {
      const n = document.querySelectorAll(".docs-prose [data-translation]").length;
      return n > 20 ? { lines: n, edited: document.querySelector(`.docs-prose [data-block-id="${id}"]`)?.hasAttribute("data-translation") ?? null } : null;
    }, sample.id, 15_000);
    check("TRANSLATE", inEditing === 0 && after?.edited === false, `(${theme}) Editing shows no translations; back in Viewing, the paragraph edited since reads its words alone`, `in Editing ${inEditing}; after ${JSON.stringify(after)}`);
  }
  // The key term: underlined in the page; its definition on hover and on a press.
  const underlined = await waitIn(page, (t) => {
    const el = [...document.querySelectorAll(".docs-prose .glossary-term")].find((e) => e.textContent.toLowerCase().includes(t.split(" ")[0]));
    return el ? { words: el.textContent, count: document.querySelectorAll(".docs-prose .glossary-term").length } : null;
  }, term, 20_000);
  let tip = null;
  let pressed = null;
  if (underlined) {
    tip = await hoverTip(page, ".docs-prose .glossary-term");
    await page.locator(".docs-prose .glossary-term").first().click();
    const define = page.locator('[data-layer-toolbar] [data-track="define"]').first();
    if (await define.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)) {
      await define.click();
      pressed = await waitIn(page, () => document.querySelector("[data-definition]")?.textContent || null, null, 10_000);
    }
  }
  const termShot = await shot(page, `TRANSLATE-key-term-${theme}`);
  check("TRANSLATE", Boolean(underlined) && (tip ?? "").includes(definitions.zh) && (pressed ?? "").includes(definitions.zh), `(${theme}) the key term is underlined; its definition on hover and on a press (Define)`, `${JSON.stringify(underlined)}; hover "${clip(tip, 60)}"; press "${clip(pressed, 60)}" ${termShot}`);
  if (errors.length) note("TRANSLATE", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// COPY: File > Download and File > Make a copy of an import (SPEC.md §29,
// §30). The paper's and the web page's Word, web page, Markdown, and plain
// text files hold the words, no page labels, and every figure (a PDF
// figure's crop, a web figure's images); the web page file opens in a
// browser with its figures drawn, in the light theme's colors. A copy of
// the paper keeps its figures (media of its own), its page setup, and its
// page numbers, and opens in Editing like any blank document.
RISKS.COPY = async (theme) => {
  const kinds = { pdf: { words: ["Attention Is All You Need", "Scaled Dot-Product Attention"], figures: 12, pictures: 12 }, url: { words: ["The Quiet Engine of River Deltas", "Where the sediment goes"], figures: 6, pictures: 5 } };
  const { page, errors, context } = await newPage(theme);
  for (const [kind, want] of Object.entries(kinds)) {
    const added = await doc(kind);
    const noLabels = (text) => !/\bp\. \d+\b/.test(text);
    // Word, from the server (once: the theme does not reach it).
    if (theme === THEMES[0]) {
      const res = await fetch(`${BASE}/api/documents/${added.id}/export?format=docx`);
      const bytes = Buffer.from(await res.arrayBuffer());
      let xml = "";
      let media = 0;
      try {
        const { unzipSync, strFromU8 } = await import("fflate");
        const files = unzipSync(new Uint8Array(bytes));
        xml = strFromU8(files["word/document.xml"] ?? new Uint8Array());
        media = Object.keys(files).filter((f) => f.startsWith("word/media/")).length;
      } catch (e) {
        xml = `(unzip failed: ${e.message})`;
      }
      const text = xml.replace(/<[^>]+>/g, " ");
      const pictures = (xml.match(/<pic:pic\b/g) ?? []).length;
      check("COPY", res.status === 200 && want.words.every((w) => text.includes(w)) && noLabels(text) && pictures >= want.pictures, `${kind}: the Word file holds the words, no page labels, and the figures' pictures`, `HTTP ${res.status}, ${bytes.length} bytes, ${pictures} pictures (${media} media files) for ${want.figures} figure objects`);
    }
    // The web page, Markdown, and plain text files, made in the browser.
    await open(page, ctx.notebookId, added.id);
    const files = {};
    for (const [format, label] of [["html", "Download: Web Page (.html)"], ["md", "Download: Markdown (.md)"], ["txt", "Download: Plain Text (.txt)"]]) {
      files[format] = (await download(page, label))?.bytes.toString("utf8") ?? "";
    }
    const html = files.html;
    const htmlWords = html.replace(/<[^>]+>/g, " ");
    const images = (html.match(/<img\b[^>]*\bsrc="(?:data:|https?:)/g) ?? []).length + (html.match(/<svg\b/g) ?? []).length;
    const relative = (html.match(/\bsrc="\/api\//g) ?? []).length;
    check("COPY", want.words.every((w) => htmlWords.includes(w)) && noLabels(htmlWords) && images >= want.pictures && relative === 0, `${kind} (${theme}): the web page file holds the words, no page labels, and the figures' pictures inside`, `${html.length} characters; ${images} pictures; ${relative} app addresses left`);
    // Opened as a file: its figures draw, in the light theme's words.
    const view = await context.newPage();
    await view.setContent(html, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
    const opened = await view.evaluate(async () => {
      // A lazy image loads near the view: each one scrolled to, then waited for.
      const imgs = [...document.images];
      for (const img of imgs) {
        img.scrollIntoView({ block: "center" });
        await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
      }
      const p = [...document.querySelectorAll("p")].find((e) => e.textContent.trim().length > 60);
      const lum = (c) => {
        const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c ?? "");
        return m ? Math.round((Number(m[1]) + Number(m[2]) + Number(m[3])) / 3) : null;
      };
      return { images: imgs.length, drawn: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, svgs: document.querySelectorAll("svg").length, words: lum(p && getComputedStyle(p).color), ground: lum(getComputedStyle(document.body).backgroundColor) };
    });
    const fileShot = await shot(view, `COPY-${kind}-html-file-${theme}`);
    await view.close();
    check("COPY", opened.drawn + opened.svgs >= want.pictures && opened.drawn === opened.images && opened.words !== null && opened.words < 110, `${kind} (${theme}): the web page file opens with its figures drawn, dark words on a light page`, `${JSON.stringify(opened)} ${fileShot}`);
    const md = files.md;
    // An image inline, or by reference with its data at the end.
    const mdImages = (md.match(/!\[[^\]]*\][([]/g) ?? []).length;
    check("COPY", want.words.every((w) => md.includes(w)) && noLabels(md) && mdImages >= want.pictures, `${kind} (${theme}): the Markdown file holds the words, no page labels, and the figures' pictures`, `${md.length} characters; ${mdImages} images`);
    check("COPY", want.words.every((w) => files.txt.includes(w)) && noLabels(files.txt), `${kind} (${theme}): the plain text file holds the words and no page labels`, `${files.txt.length} characters`);
  }
  // Make a copy of the paper, as a person makes it: Search the menus, the
  // dialog's name, OK; the copy opens in this tab.
  const pdf = await doc("pdf");
  await open(page, ctx.notebookId, pdf.id);
  // Make a copy is off in Viewing (SPEC.md §29): Editing first.
  await setMode(page, "editing");
  await menuCommand(page, "Make a copy");
  const dialog = page.locator(".docs-tb-dialog").first();
  const named = await dialog.waitFor({ state: "visible", timeout: 10_000 }).then(() => dialog.locator("input.docs-field").inputValue()).catch(() => null);
  await dialog.locator('.docs-tb-dialog-actions button[type="submit"]').click().catch(() => {});
  const copyId = await waitIn(page, (from) => {
    const id = new URLSearchParams(location.search).get("doc");
    return id && id !== from ? id : null;
  }, pdf.id, 60_000);
  if (!copyId) {
    fail("COPY", `(${theme}) Make a copy of the paper opens the copy`, `dialog name "${named}"; still on the paper ${await shot(page, `COPY-no-copy-${theme}`)}`);
  } else {
    await ready(page);
    const [original, copy, mediaOriginal, mediaCopy, rowsOriginal, rowsCopy, sources] = await Promise.all([
      documentRow(pdf.id),
      documentRow(copyId),
      db.figureMedia.findMany({ where: { documentId: pdf.id }, select: { id: true } }),
      db.figureMedia.findMany({ where: { documentId: copyId }, select: { id: true } }),
      db.block.count({ where: { documentId: pdf.id } }),
      db.block.count({ where: { documentId: copyId } }),
      db.source.count({ where: { documentId: copyId } }),
    ]);
    const own = mediaCopy.length === 12 && mediaCopy.every((m) => !mediaOriginal.some((o) => o.id === m.id));
    const images = await loadFigureImages(page);
    const starts = await pageStarts(page);
    const labels = await page.evaluate(() => [...document.querySelectorAll(".docs-prose .docs-page-start[data-page-label]")].map((e) => e.getAttribute("data-page-label")));
    const m = await mode(page);
    const copyShot = await shot(page, `COPY-copy-of-paper-${theme}`);
    check("COPY", named === "Copy of Attention Is All You Need" && copy?.importRev === null && Boolean(copy?.richText) && own && JSON.stringify(copy.pageSetup) === JSON.stringify(original.pageSetup) && JSON.stringify(copy.pageLabels) === JSON.stringify(original.pageLabels) && rowsCopy === rowsOriginal && sources === 0, `(${theme}) Make a copy of the paper: a blank document with media of its own, the page setup, the page labels, every row, no annotations`, `name "${named}"; importRev ${copy?.importRev}; media ${mediaCopy.length} (own ${own}); page setup kept ${JSON.stringify(copy?.pageSetup) === JSON.stringify(original.pageSetup)}; rows ${rowsCopy}/${rowsOriginal}; sources ${sources}`);
    check("COPY", images.total >= 12 && images.loaded === images.total && starts.length === 15 && labels.includes("p. 7") && m === "editing", `(${theme}) the copy opens in Editing with its figures drawn and its page numbers`, `figures ${images.loaded}/${images.total}${images.failed.length ? ` (not drawn: ${images.failed.join(", ")})` : ""}; page starts ${starts.length}; labels ${labels.slice(0, 3).join(", ")}…; mode ${m} ${copyShot}`);
  }
  if (errors.length) note("COPY", "console", errors.slice(0, 3).map((e) => clip(e, 160)).join(" | "));
  await context.close();
};

// ── Main ────────────────────────────────────────────────────────────────────

/** One group in one theme: its records. A crash is a failure of its own. */
async function runGroup(name, theme) {
  const start = results.length;
  try {
    await RISKS[name](theme);
  } catch (err) {
    record("FAIL", name, `(${theme}) crashed`, String(err?.stack ?? err).split("\n").slice(0, 3).join(" | "));
  }
  return results.slice(start);
}

/** Each group with a failure runs again, alone: a fresh browser, fresh
    documents, nothing else running. A failure that passes there is FLAKY;
    one that fails again, or that the run alone never reaches, stays. */
async function alone(failed) {
  console.log(`\nAlone: ${failed.map((f) => `${f.name} (${f.theme})`).join(", ")}`);
  for (const [i, f] of failed.entries()) {
    await browser.close().catch(() => {});
    await launch();
    ctx.docs = {};
    ctx.alone = `-a${i}`;
    const again = await runGroup(f.name, f.theme);
    for (const r of f.out.filter((x) => x.level === "FAIL")) {
      const twin = again.find((a) => a.name === r.name);
      const crashFree = r.name.endsWith("crashed") && !again.some((a) => a.name.endsWith("crashed"));
      if (twin?.level === "PASS" || crashFree) {
        r.level = "FLAKY";
        r.line = `FLAKY ${r.risk} ${r.name} — failed in the run: ${r.detail}; passed alone${twin ? `: ${twin.detail}` : ""}`;
        console.log(r.line);
      }
    }
    // What the run never reached (it crashed first) counts as the run alone found it.
    for (const a of again) if (!f.out.some((r) => r.name === a.name)) a.counts = true;
  }
  ctx.alone = "";
}

async function main() {
  await prepare();
  const names = Object.keys(RISKS).filter((n) => n === "SETUP" || ONLY.size === 0 || ONLY.has(n));
  const failed = [];
  for (const theme of THEMES) {
    for (const name of names) {
      if (name === "SETUP" && theme !== THEMES[0]) continue;
      const out = await runGroup(name, theme);
      if (name !== "SETUP" && out.some((r) => r.level === "FAIL")) failed.push({ name, theme, out });
    }
  }
  if (failed.length && !ONCE) await alone(failed);
}

main()
  .catch((err) => record("FAIL", "RUN", "crashed", String(err?.stack ?? err).split("\n").slice(0, 4).join(" | ")))
  .finally(async () => {
    const counted = results.filter((r) => !r.alone || r.counts);
    const n = (level) => counted.filter((r) => r.level === level).length;
    const flaky = counted.filter((r) => r.level === "FLAKY");
    const failures = counted.filter((r) => r.level === "FAIL");
    if (flaky.length || failures.length) console.log(`\n${[...failures, ...flaky].map((r) => r.line).join("\n")}`);
    console.log(`\n${n("PASS")} passed, ${n("FAIL")} failed, ${n("FLAKY")} flaky (failed in the run, passed alone), ${n("TIME")} timings`);
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
    process.exit(n("FAIL") > 0 ? 1 : 0);
  });
