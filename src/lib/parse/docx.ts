import { ommlLatex, ommlText } from "@/lib/parse/docx-math";
import { texError } from "@/lib/katex";
import { faceOf } from "@/lib/parse/pdf/faces";
import { isInk, takeBodyFont } from "@/lib/parse/pdf/look";
import {
  attr,
  boolAttr,
  child,
  children,
  cleanText,
  descendants,
  escapeHtml,
  intAttr,
  officeDocumentPath,
  parseTheme,
  parseXmlPart,
  partRels,
  relsOfType,
  textGap,
  unzipOffice,
  type OfficeZip,
  type Relationship,
} from "@/lib/parse/office";
import type { FootnoteRef, LinkSpan, MathSpan, ParsedBlock, ParsedDocument, StyleSpan, TextFont } from "@/lib/parse/types";
import type { HexColor } from "@/lib/text-style";

// The Word parser: a .docx read part by part into blocks, the way a Markdown
// file becomes blocks (SPEC.md §30: an import while the switch is on, else a
// block document). Word says what each paragraph is, so nothing is guessed
// from the look of a page:
//   - headings by their style (Heading 1–6, or a style whose outline level
//     makes it one), the document's title by the Title style;
//   - paragraphs with their runs: bold, italic, underline, strikethrough,
//     small caps, raised and lowered runs, monospace runs as code, links,
//     and their look — face, size, color, highlight — as the PDF parse
//     writes it (lib/parse/types.ts StyleSpan, ParsedBlock.font): the file
//     says exactly what a PDF's drawing only shows;
//   - lists from numbering.xml, each item's marker as Word draws it ("1.",
//     "1.1", "(a)", "(i)", "•") at its level, two spaces a level, as the PDF
//     parse writes them; a box or a marker typed before a tab is a list
//     line too (Word's checklist line is a ☐ and a tab);
//   - tables with their merged cells (gridSpan, vMerge) and header rows,
//     each cell's words inside its cell;
//   - footnotes and endnotes after the block that cites them, their label
//     raised in the text (the parse's footnote blocks, lib/parse/types.ts);
//   - pictures as figures with their captions; equations (OMML) as LaTeX
//     (lib/parse/docx-math.ts): display ones as EQUATION blocks, inline ones
//     as math spans;
//   - tracked changes as if accepted; comments, headers, footers, and hidden
//     text left out, as a printed copy leaves them.

export type DocxParseOptions = {
  /** Where the file's pictures go: the bytes stored as an image of the
      document, the URL the html points at; null = not stored. */
  storeImage: (bytes: Uint8Array, mimeType: string) => Promise<string | null>;
};

/** A Word file's blocks, and whether its title is the file's own words (a
    Title paragraph, a cover line) or not (its properties, its name). */
export type DocxParse = ParsedDocument & { titleFromFile: boolean };

// ── Constants ───────────────────────────────────────────────────────────────

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};
const EMU_PER_PX = 9525;
const EMU_PER_TWIP = 635;
/** A picture no larger than this beside words is an icon in the line, not a
    figure (the URL walk's rule for icons, lib/parse/figures.ts). */
const ICON_EMU = 48 * EMU_PER_PX;
/** Word's default text column: a Letter page less two 1-inch margins. */
const DEFAULT_TEXT_TWIPS = 9360;
/** Word's indent step, in twips (half an inch): a list level without an
    indent of its own stands this far in. */
const INDENT_STEP_TWIPS = 720;
/** Two list lines whose indents differ by less than this stand at one depth. */
const INDENT_SAME_TWIPS = 180;
/** The title stands among the document's first blocks. */
const TITLE_REACH = 8;
/** A title set by its size alone is this much larger than the body. */
const TITLE_SIZE_RATIO = 1.3;

// Monospace faces: a run in one is code (the PDF parse's code runs).
const MONO_FONT =
  /^(?:courier|consolas|menlo|monaco|lucida console|lucida sans typewriter|source code|dejavu sans mono|liberation mono|roboto mono|fira (?:code|mono)|jetbrains mono|sf mono|andale mono|inconsolata|ubuntu mono|noto (?:sans )?mono|cascadia|ibm plex mono|pt mono)/i;

// The Symbol font's characters by code (Adobe's Symbol encoding): an old
// Word file types Greek as Latin letters in Symbol, and w:sym names a
// Symbol character by its code.
const SYMBOL_CHARS = new Map<number, string>();
for (const [from, chars] of [
  [0x20, " !∀#∃%&∋()∗+,−./0123456789:;<=>?≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_ αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼"],
  [0xa1, "ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓◊⟨®©™∑"],
] as const) {
  [...chars].forEach((ch, i) => SYMBOL_CHARS.set(from + i, ch));
}
SYMBOL_CHARS.set(0xf1, "⟩");
SYMBOL_CHARS.set(0xf2, "∫");
// Wingdings: the bullets and boxes Word's bullet library draws with it.
const WINGDINGS_CHARS = new Map<number, string>([
  [0x6c, "●"], [0x6e, "■"], [0x6f, "☐"], [0x71, "❑"], [0x75, "◆"], [0x76, "❖"], [0x78, "☒"], [0xa1, "○"],
  [0xa7, "▪"], [0xa8, "◻"], [0xd8, "➢"], [0xfb, "✗"], [0xfc, "✓"], [0xfd, "☒"], [0xfe, "☑"],
]);

/** A character of a symbol font as the Unicode character it draws ("" when
    it draws nothing we can name); null when the font is not a symbol font.
    A symbol font's characters come as their codes or as the private-use
    U+F0xx form Word gives them. */
function symbolChar(font: string, ch: string): string | null {
  const name = font.toLowerCase();
  const table = name === "symbol" ? SYMBOL_CHARS : name.startsWith("wingdings") ? WINGDINGS_CHARS : null;
  if (!table) return null;
  let code = ch.charCodeAt(0);
  if (code >= 0xf000 && code <= 0xf0ff) code -= 0xf000;
  return table.get(code) ?? "";
}

// A marker typed before a tab: a box, a bullet glyph, a number, a letter, a
// numeral in parentheses — a list line made by hand ("☐" then a tab is how
// Word writes a checklist line; legal drafts type "1.1" then a tab).
const TYPED_MARKER =
  /^[ \u00a0]*([☐☑☒□■●○•▪◦–\-*➢✓✔❖◆►]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)]|\([ivxlcdm]{1,6}\)|\d{1,3}(?:\.\d{1,3})+\.?)[ \u00a0]*\t/;
// A box then a space is a checklist line too (Word's checkbox content
// control stands before the words), unless another box follows: "☐ Yes
// ☒ No" is a form line.
const BOX_LINE = /^[ \u00a0]*([☐☑☒])[ \u00a0]+(?![\s\S]*[☐☑☒])/;

// ── Word's on/off properties ────────────────────────────────────────────────

/** An on/off property the way Word writes it: on unless its val says 0,
    false, off, or none; undefined when absent. */
function flag(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = attr(el, "val");
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}

/** Is the element inside one of these (by local name)? */
function inside(el: Element, names: Set<string>): boolean {
  for (let at = el.parentElement; at; at = at.parentElement) if (names.has(at.localName)) return true;
  return false;
}

// ── Styles ──────────────────────────────────────────────────────────────────

type StyleDef = {
  id: string;
  name: string;
  basedOn: string | null;
  pPr: Element | null;
  rPr: Element | null;
  /** A table style that sets its first row apart (tblStylePr firstRow). */
  firstRow: boolean;
  /** A table style's table properties (its borders). */
  tblPr: Element | null;
};

type Styles = {
  byId: Map<string, StyleDef>;
  defaultParagraph: string | null;
  docRPr: Element | null;
  docPPr: Element | null;
  themeFonts: { major: string; minor: string };
};

function readStyles(zip: OfficeZip, rels: Map<string, Relationship>): Styles {
  const doc = parseXmlPart(zip, relsOfType(rels, "styles")[0]?.target ?? "word/styles.xml");
  const theme = relsOfType(rels, "theme")[0];
  const { major, minor } = theme ? parseTheme(zip, theme.target) : { major: "", minor: "" };
  const byId = new Map<string, StyleDef>();
  const typeOf = new Map<string, string>();
  let defaultParagraph: string | null = null;
  for (const style of descendants(doc, "style")) {
    const id = attr(style, "styleId");
    const type = attr(style, "type") ?? "paragraph";
    // A style defined twice (a generator's own after its defaults): the
    // later definition is the one Word and LibreOffice draw.
    if (!id || (typeOf.has(id) && typeOf.get(id) !== type)) continue;
    typeOf.set(id, type);
    const isDefault = attr(style, "default") === "1" || attr(style, "default") === "true";
    if (isDefault && type === "paragraph") defaultParagraph ??= id;
    byId.set(id, {
      id,
      name: (attr(child(style, "name"), "val") ?? id).toLowerCase(),
      basedOn: attr(child(style, "basedOn"), "val"),
      pPr: child(style, "pPr"),
      rPr: child(style, "rPr"),
      firstRow: children(style, "tblStylePr").some((c) => attr(c, "type") === "firstRow"),
      tblPr: child(style, "tblPr"),
    });
  }
  const defaults = descendants(doc, "docDefaults")[0];
  return {
    byId,
    defaultParagraph: defaultParagraph ?? (byId.has("Normal") ? "Normal" : null),
    docRPr: child(defaults, "rPrDefault", "rPr"),
    docPPr: child(defaults, "pPrDefault", "pPr"),
    themeFonts: { major, minor },
  };
}

/** A style and the styles it is based on, the base first. */
function styleChain(styles: Styles, id: string | null): StyleDef[] {
  const out: StyleDef[] = [];
  const seen = new Set<string>();
  for (let at = id; at && !seen.has(at) && out.length < 20; ) {
    seen.add(at);
    const style = styles.byId.get(at);
    if (!style) break;
    out.unshift(style);
    at = style.basedOn;
  }
  return out;
}

// ── Run looks ───────────────────────────────────────────────────────────────

type Look = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  smallCaps: boolean;
  vert: "sup" | "sub" | null;
  hidden: boolean;
  font: string;
  /** Half-points. */
  size: number;
  /** The words' color and the highlight behind them (#rrggbb), null for
      none: Word's highlight, else the run's shading, which Google Docs
      writes for its highlights. */
  color: HexColor | null;
  highlight: HexColor | null;
  shade: HexColor | null;
  /** Set in a monospace face the body is not set in: code. */
  code: boolean;
};

const PLAIN_LOOK: Look = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  smallCaps: false,
  vert: null,
  hidden: false,
  font: "",
  size: 20,
  color: null,
  highlight: null,
  shade: null,
  code: false,
};

/** A color the file names, as #rrggbb: six hex digits and nothing else
    ("auto", a theme's name, and a stray value are none). */
function hexColor(value: string | null): HexColor | null {
  return value && /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null;
}

// Word's highlight colors by name (w:highlight, ST_HighlightColor).
const HIGHLIGHTS: Record<string, HexColor> = {
  yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000",
  darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000",
  darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000", white: "#ffffff",
};

/** A shading's color (w:shd): its fill, or its pattern color when the
    pattern is solid; white is no color. */
function shadeColor(shd: Element | null): HexColor | null {
  const color = attr(shd, "val") === "solid" ? hexColor(attr(shd, "color")) : hexColor(attr(shd, "fill"));
  return color === "#ffffff" ? null : color;
}

/** A look with one run-properties element applied over it. */
function applyRPr(look: Look, rPr: Element | null, styles: Styles): Look {
  if (!rPr) return look;
  const out = { ...look };
  for (const el of rPr.children) {
    switch (el.localName) {
      case "b":
        out.bold = flag(el) ?? out.bold;
        break;
      case "i":
        out.italic = flag(el) ?? out.italic;
        break;
      case "u":
        out.underline = flag(el) ?? out.underline;
        break;
      case "strike":
      case "dstrike":
        out.strike = flag(el) ?? out.strike;
        break;
      case "color":
        out.color = hexColor(attr(el, "val"));
        break;
      case "highlight":
        out.highlight = HIGHLIGHTS[attr(el, "val") ?? ""] ?? null;
        break;
      case "shd":
        out.shade = shadeColor(el);
        break;
      case "smallCaps":
        out.smallCaps = flag(el) ?? out.smallCaps;
        break;
      case "vanish":
        out.hidden = flag(el) ?? out.hidden;
        break;
      case "vertAlign": {
        const v = attr(el, "val");
        out.vert = v === "superscript" ? "sup" : v === "subscript" ? "sub" : null;
        break;
      }
      case "sz": {
        const v = intAttr(el, "val");
        if (v !== null && v > 0) out.size = v;
        break;
      }
      case "rFonts": {
        const named = attr(el, "ascii") ?? attr(el, "hAnsi");
        const theme = attr(el, "asciiTheme") ?? attr(el, "hAnsiTheme");
        if (named) out.font = named;
        else if (theme) out.font = theme.startsWith("major") ? styles.themeFonts.major : styles.themeFonts.minor;
        break;
      }
    }
  }
  return out;
}

// ── Paragraph properties ────────────────────────────────────────────────────

type Role = "title" | "subtitle" | "caption" | "quote" | "code" | null;

