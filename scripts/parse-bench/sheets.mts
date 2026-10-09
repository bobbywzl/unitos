// The sheets benchmark (SPEC.md §27): real .xlsx, .csv, and .tsv files parsed
// in-process the way an add parses them (parseSheetsFile, lib/parse/sheets.ts),
// each scored against a reference read by other software.
//
//   npx tsx scripts/parse-bench/sheets.mts [--only id,id] [--skip id,id] [--kind xlsx|csv]
//     [--baseline] [--save-baseline] [--worst n] [--detail id] [--json out.json]
//
// --json writes every file's scores and a digest of its blocks: two runs with
// the same digests parsed the same (a speed-up must keep them).
//
// The corpus (scripts/parse-bench/sheets-corpus.json) names each file's source,
// license, and what it exercises: Apache POI's, LibreOffice's, pandas', csvkit's,
// xlsx2csv's, and tablib's test files, csv-spectrum, real data sets, a few real
// files saved the way other spreadsheet programs save them (derived: another
// encoding, delimiter, or decimal comma), and synthetic workbooks for sizes
// and layouts no public file has. Round 2 added workbooks as people make
// them, from umya-spreadsheet's, readxl's, roo's, excelize's, agate-excel's,
// and pyexcel-xlsx's tests: ledgers and sales tables people attached to bug
// reports (Chinese, Japanese, Russian, German, Italian), wide and long
// sheets, merged headers, accounting formats, pivot tables and charts, and
// files saved by Google Sheets, LibreOffice, WPS, ONLYOFFICE, and Excel for
// Mac. Every URL names a commit, a tag, or a released package. The files
// are other people's: the first run fetches
// them into .bench/sheets/files (gitignored), and only numbers are committed.
//
// The reference never comes from the code under test. A workbook is read by
// Apache POI (sheets-ref/SheetsRef.java; jars from Maven Central into
// .bench/sheets/jars): the sheets in order with their names, every cell as
// Excel shows it (DataFormatter, cached formula values), the merges, the
// frozen rows and columns, hidden rows and columns left out. A .csv/.tsv is
// read by Python's csv module in the encoding the corpus records
// (sheets-ref/sheets_ref.py). A file the reference cannot read is listed and
// left out of the totals.
//
// The parse is read the way a reader reads it: the HEADING blocks name the
// sheets, and each SHEET block's grid is read from its html (td text without
// the invisible gaps, colspan and rowspan for merges, data-frozen-rows and
// data-frozen-cols). Per file:
//   sheets   the visible sheets' names in order (LCS over the longer list)
//   text     word-level F1 of the cells' values as a multiset (text kept)
//   cells    cells shown right at their row and column, over every cell either
//            side has (a number in General format is right when it reads as
//            the same number; every other cell must match as shown)
//   formats  the same, over the number cells with a number format only
//   merges   F1 of the merged ranges
//   frozen   frozen rows and columns equal the reference (per sheet)
//   lost     reference cells whose value the parse does not have (a count)
//   dom      SHEET blocks whose DOM text differs from the block text (SPEC.md
//            §5: the replica's text must equal the block's text)
// A file's score is the mean of the parts it has (formats only with formatted
// numbers, merges only when either side has one). Time per file and the heap
// a parse leaves are printed; the run's peak memory at the end.
//
// The sheet repairs on Jev (a model pass, SPEC.md §27) do not run: no key is
// set here, so the bench measures the deterministic parse, which is what
// reaches the repair.
//
// Baseline: scripts/parse-bench/sheets-baseline.json holds each file's scores
// (numbers only). --baseline lists every file whose score dropped by more than
// 0.01 and exits 1 when one did; --save-baseline writes the run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type DefaultTreeAdapterMap } from "parse5";

const { parseSheetsFile } = await import("@/lib/parse/sheets");
const { jevEnabled } = await import("@/lib/jev");

