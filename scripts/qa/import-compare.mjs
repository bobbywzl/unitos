// Import compare capture (the /importcompare command's tool). For each source
// — a web page URL or a PDF path — it ingests the source into a local Unitos,
// then captures both sides for the vision pass:
//   original: the page rendered in headless Chromium (full page, one crop per
//             complex element: table, math, figure, gif, video, embed, svg,
//             code, list), the raw HTML the parser fetched, the DOM after
//             scripts ran; a PDF renders one PNG per page instead.
//   unitos:   the reader page for the document (full page, one crop per
//             TABLE, EQUATION, FIGURE, CODE, LIST block), plus the stored
//             blocks.
// A structural census of both sides and a pairing (k-th table ↔ k-th TABLE
// block, and so on) land in manifest.json and report.md. The model reads the
// report, then the paired PNGs, and judges the differences — this script never
// judges, never edits the repo.
//
// Usage:
//   node scripts/qa/import-compare.mjs --notebook <id> [--app http://localhost:3111]
//        [--out .qa/import-compare] [--fresh] [--skip-original]
//        [--list sources.txt] <url | pdf-url | file.pdf> ...
// Sources come from the reader: the arguments, or a list file with one source
// per line (# comments). A URL that serves a PDF downloads and runs as a PDF.
// Env: DATABASE_URL (default postgresql://postgres:postgres@127.0.0.1:5432/dissect),
//      IMPORT_COMPARE_CHROMIUM (default /opt/pw-browsers/chromium when present,
//      else the installed Chrome), HTTPS_PROXY (used for the original side).
// --fresh deletes the stored document for the source first, so the ingest is a
// real re-parse (dedupe would return the old blocks).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";

const PARSER_UA = "Mozilla/5.0 (compatible; Unitos/1.0)";
if (typeof Math.sumPrecise !== "function") {
  Math.sumPrecise = (values) => { let sum = 0; for (const v of values) sum += v; return sum; };
}
const VIEWPORT = { width: 1280, height: 900 };
const MAX_CROPS_PER_KIND = 60;
const MAX_FULL_PAGE_HEIGHT = 14000;
const PDF_PAGE_WIDTH = 1200;
const MAX_PDF_PAGES = 40;

// ── Arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    app: "http://localhost:3111",
    notebook: null,
    out: ".qa/import-compare",
    fresh: false,
    skipOriginal: false,
    sources: [],
    lists: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app") opts.app = argv[++i];
    else if (a === "--notebook") opts.notebook = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--fresh") opts.fresh = true;
    else if (a === "--skip-original") opts.skipOriginal = true;
    else if (a === "--list") opts.lists.push(argv[++i]);
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else opts.sources.push(a);
  }
  if (!opts.notebook) throw new Error("--notebook <id> is required (POST /api/notebooks creates one)");
  return opts;
}

// A list file: one source per line, blank lines and # comments skipped.
async function readSourceList(file) {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function slugOf(source) {
  const base = source.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  return base.slice(0, 80).toLowerCase() || "source";
}

function isPdfSource(source) {
  return !/^https?:\/\//i.test(source);
}

// ── Database ────────────────────────────────────────────────────────────────

const db = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/dissect",
});

async function deleteStored(where) {
  const docs = await db.document.findMany({ where, select: { id: true } });
  for (const d of docs) {
    await db.notebookDocument.deleteMany({ where: { documentId: d.id } });
    await db.document.delete({ where: { id: d.id } });
  }
  return docs.length;
}

async function storedBlocks(documentId) {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, parserVersion: true, handwritten: true, sourceUrl: true, conversionStatus: true },
  });
  const blocks = await db.block.findMany({
    where: { documentId },
    orderBy: { order: "asc" },
    select: { id: true, order: true, type: true, text: true, html: true, page: true },
  });
  return { document, blocks };
}

// ── Ingest through the app's own API ────────────────────────────────────────

async function readNdjson(res) {
  const events = [];
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ raw: line });
    }
  }
  return events;
}

async function ingest(opts, source) {
  const t0 = Date.now();
  let res;
  if (isPdfSource(source)) {
    const bytes = await readFile(source);
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "application/pdf" }), path.basename(source));
    form.set("notebookId", opts.notebook);
    form.set("instructions", "");
    res = await fetch(`${opts.app}/api/documents`, { method: "POST", body: form });
  } else {
    res = await fetch(`${opts.app}/api/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: source, notebookId: opts.notebook }),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 300)}`, ms: Date.now() - t0 };
  }
  const events = await readNdjson(res);
  const last = events[events.length - 1] ?? {};
  if (!last.id) return { ok: false, error: last.error ?? "no result line", events, ms: Date.now() - t0 };
  return { ok: true, id: last.id, title: last.title, deduped: Boolean(last.deduped), events, ms: Date.now() - t0 };
}

// ── Browser ─────────────────────────────────────────────────────────────────

function chromiumOptions(extraArgs = []) {
  const exe = process.env.IMPORT_COMPARE_CHROMIUM ?? "/opt/pw-browsers/chromium";
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  return {
    ...(existsSync(exe) ? { executablePath: exe } : { channel: "chrome" }),
    ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}),
    args: extraArgs,
  };
}

