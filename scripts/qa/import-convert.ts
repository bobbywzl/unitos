// The converter's checks (SPEC.md §29 Imports; the imports design 1.3 and
// 1.11; round 10 plan C1, C7). Every fixture is parsed the way the add parses
// it, converted with richTextFromImport, and held to the converter's
// invariants:
//   1. sanitized equals itself: sanitizeRichText(richText) is richText;
//   2. every indexed node has an id, and no two share one;
//   3. the rows' words (deriveBlocks) equal the parse's words, less list
//      markers and table repeats;
//   4. every parse figure has a figure object, with its media;
//   5. page starts rise, one for each page that holds words;
//   6. the size numbers are the rich text's.
// It also reads what a reader would miss: the masthead (the kicker, one
// Title, the Subtitle), each row's page, each cell's place (C1), the words
// after each page start against the PDF's own page, links to headings,
// styles, citations, text runs, and the page setup. Nothing is stored.
//
// Usage:
//   npx tsx --tsconfig tsconfig.json scripts/qa/import-convert.ts [--offline] [--json <file>] [--verbose] [source …]
// A source is a web page's or a PDF's URL, a .pdf, .md, or .txt path, or
// synthetic:pdf, synthetic:url, synthetic:markdown (fixtures built below).
// With no source: the sources in scripts/qa/import-compare-sources.txt,
// every scripts/eval/fixtures/*.md, and the three synthetic fixtures.
// --offline skips URLs. A web page is the walk's parse without the model
// passes, which is what the add stores under the model mock. The exit code
// is 1 when a check fails; a NOTE never fails the run.
import "../eval/env";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { getDocumentProxy } from "unpdf";
import { deriveBlocks, inlineText, type DerivedBlock } from "@/lib/docs/blocks";
import { richTextFromImport } from "@/lib/docs/import";
import {
  INDEXED_NODE_TYPES,
  MAX_RICH_TEXT_CHARS,
  pageSetupSchema,
  richDocSchema,
  sanitizeRichText,
  type RichNode,
} from "@/lib/docs/schema";
import { MARKDOWN_EXTENSIONS } from "@/lib/markdown-file";
import { fetchPage } from "@/lib/parse/fetch-page";
import { parseMarkdownDocument } from "@/lib/parse/markdown-document";
import { parsePdf } from "@/lib/parse/pdf";
import { pruneReferences } from "@/lib/parse/references";
import type { DocumentReference, ParsedBlock } from "@/lib/parse/types";
import { parseHtmlContent, resolveContentsLinks } from "@/lib/parse/url";

// ── Types ───────────────────────────────────────────────────────────────────

type ImportKind = "pdf" | "url" | "markdown";
type PageStartIn = { offset: number; page: number };
/** A parse block as the PDF parse writes it this round (A3a): a page on
    every block, and the page starts inside a block joined across a break. */
type Block = ParsedBlock & { pageStarts?: PageStartIn[] };
type Cell = { table: number; row: number; column: number };
/** A paragraph index row with this round's fields (A1). */
type Row = DerivedBlock & {
  page?: number | null;
  region?: unknown;
  mediaId?: string | null;
  citations?: { start: number; end: number; refId: string; quotedText: string }[];
  cell?: Cell | null;
};
type Fixture = {
  name: string;
  kind: ImportKind;
  title: string | null;
  titleFromOriginal: boolean;
  blocks: Block[];
  pageSize?: { width: number; height: number };
  pageLabels?: string[];
  references: DocumentReference[];
  // A PDF's own words per page (1-based index 0 = page 1), read with pdf.js.
  pdfPages?: string[];
  parseMs: number;
};
type Converted = Awaited<ReturnType<typeof richTextFromImport>>;
type Line = { level: "PASS" | "FAIL" | "NOTE"; name: string; detail: string };
type Report = {
  fixture: string;
  kind: ImportKind;
  blocks: number;
  rows: number;
  size: Converted["size"] | null;
  jsonBytes: number;
  figures: number;
  pageStarts: number;
  ms: { parse: number; convert: number; sanitize: number; derive: number };
  guard: string;
  lines: Line[];
};

// ── Arguments ───────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const offline = argv.includes("--offline");
const verbose = argv.includes("--verbose");
const jsonAt = argv.indexOf("--json");
const jsonOut = jsonAt >= 0 ? argv[jsonAt + 1] : null;
const named = argv.filter((a, i) => !a.startsWith("--") && !(jsonAt >= 0 && i === jsonAt + 1));

function defaultSources(): string[] {
  const list = join(ROOT, "scripts/qa/import-compare-sources.txt");
  const fromList = existsSync(list)
    ? readFileSync(list, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        // The list's "office" line names the slides and sheets fixtures: not imports.
        .filter((l) => /^https?:\/\//i.test(l) || /\.pdf$/i.test(l))
    : [];
  const fixtures = join(ROOT, "scripts/eval/fixtures");
  const markdown = existsSync(fixtures)
    ? readdirSync(fixtures)
        .filter((f) => MARKDOWN_EXTENSIONS.test(f))
        .sort()
        .map((f) => join("scripts/eval/fixtures", f))
    : [];
  return [...fromList, ...markdown, "synthetic:pdf", "synthetic:url", "synthetic:markdown"];
}

// ── Text helpers ────────────────────────────────────────────────────────────

const ZWSP = "​";
/** Words as compared: no zero-width spaces, one space for any run of
    spaces, each line trimmed. */
function norm(s: string): string {
  return s
    .replaceAll(ZWSP, "")
    .split("\n")
    .map((l) => l.replace(/[\s ]+/g, " ").trim())
    .join("\n")
    .trim();
}
const clip = (s: string, n = 70) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
/** The layout tokens a parse block's html opens with (kicker, meta, quote…). */
function tokensOf(b: ParsedBlock): string[] {
  const m = /^<[a-z][a-z0-9]*\b[^>]*\bclass="([^"]*)"/i.exec(b.html ?? "");
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}
/** The parse's own list markers (lib/parse/url.ts listLines, pdf.ts): two
    spaces a level, then "- " or "N. ". */
const MARKER = /^( *)(?:-|\d+\.) /;
/** Any marker a list line may still carry: the PDF keeps "1)", "(a)", "iv."
    and bullet glyphs as words when the line had no marker of its own. */
const ANY_MARKER = /^\s*(?:[-•▪◦‣●·*–—]|\d{1,3}[.)]|\([a-z\d]{1,3}\)|[ivxlc]{1,5}[.)]|[a-z][.)])\s+/i;

// ── Rich text walks ─────────────────────────────────────────────────────────

type Visit = (node: RichNode, path: RichNode[]) => void;
function walk(node: RichNode, visit: Visit, path: RichNode[] = []) {
  visit(node, path);
  for (const child of node.content ?? []) walk(child, visit, [...path, node]);
}
/** Key-sorted JSON with no undefined values: two trees compare by value. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}
/** The first differences between two trees, with their paths. A value the
    sanitizer turns from missing into null is soft: a save keeps it the same. */
function treeDiff(a: unknown, b: unknown, path = "", out: { path: string; a: unknown; b: unknown; soft: boolean }[] = []) {
  if (out.length >= 12) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, a: a.length, b: b.length, soft: false });
    for (let i = 0; i < Math.min(a.length, b.length); i++) treeDiff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in b) && a[k] === null) continue;
      if (!(k in a) && b[k] === null) {
        out.push({ path: `${path}.${k}`, a: undefined, b: null, soft: true });
        continue;
      }
      treeDiff(a[k], b[k], `${path}.${k}`, out);
    }
    return out;
  }
  out.push({ path, a, b, soft: false });
  return out;
}

/** The grid text of a page-editor table, built the way the URL parse builds
    a table's text (lib/parse/url.ts tableText): a rowspan's words repeat on
    each row it covers, a colspan's extra columns are blank; a cell's
    paragraphs join with a space. So the parse's text is this text exactly
    when the converter kept every cell and repeated none. */
