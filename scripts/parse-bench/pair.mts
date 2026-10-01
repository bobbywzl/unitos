// The visual pair: a PDF page beside the same page of its import in the page
// editor, one PNG per page, for audits and for the owner's screenshots. The
// PDF is added fresh to the running dev server (sign-in off) with the
// Imports switch on, the way the imports walk adds one (scripts/qa/
// ui-imports.mjs). The import's side is the page editor's pages that hold
// the PDF page's words, from its page start ("p. 7" in the margin) to the
// next page's, footnotes at their page's foot. A PDF the add keeps a block
// document (the size guard) has no import to show, and its pair says so.
//
//   npx tsx scripts/parse-bench/pair.mts <corpus id> [--pages 3,5-7] [--out dir] [--keep]
//
// Pages: the entry's scored pages, else 1–3, within the PDF's pages. A PDF
// over 4 MB goes up in chunks, as the upload box sends it. The PNGs go to
// .bench/pairs/<id>/ (never committed: a private document's pages stay in
// the sandbox). --keep keeps the project the tool makes and prints the
// import's link; by default the project is deleted. Env: BASE (default
// http://localhost:3111), CHROME (default /opt/pw-browsers/chromium),
// DATABASE_URL (read from .env when unset).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Browser, type Page } from "playwright-core";
import { loadCorpus, loadRef, refPath, ROOT } from "./load";

const BASE = process.env.BASE ?? "http://localhost:3111";
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium";
/** The page editor draws a page at 96 px to the inch, and pdftoppm at 96 dpi
    draws the PDF page at the same size; both at 1.5 device pixels per px,
    so equations and small type stay legible. */
const DPR = 1.5;
/** Room above and below a pageless import's words, in px. */
const MARGIN = 12;

const argv = process.argv.slice(2);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const id = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "";
if (!id) {
  console.log("Usage: npx tsx scripts/parse-bench/pair.mts <corpus id> [--pages 3,5-7] [--out dir] [--keep]");
  process.exit(1);
}
const keep = argv.includes("--keep");
if (!process.env.DATABASE_URL && existsSync(join(ROOT, ".env"))) {
  const m = /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync(join(ROOT, ".env"), "utf8"));
  if (m) process.env.DATABASE_URL = m[1];
}

/** "3,5-7" → [3, 5, 6, 7]. */
function pageList(text: string): number[] {
  return text.split(",").flatMap((part) => {
    const [a, b] = part.split("-").map(Number);
    return Array.from({ length: (b || a) - a + 1 }, (_, k) => a + k);
  });
}

async function api(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, body: { text } };
  }
}

/** The upload box's limits (components/reader/upload-assistant.tsx): a PDF
    over one request's size goes up in chunks, then /api/uploads/complete
    assembles and adds it (the dev server refuses a body over 10 MB). */
const SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;
const CHUNK_BYTES = 3_500_000;

/** Add a PDF to a project, as the upload box does: the route answers
    NDJSON progress lines, then the result line (SPEC.md §15). */
