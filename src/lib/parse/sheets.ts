import { createHash } from "node:crypto";
import * as ssf from "ssf";
import type { ParsedBlock, ParsedDocument } from "@/lib/parse/types";
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
  relsOfType,
  rgbCss,
  textGap,
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
// tooltip. The block's text is the rows, cells separated by tabs and rows
// by newlines, and the grid's DOM text is exactly that text (SPEC.md §5):
// every cell ends in an invisible gap, and a merged-away cell's tab rides
// inside the cell that covers it. Hidden rows and columns are left out of
// both. A sheet past the caps is cut and says so.

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

type Cell = { text: string; kind: CellKind; styleId: number | null; href?: string; formula?: string };

type Row = { cells: Cell[]; heightPt: number | null };

type Merge = { r0: number; c0: number; r1: number; c1: number };

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
};

type Workbook = {
  sheets: Sheet[];
  styles: CellStyle[]; // by xf index
  styleKey: string; // the class prefix the styles render under
};

// ── Entry: .xlsx ─────────────────────────────────────────────────────────────

export function parseSheets(bytes: Uint8Array, filename: string): ParsedDocument {
  const zip = unzipOffice(bytes);
  const workbook = readWorkbook(zip, bytes);
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
export function parseDelimited(text: string, filename: string, delimiter?: Delimiter): ParsedDocument {
  const sep = delimiter ?? sniffDelimiter(text);
  const table = parseDelimitedText(text.replace(/^﻿/, ""), sep);
  const rows: Row[] = table.map((cells) => ({
    cells: cells.map((value) => ({ text: cleanText(value), kind: valueKind(value), styleId: null })),
    heightPt: null,
  }));
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
    cutRows: null,
  };
  const workbook: Workbook = { sheets: [sheet], styles: [], styleKey: styleKeyOf(Buffer.from(text)) };
  return { title, blocks: renderWorkbook(workbook), format: "sheets" };
}

/** Which delimiter the text uses: the one that splits the first lines into
    the same number of fields most often; a comma when nothing tells. */
export function sniffDelimiter(text: string): Delimiter {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 20);
  let best: Delimiter = ",";
  let bestScore = -1;
  for (const sep of ["\t", ",", ";"] as const) {
    const counts = lines.map((l) => l.split(sep).length - 1);
    if (counts.length === 0) continue;
    const consistent = counts.filter((c) => c > 0 && c === counts[0]).length;
    const score = consistent * 10 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = sep;
    }
  }
  return best;
}