function tableGrid(table: RichNode): { text: string; places: Map<RichNode, { row: number; column: number }> } {
  const rows = (table.content ?? []).filter((r) => r.type === "tableRow");
  const grid: string[][] = rows.map(() => []);
  const places = new Map<RichNode, { row: number; column: number }>();
  rows.forEach((row, r) => {
    let c = 0;
    for (const cell of (row.content ?? []).filter((x) => x.type === "tableCell" || x.type === "tableHeader")) {
      while (grid[r][c] !== undefined) c++;
      places.set(cell, { row: r + 1, column: c + 1 });
      const paragraphs: string[] = [];
      walk(cell, (n) => {
        if (n.type === "paragraph" || n.type === "heading" || n.type === "codeBlock") paragraphs.push(norm(inlineText(n).replaceAll("\n", " ")));
      });
      const text = paragraphs.filter(Boolean).join(" ");
      const colspan = Math.max(1, Number(cell.attrs?.colspan) || 1);
      const rowspan = Math.max(1, Number(cell.attrs?.rowspan) || 1);
      for (let dr = 0; dr < rowspan && r + dr < grid.length; dr++) {
        for (let dc = 0; dc < colspan; dc++) grid[r + dr][c + dc] = dc === 0 ? text : "";
      }
      c += colspan;
    }
  });
  return { text: grid.map((row) => [...row].map((cell) => cell ?? "").join("\t")).join("\n"), places };
}
/** A table's text with each cell's words normalized, rows and cells kept. */
function normTable(text: string): string {
  return text
    .split("\n")
    .map((row) => row.split("\t").map((c) => c.replace(/[\s ]+/g, " ").trim()).join("\t"))
    .join("\n");
}

// ── Units: the words, in order, on each side ────────────────────────────────

type UnitKind = "title" | "text" | "list" | "table" | "figure";
type Unit = {
  kind: UnitKind;
  text: string;
  key: string;
  // Expected side: the parse block (-1 for the title), where the unit's
  // line starts in the block's text (a list item's marker included, as the
  // parse counts a page start), and where its words start. Actual side: the
  // row's index.
  block: number;
  start: number;
  offset: number;
  row: number;
};
const keyOf = (kind: UnitKind, text: string) => (kind === "table" ? "T:" : kind === "figure" ? "F:" : "") + norm(text);

function blockUnits(b: Block, i: number): Unit[] {
  const unit = (kind: UnitKind, text: string, offset: number, start = offset): Unit => ({ kind, text, key: keyOf(kind, text), block: i, start, offset, row: -1 });
  switch (b.type) {
    case "SEPARATOR":
      return [];
    case "FIGURE":
      return [unit("figure", b.text, 0)];
    case "TABLE":
      return [unit("table", normTable(b.text), 0)];
    case "LIST": {
      const out: Unit[] = [];
      let at = 0;
      for (const line of b.text.split("\n")) {
        const m = MARKER.exec(line);
        const cut = m ? m[0].length : (/^ */.exec(line)?.[0].length ?? 0);
        const words = line.slice(cut);
        if (norm(words)) out.push(unit("list", words, at + cut, at));
        at += line.length + 1;
      }
      return out;
    }
    default:
      return norm(b.text) ? [unit("text", b.text, 0)] : [];
  }
}

/** Two titles are one when their words match, case and spacing aside. */
const sameWords = (a: string, b: string) =>
  a.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() === b.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** The parse's units in the order the converter lays them out
    (lib/docs/import.ts): a heading among the first twelve blocks that
    repeats the title (on the first page of a PDF) is the Title where it
    stands; else the Title comes after the leading kicker lines. Every other
    block keeps its place, the metadata line too (it becomes the Subtitle
    where it stands). */
function expectedUnits(f: Fixture): { units: Unit[]; kickers: number; titleAt: number; meta: number } {
  let kickers = 0;
  while (kickers < f.blocks.length && f.blocks[kickers].type === "PARAGRAPH" && tokensOf(f.blocks[kickers]).includes("kicker")) kickers++;
  const meta = f.blocks.slice(0, 12).findIndex((b) => b.type === "PARAGRAPH" && tokensOf(b).includes("meta"));
  const title = f.titleFromOriginal && f.title ? f.title.replace(/\s+/g, " ").trim() : "";
  const paged = f.kind === "pdf" && f.blocks.some((b) => typeof b.page === "number");
  const titleAt = title
    ? f.blocks.slice(0, 12).findIndex((b) => b.type === "HEADING" && sameWords(b.text, title) && (!paged || (b.page ?? 1) <= 1))
    : -1;
  const units: Unit[] = [];
  const titleUnit = (text: string, block: number): Unit => ({ kind: "title", text, key: keyOf("title", text), block, start: 0, offset: 0, row: -1 });
  f.blocks.forEach((b, i) => {
    if (i === kickers && title && titleAt < 0) units.push(titleUnit(title, -1));
    if (i === titleAt) units.push(titleUnit(b.text, i));
    else units.push(...blockUnits(b, i));
  });
  if (f.blocks.length <= kickers && title && titleAt < 0) units.push(titleUnit(title, -1));
  return { units, kickers, titleAt, meta };
}

type DocMap = {
  nodeById: Map<string, RichNode>;
  tableOf: Map<string, number>; // row id → its table's number (1-based)
  cellOf: Map<string, Cell>; // row id → its cell's place, computed here
  tables: RichNode[];
};
function mapDoc(doc: RichNode): DocMap {
  const nodeById = new Map<string, RichNode>();
  const tableOf = new Map<string, number>();
  const cellOf = new Map<string, Cell>();
  const tables: RichNode[] = [];
  walk(doc, (node, path) => {
    const id = node.attrs?.blockId;
    if (typeof id === "string" && INDEXED_NODE_TYPES.has(node.type)) nodeById.set(id, node);
    if (node.type === "table" && !path.some((p) => p.type === "table")) {
      tables.push(node);
      const number = tables.length;
      const { places } = tableGrid(node);
      for (const [cellNode, place] of places) {
        walk(cellNode, (inner) => {
          const innerId = inner.attrs?.blockId;
          if (typeof innerId === "string" && INDEXED_NODE_TYPES.has(inner.type)) {
            tableOf.set(innerId, number);
            cellOf.set(innerId, { table: number, row: place.row, column: place.column });
          }
        });
      }
    }
  });
  return { nodeById, tableOf, cellOf, tables };
}

function actualUnits(rows: Row[], map: DocMap): Unit[] {
  const units: Unit[] = [];
  const seenTables = new Set<number>();
  rows.forEach((row, i) => {
    const table = map.tableOf.get(row.id);
    if (table !== undefined) {
      if (seenTables.has(table)) return;
      seenTables.add(table);
      const text = normTable(tableGrid(map.tables[table - 1]).text);
      units.push({ kind: "table", text, key: keyOf("table", text), block: -1, start: 0, offset: 0, row: i });
      return;
    }
    if (row.type === "SEPARATOR") return;
    const node = map.nodeById.get(row.id);
    if (row.type === "FIGURE") {
      // A figure object's row; an image node (in a cell, or pasted) has no words.
      if (node?.type === "image") return;
      units.push({ kind: "figure", text: row.text, key: keyOf("figure", row.text), block: -1, start: 0, offset: 0, row: i });
      return;
    }
    if (!norm(row.text)) return;
    const kind: UnitKind = node?.attrs?.docStyle === "title" ? "title" : row.type === "LIST" ? "list" : "text";
    units.push({ kind, text: row.text, key: keyOf(kind, row.text), block: -1, start: 0, offset: 0, row: i });
  });
  return units;
}