type ParaProps = {
  heading: number | null;
  role: Role;
  /** A contents entry's level (the "toc N" styles). */
  toc: number | null;
  numId: string | null;
  ilvl: number;
  align: "center" | "right" | "justify" | null;
  /** Each side's border (w:pBdr) as the page editor stores a paragraph's
      side (borderSide); null for none. */
  border: Record<BorderSideName, string | null>;
  /** The left indent in twips: the style's, or the paragraph's own. */
  left: number;
  /** The first line's indent against the left indent in twips (w:ind
      firstLine; a hanging indent negative). */
  first: number;
  /** The paragraph's own left indent, which wins over its list level's. */
  ownLeft: number | null;
  /** The look every run of the paragraph starts from. */
  base: Look;
  /** The paragraph mark is a tracked deletion: the words join the next paragraph. */
  markDeleted: boolean;
  /** The outline level the paragraph's style or its own properties set (9:
      body text, as the TOC Heading style sets it), null for none. */
  outline: number | null;
  /** The space before and after the paragraph in twips (w:spacing through
      the layers; none set is none), whether it leaves them out beside a
      paragraph of its own style (w:contextualSpacing), its style, and its
      line spacing (w:line: 240ths of a line when the rule is auto, twips
      when it is exact or at least). */
  before: number;
  after: number;
  contextual: boolean;
  styleId: string | null;
  line: { value: number; rule: "auto" | "exact" | "atLeast" };
  /** The paragraph starts a page (w:pageBreakBefore). */
  pageBefore: boolean;
};

const ROLE_BY_NAME: Record<string, Role> = {
  title: "title",
  subtitle: "subtitle",
  caption: "caption",
  quote: "quote",
  "intense quote": "quote",
  "block text": "quote",
  "html preformatted": "code",
  code: "code",
  "source code": "code",
  "macro text": "code",
};

/** A paragraph's properties: the document's defaults, the table's style,
    the paragraph style and its bases, then the paragraph's own. */
function paraProps(pPr: Element | null, styles: Styles, table: StyleDef[]): ParaProps {
  const styleId = attr(child(pPr, "pStyle"), "val") ?? styles.defaultParagraph;
  const chain = styleChain(styles, styleId);
  let heading: number | null = null;
  let role: Role = null;
  let toc: number | null = null;
  // The nearest style that says what the paragraph is decides; a style the
  // file names but never defines speaks by its id ("Heading2", "TOC2").
  const named = chain.length > 0 ? [...chain].reverse() : styleId ? [{ id: styleId, name: styleId.toLowerCase() }] : [];
  for (const style of named) {
    const h = /^heading ([1-9])$/.exec(style.name) ?? /^heading([1-9])$/i.exec(style.id);
    const r = ROLE_BY_NAME[style.name] ?? null;
    if (heading === null && role === null) {
      if (h) heading = Number(h[1]);
      else if (r) role = r;
    }
    const t = /^toc ([1-9])$/.exec(style.name) ?? /^toc([1-9])$/i.exec(style.id);
    if (t && toc === null) toc = Number(t[1]);
  }
  let base = applyRPr(PLAIN_LOOK, styles.docRPr, styles);
  for (const style of [...table, ...chain]) base = applyRPr(base, style.rPr, styles);
  const out: ParaProps = {
    heading,
    role,
    toc,
    numId: null,
    ilvl: 0,
    align: null,
    border: { top: null, bottom: null, left: null, right: null },
    left: 0,
    first: 0,
    ownLeft: indentOf(child(pPr, "ind")),
    base,
    markDeleted: child(child(pPr, "rPr"), "del") !== null,
    outline: null,
    before: 0,
    after: 0,
    contextual: false,
    styleId,
    line: { value: 240, rule: "auto" },
    pageBefore: false,
  };
  let outline: number | null = null;
  for (const layer of [styles.docPPr, ...table.map((s) => s.pPr), ...chain.map((s) => s.pPr), pPr]) {
    if (!layer) continue;
    const jc = attr(child(layer, "jc"), "val");
    if (jc) out.align = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : null;
    const numPr = child(layer, "numPr");
    if (numPr) {
      const numId = attr(child(numPr, "numId"), "val");
      if (numId !== null) out.numId = numId === "0" ? null : numId;
      const ilvl = intAttr(child(numPr, "ilvl"), "val");
      if (ilvl !== null) out.ilvl = Math.max(0, Math.min(8, ilvl));
    }
    const lvl = intAttr(child(layer, "outlineLvl"), "val");
    if (lvl !== null) outline = lvl;
    const bdr = child(layer, "pBdr");
    for (const side of BORDER_SIDES) {
      const b = child(bdr, side) ?? (side === "left" ? child(bdr, "start") : side === "right" ? child(bdr, "end") : null);
      if (b) out.border[side] = borderSide(b);
    }
    const ind = child(layer, "ind");
    out.left = indentOf(ind) ?? out.left;
    const hanging = intAttr(ind, "hanging");
    const firstLine = intAttr(ind, "firstLine");
    if (hanging !== null) out.first = -hanging;
    else if (firstLine !== null) out.first = firstLine;
    const spacing = child(layer, "spacing");
    out.before = spaceOf(spacing, "before") ?? out.before;
    out.after = spaceOf(spacing, "after") ?? out.after;
    const line = spaceOf(spacing, "line");
    if (line !== null && line > 0) {
      const rule = attr(spacing, "lineRule");
      out.line = { value: line, rule: rule === "exact" ? "exact" : rule === "atLeast" ? "atLeast" : "auto" };
    }
    out.contextual = flag(child(layer, "contextualSpacing")) ?? out.contextual;
    out.pageBefore = flag(child(layer, "pageBreakBefore")) ?? out.pageBefore;
  }
  // An outline level makes a heading of a style Word does not name one (a
  // "Chapter" style at level 1).
  if (out.heading === null && out.role === null && outline !== null && outline < 9) out.heading = outline + 1;
  out.outline = outline;
  return out;
}

/** A left indent (w:ind left, or start), in twips. */
function indentOf(ind: Element | null): number | null {
  return intAttr(ind, "left") ?? intAttr(ind, "start");
}

// ── Borders ─────────────────────────────────────────────────────────────────

type BorderSideName = "top" | "right" | "bottom" | "left";
const BORDER_SIDES: BorderSideName[] = ["top", "right", "bottom", "left"];

/** A border side (a w:pBdr, w:tcBorders, or w:tblBorders child) as the page
    editor stores one: "<width pt> <solid|dotted|dashed> #rrggbb" and, for
    a paragraph, the room between the line and the words (w:space, points);
    null for none. Word's width is eighths of a point; "auto" is black. */
function borderSide(el: Element, withSpace = true): string | null {
  const val = attr(el, "val") ?? "none";
  if (val === "none" || val === "nil") return null;
  const dash = /^dot/.test(val) && !/dash/i.test(val) ? "dotted" : /dash/i.test(val) ? "dashed" : "solid";
  const width = Math.min(12, Math.max(0.13, Math.round(((intAttr(el, "sz") ?? 4) / 8) * 100) / 100));
  const color = hexColor(attr(el, "color")) ?? "#000000";
  const space = Math.min(31, Math.max(0, intAttr(el, "space") ?? 0));
  return `${width} ${dash} ${color}${withSpace ? ` ${space}` : ""}`;
}

/** The most space the page editor sets before or after a paragraph, 1584
    pt, in twips. */
const MAX_SPACE_TWIPS = 31_680;
/** Word's auto spacing (w:beforeAutospacing, a web page's paragraphs): 14 pt. */
const AUTO_SPACE_TWIPS = 280;
/** A single line's height over its size (Arial and Times New Roman 1.15,
    Calibri 1.22). */
const SINGLE_LINE = 1.15;

/** A space w:spacing sets, in twips: Word's auto spacing, else the length,
    else a count of lines (hundredths of a 12 pt line; Word writes the
    length beside it). A value past the page editor's most is none. */
function spaceOf(spacing: Element | null, side: "before" | "after" | "line"): number | null {
  if (!spacing) return null;
  if (side !== "line" && boolAttr(spacing, `${side}Autospacing`)) return AUTO_SPACE_TWIPS;
  const lines = side === "line" ? null : intAttr(spacing, `${side}Lines`);
  const value = intAttr(spacing, side) ?? (lines === null ? null : lines * 2.4);
  return value !== null && value >= 0 && value <= MAX_SPACE_TWIPS ? Math.round(value) : null;
}

/** The space between two paragraphs in twips: the upper one's space after
    and the lower one's space before (Word adds the two), each left out
    beside a paragraph of its own style when it says so
    (w:contextualSpacing). */
function spaceBetween(above: ParaProps, below: ParaProps): number {
  const same = above.styleId === below.styleId;
  return (same && above.contextual ? 0 : above.after) + (same && below.contextual ? 0 : below.before);
}

/** A blank paragraph's height in twips: one line at its mark's size (half
    points) and its line spacing. */
function blankTwips(props: ParaProps, size: number): number {
  const single = size * 10 * SINGLE_LINE;
  const { value, rule } = props.line;
  return Math.round(rule === "exact" ? value : rule === "atLeast" ? Math.max(value, single) : (single * value) / 240);
}

// ── Numbering ───────────────────────────────────────────────────────────────

type Level = { fmt: string; text: string; start: number; restart: number | null; legal: boolean; font: string; left: number | null };

function readLevel(lvl: Element): Level {
  const rFonts = child(child(lvl, "rPr"), "rFonts");
  return {
    fmt: attr(child(lvl, "numFmt"), "val") ?? "decimal",
    text: attr(child(lvl, "lvlText"), "val") ?? "",
    start: intAttr(child(lvl, "start"), "val") ?? 0,
    restart: intAttr(child(lvl, "lvlRestart"), "val"),
    legal: flag(child(lvl, "isLgl")) ?? false,
    left: indentOf(child(child(lvl, "pPr"), "ind")),
    font: attr(rFonts, "ascii") ?? attr(rFonts, "hAnsi") ?? "",
  };
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let out = "";
  let rest = Math.max(1, n);
  for (const [value, letters] of table) {
    while (rest >= value) {
      out += letters;
      rest -= value;
    }
  }
  return out;
}

const CJK_DIGITS = "〇一二三四五六七八九";

