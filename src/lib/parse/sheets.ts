import { createHash } from "node:crypto";
import * as ssf from "ssf";
import type { ParsedBlock, ParsedDocument } from "@/lib/parse/types";
import { decodeTextFile } from "@/lib/parse/charset";
import { computeFormula, sharedFormula, type CellValue } from "@/lib/sheet-formulas";
import { renderChart } from "@/lib/parse/chart";
import { fontListAttr } from "@/lib/office-fonts";
import { JEV_MODEL, jevEnabled, systemOne, type JevQuestion } from "@/lib/jev";
import type { SlideImageStore } from "@/lib/parse/slides";
import { parseXmlStream, type XmlElement } from "@/lib/parse/xml-stream";
import {
  attr,
  boolAttr,
  child,
  children,
  cleanText,
  cssValue,
  descendants,
  escapeHtml,
  fontFamilyCss,
  intAttr,
  modifyColor,
  num,
  parseHexColor,
  parseTheme,
  parseXmlPart,
  partRels,
  partText,
  relsOfType,
  resolveDrawingColor,
  rgbCss,
  sniffOfficeFile,
  textGap,
  themeAccents,
  unzipOffice,
  type OfficeZip,
  type Relationship,
  type Rgb,
  type ThemeColors,
} from "@/lib/parse/office";

// The sheets parser (SPEC.md §27): a .xlsx — an upload, or a Google Sheets
// file Drive exported — or a .csv/.tsv read into one HEADING block (the
// sheet's name) and one SHEET block per sheet. The block's html is the
// sheet as a grid: column letters across the top and row numbers down the
// side (both data-anchor-skip), every cell at the sheet's column width and
// row height, showing the value as the sheet formats it (the number
// format applied, so 0.1 with a percent format reads 10%), in the cell's
// font, weight, color, fill, alignment, and borders; merged cells span;
// frozen rows and columns stay in view; a formula rides on its cell as a
// tooltip; the sheet's drawings — pictures, charts drawn as SVG
// (lib/parse/chart.ts), shapes — lie over the grid at the cells they are
// anchored to. The block's text is the rows, cells separated by tabs and
// rows by newlines, and the grid's DOM text is exactly that text (SPEC.md
// §5): every cell ends in an invisible gap, a merged-away cell's tab rides
// inside the cell that covers it, and a drawing's words are skipped, its
// chart data laid under it invisible as the block's words. Hidden rows and
// columns are left out of both. A sheet past the caps is cut and says so.

export const SHEET_MAX_ROWS = 10_000;
export const SHEET_MAX_COLS = 256;
export const SHEET_MAX_CELLS = 200_000;

const ROW_NUMBER_WIDTH_PX = 44;
const HEADER_HEIGHT_PX = 24;
const DEFAULT_ROW_HEIGHT_PT = 15;
const DEFAULT_COL_WIDTH_CHARS = 8.43;

// ── Model ────────────────────────────────────────────────────────────────────

type CellKind = "text" | "number" | "bool" | "error" | "empty";

type Border = { width: number; style: "solid" | "dashed" | "dotted" | "double"; color: string } | null;

type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  fill?: string;
  font?: string;
  sizePt?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  indent?: number;
  borders?: { top: Border; right: Border; bottom: Border; left: Border };
};

// A formula's cell keeps its number format (a code or a built-in id): the
// reader's sheet computes the formula again and shows its value in it
// (lib/replica.ts, lib/sheet-formulas.ts).
// hashes: a date format given a number no date has, which Excel shows as
// a row of "#" across the cell (the row's width is set once the columns
// are read).
type Cell = { text: string; kind: CellKind; styleId: number | null; href?: string; formula?: string; format?: string | number; number?: number; hashes?: true };

type Row = { cells: Cell[]; heightPt: number | null };

type Merge = { r0: number; c0: number; r1: number; c1: number };

// One drawing anchored to the sheet: a picture, a chart, or a shape. The
// anchor is a cell and an offset into it (EMU) at each corner.
type Anchor = { col: number; colOff: number; row: number; rowOff: number };
type Drawing = {
  from: Anchor;
  // The far corner, or the size in EMU when the drawing is anchored by one cell.
  to: Anchor | null;
  ext: { cx: number; cy: number } | null;
  content:
    | { kind: "image"; url: string }
    | { kind: "chart"; svg: string; text: string; html: string }
    | { kind: "shape"; html: string; fill: string | null };
};

type Sheet = {
  name: string;
  rows: Row[];
  colWidths: (number | null)[]; // chars; null = default
  merges: Merge[];
  frozenRows: number;
  frozenCols: number;
  defaultRowHeightPt: number;
  defaultColWidthChars: number;
  cutRows: number | null; // the sheet's row count when cut short
  drawings: Drawing[];
};

type Workbook = {
  sheets: Sheet[];
  styles: CellStyle[]; // by xf index
  styleKey: string; // the class prefix the styles render under
  fonts: string[]; // every typeface the cells name, for the reader's web fonts
};

export type SheetsParseOptions = {
  // Where a sheet's pictures go (lib/parse/slides.ts SlideImageStore); no
  // store = pictures are left out.
  storeImage?: SlideImageStore;
};

// ── Entry: a sheets file's bytes ─────────────────────────────────────────────

/** A cell's words as the grid shows them: control characters dropped
    (cleanText), and every line break LF. The html reads a CR LF or a CR as
    LF, so a CR left in the block's text would break the rule that the
    replica's DOM text equals it. Sheets benchmark finding: a quoted CSV
    field written on Windows or a classic Mac, and a cell with an
    _x000D_ escape. */
function cellText(text: string): string {
  return cleanText(text).replace(/\r\n?/g, "\n");
}

/** A sheets file as the add reads it (lib/parse/ingest.ts): a zip that is a
    workbook parses as one; anything else is delimited text, tabs for a .tsv
    and the delimiter sniffed otherwise. */
export async function parseSheetsFile(bytes: Uint8Array, filename: string, opts: SheetsParseOptions = {}): Promise<ParsedDocument> {
  if (sniffOfficeFile(bytes) === "xlsx") return parseSheets(bytes, filename, opts);
  return parseDelimited(decodeTextFile(bytes), filename, /\.tsv$/i.test(filename) ? "\t" : undefined);
}

// ── Entry: .xlsx ─────────────────────────────────────────────────────────────

export async function parseSheets(bytes: Uint8Array, filename: string, opts: SheetsParseOptions = {}): Promise<ParsedDocument> {
  const zip = unzipOffice(bytes);
  const workbook = await readWorkbook(zip, bytes, opts.storeImage ?? null);
  const title = workbookTitle(zip) ?? sheetsTitle(filename);
  return { title, blocks: renderWorkbook(workbook), format: "sheets" };
}

function sheetsTitle(filename: string): string {
  return filename.replace(/\.(xlsx|csv|tsv)$/i, "");
}

function workbookTitle(zip: OfficeZip): string | null {
  const core = parseXmlPart(zip, "docProps/core.xml");
  const title = core ? descendants(core, "title")[0]?.textContent?.trim() : "";
  return title ? cleanText(title) : null;
}

// ── Entry: .csv / .tsv ───────────────────────────────────────────────────────

export type Delimiter = "," | "\t" | ";";

/** A delimited text file as one sheet named after the file. The delimiter
    is read from the text unless the caller knows it (a .tsv is tabs). */
export async function parseDelimited(text: string, filename: string, delimiter?: Delimiter): Promise<ParsedDocument> {
  const sep = delimiter ?? sniffDelimiter(text);
  const table = parseDelimitedText(text.replace(/^﻿/, ""), sep);
  // The caps a workbook's sheet has (SPEC.md §27): a delimited file had
  // none, and a file of 161,568 records drew every one of them and
  // overflowed the stack. Sheets benchmark finding.
  const rows: Row[] = [];
  let cellCount = 0;
  for (const cells of table) {
    if (rows.length >= SHEET_MAX_ROWS || cellCount >= SHEET_MAX_CELLS) break;
    const kept = cells.length > SHEET_MAX_COLS ? cells.slice(0, SHEET_MAX_COLS) : cells;
    cellCount += kept.length;
    rows.push({ cells: kept.map((value) => ({ text: cellText(value), kind: valueKind(value), styleId: null })), heightPt: null });
  }
  const title = sheetsTitle(filename);
  const sheet: Sheet = {
    name: title,
    rows,
    colWidths: [],
    merges: [],
    frozenRows: 0,
    frozenCols: 0,
    defaultRowHeightPt: DEFAULT_ROW_HEIGHT_PT,
    defaultColWidthChars: DEFAULT_COL_WIDTH_CHARS,
    cutRows: rows.length < table.length ? table.length : null,
    drawings: [],
  };
  await repairSheet(sheet);
  const workbook: Workbook = { sheets: [sheet], styles: [], styleKey: styleKeyOf(Buffer.from(text)), fonts: [] };
  return { title, blocks: renderWorkbook(workbook), format: "sheets" };
}

