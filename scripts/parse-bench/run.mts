// The parse benchmark (scratchpad parse-loop README): every corpus document
// parsed in-process the way the add parses it (parsePdf, or parseDocx for a
// Word file, then the import converter), scored against its reference (parse
// and import), and checked without one (pdftotext; a Word file against the
// PDF of its name beside it, LibreOffice's rendering; a PDF set in TeX's
// math fonts against its own glyphs, glyphs.ts). Nothing is stored but what
// the flags ask for.
//
//   npx tsx scripts/parse-bench/run.mts [--quick] [--sweep] [--only id,id] [--category c] [--json out.json]
//     [--baseline [file[,file]]] [--save-baseline [file]] [--detail id [--import]]
//
// The corpus is corpus.json and the owner's entries in
// .bench/corpus-private.json when it exists (load.ts). --quick runs the
// entries marked quick: one document for each kind of fault, the fast ones.
// --sweep adds the entries marked sweep: whole documents read without a
// reference, every page (--only and --detail run them by name). The last
// line gives the run's time by stage.
//
// Baselines: scripts/parse-bench/baseline.json holds the documents whose
// reference is committed, and the open and public-domain documents read
// without one; .bench/baseline-private.json holds the rest. With
// no file named, --baseline reads both and --save-baseline writes each
// document into its own (merged with what the file holds). The exit code is
// 1 when a metric dropped against the baseline.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { richTextFromImport } from "@/lib/docs/import";
import type { RichNode } from "@/lib/docs/schema";
import { parsePdf } from "@/lib/parse/pdf";
import type { ParsedBlock, ParsedDocument } from "@/lib/parse/types";
import { resolveContentsLinks } from "@/lib/parse/url";
import { fromImport, fromParse, printedNotes, type Doc } from "./adapt";
import { forgetText, freeScores, pdfText, type FreeScores, type PdfText } from "./free";
import { forgetGlyphs, glyphScores, pdfGlyphs, placeEquations, type GlyphScores } from "./glyphs";
import { loadCorpus, loadRef, refPath, REF_DIRS, ROOT, type CorpusEntry } from "./load";
import { flatten, score, type Scores } from "./metrics";
import type { RefDoc } from "./model";
import { detailReport } from "./report";

// ── Flags ───────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const category = value("--category");
const detail = value("--detail");
const BASELINE_PUBLIC = join(import.meta.dirname, "baseline.json");
const BASELINE_PRIVATE = join(ROOT, ".bench", "baseline-private.json");

// ── Parsing, once per file ──────────────────────────────────────────────────

/** The page's look the parse keeps: the body's font, the title's font and alignment. */
type Look = Pick<ParsedDocument, "bodyFont" | "titleFont" | "titleAlign">;
/** The size guard (lib/parse/ingest.ts IMPORT_MAX_ROWS, IMPORT_MAX_JSON_BYTES): past either, the add keeps a
    block document, and the page editor never shows the import. */
const GUARD = { rows: 1_500, json: 1_500_000 };
type Parsed = {
  title: string | null;
  blocks: ParsedBlock[];
  richText: RichNode | null;
  importError?: string;
  /** The import's rows and bytes when the size guard keeps it a block document. */
  guarded?: { rows: number; json: number };
  ms: number;
} & Look;
const parses = new Map<string, Promise<Parsed>>();

/** The run's time by stage, in ms: each file's parse and conversion once,
    each document's scoring. */
const STAGES = { parse: 0, import: 0, reference: 0, free: 0, glyphs: 0 };
const since = (stage: keyof typeof STAGES, t0: number) => {
  STAGES[stage] += performance.now() - t0;
  return performance.now();
};

/** pdf.js prints font warnings (console.warn "Warning: …"); they are not
    the run's output. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^(Warning|Info):/.test(args[0])) return;
    warn(...args);
  };
  try {
    return await work();
  } finally {
    console.warn = warn;
  }
}

/** A Word file as the Word add parses it (lib/parse/ingest.ts ingestDocx):
    its title only when the file's own words give it; no picture stored. */
async function parseWord(bytes: Uint8Array, path: string): Promise<{ title: string | null; blocks: ParsedBlock[]; pageSize?: undefined } & Look> {
  // Loaded when a Word file comes up, so the runner also runs on a tree without the Word parser.
  const { parseDocx } = await import("@/lib/parse/docx");
  const parsed = await parseDocx(bytes, basename(path), { storeImage: async () => "/api/images/bench" });
  return { title: parsed.titleFromFile ? null : parsed.title, blocks: parsed.blocks };
}