/** A counter in a number format, as Word draws it. */
function formatNumber(fmt: string, n: number): string {
  const k = Math.max(1, n);
  switch (fmt) {
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    case "upperRoman":
      return roman(n).toUpperCase();
    case "lowerRoman":
      return roman(n);
    case "upperLetter":
    case "lowerLetter": {
      // Word's letters run a–z, then aa–zz.
      const letter = String.fromCharCode(97 + ((k - 1) % 26)).repeat(Math.floor((k - 1) / 26) + 1);
      return fmt === "upperLetter" ? letter.toUpperCase() : letter;
    }
    case "ordinal":
      return `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;
    case "decimalEnclosedCircle":
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
    case "decimalFullWidth":
      return String(n).replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
    case "chineseCounting":
    case "chineseCountingThousand":
    case "ideographDigital":
    case "japaneseCounting":
    case "taiwaneseCounting":
      if (n < 10) return CJK_DIGITS[n];
      if (n < 100) return `${n >= 20 ? CJK_DIGITS[Math.floor(n / 10)] : ""}十${n % 10 ? CJK_DIGITS[n % 10] : ""}`;
      return String(n);
    case "ideographTraditional":
      return "甲乙丙丁戊己庚辛壬癸"[(k - 1) % 10];
    case "chicago":
      return "*†‡§"[(k - 1) % 4].repeat(Math.floor((k - 1) / 4) + 1);
    case "none":
      return "";
    default:
      return String(n);
  }
}

/** A bullet level's character as the character it draws: a symbol font's
    code mapped (Symbol's U+F0B7 "•", Wingdings' U+F0A7 "▪"), Courier New's
    "o" — Word's hollow second-level bullet — as the hollow bullet ◦, any
    other character as it is. A bullet with no character we can name is the
    default dot, so the line stays a list line (the converter draws the
    LIST text's bullets, lib/docs/import.ts). */
function bulletChar(level: Level): string {
  const text = level.text.trim();
  if (!text) return "•";
  if (text === "o") return "◦";
  const drawn = [...text].map((ch) => symbolChar(level.font, ch) ?? (/[\uf000-\uf0ff]/.test(ch) ? (symbolChar("Symbol", ch) ?? "") : ch)).join("");
  return drawn || "•";
}

/** numbering.xml: each list's levels, and the counters Word keeps as the
    document goes. Lists that share an abstract definition share counters;
    a list's start override restarts them where the list is first used —
    what Word's Restart Numbering writes. */
class Numbering {
  private readonly abstracts = new Map<string, Element>();
  private readonly nums = new Map<string, { abstractId: string; starts: Map<number, number>; lvls: Map<number, Element> }>();
  private readonly levelsOf = new Map<string, { abstractId: string; levels: Level[] } | null>();
  private readonly counters = new Map<string, (number | undefined)[]>();
  private readonly used = new Set<string>();

  constructor(
    doc: XMLDocument | null,
    private readonly styles: Styles,
  ) {
    for (const a of descendants(doc, "abstractNum")) {
      const id = attr(a, "abstractNumId");
      if (id !== null) this.abstracts.set(id, a);
    }
    for (const n of descendants(doc, "num")) {
      const id = attr(n, "numId");
      const abstractId = attr(child(n, "abstractNumId"), "val");
      if (id === null || abstractId === null) continue;
      const starts = new Map<number, number>();
      const lvls = new Map<number, Element>();
      for (const o of children(n, "lvlOverride")) {
        const ilvl = intAttr(o, "ilvl");
        if (ilvl === null) continue;
        const start = intAttr(child(o, "startOverride"), "val");
        if (start !== null) starts.set(ilvl, start);
        const lvl = child(o, "lvl");
        if (lvl) lvls.set(ilvl, lvl);
      }
      this.nums.set(id, { abstractId, starts, lvls });
    }
  }

  /** A list's abstract definition, through a numbering style's link
      (numStyleLink) to the list that holds the levels. */
  private abstractOf(numId: string, depth = 0): string | null {
    const num = this.nums.get(numId);
    const el = num ? this.abstracts.get(num.abstractId) : undefined;
    if (!num || !el) return null;
    const link = attr(child(el, "numStyleLink"), "val");
    const style = link ? this.styles.byId.get(link) : undefined;
    const linked = attr(child(child(style?.pPr ?? null, "numPr"), "numId"), "val");
    if (linked && linked !== numId && depth < 4) return this.abstractOf(linked, depth + 1);
    return num.abstractId;
  }

  private levels(numId: string): { abstractId: string; levels: Level[] } | null {
    if (this.levelsOf.has(numId)) return this.levelsOf.get(numId) ?? null;
    const abstractId = this.abstractOf(numId);
    const el = abstractId !== null ? this.abstracts.get(abstractId) : undefined;
    const num = this.nums.get(numId);
    let found: { abstractId: string; levels: Level[] } | null = null;
    if (abstractId !== null && el && num) {
      const levels: Level[] = [];
      for (const lvl of children(el, "lvl")) {
        const ilvl = intAttr(lvl, "ilvl");
        if (ilvl !== null && ilvl >= 0 && ilvl < 9) levels[ilvl] = readLevel(lvl);
      }
      for (const [ilvl, lvl] of num.lvls) if (ilvl >= 0 && ilvl < 9) levels[ilvl] = readLevel(lvl);
      found = { abstractId, levels };
    }
    this.levelsOf.set(numId, found);
    return found;
  }

  /** The marker of the next item of list `numId` at level `ilvl`, as Word
      draws it ("1.", "1.1", "(a)", "•"; "" when a number format draws none), and
      the level's indent; null when the list is not defined. The counters
      move on. */
  next(numId: string, ilvl: number): { marker: string; left: number | null } | null {
    const found = this.levels(numId);
    const level = found?.levels[ilvl];
    if (!found || !level) return null;
    const { abstractId, levels } = found;
    const counters = this.counters.get(abstractId) ?? [];
    this.counters.set(abstractId, counters);
    if (!this.used.has(numId)) {
      this.used.add(numId);
      for (const [at, start] of this.nums.get(numId)?.starts ?? []) counters[at] = start - 1;
    }
    counters[ilvl] = (counters[ilvl] ?? level.start - 1) + 1;
    // Deeper levels start over when a level above them is used, unless
    // their lvlRestart names the level that restarts them (0: never).
    for (let d = ilvl + 1; d < 9; d++) {
      const restart = levels[d]?.restart ?? null;
      if (restart !== 0 && (restart === null || ilvl <= restart - 1)) counters[d] = undefined;
    }
    const marker =
      level.fmt === "bullet"
        ? bulletChar(level)
        : level.text
            .replace(/%([1-9])/g, (_, k: string) => {
              const at = Number(k) - 1;
              const lv = levels[at];
              return formatNumber(level.legal ? "decimal" : (lv?.fmt ?? "decimal"), counters[at] ?? lv?.start ?? 1);
            })
            .trim();
    return { marker, left: level.left };
  }
}

// ── A line of words ─────────────────────────────────────────────────────────

type Mark = StyleSpan["style"];
type LinkTarget = { href: string } | { anchor: string };
type Note = { block: ParsedBlock };
type Span = { start: number; end: number };

function moveSpans<T extends Span>(list: T[], by: number): T[] {
  return list.map((s) => ({ ...s, start: s.start + by, end: s.end + by }));
}

/** A paragraph's words as they are read: the raw characters (a tab "\t", a
    line break "\n") and the spans over them. finish() tidies the white
    space and moves the spans with it. */
class Line {
  text = "";
  marks: (Span & { style: Mark })[] = [];
  links: (Span & { target: LinkTarget })[] = [];
  math: MathSpan[] = [];
  notes: (Span & { note: Note })[] = [];
  bookmarks: string[] = [];
  /** The largest size a run with words is set in, half-points. */
  size = 0;
  /** Characters by the size they are set in. */
  readonly sizes = new Map<number, number>();
  /** Every run with words is code (Look.code). */
  mono = true;

  get empty(): boolean {
    return this.text.trim() === "";
  }

  add(text: string, look: Look, link: LinkTarget | null) {
    if (!text) return;
    const start = this.text.length;
    this.text += text;
    const end = this.text.length;
    const words = text.trim().length;
    if (words > 0) {
      this.size = Math.max(this.size, look.size);
      this.sizes.set(look.size, (this.sizes.get(look.size) ?? 0) + words);
      if (!look.code) this.mono = false;
    }
    const marks: Mark[] = [];
    if (look.bold) marks.push("bold");
    if (look.italic) marks.push("italic");
    // A link's underline and color are the link's look, not the words'.
    if (look.underline && !link) marks.push("underline");
    if (look.strike) marks.push("strike");
    if (look.smallCaps) marks.push("smallCaps");
    if (look.vert) marks.push(look.vert);
    if (look.code) marks.push("code");
    // Black and near-black are the page's ink, no color (lib/parse/pdf/look.ts).
    if (look.color && !link && !isInk(look.color)) marks.push(`color:${look.color}`);
    const highlight = look.highlight ?? look.shade;
    if (highlight) marks.push(`highlight:${highlight}`);
    // Every run's face and size: the block keeps them only where a run of
    // words differs from the block's own look (lookOf).
    if (look.font) marks.push(`font:${faceOf(look.font)}`);
    marks.push(`size:${look.size / 2}`);
    for (const style of marks) {
      const last = this.marks.findLast((m) => m.style === style);
      if (last && last.end === start) last.end = end;
      else this.marks.push({ start, end, style });
    }
    if (link) {
      const last = this.links.at(-1);
      if (last && last.end === start && JSON.stringify(last.target) === JSON.stringify(link)) last.end = end;
      else this.links.push({ start, end, target: link });
    }
  }

  /** Another line's words after this one's. */
  append(other: Line) {
    const at = this.text.length;
    this.text += other.text;
    this.marks.push(...moveSpans(other.marks, at));
    this.links.push(...moveSpans(other.links, at));
    this.math.push(...moveSpans(other.math, at));
    this.notes.push(...moveSpans(other.notes, at));
    this.bookmarks.push(...other.bookmarks);
    this.size = Math.max(this.size, other.size);
    this.mono = this.mono && other.mono;
  }

  /** The raw characters from `from` to `to` alone (a typed marker cut from
      the head, a page number from the tail). */
  keep(from: number, to = this.text.length) {
    const cut = <T extends Span>(list: T[]) =>
      list.filter((s) => s.end > from && s.start < to).map((s) => ({ ...s, start: Math.max(from, s.start) - from, end: Math.min(to, s.end) - from }));
    this.text = this.text.slice(from, to);
    this.marks = cut(this.marks);
    this.links = cut(this.links);
    this.math = cut(this.math);
    this.notes = cut(this.notes);
  }

  /** Words before the line's own (a heading's number). */
  prepend(words: string) {
    this.text = words + this.text;
    this.marks = moveSpans(this.marks, words.length);
    this.links = moveSpans(this.links, words.length);
    this.math = moveSpans(this.math, words.length);
    this.notes = moveSpans(this.notes, words.length);
  }

  /** The words tidied — a tab or a run of spaces one space, none at a line's
      ends or the paragraph's — or kept exactly (code). */
  finish(exact: boolean): Words {
    const raw = this.text;
    const map = new Int32Array(raw.length + 1);
    let out = "";
    if (exact) {
      for (let i = 0; i <= raw.length; i++) map[i] = i;
      out = raw;
    } else {
      for (let i = 0; i < raw.length; i++) {
        let ch = raw[i];
        if (ch === "\t" || ch === "\u00a0") ch = " ";
        if (ch === "\n" && out.endsWith(" ")) out = out.slice(0, -1);
        map[i] = out.length;
        if (ch === " " && (out.length === 0 || out.endsWith(" ") || out.endsWith("\n"))) continue;
        out += ch;
      }
      map[raw.length] = out.length;
      const end = out.replace(/\s+$/, "").length;
      const lead = out.length - out.replace(/^\s+/, "").length;
      out = out.slice(lead, Math.max(lead, end));
      for (let i = 0; i <= raw.length; i++) map[i] = Math.max(0, Math.min(end, map[i]) - lead);
    }
    const place = <T extends Span>(list: T[]) => list.map((s) => ({ ...s, start: map[s.start], end: map[s.end] }));
    const moved = <T extends Span>(list: T[]) => place(list).filter((s) => s.end > s.start);
    // A note stays at no width: a custom mark that never came cites its note
    // from nowhere, and the note still follows the block.
    return { text: out, marks: moved(this.marks), links: moved(this.links), math: moved(this.math), notes: place(this.notes), bookmarks: this.bookmarks };
  }
}

/** A line's words, tidied, with their spans. */
type Words = {
  text: string;
  marks: (Span & { style: Mark })[];
  links: (Span & { target: LinkTarget })[];
  math: MathSpan[];
  notes: (Span & { note: Note })[];
  bookmarks: string[];
};

/** Words laid end to end into one block's text, each piece's spans moved
    to where it lands. */
class Joined implements Words {
  text = "";
  readonly marks: Words["marks"] = [];
  readonly links: Words["links"] = [];
  readonly math: MathSpan[] = [];
  readonly notes: Words["notes"] = [];
  readonly bookmarks: string[] = [];

  add(words: Words | string) {
    if (typeof words === "string") {
      this.text += words;
      return;
    }
    const at = this.text.length;
    this.text += words.text;
    this.marks.push(...moveSpans(words.marks, at));
    this.links.push(...moveSpans(words.links, at));
    this.math.push(...moveSpans(words.math, at));
    this.notes.push(...moveSpans(words.notes, at));
    this.bookmarks.push(...words.bookmarks);
  }
}

// ── A block's look ──────────────────────────────────────────────────────────

const LETTER = /[\p{L}\p{N}]/u;

/** The look most of a block's letters take (ParsedBlock.font), as the PDF
    parse reads a page's (lib/parse/pdf/text.ts): the face and the size of
    the most letters (a raised or lowered run, code, and a formula aside),
    bold and italic when most letters are, and the color most letters take.
    The face and size marks then stay only over a run of words that differs
    from it; a list's markers and a heading's number, no run's words, count
    for nothing. */
function lookOf(words: Words): { font?: TextFont; marks: Words["marks"] } {
  const { text } = words;
  const n = text.length;
  const face: string[] = new Array<string>(n).fill("");
  const size = new Float64Array(n);
  const color: string[] = new Array<string>(n).fill("");
  const on = { bold: new Uint8Array(n), italic: new Uint8Array(n), code: new Uint8Array(n), raised: new Uint8Array(n), math: new Uint8Array(n) };
  for (const m of words.marks) {
    const style = m.style;
    for (let i = m.start; i < m.end; i++) {
      if (style.startsWith("font:")) face[i] = style.slice(5);
      else if (style.startsWith("size:")) size[i] = Number(style.slice(5));
      else if (style.startsWith("color:")) color[i] = style.slice(6);
      else if (style === "bold" || style === "italic" || style === "code") on[style][i] = 1;
      else if (style === "sup" || style === "sub") on.raised[i] = 1;
    }
  }
  for (const m of words.math) on.math.fill(1, m.start, m.end);
  const counted = (i: number) => size[i] > 0 && !on.math[i] && LETTER.test(text[i]);
  let prose = false;
  for (let i = 0; i < n && !prose; i++) prose = counted(i) && !on.code[i];
  const faces = new Map<string, number>();
  const sizes = new Map<number, number>();
  const colors = new Map<string, number>();
  const tally = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
  let letters = 0;
  let bold = 0;
  let italic = 0;
  for (let i = 0; i < n; i++) {
    if (!counted(i)) continue;
    letters++;
    if (face[i] && (!prose || !on.code[i])) tally(faces, face[i]);
    if (!on.raised[i]) tally(sizes, size[i]);
    tally(colors, color[i]);
    bold += on.bold[i];
    italic += on.italic[i];
  }
  const top = <K>(map: Map<K, number>): K | undefined => [...map].sort((a, b) => b[1] - a[1])[0]?.[0];
  const family = top(faces);
  const pt = top(sizes);
  if (!family || pt === undefined) return { marks: words.marks.filter((m) => !m.style.startsWith("font:") && !m.style.startsWith("size:")) };
  const hue = top(colors);
  const font: TextFont = {
    family,
    size: pt,
    ...(bold * 2 > letters ? { bold: true as const } : {}),
    ...(italic * 2 > letters ? { italic: true as const } : {}),
    ...(hue ? { color: hue } : {}),
  };
  const hasWords = (m: Span, aside: Uint8Array) => {
    for (let i = m.start; i < m.end; i++) if (counted(i) && !aside[i]) return true;
    return false;
  };
  const marks = words.marks.filter((m) => {
    if (m.style.startsWith("font:")) return m.style.slice(5) !== family && hasWords(m, on.code);
    if (m.style.startsWith("size:")) return Math.abs(Number(m.style.slice(5)) - pt) >= 0.5 && hasWords(m, on.raised);
    return true;
  });
  return { font, marks };
}

// ── Inline html (table cells, captions) ─────────────────────────────────────

const TAG_OF: Partial<Record<Mark, string>> = { bold: "strong", italic: "em", underline: "u", strike: "s", code: "code", sub: "sub", sup: "sup" };

/** Words as html with their marks, formulas, and links, the html's DOM text
    exactly the words (a table's cells, a caption): a color and a highlight
    as a span's style (their values are #rrggbb, hexColor), an inline
    formula as a span that carries its TeX over its readable characters. A
    face and a size stay out: a table's text size is the table's. */
function inlineHtml(words: Pick<Words, "text" | "marks" | "links" | "math">): string {
  const cuts = new Set<number>([0, words.text.length]);
  for (const s of [...words.marks, ...words.links, ...words.math]) {
    cuts.add(s.start);
    cuts.add(s.end);
  }
  const points = [...cuts].filter((at) => !words.math.some((m) => at > m.start && at < m.end)).sort((a, b) => a - b);
  let html = "";
  for (let k = 0; k + 1 < points.length; k++) {
    const [a, b] = [points[k], points[k + 1]];
    let piece = escapeHtml(words.text.slice(a, b));
    const formula = words.math.find((m) => m.start === a && m.end === b);
    if (formula) piece = `<span data-type="inline-math" data-latex="${escapeHtml(formula.latex)}">${piece}</span>`;
    for (const m of words.marks) {
      if (m.start > a || m.end < b) continue;
      const tag = TAG_OF[m.style];
      if (tag) piece = `<${tag}>${piece}</${tag}>`;
      else if (m.style === "smallCaps") piece = `<span class="small-caps-mark">${piece}</span>`;
      else if (m.style.startsWith("color:")) piece = `<span style="color:${m.style.slice(6)}">${piece}</span>`;
      else if (m.style.startsWith("highlight:")) piece = `<span style="background-color:${m.style.slice(10)}">${piece}</span>`;
    }
    const link = words.links.find((l) => l.start <= a && l.end >= b);
    html += link && "href" in link.target ? `<a href="${escapeHtml(link.target.href)}">${piece}</a>` : piece;
  }
  return html;
}

// ── The reader ──────────────────────────────────────────────────────────────

/** The relationships of the part whose runs are read: the body's, or the
    notes part's (links, pictures). */
type Rels = Map<string, Relationship>;

type Field = {
  code: string;
  result: boolean;
  link: LinkTarget | null;
  hide: boolean;
  toc: boolean;
  box: string | null;
  /** A contents field: the heading levels it lists (\o "1-3"), and the
      contents entries read before its result began. */
  levels?: [number, number];
  entriesBefore?: number;
};

type Picture = { url: string; alt: string; widthEmu: number };

/** A paragraph's content in reading order: words, and the display
    equations, pictures, and rules that stand apart from them. */
type Piece =
  | { kind: "words"; line: Line }
  | { kind: "math"; latex: string; text: string }
  | { kind: "figure"; pictures: Picture[]; icon: boolean }
  | { kind: "rule" };

/** Where a run's content goes while a paragraph is read, and a page break
    met in it. */
type Sink = { line: () => Line; cut: (piece: Piece) => void; floating: Picture[]; page?: () => void };

/** A list line: its left indent in twips (its depth is the indent's rank in
    the list), its marker, its words. */
type ListLine = {
  indent: number;
  marker: string;
  words: Words;
  /** The space above the line in twips when a line of its list stands
      right above it (spaceBetween and the blank paragraphs between), and
      the line's alignment. */
  gap?: number;
  align: ParaProps["align"];
};
/** A list being read: its lines, whether it is a contents list, the notes
    its lines cite, its first line's paragraph (the space above the list),
    and the gap running on from its last line. */
type OpenList = { lines: ListLine[]; contents: boolean; notes: Note[]; first?: ParaProps; trail?: Spacing };
/** The gap under a text block so far: the paragraph it runs on from (the
    block's last, or a blank paragraph under it), the twips the blank
    paragraphs under the block add, and whether a page ends in it. */
type Spacing = { props: ParaProps; blank: number; pageEnd?: boolean };
/** A table cell: its html, its words, the columns and rows it spans, the
    note marks in its words (offsets into them), and its fill. */
type TableCell = {
  html: string;
  text: string;
  colspan: number;
  rowspan: number;
  notes?: (Span & { note: Note })[];
  fill?: HexColor | null;
  /** The cell's own borders (w:tcBorders): a side it sets, null for none. */
  borders?: Partial<Record<BorderSideName, string | null>>;
};

/** A table's borders: its style's, then its own (w:tblBorders), each edge
    a side's value or null for none; an edge no layer sets is absent. */
type TableBorders = Partial<Record<BorderSideName | "insideH" | "insideV", string | null>>;

function tableBorders(layers: (Element | null)[]): TableBorders {
  const out: TableBorders = {};
  for (const layer of layers) {
    const borders = child(layer, "tblBorders");
    for (const edge of ["top", "right", "bottom", "left", "insideH", "insideV"] as const) {
      const el = child(borders, edge) ?? (edge === "left" ? child(borders, "start") : edge === "right" ? child(borders, "end") : null);
      if (el) out[edge] = borderSide(el, false);
    }
  }
  return out;
}

/** A cell's own borders (w:tcBorders). */
function cellBorders(tc: Element): TableCell["borders"] {
  const borders = child(child(tc, "tcPr"), "tcBorders");
  if (!borders) return undefined;
  const out: NonNullable<TableCell["borders"]> = {};
  for (const side of BORDER_SIDES) {
    const el = child(borders, side) ?? (side === "left" ? child(borders, "start") : side === "right" ? child(borders, "end") : null);
    if (el) out[side] = borderSide(el, false);
  }
  return out;
}

/** Letters by the size they are set in (half points as points), into a
    table's tally: the table's text size is the size most of them take. */
function tallySizes(words: Words, into: Map<number, number>) {
  for (const m of words.marks) {
    if (!m.style.startsWith("size:")) continue;
    let n = 0;
    for (const ch of words.text.slice(m.start, m.end)) if (LETTER.test(ch)) n++;
    const size = Number(m.style.slice(5));
    if (n > 0) into.set(size, (into.get(size) ?? 0) + n);
  }
}

/** Twips as points, to a half point. */
const points = (twips: number) => Math.round(twips / 10) / 2;

class DocxReader {
  readonly blocks: ParsedBlock[] = [];
  /** Title-style paragraphs: the first among the opening blocks is the title. */
  readonly titles = new Set<ParsedBlock>();
  /** Each paragraph block's largest size, and characters by size. */
  readonly sizes = new Map<ParsedBlock, number>();
  readonly bodySizes = new Map<number, number>();
  readonly bookmarkBlocks = new Map<string, ParsedBlock>();
  readonly anchorLinks: { block: ParsedBlock; link: LinkSpan; anchor: string }[] = [];
  readonly contentsLines: { block: ParsedBlock; start: number; end: number }[] = [];
  /** Contents fields with no entries, each a contents list to build from the
      headings at its levels once every block is read (parseDocx), and the
      headings a contents field leaves out: the ones set at the outline's
      body level (the TOC Heading style's "Contents"). */
  readonly unfilledContents: { block: ParsedBlock; levels: [number, number] }[] = [];
  readonly unlisted = new Set<ParsedBlock>();
  private contentsEntries = 0;
  private unfilled: { levels: [number, number]; entriesBefore: number } | null = null;
  readonly noteRefs = new Map<ParsedBlock, (Span & { note: Note })[]>();
  private readonly numbering: Numbering;
  private readonly fields: Field[] = [];
  private list: OpenList | null = null;
  private code: string[] | null = null;
  /** A paragraph whose mark is a tracked deletion: its words join the next. */
  private carry: Line | null = null;
  /** The last text block read, and the gap under it so far (spaced). */
  private lastSpaced: (Spacing & { block: ParsedBlock }) | null = null;
  /** Where the page breaks of the paragraph last read fall (pieces), and
      whether a page ends after the paragraph before this one. */
  private pageBreaks = { before: false, after: false };
  private pageEndAfter = false;
  private pendingBookmarks: string[] = [];
  /** Text boxes met in a paragraph, read after it. */
  private boxes: Element[] = [];
  private footnoteCount = 0;
  private endnoteCount = 0;
  /** A custom-mark note waiting for its mark's words (claimCustomMark). */
  private customMark: { span: Span & { note: Note }; source: Element; rels: Rels; line: Line } | null = null;
  private readonly notes = { footnote: new Map<string, Element>(), endnote: new Map<string, Element>() };
  private readonly noteRels: { footnote: Rels; endnote: Rels };
  private readonly noteFormat: { footnote: string; endnote: string };
  private readonly textWidthEmu: number;
  /** The body (the default paragraph style) is set in a monospace face. */
  private readonly bodyMono: boolean;

  constructor(
    zip: OfficeZip,
    private readonly rels: Rels,
    private readonly styles: Styles,
    private readonly pictures: Map<string, string>,
    sectPr: Element | null,
  ) {
    const part = (type: string) => relsOfType(rels, type)[0];
    this.numbering = new Numbering(part("numbering") ? parseXmlPart(zip, part("numbering").target) : null, styles);
    const settings = part("settings") ? parseXmlPart(zip, part("settings").target) : null;
    const noteRels = { footnote: new Map() as Rels, endnote: new Map() as Rels };
    const format = { footnote: "decimal", endnote: "lowerRoman" };
    for (const kind of ["footnote", "endnote"] as const) {
      const rel = part(`${kind}s`);
      if (!rel) continue;
      noteRels[kind] = partRels(zip, rel.target);
      for (const note of descendants(parseXmlPart(zip, rel.target), kind)) {
        const id = attr(note, "id");
        const type = attr(note, "type");
        if (id !== null && (!type || type === "normal")) this.notes[kind].set(id, note);
      }
      // Footnotes count 1, 2, 3 and endnotes i, ii, iii unless the file says otherwise.
      const fmt = attr(child(child(sectPr, `${kind}Pr`), "numFmt"), "val") ?? attr(child(descendants(settings, `${kind}Pr`)[0] ?? null, "numFmt"), "val");
      if (fmt) format[kind] = fmt;
    }
    this.noteRels = noteRels;
    this.noteFormat = format;
    const width = (intAttr(child(sectPr, "pgSz"), "w") ?? 12240) - (intAttr(child(sectPr, "pgMar"), "left") ?? 1440) - (intAttr(child(sectPr, "pgMar"), "right") ?? 1440);
    this.textWidthEmu = (width > 1000 ? width : DEFAULT_TEXT_TWIPS) * EMU_PER_TWIP;
    this.bodyMono = MONO_FONT.test(paraProps(null, styles, []).base.font);
  }

  // ── Blocks out ──

  /** A block into the document, and after it the notes it cites. */
  private push(block: ParsedBlock, notes: Note[] = []) {
    this.blocks.push(block);
    for (const name of this.pendingBookmarks) if (!this.bookmarkBlocks.has(name)) this.bookmarkBlocks.set(name, block);
    this.pendingBookmarks = [];
    for (const note of notes) this.blocks.push(note.block);
  }

  /** A block of words with the spans the parse keeps. */
  private textBlock(type: ParsedBlock["type"], words: Words, html?: string, opts: { headingBold?: boolean } = {}): ParsedBlock {
    const block: ParsedBlock = { type, text: words.text };
    if (html) block.html = html;
    const look = lookOf(words);
    if (look.font) block.font = look.font;
    // A heading's bold is the heading's look (its font), not emphasis.
    const marks = opts.headingBold ? look.marks.filter((m) => m.style !== "bold") : look.marks;
    const styles: StyleSpan[] = marks.map((m) => ({ start: m.start, end: m.end, style: m.style, quotedText: words.text.slice(m.start, m.end) }));
    if (styles.length > 0) block.styles = styles;
    const links: LinkSpan[] = [];
    for (const l of words.links) {
      const link: LinkSpan = { start: l.start, end: l.end, quotedText: words.text.slice(l.start, l.end) };
      if ("href" in l.target) link.href = l.target.href;
      else this.anchorLinks.push({ block, link, anchor: l.target.anchor });
      links.push(link);
    }
    if (links.length > 0) block.links = links;
    if (words.math.length > 0) block.math = words.math;
    if (words.notes.length > 0) this.noteRefs.set(block, words.notes);
    for (const name of words.bookmarks) if (!this.bookmarkBlocks.has(name)) this.bookmarkBlocks.set(name, block);
    return block;
  }

  private closeList() {
    const list = this.list;
    this.list = null;
    if (!list || list.lines.length === 0) return;
    // A line's depth is its indent's rank among the list's indents, as the
    // page shows the nesting: Word's second-level list styles (List Bullet
    // 2) are a list of their own at level 0, drawn one step in.
    const steps: number[] = [];
    for (const indent of [...new Set(list.lines.map((l) => l.indent))].sort((a, b) => a - b)) {
      if (steps.length === 0 || indent - (steps.at(-1) ?? 0) >= INDENT_SAME_TWIPS) steps.push(indent);
    }
    const depthOf = (indent: number) => Math.max(0, steps.findLastIndex((s) => s <= indent));
    const joined = new Joined();
    const entries: Span[] = [];
    list.lines.forEach((line, i) => {
      if (i > 0) joined.add("\n");
      joined.add("  ".repeat(depthOf(line.indent)));
      if (line.marker) joined.add(`${line.marker} `);
      entries.push({ start: joined.text.length, end: joined.text.length + line.words.text.length });
      joined.add(line.words);
    });
    // The list's alignment, when its lines share one (a report's justified
    // items), and the space between its items: the gap most of them leave.
    const align = list.lines.every((l) => l.align === list.lines[0].align) ? list.lines[0].align : null;
    const tokens = [...(list.contents ? ["contents"] : []), ...(align ? [align] : [])];
    const block = this.textBlock("LIST", joined, tokens.length > 0 ? `<ul class="${tokens.join(" ")}"></ul>` : undefined);
    const gaps = new Map<number, number>();
    for (const line of list.lines) if (line.gap !== undefined) gaps.set(line.gap, (gaps.get(line.gap) ?? 0) + 1);
    const gap = [...gaps].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
    if (gap > 0) block.itemSpace = points(gap);
    if (list.first && list.trail) this.spaced(block, list.first, list.trail);
    if (list.contents) for (const entry of entries) this.contentsLines.push({ block, ...entry });
    this.push(block, list.notes);
  }

  /** The space above a list line that follows a line of its list, in
      twips; undefined for a list's first line or across a page's end. */
  private listGap(props: ParaProps): number | undefined {
    const trail = this.list?.trail;
    return trail && !trail.pageEnd ? trail.blank + spaceBetween(trail.props, props) : undefined;
  }

  private closeCode() {
    const text = (this.code ?? []).join("\n").replace(/\s+$/, "");
    this.code = null;
    if (text.trim()) this.push({ type: "CODE", text });
  }

  /** The list or code block the paragraphs were adding to ends. */
  close() {
    this.closeList();
    this.closeCode();
  }

  // ── The body ──

  body(el: Element, table: StyleDef[] = []) {
    for (const node of el.children) {
      switch (node.localName) {
        case "p":
          this.paragraph(node, table);
          // A contents field that ended with no entries, the paragraph it
          // ended in read (Word fills the field on update; LibreOffice
          // leaves it empty): a contents list stands here, built from the
          // headings once every block is read (parseDocx).
          if (this.unfilled?.entriesBefore === this.contentsEntries) {
            this.close();
            const block: ParsedBlock = { type: "LIST", text: "", html: '<ul class="contents"></ul>' };
            this.push(block);
            this.unfilledContents.push({ block, levels: this.unfilled.levels });
          }
          this.unfilled = null;
          break;
        case "tbl":
          this.close();
          this.table(node);
          break;
        case "sdt":
          this.body(child(node, "sdtContent") ?? node, table);
          break;
        case "customXml":
        case "ins":
        case "moveTo":
          this.body(node, table);
          break;
        case "AlternateContent":
          this.body(child(node, "Choice") ?? child(node, "Fallback") ?? node, table);
          break;
        case "bookmarkStart": {
          const name = attr(node, "name");
          if (name) this.pendingBookmarks.push(name);
          break;
        }
      }
      // The text boxes a paragraph anchors read after it.
      const boxes = this.boxes;
      this.boxes = [];
      for (const box of boxes) this.body(box, table);
    }
  }

  // ── Paragraphs ──

  private paragraph(p: Element, table: StyleDef[]) {
    const props = paraProps(child(p, "pPr"), this.styles, table);
    const tocBefore = this.fields.some((f) => f.toc);
    const pieces = this.pieces(p, props.base, this.rels);
    // A page ends in the gap above the paragraph: after the paragraph before
    // it, or at a page break before its words. One ends after it at a page
    // break after its words, or at a section break that starts a new page.
    if (this.pageEndAfter || this.pageBreaks.before || props.pageBefore) this.pageEnd();
    const section = child(child(p, "pPr"), "sectPr");
    this.pageEndAfter = this.pageBreaks.after || (section !== null && !["continuous", "nextColumn"].includes(attr(child(section, "type"), "val") ?? "nextPage"));
    const inToc = tocBefore || this.fields.some((f) => f.toc);
    // A deleted paragraph mark (a tracked change, accepted): the words run
    // on into the next paragraph.
    if (this.carry) {
      const carried = this.carry;
      this.carry = null;
      if (pieces[0]?.kind === "words") {
        carried.append(pieces[0].line);
        pieces[0] = { kind: "words", line: carried };
      } else pieces.unshift({ kind: "words", line: carried });
    }
    if (props.markDeleted && pieces.length === 1 && pieces[0].kind === "words") {
      this.carry = pieces[0].line;
      return;
    }
    for (const piece of pieces) {
      if (piece.kind === "words") for (const [size, n] of piece.line.sizes) this.bodySizes.set(size, (this.bodySizes.get(size) ?? 0) + n);
    }
    const only = pieces.length === 1 && pieces[0].kind === "words" && !pieces[0].line.empty ? pieces[0].line : null;

    // A contents entry, without the page number after its tab: the reader
    // has no pages to turn to. Inside a TOC field, a paragraph is an entry
    // when it looks like one (a TOC field a broken file never closes must
    // not make contents of the rest).
    const tail = only ? /\t[ .·…]*[\divxlcdm]{1,6}[ \t]*$/i.exec(only.text) : null;
    const entry = props.toc !== null || (inToc && (tail !== null || Boolean(only?.links.some((l) => "anchor" in l.target))));
    if (only && props.heading === null && entry) {
      if (tail) only.keep(0, tail.index);
      const words = only.finish(false);
      if (!words.text) return;
      this.closeCode();
      if (!this.list?.contents) {
        this.closeList();
        this.list = { lines: [], contents: true, notes: [] };
      }
      this.list.lines.push({ indent: (props.toc ?? 1) * INDENT_STEP_TWIPS, marker: "", words, gap: this.listGap(props), align: props.align });
      this.list.first ??= props;
      this.list.trail = { props, blank: 0 };
      this.contentsEntries += 1;
      return;
    }

    // A list item: Word's numbering, or a marker typed before a tab. Its
    // indent: the paragraph's own, else its level's, else its style's.
    if (only && props.heading === null && props.role !== "title") {
      const numbered = props.numId ? this.numbering.next(props.numId, props.ilvl) : null;
      let marker = numbered?.marker ?? null;
      let indent = props.ownLeft ?? numbered?.left ?? props.left + props.ilvl * INDENT_STEP_TWIPS;
      if (!marker) {
        const typed = TYPED_MARKER.exec(only.text) ?? BOX_LINE.exec(only.text);
        marker = typed ? typed[1] : null;
        indent = props.left;
        if (typed) only.keep(typed[0].length);
      }
      if (marker) {
        const words = only.finish(false);
        this.closeCode();
        if (!this.list || this.list.contents) {
          this.closeList();
          this.list = { lines: [], contents: false, notes: [] };
        }
        // A list line is one line: a line break inside an item is a space.
        this.list.lines.push({
          indent,
          marker: marker === "□" ? "☐" : marker,
          words: { ...words, text: words.text.replace(/\n/g, " ") },
          gap: this.listGap(props),
          align: props.align,
        });
        this.list.first ??= props;
        this.list.trail = { props, blank: 0 };
        this.list.notes.push(...words.notes.map((n) => n.note));
        return;
      }
    }

    // Code: a paragraph in a code style, or every run of it monospace. A
    // blank line inside code is the code's own.
    const blank = pieces.every((piece) => piece.kind === "words" && piece.line.empty);
    if (this.code && blank) {
      this.code.push("");
      return;
    }
    if (only && props.heading === null && props.role !== "title" && (props.role === "code" || only.mono)) {
      this.closeList();
      (this.code ??= []).push(only.finish(true).text.replace(/\s+$/, ""));
      return;
    }

    if (blank) {
      for (const piece of pieces) if (piece.kind === "words") this.pendingBookmarks.push(...piece.line.bookmarks);
      // A blank paragraph between list items is spacing, not the list's
      // end. A blank paragraph with a top or bottom border is a rule.
      if ((props.border.bottom || props.border.top) && !props.border.left && !props.border.right) {
        this.close();
        this.push({ type: "SEPARATOR", text: "---" });
        return;
      }
      // Else it is space in the gap it stands in: one line at its mark's size.
      const gap = this.list?.trail ?? this.lastSpaced;
      if (gap) {
        gap.blank += spaceBetween(gap.props, props) + blankTwips(props, applyRPr(props.base, child(child(p, "pPr"), "rPr"), this.styles).size);
        gap.props = props;
      }
      return;
    }
    this.close();

    // A numbered heading keeps its number, as the page prints it.
    let number = props.heading !== null && props.numId ? (this.numbering.next(props.numId, props.ilvl)?.marker ?? "") : "";
    for (const piece of pieces) {
      if (piece.kind === "math") this.push({ type: "EQUATION", text: piece.latex });
      else if (piece.kind === "rule") this.push({ type: "SEPARATOR", text: "---" });
      else if (piece.kind === "figure") this.push(this.figureBlock(piece.pictures));
      else if (piece.line.empty) this.pendingBookmarks.push(...piece.line.bookmarks);
      else {
        if (number) piece.line.prepend(`${number} `);
        number = "";
        const words = piece.line.finish(false);
        // A paragraph that is one formula and nothing else is a display
        // equation: Word draws it so, in or out of an m:oMathPara.
        const [formula] = words.math;
        if (props.heading === null && props.role !== "title" && words.math.length === 1 && formula.start === 0 && formula.end === words.text.length) {
          this.push({ type: "EQUATION", text: formula.latex });
          continue;
        }
        const block = this.wordsBlock(words, props);
        this.sizes.set(block, piece.line.size);
        this.push(block, words.notes.map((n) => n.note));
      }
    }
  }

  /** A paragraph's words as a HEADING, or a PARAGRAPH with its role and
      alignment as the layout tokens the reader and the converter read. */
  private wordsBlock(words: Words, props: ParaProps): ParsedBlock {
    const align = props.align ? ` class="${props.align}"` : "";
    if (props.heading !== null || props.role === "title") {
      const level = Math.min(6, props.heading ?? 1);
      const block = this.textBlock("HEADING", words, `<h${level}${align}>${escapeHtml(words.text)}</h${level}>`, { headingBold: true });
      if (props.role === "title") this.titles.add(block);
      if (props.outline === 9) this.unlisted.add(block);
      this.bordered(block, props);
      this.spaced(block, props, { props, blank: 0 });
      return block;
    }
    const tokens: string[] = [];
    if (props.role === "subtitle") tokens.push("meta");
    else if (props.role === "caption") tokens.push("caption");
    // A quotation: its style, or Word's look for one — indented with a rule
    // down its left side.
    else if (props.role === "quote" || (props.border.left && props.left > 0 && !props.border.right)) tokens.push("quote");
    if (props.align) tokens.push(props.align);
    const block = this.textBlock("PARAGRAPH", words, tokens.length > 0 ? `<p class="${tokens.join(" ")}">${escapeHtml(words.text)}</p>` : undefined);
    this.bordered(block, props);
    // The paragraph's indent as Word sets it. A quotation's inset is the
    // page editor's quote, unless the quotation draws its own bar.
    const left = props.left > 0 && props.left < 100_000 ? points(props.left) : 0;
    const first = Math.abs(props.first) < 100_000 ? points(props.first) : 0;
    if ((left || first) && (!tokens.includes("quote") || props.border.left)) block.indent = { left, first };
    this.spaced(block, props, { props, blank: 0 });
    return block;
  }

  /** A paragraph's borders (w:pBdr), the style's and its own: a report's
      rule under each Heading 1 and bar beside each quote. */
  private bordered(block: ParsedBlock, props: ParaProps) {
    const borders: NonNullable<ParsedBlock["borders"]> = {};
    for (const side of BORDER_SIDES) {
      const value = props.border[side];
      if (value) borders[side] = value;
    }
    if (Object.keys(borders).length > 0) block.borders = borders;
  }

  /** A text block (a heading, a paragraph, a list) into the document's
      spacing, before it is pushed: the text block right above it (no
      table, figure, equation, or rule between; its notes aside) takes its
      space after (ParsedBlock.spaceAfter) in points — the space between
      their paragraphs and the blank paragraphs between them. A heading's
      space before is so the space after of the block above it. The block
      starts the next gap; a block with no text block under it has none. */
  private spaced(block: ParsedBlock, first: ParaProps, trail: Spacing) {
    const above = this.lastSpaced;
    if (above && !above.pageEnd && this.blocks.findLast((b) => !b.footnote) === above.block) {
      above.block.spaceAfter = points(Math.min(MAX_SPACE_TWIPS, above.blank + spaceBetween(above.props, first)));
    }
    this.lastSpaced = { ...trail, block };
  }

  /** A page ends in the gap open now: the block above it has no space
      after, as where a page ends in a PDF. */
  private pageEnd() {
    const gap = this.list?.trail ?? this.lastSpaced;
    if (gap) gap.pageEnd = true;
  }

  /** Pictures as a figure: each at its width in the text column. */
  private figureBlock(pictures: Picture[]): ParsedBlock {
    const images = pictures.map((pic) => {
      const pct = Math.round((pic.widthEmu / this.textWidthEmu) * 100);
      return `<img src="${escapeHtml(pic.url)}" alt="${escapeHtml(pic.alt)}"${pct >= 15 && pct < 95 ? ` style="width:${pct}%"` : ""}>`;
    });
    return { type: "FIGURE", text: "", html: `<figure>${images.join("")}</figure>` };
  }

  // ── Runs ──

  /** A paragraph's content in reading order: its words, with display
      equations and pictures cut out between them. A floating picture
      follows the words; an icon-sized picture beside words stays out. */
  private pieces(p: Element, base: Look, rels: Rels): Piece[] {
    const pieces: Piece[] = [];
    let line = new Line();
    // A page break: the words piece it falls in, and where in its words.
    const breaks: { piece: number; at: number }[] = [];
    const sink: Sink = {
      line: () => line,
      cut: (piece) => {
        pieces.push({ kind: "words", line }, piece);
        line = new Line();
      },
      floating: [],
      page: () => breaks.push({ piece: pieces.length, at: line.text.length }),
    };
    this.inline(p, base, null, rels, sink);
    pieces.push({ kind: "words", line });
    const wordsIn = (list: Piece[]) => list.some((piece) => piece.kind === "words" && !piece.line.empty);
    const textOf = (k: number) => {
      const piece = pieces[k];
      return piece.kind === "words" ? piece.line.text : "";
    };
    this.pageBreaks = {
      before: breaks.some((b) => !wordsIn(pieces.slice(0, b.piece)) && !textOf(b.piece).slice(0, b.at).trim()),
      after: breaks.some((b) => !wordsIn(pieces.slice(b.piece + 1)) && !textOf(b.piece).slice(b.at).trim()),
    };
    if (sink.floating.length > 0) pieces.push({ kind: "figure", pictures: sink.floating, icon: false });
    const words = pieces.some((piece) => piece.kind === "words" && !piece.line.empty);
    return pieces.filter((piece) => (piece.kind === "words" ? !piece.line.empty || piece.line.bookmarks.length > 0 || pieces.length === 1 : !(piece.kind === "figure" && piece.icon && words)));
  }

  private inline(el: Element, base: Look, link: LinkTarget | null, rels: Rels, sink: Sink) {
    for (const node of el.children) {
      switch (node.localName) {
        case "r":
          this.run(node, base, link, rels, sink);
          break;
        case "hyperlink":
          this.inline(node, base, this.hyperlink(node, rels) ?? link, rels, sink);
          break;
        case "fldSimple": {
          const field: Field = { code: attr(node, "instr") ?? "", result: true, link: null, hide: false, toc: false, box: null };
          this.readField(field);
          this.fields.push(field);
          this.inline(node, base, link, rels, sink);
          this.fields.pop();
          break;
        }
        case "ins":
        case "moveTo":
        case "smartTag":
        case "customXml":
        case "dir":
        case "bdo":
          this.inline(node, base, link, rels, sink);
          break;
        case "sdt":
          this.inline(child(node, "sdtContent") ?? node, base, link, rels, sink);
          break;
        case "AlternateContent":
          this.inline(child(node, "Choice") ?? child(node, "Fallback") ?? node, base, link, rels, sink);
          break;
        case "oMathPara":
          for (const math of children(node, "oMath")) this.displayMath(math, sink);
          break;
        case "oMath":
          this.inlineMath(node, sink.line());
          break;
        case "bookmarkStart": {
          const name = attr(node, "name");
          if (name) sink.line().bookmarks.push(name);
          break;
        }
      }
    }
  }

  /** A display equation: an EQUATION of its own. KaTeX's check keeps a
      wrong formula out: one it cannot draw stays its readable characters. */
  private displayMath(math: Element, sink: Sink) {
    const latex = ommlLatex(math);
    const text = ommlText(math);
    if (latex && texError(latex) === null) sink.cut({ kind: "math", latex, text });
    else sink.line().add(text, PLAIN_LOOK, null);
  }

  /** An inline equation: its readable characters in the words, its LaTeX a
      math span over them. */
  private inlineMath(math: Element, line: Line) {
    const latex = ommlLatex(math);
    const text = ommlText(math);
    if (!text) return;
    const start = line.text.length;
    line.add(text, PLAIN_LOOK, null);
    if (latex && texError(latex) === null) line.math.push({ start, end: line.text.length, latex });
  }

  private hyperlink(el: Element, rels: Rels): LinkTarget | null {
    const rid = attr(el, "id");
    const anchor = attr(el, "anchor");
    const rel = rid ? rels.get(rid) : undefined;
    if (rel?.external) {
      const href = anchor ? `${rel.target}#${anchor}` : rel.target;
      return /^(https?:|mailto:|tel:)/i.test(href) ? { href } : null;
    }
    return anchor && anchor !== "_top" ? { anchor } : null;
  }

  // ── Fields ──

  /** What a field's code makes of its result: a HYPERLINK links it, a
      cross-reference (REF \h) links to its place, a TOC makes its
      paragraphs contents entries, a PAGEREF inside a contents entry is its
      page number (left out). */
  private readField(field: Field) {
    const code = field.code.trim();
    const kind = (/^(\S+)/.exec(code)?.[1] ?? "").toUpperCase();
    if (kind === "HYPERLINK") {
      const url = /HYPERLINK\s+(?:"([^"]*)"|(\S+))/i.exec(code);
      const local = /\\l\s+"([^"]*)"/i.exec(code)?.[1];
      const href = url?.[1] ?? url?.[2] ?? "";
      if (/^(https?:|mailto:|tel:)/i.test(href)) field.link = { href: local ? `${href}#${local}` : href };
      else if (local) field.link = { anchor: local };
    } else if (kind === "REF" && /\\h\b/.test(code)) {
      const name = /^REF\s+(\S+)/i.exec(code)?.[1];
      if (name) field.link = { anchor: name };
    } else if (kind === "TOC") {
      field.toc = true;
      // The levels a contents field lists: \o "1-3", Word's own when none.
      const o = /\\o\s+"(\d)-(\d)"/i.exec(code);
      field.levels = o ? [Number(o[1]), Math.max(Number(o[1]), Number(o[2]))] : [1, 3];
      field.entriesBefore = this.contentsEntries;
    } else if (kind === "PAGEREF") field.hide = this.fields.some((f) => f.toc);
  }

  private fieldChar(el: Element, look: Look, sink: Sink) {
    const type = attr(el, "fldCharType");
    if (type === "begin") {
      // A form checkbox draws a box and no words: its box's character.
      const box = child(child(el, "ffData"), "checkBox");
      const checked = flag(child(box, "checked")) ?? flag(child(box, "default")) ?? false;
      this.fields.push({ code: "", result: false, link: null, hide: false, toc: false, box: box ? (checked ? "☒" : "☐") : null });
      return;
    }
    const field = this.fields.at(-1);
    if (!field) return;
    if (type === "separate") {
      field.result = true;
      this.readField(field);
    }
    if (field.box) {
      sink.line().add(field.box, look, null);
      field.box = null;
    }
    if (type === "end") {
      const ended = this.fields.pop();
      if (ended?.levels && ended.entriesBefore !== undefined) this.unfilled = { levels: ended.levels, entriesBefore: ended.entriesBefore };
    }
  }

  // ── One run ──

  private run(r: Element, base: Look, link: LinkTarget | null, rels: Rels, sink: Sink) {
    let look = base;
    const rPr = child(r, "rPr");
    for (const style of styleChain(this.styles, attr(child(rPr, "rStyle"), "val"))) look = applyRPr(look, style.rPr, this.styles);
    look = applyRPr(look, rPr, this.styles);
    // A monospace run is code, unless the body itself is set in one (a
    // screenplay, a typewritten filing): then nothing is.
    look = { ...look, code: MONO_FONT.test(look.font) && !this.bodyMono };
    for (const node of r.children) {
      // The field state can change inside a run: read it at each node.
      const shown = !look.hidden && !this.fields.some((f) => !f.result || f.hide);
      const target = link ?? this.fields.findLast((f) => f.link)?.link ?? null;
      const line = sink.line();
      switch (node.localName) {
        case "t": {
          if (!shown) break;
          const at = line.text.length;
          line.add(this.symbolText(cleanText(node.textContent ?? ""), look), look, target);
          this.claimCustomMark(line, at);
          break;
        }
        case "tab":
        case "ptab":
          if (shown) line.add("\t", look, target);
          break;
        case "br":
        case "cr": {
          // A page or column break means nothing without pages; a line
          // break is a line break.
          const type = attr(node, "type");
          if (shown && (!type || type === "textWrapping")) line.add("\n", look, target);
          if (shown && type === "page") sink.page?.();
          break;
        }
        case "noBreakHyphen":
          if (shown) line.add("-", look, target);
          break;
        case "sym": {
          const code = parseInt(attr(node, "char") ?? "", 16);
          if (!shown || !Number.isFinite(code)) break;
          const ch = String.fromCharCode(code);
          const at = line.text.length;
          line.add(symbolChar(attr(node, "font") ?? "", ch) ?? ch, look, target);
          this.claimCustomMark(line, at);
          break;
        }
        case "fldChar":
          this.fieldChar(node, look, sink);
          break;
        case "instrText": {
          const field = this.fields.at(-1);
          if (field && !field.result) field.code += node.textContent ?? "";
          break;
        }
        case "footnoteReference":
        case "endnoteReference":
          if (!look.hidden) this.noteMark(node, look, line);
          break;
        case "drawing":
        case "pict":
        case "object":
          if (!look.hidden) this.drawing(node, sink);
          break;
        case "AlternateContent": {
          const choice = child(node, "Choice") ?? child(node, "Fallback");
          if (choice) this.run(choice, look, link, rels, sink);
          break;
        }
        case "ruby":
          // Ruby is a reading aid over its base: the base is the words.
          if (shown) line.add(descendants(child(node, "rubyBase"), "t").map((t) => t.textContent ?? "").join(""), look, target);
          break;
      }
    }
  }

  /** Text in a symbol font as the characters it draws. A private-use
      character in any other font draws nothing we can name. */
  private symbolText(text: string, look: Look): string {
    if (/^(?:symbol|wingdings)/i.test(look.font)) return [...text].map((ch) => symbolChar(look.font, ch) ?? ch).join("");
    return text.replace(/[\uf000-\uf0ff]/g, "");
  }

  // ── Notes ──

  /** A footnote or endnote mark: its label raised in the text, the note a
      block after the block that cites it. A custom mark ("*") takes no
      number: its label is the run after the reference (claimCustomMark). */
  private noteMark(el: Element, look: Look, line: Line) {
    const kind = el.localName === "endnoteReference" ? "endnote" : "footnote";
    const source = this.notes[kind].get(attr(el, "id") ?? "");
    if (!source) return;
    const rels = this.noteRels[kind];
    const start = line.text.length;
    if (["1", "true", "on"].includes(attr(el, "customMarkFollows") ?? "")) {
      // Until its run is read the note has no label; a mark that never
      // comes leaves the note with none ("").
      const span = { start, end: start, note: this.noteBlock(source, "", rels) };
      line.notes.push(span);
      this.customMark = { span, source, rels, line };
      return;
    }
    const label = formatNumber(this.noteFormat[kind], kind === "footnote" ? ++this.footnoteCount : ++this.endnoteCount);
    line.add(label, { ...look, vert: "sup" }, null);
    line.notes.push({ start, end: line.text.length, note: this.noteBlock(source, label, rels) });
  }

  /** The words a custom mark's run adds at `at` ("*"): the label of the note
      waiting for them, and the span its reference covers. */
  private claimCustomMark(line: Line, at: number) {
    const pending = this.customMark;
    if (!pending || pending.line !== line) return;
    const added = line.text.slice(at);
    const lead = added.search(/\S/);
    if (lead < 0) return;
    this.customMark = null;
    const mark = added.slice(lead).split(/\s/)[0];
    pending.span.start = at + lead;
    pending.span.end = at + lead + mark.length;
    pending.span.note.block = this.noteBlock(pending.source, mark, pending.rels, true).block;
  }

  /** A note's block: its label, one space, its words (lib/parse/types.ts).
      Word writes a custom mark again as the note's first words: the label
      stands for them. */
  private noteBlock(source: Element, label: string, rels: Rels, custom = false): Note {
    const joined = new Joined();
    if (label) {
      joined.add(label);
      joined.marks.push({ start: 0, end: label.length, style: "sup" });
    }
    let first = true;
    for (const p of descendants(source, "p")) {
      const line = new Line();
      const sink: Sink = { line: () => line, cut: () => undefined, floating: [] };
      this.inline(p, paraProps(child(p, "pPr"), this.styles, []).base, null, rels, sink);
      const head = line.text.search(/\S/);
      if (custom && first && head >= 0 && line.text.startsWith(label, head)) line.keep(head + label.length);
      const words = line.finish(false);
      if (!words.text) continue;
      first = false;
      if (joined.text) joined.add(" ");
      joined.add(words);
    }
    const block = this.textBlock("PARAGRAPH", joined, `<p class="footnote">${escapeHtml(joined.text)}</p>`);
    block.footnote = { label };
    return { block };
  }

  // ── Pictures ──

  /** A drawing: its pictures (a figure, or an icon in a line), a text box's
      paragraphs (read after the paragraph), Word's horizontal line. */
  private drawing(el: Element, sink: Sink) {
    if (descendants(el, "rect").some((r) => attr(r, "hr") === "t")) {
      sink.cut({ kind: "rule" });
      return;
    }
    // A group or a canvas of shapes is a diagram: its words are labels, not
    // the document's text. A text box on its own holds text.
    const diagram = ["wgp", "wpc", "group"].some((name) => descendants(el, name).length > 0);
    if (!diagram) for (const box of descendants(el, "txbxContent")) if (!inside(box, new Set(["txbxContent", "Fallback"]))) this.boxes.push(box);
    const frame = child(el, "inline") ?? child(el, "anchor");
    const extent = child(frame, "extent");
    const widthEmu = intAttr(extent, "cx") ?? 0;
    const heightEmu = intAttr(extent, "cy") ?? 0;
    const docPr = descendants(el, "docPr")[0] ?? null;
    const alt = cleanText(attr(docPr, "descr") ?? "").trim();
    const urls = new Set<string>();
    for (const blip of descendants(el, "blip")) {
      const url = this.pictureUrl(attr(descendants(blip, "svgBlip")[0] ?? null, "embed")) ?? this.pictureUrl(attr(blip, "embed"));
      if (url) urls.add(url);
    }
    for (const data of descendants(el, "imagedata")) {
      const url = this.pictureUrl(attr(data, "id") ?? attr(data, "relid"));
      if (url) urls.add(url);
    }
    if (urls.size === 0) return;
    const pictures = [...urls].map((url) => ({ url, alt, widthEmu }));
    const icon = widthEmu > 0 && heightEmu > 0 && widthEmu <= ICON_EMU && heightEmu <= ICON_EMU;
    if (frame?.localName === "anchor" && !icon) sink.floating.push(...pictures);
    else sink.cut({ kind: "figure", pictures, icon });
  }

  private pictureUrl(rid: string | null): string | null {
    const rel = rid ? this.rels.get(rid) : undefined;
    return rel && !rel.external ? (this.pictures.get(rel.target) ?? null) : null;
  }

  // ── Tables ──

  private table(tbl: Element) {
    const tblPr = child(tbl, "tblPr");
    const style = styleChain(this.styles, attr(child(tblPr, "tblStyle"), "val"));
    // A deleted row (a tracked change, accepted) is gone.
    const rows = children(tbl, "tr").filter((tr) => !child(child(tr, "trPr"), "del"));
    const spanOf = (tc: Element) => Math.max(1, intAttr(child(child(tc, "tcPr"), "gridSpan"), "val") ?? 1);
    // A table of one cell a row is a box around paragraphs (a callout, a
    // framed note): its content reads as the document's own. One shaded cell
    // of one paragraph is a label bar, a table with its fill (a report's
    // white words on a navy bar read as a plain paragraph).
    const only = rows.length === 1 && cellsOf(rows[0]).length === 1 ? cellsOf(rows[0])[0] : null;
    const bar =
      only !== null &&
      shadeColor(child(child(only, "tcPr"), "shd")) !== null &&
      children(only, "tbl").length === 0 &&
      children(only, "p").length === 1 &&
      paraProps(child(children(only, "p")[0], "pPr"), this.styles, style).heading === null;
    if (!bar && rows.every((tr) => cellsOf(tr).length <= 1)) {
      for (const tr of rows) for (const tc of cellsOf(tr)) this.body(tc, style);
      this.close();
      return;
    }
    // The grid: every slot holds the cell drawn there; a merged cell holds
    // every slot it covers, its own first.
    const grid: { cell: TableCell; origin: boolean }[][] = [];
    const notes: Note[] = [];
    const sizes = new Map<number, number>();
    const header: boolean[] = [];
    const firstRow = style.some((s) => s.firstRow) && tableLooksFirstRow(tblPr);
    rows.forEach((tr, r) => {
      const trPr = child(tr, "trPr");
      header.push(flag(child(trPr, "tblHeader")) === true || (r === 0 && firstRow));
      const row: { cell: TableCell; origin: boolean }[] = [];
      for (let k = intAttr(child(trPr, "gridBefore"), "val") ?? 0; k > 0; k--) row.push({ cell: { html: "", text: "", colspan: 1, rowspan: 1 }, origin: true });
      for (const tc of cellsOf(tr)) {
        const span = spanOf(tc);
        const vMerge = child(child(tc, "tcPr"), "vMerge");
        const above = grid[r - 1]?.[row.length]?.cell;
        let cell: TableCell;
        if (vMerge && (attr(vMerge, "val") ?? "continue") === "continue" && above) {
          // A vertically merged cell: the cell above grows down a row.
          cell = above;
          cell.rowspan += 1;
          row.push({ cell, origin: false });
        } else {
          cell = this.cell(tc, style, notes, sizes);
          cell.colspan = span;
          row.push({ cell, origin: true });
        }
        for (let k = 1; k < span; k++) row.push({ cell, origin: false });
      }
      grid.push(row);
    });
    const cols = Math.max(...grid.map((row) => row.length));
    for (const row of grid) while (row.length < cols) row.push({ cell: { html: "", text: "", colspan: 1, rowspan: 1 }, origin: true });

    // The text is one line per row, a tab between slots; the html's DOM
    // text is exactly that text (SPEC.md §5): each cell ends in an invisible
    // gap, and a covered slot's gap rides in the last cell drawn before it,
    // in its row or the row above.
    const heads = header.indexOf(false) === -1 ? rows.length : header.indexOf(false);
    // Each cell's sides: its own, else the table's edge or inside line
    // where it stands (a report's hairline gray-blue grid drew as one-point
    // black lines).
    const edges = tableBorders([...style.map((s) => s.tblPr), tblPr]);
    const sidesOf = (cell: TableCell, r: number, c: number): string => {
      const at: Record<BorderSideName, string | null | undefined> = {
        top: cell.borders?.top !== undefined ? cell.borders.top : r === 0 ? edges.top : edges.insideH,
        bottom: cell.borders?.bottom !== undefined ? cell.borders.bottom : r + cell.rowspan >= grid.length ? edges.bottom : edges.insideH,
        left: cell.borders?.left !== undefined ? cell.borders.left : c === 0 ? edges.left : edges.insideV,
        right: cell.borders?.right !== undefined ? cell.borders.right : c + cell.colspan >= cols ? edges.right : edges.insideV,
      };
      return BORDER_SIDES.flatMap((side) => {
        const value = at[side];
        if (value === undefined) return [];
        const [width, dash, color] = (value ?? "0 solid #000000").split(" ");
        return [`border-${side}:${width}pt ${dash} ${color}`];
      }).join(";");
    };
    const drawn: string[][] = [];
    const rowCells = grid.map((row, r) => {
      const tag = r < heads ? "th" : "td";
      const cells: string[][] = [];
      row.forEach((slot, c) => {
        const gap = c === cols - 1 ? (r === grid.length - 1 ? "" : textGap("\n")) : textGap("\t");
        if (!slot.origin) {
          drawn.at(-1)?.push(gap);
          return;
        }
        const { cell } = slot;
        const css = [cell.fill ? `background-color:${cell.fill}` : "", sidesOf(cell, r, c)].filter(Boolean).join(";");
        const spans = `${cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ""}${cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ""}${css ? ` style="${css}"` : ""}`;
        const parts = [`<${tag}${spans}>`, cell.html, gap];
        cells.push(parts);
        drawn.push(parts);
      });
      return { tag, cells };
    });
    // Joined only now: a later row's covered slot may add its gap to a cell above.
    const htmlRows = rowCells.map(({ tag, cells }) => `<tr>${cells.map((parts) => `${parts.join("")}</${tag}>`).join("")}</tr>`);
    const texts = grid.map((row) => row.map((slot) => (slot.origin ? slot.cell.text : "")).join("\t"));
    const head = heads > 0 ? `<thead>${htmlRows.slice(0, heads).join("")}</thead>` : "";
    const body = heads < htmlRows.length ? `<tbody>${htmlRows.slice(heads).join("")}</tbody>` : "";
    // The table's text size (the size most of its letters take) and its
    // columns' widths (w:tblGrid), in points, when the grid is the table's.
    const size = [...sizes].sort((a, b) => b[1] - a[1])[0]?.[0];
    const widths = children(child(tbl, "tblGrid"), "gridCol").map((col) => intAttr(col, "w") ?? 0);
    const colgroup =
      widths.length === cols && widths.every((w) => w > 0 && w < 100_000)
        ? `<colgroup>${widths.map((w) => `<col style="width:${points(w)}pt">`).join("")}</colgroup>`
        : "";
    const open = size !== undefined && size > 0 && size < 1000 ? `<table style="font-size:${size}pt">` : "<table>";
    const block: ParsedBlock = { type: "TABLE", text: texts.join("\n"), html: `${open}${colgroup}${head}${body}</table>` };
    // The note marks in the cells, at their places in the table's text: the
    // references a table's footnotes are cited from.
    const refs: (Span & { note: Note })[] = [];
    let at = 0;
    for (const row of grid) {
      for (const slot of row) {
        if (slot.origin) refs.push(...moveSpans(slot.cell.notes ?? [], at));
        at += (slot.origin ? slot.cell.text.length : 0) + 1;
      }
    }
    if (refs.length > 0) this.noteRefs.set(block, refs);
    this.push(block, notes);
  }

  /** A cell's words and html: one paragraph each (a list item keeps its
      marker as words), a nested table's cells as more paragraphs, a
      picture as an image; a paragraph set centered, flush right, or in
      from the cell's edge keeps it; the cell keeps its fill. Its notes wait
      for the table's end, and its letters' sizes go to the table's tally. */
  private cell(tc: Element, table: StyleDef[], notes: Note[], sizes: Map<number, number>): TableCell {
    type Paragraph = { text: string; html: string; align?: "center" | "right" | null; indent?: number };
    const paragraphs: Paragraph[] = [];
    const marks: (Span & { note: Note })[] = [];
    // The cell's text is its paragraphs with words, a space between two:
    // where each paragraph's words start in it.
    let length = 0;
    const add = (paragraph: Paragraph): number => {
      paragraphs.push(paragraph);
      if (!paragraph.text) return length;
      const start = length > 0 ? length + 1 : 0;
      length = start + paragraph.text.length;
      return start;
    };
    const read = (container: Element) => {
      for (const node of container.children) {
        if (node.localName === "tbl") {
          for (const tr of children(node, "tr")) for (const inner of cellsOf(tr)) read(inner);
          continue;
        }
        if (node.localName === "sdt") read(child(node, "sdtContent") ?? node);
        if (node.localName !== "p") continue;
        const props = paraProps(child(node, "pPr"), this.styles, table);
        const numbered = props.numId ? this.numbering.next(props.numId, props.ilvl) : null;
        let marker = numbered?.marker ?? null;
        const align = props.align === "center" || props.align === "right" ? props.align : null;
        const left = props.ownLeft ?? numbered?.left ?? props.left;
        const indent = left > 0 && left < 100_000 ? points(left) : 0;
        for (const piece of this.pieces(node, props.base, this.rels)) {
          if (piece.kind === "figure") {
            const images = piece.pictures.map((pic) => `<img src="${escapeHtml(pic.url)}" alt="${escapeHtml(pic.alt)}" width="${Math.max(1, Math.min(4000, Math.round(pic.widthEmu / EMU_PER_PX)))}">`);
            add({ text: "", html: images.join("") });
          } else if (piece.kind === "math") {
            add({ text: piece.text, html: escapeHtml(piece.text) });
          } else if (piece.kind === "words" && !piece.line.empty) {
            if (marker) piece.line.prepend(`${marker} `);
            marker = null;
            const words = piece.line.finish(false);
            const flat = { ...words, text: words.text.replace(/\n/g, " ") };
            notes.push(...words.notes.map((n) => n.note));
            tallySizes(words, sizes);
            const start = add({ text: flat.text, html: inlineHtml(flat), align, indent });
            marks.push(...moveSpans(words.notes, start));
          }
        }
      }
    };
    read(tc);
    // One plain paragraph is the cell's words; more, or one set centered,
    // flush right, or in, are paragraphs, a space between two with words so
    // the words stay apart in the text.
    const text = paragraphs.map((p) => p.text).filter(Boolean).join(" ");
    const fill = shadeColor(child(child(tc, "tcPr"), "shd"));
    const plain = paragraphs.length === 1 && !paragraphs[0].align && !paragraphs[0].indent;
    const borders = cellBorders(tc);
    if (plain) return { html: paragraphs[0].html, text, colspan: 1, rowspan: 1, notes: marks, fill, borders };
    let seen = false;
    const html = paragraphs
      .map((p) => {
        const gap = p.text && seen ? `<span class="cell-gap"> </span>` : "";
        seen ||= Boolean(p.text);
        const css = [p.indent ? `margin-left:${p.indent}pt` : "", p.align ? `text-align:${p.align}` : ""].filter(Boolean).join(";");
        const attrs = `${p.indent ? ` data-indent-left="${p.indent}"` : ""}${css ? ` style="${css}"` : ""}`;
        return `${gap}<p${attrs}>${p.html}</p>`;
      })
      .join("");
    return { html, text, colspan: 1, rowspan: 1, notes: marks, fill, borders };
  }
}