async function add(notebookId: string, bytes: Buffer, name: string): Promise<string> {
  let res: Response;
  if (bytes.length > SINGLE_REQUEST_BYTES) {
    const uploadId = crypto.randomUUID();
    for (let sent = 0; sent < bytes.length; sent += CHUNK_BYTES) {
      const chunk = await fetch(`${BASE}/api/uploads?uploadId=${uploadId}&index=${sent / CHUNK_BYTES}`, {
        method: "POST",
        body: new Uint8Array(bytes.subarray(sent, sent + CHUNK_BYTES)),
      });
      if (!chunk.ok) throw new Error(`the upload failed: HTTP ${chunk.status} ${await chunk.text()}`);
    }
    res = await fetch(`${BASE}/api/uploads/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, filename: name, notebookId, kind: "pdf" }),
    });
  } else {
    const form = new FormData();
    form.set("notebookId", notebookId);
    form.set("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
    res = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  }
  const lines = (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { id?: string; error?: string };
      } catch {
        return {};
      }
    });
  const result = lines.findLast((l) => l.id || l.error);
  if (!result?.id) throw new Error(`the add failed: ${result?.error ?? `HTTP ${res.status}`}`);
  return result.id;
}

/** The page editor's pages that hold the PDF page's words, from the one its
    page start stands on to the one the next page's start follows, as a PNG
    (footnotes sit at a page's foot); null when no page start names the
    page. A pageless import shows the words between the two starts. */
async function importPicture(page: Page, n: number): Promise<Buffer | null> {
  const measure = () =>
    page.evaluate(
      ({ n, margin }) => {
        const prose = document.querySelector(".docs-prose");
        if (!prose) return null;
        const starts = [...prose.querySelectorAll<HTMLElement>("[data-page-start]")]
          .map((el) => ({ el, page: Number(el.dataset.pageStart) }))
          .filter((s) => s.page > 0);
        const here = starts.find((s) => s.page === n);
        if (!here) return null;
        const next = starts.filter((s) => s.page > n).sort((a, b) => a.page - b.page)[0];
        const from = here.el.getBoundingClientRect().top;
        // The page's last words: the blocks that begin before the next page's
        // start, up to it (a paragraph the page break cuts runs on past it).
        // A next page that opens a sheet leaves that sheet out; the empty
        // spacers that push a block onto the next sheet do not count.
        const limit = next ? next.el.getBoundingClientRect().top : prose.getBoundingClientRect().bottom;
        const opens = (el: Element) => {
          if (!next || !el.contains(next.el)) return false;
          const range = document.createRange();
          range.setStart(el, 0);
          range.setEndBefore(next.el);
          return range.toString().trim() === "";
        };
        const before = [...prose.children]
          .filter((el) => ((el.textContent ?? "").trim() !== "" || el.querySelector("img, svg, canvas, table, .katex") !== null) && !opens(el))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.height > 0 && r.top < limit - 1);
        const to = Math.max(from, Math.min(limit - 1, before.length > 0 ? Math.max(...before.map((r) => r.bottom)) : limit - 1));
        const sheets = [...document.querySelectorAll(".docs-sheet")].map((el) => el.getBoundingClientRect());
        const sheetAt = (y: number) => sheets.filter((r) => r.top <= y).at(-1) ?? null;
        const a = sheetAt(from);
        const b = sheetAt(to);
        if (a && b) return { x: a.left, width: a.width, top: a.top, bottom: b.bottom };
        const text = (prose.closest(".docs-page") ?? prose).getBoundingClientRect();
        return { x: text.left, width: text.width, top: from - margin, bottom: to + margin };
      },
      { n, margin: MARGIN },
    );
  const first = await measure();
  if (!first) return null;
  // A viewport the pages fit in, the first page scrolled to its top.
  await page.setViewportSize({ width: 1440, height: Math.min(16_000, Math.max(900, Math.ceil(first.bottom - first.top) + 200)) });
  await page.evaluate((n) => {
    const el = document.querySelector<HTMLElement>(`.docs-prose [data-page-start="${n}"]`);
    const y = el?.getBoundingClientRect().top ?? 0;
    const sheet = [...document.querySelectorAll<HTMLElement>(".docs-sheet")].filter((s) => s.getBoundingClientRect().top <= y).at(-1);
    (sheet ?? el)?.scrollIntoView({ block: "start" });
  }, n);
  const around = await measure();
  const missing = around ? await settle(page, around) : [];
  if (missing.length > 0) console.log(`page ${n}: ${missing.length} figure image${missing.length === 1 ? "" : "s"} did not load (${missing.join("; ")}); the picture shows the caption in its place`);
  const box = await measure();
  if (!box) return null;
  const clip = { x: box.x, y: Math.max(0, box.top), width: box.width, height: Math.max(1, Math.ceil(box.bottom - Math.max(0, box.top))) };
  // The header and the rulers stay put over the pages as they scroll: they
  // leave the picture.
  await page.evaluate((clip) => {
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (el.closest(".docs-prose")) continue;
      const position = getComputedStyle(el).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > clip.y && r.top < clip.y + clip.height && r.right > clip.x && r.left < clip.x + clip.width) el.style.visibility = "hidden";
    }
  }, clip);
  return page.screenshot({ clip });
}

/** Fonts loaded, the images in view loaded (a figure's crop is drawn by the
    figure route when first asked for, slowly on a busy machine), two frames
    drawn. Returns the figures of the paired page (between the box's top and
    bottom) whose image did not load, each named by its media id and its
    caption's first words: the tall viewport holds other pages' images too.
    No box: no figure is named. */
async function settle(page: Page, box: { top: number; bottom: number } | null = null): Promise<string[]> {
  return page.evaluate(async (box) => {
    await document.fonts.ready;
    const images = [...document.images].filter((img) => {
      const r = img.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    });
    for (const img of images) img.loading = "eager";
    const loaded = (img: HTMLImageElement) =>
      new Promise((done) => {
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    await Promise.race([Promise.all(images.filter((img) => !img.complete).map(loaded)), new Promise((done) => setTimeout(done, 90_000))]);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    if (!box) return [];
    return [...document.querySelectorAll<HTMLElement>(".docs-prose [data-docs-figure]")]
      .filter((figure) => {
        const r = figure.getBoundingClientRect();
        const img = figure.querySelector("img");
        return r.bottom > box.top && r.top < box.bottom && (!img || !img.complete || img.naturalWidth === 0) && figure.querySelector(".docs-figure-crop") !== null;
      })
      .map((figure) => `${figure.dataset.mediaId ?? "?"} "${(figure.querySelector(".docs-figure-caption")?.textContent ?? "").trim().slice(0, 40)}"`);
  }, box);
}

/** A step run again once the page editor stands again, when the page
    navigated under it: a dev server reloads while other sessions edit
    files, and a long run stopped partway with "Execution context was
    destroyed". */
async function steady<T>(page: Page, step: () => Promise<T>, ready: () => Promise<void>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await step();
    } catch (err) {
      const lost = err instanceof Error && /Execution context was destroyed|navigation|Target page, context or browser has been closed/i.test(err.message);
      if (!lost || attempt >= 3) throw err;
      console.log(`the page navigated (${err.message.split("\n")[0]}): measuring again`);
      await page.waitForLoadState("domcontentloaded");
      await ready();
    }
  }
}

/** The PDF page and the import's page side by side, as one PNG. */
async function composePair(browser: Browser, pdfPng: Buffer, importPng: Buffer | null, title: string, note: string): Promise<Buffer> {
  const context = await browser.newContext({ deviceScaleFactor: DPR, viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  const img = (png: Buffer) => `<img src="data:image/png;base64,${png.toString("base64")}" style="display:block;width:calc(var(--w) * 1px);box-shadow:0 1px 3px #0003">`;
  const side = (label: string, png: Buffer | null, width: number) =>
    `<figure style="margin:0;--w:${width}"><figcaption style="margin:0 0 8px">${label}</figcaption>${png ? img(png) : `<div style="width:${width}px;padding:24px;background:#fff">${note}</div>`}</figure>`;
  const widthOf = (png: Buffer) => png.readUInt32BE(16) / DPR;
  await page.setContent(
    `<body style="margin:0;background:#e8eaed;font:15px/1.4 system-ui,sans-serif;color:#202124"><div id="pair" style="display:inline-flex;gap:24px;padding:16px;align-items:flex-start">${side(
      `${title} · the PDF`,
      pdfPng,
      widthOf(pdfPng),
    )}${side(`${title} · the import in the page editor`, importPng, importPng ? widthOf(importPng) : widthOf(pdfPng))}</div></body>`,
  );
  const out = await page.locator("#pair").screenshot();
  await context.close();
  return out;
}

async function main() {
  const { entries } = loadCorpus();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`${id} is not in the corpus (corpus.json, .bench/corpus-private.json)`);
  const found = refPath(entry.id);
  const loaded = found ? loadRef(found) : null;
  const ref = loaded && "ref" in loaded ? loaded.ref : undefined;
  const file = entry.pdf ?? ref?.source.pdf;
  if (!file || !existsSync(join(ROOT, file))) throw new Error(`${id}: no PDF (${file ?? "none named"})`);
  const scored = ref?.pages ?? entry.pages;
  const count = Number(/^Pages:\s+(\d+)/m.exec(execFileSync("pdfinfo", [join(ROOT, file)], { encoding: "utf8" }))?.[1] ?? 0);
  const asked = value("--pages") ? pageList(value("--pages")!) : scored ? pageList(`${scored[0]}-${scored[1]}`) : [1, 2, 3];
  const pages = asked.filter((n) => n >= 1 && n <= count);
  if (pages.length < asked.length) console.log(`${id}: the PDF has ${count} page${count === 1 ? "" : "s"}; pages past it are left out`);
  const out = value("--out") ?? join(ROOT, ".bench", "pairs", id);
  mkdirSync(out, { recursive: true });

  const db = new PrismaClient();
  const browser = await chromium.launch({ executablePath: CHROME });
  const scratch = mkdtempSync(join(tmpdir(), "pair-"));
  let notebookId: string | null = null;
  try {
    // A fresh file hash, so the add parses with today's parser instead of
    // handing back an earlier import of the same bytes.
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
    const bytes = Buffer.concat([readFileSync(join(ROOT, file)), Buffer.from(`\n% unitos pair ${stamp}\n`)]);
    const project = await api("/api/notebooks", "POST", { title: `Parse pairs ${id} ${stamp}` });
    notebookId = typeof project.body.id === "string" ? project.body.id : null;
    if (!notebookId) throw new Error(`the project: HTTP ${project.status}`);
    // The switch is read at the add only: on for the add, then as it was.
    const was = await db.appSetting.findUnique({ where: { key: "imports" } });
    await db.appSetting.upsert({ where: { key: "imports" }, create: { key: "imports", value: "on" }, update: { value: "on" } });
    let documentId: string;
    try {
      documentId = await add(notebookId, bytes, `${id}.pdf`);
    } finally {
      if (was) await db.appSetting.update({ where: { key: "imports" }, data: { value: was.value } });
      else await db.appSetting.deleteMany({ where: { key: "imports" } });
    }
    const row = await db.document.findUnique({ where: { id: documentId }, select: { importRev: true } });
    const isImport = typeof row?.importRev === "number";
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, colorScheme: "light" });
    // tsx names the functions this script hands the page with a helper the page lacks.
    await context.addInitScript({ content: "window.__name = (f) => f;" });
    context.setDefaultNavigationTimeout(120_000);
    context.setDefaultTimeout(120_000);
    const page = await context.newPage();
    const link = `${BASE}/n/${notebookId}?doc=${documentId}`;
    await page.goto(link, { waitUntil: "domcontentloaded" });
    const ready = async () => {
      if (isImport) {
        await page.waitForFunction(() => (document.querySelector(".docs-prose")?.textContent ?? "").trim().length > 0);
        await page.waitForFunction(() => Boolean((window as unknown as { __docsEditor?: unknown }).__docsEditor));
      } else {
        await page.waitForSelector("article.reader-prose [data-block-id]");
      }
      await settle(page);
    };
    await steady(page, ready, ready);
    for (const n of pages) {
      const pdfPng = join(scratch, `pdf-${n}`);
      execFileSync("pdftoppm", ["-f", String(n), "-l", String(n), "-r", String(96 * DPR), "-png", "-singlefile", join(ROOT, file), pdfPng]);
      const shot = isImport ? await steady(page, () => importPicture(page, n), ready) : null;
      const note = isImport ? `No page start names page ${n}.` : "The add kept a block document (the size guard): no import to show.";
      const png = await composePair(browser, readFileSync(`${pdfPng}.png`), shot, `${id}, page ${n}`, note);
      const path = join(out, `${id}-p${n}.png`);
      writeFileSync(path, png);
      console.log(`${path}${shot ? "" : ` (${note})`}`);
    }
    await context.close();
    if (keep) console.log(`The import: ${link}`);
  } finally {
    await browser.close();
    rmSync(scratch, { recursive: true, force: true });
    if (notebookId && !keep) await api(`/api/notebooks/${notebookId}`, "DELETE").catch(() => null);
    await db.$disconnect();
  }
}

await main();
