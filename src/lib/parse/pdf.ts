import { getDocumentProxy } from "unpdf";
import type { LinkSpan, ParsedBlock, StyleSpan } from "@/lib/parse/types";
import type { Region } from "@/lib/video/types";

// pdf.js calls Math.sumPrecise while it rebuilds font programs. Node 22 has no
// such function, so every TrueType font translation failed with a warning and
// the fonts it dropped never resolved to a name — no bold or italic flags for
// their text (import compare loop finding).
const mathWithSum = Math as Math & { sumPrecise?: (values: Iterable<number>) => number };
if (typeof mathWithSum.sumPrecise !== "function") {
  mathWithSum.sumPrecise = (values) => {
    let sum = 0;
    for (const v of values) sum += v;
    return sum;
  };
}

// PDF → blocks. Deterministic, no AI passes. Beyond text and reading order, the
// parse keeps what the PDF's fonts and geometry say: bold/italic/monospace runs
// become style spans, monospace paragraphs become CODE, indent-and-gap groups
// become LIST (bullet glyphs are often vector art and never reach the text
// layer), wide-gap runs become TABLE with header rows, repeated page furniture
// drops, letter-spaced caps collapse, and Contents entries link to their
// section headings.

type Flags = { bold: boolean; italic: boolean; mono: boolean; href: string | null };
// math: the glyph comes from a math font (Computer Modern math and symbol
// fonts, AMS fonts, Cambria Math, STIX) — display equations are made of them.
type Item = Flags & { str: string; x: number; y: number; w: number; size: number; math: boolean };
type Run = Flags & { start: number; end: number };
type Cell = { x: number; text: string; runs: Run[] };
type Line = {
  cells: Cell[];
  text: string; // cells joined with \t
  runs: Run[]; // style runs over text; every run's chars share one Flags value
  items: Item[]; // kept for table column re-splitting
  x: number;
  xEnd: number;
  y: number;
  size: number;
  page: number;
  firstWordWidth: number;
  mathChars: number; // glyphs from math fonts, for equation detection
  yMin: number; // lowest and highest glyph baselines in the line (a raised
  yMax: number; // superscript, a lowered limit): the line's vertical extent
};
type UriRegion = { href: string; x1: number; y1: number; x2: number; y2: number };
// A box in PDF points: y1 the bottom edge, y2 the top edge (y grows upward).
type Box = { x1: number; y1: number; x2: number; y2: number };

// Internal block: ParsedBlock plus what the cross-page passes need.
type Segment = ParsedBlock & {
  page: number;
  rawSize?: number; // heading candidate size, for level ranking
  runs?: Run[]; // style runs over text; spans emit after all merges
  listItem?: boolean; // lone indented item; may join a LIST across the page break
  tocEntries?: { start: number; end: number; num: number }[];
  headingNum?: number; // leading number of a numbered heading ("3." → 3)
  box?: Box; // the lines' extent on the page, for figure regions
  captionBox?: Box; // a captioned FIGURE: where its caption sits (outside box)
  lineSize?: number; // the lines' median font size
  mathShare?: number; // share of glyphs from math fonts
};

const BULLET_RE = /^\s*([•▪◦‣●·*-]|\d{1,2}[.)]|\([a-z\d]{1,3}\)|[ivx]{1,4}[.)])\s+/i;
const GLYPH_BULLET_RE = /^\s*[•▪◦‣●·*-]\s+/;
// Numbered heading: the number must close with "." or ")" or dot into a
// sub-number — "3.1 Results" and "1. Summary" match, "23 advertisers" does not.
// "3.1 Results", "2. Background", and the bare "2 Background" (ACL style).
// The word after the number starts uppercase — a body line rarely does.
const HEADING_NUM_STRICT_RE = /^(\d{1,2}((\.\d{1,2})+\.?|[.)])?|[A-Z](\.\d{1,2})+\.?)\s+[\p{Lu}\p{Lo}]/u;
// An appendix section: "A Benchmarks and audits" — a letter alone, bold.
const LETTER_HEADING_RE = /^[A-Z]\s+[\p{Lu}]/u;
// The number of a heading and its depth: "3" → 1, "3.2" → 2, "A.1" → 2.
const HEADING_NUMBER_RE = /^(\d{1,2}|[A-Z])((?:\.\d{1,2})*)\.?[.)]?\s/;
function headingDepth(text: string): number | null {
  const m = HEADING_NUMBER_RE.exec(text);
  if (!m) return null;
  return 1 + (m[2].match(/\./g)?.length ?? 0);
}
const TOC_LABEL_RE = /^((appendix )?contents|table of contents|inside|outline|in this issue)$/i;
const TOC_ENTRY_RE = /^(\d{1,2}|[A-Z])(?:\.\d{1,2})*[.)]?\s+\S/;
// Leader dots and the page number at the end of a contents entry: the reader
// has no pages to turn to.
const TOC_TAIL_RE = /(?:\s*\.){3,}\s*\d{1,4}\s*$|\s+\d{1,4}\s*$/;
function tocEntryPart(line: Line): { text: string; runs: Run[] } {
  const part = lineAsPart(line);
  const text = part.text.replace(TOC_TAIL_RE, "").trimEnd();
  return { text, runs: part.runs.map((r) => ({ ...r, end: Math.min(r.end, text.length) })).filter((r) => r.end > r.start) };
}
const ATTACH_PUNCT_RE = /^[.,;:!?)\]…%]/;
const CJK_START_RE = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const NUMERIC_TOKEN_RE = /^[\d.,%$€£+−–-]+$/;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
// Some generators map common CJK glyphs to the Kangxi Radicals and CJK
// Radicals Supplement blocks (⼴州 for 广州): the glyph looks right and a
// search for the word finds nothing. NFKC folds the Kangxi block; the
// supplement has no decompositions, so a table covers its common members.
const RADICAL_RE = /[\u2E80-\u2FDF]/g;
const RADICAL_MAP: Record<string, string> = {
  "⺁": "厂", "⺄": "乙", "⺈": "刀", "⺊": "卜", "⺌": "小", "⺍": "小", "⺕": "彐", "⺗": "心",
  "⺘": "手", "⺙": "攴", "⺛": "无", "⺜": "日", "⺝": "月", "⺟": "母", "⺠": "民", "⺡": "水",
  "⺢": "水", "⺣": "火", "⺤": "爪", "⺥": "爪", "⺦": "爿", "⺧": "牛", "⺨": "犬", "⺩": "玉",
  "⺪": "疋", "⺫": "网", "⺬": "示", "⺭": "示", "⺮": "竹", "⺯": "糸", "⺰": "纟", "⺱": "网",
  "⺲": "网", "⺳": "网", "⺶": "羊", "⺷": "羊", "⺸": "羊", "⺹": "老", "⺺": "耒", "⺻": "聿",
  "⺼": "肉", "⺽": "臼", "⺾": "艸", "⺿": "艸", "⻀": "艸", "⻁": "虎", "⻂": "衣", "⻃": "西",
  "⻄": "西", "⻅": "见", "⻆": "角", "⻇": "角", "⻈": "讠", "⻉": "贝", "⻊": "足", "⻋": "车",
  "⻌": "辶", "⻍": "辶", "⻎": "辶", "⻏": "邑", "⻐": "钅", "⻑": "长", "⻒": "长", "⻓": "长",
  "⻔": "门", "⻕": "阜", "⻖": "阜", "⻗": "雨", "⻘": "青", "⻙": "韦", "⻚": "页", "⻛": "风",
  "⻜": "飞", "⻝": "食", "⻞": "食", "⻟": "饣", "⻠": "饣", "⻡": "首", "⻢": "马", "⻣": "骨",
  "⻤": "鬼", "⻥": "鱼", "⻦": "鸟", "⻧": "卤", "⻨": "麦", "⻩": "黄", "⻪": "黾", "⻫": "斉",
  "⻬": "齐", "⻭": "齿", "⻮": "齿", "⻯": "竜", "⻰": "龙", "⻱": "龟", "⻲": "龟", "⻳": "龟",
};
function normalizeGlyphs(str: string): string {
  return str
    .replace(RADICAL_RE, (ch) => RADICAL_MAP[ch] ?? ch.normalize("NFKC"))
    .replace(/\u2012/g, "\u2013")
    .replace(/([¨´`ˆ˜ˇ¸˚˝¯˘˙])(\p{L})/gu, (_, accent: string, letter: string) =>
      (letter + SPACING_ACCENTS[accent]).normalize("NFC"),
    );
}
// A spacing accent drawn as its own glyph before the base letter (LaTeX's
// \"u): composed with the letter it overlaps.
const SPACING_ACCENTS: Record<string, string> = {
  "¨": "\u0308", "´": "\u0301", "`": "\u0300", "ˆ": "\u0302", "^": "\u0302", "˜": "\u0303",
  "~": "\u0303", "ˇ": "\u030C", "¸": "\u0327", "˚": "\u030A", "˝": "\u030B", "¯": "\u0304",
  "˘": "\u0306", "˙": "\u0307",
};
// Line-end hyphenation: the compounds a document writes with a hyphen inside a
// line keep the hyphen when they wrap; any other wrapped hyphen was the
// typesetter's and goes.
let hyphenCompounds = new Set<string>();
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;

// ── Font flags ──────────────────────────────────────────────────────────────

type FontFlags = Omit<Flags, "href"> & { math: boolean; cmex: boolean };

function fontFlags(name: string | null): FontFlags {
  const n = (name ?? "").replace(/^[A-Z]{6}\+/, ""); // subset prefix "HAAAAA+"
  return {
    // Computer Modern (CMBX, CMTI, CMTT), Nimbus (-Medi, -ReguItal) and Latin
    // Modern names carry weight and shape in abbreviations, not words.
    bold: /bold|black|heavy|semi ?bold|demi|medi(?:ital|obli)?$|^CMBX|^CMB\d|^CMSSBX|^CMBSY|^LM(?:Roman|Sans|Mono)\d*-Bold/i.test(n),
    italic: /italic|oblique|ital$|obli$|^CMTI|^CMSL|^CMBXTI|^CMSSI|^CMITT|^CMSLTT|slanted/i.test(n),
    mono: /mono|courier|consolas|menlo|typewriter|^CMTT|^CMSLTT|^CMITT|cursor/i.test(n),
    math: /^(CMMI|CMSY|CMEX|CMMIB|CMBSY|MSAM|MSBM|rsfs|eufm|eufb|stmary|wasy|LMMathItalic|LMMathSymbols|LMMathExtension)|Math|Symbol/i.test(n),
    cmex: /^(CMEX|LMMathExtension)/i.test(n),
  };
}

// Computer Modern's math extension font carries no Unicode map: the text layer
// gives each glyph its own code — "Z" for a display integral, "P" for a sum,
// control codes for the big delimiters (import compare loop finding: "Z t"
// and "Q" in equation text; big parentheses lost, so crops cut them off).
const CMEX_DELIMITERS = "()[]⌊⌋⌈⌉{}⟨⟩|‖/\\";
const CMEX_OPERATORS: Record<string, string> = {
  P: "∑", Q: "∏", R: "∫", S: "⋃", T: "⋂", U: "⊎", V: "⋀", W: "⋁",
  X: "∑", Y: "∏", Z: "∫", "[": "⋃", "\\": "⋂", "]": "⊎", "^": "⋀", _: "⋁",
  p: "√", q: "√", r: "√", s: "√", t: "√", u: "√", v: "√",
};
const OPERATOR_GLYPH_RE = /^[∫∑∏⋃⋂⊎⋀⋁√]$/;
function mapCmexGlyphs(str: string): string {
  let out = "";
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code < 0x20) out += CMEX_DELIMITERS[code % 16];
    else if (CMEX_OPERATORS[ch] !== undefined) out += CMEX_OPERATORS[ch];
    else if (/[z{|}]/.test(ch)) continue; // brace and bracket pieces
    else out += ch;
  }
  return out;
}

function sameFlags(a: Flags, b: Flags): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.mono === b.mono && a.href === b.href;
}

// ── Letter-spaced caps ("A L P H A B E T") ──────────────────────────────────

// Inside one item: "A L P H A B E T" → "ALPHABET". Kickers and small-caps
// labels carry their letter spacing as literal spaces in the string.
function collapseSpacedStr(str: string): string {
  const tokens = str.split(" ").filter((t) => t.length > 0);
  if (tokens.length < 3 || !tokens.every((t) => t.length === 1)) return str;
  return tokens.join("");
}