/** A row's cells, through the content controls and custom markup around them. */
function cellsOf(tr: Element): Element[] {
  const out: Element[] = [];
  for (const c of tr.children) {
    if (c.localName === "tc") out.push(c);
    else if (c.localName === "sdt") out.push(...cellsOf(child(c, "sdtContent") ?? c));
    else if (c.localName === "customXml") out.push(...cellsOf(c));
  }
  return out;
}

/** Does the table's look turn its style's first-row formatting on
    (tblLook w:firstRow, or bit 0x0020 of the older hex w:val)? */
function tableLooksFirstRow(tblPr: Element | null): boolean {
  const look = child(tblPr, "tblLook");
  if (!look) return true;
  const first = attr(look, "firstRow");
  if (first !== null) return first === "1" || first === "true" || first === "on";
  const hex = parseInt(attr(look, "val") ?? "", 16);
  return Number.isFinite(hex) ? (hex & 0x20) !== 0 : true;
}

// ── Captions, the title, links ──────────────────────────────────────────────

const FIGURE_LABEL = /^(?:figure|fig\.?|chart|graph|diagram|image|photo|picture|illustration|plate|exhibit|scheme|图)\s*\d/i;
const TABLE_LABEL = /^(?:table|tab\.|表)\s*\d/i;

/** Is the block a caption for a figure or a table: a paragraph in the
    Caption style, or one that opens with the kind's label ("Figure 3",
    "Table 2")? */