function parseFile(path: string): Promise<Parsed> {
  let hit = parses.get(path);
  if (!hit) {
    hit = quietly(async () => {
      const t0 = performance.now();
      const word = /\.docx$/i.test(path);
      const bytes = new Uint8Array(readFileSync(path));
      const parsed = word ? await parseWord(bytes, path) : await parsePdf(bytes);
      const ms = performance.now() - t0;
      STAGES.parse += ms;
      const t1 = performance.now();
      // The add's converter call (lib/parse/ingest.ts ingestPdf, ingestDocx,
      // convertImport). A converter that throws costs the import's score,
      // not the parse's.
      const look: Look = { bodyFont: parsed.bodyFont, titleFont: parsed.titleFont, titleAlign: parsed.titleAlign };
      try {
        const { richText, size } = richTextFromImport({
          kind: word ? "docx" : "pdf",
          title: parsed.title ?? basename(path).replace(/\.(pdf|docx)$/i, ""),
          titleFromOriginal: Boolean(parsed.title),
          blocks: resolveContentsLinks(parsed.blocks),
          pageSize: parsed.pageSize,
          ...look,
        });
        since("import", t1);
        const guarded = size.rows > GUARD.rows || size.json > GUARD.json ? { rows: size.rows, json: size.json } : undefined;
        return { title: parsed.title, blocks: parsed.blocks, richText, ms, ...look, ...(guarded ? { guarded } : {}) };
      } catch (err) {
        since("import", t1);
        return { title: parsed.title, blocks: parsed.blocks, richText: null, importError: err instanceof Error ? err.message : String(err), ms, ...look };
      }
    });
    parses.set(path, hit);
  }
  return hit;
}

const texts = new Map<string, PdfText>();
function pdfTextOf(path: string, pages: [number, number] | undefined): PdfText {
  const key = `${path}|${pages?.join("-") ?? ""}`;
  let hit = texts.get(key);
  if (!hit) texts.set(key, (hit = pdfText(path, pages)));
  return hit;
}

// ── One document ────────────────────────────────────────────────────────────

type Result = {
  entry: CorpusEntry;
  skipped?: string;
  refProblems?: string[];
  /** Where the corpus entry and its reference disagree. */
  mismatch?: string;
  importError?: string;
  guarded?: { rows: number; json: number };
  ref?: RefDoc;
  committed: boolean;
  pages?: [number, number];
  ms: number;
  parse?: Scores;
  import?: Scores;
  freeParse?: FreeScores;
  freeImport?: FreeScores;
  /** The glyph checks, for a PDF set in TeX's math fonts. */
  glyphs?: { parse: GlyphScores; import?: GlyphScores };
  docs?: { parse: Doc; import: Doc };
  pdf?: PdfText;
};