/** The longest common subsequence of two key lists: the matched pairs. */
function align(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (n * m > 40_000_000) {
    // Too large for the table: a forward greedy match inside a window.
    const pairs: [number, number][] = [];
    let j = 0;
    for (let i = 0; i < n && j < m; i++) {
      for (let k = j; k < Math.min(m, j + 400); k++) {
        if (a[i] === b[k]) {
          pairs.push([i, k]);
          j = k + 1;
          break;
        }
      }
    }
    return pairs;
  }
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Where two texts first differ, each side shown around it. */
function firstDifference(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 25);
  return `at ${i}: parse "…${a.slice(from, i + 35)}…" | rows "…${b.slice(from, i + 35)}…"`;
}

// ── The checks ──────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

async function checkFixture(f: Fixture): Promise<Report> {
  const lines: Line[] = [];
  const pass = (name: string, detail = "") => lines.push({ level: "PASS", name, detail });
  const fail = (name: string, detail = "") => lines.push({ level: "FAIL", name, detail });
  const note = (name: string, detail = "") => lines.push({ level: "NOTE", name, detail });
  const check = (ok: boolean, name: string, detail = "") => (ok ? pass(name, detail) : fail(name, detail));
  const report: Report = {
    fixture: f.name,
    kind: f.kind,
    blocks: f.blocks.length,
    rows: 0,
    size: null,
    jsonBytes: 0,
    figures: 0,
    pageStarts: 0,
    ms: { parse: Math.round(f.parseMs), convert: 0, sanitize: 0, derive: 0 },
    guard: "",
    lines,
  };

  let t0 = performance.now();
  let out: Converted;
  try {
    out = await Promise.resolve(
      richTextFromImport({
        kind: f.kind,
        title: f.title,
        titleFromOriginal: f.titleFromOriginal,
        blocks: f.blocks,
        ...(f.pageSize ? { pageSize: f.pageSize } : {}),
      }),
    );
  } catch (err) {
    fail("richTextFromImport runs", String(err instanceof Error ? (err.stack ?? err.message) : err).split("\n").slice(0, 4).join(" | "));
    return report;
  }
  report.ms.convert = Math.round(performance.now() - t0);
  const doc = out.richText;
  const json = JSON.stringify(doc);
  report.jsonBytes = Buffer.byteLength(json);
  report.size = out.size;

  // 1. Sanitized equals itself.
  t0 = performance.now();
  const clean = sanitizeRichText(doc);
  report.ms.sanitize = Math.round(performance.now() - t0);
  if (!clean) fail("1 sanitized equals itself", "sanitizeRichText refused the rich text (not a doc, or past 60,000 nodes)");
  else {
    const diffs = treeDiff(canon(doc), canon(clean));
    const hard = diffs.filter((d) => !d.soft);
    if (hard.length === 0) pass("1 sanitized equals itself", diffs.length ? `${diffs.length} attribute(s) only missing vs null, e.g. ${diffs[0].path}` : "");
    else fail("1 sanitized equals itself", hard.slice(0, 4).map((d) => `${d.path}: ${clip(JSON.stringify(d.a) ?? "undefined", 60)} → ${clip(JSON.stringify(d.b) ?? "undefined", 60)}`).join(" | "));
  }
  const schema = richDocSchema.safeParse(doc);
  check(schema.success, "the save's request schema takes it", schema.success ? "" : clip(schema.error.message, 200));
  check(json.length <= MAX_RICH_TEXT_CHARS, "under the save's size limit", `${json.length} of ${MAX_RICH_TEXT_CHARS} characters`);

  // 2. Every indexed node has an id, and no two share one.
  const ids = new Map<string, number>();
  const missing: string[] = [];
  let indexed = 0;
  walk(doc, (node) => {
    if (!INDEXED_NODE_TYPES.has(node.type)) return;
    indexed++;
    const id = node.attrs?.blockId;
    if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id)) missing.push(`${node.type} "${clip(inlineText(node), 30)}"`);
    else ids.set(id, (ids.get(id) ?? 0) + 1);
  });
  const repeated = [...ids].filter(([, n]) => n > 1).map(([id]) => id);
  check(missing.length === 0 && repeated.length === 0, "2 every indexed node has an id", missing.length || repeated.length ? `${missing.length} without: ${missing.slice(0, 3).join(", ")}; ${repeated.length} repeated: ${repeated.slice(0, 3).join(", ")}` : `${indexed} nodes`);

  // The paragraph index.
  t0 = performance.now();
  const rows = deriveBlocks(doc) as Row[];
  report.ms.derive = Math.round(performance.now() - t0);
  report.rows = rows.length;
  const map = mapDoc(doc);

  // 3. The rows' words equal the parse's words, less list markers and table repeats.
  const { units: want, kickers, titleAt, meta } = expectedUnits(f);
  const got = actualUnits(rows, map);
  const pairs = align(
    want.map((u) => u.key),
    got.map((u) => u.key),
  );
  const matchedWant = new Set(pairs.map(([i]) => i));
  const matchedGot = new Set(pairs.map(([, j]) => j));
  for (const [i, j] of pairs) {
    want[i].row = got[j].row;
  }
  const lost = want.map((u, i) => ({ u, i })).filter(({ i }) => !matchedWant.has(i));
  const added = got.map((u, j) => ({ u, j })).filter(({ j }) => !matchedGot.has(j));
  // Words in both lists at other places moved; a line that differs only in a
  // marker the parse kept as words is the converter reading it as a marker.
  const moved: string[] = [];
  const markerOnly: string[] = [];
  const whitespace: string[] = [];
  const addedLeft = [...added];
  const lostHard: typeof lost = [];
  for (const l of lost) {
    const same = addedLeft.findIndex((a) => a.u.key === l.u.key);
    if (same >= 0) {
      moved.push(clip(l.u.text, 40));
      addedLeft.splice(same, 1);
      continue;
    }
    const stripped = l.u.text.replace(ANY_MARKER, "");
    const marker = addedLeft.findIndex((a) => norm(a.u.text.replace(ANY_MARKER, "")) === norm(stripped) || norm(a.u.text) === norm(stripped));
    if (l.u.kind === "list" && marker >= 0) {
      markerOnly.push(`"${clip(l.u.text, 30)}" → "${clip(addedLeft[marker].u.text, 30)}"`);
      addedLeft.splice(marker, 1);
      continue;
    }
    const space = addedLeft.findIndex((a) => a.u.key.replace(/\s+/g, "") === l.u.key.replace(/\s+/g, ""));
    if (space >= 0) {
      whitespace.push(firstDifference(norm(l.u.text), norm(addedLeft[space].u.text)));
      addedLeft.splice(space, 1);
      continue;
    }
    lostHard.push(l);
  }
  // A table's <caption> is in the parse's html, not in its text: the
  // converter keeps it as a paragraph above the table.
  const captions = new Set(
    f.blocks.filter((b) => b.type === "TABLE").flatMap((b) => [...(b.html ?? "").matchAll(/<caption[^>]*>([\s\S]*?)<\/caption>/gi)].map((m) => norm(m[1].replace(/<[^>]+>/g, " ")))),
  );
  const tableCaptions = addedLeft.filter((a) => captions.has(norm(a.u.text)));
  for (const c of tableCaptions) addedLeft.splice(addedLeft.indexOf(c), 1);
  if (tableCaptions.length) note("a table's caption (in the parse's html, not its text) is a paragraph", `${tableCaptions.length}: ${tableCaptions.slice(0, 3).map((c) => `"${clip(c.u.text, 40)}"`).join(" | ")}`);
  const wordsOk = lostHard.length === 0 && addedLeft.length === 0;
  const describeLost = lostHard.slice(0, 6).map(({ u }) => {
    const b = u.block >= 0 ? f.blocks[u.block] : null;
    // The row that stands where the unit should: the first unmatched row.
    const near = addedLeft.find((a) => a.u.kind === u.kind || (u.kind !== "table" && a.u.kind !== "table"));
    const where = b ? `block ${u.block} ${b.type}` : "title";
    return `${where} "${clip(u.text, 60)}"${near ? ` (nearest unmatched row: ${firstDifference(norm(u.text), norm(near.u.text))})` : ""}`;
  });
  const describeAdded = addedLeft.slice(0, 6).map(({ u }) => `row ${u.row} ${rows[u.row]?.type} "${clip(u.text, 60)}"`);
  check(
    wordsOk,
    "3 the rows' words equal the parse's",
    `${pairs.length} of ${want.length} units in place` +
      (lostHard.length ? `; ${lostHard.length} not in the rows: ${describeLost.join(" | ")}` : "") +
      (addedLeft.length ? `; ${addedLeft.length} rows the parse lacks: ${describeAdded.join(" | ")}` : ""),
  );
  if (moved.length) note("words moved", `${moved.length}: ${moved.slice(0, 4).join(" | ")}`);
  if (markerOnly.length) note("a marker the parse kept as words left the line", `${markerOnly.length}: ${markerOnly.slice(0, 4).join(" | ")}`);
  if (whitespace.length) note("lines differ only in spaces", `${whitespace.length}: ${whitespace.slice(0, 3).join(" | ")}`);
  const exact = pairs.filter(([i, j]) => want[i].kind !== "table" && want[i].text.replaceAll(ZWSP, "") !== got[j].text).length;
  if (exact) note("words equal only after spaces are collapsed", `${exact} unit(s), e.g. ${(() => { const p = pairs.find(([i, j]) => want[i].kind !== "table" && want[i].text.replaceAll(ZWSP, "") !== got[j].text); return p ? firstDifference(want[p[0]].text, got[p[1]].text) : ""; })()}`);

  // 4. Every parse figure has a figure object, with its media.
  const parseFigures = f.blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.type === "FIGURE");
  const figureNodes: RichNode[] = [];
  walk(doc, (n) => {
    if (n.type === "figure") figureNodes.push(n);
  });
  report.figures = figureNodes.length;
  const media = new Map(out.figures.map((m) => [m.mediaId, m]));
  const figureProblems: string[] = [];
  if (parseFigures.length !== figureNodes.length) figureProblems.push(`${parseFigures.length} parse figures, ${figureNodes.length} figure objects`);
  if (out.figures.length !== figureNodes.length) figureProblems.push(`${out.figures.length} figure media for ${figureNodes.length} objects`);
  if (media.size !== out.figures.length) figureProblems.push("two figure media share a mediaId");
  const usedMedia = new Set<string>();
  parseFigures.forEach(({ b, i }, k) => {
    const node = figureNodes[k];
    if (!node) return;
    const a = node.attrs ?? {};
    const mediaId = typeof a.mediaId === "string" ? a.mediaId : "";
    const m = media.get(mediaId);
    if (!m) {
      figureProblems.push(`block ${i}: object's mediaId ${mediaId || "(none)"} has no media`);
      return;
    }
    if (usedMedia.has(mediaId)) figureProblems.push(`block ${i}: mediaId ${mediaId} used twice`);
    usedMedia.add(mediaId);
    if (norm(String(a.caption ?? "")) !== norm(b.text)) figureProblems.push(`block ${i}: caption "${clip(String(a.caption ?? ""), 30)}" ≠ "${clip(b.text, 30)}"`);
    if (m.caption !== a.caption) figureProblems.push(`block ${i}: media caption differs from the object's`);
    if ((b.html ?? null) !== m.html) figureProblems.push(`block ${i}: media html ${m.html === null ? "null" : `${m.html.length} chars`} ≠ parse html ${b.html ? `${b.html.length} chars` : "null"}`);
    if ((b.page ?? null) !== (a.page ?? null) || (b.page ?? null) !== m.page) figureProblems.push(`block ${i}: page ${String(a.page)}/${String(m.page)} ≠ ${String(b.page ?? null)}`);
    const region = b.region ? JSON.stringify(b.region) : null;
    const nodeRegion = typeof a.region === "string" ? JSON.stringify(JSON.parse(a.region)) : a.region === null || a.region === undefined ? null : "not a JSON string";
    if (region !== nodeRegion || region !== (m.region ? JSON.stringify(m.region) : null)) figureProblems.push(`block ${i}: region differs`);
    if (typeof a.blockId !== "string") figureProblems.push(`block ${i}: object without a blockId`);
  });
  check(figureProblems.length === 0, "4 every parse figure has a figure object", figureProblems.length ? figureProblems.slice(0, 5).join(" | ") : `${figureNodes.length} figures`);
  // A figure row reads the object: its caption, page, region, and mediaId.
  const figureRows = rows.filter((r) => r.type === "FIGURE" && map.nodeById.get(r.id)?.type === "figure");
  const badFigureRows = figureRows.filter((r) => {
    const node = map.nodeById.get(r.id);
    return !node || r.text !== node.attrs?.caption || (r.mediaId ?? null) !== (node.attrs?.mediaId ?? null) || (r.page ?? null) !== (node.attrs?.page ?? null);
  });
  if (figureRows.length) check(badFigureRows.length === 0, "a figure row reads its object (caption, mediaId, page)", badFigureRows.length ? `${badFigureRows.length} of ${figureRows.length}, e.g. row ${badFigureRows[0].id}: mediaId ${String(badFigureRows[0].mediaId)} page ${String(badFigureRows[0].page)}` : `${figureRows.length} rows`);

  // 5. Page starts rise, one for each page that holds words.
  type Start = { page: number; on: string; before: string; after: string; node: RichNode | null };
  const starts: Start[] = [];
  const badAtoms: string[] = [];
  walk(doc, (node) => {
    if (typeof node.attrs?.pageStart === "number") starts.push({ page: node.attrs.pageStart, on: node.type, before: "", after: node.type === "figure" ? `[figure] ${clip(String(node.attrs.caption ?? ""), 40)}` : clip(inlineText(node), 40), node });
    if (!node.content) return;
    let before = "";
    node.content.forEach((child, k) => {
      if (child.type === "pageStart") {
        const keys = Object.keys(child.attrs ?? {});
        if (typeof child.attrs?.page !== "number" || keys.some((key) => key !== "page")) badAtoms.push(JSON.stringify(child.attrs ?? {}));
        if (child.content?.length || child.text) badAtoms.push("a page start with content");
        const after = node.content!.slice(k + 1).map(inlineText).join("");
        starts.push({ page: Number(child.attrs?.page), on: node.type, before, after: clip(after, 40), node });
      }
      before += inlineText(child);
    });
  });
  report.pageStarts = starts.length;
  if (f.kind === "pdf") {
    const pages = [...new Set(f.blocks.flatMap((b) => [...(typeof b.page === "number" ? [b.page] : []), ...(b.pageStarts ?? []).map((s) => s.page)]))].sort((a, b) => a - b);
    const seq = starts.map((s) => s.page);
    const falls = seq.findIndex((p, k) => k > 0 && p <= seq[k - 1]);
    const have = new Set(seq);
    const lostPages = pages.filter((p) => !have.has(p));
    const extraPages = seq.filter((p) => !pages.includes(p));
    check(
      falls < 0 && lostPages.length === 0 && extraPages.length === 0 && badAtoms.length === 0,
      "5 page starts rise, one per page with words",
      `${seq.length} page starts for ${pages.length} pages` +
        (falls >= 0 ? `; p. ${seq[falls]} after p. ${seq[falls - 1]} (at "${starts[falls].after}")` : "") +
        (lostPages.length ? `; no page start for ${lostPages.slice(0, 8).join(", ")}` : "") +
        (extraPages.length ? `; page starts for pages the parse lacks: ${extraPages.slice(0, 8).join(", ")}` : "") +
        (badAtoms.length ? `; attrs beyond {page} (C7): ${badAtoms.slice(0, 2).join(" ")}` : ""),
    );
    if (pages.length === 0) fail("the parse gave pages", "no block carries a page: the PDF parse's pages (A3a) are not in");
    // Each page start where the parse says the page begins.
    const atFirstWord: string[] = [];
    let placed = 0;
    f.blocks.forEach((b, i) => {
      for (const s of b.pageStarts ?? []) {
        const own = want.filter((u) => u.block === i).sort((a, b) => a.start - b.start);
        const unit = own.find((u, k) => u.start <= s.offset && (own[k + 1]?.start ?? Infinity) > s.offset);
        const row = unit && unit.row >= 0 ? rows[unit.row] : null;
        const node = row ? map.nodeById.get(row.id) : null;
        const start = node ? starts.find((st) => st.node === node && st.page === s.page) : undefined;
        if (!start) {
          // A table's or a figure's page start sits on another node: page, not place.
          if (b.type !== "TABLE" && b.type !== "FIGURE") atFirstWord.push(`block ${i} ${b.type} p. ${s.page}: not in its node`);
          continue;
        }
        if (b.type === "PARAGRAPH" || b.type === "HEADING") {
          const expected = b.text.slice(0, s.offset);
          if (norm(start.before) !== norm(expected)) atFirstWord.push(`block ${i} p. ${s.page}: ${firstDifference(norm(expected), norm(start.before))}`);
          else placed++;
        } else placed++;
      }
    });
    const inside = f.blocks.reduce((n, b) => n + (b.pageStarts?.length ?? 0), 0);
    if (inside) check(atFirstWord.length === 0, "a page start inside a block sits at the new page's first word", atFirstWord.length ? `${atFirstWord.length} of ${inside}: ${atFirstWord.slice(0, 3).join(" | ")}` : `${placed} of ${inside}`);
    // The words after each page start stand on that page of the PDF.
    if (f.pdfPages) {
      const off: string[] = [];
      let checked = 0;
      for (const s of starts) {
        if (s.on === "figure") continue;
        const words = norm(s.after).split(" ").slice(0, 3).join(" ");
        if (words.length < 6) continue;
        checked++;
        const pageText = f.pdfPages[s.page - 1] ?? "";
        const squash = (t: string) => t.replace(/[\s­-]+/g, "").toLowerCase();
        if (!squash(pageText).includes(squash(words))) off.push(`p. ${s.page} "${words}"`);
      }
      check(off.length === 0, "the words after each page start are on that page of the PDF", off.length ? `${off.length} of ${checked}: ${off.slice(0, 5).join(" | ")}` : `${checked} checked`);
    }
    // Each row's page: the page its words start on.
    const pageless = rows.filter((r) => typeof r.page !== "number");
    const titleRow = rows.find((r) => map.nodeById.get(r.id)?.attrs?.docStyle === "title");
    const rowsFall = rows.findIndex((r, k) => k > 0 && typeof r.page === "number" && typeof rows[k - 1].page === "number" && r.page < (rows[k - 1].page as number));
    const wrongPage: string[] = [];
    const codeInside: string[] = [];
    for (const u of want) {
      if (u.block < 0 || u.row < 0) continue;
      const b = f.blocks[u.block];
      let page = typeof b.page === "number" ? b.page : null;
      for (const s of b.pageStarts ?? []) if (s.offset <= u.offset && page !== null) page = Math.max(page, s.page);
      const row = rows[u.row];
      if (page === null || row.page === page) continue;
      // A code block holds no page start: a page that begins inside it
      // draws at its top, and its row reads that page (design 1.4).
      if (b.type === "CODE" && (b.pageStarts ?? []).some((s) => s.page === row.page)) {
        codeInside.push(`block ${u.block}: row p. ${String(row.page)}, words start on p. ${page}`);
        continue;
      }
      wrongPage.push(`block ${u.block} ${b.type} "${clip(u.text, 24)}": row p. ${String(row.page)}, parse p. ${page}`);
    }
    check(
      pageless.filter((r) => r !== titleRow).length === 0 && rowsFall < 0 && wrongPage.length === 0,
      "every row carries the page its words start on",
      `${rows.length - pageless.length} of ${rows.length} rows with a page` +
        (rowsFall >= 0 ? `; row ${rowsFall} p. ${String(rows[rowsFall].page)} after p. ${String(rows[rowsFall - 1].page)}` : "") +
        (wrongPage.length ? `; ${wrongPage.length} wrong: ${wrongPage.slice(0, 3).join(" | ")}` : ""),
    );
    if (codeInside.length) note("a page that begins inside a code block draws at its top, and the row reads it", codeInside.slice(0, 3).join(" | "));
    if (titleRow && typeof titleRow.page !== "number") note("the Title row has no page", "no page start stands before the Title");
    if (f.pageLabels?.length) note("page labels", `${f.pageLabels.length} labels: ${f.pageLabels.slice(0, 5).join(", ")}…`);
  } else {
    check(starts.length === 0, "5 no page starts outside a PDF", `${starts.length} page starts`);
    const paged = rows.filter((r) => r.page !== null && r.page !== undefined);
    check(paged.length === 0, "no row carries a page outside a PDF", `${paged.length} rows with a page`);
  }

  // 6. The size numbers are the rich text's.
  let allNodes = 0;
  let textNodes = 0;
  walk(doc, (n) => {
    allNodes++;
    if (n.type === "text") textNodes++;
  });
  const size = out.size;
  const jsonOk = size.json === json.length || size.json === report.jsonBytes;
  const nodesOk = size.nodes === allNodes || size.nodes === allNodes - textNodes;
  check(
    size.rows === rows.length && jsonOk && nodesOk,
    "6 the size numbers are the rich text's",
    `size {nodes ${size.nodes}, json ${size.json}, rows ${size.rows}}; counted: nodes ${allNodes} (${allNodes - textNodes} without text), json ${json.length} chars / ${report.jsonBytes} bytes, rows ${rows.length}`,
  );
  const overRows = rows.length > 1500;
  const overJson = size.json > 1_500_000;
  report.guard = overRows || overJson ? `block document (${overRows ? "rows" : ""}${overRows && overJson ? ", " : ""}${overJson ? "json" : ""})` : "page editor";

  // The masthead: the kicker above one Title, the metadata line under it.
  const top: RichNode[] = [];
  walk(doc, (n, path) => {
    if (path.length === 1 && (n.type === "paragraph" || n.type === "heading")) top.push(n);
  });
  const titles: RichNode[] = [];
  walk(doc, (n) => {
    if (n.type === "paragraph" && n.attrs?.docStyle === "title") titles.push(n);
  });
  if (f.titleFromOriginal && f.title) {
    const at = top.findIndex((n) => n.attrs?.docStyle === "title");
    const title = titles[0];
    const titleWords = titleAt >= 0 ? f.blocks[titleAt].text : f.title;
    check(
      titles.length === 1 && title !== undefined && norm(inlineText(title)) === norm(titleWords),
      "one Title",
      `${titles.length} Title paragraph(s)${title ? ` "${clip(inlineText(title), 50)}" at ${at}${titleAt >= 0 ? ` (the parse's heading ${titleAt}, promoted where it stands)` : ""}` : ""}`,
    );
    if (at > kickers) note("the Title is not first on the page", `${at} paragraph(s) above it, the first "${clip(inlineText(top[0]), 60)}"`);
    const nextHeading = top.slice(at + 1).find((n) => n.type === "heading" || n.attrs?.docStyle === "title");
    const firstText = top.slice(at + 1).find((n) => norm(inlineText(n)));
    check(
      !(nextHeading && firstText === nextHeading && sameWords(inlineText(nextHeading), inlineText(title ?? { type: "text", text: f.title }))),
      "R10 the title stands once (no first heading repeats it)",
      nextHeading ? `next heading "${clip(inlineText(nextHeading), 50)}"` : "",
    );
    if (kickers > 0) {
      const first = top[0];
      check(first !== undefined && norm(inlineText(first)) === norm(f.blocks[0].text) && first.attrs?.docStyle !== "title" && at >= kickers, "the kicker stands above the Title", first ? `"${clip(inlineText(first), 40)}"` : "none");
    }
    if (meta >= 0) {
      const sub = top.find((n) => n.attrs?.docStyle === "subtitle");
      const under = top[at + 1];
      check(sub !== undefined && norm(inlineText(sub)) === norm(f.blocks[meta].text), "the metadata line is the Subtitle", sub ? `"${clip(inlineText(sub), 40)}"` : "none");
      if (sub && under !== sub) note("the Subtitle does not stand right under the Title", `under the Title: "${clip(inlineText(under ?? { type: "text", text: "" }), 40)}"`);
    }
  } else {
    check(titles.length === 0, "no Title when the title is not the original's", `${titles.length} Title paragraph(s)`);
  }

  // C1: a cell paragraph's row names its table, row, and column.
  const cellRows = rows.filter((r) => map.cellOf.has(r.id));
  if (cellRows.length) {
    const wrong = cellRows.filter((r) => JSON.stringify(r.cell ?? null) !== JSON.stringify(map.cellOf.get(r.id)));
    check(wrong.length === 0, "C1 each cell row names its table, row, and column", wrong.length ? `${wrong.length} of ${cellRows.length}, e.g. "${clip(wrong[0].text, 20)}": ${JSON.stringify(wrong[0].cell ?? null)} ≠ ${JSON.stringify(map.cellOf.get(wrong[0].id))}` : `${cellRows.length} cell rows in ${map.tables.length} tables`);
    const outside = rows.filter((r) => !map.cellOf.has(r.id) && r.cell);
    if (outside.length) fail("no row outside a table names a cell", `${outside.length} rows`);
  }
  const parseTables = f.blocks.filter((b) => b.type === "TABLE").length;
  check(parseTables === map.tables.length, "every parse table is a table", `${parseTables} parse tables, ${map.tables.length} tables`);

  // Links to headings, and links out.
  const headingIds = new Set<string>();
  walk(doc, (n) => {
    if ((n.type === "heading" || n.attrs?.docStyle === "title") && typeof n.attrs?.blockId === "string") headingIds.add(n.attrs.blockId);
  });
  const headingLinks: string[] = [];
  walk(doc, (n) => {
    for (const m of n.marks ?? []) {
      const href = m.type === "link" ? String(m.attrs?.href ?? "") : "";
      if (href.startsWith("#heading=")) headingLinks.push(href.slice("#heading=".length));
    }
  });
  const dangling = headingLinks.filter((id) => !headingIds.has(id));
  const parseInternal = f.blocks.reduce((n, b) => n + (b.links ?? []).filter((l) => typeof l.targetOrder === "number").length, 0);
  const toHeadings = f.blocks.reduce((n, b) => n + (b.links ?? []).filter((l) => typeof l.targetOrder === "number" && f.blocks[l.targetOrder]?.type === "HEADING").length, 0);
  if (parseInternal || headingLinks.length) {
    check(
      dangling.length === 0 && new Set(headingLinks).size > 0 === toHeadings > 0,
      "links to headings land on headings",
      `${parseInternal} parse links by targetOrder (${toHeadings} to a heading); ${headingLinks.length} link text runs to ${new Set(headingLinks).size} headings${dangling.length ? `; ${dangling.length} to no heading` : ""}`,
    );
  }
  const multiset = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const lossOf = (want: string[], have: string[]) => {
    const h = multiset(have);
    const lostList: string[] = [];
    for (const [k, n] of multiset(want)) {
      const d = n - (h.get(k) ?? 0);
      for (let x = 0; x < d; x++) lostList.push(k);
    }
    return lostList;
  };
  const hrefWant = f.blocks.filter((b) => b.type !== "FIGURE").flatMap((b) => (b.links ?? []).filter((l) => l.href).map((l) => `${l.href} ${norm(l.quotedText)}`));
  const hrefHave = rows.flatMap((r) => r.links.filter((l) => !l.href.startsWith("#heading=")).map((l) => `${l.href} ${norm(l.quotedText)}`));
  if (hrefWant.length) {
    const lostLinks = lossOf(hrefWant, hrefHave);
    check(lostLinks.length === 0, "every link out is a link", `${hrefWant.length} in the parse, ${hrefHave.length} in the rows${lostLinks.length ? `; lost ${lostLinks.length}: ${lostLinks.slice(0, 3).map((x) => clip(x, 60)).join(" | ")}` : ""}`);
  }
  // Styles: bold, italic, underline, code.
  const styleWant = f.blocks.filter((b) => b.type !== "FIGURE" && b.type !== "CODE").flatMap((b) => (b.styles ?? []).map((s) => `${s.style} ${norm(s.quotedText)}`));
  const styleHave = rows.flatMap((r) => r.styles.filter((s) => ["bold", "italic", "underline", "code"].includes(s.style)).map((s) => `${s.style} ${norm(s.quotedText)}`));
  if (styleWant.length) {
    const lostStyles = lossOf(styleWant, styleHave).filter((s) => s.split(" ").slice(1).join(" ").length > 0);
    // A heading's own bold is the heading's style.
    const real = lostStyles.filter((s) => !f.blocks.some((b) => b.type === "HEADING" && s.startsWith("bold ") && norm(b.text).includes(s.slice(5))));
    (real.length === 0 ? pass : fail)("every style run keeps its style", `${styleWant.length} in the parse, ${styleHave.length} in the rows${real.length ? `; lost ${real.length}: ${real.slice(0, 4).map((x) => `"${clip(x, 40)}"`).join(" | ")}` : ""}`);
  }
  // Citations: the mark, derived into Block.citations.
  const citeWant = f.blocks.filter((b) => b.type !== "FIGURE").flatMap((b) => (b.citations ?? []).map((c) => `${c.refId} ${norm(c.quotedText)}`));
  const citeHave = rows.flatMap((r) => (r.citations ?? []).map((c) => `${c.refId} ${norm(c.quotedText)}`));
  let citationMarks = 0;
  const refs = new Set(f.references.map((r) => r.id));
  const unknownRefs: string[] = [];
  walk(doc, (n) => {
    for (const m of n.marks ?? []) {
      if (m.type !== "citation") continue;
      citationMarks++;
      if (refs.size && !refs.has(String(m.attrs?.refId))) unknownRefs.push(String(m.attrs?.refId));
    }
  });
  if (citeWant.length || citationMarks) {
    const lostCites = lossOf(citeWant, citeHave);
    check(lostCites.length === 0 && unknownRefs.length === 0, "every citation is a citation mark and a row citation", `${citeWant.length} in the parse, ${citationMarks} marks, ${citeHave.length} row citations${lostCites.length ? `; lost ${lostCites.length}: ${lostCites.slice(0, 3).join(" | ")}` : ""}${unknownRefs.length ? `; ${unknownRefs.length} to no reference` : ""}`);
    const inCaptions = f.blocks.filter((b) => b.type === "FIGURE").reduce((n, b) => n + (b.citations?.length ?? 0), 0);
    if (inCaptions) note("citations inside captions", `${inCaptions} (a caption is the figure's: they stay words, design 1.3)`);
  }

  // Text runs: no zero-width space, none past the save's 200,000 characters,
  // no empty run, and a line break is a node, never a "\n" in the words.
  const runProblems: string[] = [];
  walk(doc, (n, path) => {
    if (n.type !== "text") return;
    const t = n.text ?? "";
    if (!t) runProblems.push("an empty text run");
    if (t.includes(ZWSP)) runProblems.push(`a zero-width space in "${clip(t, 30)}"`);
    if (t.length > 200_000) runProblems.push(`a run of ${t.length} characters`);
    if (t.includes("\n") && !path.some((p) => p.type === "codeBlock")) runProblems.push(`"\\n" inside "${clip(t, 30)}" (${path.at(-1)?.type})`);
  });
  check(runProblems.length === 0, "text runs are clean (no U+200B, none past 200,000, breaks as nodes)", runProblems.slice(0, 4).join(" | "));

  // The page setup.
  const setup = out.pageSetup;
  const parsedSetup = pageSetupSchema.safeParse(setup);
  if (f.kind === "pdf") {
    const w = f.pageSize ? clamp(f.pageSize.width, 144, 2000) : null;
    const h = f.pageSize ? clamp(f.pageSize.height, 144, 3000) : null;
    const margins = setup.margins;
    // 1 in, or a sixth of the side on a page under 6 in.
    const side = w === null ? 72 : Math.min(72, Math.round(w / 6));
    const end = h === null ? 72 : Math.min(72, Math.round(h / 6));
    check(
      parsedSetup.success && !setup.pageless && (w === null || Math.abs(setup.width - w) < 0.51) && (h === null || Math.abs(setup.height - h) < 0.51) && margins.top === end && margins.bottom === end && margins.left === side && margins.right === side,
      "a PDF opens in pages at its first page's size, 1 in margins",
      `${setup.pageless ? "pageless" : "pages"} ${setup.width}×${setup.height} pt (first page ${f.pageSize ? `${f.pageSize.width}×${f.pageSize.height}` : "unknown"}), margins ${margins.top}/${margins.right}/${margins.bottom}/${margins.left}`,
    );
  } else {
    check(parsedSetup.success && setup.pageless, "a web page or a text file opens pageless", `${setup.pageless ? "pageless" : "pages"}`);
  }

  // A census of what the rich text holds.
  if (verbose) {
    const census = new Map<string, number>();
    walk(doc, (n) => {
      census.set(n.type, (census.get(n.type) ?? 0) + 1);
      for (const m of n.marks ?? []) census.set(`mark:${m.type}`, (census.get(`mark:${m.type}`) ?? 0) + 1);
    });
    note("census", [...census].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", "));
    note("page starts", starts.slice(0, 40).map((s) => `p. ${s.page} ${s.on === "paragraph" || s.on === "heading" ? "" : `[${s.on}] `}"${norm(s.after).split(" ").slice(0, 4).join(" ")}"`).join(" · "));
  }
  return report;
}