function isCaption(block: ParsedBlock | undefined, kind: "figure" | "table"): boolean {
  if (!block || block.type !== "PARAGRAPH" || block.footnote) return false;
  const text = block.text.trim();
  if (!text || text.length > 400) return false;
  const styled = /^<p class="[^"]*\bcaption\b/.test(block.html ?? "");
  const [own, other] = kind === "figure" ? [FIGURE_LABEL, TABLE_LABEL] : [TABLE_LABEL, FIGURE_LABEL];
  return own.test(text) || (styled && !other.test(text));
}

/** A caption paragraph beside its figure or table joins it: a figure's
    caption is its words (under the picture), a table's opens its text and
    stands in its <caption>. A figure looks below itself first (Word's
    default), a table above. The note marks move with the words. */
function attachCaptions(blocks: ParsedBlock[], noteRefs: DocxReader["noteRefs"]): ParsedBlock[] {
  const taken = new Set<ParsedBlock>();
  blocks.forEach((block, i) => {
    if (block.type === "FIGURE" && !block.text) {
      const caption = [blocks[i + 1], blocks[i - 1]].find((b) => b && !taken.has(b) && isCaption(b, "figure"));
      if (!caption) return;
      taken.add(caption);
      block.text = caption.text;
      block.html = (block.html ?? "<figure></figure>").replace(/<\/figure>$/, `<figcaption>${escapeHtml(caption.text)}</figcaption></figure>`);
      const refs = noteRefs.get(caption);
      if (refs) noteRefs.set(block, refs);
    } else if (block.type === "TABLE" && block.html?.startsWith("<table") && !block.html.includes("<caption>")) {
      const caption = [blocks[i - 1], blocks[i + 1]].find((b) => b && !taken.has(b) && isCaption(b, "table"));
      if (!caption) return;
      taken.add(caption);
      const words = { text: caption.text, marks: (caption.styles ?? []).map((s) => ({ start: s.start, end: s.end, style: s.style })), links: [], math: caption.math ?? [] };
      block.html = block.html.replace(/^<table([^>]*)>/, `<table$1><caption>${inlineHtml(words)}${textGap("\n")}</caption>`);
      block.text = `${caption.text}\n${block.text}`;
      const refs = [...(noteRefs.get(caption) ?? []), ...moveSpans(noteRefs.get(block) ?? [], caption.text.length + 1)];
      if (refs.length > 0) noteRefs.set(block, refs);
    }
  });
  return blocks.filter((b) => !taken.has(b));
}