// ── The sheet repairs on Jev (SPEC.md §27) ───────────────────────────────────
// A .csv has no frozen panes and a workbook often none, so the header row
// scrolls away with the records; and a column of numbers typed as text
// ("1,200 kg", "$4.50") lines up left like words. With Jev configured, one
// call per sheet asks whether row 1 is a header row and, for every column
// that mixes text and digits, what the column holds. A header row freezes
// (frozenRows 1); a number column's number-like text cells take the number
// kind, so they line up right. Nothing else changes: the cells' text stays
// as it is. Without Jev, or when Jev fails, the sheet stays as read.

const HEADER_MIN = 0.7;
const COLUMN_MIN_CONFIDENCE = 0.6;
const REPAIR_ROWS = 6; // rows Jev reads for the header question
const REPAIR_VALUES = 10; // values Jev reads per column
const REPAIR_MAX_COLS = 30;
const REPAIR_CELL_CHARS = 40;
const NUMBER_LIKE_RX = /^[\s$€£¥+-]*\d[\d,.\s]*(?:%|[a-zA-Z]{1,4})?\s*$/;

const cut = (text: string) => (text.length > REPAIR_CELL_CHARS ? `${text.slice(0, REPAIR_CELL_CHARS - 1)}…` : text);

async function repairSheet(sheet: Sheet): Promise<void> {
  if (!jevEnabled() || sheet.rows.length < 3) return;
  const cols = Math.min(REPAIR_MAX_COLS, Math.max(...sheet.rows.slice(0, REPAIR_ROWS).map((r) => r.cells.length)));
  if (cols === 0) return;
  const questions: Record<string, JevQuestion> = {};
  if (sheet.frozenRows === 0) {
    questions.header = {
      type: "noul",
      instructions: "Row 1 is a header row: its cells name the columns, and the rows under it are records with a value under each name.",
      criteria: {
        true: "Row 1 holds names or labels, and the rows under it hold values of those names.",
        false: "Row 1 holds values like the rows under it, or the sheet has no header.",
      },
    };
  }
  // The columns that mix text and digits: the ones a kind could change.
  const mixed: number[] = [];
  const columns: { c: number; header: string; values: string[] }[] = [];
  for (let c = 0; c < cols; c++) {
    const cells = sheet.rows.slice(1).map((r) => r.cells[c]).filter((cell) => cell && cell.kind !== "empty");
    if (cells.length < 3) continue;
    if (!cells.some((cell) => cell.kind === "text" && NUMBER_LIKE_RX.test(cell.text))) continue;
    mixed.push(c);
    columns.push({ c, header: sheet.rows[0].cells[c]?.text ?? "", values: cells.slice(0, REPAIR_VALUES).map((cell) => cut(cell.text)) });
    questions[`col_${c}`] = {
      type: "choice",
      instructions: `What column ${c} holds.`,
      criteria: {
        number: "Amounts, counts, measurements, prices, or percentages, with or without a unit or a currency sign.",
        date: "Dates or times.",
        identifier: "Codes, ids, phone numbers, or references: digits that name, not measure.",
        text: "Words.",
      },
    };
  }
  if (Object.keys(questions).length === 0) return;
  const result = await systemOne({
    state: {
      rows: sheet.rows.slice(0, REPAIR_ROWS).map((r) => r.cells.slice(0, cols).map((cell) => cut(cell.text))),
      columns,
    },
    questions,
    usage: { userId: null, feature: "sheets-repair", model: JEV_MODEL },
    label: "SHEETS_REPAIR",
  });
  if (!result.ok) {
    console.warn("[sheets] jev repair failed:", result.error);
    return;
  }
  const header = result.answers.header;
  if (header?.type === "noul" && header.noul >= HEADER_MIN) sheet.frozenRows = 1;
  for (const c of mixed) {
    const a = result.answers[`col_${c}`];
    if (a?.type !== "choice" || a.choice !== "number" || a.confidence < COLUMN_MIN_CONFIDENCE) continue;
    for (const row of sheet.rows.slice(1)) {
      const cell = row.cells[c];
      if (cell && cell.kind === "text" && NUMBER_LIKE_RX.test(cell.text)) cell.kind = "number";
    }
  }
}

const SNIFF_CHARS = 64 * 1024;
const SNIFF_RECORDS = 20;

/** Which delimiter the text uses: the one that splits the first records
    into the same number of fields most often; a comma when nothing tells.
    The records are read with the quoting rules, so a delimiter inside a
    quoted field is not counted. Sheets benchmark finding: a header whose
    quoted names hold tabs and newlines was split on tabs, and a file whose
    quoted fields hold semicolons on semicolons. A file that opens with a
    one-field title line was read as one column. */