// The original side goes out through the proxy when one is set. Some TLS
// terminators drop Chromium's TLS 1.3 hello and reset the connection; a probe
// decides, and the fallback caps TLS at 1.2 (still verified, never ignored).
async function launchForOriginals() {
  const plain = await chromium.launch(chromiumOptions());
  if (!(process.env.HTTPS_PROXY ?? process.env.https_proxy)) return plain;
  const page = await plain.newPage();
  try {
    await page.goto("https://example.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.close();
    return plain;
  } catch (err) {
    if (!/ERR_CONNECTION_RESET|ERR_SSL/.test(String(err))) {
      await page.close();
      return plain;
    }
  }
  await plain.close();
  console.log("[browser] proxy reset the TLS 1.3 hello; relaunching with --ssl-version-max=tls1.2");
  return chromium.launch(chromiumOptions(["--ssl-version-max=tls1.2"]));
}

async function gotoSettled(page, url, timeout = 60000) {
  try {
    return await page.goto(url, { waitUntil: "networkidle", timeout });
  } catch (err) {
    if (!/Timeout/i.test(String(err))) throw err;
    return page.goto(url, { waitUntil: "domcontentloaded", timeout });
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const step = window.innerHeight;
    const max = Math.min(document.documentElement.scrollHeight, 60 * step);
    for (let y = 0; y < max; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
}

async function fullPageShot(page, file) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const clipped = height > MAX_FULL_PAGE_HEIGHT;
  await page.screenshot({
    path: file,
    fullPage: true,
    ...(clipped ? { clip: { x: 0, y: 0, width: VIEWPORT.width, height: MAX_FULL_PAGE_HEIGHT } } : {}),
  });
  return { height, clipped };
}

// ── The original side: a web page ───────────────────────────────────────────

// Layout of a content column, measured the same way on both sides so the
// report can compare relative sizes: the text column's width and margins, body
// text size and leading, heading sizes, paragraph spacing, the table of
// contents. Runs inside the page; injected ahead of both census scripts.
const LAYOUT_SCRIPT = `
function measureLayout(root, tocEl) {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const paras = [...root.querySelectorAll("p")].filter((p) => norm(p.textContent).length > 80 && p.getBoundingClientRect().width > 0);
  const sample = paras[Math.floor(paras.length / 2)] || paras[0] || root;
  const cs = getComputedStyle(sample);
  const rect = sample.getBoundingClientRect();
  const size = (sel) => { const h = root.querySelector(sel + "[data-block-id]") || root.querySelector(sel); return h ? Math.round(parseFloat(getComputedStyle(h).fontSize) * 10) / 10 : null; };
  let gap = null;
  for (let i = 1; i < Math.min(paras.length, 30); i++) {
    const a = paras[i - 1].getBoundingClientRect(), b = paras[i].getBoundingClientRect();
    const g = Math.round(b.top - a.bottom);
    if (g >= 0 && (gap === null || g < gap)) gap = g;
  }
  const fontSize = parseFloat(cs.fontSize);
  const lineHeight = parseFloat(cs.lineHeight);
  return {
    viewport: window.innerWidth,
    column: { left: Math.round(rect.left), width: Math.round(rect.width), rightMargin: Math.round(window.innerWidth - rect.right) },
    text: { fontSize, lineHeight: Number.isFinite(lineHeight) ? Math.round((lineHeight / fontSize) * 100) / 100 : null, fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(), paragraphGap: gap, charsPerLine: Math.round(rect.width / (fontSize * 0.5)) },
    headings: { h1: size("h1"), h2: size("h2"), h3: size("h3") },
    toc: tocEl ? { entries: tocEl.querySelectorAll("li").length, inContent: root.contains(tocEl) } : null,
  };
}
`;

// page.evaluate takes one expression: declare the layout function inside a
// wrapper that returns the census expression.
const withLayout = (expression) => `(() => { ${LAYOUT_SCRIPT} return (${expression}); })()`;

// Mirrors lib/parse/url.ts contentRoot: the largest article/main/[role=main]
// by text length, else body. Runs inside the page.
const ORIGINAL_CENSUS_SCRIPT = `
(() => {
  const norm = (s) => (s || "").replace(/\\s+/g, " ").trim();
  let root = document.body, best = 0;
  for (const c of document.querySelectorAll("article, main, [role='main']")) {
    const n = (c.textContent || "").length;
    if (n >= best) { best = n; root = c; }
  }
  if (best <= 200) root = document.body;
  const skip = (el) => el.closest("nav, header, footer, aside, [role='navigation'], [role='banner'], [role='contentinfo']") !== null;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) }; };
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const items = [];
  let n = 0;
  const push = (kind, el, extra = {}) => {
    if (skip(el) || !visible(el)) return;
    el.setAttribute("data-ic-index", String(n));
    items.push({ kind, index: n, tag: el.tagName.toLowerCase(), text: norm(el.textContent).slice(0, 160), html: el.outerHTML.slice(0, 800), box: box(el), ...extra });
    n++;
  };
  // Tables: real data tables only (no nested tables, some text).
  for (const t of root.querySelectorAll("table")) {
    if (t.querySelector("table") || t.closest("table table")) continue;
    if (norm(t.textContent).length < 20) continue;
    push("table", t, { rows: t.querySelectorAll("tr").length });
  }
  // Math: every rendered math container; display when it sits on its own line.
  const mathSel = ".katex-display, .katex, mjx-container, math, .MathJax_Display, .MathJax, .mwe-math-element, .ltx_equation, script[type^='math/tex']";
  for (const m of root.querySelectorAll(mathSel)) {
    if (m.closest(".katex-display") && !m.classList.contains("katex-display")) continue;
    if (m.closest("mjx-container") && m.tagName.toLowerCase() !== "mjx-container") continue;
    if (m.closest(".mwe-math-element") && !m.classList.contains("mwe-math-element")) continue;
    if (m.tagName.toLowerCase() === "math" && m.closest(".mwe-math-element, mjx-container, .katex")) continue;
    const r = m.getBoundingClientRect();
    const parent = m.parentElement;
    const ownLine = parent && ["dd", "div", "p", "center", "li"].includes(parent.tagName.toLowerCase()) && norm(parent.textContent) === norm(m.textContent);
    const display = !m.closest("td, th") && (m.classList.contains("katex-display") || m.getAttribute("display") === "true" || m.getAttribute("display") === "block" ||
      m.classList.contains("MathJax_Display") || m.closest(".ltx_equation, .ltx_equationgroup") !== null || m.querySelector("[class*='-display']") !== null || ownLine);
    const tex = m.querySelector("annotation[encoding='application/x-tex']")?.textContent || m.getAttribute("alttext") || m.querySelector("img[alt]")?.getAttribute("alt") || (m.tagName.toLowerCase() === "script" ? m.textContent : "");
    push("math", m, { display: Boolean(display), tex: norm(tex).slice(0, 300), inline: !display && r.height < 40 });
  }
  // Figures and media.
  const media = (el) => {
    if (el.tagName.toLowerCase() === "img") {
      const src = el.currentSrc || el.src || el.getAttribute("data-src") || "";
      if (el.naturalWidth > 0 && (el.naturalWidth < 40 || el.naturalHeight < 40)) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return null;
      return { kind: /\\.gif(\\?|#|$)/i.test(src) ? "gif" : "figure", src, alt: el.getAttribute("alt") || "", natural: [el.naturalWidth, el.naturalHeight], loaded: el.complete && el.naturalWidth > 0 };
    }
    if (el.tagName.toLowerCase() === "video") return { kind: el.hasAttribute("loop") && el.muted ? "gif" : "video", src: el.currentSrc || el.src || el.querySelector("source")?.src || "" };
    if (el.tagName.toLowerCase() === "iframe") return { kind: "embed", src: el.src || el.getAttribute("data-src") || "" };
    if (el.tagName.toLowerCase() === "svg") {
      const shapes = el.querySelectorAll("path, rect, circle, line, polyline, polygon").length;
      const r = el.getBoundingClientRect();
      if (!(el.querySelector("text") || (shapes > 6 && r.width > 100))) return null;
      return { kind: "svg", shapes };
    }
    if (/^(object|embed|lite-youtube|lite-vimeo)$/i.test(el.tagName)) return { kind: "embed", src: el.getAttribute("data") || el.getAttribute("src") || el.getAttribute("videoid") || "" };
    return null;
  };
  const seenMedia = new Set();
  for (const el of root.querySelectorAll("figure, img, video, iframe, svg, object, embed, lite-youtube, lite-vimeo, [data-youtube-id], .twitter-tweet, blockquote.instagram-media")) {
    const tag = el.tagName.toLowerCase();
    if (tag === "figure") {
      const inner = el.querySelector("img, video, iframe, svg, object, embed");
      const m = inner ? media(inner) : null;
      if (!m) continue;
      for (const x of el.querySelectorAll("img, video, iframe, svg, object, embed")) seenMedia.add(x);
      push(m.kind, el, { ...m, caption: norm(el.querySelector("figcaption")?.textContent || "").slice(0, 200), inFigure: true });
      continue;
    }
    if (seenMedia.has(el)) continue;
    if (el.closest("figure") && el.closest("figure").querySelector("img, video, iframe, svg, object, embed")) continue;
    if (el.matches("[data-youtube-id], .twitter-tweet, blockquote.instagram-media")) { push("embed", el, { src: el.getAttribute("data-youtube-id") || el.querySelector("a")?.href || "" }); continue; }
    if (el.closest("table") || el.closest("[data-ic-index]")) continue;
    const m = media(el);
    if (!m) continue;
    push(m.kind, el, m);
  }
  for (const p of root.querySelectorAll("pre")) push("code", p, { lines: (p.textContent || "").split("\\n").length });
  for (const l of root.querySelectorAll("ul, ol")) {
    if (l.closest("ul ul, ol ol, ul ol, ol ul") || l.closest("[data-ic-index]")) continue;
    if (l.querySelectorAll("li").length < 2) continue;
    push("list", l, { items: l.querySelectorAll("li").length, ordered: l.tagName.toLowerCase() === "ol" });
  }
  for (const b of root.querySelectorAll("blockquote")) if (!b.closest("[data-ic-index]")) push("quote", b, {});
  const paragraphs = [...root.querySelectorAll("p")].filter((p) => norm(p.textContent).length > 0 && !skip(p)).length;
  const headings = [...root.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => !skip(h)).length;
  const separators = root.querySelectorAll("hr").length;
  const layout = measureLayout(root, document.querySelector("#toc, .toc, [role='doc-toc'], nav[aria-label*='ontent'], .table-of-contents, #vector-toc, .vector-toc, .toc-container"));
  for (const it of items) it.widthPct = layout.column.width > 0 ? Math.round((it.box.w / layout.column.width) * 100) : null;
  return { rootTag: root.tagName.toLowerCase(), rootText: norm(root.textContent).length, paragraphs, headings, separators, items, title: document.title, layout };
})()
`;

// The fetch the parser makes: the parser's UA, no scripts. Returns the bytes
// and the content type, so a URL that serves a PDF is recognized before ingest.
async function fetchRaw(url) {
  const { fetch: undiciFetch, EnvHttpProxyAgent } = await import("undici");
  const proxied = Boolean(process.env.HTTPS_PROXY ?? process.env.https_proxy);
  const res = await undiciFetch(url, {
    headers: { "User-Agent": PARSER_UA },
    signal: AbortSignal.timeout(60000),
    ...(proxied ? { dispatcher: new EnvHttpProxyAgent() } : {}),
  });
  const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const contentType = res.headers.get("content-type") ?? "";
  const pdf = /application\/pdf/i.test(contentType) || bytes.subarray(0, 5).toString() === "%PDF-";
  return { status: res.status, contentType, bytes, pdf, html: pdf ? "" : bytes.toString("utf8") };
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}

function basenameOf(src) {
  try {
    return path.basename(new URL(src, "https://x/").pathname);
  } catch {
    return src.slice(0, 60);
  }
}

// Normalized views of the raw html the parser fetched, computed once per page:
// decoded (entities resolved, for TeX and URLs) and text (tags stripped, for
// element text). An element is "in raw" when one of its keys appears there.
function rawViews(raw) {
  const decoded = decodeEntities(raw);
  const text = decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return { decoded, text, decodedCompact: decoded.replace(/\s+/g, ""), textCompact: text.replace(/\s+/g, "") };
}

function keyInRaw(item, views) {
  if (item.src && views.decoded.includes(basenameOf(item.src))) return true;
  if (item.tex && item.tex.length >= 6 && views.decodedCompact.includes(item.tex.replace(/\s+/g, "").slice(0, 60))) return true;
  const compact = (item.text ?? "").replace(/\s+/g, "");
  if (compact.length >= 12 && views.textCompact.includes(compact.slice(0, 40))) return true;
  return false;
}

async function captureOriginalPage(browser, url, dir, raw) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: undefined });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 200)));
  const result = { status: null, blocked: false, screenshot: null, census: null, items: [], dom: null, raw: null, rawStatus: null, errors: consoleErrors };
  try {
    const res = await gotoSettled(page, url);
    result.status = res?.status() ?? null;
    if (result.status && result.status >= 400) result.blocked = true;
    await autoScroll(page);
    await page.waitForTimeout(1200);
    const domHtml = await page.content();
    result.dom = path.join(dir, "original.dom.html");
    await writeFile(result.dom, domHtml);
    const shot = await fullPageShot(page, path.join(dir, "original.png"));
    result.screenshot = { file: path.join(dir, "original.png"), ...shot };
    const census = await page.evaluate(withLayout(ORIGINAL_CENSUS_SCRIPT));
    result.census = { rootTag: census.rootTag, rootText: census.rootText, paragraphs: census.paragraphs, headings: census.headings, separators: census.separators, title: census.title };
    result.layout = census.layout;
    // A bot wall renders a short challenge page: flag it, the census is not the article.
    if (census.rootText < 400 && /just a moment|verify you are human|access denied|enable javascript and cookies/i.test(domHtml)) result.blocked = true;
    const perKind = {};
    for (const item of census.items) {
      if (item.kind === "math" && item.inline) continue; // inline math is text in Unitos; the census still counts it
      perKind[item.kind] = (perKind[item.kind] ?? 0) + 1;
      if (perKind[item.kind] > MAX_CROPS_PER_KIND) continue;
      const el = page.locator(`[data-ic-index="${item.index}"]`).first();
      const file = path.join(dir, `original.${item.kind}-${item.index}.png`);
      try {
        await el.scrollIntoViewIfNeeded({ timeout: 5000 });
        await page.waitForTimeout(150);
        await el.screenshot({ path: file, timeout: 15000, animations: "disabled" });
        item.png = file;
      } catch (err) {
        item.png = null;
        item.cropError = String(err).split("\n")[0].slice(0, 160);
      }
    }
    result.items = census.items;
  } catch (err) {
    result.error = String(err).split("\n")[0].slice(0, 300);
  } finally {
    await ctx.close();
  }
  try {
    result.rawStatus = raw.status;
    result.raw = path.join(dir, "original.raw.html");
    await writeFile(result.raw, raw.html);
    const views = rawViews(raw.html);
    for (const item of result.items) item.inRaw = keyInRaw(item, views);
  } catch (err) {
    result.rawError = String(err).split("\n")[0].slice(0, 200);
  }
  return result;
}