/** The document's title: its first Title paragraph among the opening
    blocks; else, before the first heading, a short line set well above the
    body size (a cover page's name) — the PDF parse's rule. */
function titleOf(reader: DocxReader, blocks: ParsedBlock[]): ParsedBlock | null {
  const opening = blocks.slice(0, TITLE_REACH);
  const styled = opening.find((b) => reader.titles.has(b));
  if (styled) return styled;
  let body = 0;
  let most = 0;
  for (const [size, n] of reader.bodySizes) if (n > most) [body, most] = [size, n];
  let best: ParsedBlock | null = null;
  let bestSize = body * TITLE_SIZE_RATIO;
  for (const block of opening) {
    if (block.type !== "PARAGRAPH") break;
    const size = reader.sizes.get(block) ?? 0;
    const text = block.text.trim();
    if (!block.footnote && size >= bestSize && size > 0 && text.length > 2 && text.length <= 120 && !text.includes("\n")) {
      if (best && size === bestSize) continue;
      best = block;
      bestSize = size;
    }
  }
  return best;
}

/** The document properties' title, when the file has one. */
function coreTitle(zip: OfficeZip): string | null {
  const core = parseXmlPart(zip, "docProps/core.xml");
  const title = core ? descendants(core, "title")[0]?.textContent?.trim() : "";
  return title ? cleanText(title) : null;
}

