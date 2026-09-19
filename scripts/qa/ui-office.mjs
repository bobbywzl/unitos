// UI verification for slides and sheets (SPEC.md §27): the upload paths
// (multipart and chunked), the parse, the pictures made after the response,
// anchoring a note on a slide's words and on a sheet's cell, the reader
// (replicas, pictures over them, marks, the text toolbar, charts, sheet
// drawings, web fonts), and a re-parse that keeps pictures and anchors.
//
// Usage: DATABASE_URL=... node scripts/qa/ui-office.mjs [label]
// Expects the server on :3311 against the same database, with either
// LibreOffice installed (the pictures come from it) or CHROMIUM_PATH set
// (the browser photographs the replicas). Every run uploads fresh bytes
// (the label is stamped into the files), so runs never dedupe into each
// other. Screenshots land in scripts/qa/out/.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";
import { unzipSync, zipSync } from "fflate";
import { writeFileSync } from "node:fs";

// A copy of an Office file with the label written into its core
// properties: new bytes, so dedupe never hands back an earlier run's
// document.
function uniqueCopy(file, label, padBytes = 0) {
  const entries = unzipSync(new Uint8Array(readFileSync(file)));
  // Padding makes a deck bigger than one request may carry, so the chunked
  // path runs; the parser ignores the entry.
  if (padBytes > 0) entries["docProps/pad.bin"] = new Uint8Array(padBytes).map(() => Math.floor(Math.random() * 256));
  const core = new TextDecoder().decode(entries["docProps/core.xml"] ?? new Uint8Array());
  const stamped = core.includes("<dc:title>")
    ? core.replace(/<dc:title>[^<]*<\/dc:title>/, "")
    : core;
  entries["docProps/core.xml"] = new TextEncoder().encode(stamped.replace("</cp:coreProperties>", `<dc:description>${label}</dc:description></cp:coreProperties>`));
  const out = `${file}.${label}.zip`;
  writeFileSync(out, zipSync(entries));
  return out;
}

const BASE = "http://localhost:3311";
import { mkdirSync } from "node:fs";
const FX = "scripts/qa/fixtures/office";
const OUT = "scripts/qa/out";
mkdirSync(OUT, { recursive: true });
const label = process.argv[2] ?? "run";
const db = new PrismaClient();
const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  console.log(results[results.length - 1]);
};

async function readNdjson(res) {
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  const events = lines.map((l) => JSON.parse(l));
  return events[events.length - 1];
}

async function upload(notebookId, file, name) {
  const form = new FormData();
  form.set("file", new Blob([readFileSync(file)]), name);
  form.set("notebookId", notebookId);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/documents`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const last = await readNdjson(res);
  if (!last || !last.id) throw new Error(`${name}: ${JSON.stringify(last)}`);
  console.log(`uploaded ${name} → ${last.id} (${last.title}) in ${Date.now() - t0}ms`);
  return last.id;
}

async function waitFor(fn, ms, step = 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step));
  }
  return null;
}

// ── Notebook and uploads ──────────────────────────────────────────────────
const nbRes = await fetch(`${BASE}/api/notebooks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `Office QA ${label}` }) });
const nb = await nbRes.json();
const section = await db.section.findFirst({ where: { notebookId: nb.id } });
check("notebook created", Boolean(nb.id && section), nb.id);

const deckFile = uniqueCopy(`${FX}/deck.pptx`, label);
const deckId = await upload(nb.id, deckFile, `deck-${label}.pptx`);
const chartsDeckId = await upload(nb.id, `${FX}/charts.pptx`, `charts-${label}.pptx`);
const bookId = await upload(nb.id, `${FX}/book.xlsx`, `book-${label}.xlsx`);
const chartsBookId = await upload(nb.id, `${FX}/charts.xlsx`, `charts-${label}.xlsx`);
const csvId = await upload(nb.id, `${FX}/data.csv`, `data-${label}.csv`);
// Real Google Slides and Sheets exports, when present beside the fixtures
// (not committed: export any Google file from Drive as .pptx/.xlsx).
const { existsSync } = await import("node:fs");
const gslidesId = existsSync(`${FX}/gslides.pptx`) ? await upload(nb.id, uniqueCopy(`${FX}/gslides.pptx`, label), `gslides-${label}.pptx`) : null;
const gsheetsId = existsSync(`${FX}/gsheets.xlsx`) ? await upload(nb.id, uniqueCopy(`${FX}/gsheets.xlsx`, label), `gsheets-${label}.xlsx`) : null;