// ── The original side: a PDF ────────────────────────────────────────────────

async function captureOriginalPdf(source, dir) {
  const bytes = await readFile(source);
  const { getDocumentProxy, renderPageAsImage, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageCount = pdf.numPages;
  const pages = [];
  for (let p = 1; p <= Math.min(pageCount, MAX_PDF_PAGES); p++) {
    const png = await renderPageAsImage(new Uint8Array(bytes), p, {
      canvasImport: () => import("@napi-rs/canvas"),
      width: PDF_PAGE_WIDTH,
    });
    const file = path.join(dir, `original.page-${p}.png`);
    await writeFile(file, Buffer.from(png instanceof Uint8Array ? png : new Uint8Array(png)));
    pages.push({ page: p, png: file });
  }
  let textPerPage = [];
  try {
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: false });
    textPerPage = (Array.isArray(text) ? text : [text]).map((t, i) => ({ page: i + 1, chars: (t ?? "").length }));
  } catch {
    textPerPage = [];
  }
  return { pageCount, rendered: pages.length, pages, textPerPage, fileHash: createHash("sha256").update(bytes).digest("hex") };
}

// ── The Unitos side ─────────────────────────────────────────────────────────

const CROP_TYPES = new Set(["TABLE", "EQUATION", "FIGURE", "CODE", "LIST", "PAGE"]);