export function sniffDelimiter(text: string): Delimiter {
  const head = text.length > SNIFF_CHARS ? text.slice(0, SNIFF_CHARS) : text;
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const sep of ["\t", ",", ";"] as const) {
    const records = parseDelimitedText(head, sep, SNIFF_RECORDS).filter((r) => r.length > 1 || r[0] !== "");
    if (records.length === 0) continue;
    // The field count most records share, not the first record's: a file
    // may open with a title line of one field.
    const often = new Map<number, number>();
    for (const r of records) if (r.length > 1) often.set(r.length - 1, (often.get(r.length - 1) ?? 0) + 1);
    let mode = 0;
    let consistent = 0;
    for (const [count, times] of often) {
      if (times > consistent || (times === consistent && count > mode)) {
        mode = count;
        consistent = times;
      }
    }
    const score = consistent * 10 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

/** RFC 4180: quoted fields may hold the delimiter, newlines, and doubled
    quotes. With maxRows, the reading stops after that many records. */
function parseDelimitedText(text: string, sep: Delimiter, maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      quoted = true;
      i++;
      continue;
    }
    if (ch === sep) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    // A record ends at LF, CR LF, or a CR alone (a classic Mac file, and
    // some exports that mix them). Sheets benchmark finding: a CR-only file
    // read as one row.
    if (ch === "\r" && text[i + 1] === "\n") {
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      rows.push(row);
      if (rows.length >= maxRows) return rows;
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const NUMBER_RX = /^\s*[-+]?(?:\$|€|£|¥)?\s*(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?\s*%?\s*$/;

function valueKind(value: string): CellKind {
  const v = value.trim();
  if (v === "") return "empty";
  if (/^(TRUE|FALSE)$/i.test(v)) return "bool";
  if (/^#(?:N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)$/.test(v)) return "error";
  if (NUMBER_RX.test(v) && /\d/.test(v)) return "number";
  return "text";
}

// ── Workbook reading ─────────────────────────────────────────────────────────

function styleKeyOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

async function readWorkbook(zip: OfficeZip, bytes: Uint8Array, storeImage: SlideImageStore | null): Promise<Workbook> {
  const workbookPath = "xl/workbook.xml";
  const doc = parseXmlPart(zip, workbookPath);
  if (!doc) throw new Error("Not a workbook: xl/workbook.xml is missing");
  const rels = partRels(zip, workbookPath);
  const date1904 = boolAttr(descendants(doc, "workbookPr")[0], "date1904");
  const themeRel = relsOfType(rels, "theme")[0];
  const theme = themeRel && !themeRel.external ? parseTheme(zip, themeRel.target) : { colors: {}, major: "", minor: "" };
  const shared = readSharedStrings(zip, rels);
  const styles = readStyles(zip, rels, theme.colors);
  // Every sheet's cells first, then every sheet's drawings: a chart's
  // references may point at another sheet.
  const read: ReadSheet[] = [];
  for (const sheetEl of descendants(doc, "sheet")) {
    if (attr(sheetEl, "state") === "hidden" || attr(sheetEl, "state") === "veryHidden") continue;
    const rid = attr(sheetEl, "id");
    const rel = rid ? rels.get(rid) : undefined;
    if (!rel || rel.external) continue;
    const name = cleanText(attr(sheetEl, "name") ?? `Sheet ${read.length + 1}`);
    const sheet = readSheet(zip, rel.target, name, shared, styles, date1904);
    if (sheet) {
      await repairSheet(sheet.sheet);
      read.push(sheet);
    }
  }
  const drawingCtx: DrawingCtx = {
    zip,
    theme: theme.colors,
    storeImage,
    imageUrls: new Map(),
    resolveRef: (formula) => resolveReference(formula, read),
  };
  const sheets: Sheet[] = [];
  for (const r of read) {
    r.sheet.drawings = await readDrawings(drawingCtx, r.rels);
    sheets.push(compactSheet(r.sheet, r.hiddenRows, r.hiddenCols, (id) => {
      const style = styles.cellStyles[id];
      return Boolean(style && (style.fill || style.borders));
    }));
  }
  return { sheets, styles: styles.cellStyles, styleKey: styleKeyOf(bytes), fonts: styles.fonts };
}

// A sheet as read, before its drawings and its compaction.
type ReadSheet = { sheet: Sheet; rels: Map<string, Relationship>; hiddenRows: Set<number>; hiddenCols: Set<number> };

/** The cells a reference formula names, from the sheets as read:
    "'Data'!$B$2:$B$5", "Data!B2:B5", or a single cell. Null when the sheet
    is unknown or the reference does not parse. */
function resolveReference(formula: string, sheets: ReadSheet[]): { text: string; number: number | null }[] | null {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(formula.trim());
  if (!m) return null;
  const sheetName = (m[1] ?? m[2] ?? "").replace(/''/g, "'");
  const sheet = sheets.find((s) => s.sheet.name === sheetName)?.sheet ?? (sheets.length === 1 ? sheets[0].sheet : null);
  if (!sheet) return null;
  const from = cellRef(`${m[3]}${m[4]}`);
  const to = m[5] ? cellRef(`${m[5]}${m[6]}`) : from;
  if (!from || !to) return null;
  const out: { text: string; number: number | null }[] = [];
  for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
    for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
      const cell = sheet.rows[r]?.cells[c];
      out.push({ text: cell?.text ?? "", number: cell?.number ?? null });
    }
  }
  return out;
}

// ── Drawings ─────────────────────────────────────────────────────────────────

type DrawingCtx = {
  zip: OfficeZip;
  theme: ThemeColors;
  storeImage: SlideImageStore | null;
  imageUrls: Map<string, Promise<string | null>>;
  resolveRef: (formula: string) => { text: string; number: number | null }[] | null;
};

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

function storedImage(ctx: DrawingCtx, path: string): Promise<string | null> {
  const cached = ctx.imageUrls.get(path);
  if (cached) return cached;
  const promise = (async () => {
    const bytes = ctx.zip.get(path);
    const store = ctx.storeImage;
    if (!bytes || !store) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mime = IMAGE_MIME_BY_EXT[ext];
    if (!mime) return null;
    try {
      return await store(bytes, mime);
    } catch (err) {
      console.warn("[sheets] picture not stored:", err);
      return null;
    }
  })();
  ctx.imageUrls.set(path, promise);
  return promise;
}

function readAnchor(el: Element | null): Anchor | null {
  if (!el) return null;
  return {
    col: Number(child(el, "col")?.textContent ?? "0") || 0,
    colOff: Number(child(el, "colOff")?.textContent ?? "0") || 0,
    row: Number(child(el, "row")?.textContent ?? "0") || 0,
    rowOff: Number(child(el, "rowOff")?.textContent ?? "0") || 0,
  };
}

/** The sheet's drawing part: every picture, chart, and shape with the
    cells it is anchored to. */
async function readDrawings(ctx: DrawingCtx, sheetRels: Map<string, Relationship>): Promise<Drawing[]> {
  const out: Drawing[] = [];
  for (const rel of relsOfType(sheetRels, "drawing")) {
    if (rel.external) continue;
    const doc = parseXmlPart(ctx.zip, rel.target);
    if (!doc) continue;
    const rels = partRels(ctx.zip, rel.target);
    for (const anchorEl of Array.from(doc.documentElement.children)) {
      const kind = anchorEl.localName;
      if (kind !== "twoCellAnchor" && kind !== "oneCellAnchor" && kind !== "absoluteAnchor") continue;
      const from = kind === "absoluteAnchor" ? { col: 0, colOff: Number(attr(child(anchorEl, "pos"), "x") ?? "0") || 0, row: 0, rowOff: Number(attr(child(anchorEl, "pos"), "y") ?? "0") || 0 } : readAnchor(child(anchorEl, "from"));
      if (!from) continue;
      const to = kind === "twoCellAnchor" ? readAnchor(child(anchorEl, "to")) : null;
      const extEl = child(anchorEl, "ext");
      const ext = extEl ? { cx: intAttr(extEl, "cx") ?? 0, cy: intAttr(extEl, "cy") ?? 0 } : null;
      const content = await drawingContent(ctx, anchorEl, rels, from, to, ext);
      if (content) out.push({ from, to, ext, content });
    }
  }
  return out;
}

async function drawingContent(
  ctx: DrawingCtx,
  anchorEl: Element,
  rels: Map<string, Relationship>,
  from: Anchor,
  to: Anchor | null,
  ext: { cx: number; cy: number } | null,
): Promise<Drawing["content"] | null> {
  const pic = child(anchorEl, "pic");
  if (pic) {
    const blip = child(child(pic, "blipFill"), "blip");
    const rid = attr(blip, "embed");
    const target = rid ? rels.get(rid) : undefined;
    const url = target && !target.external ? await storedImage(ctx, target.target) : null;
    return url ? { kind: "image", url } : null;
  }
  const frame = child(anchorEl, "graphicFrame");
  const chartEl = frame ? descendants(frame, "chart")[0] : null;
  if (chartEl) {
    const rid = attr(chartEl, "id");
    const target = rid ? rels.get(rid) : undefined;
    const doc = target && !target.external ? parseXmlPart(ctx.zip, target.target) : null;
    if (!doc) return null;
    // The box's aspect for the drawing: from the anchors when both are
    // cells (rough: a column is about 64px, a row 20px), else the size.
    const width = ext ? ext.cx : Math.max(1, (to ? (to.col - from.col) * 64 * 9525 + to.colOff - from.colOff : 4000000));
    const height = ext ? ext.cy : Math.max(1, (to ? (to.row - from.row) * 20 * 9525 + to.rowOff - from.rowOff : 2500000));
    const palette = { theme: ctx.theme, clrMap: {}, phClr: null };
    const drawn = renderChart(doc, { width, height }, {
      accents: themeAccents(ctx.theme),
      resolveColor: (el) => {
        const c = resolveDrawingColor(el, palette);
        return c ? rgbCss(c.rgb, c.alpha) : null;
      },
      resolveRef: ctx.resolveRef,
    });
    if (!drawn) return null;
    const rows = drawn.rows;
    const table = `<table class="scd"><tbody>${rows
      .map((row, r) => `<tr>${row.map((cell, c) => {
        const last = c === row.length - 1;
        const gap = last ? (r === rows.length - 1 ? "" : textGap("\n")) : textGap("\t");
        return `<td>${escapeHtml(cell)}${gap}</td>`;
      }).join("")}</tr>`)
      .join("")}</tbody></table>`;
    const pieces = [drawn.title ? { html: `<div>${escapeHtml(drawn.title)}</div>`, text: drawn.title } : null, rows.length > 0 ? { html: table, text: rows.map((r) => r.join("\t")).join("\n") } : null].filter((p): p is { html: string; text: string } => p !== null);
    return {
      kind: "chart",
      svg: drawn.svg,
      html: pieces.map((p) => p.html).join(textGap("\n")),
      text: pieces.map((p) => p.text).join("\n"),
    };
  }
  const sp = child(anchorEl, "sp");
  if (sp) {
    const palette = { theme: ctx.theme, clrMap: {}, phClr: null };
    const fillColor = resolveDrawingColor(descendantColor(child(child(sp, "spPr"), "solidFill")), palette);
    const words = cleanText(
      descendants(child(sp, "txBody"), "p")
        .map((p) => descendants(p, "t").map((t) => t.textContent ?? "").join(""))
        .join("\n"),
    ).trim();
    if (!words && !fillColor) return null;
    return {
      kind: "shape",
      html: escapeHtml(words),
      fill: fillColor ? rgbCss(fillColor.rgb, fillColor.alpha) : null,
    };
  }
  return null;
}

function descendantColor(fill: Element | null): Element | null {
  if (!fill) return null;
  for (const c of Array.from(fill.children)) {
    if (["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr"].includes(c.localName)) return c;
  }
  return null;
}

/** The shared strings in order: every <si>, read as the part streams
    (lib/parse/xml-stream.ts), so a table of 100,000 strings never stands
    as a tree. */
function readSharedStrings(zip: OfficeZip, rels: Map<string, Relationship>): string[] {
  const rel = relsOfType(rels, "sharedStrings")[0];
  const text = partText(zip, rel && !rel.external ? rel.target : "xl/sharedStrings.xml");
  if (text === null) return [];
  const out: string[] = [];
  const doc = parseXmlStream(text, (el) => {
    if (el.localName !== "si") return false;
    for (let up = el.parent; up; up = up.parent) if (up.localName === "si") return false;
    // An <si> and any inside it, in document order.
    out.push(richText(el));
    for (const inner of el.getElementsByTagNameNS("*", "si")) out.push(richText(inner));
    return true;
  });
  return doc ? out : [];
}

/** The text of a rich-text element: its own <t> or its runs' <t>, phonetic
    guides left out. A character XML cannot hold is written _xHHHH_
    (ECMA-376 Part 1, §22.9.2.19), and "_x005F_" is a literal "_": Excel
    writes a line break in a cell as "_x000D_" and LF. Sheets benchmark
    finding (lo-escape-unicode). */
function richText(el: XmlElement): string {
  let out = "";
  for (const node of el.children) {
    if (node.localName === "t") out += node.textContent;
    else if (node.localName === "r") out += child(node, "t")?.textContent ?? "";
  }
  return cellText(out.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
}

type Styles = {
  cellStyles: CellStyle[];
  numFmts: (string | number)[]; // by xf index: a format code or a built-in id
  fonts: string[]; // every typeface the workbook's fonts name
};

// Excel's theme color order differs from the theme file's: index 0 is
// the light text/background pair first.
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

// The legacy indexed palette (ECMA-376 18.8.27).
const INDEXED_COLORS = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

function excelColor(el: Element | null, theme: ThemeColors): string | null {
  if (!el) return null;
  if (attr(el, "auto") === "1") return null;
  let rgb: Rgb | null = null;
  const hex = attr(el, "rgb");
  if (hex) rgb = parseHexColor(hex);
  const themeIdx = intAttr(el, "theme");
  if (rgb === null && themeIdx !== null) {
    const name = THEME_ORDER[themeIdx];
    rgb = name ? (theme[name] ?? null) : null;
  }
  const indexed = intAttr(el, "indexed");
  if (rgb === null && indexed !== null) {
    if (indexed === 64) return null; // system foreground: the default
    rgb = parseHexColor(INDEXED_COLORS[indexed] ?? null);
  }
  if (!rgb) return null;
  const tint = Number(attr(el, "tint") ?? "0");
  if (tint) rgb = modifyColor(rgb, { themeTint: tint });
  return rgbCss(rgb);
}

function readStyles(zip: OfficeZip, rels: Map<string, Relationship>, theme: ThemeColors): Styles {
  const rel = relsOfType(rels, "styles")[0];
  const doc = parseXmlPart(zip, rel && !rel.external ? rel.target : "xl/styles.xml");
  const cellStyles: CellStyle[] = [];
  const numFmts: (string | number)[] = [];
  if (!doc) return { cellStyles, numFmts, fonts: [] };
  const formatCodes = new Map<number, string>();
  for (const f of descendants(child(doc.documentElement, "numFmts"), "numFmt")) {
    const id = intAttr(f, "numFmtId");
    const code = attr(f, "formatCode");
    if (id !== null && code !== null) formatCodes.set(id, code);
  }
  const fonts = children(child(doc.documentElement, "fonts"), "font").map((font): CellStyle => {
    const style: CellStyle = {};
    if (child(font, "b") && attr(child(font, "b"), "val") !== "0") style.bold = true;
    if (child(font, "i") && attr(child(font, "i"), "val") !== "0") style.italic = true;
    if (child(font, "u") && attr(child(font, "u"), "val") !== "none") style.underline = true;
    if (child(font, "strike") && attr(child(font, "strike"), "val") !== "0") style.strike = true;
    const color = excelColor(child(font, "color"), theme);
    if (color) style.color = color;
    const sz = Number(attr(child(font, "sz"), "val") ?? "");
    if (sz) style.sizePt = sz;
    const name = attr(child(font, "name"), "val");
    if (name) style.font = name;
    return style;
  });
  const fills = children(child(doc.documentElement, "fills"), "fill").map((fill): string | null => {
    const pattern = child(fill, "patternFill");
    const type = attr(pattern, "patternType");
    if (!pattern || type === "none") return null;
    // A solid pattern's color is its foreground; other patterns show the
    // background (the foreground is the pattern's ink).
    const color = type === "solid" || type === null
      ? excelColor(child(pattern, "fgColor"), theme) ?? excelColor(child(pattern, "bgColor"), theme)
      : excelColor(child(pattern, "bgColor"), theme) ?? excelColor(child(pattern, "fgColor"), theme);
    return color;
  });
  const borders = children(child(doc.documentElement, "borders"), "border").map((border) => {
    const side = (name: string): Border => {
      const el = child(border, name);
      const style = attr(el, "style");
      if (!el || !style || style === "none") return null;
      const color = excelColor(child(el, "color"), theme) ?? "#000000";
      const width = style === "medium" || style === "mediumDashed" || style === "mediumDashDot" ? 2 : style === "thick" ? 3 : 1;
      const kind = style.includes("dash") ? "dashed" : style === "dotted" || style === "hair" ? "dotted" : style === "double" ? "double" : "solid";
      return { width, style: kind, color };
    };
    return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
  });
  const defaultFont = fonts[0] ?? {};
  for (const xf of children(child(doc.documentElement, "cellXfs"), "xf")) {
    const style: CellStyle = {};
    const fontId = intAttr(xf, "fontId") ?? 0;
    const font = fonts[fontId] ?? {};
    // The workbook's first font is every cell's default: only what differs
    // from it renders, so the html stays small.
    if (font.bold && !defaultFont.bold) style.bold = true;
    if (font.italic && !defaultFont.italic) style.italic = true;
    if (font.underline) style.underline = true;
    if (font.strike) style.strike = true;
    if (font.color && font.color !== defaultFont.color) style.color = font.color;
    if (font.sizePt && font.sizePt !== defaultFont.sizePt) style.sizePt = font.sizePt;
    if (font.font && font.font !== defaultFont.font) style.font = font.font;
    const fillId = intAttr(xf, "fillId") ?? 0;
    const fill = fills[fillId];
    if (fill) style.fill = fill;
    const borderId = intAttr(xf, "borderId") ?? 0;
    const border = borders[borderId];
    if (border && (border.top || border.right || border.bottom || border.left)) style.borders = border;
    const alignment = child(xf, "alignment");
    const horizontal = attr(alignment, "horizontal");
    if (horizontal === "center" || horizontal === "centerContinuous") style.align = "center";
    else if (horizontal === "right") style.align = "right";
    else if (horizontal === "left") style.align = "left";
    const vertical = attr(alignment, "vertical");
    if (vertical === "center") style.valign = "middle";
    else if (vertical === "top") style.valign = "top";
    if (boolAttr(alignment, "wrapText")) style.wrap = true;
    const indent = intAttr(alignment, "indent");
    if (indent) style.indent = indent;
    cellStyles.push(style);
    const numFmtId = intAttr(xf, "numFmtId") ?? 0;
    numFmts.push(formatCodes.get(numFmtId) ?? numFmtId);
  }
  return { cellStyles, numFmts, fonts: [...new Set(fonts.map((f) => f.font ?? "").filter(Boolean))] };
}

/** "A1" → zero-based column and row. */
function cellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function readSheet(
  zip: OfficeZip,
  path: string,
  name: string,
  shared: string[],
  styles: Styles,
  date1904: boolean,
): ReadSheet | null {
  const xml = partText(zip, path);
  if (xml === null) return null;

  // The cells, row by row, as the part streams: a row is read when it
  // closes and dropped from the tree (lib/parse/xml-stream.ts), so a sheet
  // of 175,000 cells never stands as a tree. Rows and cells may omit their
  // references: they then follow the last one.
  const rows: Row[] = [];
  const hiddenRows = new Set<number>();
  // The 0-based row a row without its reference takes: the one after the
  // last. It was the last row itself, so a sheet whose rows carry no "r"
  // drew every row over row 1 and kept only the last. Sheets benchmark
  // finding (POI 56278, 59746).
  let rowCursor = 0;
  // Formula cells stored with no number ("r:c").
  const uncomputed = new Set<string>();
  let cellCount = 0;
  let totalRows = 0;
  let cut = false;
  // A shared formula's first cell holds its text; the cells that share it
  // hold its index alone (ECMA-376 Part 1, §18.3.1.40) and read it moved by
  // their distance from that cell. They had no formula, so a value the file
  // left out stayed empty and no formula rode on them.
  const sharedFormulas = new Map<string, { formula: string; r: number; c: number }>();
  const cellFormula = (c: XmlElement, r: number, col: number): string | undefined => {
    const f = child(c, "f");
    const text = f?.textContent.trim() || undefined;
    const si = attr(f, "si");
    if (!f || attr(f, "t") !== "shared" || si === null) return text;
    if (text) {
      sharedFormulas.set(si, { formula: text, r, c: col });
      return text;
    }
    const first = sharedFormulas.get(si);
    return first ? (sharedFormula(first.formula, r - first.r, col - first.c) ?? undefined) : undefined;
  };
  const readRow = (rowEl: XmlElement) => {
    const ref = intAttr(rowEl, "r");
    const r = ref !== null ? ref - 1 : rowCursor;
    rowCursor = r + 1;
    totalRows = r + 1;
    if (cut) return;
    if (r >= SHEET_MAX_ROWS || cellCount >= SHEET_MAX_CELLS) {
      cut = true;
      return;
    }
    if (boolAttr(rowEl, "hidden")) hiddenRows.add(r);
    const heightPt = boolAttr(rowEl, "customHeight") || attr(rowEl, "ht") ? Number(attr(rowEl, "ht") ?? "") || null : null;
    const cells: Cell[] = [];
    let colCursor = 0;
    for (const c of children(rowEl, "c")) {
      const ref = attr(c, "r");
      const at = ref ? cellRef(ref) : null;
      const col = at ? at.col : colCursor;
      colCursor = col + 1;
      if (col >= SHEET_MAX_COLS) continue;
      const cell = readCell(c, shared, styles, date1904, cellFormula(c, r, col));
      if (cell.formula && cell.kind === "empty" && (attr(c, "t") ?? "n") === "n") uncomputed.add(`${r}:${col}`);
      cells[col] = cell;
      cellCount++;
    }
    rows[r] = { cells, heightPt };
  };
  // The rows of the worksheet's first sheetData are the sheet's.
  let sheetData: XmlElement | null = null;
  const doc = parseXmlStream(xml, (el) => {
    if (el.localName !== "row") return false;
    const parent = el.parent;
    if (!parent || parent.localName !== "sheetData" || !parent.parent || parent.parent.parent !== null) return false;
    sheetData ??= child(parent.parent, "sheetData");
    if (parent !== sheetData) return false;
    readRow(el);
    return true;
  });
  if (!doc) return null;
  const rels = partRels(zip, path);
  const root = doc.documentElement;

  const formatPr = child(root, "sheetFormatPr");
  const defaultRowHeightPt = Number(attr(formatPr, "defaultRowHeight") ?? "") || DEFAULT_ROW_HEIGHT_PT;
  const defaultColWidthChars = Number(attr(formatPr, "defaultColWidth") ?? "") || (Number(attr(formatPr, "baseColWidth") ?? "") ? Number(attr(formatPr, "baseColWidth")) + 0.71 : DEFAULT_COL_WIDTH_CHARS);

  // Frozen panes: the rows and columns that stay in view.
  let frozenRows = 0;
  let frozenCols = 0;
  const pane = descendants(child(root, "sheetViews"), "pane")[0];
  if (pane && (attr(pane, "state") === "frozen" || attr(pane, "state") === "frozenSplit")) {
    frozenRows = intAttr(pane, "ySplit") ?? 0;
    frozenCols = intAttr(pane, "xSplit") ?? 0;
  }

  // Column widths and hidden columns, by column index.
  const colWidths: (number | null)[] = [];
  const hiddenCols = new Set<number>();
  for (const col of children(child(root, "cols"), "col")) {
    const min = (intAttr(col, "min") ?? 1) - 1;
    const max = Math.min((intAttr(col, "max") ?? min + 1) - 1, SHEET_MAX_COLS - 1);
    const width = Number(attr(col, "width") ?? "") || null;
    const hidden = boolAttr(col, "hidden");
    for (let c = min; c <= max; c++) {
      colWidths[c] = width;
      if (hidden) hiddenCols.add(c);
    }
  }

  // A number no date has, in a date format: "#" for each character the
  // column holds, as Excel fills the cell. Sheets benchmark finding
  // (pd-testdateoverflow: 1E+20 as a date showed nothing).
  for (const row of rows) {
    row?.cells.forEach((cell, c) => {
      if (cell?.hashes) cell.text = "#".repeat(Math.max(1, Math.floor(colWidths[c] ?? defaultColWidthChars)));
    });
  }

  // Hyperlinks by cell: the part lists them after the cells.
  const hrefByRef = new Map<string, string>();
  for (const link of descendants(child(root, "hyperlinks"), "hyperlink")) {
    const ref = attr(link, "ref");
    const rid = attr(link, "id");
    const rel = rid ? rels.get(rid) : undefined;
    const href = rel?.external ? rel.target : null;
    if (ref && href && /^(https?:\/\/|mailto:)/i.test(href)) hrefByRef.set(ref.split(":")[0].toUpperCase(), href);
  }
  for (const [ref, href] of hrefByRef) {
    const at = cellRef(ref);
    if (!at || `${columnLetter(at.col)}${at.row + 1}` !== ref) continue;
    const cell = rows[at.row]?.cells[at.col];
    if (cell) cell.href = href;
  }
  computeStoredEmpty(rows, uncomputed, styles, date1904);

  // Merged ranges.
  const merges: Merge[] = [];
  for (const merge of descendants(child(root, "mergeCells"), "mergeCell")) {
    const ref = attr(merge, "ref") ?? "";
    const [a, b] = ref.split(":");
    const from = a ? cellRef(a) : null;
    const to = b ? cellRef(b) : from;
    if (!from || !to) continue;
    merges.push({
      r0: Math.min(from.row, to.row),
      c0: Math.min(from.col, to.col),
      r1: Math.min(Math.max(from.row, to.row), SHEET_MAX_ROWS - 1),
      c1: Math.min(Math.max(from.col, to.col), SHEET_MAX_COLS - 1),
    });
  }

  const sheet: Sheet = {
    name,
    rows,
    colWidths,
    merges,
    frozenRows,
    frozenCols,
    defaultRowHeightPt,
    defaultColWidthChars,
    cutRows: cut ? totalRows : null,
    drawings: [],
  };
  return { sheet, rels, hiddenRows, hiddenCols };
}

function readCell(c: XmlElement, shared: string[], styles: Styles, date1904: boolean, formula: string | undefined): Cell {
  const type = attr(c, "t") ?? "n";
  const styleId = intAttr(c, "s");
  const v = child(c, "v")?.textContent ?? "";
  const format = formula && styleId !== null ? styles.numFmts[styleId] : undefined;
  const base = { styleId, formula, ...(format !== undefined && format !== 0 && format !== "General" ? { format } : {}) };
  switch (type) {
    case "s": {
      // An empty <v/> is an empty cell: Number("") is 0, which read the
      // first shared string into it. Sheets benchmark finding (poi-64508).
      const text = v.trim() === "" ? "" : shared[Number(v)] ?? "";
      return { ...base, text, kind: text === "" ? "empty" : "text" };
    }
    case "str":
      return { ...base, text: cellText(v), kind: v === "" ? "empty" : "text" };
    case "inlineStr": {
      const text = richText(child(c, "is") ?? c);
      return { ...base, text, kind: text === "" ? "empty" : "text" };
    }
    case "b":
      return { ...base, text: v === "1" ? "TRUE" : "FALSE", kind: "bool" };
    case "e":
      return { ...base, text: cleanText(v), kind: "error" };
    case "d": {
      const date = new Date(v);
      const serial = Number.isNaN(date.getTime()) ? null : dateSerial(date, date1904);
      const text = serial === null ? cleanText(v) : formatNumber(serial, styleId, styles, date1904);
      return { ...base, text, kind: "number", number: serial ?? undefined };
    }
    default: {
      if (v === "") return { ...base, text: "", kind: "empty" };
      const n = Number(v);
      if (!Number.isFinite(n)) return { ...base, text: cleanText(v), kind: "text" };
      if (noDate(n, styleId, styles, date1904)) return { ...base, text: "#", kind: "number", number: n, hashes: true };
      return { ...base, text: formatNumber(n, styleId, styles, date1904), kind: "number", number: n };
    }
  }
}

/** A formula stored with no value (<v></v> or no <v>, as openpyxl and other
    libraries write) shows what the formula computes, as Excel shows it on
    open: lib/sheet-formulas.ts reads it over the sheet's cells, a formula
    it reads computed first, a loop as empty. A formula the reading does not
    cover (another sheet, a function it lacks) stays empty, as before.
    Sheets benchmark finding (unitos-book, synth-long). */
function computeStoredEmpty(rows: Row[], uncomputed: Set<string>, styles: Styles, date1904: boolean): void {
  if (uncomputed.size === 0) return;
  const busy = new Set<string>();
  const valueAt = (r: number, c: number): CellValue => {
    const key = `${r}:${c}`;
    if (uncomputed.has(key)) compute(r, c);
    const cell = rows[r]?.cells[c];
    if (!cell) return null;
    switch (cell.kind) {
      case "number":
        return cell.number ?? null;
      case "bool":
        return cell.text === "TRUE";
      case "error":
        return { error: cell.text };
      case "empty":
        return null;
      default:
        return cell.text;
    }
  };
  const compute = (r: number, c: number) => {
    const key = `${r}:${c}`;
    if (busy.has(key)) return;
    busy.add(key);
    const cell = rows[r]?.cells[c];
    const value = cell?.formula ? computeFormula(cell.formula, valueAt) : undefined;
    uncomputed.delete(key);
    if (!cell || value === undefined || value === null) return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
      Object.assign(cell, { text: formatNumber(value, cell.styleId, styles, date1904), kind: "number", number: value });
    } else if (typeof value === "boolean") {
      Object.assign(cell, { text: value ? "TRUE" : "FALSE", kind: "bool" });
    } else if (typeof value === "string") {
      if (value !== "") Object.assign(cell, { text: cellText(value), kind: "text" });
    } else {
      Object.assign(cell, { text: cleanText(value.error), kind: "error" });
    }
  };
  for (const key of [...uncomputed]) {
    const [r, c] = key.split(":").map(Number);
    compute(r, c);
  }
}

function dateSerial(date: Date, date1904: boolean): number {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

/** A format code ssf refuses, written the way ssf reads it. Two spellings
    Excel shows and ssf throws on, from the Sheets benchmark (poi-64508,
    lo-tdf76115):
    - a thousands separator repeated through the integer digits,
      "#,###,##0" or "###,###,##0.000": Excel reads any comma between digit
      placeholders as the one separator, so it is "#,##0".
    - a bare "." between date parts, "DD.MM.YYYY": ssf takes it for the
      decimal point of seconds; outside "ss.0" it is a literal "\.".
    Quoted text, escapes, and [brackets] are left as they are. */
function ssfFallbackCode(code: string): string {
  const parts: { text: string; plain: boolean }[] = [];
  let plain = "";
  const flush = () => {
    if (plain) parts.push({ text: plain, plain: true });
    plain = "";
  };
  for (let i = 0; i < code.length; ) {
    const ch = code[i];
    let end = -1;
    if (ch === '"') end = code.indexOf('"', i + 1) + 1 || code.length;
    else if (ch === "[") end = code.indexOf("]", i) + 1 || code.length;
    else if (ch === "\\" || ch === "_" || ch === "*") end = Math.min(i + 2, code.length);
    if (end < 0) {
      plain += ch;
      i++;
      continue;
    }
    flush();
    parts.push({ text: code.slice(i, end), plain: false });
    i = end;
  }
  flush();
  const plainText = parts.filter((p) => p.plain).map((p) => p.text).join("");
  const isDate = /[dy]/i.test(plainText) && !/[#?]/.test(plainText);
  return parts
    .map((p) => {
      if (!p.plain) return p.text;
      let text = p.text.replace(/(?<![#0,])#[#,]*,[#,]*0(?![#0?])/g, "#,##0");
      if (isDate) text = text.replace(/(?<![sS])\.(?!0)/g, "\\.");
      return text;
    })
    .join("");
}

// 9999-12-31, the last day Excel shows.
const MAX_DATE_SERIAL = 2958465;

/** Is the number one a date format cannot show: Excel shows a date or a
    time below 0 or past 9999-12-31 as "#####" (in the 1904 date system a
    negative one shows with its sign). ssf showed it as nothing, or as a
    year past 9999. */
function noDate(value: number, styleId: number | null, styles: Styles, date1904: boolean): boolean {
  const fmt = styleId !== null ? styles.numFmts[styleId] ?? 0 : 0;
  const max = date1904 ? MAX_DATE_SERIAL - 1462 : MAX_DATE_SERIAL;
  if (value <= max && (value >= 0 || date1904)) return false;
  const code = typeof fmt === "string" ? fmt : (ssf.get_table()[fmt] ?? "");
  try {
    return ssf.is_date(code);
  } catch {
    return false;
  }
}

const timeSteps = new Map<string | number, number | null>();

/** The steps in a day a value rounds to before a time format shows it:
    Excel rounds a time to the second — or to the tenth, hundredth, or
    thousandth after "ss.0" — before it shows the hours and minutes, and
    the rounding carries into the minute, the hour, and the day, so
    08:44:59.97 shows 08:45:00. ssf rounded the seconds without the carry
    and showed 08:44:00, and 23:59:59.9 in "hh:mm" read 24:00. Null for a
    format that shows no time (a number, or a date alone). */
function timeStep(fmt: string | number): number | null {
  const known = timeSteps.get(fmt);
  if (known !== undefined) return known;
  const code = typeof fmt === "string" ? fmt : (ssf.get_table()[fmt] ?? "");
  // The format's own letters: quoted text, escapes, and colors and
  // conditions in brackets left out; [h], [m], and [s] kept.
  const plain = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/_.|\*./g, "")
    .replace(/\[(?![hms]+\])[^\]]*\]/gi, "");
  const decimals = Math.max(0, ...[...plain.matchAll(/s\.(0{1,3})/gi)].map((m) => m[1].length));
  const shown = plain.replace(/s\.0{1,3}/gi, "s");
  const step = /[hs]/i.test(shown) && !/[#?0]/.test(shown) && !/general/i.test(shown) ? 86400 * 10 ** decimals : null;
  timeSteps.set(fmt, step);
  return step;
}

/** A number as the cell's format shows it. General shows up to 11
    significant digits, as Excel does; a format ssf refuses is tried once
    more as ssfFallbackCode writes it, and else shows the number as
    General. */
function formatNumber(value: number, styleId: number | null, styles: Styles, date1904: boolean): string {
  const fmt = styleId !== null ? styles.numFmts[styleId] ?? 0 : 0;
  const shown = (n: number): string => {
    try {
      return cleanText(ssf.format(fmt, n, { date1904 }));
    } catch {
      try {
        if (typeof fmt === "string") return cleanText(ssf.format(ssfFallbackCode(fmt), n, { date1904 }));
      } catch {
        // Neither spelling reads: General below.
      }
      try {
        return cleanText(ssf.format(0, n, { date1904 }));
      } catch {
        return String(value);
      }
    }
  };
  const steps = value >= 0 && value <= MAX_DATE_SERIAL ? timeStep(fmt) : null;
  if (steps !== null) return shown(Math.round(value * steps) / steps);
  const plain = shown(value);
  // Only a number whose 15 significant digits end in 5 sits on a half.
  if (Number.isInteger(value) || !Number.isFinite(value) || !/5(?:e|$)/.test(String(Number(value.toPrecision(15))))) return plain;
  // A half rounds away from zero as the number is written in decimal:
  // 0.1785 in "0.0%" is 17.9%, and -1.05 in "0.0" is -1.1, as Excel shows
  // them. In binary both sit a hair under the half, and ssf rounded them
  // down. The number moved two units in the last place away from zero
  // shows the half rounded up; that reading is kept when it shows at most
  // the 15 significant digits Excel keeps, so a format of 15 decimals still
  // shows the number as it is. Sheets benchmark finding (poi-AverageTaxRates).
  const nudged = shown(value + Math.sign(value) * Math.abs(value) * 2 * Number.EPSILON);
  if (nudged === plain) return plain;
  return nudged.replace(/\D/g, "").replace(/^0+/, "").length <= 15 ? nudged : plain;
}

/** The sheet trimmed to its used range: empty rows and columns past the
    last cell with content are dropped, hidden rows and columns left out,
    and the merges remapped to the kept columns and rows. styled says
    whether a style id paints a fill or a border: a colored band of empty
    cells near the words is part of the sheet's look and is kept. */
function compactSheet(sheet: Sheet, hiddenRows: Set<number>, hiddenCols: Set<number>, styled: (styleId: number) => boolean): Sheet {
  let lastRow = -1;
  let lastCol = -1;
  sheet.rows.forEach((row, r) => {
    row?.cells.forEach((cell, c) => {
      if (cell && cell.kind !== "empty") {
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }
    });
  });
  for (const m of sheet.merges) {
    const origin = sheet.rows[m.r0]?.cells[m.c0];
    if (origin && origin.kind !== "empty") {
      lastRow = Math.max(lastRow, m.r1);
      lastCol = Math.max(lastCol, m.c1);
    }
  }
  const wordsRow = lastRow;
  const wordsCol = lastCol;
  sheet.rows.forEach((row, r) => {
    if (!row || r > wordsRow + 2) return;
    row.cells.forEach((cell, c) => {
      if (cell && cell.styleId !== null && c <= wordsCol + 2 && styled(cell.styleId)) {
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }
    });
  });
  const rowMap = new Map<number, number>();
  const colMap = new Map<number, number>();
  const rows: Row[] = [];
  for (let r = 0; r <= lastRow; r++) {
    if (hiddenRows.has(r)) continue;
    rowMap.set(r, rows.length);
    rows.push(sheet.rows[r] ?? { cells: [], heightPt: null });
  }
  const keptCols: number[] = [];
  for (let c = 0; c <= lastCol; c++) {
    if (hiddenCols.has(c)) continue;
    colMap.set(c, keptCols.length);
    keptCols.push(c);
  }
  const width = keptCols.length;
  const compact: Row[] = rows.map((row) => ({
    heightPt: row.heightPt,
    cells: keptCols.map((c) => row.cells[c] ?? { text: "", kind: "empty", styleId: null }),
  }));
  const merges: Merge[] = [];
  for (const m of sheet.merges) {
    // A merge whose corner is hidden or past the range is dropped; one that
    // reaches past it is clipped.
    const r0 = rowMap.get(m.r0);
    const c0 = colMap.get(m.c0);
    if (r0 === undefined || c0 === undefined) continue;
    let r1 = r0;
    for (let r = m.r0; r <= m.r1; r++) {
      const mapped = rowMap.get(r);
      if (mapped !== undefined) r1 = mapped;
    }
    let c1 = c0;
    for (let c = m.c0; c <= m.c1; c++) {
      const mapped = colMap.get(c);
      if (mapped !== undefined) c1 = mapped;
    }
    if (r1 === r0 && c1 === c0) continue;
    merges.push({ r0, c0, r1: Math.min(r1, compact.length - 1), c1: Math.min(c1, width - 1) });
  }
  let frozenRows = 0;
  for (let r = 0; r < sheet.frozenRows; r++) if (rowMap.has(r)) frozenRows++;
  let frozenCols = 0;
  for (let c = 0; c < sheet.frozenCols; c++) if (colMap.has(c)) frozenCols++;
  // A drawing's anchors move to the kept rows and columns: a hidden anchor
  // cell maps to the next kept one.
  // Inside the kept range a hidden anchor moves to the next kept row or
  // column; past the range it keeps its distance from the range's end,
  // on the empty space the grid draws beyond its last cell.
  const nextKept = (map: Map<number, number>, index: number, lastOriginal: number, keptCount: number): number => {
    if (index > lastOriginal) return keptCount + (index - lastOriginal - 1);
    for (let i = index; i <= lastOriginal; i++) {
      const mapped = map.get(i);
      if (mapped !== undefined) return mapped;
    }
    return keptCount;
  };
  const remap = (a: Anchor): Anchor => ({
    col: nextKept(colMap, a.col, lastCol, width),
    colOff: colMap.has(a.col) || a.col > lastCol ? a.colOff : 0,
    row: nextKept(rowMap, a.row, lastRow, compact.length),
    rowOff: rowMap.has(a.row) || a.row > lastRow ? a.rowOff : 0,
  });
  const drawings = sheet.drawings.map((d) => ({ ...d, from: remap(d.from), to: d.to ? remap(d.to) : null }));
  return {
    ...sheet,
    rows: compact,
    colWidths: keptCols.map((c) => sheet.colWidths[c] ?? null),
    merges,
    frozenRows,
    frozenCols,
    drawings,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderWorkbook(workbook: Workbook): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const styleSheet = renderStyleSheet(workbook);
  for (const sheet of workbook.sheets) {
    blocks.push({ type: "HEADING", text: sheet.name, html: "<h2></h2>" });
    // A sheet with no cells but a drawing — a chart sheet, or a worksheet
    // holding only a chart or a picture — draws its grid with the drawing
    // over it: it read "Empty sheet.", and the chart and its data were
    // lost. Sheets benchmark finding (poi-chart_sheet, pd-chartsheet).
    if (sheet.rows.length === 0 && sheet.drawings.length === 0) {
      blocks.push({ type: "PARAGRAPH", text: "Empty sheet." });
      continue;
    }
    const grid = renderGrid(sheet, workbook);
    blocks.push({ type: "SHEET", text: grid.text, html: `${styleSheet}${grid.html}` });
    if (sheet.cutRows !== null) {
      blocks.push({ type: "PARAGRAPH", text: `Cut at row ${sheet.rows.length} of ${sheet.cutRows}.` });
    }
  }
  if (blocks.length === 0) blocks.push({ type: "PARAGRAPH", text: "Empty workbook." });
  return blocks;
}

/** One class per cell style, scoped to this workbook's grids: the cells
    carry the class, so a sheet of ten thousand styled cells stays small. */
function renderStyleSheet(workbook: Workbook): string {
  const rules: string[] = [];
  workbook.styles.forEach((style, i) => {
    const css = cellStyleCss(style);
    if (css) rules.push(`.sheet-k${workbook.styleKey} .x${i}{${css}}`);
  });
  // The style element's text is not the block's text: skipped like a label.
  return rules.length > 0 ? `<style data-anchor-skip>${rules.join("")}</style>` : "";
}

function borderCss(border: Border): string {
  if (!border) return "";
  return `${border.width}px ${border.style} ${border.color}`;
}

function cellStyleCss(style: CellStyle): string {
  const parts: string[] = [];
  if (style.bold) parts.push("font-weight:700");
  if (style.italic) parts.push("font-style:italic");
  const decorations = [style.underline ? "underline" : "", style.strike ? "line-through" : ""].filter(Boolean);
  if (decorations.length > 0) parts.push(`text-decoration:${decorations.join(" ")}`);
  if (style.color) parts.push(`color:${cssValue(style.color)}`);
  if (style.fill) parts.push(`background-color:${cssValue(style.fill)}`);
  if (style.font) parts.push(`font-family:${fontFamilyCss(style.font)}`);
  if (style.sizePt) parts.push(`font-size:${num(style.sizePt * (4 / 3))}px`);
  if (style.align) parts.push(`text-align:${style.align}`);
  if (style.valign) parts.push(`vertical-align:${style.valign}`);
  if (style.wrap) parts.push("white-space:pre-wrap;overflow-wrap:anywhere");
  if (style.indent) parts.push(`padding-left:${num(4 + style.indent * 9)}px`);
  if (style.borders) {
    const b = style.borders;
    if (b.top) parts.push(`border-top:${borderCss(b.top)}`);
    if (b.right) parts.push(`border-right:${borderCss(b.right)}`);
    if (b.bottom) parts.push(`border-bottom:${borderCss(b.bottom)}`);
    if (b.left) parts.push(`border-left:${borderCss(b.left)}`);
  }
  return parts.join(";");
}

function colWidthPx(chars: number | null, fallback: number): number {
  const w = chars ?? fallback;
  return Math.max(20, Math.round(w * 7 + 5));
}

function rowHeightPx(pt: number | null, fallback: number): number {
  return Math.max(16, Math.round((pt ?? fallback) * (4 / 3)));
}

function renderGrid(sheet: Sheet, workbook: Workbook): { text: string; html: string } {
  const cols = sheet.rows.reduce((most, r) => Math.max(most, r.cells.length), 1);
  const widths = Array.from({ length: cols }, (_, c) => colWidthPx(sheet.colWidths[c] ?? null, sheet.defaultColWidthChars));
  const heights = sheet.rows.map((r) => rowHeightPx(r.heightPt, sheet.defaultRowHeightPt));

  // Merge bookkeeping: the origin's span, and which cells are covered.
  const spanAt = new Map<string, { cols: number; rows: number }>();
  const covered = new Set<string>();
  for (const m of sheet.merges) {
    spanAt.set(`${m.r0},${m.c0}`, { cols: m.c1 - m.c0 + 1, rows: m.r1 - m.r0 + 1 });
    for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(`${r},${c}`);
  }

  // Frozen offsets: where a frozen row's or column's cells stick.
  const frozenTop: number[] = [];
  let top = HEADER_HEIGHT_PX;
  for (let r = 0; r < sheet.frozenRows; r++) {
    frozenTop.push(top);
    top += heights[r] ?? 0;
  }
  const frozenLeft: number[] = [];
  let left = ROW_NUMBER_WIDTH_PX;
  for (let c = 0; c < sheet.frozenCols; c++) {
    frozenLeft.push(left);
    left += widths[c] ?? 0;
  }

  const totalWidth = ROW_NUMBER_WIDTH_PX + widths.reduce((a, b) => a + b, 0);
  const colgroup = `<colgroup><col style="width:${ROW_NUMBER_WIDTH_PX}px">${widths.map((w) => `<col style="width:${w}px">`).join("")}</colgroup>`;
  const head = `<thead data-anchor-skip><tr style="height:${HEADER_HEIGHT_PX}px"><th class="sheet-corner sheet-fc" style="left:0"></th>${widths
    .map((_, c) => `<th class="sheet-col${c < sheet.frozenCols ? " sheet-fc" : ""}"${c < sheet.frozenCols ? ` style="left:${frozenLeft[c]}px"` : ""}>${columnLetter(c)}</th>`)
    .join("")}</tr></thead>`;

  const textRows: string[] = [];
  const htmlRows: string[] = [];
  const lastRow = sheet.rows.length - 1;
  for (let r = 0; r <= lastRow; r++) {
    const row = sheet.rows[r];
    const frozenRow = r < sheet.frozenRows;
    const rowStyle = `height:${heights[r]}px${frozenRow ? `;--sheet-top:${frozenTop[r]}px` : ""}`;
    const cells: string[] = [];
    const texts: string[] = [];
    let pendingGaps = "";
    for (let c = 0; c < cols; c++) {
      const cell = row.cells[c] ?? { text: "", kind: "empty" as const, styleId: null };
      const last = c === cols - 1;
      const sep = last ? (r === lastRow ? "" : textGap("\n")) : textGap("\t");
      // A merged-away cell shows nothing, as a spreadsheet shows it: its own
      // words, which a file may keep, went into the block's text and not
      // into the grid, so the grid's text was not the block's. Sheets
      // benchmark finding (synth-merged-hidden-words).
      if (covered.has(`${r},${c}`)) {
        texts.push("");
        pendingGaps += sep;
        continue;
      }
      texts.push(cell.text);
      const span = spanAt.get(`${r},${c}`);
      const classes: string[] = [];
      if (cell.styleId !== null && workbook.styles[cell.styleId] && cellStyleCss(workbook.styles[cell.styleId])) classes.push(`x${cell.styleId}`);
      const style = cell.styleId !== null ? workbook.styles[cell.styleId] : undefined;
      if (!style?.align) {
        if (cell.kind === "number") classes.push("sheet-num");
        else if (cell.kind === "bool" || cell.kind === "error") classes.push("sheet-mid");
      }
      // Text longer than its cell runs over empty neighbors, as a sheet
      // shows it; otherwise it is clipped at the cell's edge.
      if (!style?.wrap) {
        const next = row.cells[c + 1];
        const nextEmpty =
          !span &&
          (c + 1 >= cols ||
            ((!next || next.kind === "empty") &&
              !covered.has(`${r},${c + 1}`) &&
              !(next?.styleId !== null && next?.styleId !== undefined && workbook.styles[next.styleId]?.fill)));
        classes.push(cell.kind === "text" && nextEmpty ? "sheet-over" : "sheet-clip");
      }
      const frozenCol = c < sheet.frozenCols;
      if (frozenCol) classes.push("sheet-fc");
      if (frozenRow) classes.push("sheet-fr");
      const styles: string[] = [];
      if (frozenCol) styles.push(`left:${frozenLeft[c]}px`);
      const attrs = [
        classes.length > 0 ? ` class="${classes.join(" ")}"` : "",
        styles.length > 0 ? ` style="${styles.join(";")}"` : "",
        span && span.cols > 1 ? ` colspan="${span.cols}"` : "",
        span && span.rows > 1 ? ` rowspan="${span.rows}"` : "",
        cell.formula ? ` title="=${escapeHtml(cell.formula)}"` : "",
        cell.formula && cell.format !== undefined ? ` data-fmt="${escapeHtml(String(cell.format))}"` : "",
      ].join("");
      const content = cell.href
        ? `<a href="${escapeHtml(cell.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(cell.text)}</a>`
        : escapeHtml(cell.text);
      cells.push(`<td${attrs}>${pendingGaps}${content}${sep}</td>`);
      pendingGaps = "";
    }
    if (pendingGaps) {
      if (cells.length > 0) cells[cells.length - 1] = cells[cells.length - 1].replace(/<\/td>$/, `${pendingGaps}</td>`);
      else cells.push(`<td style="display:none">${pendingGaps}</td>`);
    }
    const rowNumber = `<th class="sheet-rn sheet-fc${frozenRow ? " sheet-fr" : ""}" style="left:0" data-anchor-skip>${r + 1}</th>`;
    htmlRows.push(`<tr style="${rowStyle}">${rowNumber}${cells.join("")}</tr>`);
    textRows.push(texts.join("\t"));
  }

  // The drawings, over the grid at their anchors. A chart's data is the
  // block's words and follows the rows in the text; its SVG is skipped.
  // A drawing past the grid's last column or row lies on the empty space
  // beyond it, columns and rows there at the sheet's default sizes; the
  // grid's text never grows for it.
  const defaultW = colWidthPx(null, sheet.defaultColWidthChars);
  const defaultH = rowHeightPx(null, sheet.defaultRowHeightPt);
  const colLeft = (c: number) =>
    ROW_NUMBER_WIDTH_PX + widths.slice(0, Math.min(c, widths.length)).reduce((a, b) => a + b, 0) + Math.max(0, c - widths.length) * defaultW;
  const rowTop = (r: number) =>
    HEADER_HEIGHT_PX + heights.slice(0, Math.min(r, heights.length)).reduce((a, b) => a + b, 0) + Math.max(0, r - heights.length) * defaultH;
  let innerWidth = totalWidth;
  let innerHeight = 0;
  const px = (emu: number) => emu / 9525;
  const drawingHtml: string[] = [];
  const drawingText: string[] = [];
  for (const d of sheet.drawings) {
    const left = colLeft(d.from.col) + px(d.from.colOff);
    const top = rowTop(d.from.row) + px(d.from.rowOff);
    let w: number;
    let h: number;
    if (d.to) {
      w = colLeft(d.to.col) + px(d.to.colOff) - left;
      h = rowTop(d.to.row) + px(d.to.rowOff) - top;
    } else if (d.ext) {
      w = px(d.ext.cx);
      h = px(d.ext.cy);
    } else continue;
    if (w < 4 || h < 4) continue;
    innerWidth = Math.max(innerWidth, Math.ceil(left + w));
    innerHeight = Math.max(innerHeight, Math.ceil(top + h));
    const style = `left:${num(left)}px;top:${num(top)}px;width:${num(w)}px;height:${num(h)}px`;
    if (d.content.kind === "image") {
      drawingHtml.push(`<div class="sheet-drawing" style="${style}" data-anchor-skip><img src="${escapeHtml(d.content.url)}" alt="" loading="lazy" draggable="false"></div>`);
    } else if (d.content.kind === "chart") {
      const gap = textRows.length > 0 || drawingText.length > 0 ? textGap("\n") : "";
      drawingHtml.push(`<div class="sheet-drawing" style="${style}"><div data-anchor-skip>${d.content.svg}</div>${gap}<div class="scd-hidden">${d.content.html}</div></div>`);
      drawingText.push(d.content.text);
    } else {
      const fill = d.content.fill ? `background-color:${d.content.fill};` : "";
      drawingHtml.push(`<div class="sheet-drawing" style="${style}" data-anchor-skip><div class="sheet-drawing-shape" style="${fill}">${d.content.html}</div></div>`);
    }
  }
  const fonts = fontListAttr(workbook.fonts);
  const html =
    `<div class="sheet sheet-k${workbook.styleKey}" data-sheet="${escapeHtml(sheet.name)}" data-rows="${sheet.rows.length}" data-cols="${cols}" data-frozen-rows="${sheet.frozenRows}" data-frozen-cols="${sheet.frozenCols}"${fonts ? ` data-fonts="${escapeHtml(fonts)}"` : ""}>` +
    `<div class="sheet-inner" style="width:${innerWidth}px${innerHeight > 0 ? `;min-height:${innerHeight}px` : ""}"><table style="width:${totalWidth}px">${colgroup}${head}<tbody>${htmlRows.join("")}</tbody></table>${drawingHtml.join("")}</div></div>`;
  return { text: [...textRows, ...drawingText].join("\n"), html };
}