async function runEntry(entry: CorpusEntry): Promise<Result> {
  const refId = entry.ref ?? entry.id;
  const found = refPath(refId);
  const loaded = found ? loadRef(found) : null;
  const ref = loaded && "ref" in loaded ? loaded.ref : undefined;
  const result: Result = {
    entry,
    committed: found ? Boolean(ref && found.startsWith(REF_DIRS[0])) : entry.license === "open" || entry.license === "public-domain",
    ms: 0,
    ref,
    refProblems: loaded && "problems" in loaded ? loaded.problems : undefined,
  };
  const differ = [
    ref && ref.id !== refId ? `the reference's id is ${ref.id}` : "",
    ref?.pages && entry.pages && ref.pages.join() !== entry.pages.join() ? `pages ${entry.pages.join("–")} in the corpus, ${ref.pages.join("–")} in the reference (the reference's are scored)` : "",
    ref?.source.pdf && entry.pdf && ref.source.pdf !== entry.pdf ? `the corpus names ${entry.pdf}, the reference ${ref.source.pdf}` : "",
  ].filter(Boolean);
  if (differ.length > 0) result.mismatch = differ.join("; ");
  const file = entry.pdf ?? entry.docx ?? ref?.source.pdf;
  if (!file) return { ...result, skipped: "no file named" };
  const path = join(ROOT, file);
  if (!existsSync(path)) return { ...result, skipped: `${file} is missing` };
  const pages = ref?.pages ?? entry.pages;
  result.pages = pages;
  const parsed = await parseFile(path);
  result.ms = parsed.ms;
  result.importError = parsed.importError;
  result.guarded = parsed.guarded;
  let t0 = performance.now();
  const docs = { parse: fromParse(parsed, pages), import: parsed.richText ? fromImport(parsed.richText, pages, ref ? printedNotes(ref.blocks) : undefined) : { blocks: [] } };
  result.docs = docs;
  if (ref) {
    const reference: Doc = { blocks: ref.blocks, fonts: ref.fonts };
    result.parse = score(reference, ref.furniture, docs.parse).scores;
    if (parsed.richText) result.import = score(reference, ref.furniture, docs.import).scores;
  }
  t0 = since("reference", t0);
  // A Word file is checked against its PDF rendering beside it, when there is one.
  const pdfPath = path.replace(/\.docx$/i, ".pdf");
  if (!existsSync(pdfPath)) return result;
  result.pdf = pdfTextOf(pdfPath, pages);
  const glyphs = /\.pdf$/i.test(file) ? await quietly(() => pdfGlyphs(pdfPath)) : null;
  if (glyphs) {
    if (parsed.richText) placeEquations(docs.parse, docs.import);
    result.glyphs = { parse: glyphScores(glyphs, docs.parse, pages), import: parsed.richText ? glyphScores(glyphs, docs.import, pages) : undefined };
  }
  t0 = since("glyphs", t0);
  const word = /\.docx$/i.test(file);
  result.freeParse = freeScores(result.pdf, flatten(docs.parse), result.glyphs?.parse, word);
  if (parsed.richText) result.freeImport = freeScores(result.pdf, flatten(docs.import), result.glyphs?.import, word);
  since("free", t0);
  return result;
}

// ── Numbers for the table, the JSON, and the baselines ──────────────────────

/** Metrics where a smaller number is better. */
const LOWER_IS_BETTER = new Set(["furnitureLeaks", "splits", "merges", "tableOutside", "tableInside", "mathImages", "plainDisplay", "plainInline", "garbles", "numberLines", "notesExtra", "codeGarbles"]);

function numbers(s: Scores): Record<string, number | null> {
  return {
    composite: s.composite,
    text: s.words.f1,
    recall: s.words.recall,
    precision: s.words.precision,
    order: s.order,
    furniture: s.furniture.clean,
    furnitureLeaks: s.furniture.leaks,
    blocks: s.blocks.f1,
    paragraphs: s.blocks.paragraphs,
    splits: s.blocks.splits.reduce((n, x) => n + x.pieces.length - 1, 0),
    merges: s.blocks.merges.reduce((n, x) => n + x.parts.length - 1, 0),
    headings: s.parts.headings,
    headingRecall: s.headings.recall,
    headingPrecision: s.headings.precision,
    listItems: s.lists.recall,
    listDepth: s.lists.depth,
    listMarkers: s.lists.markers,
    tables: s.tables.f1,
    tableOutside: s.tables.outside,
    tableInside: s.tables.inside,
    math: s.math.score,
    displayMath: s.math.display,
    inlineMath: s.math.inline,
    mathLabels: s.math.labels.score,
    mathImages: s.math.images,
    plainDisplay: s.math.plainDisplay,
    plainInline: s.math.plainInline,
    garbles: s.garbles.excess,
    bold: s.styles.bold,
    italic: s.styles.italic,
    styles: s.styles.score,
    notes: s.notes?.score ?? null,
    notesFound: s.notes ? s.notes.found / s.notes.ref : null,
    notesLinked: s.notes && s.notes.linkable > 0 ? s.notes.linked / s.notes.linkable : null,
    notesWords: s.notes?.words ?? null,
    notesExtra: s.notes?.extra ?? null,
    underline: s.styles.f1.underline,
    strike: s.styles.f1.strike,
    smallCaps: s.styles.f1.smallCaps,
    sub: s.styles.f1.sub,
    sup: s.styles.f1.sup,
    color: s.styles.f1.color,
    highlight: s.styles.f1.highlight,
    roles: s.roles.score,
    align: s.roles.align,
    indent: s.roles.indent,
    captions: s.roles.captions,
    checks: s.roles.checks,
    separators: s.roles.separators,
    quotes: s.roles.quotes,
    fonts: s.fonts?.score ?? null,
    fontShape: s.fonts?.shape ?? null,
    fontSize: s.fonts?.size ?? null,
    fontBold: s.fonts?.bold ?? null,
    fontColor: s.fonts?.color ?? null,
  };
}