const HIDDEN_PARTS = new Set(["del", "moveFrom", "Fallback"]);

/** Every picture the body shows, stored once: its zip path → its URL. A
    picture the reader cannot draw (EMF, WMF, TIFF) is not stored. */
async function storePictures(zip: OfficeZip, doc: XMLDocument, rels: Rels, opts: DocxParseOptions): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const blip of descendants(doc, "blip")) {
    if (inside(blip, HIDDEN_PARTS)) continue;
    for (const id of [attr(blip, "embed"), attr(descendants(blip, "svgBlip")[0] ?? null, "embed")]) if (id) ids.add(id);
  }
  for (const data of descendants(doc, "imagedata")) {
    const id = attr(data, "id") ?? attr(data, "relid");
    if (id && !inside(data, HIDDEN_PARTS)) ids.add(id);
  }
  const out = new Map<string, string>();
  for (const id of ids) {
    const rel = rels.get(id);
    if (!rel || rel.external || out.has(rel.target)) continue;
    const bytes = zip.get(rel.target);
    const mime = IMAGE_MIME[rel.target.slice(rel.target.lastIndexOf(".") + 1).toLowerCase()];
    if (!bytes || !mime) continue;
    try {
      const url = await opts.storeImage(bytes, mime);
      if (url) out.set(rel.target, url);
    } catch (err) {
      console.warn("[docx] picture not stored:", err);
    }
  }
  return out;
}