async function captureUnitos(browser, opts, documentId, blocks, dir) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const result = { url: `${opts.app}/n/${opts.notebook}?doc=${documentId}`, screenshot: null, blocks: [], errors, media: null, layout: null };
  // Why an image did not load: a 4xx/5xx is the app's problem (dead URL, hotlink
  // block); a Chromium-side block (ORB, TLS, proxy) is this environment's.
  const imageFailures = [];
  page.on("requestfailed", (r) => {
    if (r.resourceType() === "image") imageFailures.push({ url: r.url().slice(0, 200), reason: r.failure()?.errorText ?? "failed" });
  });
  page.on("response", (r) => {
    if (r.request().resourceType() === "image" && r.status() >= 400) imageFailures.push({ url: r.url().slice(0, 200), reason: `HTTP ${r.status()}` });
  });
  try {
    await gotoSettled(page, result.url);
    await page.locator("[data-block-id]").first().waitFor({ state: "attached", timeout: 30000 });
    // The reader scrolls inside a container, so a full-page screenshot was
    // the viewport alone. Let the container and its ancestors grow to their
    // content, then the page itself scrolls and the shot shows every block.
    await page.evaluate(() => {
      const article = document.querySelector("article.reader-prose") || document.querySelector("[data-block-id]");
      let el = article;
      while (el && el !== document.documentElement) {
        el.style.height = "auto";
        el.style.maxHeight = "none";
        el.style.minHeight = "0";
        el.style.overflow = "visible";
        el = el.parentElement;
      }
      document.documentElement.style.height = "auto";
      document.documentElement.style.overflow = "visible";
      document.body.style.height = "auto";
      document.body.style.overflow = "visible";
    });
    await page.waitForTimeout(300);
    await autoScroll(page);
    // Figures load lazily and a PDF figure renders its page on the server:
    // wait for every image before the shots, or the crops show captions alone.
    await page
      .waitForFunction(() => [...document.querySelectorAll("article img")].every((i) => i.complete), null, { timeout: 90000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    const shot = await fullPageShot(page, path.join(dir, "unitos.png"));
    result.screenshot = { file: path.join(dir, "unitos.png"), ...shot };
    result.media = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("article img")];
      return {
        images: imgs.length,
        brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")?.slice(0, 160)),
        iframes: [...document.querySelectorAll("article iframe")].map((f) => f.getAttribute("src")?.slice(0, 160)),
        videos: document.querySelectorAll("article video").length,
        svgs: document.querySelectorAll("article .reader-figure svg").length,
        katexErrors: document.querySelectorAll("article .katex-error").length,
      };
    });
    result.media.imageFailures = imageFailures;
    const measured = await page.evaluate(withLayout(`
      (() => {
        const article = document.querySelector("article.reader-prose") || document.body;
        const layout = measureLayout(article, null);
        const widths = {};
        for (const el of article.querySelectorAll("[data-block-id]")) {
          const w = el.getBoundingClientRect().width;
          const img = el.querySelector("img, video, iframe, svg, table");
          const inner = img ? img.getBoundingClientRect().width : null;
          widths[el.getAttribute("data-block-id")] = { block: Math.round(w), media: inner === null ? null : Math.round(inner) };
        }
        return { layout, widths };
      })()
    `));
    result.layout = measured.layout;
    result.widths = measured.widths;
    let crops = 0;
    for (const block of blocks) {
      const entry = { order: block.order, id: block.id, type: block.type, text: block.text.slice(0, 160), html: (block.html ?? "").slice(0, 800), page: block.page };
      const measured = result.widths?.[block.id];
      const column = result.layout?.column?.width ?? 0;
      if (measured && column > 0) entry.widthPct = Math.round(((measured.media ?? measured.block) / column) * 100);
      if (CROP_TYPES.has(block.type) && crops < MAX_CROPS_PER_KIND * 4) {
        const el = page.locator(`[data-block-id="${block.id}"]`).first();
        const file = path.join(dir, `unitos.block-${block.order}.png`);
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 5000 });
          await page.waitForTimeout(150);
          await el.screenshot({ path: file, timeout: 15000, animations: "disabled" });
          entry.png = file;
          crops++;
        } catch (err) {
          entry.png = null;
          entry.cropError = String(err).split("\n")[0].slice(0, 160);
        }
      }
      result.blocks.push(entry);
    }
  } catch (err) {
    result.error = String(err).split("\n")[0].slice(0, 300);
  } finally {
    await ctx.close();
  }
  return result;
}