function freeNumbers(f: FreeScores): Record<string, number | null> {
  return {
    composite: f.composite,
    coverage: f.coverage.f1,
    coverageRecall: f.coverage.recall,
    coveragePrecision: f.coverage.precision,
    furniture: f.furniture.clean,
    furnitureLeaks: f.furniture.leaks,
    math: f.math,
    numberLines: f.numberLines.count,
    garbles: f.garbles.count,
  };
}

/** The glyph checks (glyphs.ts): math symbols lost or misread, equations shown as pictures, display equations checked. */
function glyphNumbers(g: GlyphScores | undefined): Record<string, number | null> {
  if (!g) return {};
  return {
    codeGarbles: g.garbles,
    mathHazards: g.hazards,
    mathImages: g.mathImages,
    mathChecked: g.checked,
    mathPassed: g.passed,
    mathCheck: g.checked > 0 ? g.passed / g.checked : null,
  };
}

const round = (x: number) => Math.round(x * 10_000) / 10_000;

function baselineOf(r: Result): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (mode: string, map: Record<string, number | null>) => {
    for (const [k, v] of Object.entries(map)) if (v !== null && Number.isFinite(v)) out[`${mode}.${k}`] = round(v);
  };
  if (r.parse) put("parse", numbers(r.parse));
  if (r.import) put("import", numbers(r.import));
  if (r.freeParse) put("free.parse", { ...freeNumbers(r.freeParse), ...glyphNumbers(r.glyphs?.parse) });
  if (r.freeImport) put("free.import", { ...freeNumbers(r.freeImport), ...glyphNumbers(r.glyphs?.import) });
  return out;
}

type BaselineFile = Record<string, Record<string, number>>;

function readBaseline(path: string): BaselineFile {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as BaselineFile) : {};
}