const ROOT = join(import.meta.dirname, "..", "..");
const BENCH = join(ROOT, ".bench", "sheets");
const FILES = join(BENCH, "files");
const SDISTS = join(BENCH, "sdist");
const JARS = join(BENCH, "jars");
// Bump when the reference builders change: references are rebuilt.
const REF_VERSION = 4;
const REFS = join(BENCH, `ref-v${REF_VERSION}`);
const CORPUS = join(import.meta.dirname, "sheets-corpus.json");
const BASELINE = join(import.meta.dirname, "sheets-baseline.json");
const REF_JAVA = join(import.meta.dirname, "sheets-ref", "SheetsRef.java");
const REF_PY = join(import.meta.dirname, "sheets-ref", "sheets_ref.py");
const MAVEN = "https://repo1.maven.org/maven2";
const POI_JARS = [
  "org/apache/poi/poi/5.4.1/poi-5.4.1.jar",
  "org/apache/poi/poi-ooxml/5.4.1/poi-ooxml-5.4.1.jar",
  "org/apache/poi/poi-ooxml-full/5.4.1/poi-ooxml-full-5.4.1.jar",
  "org/apache/xmlbeans/xmlbeans/5.3.0/xmlbeans-5.3.0.jar",
  "org/apache/commons/commons-compress/1.27.1/commons-compress-1.27.1.jar",
  "org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar",
  "commons-io/commons-io/2.18.0/commons-io-2.18.0.jar",
  "com/github/virtuald/curvesapi/1.08/curvesapi-1.08.jar",
  "org/apache/logging/log4j/log4j-api/2.24.3/log4j-api-2.24.3.jar",
  "org/apache/commons/commons-collections4/4.4/commons-collections4-4.4.jar",
  "commons-codec/commons-codec/1.18.0/commons-codec-1.18.0.jar",
  "org/apache/commons/commons-math3/3.6.1/commons-math3-3.6.1.jar",
  "com/zaxxer/SparseBitSet/1.3/SparseBitSet-1.3.jar",
];

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
function value(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const skip = value("--skip")?.split(",").map((s) => s.trim()).filter(Boolean);
const kind = value("--kind");
const worst = value("--worst") ? Number(value("--worst")) : 15;
const detail = value("--detail");

// ── The corpus ──────────────────────────────────────────────────────────────

type Entry = {
  id: string;
  url?: string;
  member?: string;
  license: string;
  ext: "xlsx" | "csv" | "tsv";
  csv?: { encoding: string; delimiter: string };
  derive?: { frm: string; encoding: string; delimiter: string; eol: string; decimalComma?: boolean; ext?: string };
  synth?: string;
  exercises: string;
};
const corpus = (JSON.parse(readFileSync(CORPUS, "utf8")) as { files: Entry[] }).files;
const byId = new Map(corpus.map((e) => [e.id, e]));
const fileOf = (e: Entry) => join(FILES, `${e.id}.${e.ext}`);
const refOf = (e: Entry) => join(REFS, `${e.id}.json`);

let entries = corpus;
if (detail) entries = entries.filter((e) => e.id === detail);
else if (only) entries = entries.filter((e) => only.includes(e.id));
if (skip) entries = entries.filter((e) => !skip.includes(e.id));
if (kind === "xlsx") entries = entries.filter((e) => e.ext === "xlsx");
else if (kind === "csv") entries = entries.filter((e) => e.ext !== "xlsx");

function curl(url: string, out: string): boolean {
  try {
    execFileSync("curl", ["-sS", "-f", "-L", "-o", out, url], { stdio: ["ignore", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function fetchEntry(e: Entry): boolean {
  const out = fileOf(e);
  if (existsSync(out)) return true;
  if (e.derive) {
    const src = byId.get(e.derive.frm);
    if (!src?.csv || !fetchEntry(src)) return false;
    const d = e.derive;
    execFileSync("python3", ["-I", REF_PY, "derive", fileOf(src), out, src.csv.encoding, src.csv.delimiter, d.encoding, d.delimiter, d.eol, d.decimalComma ? "1" : "0"]);
    return true;
  }
  if (e.synth) {
    execFileSync("python3", ["-I", REF_PY, "synth", e.synth, out]);
    return true;
  }
  if (!e.url) return false;
  if (e.url.startsWith("repo:")) {
    copyFileSync(join(ROOT, e.url.slice(5)), out);
    return true;
  }
  if (e.member) {
    const tarball = join(SDISTS, e.url.slice(e.url.lastIndexOf("/") + 1));
    if (!existsSync(tarball) && !curl(e.url, tarball)) return false;
    try {
      writeFileSync(out, execFileSync("tar", ["-xzOf", tarball, e.member], { maxBuffer: 1 << 30 }));
      return true;
    } catch {
      return false;
    }
  }
  return curl(e.url, out);
}

mkdirSync(FILES, { recursive: true });
mkdirSync(SDISTS, { recursive: true });
mkdirSync(REFS, { recursive: true });
const unfetched: string[] = [];
for (const e of entries) if (!fetchEntry(e)) unfetched.push(e.id);
if (unfetched.length > 0) console.log(`Not fetched (${unfetched.length}): ${unfetched.join(", ")}`);
entries = entries.filter((e) => !unfetched.includes(e.id));

// ── The references ──────────────────────────────────────────────────────────

const needRef = entries.filter((e) => !existsSync(refOf(e)));
if (needRef.some((e) => e.ext === "xlsx")) {
  mkdirSync(JARS, { recursive: true });
  for (const jar of POI_JARS) {
    const out = join(JARS, jar.slice(jar.lastIndexOf("/") + 1));
    if (!existsSync(out) && !curl(`${MAVEN}/${jar}`, out)) throw new Error(`Could not fetch ${jar}`);
  }
  const args: string[] = [];
  for (const e of needRef.filter((x) => x.ext === "xlsx")) {
    // A Strict OOXML workbook goes to POI in the transitional namespaces.
    const transitional = join(REFS, `${e.id}.transitional.xlsx`);
    execFileSync("python3", ["-I", REF_PY, "strict", fileOf(e), transitional]);
    args.push(existsSync(transitional) ? transitional : fileOf(e), refOf(e));
  }
  console.log(`Building ${args.length / 2} workbook references with Apache POI`);
  execFileSync("java", ["-Xmx2g", "-cp", `${JARS}/*`, REF_JAVA, ...args], { stdio: ["ignore", "ignore", "inherit"] });
}
for (const e of needRef.filter((x) => x.ext !== "xlsx")) {
  if (!e.csv) throw new Error(`${e.id}: a delimited file needs its encoding and delimiter`);
  execFileSync("python3", ["-I", REF_PY, "csv", fileOf(e), refOf(e), e.csv.encoding, e.csv.delimiter]);
}

// ── Reading a parse ─────────────────────────────────────────────────────────

type RefCell = { t: string; k: "s" | "n" | "b" | "e"; g?: 1; v?: number } | null;
type RefSheet = { name: string | null; hidden: boolean; chartsheet?: boolean; rows: RefCell[][]; merges: number[][]; frozenRows: number; frozenCols: number; cutRows?: number };
type Ref = { sheets?: RefSheet[]; error?: string };
type ParsedSheet = { name: string; grid: string[][]; merges: number[][]; frozenRows: number; frozenCols: number; domOk: boolean; cut: boolean };

// The html is read by parse5, the HTML parser jsdom runs, into its plain
// tree: the same tree a browser builds, without a DOM's weight. A jsdom
// window per sheet took gigabytes on a sheet of 100,000 cells.
type P5Node = DefaultTreeAdapterMap["node"];
type P5Element = DefaultTreeAdapterMap["element"];

const isElement = (n: P5Node): n is P5Element => "tagName" in n;
const attrOf = (el: P5Element, name: string): string | null => el.attrs.find((a) => a.name === name)?.value ?? null;
const hasClass = (el: P5Element, name: string) => (attrOf(el, "class") ?? "").split(/\s+/).includes(name);
const elementChildren = (el: P5Element): P5Element[] => el.childNodes.filter(isElement);

/** Is the node inside an element (itself included) that matches. */
function within(node: P5Node, match: (el: P5Element) => boolean): boolean {
  let at: P5Node | null = isElement(node) ? node : "parentNode" in node ? node.parentNode : null;
  for (; at && isElement(at); at = at.parentNode) if (match(at)) return true;
  return false;
}

const skipped = (el: P5Element) => attrOf(el, "data-anchor-skip") !== null;

/** Every text node under the node, in document order, with what its
    ancestors say: [data-anchor-skip] (SPEC.md §5) and .cell-gap. */
function texts(node: P5Node, out: { text: string; skip: boolean; gap: boolean }[] = [], skip = false, gap = false): typeof out {
  if (node.nodeName === "#text") out.push({ text: (node as DefaultTreeAdapterMap["textNode"]).value, skip, gap });
  if (isElement(node) || node.nodeName === "#document") {
    const el = isElement(node) ? node : null;
    const s = skip || (el !== null && skipped(el));
    const g = gap || (el !== null && hasClass(el, "cell-gap"));
    for (const c of (node as P5Element).childNodes) texts(c, out, s, g);
  }
  return out;
}

/** The text a reader selects in an element: every text node outside
    [data-anchor-skip] (lib/anchors/dom.ts anchorableText). */
function anchorable(el: P5Element): string {
  const skip = within(el, skipped);
  return texts(el, [], skip).filter((t) => !t.skip).map((t) => t.text).join("");
}

/** A cell's words as shown: its text without the invisible gaps. */
function cellText(td: P5Element): string {
  const skip = within(td, skipped);
  const gap = within(td, (el) => hasClass(el, "cell-gap"));
  return texts(td, [], skip, gap).filter((t) => !t.skip && !t.gap).map((t) => t.text).join("");
}

/** The first element in document order that matches. */
function find(node: P5Node, match: (el: P5Element) => boolean): P5Element | null {
  if (isElement(node) && match(node)) return node;
  for (const c of (node as P5Element).childNodes ?? []) {
    const hit = find(c, match);
    if (hit) return hit;
  }
  return null;
}

/** ".sheet-inner > table > tbody > tr" inside the sheet. */
function sheetRows(sheet: P5Element): P5Element[] {
  const out: P5Element[] = [];
  const walk = (el: P5Element) => {
    for (const c of elementChildren(el)) {
      if (c.tagName === "tr" && el.tagName === "tbody") {
        const table = el.parentNode;
        const inner = table && isElement(table) ? table.parentNode : null;
        if (table && isElement(table) && table.tagName === "table" && inner && isElement(inner) && hasClass(inner, "sheet-inner")) out.push(c);
      }
      walk(c);
    }
  };
  walk(sheet);
  return out;
}

function readSheet(name: string, html: string, text: string): ParsedSheet {
  const doc = parse(`<!doctype html><body>${html}</body>`);
  const body = find(doc, (el) => el.tagName === "body")!;
  const sheet = find(body, (el) => hasClass(el, "sheet"));
  const grid: string[][] = [];
  const merges: number[][] = [];
  const taken = new Set<string>();
  const rows = sheet ? sheetRows(sheet) : [];
  rows.forEach((tr, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const td of elementChildren(tr).filter((el) => el.tagName === "td")) {
      if (/(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/i.test(attrOf(td, "style") ?? "")) continue;
      while (taken.has(`${r},${c}`)) c++;
      const colspan = Number(attrOf(td, "colspan") ?? 1) || 1;
      const rowspan = Number(attrOf(td, "rowspan") ?? 1) || 1;
      grid[r][c] = cellText(td);
      if (colspan > 1 || rowspan > 1) {
        merges.push([r, c, r + rowspan - 1, c + colspan - 1]);
        for (let dr = 0; dr < rowspan; dr++) for (let dc = 0; dc < colspan; dc++) if (dr || dc) taken.add(`${r + dr},${c + dc}`);
      }
      c += colspan;
    }
  });
  return {
    name,
    grid,
    merges,
    frozenRows: Number((sheet && attrOf(sheet, "data-frozen-rows")) ?? 0),
    frozenCols: Number((sheet && attrOf(sheet, "data-frozen-cols")) ?? 0),
    domOk: anchorable(body) === text,
    cut: false,
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const norm = (s: string) => s.replace(/[   ]/g, " ").replace(/ {2,}/g, " ").trim();

/** Is the parse's cell the reference cell as shown. Line ends compare as
    one: the html parser reads a cell's CR LF as LF, so a cell's text can
    never show a CR. A number format's double quotes mark literal text and
    never show (ECMA-376 §18.8.31); POI's DataFormatter keeps them after a
    date code (dd"-"mm"-"yyyy" "hh:mm:ss shows as 03"-"08"-"2017" "14:35:00),
    so a formatted number matches with them dropped. */
function cellRight(ref: RefCell, got: string | undefined): boolean {
  const g = (got ?? "").replace(/\r\n?/g, "\n");
  if (!ref) return g === "";
  const t = ref.t.replace(/\r\n?/g, "\n");
  if (ref.k !== "n") return g === t;
  if (norm(g) === norm(t) || (!ref.g && t.includes('"') && norm(g) === norm(t.replace(/"/g, "")))) return true;
  if (ref.g && ref.v !== undefined && NUMBER.test(g.trim())) {
    const n = Number(g.trim());
    return Math.abs(n - ref.v) <= 1e-9 * Math.max(1, Math.abs(ref.v));
  }
  return false;
}

function lcsPairs(a: string[], b: string[]): [number, number][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const words = (s: string) => norm(s).toLowerCase().split(/\s+/).filter(Boolean);

type Counts = { right: number; total: number };
type FileResult = {
  id: string;
  ext: string;
  score: number;
  sheets: number;
  text: number;
  cells: number;
  formats: number | null;
  merges: number | null;
  frozen: number | null;
  lost: number;
  dom: number;
  ms: number;
  heapMb: number;
  // A digest of the parse's blocks: a speed-up must leave it as it was.
  digest?: string;
  error?: string;
  noRef?: string;
  notes: string[];
};

const ratio = (c: Counts) => (c.total === 0 ? 1 : c.right / c.total);
const f1 = (tp: number, fp: number, fn: number) => (tp + fp + fn === 0 ? 1 : (2 * tp) / (2 * tp + fp + fn));

function scoreFile(e: Entry, ref: RefSheet[], parsed: ParsedSheet[], show: boolean): Omit<FileResult, "ms" | "heapMb" | "id" | "ext"> {
  const notes: string[] = [];
  const visible = ref.filter((s) => !s.hidden);
  const refNames = visible.map((s) => s.name ?? e.id);
  const gotNames = parsed.map((s) => s.name);
  const pairs = lcsPairs(refNames, gotNames);
  const sheetScore = Math.max(refNames.length, gotNames.length) === 0 ? 1 : pairs.length / Math.max(refNames.length, gotNames.length);
  if (show && sheetScore < 1) notes.push(`sheets: reference [${refNames.join(" | ")}] parse [${gotNames.join(" | ")}]`);

  const cells: Counts = { right: 0, total: 0 };
  const formats: Counts = { right: 0, total: 0 };
  const frozen: Counts = { right: 0, total: 0 };
  let mergeTp = 0;
  let mergeFp = 0;
  let mergeFn = 0;
  let lost = 0;
  const refWords = new Map<string, number>();
  const gotWords = new Map<string, number>();
  const add = (m: Map<string, number>, s: string) => {
    for (const w of words(s)) m.set(w, (m.get(w) ?? 0) + 1);
  };
  const paired = new Map(pairs.map(([i, j]) => [i, j]));
  visible.forEach((rs, i) => {
    const j = paired.get(i);
    const ps = j === undefined ? null : parsed[j];
    if (!ps) {
      for (const row of rs.rows) for (const cell of row) if (cell) add(refWords, cell.t);
      for (const row of rs.rows) for (const cell of row) if (cell) {
        cells.total++;
        lost++;
        if (cell.k === "n" && !cell.g) formats.total++;
      }
      return;
    }
    const gotValues = new Map<string, number>();
    for (const row of ps.grid) for (const v of row ?? []) if (v) {
      add(gotWords, v);
      gotValues.set(norm(v), (gotValues.get(norm(v)) ?? 0) + 1);
    }
    const wrong: string[] = [];
    const rows = Math.max(rs.rows.length, ps.grid.length);
    for (let r = 0; r < rows; r++) {
      const refRow = rs.rows[r] ?? [];
      const gotRow = ps.grid[r] ?? [];
      const cols = Math.max(refRow.length, gotRow.length);
      for (let c = 0; c < cols; c++) {
        const rc = refRow[c] ?? null;
        const g = gotRow[c] ?? "";
        if (!rc && g === "") continue;
        cells.total++;
        const ok = cellRight(rc, g);
        if (ok) cells.right++;
        // A cell shown right adds the same words on both sides: a number in
        // General format is right however many digits it shows.
        if (rc) add(refWords, ok ? g : rc.t);
        if (rc && rc.k === "n" && !rc.g) {
          formats.total++;
          if (ok) formats.right++;
        }
        if (rc) {
          const key = norm(rc.t);
          const have = gotValues.get(key) ?? 0;
          if (have > 0) gotValues.set(key, have - 1);
          else if (!(rc.k === "n" && ok)) lost++;
        }
        if (!ok && wrong.length < 40) wrong.push(`  ${String.fromCharCode(65 + (c % 26))}${c >= 26 ? c : ""}${r + 1}  ref ${JSON.stringify(rc?.t ?? "")}${rc?.k === "n" ? ` (number${rc.g ? ", General" : ""}${rc.v !== undefined ? ` ${rc.v}` : ""})` : ""}  parse ${JSON.stringify(g)}`);
      }
    }
    const key = (m: number[]) => m.join(",");
    const refMerges = new Set(rs.merges.map(key));
    const gotMerges = new Set(ps.merges.map(key));
    for (const m of refMerges) if (gotMerges.has(m)) mergeTp++;
    else mergeFn++;
    for (const m of gotMerges) if (!refMerges.has(m)) mergeFp++;
    if (!rs.chartsheet) {
      frozen.total++;
      // Frozen rows and columns past the reference's words are not seen:
      // both sides count only those inside the reference's grid.
      const refCols = rs.rows.reduce((m, row) => Math.max(m, row.length), 0);
      const pr = Math.min(ps.frozenRows, rs.rows.length);
      const pc = Math.min(ps.frozenCols, refCols);
      if (Math.min(rs.frozenRows, rs.rows.length) === pr && Math.min(rs.frozenCols, refCols) === pc) frozen.right++;
      else if (show) notes.push(`${rs.name ?? e.id}: frozen rows ${ps.frozenRows} cols ${ps.frozenCols}, reference ${rs.frozenRows} and ${rs.frozenCols}`);
    }
    if (show) {
      if (rs.rows.length !== ps.grid.length) notes.push(`${rs.name ?? e.id}: ${ps.grid.length} rows, reference ${rs.rows.length}${rs.cutRows ? ` (cut from ${rs.cutRows})` : ""}`);
      const missing = [...refMerges].filter((m) => !gotMerges.has(m));
      const extra = [...gotMerges].filter((m) => !refMerges.has(m));
      if (missing.length || extra.length) notes.push(`${rs.name ?? e.id}: merges missing [${missing.slice(0, 10).join(" ")}] extra [${extra.slice(0, 10).join(" ")}]`);
      if (wrong.length) notes.push(`${rs.name ?? e.id}: cells shown wrong (first ${wrong.length}):\n${wrong.join("\n")}`);
    }
  });
  let tp = 0;
  let fn = 0;
  for (const [w, n] of refWords) {
    const g = gotWords.get(w) ?? 0;
    tp += Math.min(n, g);
    fn += Math.max(0, n - g);
  }
  let fp = 0;
  for (const [w, n] of gotWords) fp += Math.max(0, n - (refWords.get(w) ?? 0));
  const text = f1(tp, fp, fn);
  const hasMerges = mergeTp + mergeFp + mergeFn > 0;
  const parts = [sheetScore, text, ratio(cells)];
  const fmt = formats.total > 0 ? ratio(formats) : null;
  if (fmt !== null) parts.push(fmt);
  const merges = hasMerges ? f1(mergeTp, mergeFp, mergeFn) : null;
  if (merges !== null) parts.push(merges);
  const fr = e.ext === "xlsx" && frozen.total > 0 ? ratio(frozen) : null;
  if (fr !== null) parts.push(fr);
  return {
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
    sheets: sheetScore,
    text,
    cells: ratio(cells),
    formats: fmt,
    merges,
    frozen: fr,
    lost,
    dom: parsed.filter((s) => !s.domOk).length,
    notes,
  };
}

// ── The run ─────────────────────────────────────────────────────────────────

if (jevEnabled()) console.log("Note: Jev is configured here; the sheet repairs run and the scores are not the deterministic parse's.");
const gc = (globalThis as { gc?: () => void }).gc;
const results: FileResult[] = [];
let n = 0;
for (const e of entries) {
  n++;
  const ref = JSON.parse(readFileSync(refOf(e), "utf8")) as Ref;
  const base = { id: e.id, ext: e.ext, score: 0, sheets: 0, text: 0, cells: 0, formats: null, merges: null, frozen: null, lost: 0, dom: 0, ms: 0, heapMb: 0, notes: [] as string[] };
  if (!ref.sheets) {
    results.push({ ...base, noRef: ref.error ?? "no reference" });
    continue;
  }
  const bytes = new Uint8Array(readFileSync(fileOf(e)));
  gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  let pictures = 0;
  let parsed: ParsedSheet[] = [];
  let error: string | undefined;
  try {
    const doc = await parseSheetsFile(bytes, `${e.id}.${e.ext}`, { storeImage: async () => `/api/images/bench-${++pictures}` });
    const ms = performance.now() - started;
    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1e6;
    let name: string | null = null;
    for (const b of doc.blocks) {
      if (b.type === "HEADING") {
        if (name !== null) parsed.push({ name, grid: [], merges: [], frozenRows: 0, frozenCols: 0, domOk: true, cut: false });
        name = b.text;
      } else if (b.type === "SHEET" && name !== null) {
        parsed.push(readSheet(name, b.html ?? "", b.text));
        name = null;
      } else if (b.type === "PARAGRAPH" && /^Cut at row/.test(b.text) && parsed.length > 0) {
        parsed[parsed.length - 1].cut = true;
      }
    }
    if (name !== null) parsed.push({ name, grid: [], merges: [], frozenRows: 0, frozenCols: 0, domOk: true, cut: false });
    const scored = scoreFile(e, ref.sheets, parsed, Boolean(detail));
    const digest = createHash("sha256").update(JSON.stringify(doc.blocks)).digest("hex").slice(0, 16);
    results.push({ ...base, ...scored, ms, heapMb, digest });
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 120) : String(err);
    parsed = [];
    const scored = scoreFile(e, ref.sheets, [], Boolean(detail));
    results.push({ ...base, ...scored, score: 0, ms: performance.now() - started, error });
  }
  if (!detail && n % 20 === 0) process.stdout.write(`  ${n}/${entries.length}\n`);
}

// ── The report ──────────────────────────────────────────────────────────────

const fmt = (x: number | null) => (x === null ? "  -  " : x.toFixed(3));
const scored = results.filter((r) => !r.noRef);
if (detail) {
  for (const r of results) {
    const e = byId.get(r.id)!;
    console.log(`── ${r.id}  (${e.exercises})`);
    if (r.noRef) {
      console.log(`no reference: ${r.noRef}`);
      continue;
    }
    console.log(`score ${fmt(r.score)}  sheets ${fmt(r.sheets)}  text ${fmt(r.text)}  cells ${fmt(r.cells)}  formats ${fmt(r.formats)}  merges ${fmt(r.merges)}  frozen ${fmt(r.frozen)}  lost ${r.lost}  dom ${r.dom}  ${r.ms.toFixed(0)} ms${r.error ? `  error: ${r.error}` : ""}`);
    for (const note of r.notes) console.log(note);
  }
} else {
  console.log(`\nWorst ${Math.min(worst, scored.length)} files by score:`);
  for (const r of [...scored].sort((a, b) => a.score - b.score).slice(0, worst)) {
    console.log(`  ${r.id.padEnd(44)} ${fmt(r.score)}  sheets ${fmt(r.sheets)} text ${fmt(r.text)} cells ${fmt(r.cells)} formats ${fmt(r.formats)} merges ${fmt(r.merges)} frozen ${fmt(r.frozen)} lost ${r.lost}${r.dom ? ` dom ${r.dom}` : ""}${r.error ? `  error: ${r.error}` : ""}`);
  }
  const noRef = results.filter((r) => r.noRef);
  if (noRef.length > 0) {
    console.log(`\nNo reference (left out of the totals): ${noRef.length}`);
    for (const r of noRef) console.log(`  ${r.id}  ${r.noRef}`);
  }
  const slow = [...scored].sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log(`\nSlowest: ${slow.map((r) => `${r.id} ${r.ms.toFixed(0)} ms (${r.heapMb.toFixed(0)} MB heap)`).join(", ")}`);
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const meanOf = (key: "score" | "sheets" | "text" | "cells" | "formats" | "merges" | "frozen") =>
  mean(scored.map((r) => r[key]).filter((x): x is number => x !== null));
const total = {
  score: meanOf("score"),
  sheets: meanOf("sheets"),
  text: meanOf("text"),
  cells: meanOf("cells"),
  formats: meanOf("formats"),
  merges: meanOf("merges"),
  frozen: meanOf("frozen"),
  lost: scored.reduce((a, r) => a + r.lost, 0),
  dom: scored.reduce((a, r) => a + r.dom, 0),
  errors: scored.filter((r) => r.error).length,
};
const byKind = (k: "xlsx" | "csv") => mean(scored.filter((r) => (k === "xlsx" ? r.ext === "xlsx" : r.ext !== "xlsx")).map((r) => r.score));
console.log(
  `\nSheets  score ${fmt(total.score)}  (xlsx ${fmt(byKind("xlsx"))}, csv/tsv ${fmt(byKind("csv"))})  sheets ${fmt(total.sheets)}  text ${fmt(total.text)}  cells ${fmt(total.cells)}  ` +
    `formats ${fmt(total.formats)}  merges ${fmt(total.merges)}  frozen ${fmt(total.frozen)}  lost ${total.lost}  dom ${total.dom}  errors ${total.errors}  ` +
    `files ${scored.length}  time ${mean(scored.map((r) => r.ms)).toFixed(0)} ms/file, ${scored.reduce((a, r) => a + r.ms, 0).toFixed(0)} ms in all  peak ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB`,
);

const json = value("--json");
if (json) writeFileSync(json, JSON.stringify({ total, results }, null, 2));

type Row = { score: number; text: number; cells: number; formats: number | null; merges: number | null; frozen: number | null; lost: number; dom: number };
type Baseline = { total: typeof total; files: Record<string, Row> };
const round = (x: number) => Math.round(x * 1000) / 1000;
const rowOf = (r: FileResult): Row => ({
  score: round(r.score),
  text: round(r.text),
  cells: round(r.cells),
  formats: r.formats === null ? null : round(r.formats),
  merges: r.merges === null ? null : round(r.merges),
  frozen: r.frozen === null ? null : round(r.frozen),
  lost: r.lost,
  dom: r.dom,
});
if (flag("--baseline") && existsSync(BASELINE)) {
  const base: Baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const drops = scored.filter((r) => base.files[r.id] && r.score < base.files[r.id].score - 0.01);
  const rises = scored.filter((r) => base.files[r.id] && r.score > base.files[r.id].score + 0.01);
  console.log(`\nAgainst the baseline (score ${fmt(base.total.score)}): ${rises.length} files rose, ${drops.length} dropped`);
  for (const r of rises) console.log(`  rose ${r.id}  ${fmt(base.files[r.id].score)} → ${fmt(r.score)}`);
  for (const r of drops) console.log(`  dropped ${r.id}  ${fmt(base.files[r.id].score)} → ${fmt(r.score)}`);
  if (drops.length > 0) process.exitCode = 1;
}
if (flag("--save-baseline") && !detail) {
  const prior: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { total, files: {} };
  for (const r of scored) prior.files[r.id] = rowOf(r);
  if (!only && !kind && !skip) {
    prior.total = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, round(v)])) as typeof total;
  }
  writeFileSync(BASELINE, JSON.stringify(prior, null, 1) + "\n");
  console.log(`Saved ${scored.length} files to ${BASELINE}`);
}