const deck = await db.document.findUnique({ where: { id: deckId }, include: { blocks: { orderBy: { order: "asc" } } } });
check("deck format + blocks", deck.format === "slides" && deck.blocks.length === 5 && deck.blocks.every((b) => b.type === "SLIDE"), `${deck.format} ${deck.blocks.length}`);
const book = await db.document.findUnique({ where: { id: bookId }, include: { blocks: { orderBy: { order: "asc" } } } });
check("book format + blocks", book.format === "sheets" && book.blocks.filter((b) => b.type === "SHEET").length === 2, `${book.format} ${book.blocks.map((b) => b.type).join(",")}`);
const images = await db.imageAsset.count({ where: { documentId: deckId } });
check("deck pictures claimed as images", images === 1, `${images}`);
const bookImages = await db.imageAsset.count({ where: { documentId: chartsBookId } });
check("sheet drawing picture claimed", bookImages === 1, `${bookImages}`);

// Dedupe: the same bytes again return the same document.
const dedupeId = await upload(nb.id, deckFile, `deck-${label}.pptx`);
check("re-upload dedupes", dedupeId === deckId);

// ── Pictures for the uploaded deck (after the response) ───────────────────
const pictured = await waitFor(async () => {
  const n = await db.pageImage.count({ where: { block: { documentId: deckId }, data: { not: null } } });
  return n === 5 ? n : null;
}, 120_000, 2000);
check("uploaded deck pictures stored", pictured === 5, `${pictured}`);
const marked = await waitFor(async () => {
  const blocks = await db.block.findMany({ where: { documentId: deckId }, select: { html: true } });
  return blocks.every((b) => b.html.includes('data-picture="1"')) ? true : null;
}, 30_000, 1000);
check("slide frames marked data-picture", marked === true);
const slide2 = deck.blocks[1];
const pageRes = await fetch(`${BASE}/api/documents/${deckId}/page/${slide2.id}`);
check("page route serves slide picture", pageRes.status === 200 && pageRes.headers.get("content-type") === "image/jpeg", `${pageRes.status} ${pageRes.headers.get("content-type")}`);
const noPicRes = await fetch(`${BASE}/api/documents/${bookId}/page/${book.blocks[0].id}`);
check("page route refuses a non-slide block", noPicRes.status === 404, `${noPicRes.status}`);

// ── Anchoring: a note on slide 2's words, a note on a sheet cell ───────────
const text = slide2.text;
const start = text.indexOf("Revenue grew 12%");
const quote = "Revenue grew 12% year over year";
const noteRes = await fetch(`${BASE}/api/notes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sectionId: section.id,
    content: "Growth note",
    source: { documentId: deckId, blockId: slide2.id, startOffset: start, endOffset: start + quote.length, quotedText: quote, prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(start + quote.length, start + quote.length + 32) },
  }),
});
const noteJson = noteRes.ok ? await noteRes.json() : null;
check("note anchored on slide text", noteRes.status === 201 && noteJson.sources?.length === 1 && noteJson.sources[0].blockId === slide2.id, `${noteRes.status} ${JSON.stringify(noteJson?.sources ?? (await noteRes.text()))}`);
const sheetBlock = book.blocks.find((b) => b.type === "SHEET");
const cellStart = sheetBlock.text.indexOf("1,350.00");
const cellRes = await fetch(`${BASE}/api/notes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sectionId: section.id,
    content: "Cell note",
    source: { documentId: bookId, blockId: sheetBlock.id, startOffset: cellStart, endOffset: cellStart + 8, quotedText: "1,350.00", prefix: sheetBlock.text.slice(Math.max(0, cellStart - 32), cellStart), suffix: sheetBlock.text.slice(cellStart + 8, cellStart + 40) },
  }),
});
const cellJson = cellRes.ok ? await cellRes.json() : null;
check("note anchored on sheet cell", cellRes.status === 201 && cellJson.sources?.length === 1, `${cellRes.status}`);

// ── The reader ────────────────────────────────────────────────────────────
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && !m.text().includes("ERR_CERT_AUTHORITY_INVALID") && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const failed = [];
page.on("requestfailed", (r) => { const e = r.failure()?.errorText ?? ""; if (!e.includes("ERR_ABORTED") && !e.includes("ERR_CERT")) failed.push(`${r.url()} ${e}`); });
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("fonts.g")) failed.push(`${r.url()} ${r.status()}`); });