function writeBaseline(path: string, docs: BaselineFile) {
  const merged = { ...readBaseline(path), ...docs };
  const sorted: BaselineFile = {};
  for (const id of Object.keys(merged).sort()) sorted[id] = merged[id];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

// ── The table ───────────────────────────────────────────────────────────────

const fmt = (x: number | null | undefined, digits = 2) => (x === null || x === undefined ? "—" : x.toFixed(digits));
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function printTable(results: Result[]) {
  const scored = results.filter((r) => r.parse);
  const idWidth = Math.max(10, ...results.map((r) => r.entry.id.length)) + 1;
  if (scored.length > 0) {
    console.log("\nWith a reference — composite for the parse and the import, then the parse's metrics (0–1; counts where noted):");
    const head = ["parse", "import", "text", "order", "furn", "blocks", "para", "head", "lists", "tables", "math", "img#", "garb#", "style", "notes", "roles", "fonts", "ms"];
    console.log(pad("id", idWidth) + pad("category", 11) + head.map((h) => lpad(h, 7)).join(""));
    for (const r of scored) {
      const s = r.parse as Scores;
      const cells = [
        fmt(s.composite, 1),
        fmt(r.import?.composite, 1),
        fmt(s.words.f1),
        fmt(s.order),
        fmt(s.furniture.clean),
        fmt(s.blocks.f1),
        fmt(s.blocks.paragraphs),
        fmt(s.parts.headings),
        fmt(s.lists.score),
        fmt(s.tables.f1),
        fmt(s.math.score),
        String(s.math.images),
        String(s.garbles.excess),
        fmt(s.styles.score),
        fmt(s.parts.footnotes),
        fmt(s.parts.roles),
        fmt(s.parts.fonts),
        String(Math.round(r.ms)),
      ];
      console.log(pad(r.entry.id, idWidth) + pad(r.entry.category, 11) + cells.map((c) => lpad(c, 7)).join(""));
    }
  }
  const free = results.filter((r) => r.freeParse);
  if (free.length > 0) {
    console.log("\nReference-free — composite for the parse and the import, then the parse's checks:");
    const head = ["parse", "import", "cover", "recall", "prec", "furn", "leaks#", "num#", "garb#", "code#", "mimg#", "check", "math", "ms"];
    console.log(pad("id", idWidth) + pad("category", 11) + head.map((h) => lpad(h, 8)).join(""));
    for (const r of free) {
      const f = r.freeParse as FreeScores;
      const cells = [
        fmt(f.composite, 1),
        fmt(r.freeImport?.composite, 1),
        fmt(f.coverage.f1),
        fmt(f.coverage.recall),
        fmt(f.coverage.precision),
        fmt(f.furniture.clean),
        String(f.furniture.leaks),
        String(f.numberLines.count),
        String(f.garbles.count),
        r.glyphs ? String(r.glyphs.parse.garbles) : "—",
        r.glyphs ? String(r.glyphs.parse.mathImages) : "—",
        r.glyphs?.parse.checked ? `${r.glyphs.parse.passed}/${r.glyphs.parse.checked}` : "—",
        fmt(f.math),
        String(Math.round(r.ms)),
      ];
      console.log(pad(r.entry.id, idWidth) + pad(r.entry.category, 11) + cells.map((c) => lpad(c, 8)).join(""));
    }
  }
  const categories = new Map<string, { parse: number[]; import: number[]; free: number[] }>();
  for (const r of results) {
    const c = categories.get(r.entry.category) ?? { parse: [], import: [], free: [] };
    if (r.parse) c.parse.push(r.parse.composite);
    if (r.import) c.import.push(r.import.composite);
    if (r.freeParse) c.free.push(r.freeParse.composite);
    categories.set(r.entry.category, c);
  }
  const mean = (list: number[]) => (list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : null);
  console.log("\nBy category — mean composite (documents):");
  for (const [name, c] of [...categories].sort()) {
    console.log(
      `  ${pad(name, 11)} parse ${lpad(fmt(mean(c.parse), 1), 5)}  import ${lpad(fmt(mean(c.import), 1), 5)}  (${c.parse.length} with a reference)   reference-free ${lpad(fmt(mean(c.free), 1), 5)} (${c.free.length})`,
    );
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

const t0 = performance.now();
const { entries, problems, withPrivate } = loadCorpus();
for (const p of problems) console.log(`corpus: ${p}`);
if (!withPrivate) console.log("No .bench/corpus-private.json: the public corpus only.");
const picked = entries.filter(
  (e) =>
    (!only || only.includes(e.id)) &&
    (!category || e.category === category) &&
    (!detail || e.id === detail) &&
    (!flag("--quick") || e.quick) &&
    (!e.sweep || flag("--sweep") || only?.includes(e.id) || detail === e.id),
);
if (picked.length === 0) {
  console.log("No corpus document matches.");
  process.exit(1);
}
// A file's parse, text, and glyphs stay while an entry still to run names
// the file, and a document's own views only for --detail: kept for every
// document, a whole run peaks near 2 GB.
const pending = new Map<string, number>();
for (const e of picked) {
  const file = e.pdf ?? e.docx;
  if (file) pending.set(file, (pending.get(file) ?? 0) + 1);
}
function release(file: string) {
  for (const path of [join(ROOT, file), join(ROOT, file).replace(/\.docx$/i, ".pdf")]) {
    parses.delete(path);
    for (const key of [...texts.keys()]) if (key.startsWith(`${path}|`)) texts.delete(key);
    forgetText(path);
    forgetGlyphs(path);
  }
}
const results: Result[] = [];
for (const entry of picked) {
  try {
    results.push(await runEntry(entry));
  } catch (err) {
    results.push({ entry, committed: false, ms: 0, skipped: `failed: ${err instanceof Error ? err.message : String(err)}` });
  }
  const file = entry.pdf ?? entry.docx;
  if (file) {
    pending.set(file, (pending.get(file) ?? 1) - 1);
    if (pending.get(file) === 0) release(file);
  }
  if (!detail) {
    const last = results[results.length - 1];
    delete last.docs;
    delete last.pdf;
  }
}

for (const r of results) {
  if (r.refProblems) console.log(`${r.entry.id}: the reference does not load, scored without it — ${r.refProblems.join("; ")}`);
  if (r.mismatch) console.log(`${r.entry.id}: ${r.mismatch}`);
  if (r.importError) console.log(`${r.entry.id}: the import converter failed, the import is not scored — ${r.importError}`);
  if (r.guarded) {
    console.log(
      `${r.entry.id}: the size guard keeps it a block document (${r.guarded.rows.toLocaleString("en")} rows, ${Math.round(r.guarded.json / 1000).toLocaleString("en")} kB): the page editor never shows this import; its import scores are the converter's`,
    );
  }
  if (r.skipped) console.log(`${r.entry.id}: skipped — ${r.skipped}`);
}
// An entry's own reference or the one it names; without the private list,
// the owner's references in .bench/refs have no entry to name them.
const listed = new Set(entries.flatMap((e) => [e.id, ...(e.ref ? [e.ref] : [])]));
const orphans = (withPrivate ? REF_DIRS : REF_DIRS.slice(0, 1)).flatMap((dir) => (existsSync(dir) ? readdirJson(dir) : [])).filter((id) => !listed.has(id));
if (orphans.length > 0) console.log(`References with no corpus entry: ${orphans.join(", ")}`);

if (detail) {
  const r = results[0];
  if (r?.docs) detailReport(r, flag("--import") ? "import" : "parse");
} else {
  printTable(results);
}

const json = value("--json");
if (json) {
  const out = results.map((r) => ({
    id: r.entry.id,
    category: r.entry.category,
    skipped: r.skipped ?? null,
    reference: Boolean(r.ref),
    pages: r.pages ?? null,
    parseMs: Math.round(r.ms),
    parse: r.parse ? numbers(r.parse) : null,
    import: r.import ? numbers(r.import) : null,
    freeParse: r.freeParse ? { ...freeNumbers(r.freeParse), ...glyphNumbers(r.glyphs?.parse) } : null,
    freeImport: r.freeImport ? { ...freeNumbers(r.freeImport), ...glyphNumbers(r.glyphs?.import) } : null,
    sizeGuard: r.guarded ?? null,
  }));
  writeFileSync(json, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${json}`);
}

let dropped = 0;
if (flag("--baseline")) {
  // One file or several, comma-separated (a public file and its private twin).
  const named = value("--baseline");
  const files = named ? named.split(",") : [BASELINE_PRIVATE, BASELINE_PUBLIC];
  const base: BaselineFile = Object.assign({}, ...files.map((file) => readBaseline(file)));
  const lines: string[] = [];
  for (const r of results) {
    const before = base[r.entry.id];
    if (!before) continue;
    const now = baselineOf(r);
    for (const [key, was] of Object.entries(before)) {
      const is = now[key];
      const metric = key.slice(key.lastIndexOf(".") + 1);
      if (is === undefined) {
        // A candidate that stops making tables where the reference has none
        // leaves the tables metric nothing to score: no drop.
        if (metric === "tables" && r.ref && !r.ref.blocks.some((b) => b.kind === "table")) continue;
        // A text layer that reads blind leaves coverage unscored (free.ts BLIND): no drop.
        const free = key.startsWith("free.parse.") ? r.freeParse : key.startsWith("free.import.") ? r.freeImport : undefined;
        if (metric.startsWith("coverage") && free?.coverage.blind) continue;
        lines.push(`  ${r.entry.id} ${key}: ${was} → (none)`);
        continue;
      }
      const worse = LOWER_IS_BETTER.has(metric) ? is > was : is < was;
      if (worse) lines.push(`  ${r.entry.id} ${key}: ${was} → ${is}`);
    }
  }
  dropped = lines.length;
  console.log(lines.length > 0 ? `\nDropped against the baseline (${lines.length}):\n${lines.join("\n")}` : "\nNo metric dropped against the baseline.");
}

if (flag("--save-baseline")) {
  const named = value("--save-baseline");
  const pub: BaselineFile = {};
  const priv: BaselineFile = {};
  for (const r of results) {
    if (r.skipped) continue;
    (named || !r.committed ? priv : pub)[r.entry.id] = baselineOf(r);
  }
  if (named) writeBaseline(named, priv);
  else {
    if (Object.keys(pub).length > 0) writeBaseline(BASELINE_PUBLIC, pub);
    if (Object.keys(priv).length > 0) writeBaseline(BASELINE_PRIVATE, priv);
  }
  console.log(`Saved the baseline for ${Object.keys(pub).length + Object.keys(priv).length} documents.`);
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
console.log(
  `\n${results.length} documents in ${secs(performance.now() - t0)}: parse ${secs(STAGES.parse)}, import ${secs(STAGES.import)}, reference metrics ${secs(STAGES.reference)}, reference-free ${secs(STAGES.free)}, glyph checks ${secs(STAGES.glyphs)}.`,
);
process.exit(dropped > 0 ? 1 : 0);

function readdirJson(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));
}