// ── Sources ─────────────────────────────────────────────────────────────────

async function pdfPageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    out.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return out;
}

async function pdfFixture(name: string, bytes: Uint8Array): Promise<Fixture> {
  const t0 = performance.now();
  const parsed: {
    title: string | null;
    blocks: ParsedBlock[];
    pageSize?: { width: number; height: number };
    pageLabels?: string[];
  } = await parsePdf(new Uint8Array(bytes));
  const parseMs = performance.now() - t0;
  return {
    name,
    kind: "pdf",
    title: parsed.title ?? name.replace(/\.pdf$/i, ""),
    titleFromOriginal: parsed.title !== null,
    blocks: resolveContentsLinks(parsed.blocks),
    pageSize: parsed.pageSize,
    pageLabels: parsed.pageLabels,
    references: [],
    pdfPages: await pdfPageTexts(bytes),
    parseMs,
  };
}

async function htmlFixture(name: string, html: string, url: string, kind: "url" | "markdown", title?: { text: string; fromOriginal: boolean }): Promise<Fixture> {
  const t0 = performance.now();
  const parsed = await parseHtmlContent(html, url);
  const references = pruneReferences(parsed.blocks, parsed.references ?? [], parsed.formalReferences ?? 0);
  return {
    name,
    kind,
    title: title ? title.text : (parsed.title ?? url),
    titleFromOriginal: title ? title.fromOriginal : parsed.title !== null,
    blocks: resolveContentsLinks(parsed.blocks),
    references,
    parseMs: performance.now() - t0,
  };
}