/** RFC 4180: quoted fields may hold the delimiter, newlines, and doubled quotes. */
function parseDelimitedText(text: string, sep: Delimiter): string[][] {
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
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
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

function readWorkbook(zip: OfficeZip, bytes: Uint8Array): Workbook {
  const workbookPath = "xl/workbook.xml";
  const doc = parseXmlPart(zip, workbookPath);
  if (!doc) throw new Error("Not a workbook: xl/workbook.xml is missing");
  const rels = partRels(zip, workbookPath);
  const date1904 = boolAttr(descendants(doc, "workbookPr")[0], "date1904");
  const themeRel = relsOfType(rels, "theme")[0];
  const theme = themeRel && !themeRel.external ? parseTheme(zip, themeRel.target) : { colors: {}, major: "", minor: "" };
  const shared = readSharedStrings(zip, rels);
  const styles = readStyles(zip, rels, theme.colors);
  const sheets: Sheet[] = [];
  for (const sheetEl of descendants(doc, "sheet")) {
    if (attr(sheetEl, "state") === "hidden" || attr(sheetEl, "state") === "veryHidden") continue;
    const rid = attr(sheetEl, "id");
    const rel = rid ? rels.get(rid) : undefined;
    if (!rel || rel.external) continue;
    const name = cleanText(attr(sheetEl, "name") ?? `Sheet ${sheets.length + 1}`);
    const sheet = readSheet(zip, rel.target, name, shared, styles, date1904);
    if (sheet) sheets.push(sheet);
  }
  return { sheets, styles: styles.cellStyles, styleKey: styleKeyOf(bytes) };
}

function readSharedStrings(zip: OfficeZip, rels: Map<string, Relationship>): string[] {
  const rel = relsOfType(rels, "sharedStrings")[0];
  const doc = parseXmlPart(zip, rel && !rel.external ? rel.target : "xl/sharedStrings.xml");
  if (!doc) return [];
  return descendants(doc, "si").map((si) => richText(si));
}

/** The text of a rich-text element: its own <t> or its runs' <t>, phonetic
    guides left out. */
function richText(el: Element): string {
  let out = "";
  for (const node of Array.from(el.children)) {
    if (node.localName === "t") out += node.textContent ?? "";
    else if (node.localName === "r") out += child(node, "t")?.textContent ?? "";
  }
  return cleanText(out);
}

type Styles = {
  cellStyles: CellStyle[];
  numFmts: (string | number)[]; // by xf index: a format code or a built-in id
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
  if (!doc) return { cellStyles, numFmts };
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
  return { cellStyles, numFmts };
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
): Sheet | null {
  const doc = parseXmlPart(zip, path);
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

  // Hyperlinks by cell.
  const hrefByRef = new Map<string, string>();
  for (const link of descendants(child(root, "hyperlinks"), "hyperlink")) {
    const ref = attr(link, "ref");
    const rid = attr(link, "id");
    const rel = rid ? rels.get(rid) : undefined;
    const href = rel?.external ? rel.target : null;
    if (ref && href && /^(https?:\/\/|mailto:)/i.test(href)) hrefByRef.set(ref.split(":")[0].toUpperCase(), href);
  }

  // The cells, row by row. Rows and cells may omit their references: they
  // then follow the last one.
  const rows: Row[] = [];
  const hiddenRows = new Set<number>();
  let rowCursor = 0;
  let cellCount = 0;
  let totalRows = 0;
  let cut = false;
  const sheetData = child(root, "sheetData");
  for (const rowEl of children(sheetData, "row")) {
    const r = (intAttr(rowEl, "r") ?? rowCursor + 1) - 1;
    rowCursor = r;
    totalRows = r + 1;
    if (cut) continue;
    if (r >= SHEET_MAX_ROWS || cellCount >= SHEET_MAX_CELLS) {
      cut = true;
      continue;
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
      const cell = readCell(c, shared, styles, date1904);
      const href = hrefByRef.get(`${columnLetter(col)}${r + 1}`);
      if (href) cell.href = href;
      cells[col] = cell;
      cellCount++;
    }
    rows[r] = { cells, heightPt };
  }

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

  const sheet = compactSheet({
    name,
    rows,
    colWidths,
    merges,
    frozenRows,
    frozenCols,
    defaultRowHeightPt,
    defaultColWidthChars,
    cutRows: cut ? totalRows : null,
  }, hiddenRows, hiddenCols, (id) => {
    const style = styles.cellStyles[id];
    return Boolean(style && (style.fill || style.borders));
  });
  return sheet;
}

function readCell(c: Element, shared: string[], styles: Styles, date1904: boolean): Cell {
  const type = attr(c, "t") ?? "n";
  const styleId = intAttr(c, "s");
  const v = child(c, "v")?.textContent ?? "";
  const formula = child(c, "f")?.textContent?.trim() || undefined;
  const base = { styleId, formula };
  switch (type) {
    case "s": {
      const text = shared[Number(v)] ?? "";
      return { ...base, text, kind: text === "" ? "empty" : "text" };
    }
    case "str":
      return { ...base, text: cleanText(v), kind: v === "" ? "empty" : "text" };
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
      const text = Number.isNaN(date.getTime()) ? cleanText(v) : formatNumber(dateSerial(date, date1904), styleId, styles, date1904);
      return { ...base, text, kind: "number" };
    }
    default: {
      if (v === "") return { ...base, text: "", kind: "empty" };
      const n = Number(v);
      if (!Number.isFinite(n)) return { ...base, text: cleanText(v), kind: "text" };
      return { ...base, text: formatNumber(n, styleId, styles, date1904), kind: "number" };
    }
  }
}

function dateSerial(date: Date, date1904: boolean): number {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return (date.getTime() - epoch) / 86400000;
}

/** A number as the cell's format shows it. General shows up to 11
    significant digits, as Excel does; a broken format shows the number. */
function formatNumber(n: number, styleId: number | null, styles: Styles, date1904: boolean): string {
  const fmt = styleId !== null ? styles.numFmts[styleId] ?? 0 : 0;
  try {
    return cleanText(ssf.format(fmt, n, { date1904 }));
  } catch {
    try {
      return cleanText(ssf.format(0, n, { date1904 }));
    } catch {
      return String(n);
    }
  }
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
  return {
    ...sheet,
    rows: compact,
    colWidths: keptCols.map((c) => sheet.colWidths[c] ?? null),
    merges,
    frozenRows,
    frozenCols,
  };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderWorkbook(workbook: Workbook): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const styleSheet = renderStyleSheet(workbook);
  for (const sheet of workbook.sheets) {
    blocks.push({ type: "HEADING", text: sheet.name, html: "<h2></h2>" });
    if (sheet.rows.length === 0) {
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
  const cols = Math.max(1, ...sheet.rows.map((r) => r.cells.length));
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
      texts.push(cell.text);
      if (covered.has(`${r},${c}`)) {
        pendingGaps += sep;
        continue;
      }
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

  const html =
    `<div class="sheet sheet-k${workbook.styleKey}" data-sheet="${escapeHtml(sheet.name)}" data-rows="${sheet.rows.length}" data-cols="${cols}" data-frozen-rows="${sheet.frozenRows}" data-frozen-cols="${sheet.frozenCols}">` +
    `<table style="width:${totalWidth}px">${colgroup}${head}<tbody>${htmlRows.join("")}</tbody></table></div>`;
  return { text: textRows.join("\n"), html };
}