// ── Census, pairing, report ─────────────────────────────────────────────────

const KIND_TO_TYPE = { table: "TABLE", math: "EQUATION", figure: "FIGURE", gif: "FIGURE", video: "FIGURE", embed: "FIGURE", svg: "FIGURE", code: "CODE", list: "LIST" };

function count(list, by) {
  const out = {};
  for (const x of list) out[by(x)] = (out[by(x)] ?? 0) + 1;
  return out;
}

const PAIRED_TYPES = new Set(Object.values(KIND_TO_TYPE));

function texKey(tex) {
  return (tex ?? "").replace(/\\displaystyle/g, "").replace(/[\s{}]/g, "");
}

function textKey(text) {
  return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 60);
}

function originalKeys(item) {
  if (item.kind === "math") return item.tex ? [texKey(item.tex)] : [];
  if (["figure", "gif", "video", "embed", "svg"].includes(item.kind)) return item.src ? [basenameOf(item.src)] : [];
  return item.text ? [textKey(item.text)] : [];
}

function blockKeys(block) {
  if (block.type === "EQUATION") return [texKey(block.text)];
  if (block.type === "FIGURE") return [...(block.html ?? "").matchAll(/(?:src|poster)="([^"]+)"/g)].map((m) => basenameOf(m[1]));
  return [textKey(block.text)];
}