await page.goto(`${BASE}/n/${nb.id}?doc=${deckId}`, { waitUntil: "networkidle" });
await page.locator(".reader-slide .slide-frame").first().waitFor({ timeout: 20000 });
check("slide frames render", (await page.locator(".reader-slide .slide-frame").count()) === 5, `${await page.locator(".reader-slide .slide-frame").count()}`);
check("office css injected once", (await page.locator("#unitos-office-css").count()) === 1);
check("web font links injected", (await page.locator('link[href*="fonts.googleapis.com"]').count()) >= 1, `${await page.locator('link[href*="fonts.googleapis.com"]').count()}`);
// Pictures load lazily: every slide scrolled into view first.
for (let i = 0; i < 5; i++) {
  await page.locator(".reader-slide .slide-frame").nth(i).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
}
const picturedFrames = await waitFor(async () => {
  const n = await page.locator(".slide-frame.slide-pictured").count();
  return n >= 5 ? n : null;
}, 30_000, 500);
await page.locator(".reader-slide .slide-frame").first().scrollIntoViewIfNeeded();
check("pictures drawn over replicas", picturedFrames === 5, `${picturedFrames}`);
const markText = await page.locator(".reader-slide mark.anchor-mark").first().textContent().catch(() => null);
check("note mark painted inside the slide", markText === quote, JSON.stringify(markText));
check("speaker notes strip", (await page.locator(".slide-notes-body").count()) === 1);
check("chart table on slide 4", (await page.locator(".reader-slide .scv svg").count()) === 1);
// A selection inside a slide opens the text toolbar.
const word = page.locator(".reader-slide .st span", { hasText: "Churn fell" }).first();
await word.scrollIntoViewIfNeeded();
await word.dblclick();
await page.waitForTimeout(600);
check("selection opens the text toolbar", (await page.locator('[data-track="simplify"]').count()) >= 1);
await page.keyboard.press("Escape");
await page.screenshot({ path: `${OUT}/qa-deck-${label}.png`, fullPage: false });

await page.goto(`${BASE}/n/${nb.id}?doc=${chartsDeckId}`, { waitUntil: "networkidle" });
await page.locator(".reader-slide .slide-frame").first().waitFor({ timeout: 20000 });
check("charts deck: 5 charts drawn", (await page.locator(".reader-slide .scv svg").count()) === 5, `${await page.locator(".reader-slide .scv svg").count()}`);

await page.goto(`${BASE}/n/${nb.id}?doc=${bookId}`, { waitUntil: "networkidle" });
await page.locator(".reader-sheet .sheet").first().waitFor({ timeout: 20000 });
check("sheets render", (await page.locator(".reader-sheet .sheet").count()) === 2, `${await page.locator(".reader-sheet .sheet").count()}`);
const cellMark = await page.locator(".reader-sheet mark.anchor-mark").first().textContent().catch(() => null);
check("note mark painted inside the sheet", cellMark === "1,350.00", JSON.stringify(cellMark));
const sticky = await page.locator(".reader-sheet thead th").first().evaluate((el) => getComputedStyle(el).position);
check("column letters sticky", sticky === "sticky", sticky);
await page.screenshot({ path: `${OUT}/qa-book-${label}.png`, fullPage: false });

await page.goto(`${BASE}/n/${nb.id}?doc=${chartsBookId}`, { waitUntil: "networkidle" });
await page.locator(".reader-sheet .sheet").first().waitFor({ timeout: 20000 });
check("sheet charts drawn", (await page.locator(".reader-sheet .sheet-drawing svg").count()) === 3, `${await page.locator(".reader-sheet .sheet-drawing svg").count()}`);
const drawingImg = page.locator(".reader-sheet .sheet-drawing img").first();
const natural = await drawingImg.evaluate((el) => el.naturalWidth).catch(() => 0);
check("sheet picture loads", natural > 0, `${natural}`);
await page.screenshot({ path: `${OUT}/qa-charts-book-${label}.png`, fullPage: false });