// ── Entry ───────────────────────────────────────────────────────────────────

export async function parseDocx(bytes: Uint8Array, filename: string, opts: DocxParseOptions): Promise<DocxParse> {
  const zip = unzipOffice(bytes);
  const docPath = officeDocumentPath(zip) ?? "word/document.xml";
  const doc = parseXmlPart(zip, docPath);
  const body = doc ? descendants(doc, "body")[0] : undefined;
  if (!doc || !body) throw new Error(`Not a Word file: ${docPath} is missing`);
  const rels = partRels(zip, docPath);
  const pictures = await storePictures(zip, doc, rels, opts);
  const reader = new DocxReader(zip, rels, readStyles(zip, rels), pictures, child(body, "sectPr"));
  reader.body(body);
  reader.close();

  let blocks = attachCaptions(reader.blocks, reader.noteRefs);
  const titleBlock = titleOf(reader, blocks);
  if (titleBlock) blocks = blocks.filter((b) => b !== titleBlock);

  // A contents field with no entries lists the headings at its levels, each
  // linked to its heading, as Word draws it on update; with no heading to
  // list it stands for nothing.
  const levelOf = (b: ParsedBlock) => (b.type === "HEADING" ? Number(/^<h([1-6])/.exec(b.html ?? "")?.[1] ?? 0) : 0);
  const listed = ([lo, hi]: [number, number]) => (b: ParsedBlock) => levelOf(b) >= lo && levelOf(b) <= hi && !reader.unlisted.has(b);
  for (const { block, levels } of reader.unfilledContents) if (!blocks.some(listed(levels))) blocks = blocks.filter((b) => b !== block);
  for (const { block, levels } of reader.unfilledContents) {
    const lines: string[] = [];
    const links: LinkSpan[] = [];
    let at = 0;
    blocks.forEach((b, i) => {
      if (!listed(levels)(b)) return;
      const indent = "  ".repeat(levelOf(b) - levels[0]);
      const words = b.text.replace(/\s+/g, " ").trim();
      links.push({ start: at + indent.length, end: at + indent.length + words.length, quotedText: words, targetOrder: i });
      lines.push(indent + words);
      at += indent.length + words.length + 1;
    });
    block.text = lines.join("\n");
    if (links.length > 0) block.links = links;
  }
  // A space after is the gap to the text block under the block (its notes
  // aside): none where a caption joined the table or figure under it.
  let under: ParsedBlock | undefined;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.spaceAfter !== undefined && !(under && (under.type === "PARAGRAPH" || under.type === "HEADING" || under.type === "LIST"))) delete b.spaceAfter;
    if (!b.footnote) under = b;
  }

  // Links to places in the document point at the blocks those places are
  // in; a contents entry with no link names its heading by its words.
  const order = new Map(blocks.map((b, i) => [b, i]));
  for (const { block, link, anchor } of reader.anchorLinks) {
    const target = reader.bookmarkBlocks.get(anchor);
    const at = target ? order.get(target) : undefined;
    if (at !== undefined && at !== order.get(block)) link.targetOrder = at;
    else block.links = block.links?.filter((l) => l !== link);
  }
  const headings = new Map<string, number>();
  const key = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  blocks.forEach((b, i) => {
    if (b.type === "HEADING" && !headings.has(key(b.text))) headings.set(key(b.text), i);
  });
  for (const { block, start, end } of reader.contentsLines) {
    if (block.links?.some((l) => l.start < end && l.end > start)) continue;
    const at = headings.get(key(block.text.slice(start, end)));
    if (at === undefined) continue;
    (block.links ??= []).push({ start, end, quotedText: block.text.slice(start, end), targetOrder: at });
  }
  for (const block of blocks) if (block.links?.length === 0) delete block.links;
  for (const [block, refs] of reader.noteRefs) {
    const footnoteRefs: FootnoteRef[] = refs.flatMap((ref) => {
      const at = order.get(ref.note.block);
      return at === undefined || ref.end <= ref.start ? [] : [{ start: ref.start, end: ref.end, targetOrder: at }];
    });
    if (footnoteRefs.length > 0) block.footnoteRefs = footnoteRefs;
  }

  const own = titleBlock ? titleBlock.text.replace(/\s+/g, " ").trim() : null;
  const parsed: DocxParse = { title: own ?? coreTitle(zip) ?? filename.replace(/\.docx$/i, ""), blocks, titleFromFile: own === null };
  // The look the import's named styles take (decision 2 of the parse loop's
  // round 2): Normal text is the look most of the body's words take, the
  // PDF parse's rule (lib/parse/pdf/look.ts), and the Title the title
  // paragraph's own.
  const bodyFont = takeBodyFont(blocks);
  if (bodyFont) parsed.bodyFont = bodyFont;
  // A table's text size stays only where it differs from the body's.
  const bodySize = bodyFont ? `<table style="font-size:${bodyFont.size}pt">` : null;
  for (const b of blocks) if (bodySize && b.type === "TABLE" && b.html?.startsWith(bodySize)) b.html = `<table>${b.html.slice(bodySize.length)}`;
  if (titleBlock?.font) parsed.titleFont = titleBlock.font;
  const tokens = /^<[a-z0-9]+ class="([^"]*)"/.exec(titleBlock?.html ?? "")?.[1].split(" ") ?? [];
  const titleAlign = tokens.find((t): t is "center" | "right" => t === "center" || t === "right");
  if (titleAlign) parsed.titleAlign = titleAlign;
  return parsed;
}