// Pairs each original element with a Unitos block of the matching type: by
// content key first (the same TeX, the same image file, the same opening
// text), then by order for what is left. A pair records which one matched it.
function pair(originalItems, entries, dbBlocks) {
  const pairs = [];
  const unpairedOriginal = [];
  const entryByOrder = new Map(entries.map((e) => [e.order, e]));
  const candidates = dbBlocks.filter((b) => PAIRED_TYPES.has(b.type)).map((b) => ({ block: b, keys: blockKeys(b), used: false }));
  const items = originalItems.filter((i) => !(i.kind === "math" && i.inline) && KIND_TO_TYPE[i.kind]);
  const record = (item, candidate, matched) => {
    candidate.used = true;
    const entry = entryByOrder.get(candidate.block.order) ?? {};
    pairs.push({ kind: item.kind, type: candidate.block.type, matched, original: { index: item.index, png: item.png ?? null, text: item.text, src: item.src ?? null, tex: item.tex ?? null, inRaw: item.inRaw ?? null, widthPct: item.widthPct ?? null }, unitos: { order: candidate.block.order, png: entry.png ?? null, text: candidate.block.text.slice(0, 160), widthPct: entry.widthPct ?? null } });
  };
  const deferred = [];
  for (const item of items) {
    const type = KIND_TO_TYPE[item.kind];
    const keys = originalKeys(item).filter((k) => k.length >= 4);
    const hit = keys.length > 0 ? candidates.find((c) => !c.used && c.block.type === type && c.keys.some((k) => keys.includes(k))) : undefined;
    if (hit) record(item, hit, "key");
    else deferred.push(item);
  }
  for (const item of deferred) {
    const type = KIND_TO_TYPE[item.kind];
    const hit = candidates.find((c) => !c.used && c.block.type === type);
    if (hit) record(item, hit, "order");
    else unpairedOriginal.push(item);
  }
  pairs.sort((a, b) => a.original.index - b.original.index);
  const unpairedUnitos = candidates.filter((c) => !c.used).map((c) => ({ ...(entryByOrder.get(c.block.order) ?? {}), order: c.block.order, type: c.block.type, text: c.block.text.slice(0, 160) }));
  return { pairs, unpairedOriginal, unpairedUnitos };
}