await page.goto(`${BASE}/n/${nb.id}?doc=${csvId}`, { waitUntil: "networkidle" });
check("csv renders as a sheet", (await page.locator(".reader-sheet .sheet").count()) === 1);
if (gslidesId) {
  await page.goto(`${BASE}/n/${nb.id}?doc=${gslidesId}`, { waitUntil: "networkidle" });
  await page.locator(".reader-slide .slide-frame").first().waitFor({ timeout: 20000 });
  check("google slides deck renders", (await page.locator(".reader-slide .slide-frame").count()) >= 1);
  const gsFonts = await page.locator('link[href*="fonts.googleapis.com"]').evaluateAll((els) => els.map((e) => decodeURIComponent(e.href).split("family=")[1].split(":")[0]));
  check("google deck fonts requested", gsFonts.length >= 1, gsFonts.join(", "));
}
if (gsheetsId) {
  await page.goto(`${BASE}/n/${nb.id}?doc=${gsheetsId}`, { waitUntil: "networkidle" });
  check("google sheets renders", (await page.locator(".reader-sheet .sheet").count()) >= 1);
}

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
check("no failed requests", failed.length === 0, failed.slice(0, 3).join(" | "));

// ── Re-parse keeps the pictures ───────────────────────────────────────────
const reRes = await fetch(`${BASE}/api/documents/${deckId}/reparse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const reLast = await readNdjson(reRes);
check("re-parse succeeds", reRes.ok && reLast && reLast.id === deckId, JSON.stringify(reLast));
const afterBlocks = await db.block.findMany({ where: { documentId: deckId, type: "SLIDE" }, select: { id: true, html: true } });
const afterPictures = await db.pageImage.count({ where: { blockId: { in: afterBlocks.map((b) => b.id) }, data: { not: null } } });
check("re-parse carries pictures over", afterPictures === 5 && afterBlocks.every((b) => b.html.includes('data-picture="1"')), `${afterPictures}`);
// Anchors re-resolve when the reader opens the document (SPEC.md §5).
await page.goto(`${BASE}/n/${nb.id}?doc=${deckId}`, { waitUntil: "networkidle" });
await page.locator(".reader-slide .slide-frame").first().waitFor({ timeout: 20000 });
const reMark = await page.locator(".reader-slide mark.anchor-mark").first().textContent().catch(() => null);
check("re-parse re-resolves the note anchor", reMark === quote, JSON.stringify(reMark));
await page.locator(".reader-slide .slide-frame").nth(1).scrollIntoViewIfNeeded();
const rePictured = await waitFor(async () => ((await page.locator(".slide-frame.slide-pictured").count()) >= 1 ? true : null), 20_000, 500);
check("re-parsed slides draw their pictures", rePictured === true);
await page.screenshot({ path: `${OUT}/qa-reparsed-${label}.png` });
await browser.close();
const afterImages = await db.imageAsset.count({ where: { documentId: deckId } });
check("re-parse replaces the deck's images once", afterImages === 1, `${afterImages}`);

console.log("\n" + results.join("\n"));
console.log(`\n${results.filter((r) => r.startsWith("FAIL")).length} failures`);
await db.$disconnect();

// ── Chunked upload: a deck over the single-request size ──────────────────
{
  const bytes = readFileSync(uniqueCopy(`${FX}/deck.pptx`, label, 6 * 1024 * 1024));
  const CHUNK = 2 * 1024 * 1024;
  const uploadId = `qa-${label}-${Date.now()}`.replace(/[^a-zA-Z0-9-]/g, "-");
  let index = 0;
  for (let at = 0; at < bytes.length; at += CHUNK) {
    const res = await fetch(`${BASE}/api/uploads?uploadId=${uploadId}&index=${index++}`, { method: "POST", body: bytes.subarray(at, at + CHUNK) });
    if (!res.ok) throw new Error(`chunk ${index}: ${res.status} ${await res.text()}`);
  }
  const res = await fetch(`${BASE}/api/uploads/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, filename: `big-${label}.pptx`, notebookId: nb.id, kind: "pdf" }) });
  const last = res.ok ? await readNdjson(res) : null;
  check("chunked upload of a deck", Boolean(last?.id), res.ok ? JSON.stringify(last) : `${res.status} ${await res.text()}`);
  if (last?.id) {
    const big = await db.document.findUnique({ where: { id: last.id }, include: { blocks: true } });
    check("chunked deck parsed", big.format === "slides" && big.blocks.length === 5, `${big?.format} ${big?.blocks.length}`);
    const bigPictures = await waitFor(async () => {
      const n = await db.pageImage.count({ where: { block: { documentId: last.id }, data: { not: null } } });
      return n === 5 ? n : null;
    }, 120_000, 2000);
    check("chunked deck pictures stored", bigPictures === 5, `${bigPictures}`);
  }
}
console.log(`\n${results.filter((r) => r.startsWith("FAIL")).length} failures (with chunked upload)`);
await db.$disconnect();