async function markdownFixture(name: string, markdown: string): Promise<Fixture> {
  const t0 = performance.now();
  const parsed = await parseMarkdownDocument(markdown, name);
  const fallback = name.replace(MARKDOWN_EXTENSIONS, "").trim();
  return {
    name,
    kind: "markdown",
    title: parsed.title ?? fallback,
    titleFromOriginal: parsed.title !== null && parsed.title !== fallback,
    blocks: resolveContentsLinks(parsed.blocks),
    references: parsed.references ?? [],
    parseMs: performance.now() - t0,
  };
}

async function loadSource(source: string): Promise<Fixture> {
  if (source.startsWith("synthetic:")) return synthetic(source);
  if (/^https?:\/\//i.test(source)) {
    const fetched = await fetchPage(source);
    if (fetched.kind === "pdf") return pdfFixture(basename(new URL(source).pathname) || source, fetched.bytes);
    return htmlFixture(source, fetched.html, source, "url");
  }
  const path = isAbsolute(source) ? source : join(ROOT, source);
  if (/\.pdf$/i.test(source)) return pdfFixture(basename(source), new Uint8Array(readFileSync(path)));
  return markdownFixture(basename(source), readFileSync(path, "utf8"));
}

// ── Synthetic fixtures: every shape the converter must map ──────────────────