function reportFor(entry) {
  const lines = [];
  lines.push(`# ${entry.source}`);
  lines.push("");
  lines.push(`- kind: ${entry.kind}`);
  lines.push(`- ingest: ${entry.ingest.ok ? `ok · document ${entry.ingest.id} · ${entry.ingest.deduped ? "deduped (stored parse reused)" : "parsed"} · ${entry.ingest.ms} ms` : `FAILED · ${entry.ingest.error}`}`);
  if (entry.document) lines.push(`- document: "${entry.document.title}" · parserVersion ${entry.document.parserVersion} · handwritten ${entry.document.handwritten} · ${entry.blocks.length} blocks`);
  if (entry.original?.blocked) lines.push(`- original: BLOCKED (status ${entry.original.status}) — the browser did not get the article`);
  if (entry.original?.error) lines.push(`- original: error · ${entry.original.error}`);
  if (entry.original?.rawStatus !== undefined && entry.original?.rawStatus !== null) lines.push(`- raw fetch with the parser's UA: HTTP ${entry.original.rawStatus}`);
  if (entry.unitos?.error) lines.push(`- unitos: error · ${entry.unitos.error}`);
  lines.push("");
  lines.push("## Census");
  lines.push("");
  const unitosCounts = count(entry.blocks, (b) => b.type);
  if (entry.kind === "pdf") {
    lines.push(`original: ${entry.original.pageCount} pages (${entry.original.rendered} rendered) · text chars per page ${entry.original.textPerPage.map((p) => p.chars).join(", ")}`);
  } else if (entry.original?.census) {
    const c = entry.original.census;
    const kinds = count(entry.original.items, (i) => (i.kind === "math" ? (i.inline ? "math-inline" : "math-display") : i.kind));
    lines.push(`original (${c.rootTag}, ${c.rootText} chars): paragraphs ${c.paragraphs} · headings ${c.headings} · separators ${c.separators} · ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(" · ") || "no complex elements"}`);
  }
  lines.push(`unitos: ${Object.entries(unitosCounts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  if (entry.unitos?.media) {
    const m = entry.unitos.media;
    lines.push(`unitos media: images ${m.images} (broken ${m.brokenImages.length}) · iframes ${m.iframes.length} · videos ${m.videos} · svgs ${m.svgs} · katex errors ${m.katexErrors}`);
    const reasons = new Map((m.imageFailures ?? []).map((f) => [f.url, f.reason]));
    for (const b of m.brokenImages) {
      const reason = [...reasons.entries()].find(([u]) => b && u.startsWith(b.slice(0, 120)))?.[1] ?? "no response recorded";
      lines.push(`  - broken image: ${b} — ${reason}${/ERR_BLOCKED_BY_ORB|ERR_CERT|ERR_TUNNEL|ERR_PROXY/.test(reason) ? " (this browser or proxy, not the app)" : ""}`);
    }
  }
  lines.push("");
  if (entry.original?.layout || entry.unitos?.layout) {
    lines.push("## Layout (relative sizes, both sides at a 1280 px viewport)");
    lines.push("");
    const side = (name, l) => {
      if (!l) return `${name}: not measured`;
      const toc = l.toc ? `toc ${l.toc.entries} entries${l.toc.inContent ? " in the content" : " outside the content"}` : "no toc";
      return `${name}: column ${l.column.width}px (left ${l.column.left}px, right ${l.column.rightMargin}px) · text ${l.text.fontSize}px / ${l.text.lineHeight ?? "?"} ${l.text.fontFamily} · ~${l.text.charsPerLine} chars per line · paragraph gap ${l.text.paragraphGap ?? "?"}px · h1 ${l.headings.h1 ?? "-"} h2 ${l.headings.h2 ?? "-"} h3 ${l.headings.h3 ?? "-"} px · ${toc}`;
    };
    lines.push(side("original", entry.original?.layout ?? null));
    lines.push(side("unitos", entry.unitos?.layout));
    const widths = entry.pairing.pairs.filter((p) => p.original.widthPct !== null && p.unitos.widthPct !== null && ["figure", "gif", "video", "embed", "svg", "table", "code"].includes(p.kind));
    if (widths.length > 0) {
      lines.push(`widths as a share of the column (original → unitos): ${widths.map((p) => `${p.kind} #${p.original.index} ${p.original.widthPct}% → ${p.unitos.widthPct}%`).join(" · ")}`);
    }
    lines.push("");
  }
  if (entry.kind === "pdf") {
    lines.push("## Pages (original) and blocks (unitos)");
    lines.push("");
    for (const p of entry.original.pages) lines.push(`- page ${p.page}: ${p.png}`);
    lines.push("");
    lines.push(`- unitos full page: ${entry.unitos?.screenshot?.file ?? "-"}`);
    for (const b of entry.unitos?.blocks ?? []) if (b.png) lines.push(`- block ${b.order} ${b.type} (page ${b.page ?? "?"}): ${b.png} — ${b.text.slice(0, 80)}`);
    lines.push("");
    lines.push("Read each page PNG, then the unitos blocks that came from that page. Judge: missing or reordered text, columns merged, tables and equations that became prose, figures shown as the whole page, captions.");
  } else {
    lines.push("## Pairs (k-th original element ↔ k-th unitos block of the matching type)");
    lines.push("");
    lines.push(`- original full page: ${entry.original?.screenshot?.file ?? "-"}${entry.original?.screenshot?.clipped ? " (clipped to the first 14000 px)" : ""}`);
    lines.push(`- unitos full page: ${entry.unitos?.screenshot?.file ?? "-"}`);
    lines.push("");
    for (const p of entry.pairing.pairs) {
      lines.push(`- ${p.kind} #${p.original.index} ↔ ${p.type} block ${p.unitos.order} · matched by ${p.matched}${p.original.inRaw === false ? " · NOT in raw html (client-rendered)" : ""}`);
      lines.push(`  original: ${p.original.png ?? "(no crop)"}${p.original.src ? ` · src ${p.original.src.slice(0, 120)}` : ""}${p.original.tex ? ` · tex ${p.original.tex.slice(0, 100)}` : ""}`);
      lines.push(`  unitos:   ${p.unitos.png ?? "(no crop)"} · ${p.unitos.text.slice(0, 100)}`);
    }
    if (entry.pairing.unpairedOriginal.length > 0) {
      lines.push("");
      lines.push("## Original elements with no unitos block of the matching type (missing in the import, or the census over-counted)");
      lines.push("");
      for (const i of entry.pairing.unpairedOriginal) lines.push(`- ${i.kind} #${i.index}${i.inRaw === false ? " · NOT in raw html (client-rendered)" : ""}: ${i.png ?? "(no crop)"}${i.src ? ` · src ${i.src.slice(0, 120)}` : ""} — ${i.text.slice(0, 80)}`);
    }
    if (entry.pairing.unpairedUnitos.length > 0) {
      lines.push("");
      lines.push("## Unitos blocks with no original element of the matching kind (extra, or typed differently)");
      lines.push("");
      for (const b of entry.pairing.unpairedUnitos) lines.push(`- ${b.type} block ${b.order}: ${b.png ?? "(no crop)"} — ${b.text.slice(0, 80)}`);
    }
    lines.push("");
    lines.push("Read the full pages first (overall shape, missing head or tail, chrome kept), then each pair's two PNGs. An element marked NOT in raw html never reached the parser: report it as client-rendered, not as a parse bug.");
  }
  lines.push("");
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  for (const list of opts.lists) opts.sources.push(...(await readSourceList(list)));
  if (opts.sources.length === 0) throw new Error("Give at least one URL or PDF path, or --list <file>");
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.resolve(opts.out, runId);
  await mkdir(runDir, { recursive: true });
  const entries = [];
  let browser = null;
  const getBrowser = async () => (browser ??= await launchForOriginals());

  for (const source of opts.sources) {
    let kind = isPdfSource(source) ? "pdf" : "url";
    // The ingest input: the PDF path, or the URL. A URL that serves a PDF
    // downloads into the run and runs as a PDF; entry.source stays the URL.
    let input = source;
    let raw = null;
    const dir = path.join(runDir, slugOf(source));
    await mkdir(dir, { recursive: true });
    const entry = { source, kind, dir, ingest: null, document: null, blocks: [], original: null, unitos: null, pairing: { pairs: [], unpairedOriginal: [], unpairedUnitos: [] } };
    entries.push(entry);
    try {
      if (kind === "url") {
        raw = await fetchRaw(source);
        if (raw.pdf) {
          kind = "pdf";
          input = path.join(dir, "original.pdf");
          await writeFile(input, raw.bytes);
          entry.kind = kind;
          entry.file = input;
        }
      }
      console.log(`\n[${kind}] ${source}${input !== source ? ` (downloaded ${raw.bytes.length} bytes)` : ""}`);
      if (opts.fresh) {
        const where = kind === "pdf"
          ? { fileHash: createHash("sha256").update(await readFile(input)).digest("hex") }
          : { sourceUrl: source };
        const n = await deleteStored(where);
        if (n > 0) console.log(`[fresh] deleted ${n} stored document(s)`);
      }
      entry.ingest = await ingest(opts, input);
      console.log(`[ingest] ${entry.ingest.ok ? `${entry.ingest.id} (${entry.ingest.deduped ? "deduped" : "parsed"}, ${entry.ingest.ms} ms)` : `FAILED: ${entry.ingest.error}`}`);
      if (entry.ingest.ok) {
        const stored = await storedBlocks(entry.ingest.id);
        entry.document = stored.document;
        entry.blocks = stored.blocks;
        console.log(`[blocks] ${stored.blocks.length}: ${Object.entries(count(stored.blocks, (b) => b.type)).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      }
      if (kind === "pdf") {
        entry.original = await captureOriginalPdf(input, dir);
        console.log(`[original] ${entry.original.rendered}/${entry.original.pageCount} pages rendered`);
      } else if (!opts.skipOriginal) {
        entry.original = await captureOriginalPage(await getBrowser(), source, dir, raw);
        console.log(`[original] status ${entry.original.status}${entry.original.blocked ? " BLOCKED" : ""} · ${entry.original.items.length} elements · raw ${entry.original.rawStatus}${entry.original.error ? ` · error ${entry.original.error}` : ""}`);
      }
      if (entry.ingest.ok) {
        entry.unitos = await captureUnitos(await getBrowser(), opts, entry.ingest.id, entry.blocks, dir);
        console.log(`[unitos] ${entry.unitos.blocks.filter((b) => b.png).length} crops${entry.unitos.error ? ` · error ${entry.unitos.error}` : ""}`);
        if (kind === "url" && entry.original?.items) {
          entry.pairing = pair(entry.original.items, entry.unitos.blocks, entry.blocks);
          console.log(`[pairs] ${entry.pairing.pairs.length} paired · ${entry.pairing.unpairedOriginal.length} original unpaired · ${entry.pairing.unpairedUnitos.length} unitos unpaired`);
        }
      }
    } catch (err) {
      entry.error = String(err).split("\n")[0].slice(0, 300);
      console.log(`[error] ${entry.error}`);
    }
    const report = reportFor(entry);
    await writeFile(path.join(dir, "report.md"), report);
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(entry, null, 2));
  }
  if (browser) await browser.close();
  await db.$disconnect();

  const index = [`# import-compare run ${runId}`, "", ...entries.map((e) => `- ${e.source} → ${path.join(e.dir, "report.md")}${e.ingest?.ok ? "" : " · INGEST_FAIL"}${e.original?.blocked ? " · ORIGINAL_BLOCKED" : ""}`), ""].join("\n");
  await writeFile(path.join(runDir, "index.md"), index);
  console.log(`\nRun written to ${runDir}\n${index}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