// Across items: one glyph per item with small uniform gaps → merge into words.
function mergeSpacedItems(items: Item[]): Item[] {
  const singles = items.filter((i) => i.str.trim().length === 1).length;
  if (singles < 6 || singles < items.length * 0.6) return items;
  const out: Item[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    const gap = last ? item.x - (last.x + last.w) : Infinity;
    if (
      last &&
      last.str.length <= 2 &&
      item.str.trim().length === 1 &&
      gap >= 0 &&
      gap < item.size * 0.45 &&
      sameFlags(last, item)
    ) {
      last.str += item.str;
      last.w = item.x + item.w - last.x;
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

// ── Line building ───────────────────────────────────────────────────────────

function composeAccents(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let k = 0; k < items.length; k++) {
    const item = items[k];
    // An accent closing one item over the letter opening the next ("…, Kamil˙"
    // then "e"): composed across the split (import compare loop finding).
    const trailing = item.str.length > 1 ? SPACING_ACCENTS[item.str[item.str.length - 1]] : undefined;
    const after = items[k + 1];
    if (trailing && after && /^\p{L}/u.test(after.str) && after.x <= item.x + item.w + item.size * 0.3) {
      out.push({ ...item, str: item.str.slice(0, -1) });
      items[k + 1] = { ...after, str: (after.str[0] + trailing).normalize("NFC") + after.str.slice(1) };
      continue;
    }
    const mark = item.str.length === 1 ? SPACING_ACCENTS[item.str] : undefined;
    if (mark) {
      // The letter under the accent: the glyph of a neighbor item that the
      // accent's center sits over — its first glyph, or with a wider item the
      // glyph at that offset (an accent over the last letter of "Kamilė" read
      // as a stray dot: import compare loop finding).
      const cx = item.x + item.w / 2;
      const glyphAt = (it: Item | undefined): number => {
        if (it === undefined || it.str.length === 0 || it.w <= 0) return -1;
        const advance = it.w / it.str.length;
        const idx = Math.floor((cx - it.x + advance * 0.15) / advance);
        return idx >= 0 && idx < it.str.length && /\p{L}/u.test(it.str[idx]) ? idx : -1;
      };
      const composedAt = (base: Item, idx: number): Item => ({
        ...base,
        str: base.str.slice(0, idx) + (base.str[idx] + mark).normalize("NFC") + base.str.slice(idx + 1),
      });
      const next = items[k + 1];
      const prev = out[out.length - 1];
      const nextIdx = glyphAt(next);
      if (nextIdx >= 0) {
        out.push(composedAt(next!, nextIdx));
        k++;
        continue;
      }
      const prevIdx = glyphAt(prev);
      if (prevIdx >= 0) {
        out[out.length - 1] = composedAt(prev!, prevIdx);
        continue;
      }
    }
    out.push(item);
  }
  return out;
}

function buildLine(rawItems: Item[], page: number): Line {
  const items = mergeSpacedItems(
    composeAccents(
      rawItems
        .map((i) => ({ ...i, str: i.mono ? i.str : collapseSpacedStr(i.str) }))
        .sort((a, b) => a.x - b.x),
    ),
  );
  const size = Math.max(...items.map((i) => i.size));
  const cells: Cell[] = [];
  let prevEnd: number | null = null;
  let prevItem: Item | null = null;
  for (const item of items) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    // A cell boundary: a wide gap, or an em between two numbers — number
    // columns sit closer than the word gap rule allows (a table of Brier
    // scores read as one cell per row: import compare loop finding).
    const numeric =
      prevItem !== null &&
      NUMERIC_TOKEN_RE.test(prevItem.str.trim()) &&
      NUMERIC_TOKEN_RE.test(item.str.trim());
    const wide =
      prevEnd !== null && (gap > Math.max(8, size * 1.6) || (numeric && gap > size * 1.0));
    prevItem = item;
    let cell = cells[cells.length - 1];
    if (!cell || wide) {
      cell = { x: item.x, text: "", runs: [] };
      cells.push(cell);
    } else if (gap > size * 0.12 && !cell.text.endsWith(" ")) {
      // Punctuation that attaches left ("PRESS" chip then ".") takes no space.
      const attach = ATTACH_PUNCT_RE.test(item.str) && gap < size * 0.7;
      if (!attach) cell.text += " ";
    }
    const start = cell.text.length;
    cell.text += item.str;
    const last = cell.runs[cell.runs.length - 1];
    if (last && sameFlags(last, item) && start - last.end <= 1) {
      last.end = cell.text.length;
    } else {
      cell.runs.push({
        start,
        end: cell.text.length,
        bold: item.bold,
        italic: item.italic,
        mono: item.mono,
        href: item.href,
      });
    }
    prevEnd = item.x + item.w;
  }
  for (const cell of cells) {
    const trimmed = cell.text.trimEnd();
    const cut = trimmed.length;
    cell.text = trimmed;
    cell.runs = cell.runs
      .map((r) => ({ ...r, end: Math.min(r.end, cut) }))
      .filter((r) => r.end > r.start);
  }
  let text = "";
  const runs: Run[] = [];
  cells.forEach((cell, i) => {
    if (i > 0) text += "\t";
    const offset = text.length;
    text += cell.text;
    for (const r of cell.runs) runs.push({ ...r, start: r.start + offset, end: r.end + offset });
  });
  const first = items[0];
  // The unit a wrap moves to the next line: a word, or one glyph in a script
  // that wraps anywhere (CJK carries no spaces, so the "first word" of a CJK
  // line was the whole line and every line read as wrapped).
  const firstWord = CJK_START_RE.test(first.str) ? first.str[0] : first.str.split(" ")[0] || first.str;
  const firstWordWidth =
    first.str.length > 0 ? first.w * Math.min(1, firstWord.length / first.str.length) : size;
  const last = items[items.length - 1];
  // The baseline is where the line's text sits: the median baseline of its
  // full-size glyphs. The highest glyph was the baseline before, so a line
  // with a superscript sat too high — its gap to the line above shrank and
  // its gap to the line below grew, splitting paragraphs and fusing others
  // (import compare loop finding).
  const large = items.filter((i) => i.size >= size * 0.75);
  const ys = items.map((i) => i.y);
  return {
    cells,
    text,
    runs,
    items,
    x: first.x,
    xEnd: Math.max(...items.map((i) => i.x + i.w), last.x + last.w),
    y: median(large.map((i) => i.y)),
    size,
    page,
    firstWordWidth,
    mathChars: items.reduce((n, i) => n + (i.math ? i.str.replace(/\s/g, "").length : 0), 0),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

// ── Geometry ────────────────────────────────────────────────────────────────

function boxOf(lines: Line[]): Box {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const l of lines) {
    x1 = Math.min(x1, l.x);
    x2 = Math.max(x2, l.xEnd);
    y1 = Math.min(y1, l.yMin - l.size * 0.3);
    y2 = Math.max(y2, l.yMax + l.size * 0.85);
  }
  return { x1, y1, x2, y2 };
}

function unionBox(a: Box, b: Box): Box {
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

// What a segment's lines say about it: extent, font size, math share.
function geom(lines: Line[]): { box: Box; lineSize: number; mathShare: number } {
  const chars = lines.reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
  const math = lines.reduce((n, l) => n + l.mathChars, 0);
  return {
    box: boxOf(lines),
    lineSize: median(lines.map((l) => l.size)),
    mathShare: chars > 0 ? math / chars : 0,
  };
}

// Share of a line's glyphs set in math fonts.
function lineMathShare(line: Line): number {
  const chars = line.text.replace(/\s/g, "").length;
  return chars > 0 ? line.mathChars / chars : 0;
}

// A box as the §11 percent-coordinate region shape (y measured from the top).
function regionOf(box: Box, pageWidth: number, pageHeight: number): Region {
  const px = (x: number) => Math.min(100, Math.max(0, (x / pageWidth) * 100));
  const py = (y: number) => Math.min(100, Math.max(0, ((pageHeight - y) / pageHeight) * 100));
  const [l, r, t, b] = [px(box.x1), px(box.x2), py(box.y2), py(box.y1)];
  return {
    kind: "path",
    points: [
      [l, t],
      [r, t],
      [r, b],
      [l, b],
    ],
  };
}

function buildLines(items: Item[], page: number): Line[] {
  const sorted = items.filter((i) => i.str.trim().length > 0);
  sorted.sort((a, b) => b.y - a.y || a.x - b.x);
  // A line is the items near one baseline. The anchor is the line's largest
  // item, the tolerance half its size: superscripts, subscripts, and sum
  // limits sit within that of their base line and belong to it (they read as
  // lines of their own before — import compare loop finding).
  const grouped: Item[][] = [];
  const anchors: Item[] = [];
  for (const item of sorted) {
    const last = grouped[grouped.length - 1];
    const anchor = anchors[anchors.length - 1];
    const tolerance = anchor ? Math.max(2, Math.max(anchor.size, item.size) * 0.5) : 0;
    if (last && Math.abs(anchor.y - item.y) < tolerance) {
      last.push(item);
      if (item.size > anchor.size) anchors[anchors.length - 1] = item;
    } else {
      grouped.push([item]);
      anchors.push(item);
    }
  }
  // Superscripts, subscripts, a sum's limits and footnote marks sit on
  // baselines of their own: a glyph set at three quarters of a neighboring
  // line's size or less, within one text height of it, belongs to that line.
  // On their own they read as an equation of their own and their crop pulled
  // the neighboring prose in (import compare loop finding). A lone operator
  // glyph (a radical, an integral sign) inside prose joins the prose line the
  // same way; beside an equation it stays, and the equation's region takes it.
  const stats = grouped.map((g) => {
    const size = Math.max(...g.map((i) => i.size));
    const large = g.filter((i) => i.size >= size * 0.75);
    const chars = g.reduce((n, i) => n + i.str.replace(/\s/g, "").length, 0);
    const mathChars = g.reduce((n, i) => n + (i.math ? i.str.replace(/\s/g, "").length : 0), 0);
    return {
      size,
      y: median(large.map((i) => i.y)),
      x1: Math.min(...g.map((i) => i.x)),
      x2: Math.max(...g.map((i) => i.x + i.w)),
      mathy: chars > 0 && mathChars >= chars * 0.3,
      prose: chars >= 20 && mathChars < chars * 0.5,
    };
  });
  const moved: Item[][] = grouped.map(() => []);
  const kept: Item[][] = grouped.map((g) => [...g]);
  const neighbors = (k: number) => [k - 1, k + 1].filter((n) => n >= 0 && n < grouped.length);
  const overlaps = (item: Item, n: number) =>
    item.x < stats[n].x2 + stats[n].size * 2 && item.x + item.w > stats[n].x1 - stats[n].size * 2;
  const gapTo = (item: Item, n: number) => Math.abs(item.y - stats[n].y);
  // Pass 1: small glyphs and spacing accents join the nearest line within a
  // text height. An equation's limits and exponents join the equation's own
  // line when one is near, never the prose beside it.
  for (let k = 0; k < grouped.length; k++) {
    for (const item of grouped[k]) {
      const glyph = item.str.trim();
      const accent = glyph.length === 1 && SPACING_ACCENTS[glyph] !== undefined;
      const candidates = neighbors(k).filter(
        (n) =>
          (item.size <= stats[n].size * 0.75 || accent) &&
          gapTo(item, n) <= stats[n].size * 1.05 &&
          overlaps(item, n),
      );
      const mathy = candidates.filter((n) => stats[n].mathy);
      const pool = stats[k].mathy && mathy.length > 0 ? mathy : candidates.filter((n) => stats[n].prose || stats[n].mathy);
      if (pool.length === 0) continue;
      // A raised glyph (a superscript, a numerator) belongs to the line under
      // it far more often than to the line above: the line above pays a
      // small penalty when the two are about as near.
      const cost = (n: number) => gapTo(item, n) + (stats[n].y > item.y ? stats[n].size * 0.15 : 0);
      pool.sort((a, b) => cost(a) - cost(b));
      moved[pool[0]].push(item);
      kept[k] = kept[k].filter((i) => i !== item);
    }
  }
  // Pass 2: a lone operator glyph (a radical, an integral sign) joins the
  // prose line it sits in; beside an equation it stays, and the equation's
  // region takes it.
  for (let k = 0; k < grouped.length; k++) {
    if (kept[k].length !== 1 || !OPERATOR_GLYPH_RE.test(kept[k][0].str.trim())) continue;
    const item = kept[k][0];
    if (neighbors(k).some((n) => stats[n].mathy && gapTo(item, n) <= stats[n].size * 1.5 && overlaps(item, n))) continue;
    const pool = neighbors(k)
      .filter((n) => stats[n].prose && gapTo(item, n) <= stats[n].size * 1.05 && overlaps(item, n))
      .sort((a, b) => gapTo(item, a) - gapTo(item, b));
    if (pool.length === 0) continue;
    moved[pool[0]].push(item);
    kept[k] = [];
  }
  const regrouped = kept.map((g, k) => [...g, ...moved[k]]).filter((g) => g.length > 0);
  return regrouped.map((g) => buildLine(g, page)).filter((l) => l.text.length > 0);
}

// Two-column pages: find a middle gutter that almost no text crosses, with two
// prose-shaped columns. A wide table also leaves a gutter, but its sides start
// at many x positions and its left and right lines share baselines — those
// pages stay in one pass so rows keep their reading order.
function pageLines(items: Item[], pageWidth: number, page: number): Line[] {
  const chars = (list: Item[]) => list.reduce((n, i) => n + i.str.length, 0);
  const total = chars(items);
  if (total === 0) return [];

  let best: { g: number; crossChars: number } | null = null;
  for (let g = pageWidth * 0.44; g <= pageWidth * 0.58; g += pageWidth * 0.02) {
    const crossers = items.filter((i) => i.x < g && i.x + i.w > g && i.str.trim().length > 0);
    const crossChars = chars(crossers);
    if (!best || crossChars < best.crossChars) best = { g, crossChars };
  }
  const g = best ? best.g : pageWidth / 2;
  const left = items.filter((i) => i.x + i.w <= g);
  const right = items.filter((i) => i.x >= g);
  const full = items.filter((i) => i.x < g && i.x + i.w > g);

  // Prose columns start their lines at the body edge or the paragraph indent —
  // two x positions cover almost every line. Table sides scatter across many.
  const columnShaped = (side: Item[]): boolean => {
    const lines = buildLines(side, page);
    if (lines.length < 6) return false;
    const counts = new Map<number, number>();
    for (const line of lines) {
      const x = Math.round(line.x / 4) * 4;
      counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    const sorted = [...counts.values()].sort((a, b) => b - a);
    return (sorted[0] ?? 0) + (sorted[1] ?? 0) >= lines.length * 0.62;
  };
  // Shared baselines do NOT discriminate: LaTeX sets both columns on one
  // baseline grid, so real columns share most baselines. Shape decides.
  const twoColumn =
    best !== null &&
    best.crossChars / total < 0.15 &&
    chars(left) / total > 0.2 &&
    chars(right) / total > 0.2 &&
    columnShaped(left) &&
    columnShaped(right);

  if (!twoColumn) return buildLines(items, page);

  const leftLines = buildLines(left, page);
  const rightLines = buildLines(right, page);
  const fullLines = buildLines(full, page).sort((a, b) => b.y - a.y);

  const ordered: Line[] = [];
  let pendingLeft = [...leftLines];
  let pendingRight = [...rightLines];
  for (const boundary of fullLines) {
    const above = (l: Line) => l.y > boundary.y;
    ordered.push(...pendingLeft.filter(above));
    ordered.push(...pendingRight.filter(above));
    pendingLeft = pendingLeft.filter((l) => !above(l));
    pendingRight = pendingRight.filter((l) => !above(l));
    ordered.push(boundary);
  }
  ordered.push(...pendingLeft, ...pendingRight);
  return ordered;
}

// ── Shared math ─────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Text assembly across lines ──────────────────────────────────────────────

// Joins line texts while shifting style runs. A wrap hyphen stays a hyphen:
// office-suite PDFs wrap after real compound hyphens ("AI-", "non-"), they do
// not auto-hyphenate words, so dropping the hyphen mangles compounds.
class TextBuilder {
  text = "";
  runs: Run[] = [];

  dropTrailingChar() {
    if (this.text.length === 0) return;
    this.text = this.text.slice(0, -1);
    const cut = this.text.length;
    this.runs = this.runs.map((r) => ({ ...r, end: Math.min(r.end, cut) })).filter((r) => r.end > r.start);
  }

  append(part: { text: string; runs: Run[] }, sep: " " | "\n" | "") {
    if (this.text.length === 0) {
      this.text = part.text;
      this.runs = part.runs.map((r) => ({ ...r }));
      return;
    }
    let s: string = sep;
    if (sep === " " && /[A-Za-z0-9][-–]$/.test(this.text) && /^[A-Za-z0-9(]/.test(part.text)) s = "";
    const offset = this.text.length + s.length;
    this.text += s + part.text;
    for (const r of part.runs) {
      const shifted = { ...r, start: r.start + offset, end: r.end + offset };
      const last = this.runs[this.runs.length - 1];
      if (
        last &&
        sameFlags(last, shifted) &&
        shifted.start - last.end <= s.length &&
        s !== "\n"
      ) {
        last.end = shifted.end;
      } else {
        this.runs.push(shifted);
      }
    }
  }
}

// The tab between cells is the TABLE separator; in a paragraph, heading, or
// list a multi-cell line reads with a space (a lone "20:00<tab>Dinner" line
// carried the tab into its paragraph — import compare loop finding).
function lineAsPart(line: Line): { text: string; runs: Run[] } {
  return { text: line.text.replace(/\t/g, " "), runs: line.runs };
}

// Would the next line's first word have fit on this line? If yes, the break
// was intentional — keep it as a line break instead of a joining space.
function fillsMargin(line: Line, next: Line, rightEdge: number): boolean {
  return line.xEnd + line.size * 0.28 + next.firstWordWidth > rightEdge - 1;
}

// A field row starts with a short bold label ("Written", "Status") followed by
// regular text. Two or more of them in one group means the group is a field
// list: every line keeps its own row. A bold run that continues from the
// previous line is a wrapped span, not a label.
function startsWithBoldLead(line: Line): boolean {
  const first = line.runs[0];
  if (!first || !first.bold || first.start > 0) return false;
  if (first.end >= line.text.length) return false; // wholly bold line
  const lead = line.text.slice(first.start, first.end);
  return lead.length <= 40 && /^[A-Z0-9]/.test(lead);
}

function endsBold(line: Line): boolean {
  const last = line.runs[line.runs.length - 1];
  return last !== undefined && last.bold && last.end >= line.text.trimEnd().length;
}

// Join a group of lines into one text: spaces where the text wrapped, line
// breaks where the break was intentional. In prose (proseJoin), a break that
// lands mid-sentence — no terminal punctuation before it, lowercase or a
// number after it — is a wrap whatever the margin says.
function joinGroup(lines: Line[], proseJoin = false): { text: string; runs: Run[] } {
  const builder = new TextBuilder();
  if (lines.length === 0) return builder;
  const rightEdge = Math.max(...lines.map((l) => l.xEnd));
  const boldLeads = lines.filter(
    (l, i) => startsWithBoldLead(l) && (i === 0 || !endsBold(lines[i - 1])),
  ).length;
  const fieldList = boldLeads >= 2 && boldLeads >= Math.ceil(lines.length * 0.6);
  builder.append(lineAsPart(lines[0]), "");
  for (let i = 1; i < lines.length; i++) {
    const prevText = lines[i - 1].text.trim();
    const nextText = lines[i].text;
    const wrapped = fillsMargin(lines[i - 1], lines[i], rightEdge);
    const midSentence =
      proseJoin &&
      !/[.!?:…。！？：]["'”]?$/.test(prevText) &&
      (/^[a-z0-9($€£"'“]/.test(nextText) || CJK_CHAR_RE.test(nextText[0] ?? ""));
    let sep: " " | "\n" | "" = fieldList ? "\n" : wrapped || midSentence ? " " : "\n";
    if (sep === " ") {
      const lastChar = prevText[prevText.length - 1] ?? "";
      const firstChar = nextText[0] ?? "";
      // CJK wraps anywhere and carries no space; a URL wraps without one.
      if (CJK_CHAR_RE.test(lastChar) && CJK_CHAR_RE.test(firstChar)) sep = "";
      else if (/https?:\/\/\S*$/.test(prevText) || /^\S*(?:\/|\.[a-z]{2,4}\/)\S*$/.test(nextText.split(" ")[0]) && /\/\S*$/.test(prevText)) sep = "";
      else {
        // A hyphen at the wrap: the typesetter's unless the document writes
        // the compound with one inside a line.
        const left = /(\p{L}+)-$/u.exec(prevText);
        const right = /^(\p{Ll}+)/u.exec(nextText);
        // An acronym before the hyphen ("AAR-" / "generated") is a compound,
        // never a syllable break.
        const acronym = left !== null && /^\p{Lu}{2,}$/u.test(left[1]);
        if (left && right && !acronym && !hyphenCompounds.has(`${left[1]}-${right[1]}`.toLowerCase())) {
          builder.dropTrailingChar();
          sep = "";
        }
      }
    }
    builder.append(lineAsPart(lines[i]), sep);
  }
  return builder;
}

// ── Style and link spans out of runs ────────────────────────────────────────

function spansFromRuns(
  text: string,
  runs: Run[] | undefined,
  opts: { skipBold?: boolean; skipMono?: boolean } = {},
): { styles: StyleSpan[]; links: LinkSpan[] } {
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  if (!runs || runs.length === 0) return { styles, links };

  const collect = (flag: "bold" | "italic" | "mono"): { start: number; end: number }[] => {
    const ranges: { start: number; end: number }[] = [];
    for (const r of runs) {
      if (!r[flag]) continue;
      const last = ranges[ranges.length - 1];
      if (last && r.start - last.end <= 1 && text.slice(last.end, r.start).trim() === "") {
        last.end = r.end;
      } else {
        ranges.push({ start: r.start, end: r.end });
      }
    }
    return ranges;
  };
  const trim = (range: { start: number; end: number }): { start: number; end: number } => {
    let { start, end } = range;
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
  };
  const whole = (range: { start: number; end: number }): boolean =>
    text.slice(0, range.start).trim() === "" && text.slice(range.end).trim() === "";

  const push = (style: StyleSpan["style"], range: { start: number; end: number }) => {
    const { start, end } = trim(range);
    if (end <= start) return;
    styles.push({ start, end, style, quotedText: text.slice(start, end) });
  };
  for (const range of collect("bold")) {
    if (opts.skipBold && whole(range)) continue;
    push("bold", range);
  }
  for (const range of collect("italic")) push("italic", range);
  for (const range of collect("mono")) {
    if (opts.skipMono && whole(range)) continue;
    push("code", range);
  }
  // Hyperlink regions from the PDF's link annotations.
  for (const r of runs) {
    if (!r.href) continue;
    const last = links[links.length - 1];
    if (last && last.href === r.href && r.start - last.end <= 1) {
      last.end = r.end;
      last.quotedText = text.slice(last.start, last.end);
    } else {
      const { start, end } = trim(r);
      if (end > start) links.push({ start, end, quotedText: text.slice(start, end), href: r.href });
    }
  }
  return { styles, links };
}

// ── Tables ──────────────────────────────────────────────────────────────────

type TableRow = { cells: { text: string; runs: Run[] }[] };

function clusterColumns(lines: Line[]): number[] {
  const xs = lines.flatMap((l) => l.cells.map((c) => c.x)).sort((a, b) => a - b);
  const columns: number[] = [];
  for (const x of xs) {
    const last = columns[columns.length - 1];
    if (last === undefined || x - last > 9) columns.push(x);
  }
  return columns;
}

// Column separators as x positions no text crosses. A coverage scan instead of
// x-start clustering: right-aligned number columns start at a different x on
// every row, but nothing ever crosses the gutter between columns.
function columnSeparators(run: Line[]): number[] {
  const minX = Math.min(...run.map((l) => l.x));
  const maxX = Math.max(...run.map((l) => l.xEnd));
  const step = 2;
  const n = Math.max(1, Math.ceil((maxX - minX) / step));
  const crossings = new Array<number>(n).fill(0);
  const leftOf = new Array<number>(n).fill(0);
  const rightOf = new Array<number>(n).fill(0);
  for (const line of run) {
    for (let s = 0; s < n; s++) {
      const x = minX + s * step;
      let crosses = false;
      let left = false;
      let right = false;
      for (const item of line.items) {
        if (item.x < x && item.x + item.w > x) crosses = true;
        if (item.x + item.w <= x + 1) left = true;
        if (item.x >= x - 1) right = true;
      }
      if (crosses) crossings[s]++;
      if (left) leftOf[s]++;
      if (right) rightOf[s]++;
    }
  }
  const allowed = Math.max(0, Math.floor(run.length * 0.08));
  // A column needs text on both sides in a few lines only: a label column
  // whose labels sit on their own baselines fills one line in four.
  const need = Math.max(2, Math.ceil(run.length * 0.15));
  const separators: number[] = [];
  let bandStart: number | null = null;
  for (let s = 0; s <= n; s++) {
    const open =
      s < n && crossings[s] <= allowed && leftOf[s] >= need && rightOf[s] >= need;
    if (open && bandStart === null) bandStart = s;
    if (!open && bandStart !== null) {
      const width = (s - bandStart) * step;
      if (width >= 5) separators.push(minX + ((bandStart + s) / 2) * step);
      bandStart = null;
    }
  }
  return separators;
}

// Split one line's items at the separators. Items are pdf.js chunks, so a cell
// boundary nearly always falls between items; assignment is by item center.
function cellsBySeparators(line: Line, separators: number[]): Cell[] {
  const size = line.size;
  const buckets: Item[][] = Array.from({ length: separators.length + 1 }, () => []);
  for (const item of line.items) {
    const center = item.x + item.w / 2;
    let idx = 0;
    while (idx < separators.length && center > separators[idx]) idx++;
    buckets[idx].push(item);
  }
  return buckets.map((bucket) => {
    if (bucket.length === 0) return { x: 0, text: "", runs: [] };
    const cell: Cell = { x: bucket[0].x, text: "", runs: [] };
    let prevEnd: number | null = null;
    for (const item of bucket) {
      const gap = prevEnd === null ? 0 : item.x - prevEnd;
      if (prevEnd !== null && gap > size * 0.12 && !cell.text.endsWith(" ")) {
        const attach = ATTACH_PUNCT_RE.test(item.str) && gap < size * 0.7;
        if (!attach) cell.text += " ";
      }
      const start = cell.text.length;
      cell.text += item.str;
      const last = cell.runs[cell.runs.length - 1];
      if (last && sameFlags(last, item) && start - last.end <= 1) {
        last.end = cell.text.length;
      } else {
        cell.runs.push({
          start,
          end: cell.text.length,
          bold: item.bold,
          italic: item.italic,
          mono: item.mono,
          href: item.href,
        });
      }
      prevEnd = item.x + item.w;
    }
    return cell;
  });
}

function boldShare(runs: Run[], length: number): number {
  if (length === 0) return 0;
  let bold = 0;
  for (const r of runs) if (r.bold) bold += r.end - r.start;
  return bold / length;
}

function cellHtml(text: string, runs: Run[]): string {
  if (text.length === 0) return "";
  const bounds = new Set<number>([0, text.length]);
  for (const r of runs) {
    bounds.add(Math.max(0, Math.min(r.start, text.length)));
    bounds.add(Math.max(0, Math.min(r.end, text.length)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const segment = escapeHtml(text.slice(from, to));
    const covering = runs.filter((r) => r.start <= from && r.end >= to);
    const bold = covering.some((r) => r.bold);
    const italic = covering.some((r) => r.italic);
    const mono = covering.some((r) => r.mono);
    let wrapped = segment;
    if (mono) wrapped = `<code>${wrapped}</code>`;
    if (italic) wrapped = `<em>${wrapped}</em>`;
    if (bold) wrapped = `<strong>${wrapped}</strong>`;
    html += wrapped;
  }
  return html;
}

// One table out of a run of gap-aligned lines. Columns come from the coverage
// scan; rows come from the run's vertical rhythm: with two gap sizes present,
// the small gap is a wrapped cell line and the large one a row break; with one
// gap size, every line is its own row.
function tableFromRun(run: Line[], leading: number): Segment {
  const separators = columnSeparators(run);
  const columnCount = separators.length + 1;
  const page = run[0].page;
  // No gutter runs the whole way down when the wide gaps sit at a different
  // x on every line (an author line's names over an affiliation line). One
  // column is no table: the lines are a paragraph (import compare loop
  // finding: a paper's authors read as a two-row table).
  if (columnCount < 2) {
    const { text, runs } = joinGroup(run);
    return { type: "PARAGRAPH", text, page, runs, ...geom(run) };
  }

  const size = median(run.map((l) => l.size));
  const floor = size * 0.75; // below this, same visual band (badge baselines)
  const wrapCeiling = leading * size * 1.15; // a wrapped cell line sits at text leading
  const gaps = run
    .slice(1)
    .map((l, k) => run[k].y - l.y)
    .filter((g) => g > floor);
  const small = gaps.filter((g) => g <= wrapCeiling);
  const large = gaps.filter((g) => g > wrapCeiling);
  const rowGapThreshold =
    small.length > 0 && large.length > 0
      ? (Math.max(...small) + Math.min(...large)) / 2
      : large.length > 0
        ? wrapCeiling
        : 0; // all gaps at text leading: every line is its own row

  // Row anchors: lines that carry a first-column cell, minus wraps of the
  // previous first-column cell (a first-column-only line one leading below
  // it). When some anchor sits right under a line with no first-column cell
  // — labels vertically centered beside taller cells, a header cell wrapped
  // beside its column headers — the vertical rhythm misleads: rows then come
  // from the anchors, split at the widest gap between consecutive anchors.
  const cellsOf = run.map((line) => cellsBySeparators(line, separators));
  const hasFirst = cellsOf.map((cells) => cells[0].text.length > 0);
  const anchors: number[] = [];
  let lastFirst = -1;
  run.forEach((line, k) => {
    if (!hasFirst[k]) return;
    // A wrap: only the first column continues, or the first cell starts
    // lowercase ("Concealing" / "uncertainty know" — both columns wrapped).
    const firstOnly = cellsOf[k].every((cell, idx) => idx === 0 || cell.text.length === 0);
    const continues = firstOnly || /^[a-z]/.test(cellsOf[k][0].text);
    const wrap =
      continues &&
      lastFirst >= 0 &&
      run[lastFirst].y - line.y <= Math.max(run[lastFirst].size, line.size) * leading * 1.35;
    lastFirst = k;
    if (!wrap) anchors.push(k);
  });
  const anchorRows =
    anchors.length >= 2 && anchors.some((k) => k > 0 && !hasFirst[k - 1]);
  const gapAt = (m: number) => run[m - 1].y - run[m].y;
  const rowStarts: number[] = [0];
  if (anchorRows) {
    // Lines above the first anchor: their own row when one gap stands out.
    if (anchors[0] > 1) {
      let widest = 1;
      let smallest = Infinity;
      for (let m = 1; m <= anchors[0]; m++) {
        if (gapAt(m) >= gapAt(widest)) widest = m;
        smallest = Math.min(smallest, gapAt(m));
      }
      if (gapAt(widest) > smallest * 1.3 && widest <= anchors[0]) rowStarts.push(widest);
    }
    for (let a = 0; a + 1 < anchors.length; a++) {
      let widest = anchors[a] + 1;
      for (let m = anchors[a] + 1; m <= anchors[a + 1]; m++) {
        if (gapAt(m) >= gapAt(widest)) widest = m;
      }
      rowStarts.push(widest);
    }
  } else {
    run.forEach((line, k) => {
      if (k === 0) return;
      const gap = gapAt(k);
      if (rowGapThreshold > 0 ? gap > rowGapThreshold : gap > floor) rowStarts.push(k);
    });
  }

  const rows: TableRow[] = [];
  run.forEach((line, k) => {
    if (rowStarts.includes(k) || rows.length === 0) {
      rows.push({ cells: Array.from({ length: columnCount }, () => ({ text: "", runs: [] })) });
    }
    const row = rows[rows.length - 1];
    cellsOf[k].forEach((cell, idx) => {
      if (cell.text.length === 0) return;
      const target = row.cells[idx];
      const builder = new TextBuilder();
      builder.append({ text: target.text, runs: target.runs }, "");
      builder.append({ text: cell.text, runs: cell.runs }, target.text.length > 0 ? " " : "");
      target.text = builder.text;
      target.runs = builder.runs;
    });
  });

  // Fragmented figure text, not a real table: mostly tiny cells.
  const flat = rows.flatMap((r) => r.cells.map((c) => c.text.trim()).filter((t) => t.length > 0));
  const shortCells = flat.filter((c) => c.length <= 2).length;
  if (flat.length > 0 && shortCells / flat.length > 0.6) {
    const builder = new TextBuilder();
    for (const line of run) builder.append({ text: line.text.replace(/\t/g, " "), runs: line.runs }, " ");
    return { type: "FIGURE", text: builder.text, page, runs: builder.runs, ...geom(run) };
  }

  const headerRow =
    rows.length > 1 &&
    boldShare(
      rows[0].cells.flatMap((c) => c.runs),
      rows[0].cells.reduce((n, c) => n + c.text.length, 0),
    ) > 0.5;
  // Header cells render bold on their own; strip bold runs so <th> holds no <strong>.
  // Every cell ends with an invisible separator (tab between cells, newline
  // between rows) so the table's DOM text equals block text exactly — text
  // anchors inside tables depend on this (SPEC.md §5).
  const rowHtml = (row: TableRow, tag: "td" | "th", rowIdx: number) =>
    `<tr>${row.cells
      .map((c, cellIdx) => {
        const runs = tag === "th" ? c.runs.map((r) => ({ ...r, bold: false })) : c.runs;
        const last = cellIdx === row.cells.length - 1;
        const gap = last
          ? rowIdx === rows.length - 1
            ? ""
            : '<span class="cell-gap">\n</span>'
          : '<span class="cell-gap">\t</span>';
        return `<${tag}>${cellHtml(c.text, runs)}${gap}</${tag}>`;
      })
      .join("")}</tr>`;
  const bodyRows = headerRow ? rows.slice(1) : rows;
  const html =
    "<table>" +
    (headerRow ? `<thead>${rowHtml(rows[0], "th", 0)}</thead>` : "") +
    `<tbody>${bodyRows.map((r, i) => rowHtml(r, "td", (headerRow ? 1 : 0) + i)).join("")}</tbody>` +
    "</table>";
  const text = rows.map((r) => r.cells.map((c) => c.text).join("\t")).join("\n");
  return { type: "TABLE", text, html, page, ...geom(run) };
}

// A two-column run of numbered entries is a contents list read column-wise,
// not a table: left column top to bottom, then right column.
function twoColumnList(run: Line[]): Segment | null {
  if (run.length < 2 || !run.every((l) => l.cells.length === 2)) return null;
  const cells = run.flatMap((l) => l.cells);
  const numbered = cells.filter((c) => TOC_ENTRY_RE.test(c.text)).length;
  if (numbered < cells.length * 0.7) return null;
  const ordered = [...run.map((l) => l.cells[0]), ...run.map((l) => l.cells[1])];
  const builder = new TextBuilder();
  const entries: { start: number; end: number; num: number }[] = [];
  for (const cell of ordered) {
    const start = builder.text.length === 0 ? 0 : builder.text.length + 1;
    builder.append({ text: cell.text, runs: cell.runs }, "\n");
    const m = TOC_ENTRY_RE.exec(cell.text);
    if (m) entries.push({ start, end: start + cell.text.length, num: Number(m[1]) });
  }
  return { type: "LIST", text: builder.text, page: run[0].page, runs: builder.runs, tocEntries: entries, ...geom(run) };
}

// ── Page segmentation ───────────────────────────────────────────────────────

type PageContext = {
  bodySize: number;
  leading: number; // line leading as a multiple of font size
  columnLeft: number;
  // Some PDFs expose no bold flags at all (font subsetting); heading rules
  // that require bold would then match nothing.
  hasBold: boolean;
  // The page's leftmost text x, and the content column beside a label column
  // (times in a timeline, dates in a résumé) when the page has one.
  pageMinX: number;
  labelColumn: number | null;
  // Framed boxes drawn on the page (a verbatim prompt, a literature entry):
  // the text inside sits at the frame's inset, which is not a list indent.
  frames: Box[];
};

// Monospace line: a listing's line (import compare loop finding: a python
// listing shattered into lists, paragraphs and joined lines).
function isMonoLine(line: Line): boolean {
  const chars = line.text.replace(/\s/g, "").length;
  if (chars === 0) return false;
  let mono = 0;
  for (const r of line.runs) {
    if (r.mono) mono += line.text.slice(r.start, r.end).replace(/\s/g, "").length;
  }
  return mono / chars >= 0.85;
}

// The line inside a framed box: the frame's left edge sits within three ems
// left of the text and the frame spans the line.
function isBoxedLine(line: Line, ctx: PageContext): boolean {
  return ctx.frames.some(
    (f) =>
      f.x1 < line.x &&
      f.x1 > line.x - line.size * 3 &&
      f.x2 > line.xEnd - 1 &&
      f.y2 >= line.y &&
      f.y1 <= line.y,
  );
}

// One listing line: indentation and internal runs of spaces rebuilt from the
// glyph advance, so the code reads as typed.
function codeLineText(line: Line, left: number, advance: number): string {
  const cols = (px: number) => Math.max(0, Math.round(px / advance));
  let text = " ".repeat(cols(line.x - left));
  let prevEnd: number | null = null;
  for (const item of line.items) {
    if (prevEnd !== null) {
      const gap = item.x - prevEnd;
      if (gap > advance * 0.4) text += " ".repeat(Math.max(1, cols(gap)));
    }
    text += item.str;
    prevEnd = item.x + item.w;
  }
  return text.replace(/\s+$/, "");
}

// A label line: a short label at the page's left edge, then the entry's title
// at the content column — "18:00  Check in", "2019  Engineer at X". Not a
// table row: the lines under it are the entry's body (import compare loop
// finding: a timeline read as tables and indented lists).
function isLabelLine(line: Line, ctx: PageContext): boolean {
  if (ctx.labelColumn === null || line.cells.length !== 2) return false;
  const [label, body] = line.cells;
  return (
    line.x <= ctx.pageMinX + 4 &&
    label.text.length <= 12 &&
    Math.abs(body.x - ctx.labelColumn) < 3
  );
}

// The column's right edge near a band of lines [from, to): the widest prose
// line (single cell, longer than 40 chars, in the same column) within four
// lines before or after the band. A band's own longest line always reads as
// wrapped against itself.
function proseEdge(lines: Line[], from: number, to: number): number {
  let edge = 0;
  const x = lines[from].x;
  const size = lines[from].size;
  for (let k = Math.max(0, from - 4); k < Math.min(lines.length, to + 4); k++) {
    if (k >= from && k < to) continue;
    const l = lines[k];
    if (l.cells.length !== 1 || l.text.length <= 40) continue;
    if (Math.abs(l.x - x) > size * 6) continue;
    if (l.xEnd > edge) edge = l.xEnd;
  }
  return edge;
}

function isIndented(line: Line, ctx: PageContext): boolean {
  return (
    line.x > ctx.columnLeft + line.size * 0.6 &&
    line.x < ctx.columnLeft + line.size * 6 &&
    line.cells.length === 1
  );
}

// A first-column cell on its own baseline: a single-cell line left of the
// run's second column — a row label vertically centered beside a taller cell,
// a header cell wrapped beside its column headers (import compare loop
// finding: such tables shattered into paragraphs).
function isLeftOnly(line: Line, columns: number[]): boolean {
  return (
    columns.length >= 2 &&
    line.cells.length === 1 &&
    line.xEnd < columns[1] - 4 &&
    line.x <= columns[0] + 8 &&
    line.text.length < 60
  );
}

function isAlignedLine(line: Line, columns: number[]): boolean {
  return columns.some((c, idx) => idx > 0 && Math.abs(line.x - c) < 12);
}

// Table runs, computed before segmentation. A run grows forward over
// multi-cell lines and the single-cell lines that continue a wrapped cell
// (aligned with a column, or indented past the first column, or a first-column
// line followed closely by more of the table), and grows backward over
// wrapped header lines just above the first multi-cell line.
function findTableRuns(lines: Line[], ctx: PageContext): number[] {
  const runOf = new Array<number>(lines.length).fill(-1);
  let runId = 0;
  let i = 0;
  while (i < lines.length) {
    // A table row is text or numbers: a line of math glyphs is an equation,
    // whatever its gaps (import compare loop finding: an equation's wide gaps
    // read as cells, and the run swept the sentences around it into a table).
    if (
      lines[i].cells.length < 2 ||
      runOf[i] !== -1 ||
      isLabelLine(lines[i], ctx) ||
      isMonoLine(lines[i]) ||
      lineMathShare(lines[i]) >= 0.4
    ) {
      i++;
      continue;
    }
    const members: number[] = [i];
    let multi = 1;
    let leftOnlyCount = 0;
    let alignedCount = 0;
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const last = lines[members[members.length - 1]];
      const gap = last.y - next.y;
      if (gap < 0 || gap > next.size * ctx.leading * 2.2) break;
      if (isLabelLine(next, ctx) || isMonoLine(next) || lineMathShare(next) >= 0.4) break;
      if (next.cells.length >= 2) {
        members.push(j);
        multi++;
        j++;
        continue;
      }
      if (next.size > ctx.bodySize * 1.15) break;
      const columns = clusterColumns(members.map((k) => lines[k]));
      const aligned = isAlignedLine(next, columns);
      const leftOnly = isLeftOnly(next, columns);
      const indentedPastFirst = next.x > columns[0] + 8;
      const tight = gap <= next.size * ctx.leading * 1.35;
      // A row whose cells fused into one (narrow gaps), a wrapped row line at
      // the first column, a first-column line on its own baseline, or an
      // aligned line after a row gap: the table must resume within the next
      // two lines — a multi-cell line, a first-column line, or an aligned
      // line — at row pitch, and the line must not read as prose.
      let resumes = false;
      if (
        (Math.abs(next.x - columns[0]) < 12 || leftOnly || aligned) &&
        gap <= next.size * ctx.leading * 1.9 &&
        next.text.length < 90 &&
        !/[.!?]$/.test(next.text.trim())
      ) {
        let y = next.y;
        for (let k = j + 1; k <= j + 2 && k < lines.length; k++) {
          if (y - lines[k].y > lines[k].size * ctx.leading * 2.2) break;
          if (lineMathShare(lines[k]) >= 0.4) break;
          if (
            (lines[k].cells.length >= 2 && !isLabelLine(lines[k], ctx)) ||
            isLeftOnly(lines[k], columns) ||
            (lines[k].cells.length === 1 && isAlignedLine(lines[k], columns))
          ) {
            resumes = true;
            break;
          }
          y = lines[k].y;
        }
      }
      // A trailing wrap line just under the last row: closer than the row
      // pitch and short, so a following paragraph never qualifies.
      const trailing =
        Math.abs(next.x - columns[0]) < 12 &&
        gap <= next.size * ctx.leading * 1.05 &&
        next.text.length < 60;
      if (resumes || (tight && (aligned || indentedPastFirst || trailing))) {
        members.push(j);
        if (leftOnly) leftOnlyCount++;
        else if (aligned) alignedCount++;
        j++;
        continue;
      }
      break;
    }
    // Display equations read as multi-cell lines: a fraction stacks its
    // numerator and denominator on lines of their own and leaves a gap in the
    // main line, and terms sit apart. The sentence between two equations then
    // resumes the "table". A run whose multi-cell lines are mostly math
    // glyphs is equations, never a table (import compare loop finding: a
    // solution set's equations and the sentences between them became tables).
    const multiCell = members.filter((k) => lines[k].cells.length >= 2);
    const mathMulti = multiCell.filter((k) => lineMathShare(lines[k]) >= 0.3).length;
    if (mathMulti * 2 >= multiCell.length) {
      i++;
      continue;
    }
    // One multi-cell line alone is a "Label: text" paragraph, unless the
    // lines around it are a table whose labels sit on their own baselines.
    if (multi < 2 && !(leftOnlyCount >= 2 && alignedCount >= 2)) {
      i++;
      continue;
    }
    // Backward: wrapped header lines directly above (at most 3).
    let first = members[0];
    let absorbed = 0;
    while (first > 0 && absorbed < 3) {
      const prev = lines[first - 1];
      if (prev.cells.length !== 1 || runOf[first - 1] !== -1) break;
      if (prev.size > ctx.bodySize * 1.15) break;
      const gap = prev.y - lines[first].y;
      if (gap < 0 || gap > prev.size * ctx.leading * 1.35) break;
      const columns = clusterColumns(members.map((k) => lines[k]));
      const aligned = isAlignedLine(prev, columns);
      const indentedPastFirst = prev.x > columns[0] + 8;
      if (!aligned && !indentedPastFirst && !isLeftOnly(prev, columns)) break;
      // A first-column line that continues the paragraph above it (same x,
      // one leading below) is that paragraph's last line — a caption's wrap.
      if (!aligned && !indentedPastFirst && first >= 2) {
        const above = lines[first - 2];
        if (
          above.cells.length === 1 &&
          Math.abs(above.x - prev.x) < 12 &&
          above.y - prev.y <= prev.size * ctx.leading * 1.35
        )
          break;
      }
      first--;
      members.unshift(first);
      absorbed++;
    }
    for (const k of members) runOf[k] = runId;
    runId++;
    i = j;
  }
  return runOf;
}

// A contents list that runs past the page break continues on the next page.
let tocCarry = false;

function segmentPage(lines: Line[], ctx: PageContext): Segment[] {
  const segments: Segment[] = [];
  const body = ctx.bodySize;
  const runOf = findTableRuns(lines, ctx);
  let tocMode = tocCarry && lines.length > 0 && TOC_ENTRY_RE.test(lines[0].text) && TOC_TAIL_RE.test(lines[0].text);
  tocCarry = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const single = line.cells.length === 1;

    // Contents label ("CONTENTS", "INSIDE"): the entries that follow become a
    // linked list, not headings.
    if (single && TOC_LABEL_RE.test(line.text.trim())) {
      segments.push({ type: "PARAGRAPH", text: line.text.trim(), page: line.page, runs: line.runs, ...geom([line]) });
      tocMode = true;
      i++;
      continue;
    }

    if (tocMode && (line.cells.length <= 2 || TOC_TAIL_RE.test(line.text)) && TOC_ENTRY_RE.test(line.text)) {
      const builder = new TextBuilder();
      const entries: { start: number; end: number; num: number }[] = [];
      let j = i;
      while (
        j < lines.length &&
        (lines[j].cells.length <= 2 || TOC_TAIL_RE.test(lines[j].text)) &&
        TOC_ENTRY_RE.test(lines[j].text)
      ) {
        const entry = lines[j];
        const start = builder.text.length === 0 ? 0 : builder.text.length + 1;
        const part = tocEntryPart(entry);
        builder.append(part, "\n");
        const m = TOC_ENTRY_RE.exec(entry.text);
        if (m && /^\d+$/.test(m[1])) entries.push({ start, end: start + part.text.length, num: Number(m[1]) });
        j++;
      }
      segments.push({
        type: "LIST",
        text: builder.text,
        page: line.page,
        runs: builder.runs,
        tocEntries: entries,
        ...geom(lines.slice(i, j)),
      });
      tocMode = false;
      tocCarry = j >= lines.length;
      i = j;
      continue;
    }

    // Table run (precomputed).
    if (runOf[i] !== -1) {
      const id = runOf[i];
      const run: Line[] = [];
      let j = i;
      while (j < lines.length && runOf[j] === id) {
        run.push(lines[j]);
        j++;
      }
      const list = twoColumnList(run);
      segments.push(list ?? tableFromRun(run, ctx.leading));
      if (!list) tocMode = false;
      i = j;
      continue;
    }
    tocMode = false;

    // Code listing: consecutive monospace lines, blank lines included, are
    // one CODE block with one line per PDF line and the indentation the
    // glyph offsets give.
    if (isMonoLine(line)) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const gap = run[run.length - 1].y - next.y;
        if (!isMonoLine(next) || runOf[j] !== -1 || gap < 0 || gap > next.size * ctx.leading * 3.4) break;
        run.push(next);
        j++;
      }
      const advances = run.flatMap((l) => l.items.filter((it) => it.mono && it.str.length > 0).map((it) => it.w / it.str.length));
      const advance = median(advances) || line.size * 0.6;
      const left = Math.min(...run.map((l) => l.x));
      const rows: string[] = [];
      run.forEach((l, k) => {
        if (k > 0) {
          const blank = Math.round((run[k - 1].y - l.y) / (l.size * ctx.leading)) - 1;
          for (let b = 0; b < Math.min(2, blank); b++) rows.push("");
        }
        rows.push(codeLineText(l, left, advance));
      });
      segments.push({ type: "CODE", text: rows.join("\n"), page: line.page, runs: [], ...geom(run) });
      i = j;
      continue;
    }

    // Label line: the label and the entry's title read as one paragraph; the
    // entry's body follows as its own blocks.
    if (isLabelLine(line, ctx)) {
      segments.push({ type: "PARAGRAPH", text: lineAsPart(line).text, page: line.page, runs: line.runs, ...geom([line]) });
      i++;
      continue;
    }

    // Heading run: larger than body. Wrapped heading lines merge; a merged run
    // that reads as prose (ends in a period, runs long) is a lead paragraph.
    // A line set large by a math glyph (an integral sign with its limit) is
    // part of an equation, not a heading.
    if (single && line.size > body * 1.14 && lineMathShare(line) < 0.5) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const centered =
          Math.abs((next.x + next.xEnd) / 2 - (line.x + line.xEnd) / 2) <= 12 && next.x > ctx.columnLeft + 12;
        if (
          runOf[j] !== -1 ||
          next.cells.length !== 1 ||
          Math.abs(next.size - line.size) > 0.5 ||
          run[run.length - 1].y - next.y > line.size * 1.7 ||
          (Math.abs(next.x - line.x) > 12 && !centered)
        )
          break;
        run.push(next);
        j++;
      }
      const { text, runs } = joinGroup(run);
      const flat = text.replace(/\n/g, " ");
      const prose = /[.!?]$/.test(flat.trim()) && flat.length > 80;
      if (prose || flat.trim().length <= 1) {
        segments.push({ type: "PARAGRAPH", text: flat, page: line.page, runs, ...geom(run) });
      } else {
        const m = /^(\d{1,2})[.)]\s/.exec(flat);
        segments.push({
          type: "HEADING",
          text: flat,
          page: line.page,
          rawSize: line.size,
          runs,
          headingNum: m ? Number(m[1]) : undefined,
          ...geom(run),
        });
      }
      i = j;
      continue;
    }

    // Numbered heading at body size: "3.1 Results" — short, isolated, and
    // bold, or set larger than body, or in a document with no bold flags at all.
    const lineBold = boldShare(line.runs, line.text.length) > 0.6;
    if (
      single &&
      (HEADING_NUM_STRICT_RE.test(line.text) || (lineBold && LETTER_HEADING_RE.test(line.text))) &&
      !BULLET_RE.test(line.text) &&
      !TOC_TAIL_RE.test(line.text) &&
      line.text.length < 120 &&
      !/[.,;:]$/.test(line.text) &&
      line.size >= body * 0.98 &&
      (lineBold ||
        line.size >= body * 1.05 ||
        !ctx.hasBold ||
        /^(\d{1,2}|[A-Z])(\.\d{1,2})+/.test(line.text))
    ) {
      // A heading wrapped to a second bold line at the same size and leading.
      const run: Line[] = [line];
      let j = i + 1;
      while (
        j < lines.length &&
        run.length < 3 &&
        lineBold &&
        runOf[j] === -1 &&
        lines[j].cells.length === 1 &&
        Math.abs(lines[j].size - line.size) <= 0.5 &&
        run[run.length - 1].y - lines[j].y <= line.size * ctx.leading * 1.3 &&
        boldShare(lines[j].runs, lines[j].text.length) > 0.6 &&
        !HEADING_NUM_STRICT_RE.test(lines[j].text)
      ) {
        run.push(lines[j]);
        j++;
      }
      const last = run[run.length - 1];
      const below = lines[j];
      const isolated = !below || last.y - below.y > last.size * ctx.leading * 1.15;
      if (isolated) {
        const { text, runs } = joinGroup(run);
        const flat = text.replace(/\n/g, " ");
        const m = /^(\d{1,2})[.)]\s/.exec(flat);
        segments.push({
          type: "HEADING",
          text: flat,
          page: line.page,
          rawSize: line.size,
          runs,
          headingNum: m ? Number(m[1]) : undefined,
          ...geom(run),
        });
        i = j;
        continue;
      }
    }
    // An unnumbered heading at body size: one short line, wholly bold or
    // opening with a bold lead ("Problem 1: Risk-neutral pricing"), set apart
    // by a gap above and below. A caps title may end with a period.
    const letters = line.text.replace(/[^\p{L}]/gu, "");
    const capsShare = letters.length > 0 ? letters.replace(/[^\p{Lu}]/gu, "").length / letters.length : 0;
    // The lead is a label: it ends with a colon or a period ("Problem 3:").
    const boldLead =
      startsWithBoldLead(line) &&
      /[:.]\s*$/.test(line.text.slice(line.runs[0].start, line.runs[0].end));
    if (
      single &&
      (lineBold || boldLead) &&
      (boldShare(line.runs, line.text.length) > 0.9 || boldLead) &&
      line.text.length < 90 &&
      line.text.length > 2 &&
      !BULLET_RE.test(line.text) &&
      // A contents entry ends in leader dots and a page number; a title may
      // end in a number of its own ("Risk-neutral pricing 1").
      !/(?:\s*\.){3,}\s*\d{1,4}\s*$/.test(line.text) &&
      (!/[.,;:]$/.test(line.text.trim()) || (boldLead && capsShare >= 0.6 && /\.$/.test(line.text.trim()))) &&
      line.size >= body * 0.98 &&
      line.size <= body * 1.14
    ) {
      const above = lines[i - 1];
      const below = lines[i + 1];
      const gapAbove = !above || above.y - line.y > line.size * ctx.leading * 1.3;
      const gapBelow = !below || line.y - below.y > line.size * ctx.leading * 1.15;
      if (gapAbove && gapBelow && below) {
        segments.push({
          type: "HEADING",
          text: line.text,
          page: line.page,
          rawSize: line.size,
          runs: line.runs,
          ...geom([line]),
        });
        i++;
        continue;
      }
    }

    // List run: bullet-marked lines, or an indented band whose gaps split it
    // into items (bullet glyphs are often vector art, not text).
    const bulletStart = BULLET_RE.test(line.text) && single && line.size <= body * 1.15;
    // A first-line indent (LaTeX's parindent): an unmarked indented line whose
    // next line is back at the column's left edge at text leading is the
    // first line of that paragraph, not an item (import compare loop finding:
    // every indented paragraph split after its first line).
    const after = lines[i + 1];
    const firstLineIndent =
      single &&
      !bulletStart &&
      isIndented(line, ctx) &&
      line.x - ctx.columnLeft <= line.size * 3.2 &&
      after !== undefined &&
      runOf[i + 1] === -1 &&
      after.cells.length === 1 &&
      Math.abs(after.x - ctx.columnLeft) <= 3 &&
      line.y - after.y > 0 &&
      line.y - after.y <= after.size * ctx.leading * 1.3 &&
      Math.abs(after.size - line.size) <= 0.6 &&
      !BULLET_RE.test(after.text);
    // Text inside a framed box sits at the frame's inset: an indent that is
    // the box's, not a list's (import compare loop finding: a verbatim
    // briefing box read as one long list).
    const indentStart =
      !firstLineIndent &&
      isIndented(line, ctx) &&
      line.size <= body * 1.15 &&
      line.size >= body * 0.8 &&
      !isBoxedLine(line, ctx);
    if (bulletStart || indentStart) {
      const run: Line[] = [line];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        // Marked items sit farther apart than wrapped lines (itemsep); an
        // unmarked line past 1.6 leading is the next paragraph.
        const maxGap = BULLET_RE.test(next.text) ? 2.2 : 1.6;
        if (
          runOf[j] !== -1 ||
          next.cells.length !== 1 ||
          next.size > body * 1.15 ||
          Math.abs(next.size - line.size) > 1.2 ||
          run[run.length - 1].y - next.y > next.size * ctx.leading * maxGap ||
          run[run.length - 1].y - next.y < 0
        )
          break;
        // A display equation under an item (centered, set in math fonts) is
        // its own block, never the item's next line.
        if (lineMathShare(next) >= 0.5 && next.x > line.x + next.size * 4) break;
        // A marked line stepping back left of the run's first line is the
        // next item of an outer list, not a line of this run.
        if (BULLET_RE.test(next.text) && next.x < line.x - next.size * 0.5) break;
        const continues = BULLET_RE.test(next.text) || next.x >= line.x - 2;
        if (!continues) break;
        run.push(next);
        j++;
      }
      // Item boundaries: bullet markers, or gaps looser than the run's leading.
      // Items with neither (vector bullets at text leading): in a band of
      // mostly short lines, a line that stops short of the column's right edge
      // ends its item (import compare loop finding: a CJK dish list fused into
      // one paragraph).
      const starts: number[] = [0];
      const gaps = run.slice(1).map((l, k) => run[k].y - l.y);
      const gapThreshold = ctx.leading * line.size * 1.12;
      // A block indented on both sides (an abstract, a quotation) has its own
      // right edge: most lines end together there and none is short.
      const runMax = Math.max(...run.map((l) => l.xEnd));
      const alignedRight = run.filter((l) => l.xEnd > runMax - l.size).length;
      const wideBlock = runMax - line.x > line.size * 20;
      const edge =
        wideBlock && alignedRight * 10 >= run.length * 6 ? runMax : Math.max(runMax, proseEdge(lines, i, j));
      const shortLines = run.filter((l) => l.xEnd < edge - l.size * 3).length;
      const ragged = shortLines * 2 >= run.length;
      for (let k = 1; k < run.length; k++) {
        const marked = BULLET_RE.test(run[k].text);
        const spaced = gaps[k - 1] > gapThreshold;
        const outdented = run[k].x < run[k - 1].x - line.size * 0.5;
        const ended = ragged && !fillsMargin(run[k - 1], run[k], edge);
        if (marked || spaced || outdented || ended) starts.push(k);
      }
      // Each item keeps the geometry of its own lines: with the run's box on
      // every item, an integral sign split off an equation read as starting
      // at the column edge and never rejoined it (import compare loop finding).
      const items: { text: string; runs: Run[]; lines: Line[] }[] = [];
      for (let s = 0; s < starts.length; s++) {
        const slice = run.slice(starts[s], starts[s + 1] ?? run.length);
        const joined = joinGroup(slice);
        items.push({ text: joined.text.replace(/\n/g, " "), runs: joined.runs, lines: slice });
      }
      // At the top of a page, an unmarked first group before marked items is
      // the tail of the previous page's last item, not an item: emit it as a
      // paragraph so the cross-page merge can finish that item.
      if (i === 0 && items.length >= 2 && !BULLET_RE.test(items[0].text) && BULLET_RE.test(items[1].text)) {
        const tail = items.shift()!;
        segments.push({ type: "PARAGRAPH", text: tail.text, page: line.page, runs: tail.runs, ...geom(tail.lines) });
      }
      // Numbered lead-ins over flush-left paragraphs are prose, not a list:
      // when unmarked groups sit between marked ones at the column edge, every
      // group is its own paragraph.
      if (bulletStart && !indentStart && !items.every((item) => BULLET_RE.test(item.text))) {
        for (const item of items) {
          segments.push({ type: "PARAGRAPH", text: item.text, page: line.page, runs: item.runs, ...geom(item.lines) });
        }
        i = j;
        continue;
      }
      const glyphItem = items.length === 1 && GLYPH_BULLET_RE.test(items[0].text);
      if (items.length >= 2 || glyphItem) {
        const builder = new TextBuilder();
        for (const item of items) {
          // A bullet glyph in the text becomes the list's own marker; a
          // number stays (its value is content).
          const glyph = GLYPH_BULLET_RE.exec(item.text);
          const cut = glyph ? glyph[0].length : 0;
          const marker = BULLET_RE.test(item.text) && !glyph ? "" : "- ";
          builder.append(
            {
              text: marker + item.text.slice(cut),
              runs: item.runs
                .map((r) => ({
                  ...r,
                  start: Math.max(0, r.start - cut) + marker.length,
                  end: r.end - cut + marker.length,
                }))
                .filter((r) => r.end > r.start),
            },
            "\n",
          );
        }
        segments.push({ type: "LIST", text: builder.text, page: line.page, runs: builder.runs, ...geom(run) });
        i = j;
        continue;
      }
      // One item alone (usually cut by the page break): a paragraph that a
      // LIST on the neighboring page may claim.
      segments.push({
        type: "PARAGRAPH",
        text: items[0].text,
        page: line.page,
        runs: items[0].runs,
        listItem: run.length <= 6,
        ...geom(run),
      });
      i = j;
      continue;
    }

    // Paragraph group: vertically continuous same-size lines in one column.
    // A hanging indent (a reference entry, a glossary term) indents every
    // line after the first: the second line may step in by up to three ems
    // when the first line breaks mid-sentence.
    const group: Line[] = [line];
    const colEdge = proseEdge(lines, i, i);
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      const prev = group[group.length - 1];
      const gap = prev.y - next.y;
      const prevTerminal = /[.!?:]["'”]?$/.test(prev.text.trim());
      // A hanging indent (a reference entry, a glossary term): the second
      // line steps in by one to three ems under a first line that wrapped —
      // it ran to the margin, or broke mid-sentence.
      const hanging =
        group.length === 1 &&
        !isIndented(prev, ctx) &&
        next.x > prev.x + next.size * 0.8 &&
        next.x <= prev.x + next.size * 3.5 &&
        !BULLET_RE.test(next.text) &&
        gap <= next.size * ctx.leading * 1.3 &&
        (!prevTerminal || /^[a-z0-9(]/.test(next.text) || prev.xEnd > colEdge - prev.size * 1.5);
      // A wrapped line whose stretched word gaps read as cells is still one
      // line of prose when no table run claims it.
      const stretched =
        next.cells.length > 1 &&
        next.cells.length <= 3 &&
        Math.abs(next.x - prev.x) <= next.size * 0.5 &&
        next.cells.every((c) => c.text.length > 0);
      if (
        runOf[j] !== -1 ||
        (next.cells.length !== 1 && !stretched) ||
        gap < 0 ||
        gap > next.size * 1.9 ||
        // The paragraph gap: looser than the text leading by a third.
        gap > next.size * ctx.leading * 1.3 ||
        Math.abs(next.size - prev.size) > 0.6 ||
        (next.x > prev.x + next.size * 1.1 && !hanging) ||
        (next.x < prev.x - next.size * 1.1 && !(group.length === 1 && firstLineIndent)) ||
        next.size > body * 1.14 ||
        (tocMode && TOC_ENTRY_RE.test(next.text)) ||
        TOC_LABEL_RE.test(next.text.trim()) ||
        (isIndented(next, ctx) && !isIndented(prev, ctx) && !hanging) ||
        // An equation's line and a text line never share a paragraph: the
        // label under an underbrace joined the formula and diluted its math
        // share below the equation threshold (import compare loop finding).
        isDisplayMathLine(prev, ctx) !== isDisplayMathLine(next, ctx) ||
        // A marker opening the next line starts an item — a glyph bullet
        // always, a number or a "(7)" only under a line that ended short of
        // the column edge or with a sentence: "(7) Weight-space…" at a line
        // start inside a justified paragraph is text (import compare loop
        // finding).
        (BULLET_RE.test(next.text) &&
          !BULLET_RE.test(prev.text) &&
          (GLYPH_BULLET_RE.test(next.text) || prev.xEnd < colEdge - prev.size * 1.5)) ||
        // "Setup." after a sentence end opens the next paragraph, and so does a
        // bold label under a line that stopped short of the column edge
        // ("Category. mechanism" over "Summary. …" in a boxed entry).
        (startsWithBoldLead(next) &&
          !endsBold(prev) &&
          (prevTerminal || prev.xEnd < colEdge - prev.size * 2))
      )
        break;
      group.push(next);
      j++;
    }
    const { text, runs } = joinGroup(group, true);
    const monoChars = runs.filter((r) => r.mono).reduce((n, r) => n + (r.end - r.start), 0);
    const type = text.length > 0 && monoChars / text.length > 0.85 ? "CODE" : "PARAGRAPH";
    segments.push({ type, text, page: line.page, runs, ...geom(group) });
    i = j;
  }
  return segments;
}

// ── Repeated page furniture ─────────────────────────────────────────────────

function furnitureKeys(pages: Line[][], pageHeights: number[]): Set<string> {
  const normalize = (text: string) =>
    text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const seenOn = new Map<string, Set<number>>();
  pages.forEach((lines, p) => {
    const h = pageHeights[p];
    for (const line of lines) {
      if (line.y > h * 0.085 && line.y < h * 0.915) continue;
      // A reference's last line ("425–429.") lands in the footer band on
      // more than one page; a footer never ends a sentence with a number.
      if (/\d\.$/.test(line.text.trim())) continue;
      const key = normalize(line.text);
      if (key.length === 0) continue;
      const set = seenOn.get(key) ?? new Set<number>();
      set.add(p);
      seenOn.set(key, set);
    }
  });
  const threshold = Math.max(3, Math.round(pages.length * 0.25));
  const furniture = new Set<string>();
  for (const [key, on] of seenOn) if (on.size >= threshold) furniture.add(key);
  return furniture;
}

// ── Cross-page merges ───────────────────────────────────────────────────────

function shiftSpansInto(target: Segment, source: Segment, offset: number) {
  if (!source.runs) return;
  target.runs = [
    ...(target.runs ?? []),
    ...source.runs.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
  ];
}

function lastListNumber(text: string): number | null {
  const matches = [...text.matchAll(/(?:^|\n)(\d{1,2})[.)]\s/g)];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
}

// A page-top float (figure, table, its caption) between the two halves of a
// paragraph: the halves join and the float follows the paragraph.
function liftFloatsOffParagraphBreaks(segments: Segment[]): Segment[] {
  const out = [...segments];
  const isFloat = (s: Segment) =>
    s.type === "FIGURE" || s.type === "TABLE" || (s.type === "PARAGRAPH" && CAPTION_RE.test(s.text));
  for (let b = 1; b < out.length; b++) {
    const prev = out[b - 1];
    if (out[b].page === prev.page) continue;
    // A list cut by the page break continues under the floats too (import
    // compare loop finding: a rubric list split in two by a figure).
    const listBreak = prev.type === "LIST" && !prev.tocEntries;
    if (!listBreak && (prev.type !== "PARAGRAPH" || /[.!?:…"”)]$/.test(prev.text.trim()))) continue;
    let k = b;
    while (k < out.length && out[k].page === out[b].page && isFloat(out[k])) k++;
    if (k === b || k >= out.length) continue;
    const tail = out[k];
    if (tail.page !== out[b].page) continue;
    if (listBreak ? tail.type !== "LIST" || Boolean(tail.tocEntries) : tail.type !== "PARAGRAPH" || !/^[a-z($€£0-9"'“]/.test(tail.text)) continue;
    out.splice(k, 1);
    out.splice(b, 0, tail);
  }
  return out;
}

function mergeAcrossPages(input: Segment[]): Segment[] {
  const segments = liftFloatsOffParagraphBreaks(input);
  const out: Segment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (!prev || segment.page === prev.page) {
      out.push(segment);
      continue;
    }

    // Paragraph that continues across the page break.
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "PARAGRAPH" &&
      !prev.listItem &&
      /[\p{L}\d,;\-–—]$/u.test(prev.text) &&
      (/^[a-z($€£0-9"'“]/.test(segment.text) ||
        // "… the" | "AAR only stages": a paragraph that ends without a stop
        // is unfinished, whatever the case of the next page's first word.
        (/\s\p{L}+$/u.test(prev.text) && prev.text.length > 60))
    ) {
      const glue = /[A-Za-z0-9][-–]$/.test(prev.text) && /^[A-Za-z0-9(]/.test(segment.text) ? "" : " ";
      const offset = prev.text.length + glue.length;
      prev.text = prev.text + glue + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }

    // List split by the page break: LIST + LIST concatenate.
    if (
      segment.type === "LIST" &&
      prev.type === "LIST" &&
      Boolean(prev.tocEntries) === Boolean(segment.tocEntries)
    ) {
      const offset = prev.text.length + 1;
      prev.text = prev.text + "\n" + segment.text;
      shiftSpansInto(prev, segment, offset);
      if (segment.tocEntries) {
        prev.tocEntries = [
          ...(prev.tocEntries ?? []),
          ...segment.tocEntries.map((e) => ({ ...e, start: e.start + offset, end: e.end + offset })),
        ];
      }
      continue;
    }

    // A numbered list whose last item wraps into a paragraph on the next page:
    // the paragraph's leading words finish the item, and any "N." markers that
    // continue the numbering become items again. Checked before item-append so
    // a mid-sentence tail continues the item instead of becoming a new one.
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "LIST" &&
      !prev.tocEntries &&
      !/[.!?…:]$/.test(prev.text.trim()) &&
      /^[a-z($€£0-9"'“]/.test(segment.text)
    ) {
      const lastNum = lastListNumber(prev.text);
      const offset = prev.text.length + 1;
      prev.text = prev.text + " " + segment.text;
      shiftSpansInto(prev, segment, offset);
      if (lastNum !== null) {
        let expect = lastNum + 1;
        const re = /([ \n])(\d{1,2})([.)] )/g;
        let m: RegExpExecArray | null;
        const breaks: number[] = [];
        while ((m = re.exec(prev.text)) !== null) {
          if (m.index + 1 < offset) continue;
          if (Number(m[2]) === expect) {
            breaks.push(m.index);
            expect++;
          }
        }
        const chars = prev.text.split("");
        for (const at of breaks) chars[at] = "\n";
        prev.text = chars.join("");
      }
      continue;
    }

    // A lone item cut off at the page end joins the LIST that follows.
    if (segment.type === "LIST" && prev.type === "PARAGRAPH" && prev.listItem && !segment.tocEntries) {
      const marker = BULLET_RE.test(prev.text) ? "" : "- ";
      const offset = marker.length;
      segment.text = marker + prev.text + "\n" + segment.text;
      segment.runs = [
        ...(prev.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
        ...(segment.runs ?? []).map((r) => ({
          ...r,
          start: r.start + marker.length + prev.text.length + 1,
          end: r.end + marker.length + prev.text.length + 1,
        })),
      ];
      out.pop();
      out.push(segment);
      continue;
    }
    if (segment.type === "PARAGRAPH" && segment.listItem && prev.type === "LIST" && !prev.tocEntries) {
      const marker = BULLET_RE.test(segment.text) ? "" : "- ";
      const offset = prev.text.length + 1 + marker.length;
      prev.text = prev.text + "\n" + marker + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }

    // Table split by the page break: same column count concatenates; a
    // repeated header row drops.
    if (segment.type === "TABLE" && prev.type === "TABLE" && prev.html && segment.html) {
      const cols = (t: string) => t.split("\n")[0]?.split("\t").length ?? 0;
      if (cols(prev.text) === cols(segment.text)) {
        const prevHeader = prev.text.split("\n")[0];
        let rows = segment.text.split("\n");
        let html = segment.html;
        if (rows[0] === prevHeader) {
          rows = rows.slice(1);
          html = html
            .replace(/<thead>.*?<\/thead>/, "")
            .replace(/^<table>/, "<table>");
        }
        if (rows.length > 0) {
          prev.text = prev.text + "\n" + rows.join("\n");
          const prevBody = /<\/tbody><\/table>$/.test(prev.html);
          const newBody = /<tbody>(.*)<\/tbody><\/table>$/.exec(html);
          if (prevBody && newBody) {
            prev.html = prev.html.replace(/<\/tbody><\/table>$/, `${newBody[1]}</tbody></table>`);
          }
        }
        continue;
      }
    }

    out.push(segment);
  }
  return out;
}

// ── Heading levels ──────────────────────────────────────────────────────────

// Ranked by size: the biggest heading size in the document gets the level its
// ratio to body earns (a modest largest heading starts at h2), each smaller
// cluster steps one level down, floor h3.
function assignHeadingLevels(segments: Segment[], bodySize: number) {
  const sizes: number[] = [];
  for (const s of segments) {
    if (s.type !== "HEADING" || s.rawSize === undefined) continue;
    if (!sizes.some((v) => Math.abs(v - s.rawSize!) < v * 0.05)) sizes.push(s.rawSize);
  }
  sizes.sort((a, b) => b - a);
  const topRatio = sizes.length > 0 ? sizes[0] / bodySize : 1;
  const base = topRatio > 1.5 ? 1 : topRatio > 1.18 ? 2 : 3;
  // Numbered headings take their level from the numbering's depth ("3" one
  // step under the title, "3.2" the next), so a 12pt section and a 12pt-bold
  // subsection do not land in one bucket.
  const numberedBase = sizes.length > 1 && base === 1 ? 2 : base;
  for (const s of segments) {
    if (s.type !== "HEADING") continue;
    const idx = sizes.findIndex((v) => s.rawSize !== undefined && Math.abs(v - s.rawSize) < v * 0.05);
    const depth = headingDepth(s.text);
    const level = Math.min(
      3,
      depth !== null ? numberedBase + depth - 1 : base + Math.max(0, idx),
    ) as 1 | 2 | 3;
    s.html = `<h${level}>${escapeHtml(s.text)}</h${level}>`;
  }
}

// ── Contents links ──────────────────────────────────────────────────────────

function resolveContentsLinks(segments: Segment[]) {
  const numToOrder = new Map<number, number>();
  segments.forEach((s, idx) => {
    if (s.type === "HEADING" && s.headingNum !== undefined && !numToOrder.has(s.headingNum)) {
      numToOrder.set(s.headingNum, idx);
    }
  });
  segments.forEach((s, idx) => {
    if (!s.tocEntries) return;
    const links: LinkSpan[] = [];
    for (const entry of s.tocEntries) {
      const target = numToOrder.get(entry.num);
      if (target === undefined || target === idx) continue;
      links.push({
        start: entry.start,
        end: entry.end,
        quotedText: s.text.slice(entry.start, entry.end),
        targetOrder: target,
      });
    }
    if (links.length > 0) s.links = [...(s.links ?? []), ...links];
  });
}

// ── Figure regions ──────────────────────────────────────────────────────────
// A PDF carries no figure objects the text layer can name: a vector chart is
// its tick labels and legend, a display equation its glyphs, a raster picture
// nothing at all. What the page shows at that spot is the figure, so the block
// becomes a FIGURE whose region the figure image route crops (SPEC.md §16):
// display equations by their math glyphs, captioned figures by the space and
// the debris above (or below) their "Figure N" caption. Import compare loop
// finding: charts read as tables of ticks, equations as tables, figures shown
// as whole pages.

const CAPTION_RE = /^(fig\.|figure|table|tab\.)\s*(\d+|[A-Z]\d+)[a-z]?\s*[.:|–—-]\s*/i;
const TABLE_CAPTION_RE = /^(table|tab\.)\s*(\d+|[A-Z]\d+)/i;

// A numbered display equation: "… = softmax(QKᵀ/√d)V   (1)". Its words are
// roman (function names), so the math share alone misses it.
const EQUATION_NUMBER_RE = /\(\d{1,3}[a-z]?\)\s*$/;

function isMathSegment(s: Segment, ctx: PageContext): boolean {
  if (s.type !== "PARAGRAPH" && s.type !== "TABLE" && s.type !== "FIGURE") return false;
  if (s.region || !s.box) return false;
  const numbered =
    EQUATION_NUMBER_RE.test(s.text) &&
    s.text.length <= 90 &&
    s.box.x1 > ctx.columnLeft + 2 &&
    // A line of nothing but "(1) (2) (3)" is a row of superscripts.
    !/^(\s*\(\d{1,3}[a-z]?\)\s*)+$/.test(s.text);
  if (!numbered && (s.mathShare ?? 0) < 0.25) return false;
  // A lone symbol (a footnote marker, a sum limit) is not an equation.
  if (s.text.replace(/\s/g, "").length < 4) return false;
  // Prose with inline math starts at the column edge and runs long.
  const prose = s.text.length > 50 && s.box.x1 <= ctx.columnLeft + 2 && (s.mathShare ?? 0) < 0.6;
  return !prose;
}

// A line of an equation whose glyphs are mostly roman (function names, an
// equation number, a fraction's denominator): short, off the column edge,
// body-sized. Joins an equation it sits against.
function isEquationShaped(s: Segment, ctx: PageContext): boolean {
  if (s.type !== "PARAGRAPH" && s.type !== "TABLE" && s.type !== "FIGURE") return false;
  if (s.region || !s.box) return false;
  const size = s.lineSize ?? ctx.bodySize;
  // A big operator (an integral or sum sign with its limits) is a math glyph
  // set larger than the text: still a line of the equation.
  const bigOperator = (s.mathShare ?? 0) >= 0.5 && size <= ctx.bodySize * 3;
  // Words at a list indent are an item, not a line of the equation: an
  // equation line is math, a fragment of a few glyphs (a fraction's
  // numerator, an equation number, a function name), or a label set deep in
  // the column (an underbrace's caption).
  const mathOrFragment = (s.mathShare ?? 0) >= 0.2 || s.text.replace(/\s/g, "").length <= 12;
  const deep = !BULLET_RE.test(s.text) && s.box.x1 > ctx.columnLeft + size * 6;
  return (
    s.text.length <= 60 &&
    s.box.x1 > ctx.columnLeft + 2 &&
    (mathOrFragment || deep) &&
    (size <= ctx.bodySize * 1.1 || bigOperator)
  );
}

// A display equation's line: mostly math glyphs, set in from the column edge.
function isDisplayMathLine(line: Line, ctx: PageContext): boolean {
  return lineMathShare(line) >= 0.4 && line.x > ctx.columnLeft + line.size * 2;
}

// Chart text, equation glyphs, ticks: what a figure leaves in the text layer.
function isFigureDebris(s: Segment, ctx: PageContext): boolean {
  if (s.region || s.type === "HEADING" || s.type === "CODE") return false;
  if (CAPTION_RE.test(s.text)) return false;
  if (s.type === "FIGURE") return !s.region;
  if (s.type === "TABLE") return true;
  if ((s.lineSize ?? ctx.bodySize) < ctx.bodySize * 0.92) return true;
  const text = s.text.trim();
  if (text.length <= 12) return true;
  // A panel title or axis label at body size: short, no sentence end.
  return (
    text.length <= 60 &&
    !/[.!?:;,]$/.test(text) &&
    (s.lineSize ?? ctx.bodySize) <= ctx.bodySize * 1.05 &&
    !s.text.includes("\n")
  );
}

// ── Embedded images ─────────────────────────────────────────────────────────
// pdf.js operator numbers (pdfjs OPS): the walk tracks the current transform
// and maps each painted image's unit square onto the page.
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_FORM_BEGIN = 74;
const OP_FORM_END = 75;
const OP_IMAGE_MASK = 83;
const OP_IMAGE = 85;
const OP_INLINE_IMAGE = 86;
const OP_IMAGE_REPEAT = 88;

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  // m then n: the product n × m in PDF's row-vector convention.
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

// The boxes of the images a page paints, in PDF points (y up). Icons and
// bullet glyphs are too small to be figures; a page-sized image is a scan or
// a background, whose text layer stays text.
const OP_PATH = 91;

type PageDrawing = { images: Box[]; paths: Box[] };

function imageBoxes(
  ops: { fnArray: number[]; argsArray: unknown[] },
  pageWidth: number,
  pageHeight: number,
): PageDrawing {
  const boxes: Box[] = [];
  const paths: Box[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const formStack: Matrix[] = [];
  for (let k = 0; k < ops.fnArray.length; k++) {
    const fn = ops.fnArray[k];
    const args = ops.argsArray[k];
    if (fn === OP_SAVE) stack.push(ctm);
    else if (fn === OP_RESTORE) ctm = stack.pop() ?? ctm;
    else if (fn === OP_TRANSFORM && Array.isArray(args) && args.length === 6) {
      ctm = multiply(args as Matrix, ctm);
    } else if (fn === OP_FORM_BEGIN && Array.isArray(args)) {
      formStack.push(ctm);
      const matrix = args[0];
      if (Array.isArray(matrix) && matrix.length === 6) ctm = multiply(matrix as Matrix, ctm);
    } else if (fn === OP_FORM_END) {
      ctm = formStack.pop() ?? ctm;
    } else if (fn === OP_PATH && Array.isArray(args)) {
      // A vector path: its local bounds mapped through the transform. Chart
      // lines, bars, ticks and rules all arrive here.
      const mm = args[2] as ArrayLike<number> | undefined;
      if (mm && mm.length === 4 && Number.isFinite(mm[0])) {
        const pts = [
          [mm[0], mm[1]],
          [mm[2], mm[1]],
          [mm[0], mm[3]],
          [mm[2], mm[3]],
        ].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
        const xs = pts.map((c) => c[0]);
        const ys = pts.map((c) => c[1]);
        const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
        if (box.x2 - box.x1 < pageWidth * 0.9 || box.y2 - box.y1 < pageHeight * 0.9) paths.push(box);
      }
    } else if (fn === OP_IMAGE || fn === OP_INLINE_IMAGE || fn === OP_IMAGE_MASK || fn === OP_IMAGE_REPEAT) {
      // The image fills the unit square under the current transform.
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
      const xs = corners.map((c) => c[0]);
      const ys = corners.map((c) => c[1]);
      const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
      const w = box.x2 - box.x1;
      const h = box.y2 - box.y1;
      if (w < pageWidth * 0.12 || h < pageHeight * 0.04) continue;
      if (w * h > pageWidth * pageHeight * 0.85) continue;
      boxes.push(box);
    }
  }
  // Images on one row (a left and a right chart) are one figure.
  const merged: Box[] = [];
  for (const box of boxes.sort((a, b) => b.y2 - a.y2 || a.x1 - b.x1)) {
    const near = merged.find((m) => {
      const overlap = Math.min(m.y2, box.y2) - Math.max(m.y1, box.y1);
      const shorter = Math.min(m.y2 - m.y1, box.y2 - box.y1);
      const gap = Math.max(box.x1 - m.x2, m.x1 - box.x2);
      return overlap > shorter * 0.5 && gap < pageWidth * 0.08;
    });
    if (near) {
      near.x1 = Math.min(near.x1, box.x1);
      near.y1 = Math.min(near.y1, box.y1);
      near.x2 = Math.max(near.x2, box.x2);
      near.y2 = Math.max(near.y2, box.y2);
    } else merged.push({ ...box });
  }
  return { images: merged, paths };
}

// The drawing inside a vertical band: the union of paths and images whose
// vertical center lies in it.
function drawingIn(drawing: PageDrawing, y1: number, y2: number): Box | null {
  let box: Box | null = null;
  for (const b of [...drawing.paths, ...drawing.images]) {
    const cy = (b.y1 + b.y2) / 2;
    if (cy < y1 || cy > y2) continue;
    box = box ? unionBox(box, b) : { ...b };
  }
  return box;
}

function overlapsDrawing(box: Box, drawing: PageDrawing): boolean {
  return [...drawing.paths, ...drawing.images].some(
    (b) => b.x1 < box.x2 && b.x2 > box.x1 && b.y1 < box.y2 && b.y2 > box.y1 && (b.x2 - b.x1 > 2 || b.y2 - b.y1 > 2),
  );
}

function attachFigureRegions(
  segments: Segment[],
  lines: Line[],
  ctx: PageContext,
  pageWidth: number,
  pageHeight: number,
  drawing: PageDrawing = { images: [], paths: [] },
): Segment[] {
  const images = drawing.images;
  const toRegion = (box: Box) => regionOf(box, pageWidth, pageHeight);
  const rowGap = ctx.bodySize * ctx.leading;

  // 1. Display equations: a math segment and the equation-shaped segments
  // against it become one FIGURE.
  const near = (a: Segment, b: Segment) => a.box!.y1 - b.box!.y2 < rowGap * 1.5;
  const withMath: Segment[] = [];
  for (let k = 0; k < segments.length; ) {
    if (!isMathSegment(segments[k], ctx)) {
      withMath.push(segments[k]);
      k++;
      continue;
    }
    // Backward over equation-shaped lines already pushed.
    let start = k;
    while (
      withMath.length > 0 &&
      isEquationShaped(withMath[withMath.length - 1], ctx) &&
      near(withMath[withMath.length - 1], segments[start])
    ) {
      start = segments.indexOf(withMath.pop()!);
    }
    let m = k + 1;
    while (
      m < segments.length &&
      (isMathSegment(segments[m], ctx) || isEquationShaped(segments[m], ctx)) &&
      near(segments[m - 1], segments[m])
    ) {
      m++;
    }
    const group = segments.slice(start, m);
    let box = group[0].box!;
    for (const g of group) box = unionBox(box, g.box!);
    // The lines' boxes already carry ascent and descent; a small pad keeps
    // the neighboring prose lines out of the crop.
    // Subscripts and lowered limits hang under the line box: more room
    // below than above.
    const size = group[0].lineSize ?? ctx.bodySize;
    // A big delimiter at the edge reaches past the last glyph's advance:
    // room for it on both sides.
    box = { x1: box.x1 - size * 0.8, y1: box.y1 - size * 0.45, x2: box.x2 + size * 0.8, y2: box.y2 - size * 0.1 };
    withMath.push({
      type: "FIGURE",
      text: group
        .map((g) => g.text.replace(/[\t\n]+/g, " "))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
      page: group[0].page,
      box,
      region: toRegion(box),
      lineSize: group[0].lineSize,
      mathShare: 1,
    });
    k = m;
  }

  // 2. Captioned figures.
  const textLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
  const textRight = lines.length > 0 ? Math.max(...lines.map((l) => l.xEnd)) : pageWidth;
  // The column the caption sits in: the extent of the page's lines that
  // overlap it horizontally (the whole text width on a one-column page).
  const columnOf = (cap: Box): [number, number] => {
    const overlapping = lines.filter((l) => l.x < cap.x2 && l.xEnd > cap.x1);
    if (overlapping.length === 0) return [textLeft, textRight];
    return [Math.min(...overlapping.map((l) => l.x)), Math.max(...overlapping.map((l) => l.xEnd))];
  };
  const pageTop = pageHeight * 0.94;
  const pageBottom = pageHeight * 0.06;
  const out: Segment[] = [];
  for (let c = 0; c < withMath.length; c++) {
    const cap = withMath[c];
    if (
      cap.type !== "PARAGRAPH" ||
      !cap.box ||
      !CAPTION_RE.test(cap.text) ||
      TABLE_CAPTION_RE.test(cap.text)
    ) {
      out.push(cap);
      continue;
    }
    // Above the caption: debris up to the previous body segment. A table
    // under its own "Table N" caption is data, not debris.
    const swept: Segment[] = [];
    while (out.length > 0) {
      const prev = out[out.length - 1];
      // A legend or a hidden title inside the drawing is debris whatever it
      // read as; an attached figure never is.
      const inDrawing =
        prev.box !== undefined &&
        !(prev.type === "FIGURE" && prev.region) &&
        prev.text.length < 80 &&
        overlapsDrawing(prev.box, drawing);
      if (!isFigureDebris(prev, ctx) && !inDrawing) break;
      if (prev.type === "TABLE" && out.length >= 2 && TABLE_CAPTION_RE.test(out[out.length - 2].text)) break;
      swept.unshift(out.pop()!);
    }
    const above = out[out.length - 1];
    // The band ends under the previous segment, its caption included (a
    // figure's box leaves its caption out).
    const top = above?.box
      ? Math.min(above.box.y1, above.captionBox?.y1 ?? Infinity) - ctx.bodySize * 0.6
      : pageTop;
    let box: Box | null = null;
    const drawnAbove = drawingIn(drawing, cap.box.y2, top);
    if (swept.length > 0 || top - cap.box.y2 > rowGap * 3 || drawnAbove) {
      const [x1, x2] = columnOf(cap.box);
      box = { x1, x2, y1: cap.box.y2 + ctx.bodySize * 0.2, y2: top };
      for (const s of swept) if (s.box) box = unionBox(box, s.box);
      // The drawing sets the width: a chart wider than the text column keeps
      // its axis labels.
      if (drawnAbove) box = unionBox(box, { ...drawnAbove, y1: Math.max(drawnAbove.y1, box.y1), y2: Math.min(drawnAbove.y2, box.y2) });
    } else {
      out.push(...swept);
      // Below the caption: debris down to the next body segment.
      let m = c + 1;
      while (m < withMath.length && isFigureDebris(withMath[m], ctx)) m++;
      const below = withMath[m];
      const bottom = below?.box ? below.box.y2 + ctx.bodySize * 0.6 : pageBottom;
      const drawnBelow = drawingIn(drawing, bottom, cap.box.y1);
      if (m > c + 1 || cap.box.y1 - bottom > rowGap * 3 || drawnBelow) {
        const [x1, x2] = columnOf(cap.box);
        box = { x1, x2, y1: bottom, y2: cap.box.y1 - ctx.bodySize * 0.2 };
        for (const s of withMath.slice(c + 1, m)) if (s.box) box = unionBox(box, s.box);
        if (drawnBelow) box = unionBox(box, { ...drawnBelow, y1: Math.max(drawnBelow.y1, box.y1), y2: Math.min(drawnBelow.y2, box.y2) });
        c = m - 1;
      }
    }
    if (!box) {
      out.push(cap);
      continue;
    }
    // A caption wrapped into a second paragraph: the same (smaller) font a
    // line below the caption continues it.
    let text = cap.text;
    let runs = cap.runs;
    let captionBox = cap.box;
    const follow = withMath[c + 1];
    if (
      follow &&
      follow.type === "PARAGRAPH" &&
      follow.box &&
      follow.page === cap.page &&
      follow.lineSize !== undefined &&
      cap.lineSize !== undefined &&
      Math.abs(follow.lineSize - cap.lineSize) < 0.6 &&
      cap.box.y1 - follow.box.y2 <= cap.lineSize * ctx.leading * 0.9 &&
      (cap.lineSize < ctx.bodySize * 0.98 ||
        follow.text.length < 240 ||
        cap.box.y1 - follow.box.y2 <= cap.lineSize * 0.35)
    ) {
      const offset = text.length + 1;
      text = `${text} ${follow.text}`;
      runs = [
        ...(runs ?? []),
        ...(follow.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
      ];
      captionBox = unionBox(captionBox, follow.box);
      c++;
    }
    out.push({
      type: "FIGURE",
      text,
      page: cap.page,
      runs,
      box,
      captionBox,
      region: toRegion(box),
      lineSize: cap.lineSize,
      mathShare: 0,
    });
  }

  // 3. Embedded images. An image a captioned figure already covers extends
  // that figure; any other becomes a FIGURE of its own with no caption. Text
  // inside the image's box (chart labels, legends) is part of the picture.
  const inside = (inner: Box, outer: Box) => {
    const w = Math.max(0, Math.min(inner.x2, outer.x2) - Math.max(inner.x1, outer.x1));
    const h = Math.max(0, Math.min(inner.y2, outer.y2) - Math.max(inner.y1, outer.y1));
    const area = (inner.x2 - inner.x1) * (inner.y2 - inner.y1);
    return area > 0 && (w * h) / area >= 0.7;
  };
  let placed = out;
  for (const img of images) {
    const covering = placed.find((s) => s.type === "FIGURE" && s.box && inside(img, s.box));
    if (covering) continue;
    const overlapping = placed.find((s) => s.type === "FIGURE" && s.box && inside(s.box, img));
    if (overlapping && overlapping.box) {
      overlapping.box = unionBox(overlapping.box, img);
      overlapping.region = toRegion(overlapping.box);
      placed = placed.filter((s) => s === overlapping || !(s.box && s.type !== "FIGURE" && inside(s.box, img)));
      continue;
    }
    const kept = placed.filter((s) => !(s.box && s.type !== "FIGURE" && inside(s.box, img)));
    const center = (img.y1 + img.y2) / 2;
    let at = kept.findIndex((s) => s.box && (s.box.y1 + s.box.y2) / 2 < center);
    if (at < 0) at = kept.length;
    kept.splice(at, 0, {
      type: "FIGURE",
      text: "",
      page: placed[0]?.page ?? 0,
      box: img,
      region: toRegion(img),
      lineSize: ctx.bodySize,
      mathShare: 0,
    });
    placed = kept;
  }
  return placed;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function parsePdf(
  data: Uint8Array,
): Promise<{ title: string | null; blocks: ParsedBlock[] }> {
  // pdf.js transfers (detaches) the buffer it receives — parse a copy so callers keep theirs.
  const pdf = await getDocumentProxy(new Uint8Array(data));

  const pages: Line[][] = [];
  const pageHeights: number[] = [];
  const pageWidths: number[] = [];
  const pageDrawings: PageDrawing[] = [];
  const flagsByFont = new Map<string, FontFlags>();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    // Font programs resolve during operator-list building; afterwards the
    // real font names (Carlito-Bold, DejaVuSansMono, …) are readable.
    let drawing: PageDrawing = { images: [], paths: [] };
    try {
      const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
      drawing = imageBoxes(ops, viewport.width, viewport.height);
    } catch {
      // Broken page resources: fall back to no style flags and no drawing.
    }
    pageDrawings.push(drawing);
    let uriRegions: UriRegion[] = [];
    try {
      const annots = (await page.getAnnotations()) as Array<Record<string, unknown>>;
      uriRegions = annots
        .filter((a) => a.subtype === "Link" && typeof a.url === "string" && Array.isArray(a.rect))
        .map((a) => {
          const rect = a.rect as number[];
          return {
            href: a.url as string,
            x1: Math.min(rect[0], rect[2]),
            y1: Math.min(rect[1], rect[3]),
            x2: Math.max(rect[0], rect[2]),
            y2: Math.max(rect[1], rect[3]),
          };
        });
    } catch {
      uriRegions = [];
    }

    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const fontName = String(raw.fontName ?? "");
      let flags = flagsByFont.get(fontName);
      if (!flags) {
        let realName: string | null = null;
        try {
          const font = page.commonObjs.get(fontName) as { name?: string } | null;
          realName = font?.name ?? null;
        } catch {
          realName = null;
        }
        flags = fontFlags(realName);
        flagsByFont.set(fontName, flags);
      }
      // Control characters are not text: a chart glyph mapped to NUL broke the
      // save (Postgres rejects 0x00 in text). The math extension font is the
      // exception: its codes name big operators and delimiters.
      const mapped = flags.cmex ? mapCmexGlyphs(raw.str) : raw.str;
      const str = normalizeGlyphs(mapped.replace(CONTROL_CHARS_RE, ""));
      if (str.length === 0) continue;
      const t = raw.transform as number[];
      const size = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 10;
      if (Math.abs(t[1]) > size * 0.3) continue; // rotated text (margin watermarks)
      const x = t[4];
      const y = t[5];
      const cx = x + raw.width / 2;
      const cy = y + size * 0.3;
      const region = uriRegions.find((r) => cx >= r.x1 && cx <= r.x2 && cy >= r.y1 && cy <= r.y2);
      const { cmex: _cmex, ...itemFlags } = flags;
      void _cmex;
      items.push({
        str,
        x,
        y,
        w: raw.width,
        size,
        ...itemFlags,
        href: region?.href ?? null,
      });
    }
    pageHeights.push(viewport.height);
    pageWidths.push(viewport.width);
    pages.push(
      pageLines(items, viewport.width, p - 1).filter(
        (l) =>
          !(
            /^\d{1,4}$/.test(l.text) &&
            (l.y < viewport.height * 0.08 || l.y > viewport.height * 0.92)
          ),
      ),
    );
  }

  // The compounds the document hyphenates inside a line (for the wrap rule).
  hyphenCompounds = new Set<string>();
  for (const lines of pages) {
    for (const l of lines) {
      for (const m of l.text.matchAll(/(\p{L}+)-(\p{L}+)/gu)) {
        if (m.index !== undefined && m.index + m[0].length < l.text.length) {
          hyphenCompounds.add(`${m[1]}-${m[2]}`.toLowerCase());
        }
      }
    }
  }

  // Repeated headers and footers drop before anything is segmented.
  const furniture = furnitureKeys(pages, pageHeights);
  const cleaned = pages.map((lines, p) => {
    const h = pageHeights[p];
    return lines.filter((l) => {
      if (l.y > h * 0.085 && l.y < h * 0.915) return true;
      const key = l.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
      return !furniture.has(key);
    });
  });

  // Document metrics.
  const allBodySizes: number[] = [];
  const leadingRatios: number[] = [];
  for (const lines of cleaned) {
    for (let k = 0; k < lines.length; k++) {
      if (lines[k].text.length > 40) allBodySizes.push(lines[k].size);
      if (k > 0) {
        const gap = lines[k - 1].y - lines[k].y;
        const size = lines[k].size;
        if (Math.abs(lines[k - 1].size - size) < 0.6 && gap > size * 1.05 && gap < size * 2.0) {
          leadingRatios.push(gap / size);
        }
      }
    }
  }
  const bodySize = median(allBodySizes);
  const leading = leadingRatios.length >= 3 ? median(leadingRatios) : 1.45;
  const hasBold = cleaned.some((lines) => lines.some((l) => l.runs.some((r) => r.bold)));

  let segments: Segment[] = [];
  for (const lines of cleaned) {
    // The column's left edge: the smallest x that body lines regularly start
    // at. The mode is wrong on list-heavy pages, where indented item lines
    // outnumber flush body lines.
    const bodyXs = lines
      .filter((l) => l.cells.length === 1 && l.text.length > 30)
      .map((l) => Math.round(l.x));
    const counts = new Map<number, number>();
    for (const x of bodyXs) counts.set(x, (counts.get(x) ?? 0) + 1);
    const prominent = Math.max(2, Math.ceil(bodyXs.length * 0.12));
    let columnLeft = Infinity;
    for (const [x, count] of counts) {
      if (count >= prominent && x < columnLeft) columnLeft = x;
    }
    if (!Number.isFinite(columnLeft)) {
      columnLeft = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
    }
    // A label column (times, dates, step numbers) beside the content column:
    // two-cell lines whose short first cell sits at the page's left edge and
    // whose second cell starts where the page's body lines start, well right
    // of the edge. Two or more make the content column the column and those
    // lines label lines.
    const pageMinX = lines.length > 0 ? Math.min(...lines.map((l) => l.x)) : 0;
    const prominentXs = new Set([...counts].filter(([, c]) => c >= prominent).map(([x]) => x));
    const labelXs: number[] = [];
    for (const l of lines) {
      if (l.cells.length !== 2 || l.x > pageMinX + 4 || l.cells[0].text.length > 12) continue;
      const bodyX = Math.round(l.cells[1].x);
      if (bodyX - pageMinX >= 24 && prominentXs.has(bodyX)) labelXs.push(bodyX);
    }
    let labelColumn: number | null = null;
    if (labelXs.length >= 2) {
      labelColumn = median(labelXs);
      columnLeft = labelColumn;
    }
    const p = cleaned.indexOf(lines);
    // Frames: drawn rectangles wide enough for text and taller than a rule.
    const frames = pageDrawings[p].paths.filter(
      (b) => b.x2 - b.x1 >= pageWidths[p] * 0.4 && b.y2 - b.y1 >= bodySize * 3,
    );
    const ctx = { bodySize, leading, columnLeft, hasBold, pageMinX, labelColumn, frames };
    const pageSegments = segmentPage(lines, ctx);
    const withFigures = attachFigureRegions(pageSegments, lines, ctx, pageWidths[p], pageHeights[p], pageDrawings[p]);
    // Text inside a figure's box (a hidden chart title, a stray label) is
    // part of the picture.
    const figureBoxes = withFigures.filter((s) => s.type === "FIGURE" && s.region && s.box).map((s) => s.box!);
    segments.push(
      ...withFigures.filter((s) => {
        if ((s.type === "FIGURE" && s.region) || !s.box) return true;
        const b = s.box;
        return !figureBoxes.some((f) => {
          const w = Math.max(0, Math.min(b.x2, f.x2) - Math.max(b.x1, f.x1));
          const h = Math.max(0, Math.min(b.y2, f.y2) - Math.max(b.y1, f.y1));
          return (w * h) / Math.max(1, (b.x2 - b.x1) * (b.y2 - b.y1)) >= 0.7;
        });
      }),
    );
  }
  // A FIGURE with a region and no caption is an embedded image; every other
  // empty segment drops.
  segments = segments.filter((s) => s.text.trim().length > 0 || (s.type === "FIGURE" && s.region));
  // Vector-figure debris: chart axis ticks read as tiny numeric-only lines.
  // Inline-math debris: a sum limit or exponent too far from its base line
  // to join it reads as a paragraph of one or two math glyphs.
  segments = segments.filter(
    (s) =>
      !(
        s.type === "PARAGRAPH" &&
        s.text.length <= 14 &&
        /^[\d\s.,%−–-]+$/.test(s.text) &&
        !/\d\.$/.test(s.text.trim())
      ) &&
      !(
        s.type === "PARAGRAPH" &&
        s.text.replace(/\s/g, "").length <= 3 &&
        (s.mathShare ?? 0) >= 0.5
      ),
  );

  // Same-page paragraph fragments that end mid-sentence join the next paragraph.
  const fused: Segment[] = [];
  for (const segment of segments) {
    const prev = fused[fused.length - 1];
    if (
      segment.type === "PARAGRAPH" &&
      prev &&
      prev.type === "PARAGRAPH" &&
      segment.page === prev.page &&
      !prev.listItem &&
      !segment.listItem &&
      !prev.text.includes("\n") &&
      /[a-z,;\-–—]$/.test(prev.text) &&
      /^[a-z(]/.test(segment.text)
    ) {
      const glue = /[A-Za-z0-9][-–]$/.test(prev.text) && /^[A-Za-z0-9(]/.test(segment.text) ? "" : " ";
      const offset = prev.text.length + glue.length;
      prev.text = prev.text + glue + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }
    fused.push(segment);
  }

  segments = mergeAcrossPages(fused);
  resolveContentsLinks(segments);

  // A long title wraps across layout lines: consecutive equal-size HEADING
  // segments at the top of page 0 are one title, not several headings.
  while (
    segments.length >= 2 &&
    segments[0].page === 0 &&
    segments[1].page === 0 &&
    segments[0].type === "HEADING" &&
    segments[1].type === "HEADING" &&
    segments[0].rawSize !== undefined &&
    segments[1].rawSize !== undefined &&
    Math.abs(segments[0].rawSize - segments[1].rawSize) < 0.5
  ) {
    const offset = segments[0].text.length + 1;
    segments[0].text = `${segments[0].text} ${segments[1].text}`;
    shiftSpansInto(segments[0], segments[1], offset);
    segments.splice(1, 1);
  }

  assignHeadingLevels(segments, bodySize);

  // Title: the biggest heading on the first page.
  let title: string | null = null;
  let titleSize = 0;
  for (const s of segments) {
    if (s.page !== 0 || s.type !== "HEADING" || s.rawSize === undefined) continue;
    // A title is set larger than the body text; a body-size bold heading on
    // the first page ("Problem 1: …") is the first section, not the title.
    if (s.rawSize > titleSize && s.rawSize >= bodySize * 1.14 && s.text.length > 4) {
      title = s.text;
      titleSize = s.rawSize;
    }
  }

  // The reader shows the title above the blocks; the heading it came from
  // would show it twice.
  if (title && segments[0]?.type === "HEADING" && segments[0].text === title) segments = segments.slice(1);

  const blocks: ParsedBlock[] = segments.map((s) => {
    const { styles, links } = spansFromRuns(s.text, s.runs, {
      skipBold: s.type === "HEADING",
      skipMono: s.type === "CODE",
    });
    const block: ParsedBlock = { type: s.type, text: s.text };
    if (s.html) block.html = s.html;
    // FIGURE blocks keep their page (1-based) and region for the figure image route.
    if (s.type === "FIGURE") {
      block.page = s.page + 1;
      if (s.region) block.region = s.region;
    }
    const allLinks = [...(s.links ?? []), ...links];
    if (styles.length > 0) block.styles = styles;
    if (allLinks.length > 0) block.links = allLinks;
    return block;
  });

  return {
    title,
    blocks: blocks.filter((b) => b.text.trim().length > 0 || (b.type === "FIGURE" && b.region)),
  };
}