const cellGap = (sep: string) => `<span class="cell-gap">${sep}</span>`;
function pdfTable(rows: string[][], header: boolean): Pick<ParsedBlock, "text" | "html"> {
  const rowHtml = (cells: string[], tag: string, r: number) =>
    `<tr>${cells.map((c, k) => `<${tag}>${c}${k < cells.length - 1 ? cellGap("\t") : r < rows.length - 1 ? cellGap("\n") : ""}</${tag}>`).join("")}</tr>`;
  const body = header ? rows.slice(1) : rows;
  return {
    text: rows.map((r) => r.join("\t")).join("\n"),
    html: `<table>${header ? `<thead>${rowHtml(rows[0], "th", 0)}</thead>` : ""}<tbody>${body.map((r, i) => rowHtml(r, "td", (header ? 1 : 0) + i)).join("")}</tbody></table>`,
  };
}
const span = (text: string, part: string) => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length, quotedText: part });

function syntheticPdf(): Fixture {
  const square = { kind: "path" as const, points: [[10, 10], [90, 10], [90, 50], [10, 50]] as [number, number][] };
  const p0 = "Alpha beta gamma delta. This abstract has bold words and a link.";
  const p2 = "The first page ends in this sentence. The second page begins with these words.";
  const l3 = "- first point\n- second point\n  - nested point\n- fourth point on the next page";
  const c9 = "for x in xs:\n    print(x)";
  const p16 = "Words of page ten, then page eleven starts here and page twelve starts there.";
  const table = pdfTable([["Model", "BLEU", "Cost"], ["Base", "27.3", "3.3"], ["Big", "28.4", "23.0"]], true);
  const blocks: Block[] = [
    { type: "PARAGRAPH", text: p0, page: 1, styles: [{ ...span(p0, "bold words"), style: "bold" }], links: [{ ...span(p0, "a link"), href: "https://example.com/" }] },
    { type: "HEADING", text: "1 Introduction", html: "<h1>", page: 1 },
    { type: "PARAGRAPH", text: p2, page: 1, pageStarts: [{ offset: p2.indexOf("The second"), page: 2 }] },
    { type: "LIST", text: l3, page: 2, pageStarts: [{ offset: l3.indexOf("- fourth"), page: 3 }] },
    { type: "TABLE", ...table, page: 3 },
    { type: "FIGURE", text: "Figure 1: The model architecture.", page: 3, region: square },
    { type: "FIGURE", text: "", page: 4, region: { kind: "ellipse", cx: 50, cy: 40, rx: 30, ry: 20 } },
    { type: "PARAGRAPH", text: "Words after the figure on page four.", page: 4 },
    { type: "CODE", text: "def attention(q, k, v):\n    return softmax(q @ k.T) @ v", page: 5 },
    { type: "CODE", text: c9, page: 5, pageStarts: [{ offset: c9.indexOf("    print"), page: 6 }] },
    { type: "PARAGRAPH", text: "Page seven is blank; this paragraph starts page eight.", page: 8 },
    { type: "PARAGRAPH", text: `zero${ZWSP}width space inside words`, page: 8 },
    { type: "PARAGRAPH", text: "lorem ipsum dolor sit amet ".repeat(9300).trim(), page: 8 },
    { type: "LIST", text: "3. third item\n4. fourth item\n  1. nested numbered", page: 8 },
    { type: "LIST", text: "1 Introduction\n2 Method", page: 9, links: [{ start: 0, end: 14, quotedText: "1 Introduction", targetOrder: 1 }, { start: 15, end: 23, quotedText: "2 Method", targetOrder: 17 }] },
    { type: "LIST", text: "(a) a lettered item kept as words\n(b) the second one", page: 9 },
    { type: "PARAGRAPH", text: p16, page: 10, pageStarts: [{ offset: p16.indexOf("page eleven"), page: 11 }, { offset: p16.indexOf("page twelve"), page: 12 }] },
    { type: "HEADING", text: "2 Method", html: "<h2>", page: 13 },
    { type: "PARAGRAPH", text: "The last words of the paper.", page: 13 },
  ];
  return { name: "synthetic:pdf", kind: "pdf", title: "A Synthetic Paper", titleFromOriginal: true, blocks, pageSize: { width: 595.28, height: 841.89 }, references: [], parseMs: 0 };
}

function syntheticUrl(): Fixture {
  const lede = "The lede cites a study and links to a site.";
  const mixed = "Bold and italic, then some code in a line.";
  const tableHtml =
    '<table><thead><tr><th rowspan="2">Region</th><th colspan="2">Sales</th></tr><tr><th>2023</th><th>2024</th></tr></thead>' +
    "<tbody><tr><td>North</td><td>10</td><td>12</td></tr><tr><td><p>South</p><p>and islands</p></td><td>7</td><td>9</td></tr></tbody></table>";
  const blocks: Block[] = [
    { type: "PARAGRAPH", text: "SCIENCE", html: '<p class="kicker">' },
    { type: "PARAGRAPH", text: "By Ada Writer · May 1, 2025", html: '<p class="meta">' },
    { type: "PARAGRAPH", text: lede, citations: [{ ...span(lede, "a study"), refId: "r1" }], links: [{ ...span(lede, "a site"), href: "https://example.org/" }], styles: [{ ...span(lede, "lede"), style: "italic" }] },
    { type: "HEADING", text: "Background", html: "<h2>" },
    { type: "PARAGRAPH", text: "A pull quote stands apart.", html: '<p class="quote">' },
    { type: "PARAGRAPH", text: "Centered words.", html: '<p class="center">' },
    { type: "PARAGRAPH", text: "Right-aligned words.", html: '<p class="right">' },
    { type: "PARAGRAPH", text: "LABEL LINE", html: '<p class="label">' },
    { type: "PARAGRAPH", text: "Display words", html: '<p class="display">' },
    { type: "PARAGRAPH", text: "A caption standing alone.", html: '<p class="caption">' },
    { type: "LIST", text: "Background\nResults", html: '<ol class="contents">', links: [{ start: 0, end: 10, quotedText: "Background", targetOrder: 3 }, { start: 11, end: 18, quotedText: "Results", targetOrder: 14 }] },
    { type: "LIST", text: "3. third\n4. fourth\n  - nested bullet", html: '<ol start="3"><li>third</li><li>fourth<ul><li>nested bullet</li></ul></li></ol>' },
    { type: "TABLE", text: "Region\tSales\t\nRegion\t2023\t2024\nNorth\t10\t12\nSouth and islands\t7\t9", html: tableHtml },
    { type: "CODE", text: "npm install\nnpm run dev" },
    { type: "HEADING", text: "Results", html: "<h2>" },
    { type: "EQUATION", text: "E = mc^2" },
    { type: "SEPARATOR", text: "---" },
    { type: "FIGURE", text: "Figure 1. Sales by year.", html: '<figure><img src="https://example.com/chart.png" alt="Sales chart" width="600"><figcaption>Figure 1. Sales by year.</figcaption></figure>' },
    { type: "FIGURE", text: "Left\nRight", html: '<figure class="row"><figure><img src="https://example.com/a.png" alt="A"><figcaption>Left</figcaption></figure><figure><img src="https://example.com/b.png" alt="B"><figcaption>Right</figcaption></figure></figure>' },
    { type: "PARAGRAPH", text: "First line\nSecond line" },
    { type: "PARAGRAPH", text: "A centered quote.", html: '<p class="quote center">' },
    { type: "LIST", text: "- Term — definition text" },
    { type: "PARAGRAPH", text: mixed, styles: [{ ...span(mixed, "Bold"), style: "bold" }, { ...span(mixed, "italic"), style: "italic" }, { ...span(mixed, "some code"), style: "code" }] },
  ];
  return {
    name: "synthetic:url",
    kind: "url",
    title: "A Synthetic Web Page",
    titleFromOriginal: true,
    blocks,
    references: [{ id: "r1", label: "1", text: "A study of things.", url: null }],
    parseMs: 0,
  };
}

const SYNTHETIC_MARKDOWN = `---
title: Front Matter Title
---

# Front Matter Title

Intro paragraph with **bold**, *italic*, \`code\`, a [link](https://example.com/), and a [jump](#details).

## Details

- one
- two
  - two point one
- three

3. three
4. four

| Name | Value |
|------|-------|
| a    | 1     |
| b    | 2     |

\`\`\`js
console.log("hi");
\`\`\`

$$
a^2 + b^2 = c^2
$$

> A quoted paragraph.

---

![Chart](https://example.com/chart.png)

Footnote here.[^1]

[^1]: The footnote text.
`;

async function synthetic(source: string): Promise<Fixture> {
  if (source === "synthetic:pdf") return syntheticPdf();
  if (source === "synthetic:url") return syntheticUrl();
  if (source === "synthetic:markdown") return markdownFixture("synthetic.md", SYNTHETIC_MARKDOWN);
  throw new Error(`unknown fixture ${source}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const sources = (named.length ? named : defaultSources()).filter((s) => !(offline && /^https?:\/\//i.test(s)));
  const reports: Report[] = [];
  for (const source of sources) {
    let fixture: Fixture;
    try {
      fixture = await loadSource(source);
    } catch (err) {
      reports.push({
        fixture: source,
        kind: "url",
        blocks: 0,
        rows: 0,
        size: null,
        jsonBytes: 0,
        figures: 0,
        pageStarts: 0,
        ms: { parse: 0, convert: 0, sanitize: 0, derive: 0 },
        guard: "",
        lines: [{ level: "FAIL", name: "the source parses", detail: String(err instanceof Error ? err.message : err).slice(0, 300) }],
      });
      continue;
    }
    reports.push(await checkFixture(fixture));
  }

  let failed = 0;
  for (const r of reports) {
    console.log(`\n== ${r.fixture} (${r.kind}) · ${r.blocks} blocks → ${r.rows} rows, ${r.figures} figures, ${r.pageStarts} page starts, ${(r.jsonBytes / 1024).toFixed(1)} KB · parse ${r.ms.parse} ms, convert ${r.ms.convert} ms, sanitize ${r.ms.sanitize} ms, derive ${r.ms.derive} ms${r.guard ? ` · guard: ${r.guard}` : ""}`);
    for (const l of r.lines) {
      if (l.level === "FAIL") failed++;
      console.log(`${l.level} ${l.name}${l.detail ? ` — ${l.detail}` : ""}`);
    }
  }
  const checks = reports.reduce((n, r) => n + r.lines.filter((l) => l.level !== "NOTE").length, 0);
  console.log(`\n${reports.length} fixtures, ${checks} checks, ${failed} failed`);
  console.log("fixture | rows | nodes | JSON bytes | guard (1,500 rows or 1.5 MB) | convert ms");
  for (const r of reports) console.log(`${r.fixture} | ${r.rows} | ${r.size?.nodes ?? "-"} | ${r.jsonBytes} | ${r.guard || "-"} | ${r.ms.convert}`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(reports, null, 1));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
