import type { DocStyle } from "@/components/docs/extensions";
import { listFormat, sameLevel } from "@/components/docs/toolbar/lists";
import { DEFAULT_STYLES, STYLE_ATTR, styleChanges, type NamedStyle } from "@/components/docs/toolbar/styles";
import {
  DEFAULT_PAGE_SETUP,
  formatParts,
  INDEXED_NODE_TYPES,
  MAX_CAPTION_CHARS,
  newBlockId,
  sanitizeRichText,
  ZWSP,
  type ListCounter,
  type ListLevel,
  type PageSetup,
  type RichMark,
  type RichNode,
} from "@/lib/docs/schema";
import {
  clip,
  inlineNodes,
  keptHref,
  paragraphNode,
  sizedAtMost,
  tableFromHtml,
  tableFromText,
  type CellNotes,
  type Piece,
} from "@/lib/docs/import-table";
import type { PageStart, ParsedBlock, StyleSpan, TextFont } from "@/lib/parse/types";
import type { Region } from "@/lib/video/types";

// The converter (SPEC.md §29): an import — a PDF, a web page, a Markdown or
// text file, or a Word file — becomes the page editor's rich text at import,
// one code path for the four parses. The Block rows are then the paragraph
// index of this rich text (lib/docs/blocks.ts deriveBlocks), never the
// parse's own rows, so the first save changes only what the reader changed.
//
// What each parse block becomes:
//   PARAGRAPH  a paragraph; "\n" a line break; its layout tokens the page
//              editor's own formats: kicker and label small, caption small
//              and centered, display large, meta the Subtitle, quote inside
//              a blockquote, center and right the alignment, an indent
//              (first-line, hanging, block) the paragraph's indents
//   HEADING    a heading of its level; one that repeats the title is the Title
//   LIST       lists from the marker lines, nested two spaces a level, the
//              markers drawn by the list (a Markdown task line a checklist
//              line); a contents list is one paragraph per entry, each entry
//              a link to its heading
//   TABLE      a table (lib/docs/import-table.ts)
//   CODE       a code block        EQUATION  an equation on its own line
//   SEPARATOR  a horizontal line   FIGURE    a figure object, its media a
//                                            FigureMedia row (the figures)
// Inside the words, the parse's styles become marks (a lowered or raised run
// subscript or superscript; a color, a highlight, a face, and a size the
// text style), and an inline formula becomes an inline equation of its TeX
// in place of its readable characters. The page's look (a PDF's, a Word
// file's: ParsedBlock.font, bodyFont, titleFont) sets the named styles —
// Normal text the body's face and size, the Title and each heading level
// theirs — and a block or a run set otherwise carries a mark only where it
// differs from its style.
// A footnote (ParsedBlock.footnote) whose reference the parse found is the
// page editor's own: its number in place of the label in the text, its words
// in the footnotes at the document's end. One without a reference stays a
// small paragraph where it stands, its label as words.
// The title, when it came from the original, is a Title paragraph after the
// kicker. A PDF opens in pages at its first page's size, with a page start
// where each of its pages begins; a web page, a text file, and a Word file
// are pageless.
// It loads with the parse chain and the page editor's list presets
// (components/docs/toolbar/lists.ts); import-table.ts reads html with jsdom.

export type ImportKind = "pdf" | "url" | "markdown" | "docx";

/** A figure object's media: its FigureMedia row takes mediaId as its id. */
export type ImportFigure = {
  mediaId: string;
  html: string | null;
  caption: string;
  page: number | null;
  region: Region | null;
};

export type ImportInput = {
  kind: ImportKind;
  /** The document's title, and whether it came from the original (a PDF's
      title, the page's title, the front matter) rather than from a file
      name or an address. */
  title: string | null;
  titleFromOriginal: boolean;
  blocks: ParsedBlock[];
  /** A PDF's first page, in points. */
  pageSize?: { width: number; height: number };
  /** The page's look (a PDF's, a Word file's): the body's (Normal text),
      and the title's with its alignment (the Title). */
  bodyFont?: TextFont;
  titleFont?: TextFont;
  titleAlign?: "center" | "right";
};

export type ImportResult = {
  richText: RichNode;
  /** The figure objects' media, in reading order. */
  figures: ImportFigure[];
  pageSetup: PageSetup;
  /** For the size guard: the rich text's nodes, its JSON in UTF-8 bytes,
      and the rows its paragraph index derives. */
  size: { nodes: number; json: number; rows: number };
};

/** Words, the marks over them (offsets into the words), the page starts
    inside them (where each page of the PDF begins, lib/parse/pdf), and the
    words the page editor holds as one inline node. */
type Source = { text: string; spans: { start: number; end: number; mark: RichMark }[]; starts: PageStart[]; atoms?: Atom[] };
/** Words the page editor holds as one inline node: an inline equation in
    place of a formula's readable characters. The node takes the place of
    start..end whole: no mark and no page start falls inside it. */
type Atom = { start: number; end: number; node: RichNode };

/** The space after a paragraph of the body, in points: Google Docs' "Add
    space after paragraph". Normal text has none, and an article without it
    reads as one wall of words. A PDF's paragraphs take the page's own
    (ParsedBlock.spaceAfter). */
const PARAGRAPH_SPACE_PT = 10;
/** A small line (the kicker, a label, a caption) and a display line, as
    text sizes. */
const SMALL_SIZE = "9pt";
const DISPLAY_SIZE = "21pt";
/** One indent step, as the page editor's (components/docs/extensions.ts). */
const INDENT_PT = 36;
/** The most words one text node may hold (lib/docs/schema.ts richNodeSchema). */
const MAX_TEXT = 200_000;
/** The longest equation the rich text keeps as an equation (an attribute's
    string, lib/docs/schema.ts); a longer one is a code block of its TeX. */
const MAX_LATEX = 2000;
/** A heading that repeats the title stands within the first blocks. */
const TITLE_REACH = 12;
/** The pageless text column at its narrowest, in px (components/docs/page/
    geometry.ts pagelessWidth): a table fitted to it fits every column. */
const PAGELESS_COLUMN_PX = 600;

const ROLES = ["kicker", "meta", "label", "display", "quote", "caption", "footnote"] as const;
type Role = (typeof ROLES)[number];

// A paragraph's indent as the parse measured it (lib/parse/pdf: a class
// token on its html), as the page editor's indents: one step, half an inch,
// as Tab and Increase indent move a line. Under a hanging indent the first
// line stands at the edge and the others a step in, as Docs stores it.
const INDENT_TOKENS = ["indent-first", "indent-hanging", "indent-block"] as const;
const INDENTS: Record<(typeof INDENT_TOKENS)[number], Record<string, number>> = {
  "indent-first": { indentFirstLine: INDENT_PT },
  "indent-hanging": { indentLeft: INDENT_PT, indentFirstLine: -INDENT_PT },
  "indent-block": { indentLeft: INDENT_PT },
};

function tokensOf(html: string | undefined): string[] {
  const m = /^<[a-z][a-z0-9]*\b[^>]*\bclass="([^"]*)"/i.exec(html ?? "");
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

function alignOf(tokens: string[]): "center" | "right" | "justify" | null {
  return tokens.includes("center") ? "center" : tokens.includes("right") ? "right" : tokens.includes("justify") ? "justify" : null;
}

function headingLevel(html: string | undefined): number {
  return Number(/^<h([1-6])/i.exec(html ?? "")?.[1] ?? 2);
}

const sameWords = (a: string, b: string) =>
  a.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim() === b.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

// ── Words and their marks ───────────────────────────────────────────────────

/** The part of a source between two offsets, with the page starts from
    `from` up to `to` (up to and at `to` when the part runs to the source's
    end). `head` also keeps the starts before `from`, at the part's start:
    a page that begins at a list line's marker begins at its words. */
function sliceSource(src: Source, from: number, to: number, head = false): Source {
  const end = to >= src.text.length;
  return {
    text: src.text.slice(from, to),
    spans: src.spans
      .filter((s) => s.end > from && s.start < to)
      .map((s) => ({ start: Math.max(from, s.start) - from, end: Math.min(to, s.end) - from, mark: s.mark })),
    starts: src.starts
      .filter((p) => (p.offset >= from || head) && (p.offset < to || (end && p.offset <= to)))
      .map((p) => ({ offset: Math.max(0, p.offset - from), page: p.page })),
    // An atom cut by the part's edge stays words.
    atoms: src.atoms?.filter((a) => a.start >= from && a.end <= to).map((a) => ({ start: a.start - from, end: a.end - from, node: a.node })),
  };
}

/** A source's lines ("\n"). A page that begins at a line break begins with
    the next line. */
function linesOf(src: Source): Source[] {
  const bounds: { from: number; to: number }[] = [];
  for (let from = 0; ; ) {
    const at = src.text.indexOf("\n", from);
    bounds.push({ from, to: at < 0 ? src.text.length : at });
    if (at < 0) break;
    from = at + 1;
  }
  const lines = bounds.map(({ from, to }) => ({ ...sliceSource(src, from, to), starts: [] as PageStart[] }));
  for (const p of src.starts) {
    let k = bounds.findIndex(({ from, to }) => p.offset >= from && p.offset <= to);
    if (k < 0) k = bounds.length - 1;
    if (p.offset === bounds[k].to && k < bounds.length - 1) k += 1;
    lines[k].starts.push({ offset: Math.max(0, p.offset - bounds[k].from), page: p.page });
  }
  return lines;
}

/** A long text in parts of at most MAX_TEXT, cut at a space. */
function splitLong(src: Source): Source[] {
  if (src.text.length <= MAX_TEXT) return [src];
  const parts: Source[] = [];
  for (let from = 0; from < src.text.length; ) {
    let to = Math.min(src.text.length, from + MAX_TEXT);
    if (to < src.text.length) {
      const space = src.text.lastIndexOf(" ", to - 1);
      to = space > from ? space + 1 : clip(src.text.slice(from, to + 1), to - from).length + from;
    }
    parts.push(sliceSource(src, from, to));
    from = to;
  }
  return parts;
}

/** The inline nodes of a source: its words cut where a mark begins or ends,
    a page start where a page begins, an atom's node in place of its words,
    `extra` marks on every word. */
function inline(src: Source, extra: RichMark[] = []): RichNode[] {
  const { text } = src;
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const spans = src.spans.filter((s) => clamp(s.end) > clamp(s.start));
  const atoms = (src.atoms ?? []).filter((a) => clamp(a.end) > clamp(a.start));
  // Two page starts at one place: the later page's words begin there. A
  // page that begins inside an atom begins at its start.
  const starts = new Map<number, number>();
  for (const p of src.starts) {
    const at = clamp(p.offset);
    const place = atoms.find((a) => a.start < at && at < a.end)?.start ?? at;
    starts.set(place, Math.max(p.page, starts.get(place) ?? 0));
  }
  const cuts = new Set<number>([0, text.length, ...starts.keys()]);
  for (const s of [...spans, ...atoms]) {
    cuts.add(clamp(s.start));
    cuts.add(clamp(s.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces: Piece[] = [];
  points.forEach((at, k) => {
    const page = starts.get(at);
    if (page !== undefined) pieces.push({ node: { type: "pageStart", attrs: { page } } });
    const next = points[k + 1];
    if (next === undefined || next === at) return;
    // An atom's words are its node, placed once at its start; a mark's edge
    // inside it cuts nothing.
    const atom = atoms.find((a) => a.start <= at && at < a.end);
    if (atom) {
      if (atom.start === at) pieces.push({ node: atom.node });
      return;
    }
    const own = spans.filter((s) => s.start <= at && s.end >= next).map((s) => s.mark);
    // A code run takes no text style (a footnote's size): the page editor's
    // code mark holds no other mark, and the text style took its place.
    const code = own.some((m) => m.type === "code");
    const marks = oneTextStyle([...extra, ...own].filter((m) => !code || m.type !== "textStyle"));
    pieces.push({ text: text.slice(at, next), marks });
  });
  return inlineNodes(pieces);
}

/** The page editor's mark for each plain style of the parse
    (lib/parse/types.ts StyleSpan): a lowered or raised run is Docs'
    subscript or superscript. */
const STYLE_MARKS: Partial<Record<StyleSpan["style"], string>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  code: "code",
  smallCaps: "smallCaps",
  sub: "subscript",
  sup: "superscript",
};

/** A run's text styles as the one the page editor holds: its face, size,
    color, and highlight together, a later one over an earlier one (a run's
    own color over its block's). */
function oneTextStyle(marks: RichMark[]): RichMark[] {
  const styles = marks.filter((m) => m.type === "textStyle");
  if (styles.length < 2) return marks;
  const attrs = Object.assign({}, ...styles.map((m) => m.attrs ?? {})) as Record<string, unknown>;
  return [...marks.filter((m) => m.type !== "textStyle"), { type: "textStyle", attrs }];
}

/** The page editor's mark for a style of the parse: a plain style's mark,
    or the text style's face, size, color, or highlight. A run's face and
    size differ from its block's (the parse marks no other); a color the
    block's named style gives already is none. */
function styleMark(style: StyleSpan["style"], named: NamedStyle): RichMark | null {
  const plain = STYLE_MARKS[style];
  if (plain) return { type: plain };
  const at = style.indexOf(":");
  const [kind, value] = [style.slice(0, at), style.slice(at + 1)];
  if (kind === "color") return value === named.color ? null : { type: "textStyle", attrs: { color: value } };
  if (kind === "highlight") return { type: "textStyle", attrs: { backgroundColor: value } };
  if (kind === "font") return { type: "textStyle", attrs: { fontFamily: value } };
  if (kind === "size") return Number(value) > 0 ? { type: "textStyle", attrs: { fontSize: `${Number(value)}pt` } } : null;
  return null;
}

/** The named styles an import's look sets, as "Update 'Heading 1' to match"
    sets them (SPEC.md §29 Named styles): Normal text takes the body's face,
    size, and color; the Title the title's look; each heading level the look
    most of its headings' letters take (a document of 11 pt bold headings
    drew them 20 pt regular). A face a style shares with Normal text is
    Normal text's. The styles the page gives nothing keep Docs' defaults. */
function styleLooks(input: ImportInput): Partial<Record<DocStyle, NamedStyle>> {
  const looks: Partial<Record<DocStyle, NamedStyle>> = {};
  const body = input.bodyFont;
  if (body) looks.normal = { ...DEFAULT_STYLES.normal, font: body.family, size: body.size, color: body.color ?? "#000000" };
  const normalFace = looks.normal?.font ?? DEFAULT_STYLES.normal.font;
  const lookOf = (style: DocStyle, font: TextFont): NamedStyle => ({
    ...DEFAULT_STYLES[style],
    font: font.family === normalFace ? null : font.family,
    size: font.size,
    color: font.color ?? "#000000",
    bold: font.bold === true,
    italic: font.italic === true,
  });
  if (input.titleFont) looks.title = lookOf("title", input.titleFont);
  const tally = new Map<DocStyle, Map<string, { font: TextFont; n: number }>>();
  for (const b of input.blocks) {
    if (b.type !== "HEADING" || !b.font) continue;
    const style = `h${Math.min(6, Math.max(1, headingLevel(b.html)))}` as DocStyle;
    const counts = tally.get(style) ?? new Map<string, { font: TextFont; n: number }>();
    const key = JSON.stringify([b.font.family, b.font.size, b.font.color ?? "", b.font.bold === true, b.font.italic === true]);
    counts.set(key, { font: b.font, n: (counts.get(key)?.n ?? 0) + b.text.length });
    tally.set(style, counts);
  }
  // Where the page's spacing is measured, the gap before a heading is the
  // space after the block above it (ParsedBlock.spaceAfter), no more.
  const spaced = input.blocks.some((b) => b.spaceAfter !== undefined);
  for (const [style, counts] of tally) {
    const top = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    looks[style] = { ...lookOf(style, top.font), ...(spaced ? { spaceBefore: 0 } : {}) };
  }
  return looks;
}

/** A block's inline formulas (ParsedBlock.math) as inline equations, each in
    place of its readable characters. A formula a save would not keep as an
    equation (no TeX, or TeX past MAX_LATEX: an attribute's limit), or one
    that overlaps the one before it, stays words. */
function mathAtoms(block: ParsedBlock): Atom[] {
  const atoms: Atom[] = [];
  for (const m of [...(block.math ?? [])].sort((a, b) => a.start - b.start)) {
    const latex = m.latex.trim();
    if (!latex || latex.length > MAX_LATEX || m.start < (atoms.at(-1)?.end ?? 0) || m.end <= m.start || m.end > block.text.length) continue;
    atoms.push({ start: m.start, end: m.end, node: { type: "inlineMath", attrs: { latex } } });
  }
  return atoms;
}

// ── Lists ───────────────────────────────────────────────────────────────────

// A list line's marker, after its indent, as the parse keeps it printed: a
// bullet ("-", "•", "◦", "▪", "–", "➢", "✓"), a checklist box ("☐", and "☑"
// or "☒" checked), or a counter and the words around it: "1." "1)" "(1)"
// "a)." "(iv)" "I." "A-1." "[12]", a number alone (an exercise's "15" or
// "*15"), or a legal number ("2.3.1": the numbers above its own before it).
// Any other line start is words. A counter draws as the page prints it: the
// outermost list's level at the line's depth takes the counter's glyph
// format ("(a)" one level in is Google Docs' "(%1)"; components/docs/
// toolbar/lists.ts), and the list keeps a preset when one draws every level
// so, else its own levels. Round 1 drew the presets' markers ("a)." as
// "a)", "15" as "15.", "[12]" as "12.").
const LIST_BULLET = /^[-*•▪◦‣●·∙○■□◆❖➢➤►✓✔–—](?: +|$)/;
const LIST_BOX = /^([☐☑☒])(?: +|$)/;
const LIST_LEGAL = /^((?:\d{1,3}\.)+)(\d{1,3})(\.?)(?: +|$)/;
const LIST_PAREN = /^\(([a-zA-Z]{1,5}|\d{1,3})\)(?: +|$)/;
const LIST_CITE = /^\[(\d{1,3})\](?: +|$)/;
const LIST_CLOSED = /^((?:[A-Z]{1,2}-)?)([a-zA-Z]{1,5}|\d{1,3})(\)\.?|\.\)?)(?: +|$)/;
const LIST_NUMBER = /^(\*?)(\d{1,3})(?: +|$)/;
// A task line's box after its bullet (lib/parse/markdown-document.ts).
const TASK_BOX = /^([☐☑☒]) /;
const ROMAN_NUMERAL = /^(x{0,3})(ix|iv|v?i{0,3})$/;

type ListType = "bulletList" | "orderedList" | "taskList";
/** A counter's style and number. */
type Count = { counter: ListCounter; value: number };

type ListLine = {
  depth: number;
  /** The depth the indent gives, for a list drawn as paragraphs. */
  indent: number;
  /** The list the line belongs to; null when its start is no marker. */
  type: ListType | null;
  checked: boolean;
  /** A bullet's glyph as the line prints it. */
  bullet?: string;
  /** A counter, the words before and after it, and a legal number's
      numbers above its own. */
  count?: Count & { before: string; after: string; parents?: number[] };
  /** A numeral of one letter ("(i)", "v.") read as a letter: the list it
      goes on when the letter follows ("(h)" then "(i)"). */
  letter?: Count;
  /** The level the line draws at its depth, once the depths are known. */
  level?: ListLevel;
  /** The words after the marker; `whole` keeps the marker. */
  words: Source;
  whole: Source;
  /** The line's paragraph once made, and the blocks its item holds after
      it (the lines between a list and its resumed items). */
  node?: RichNode;
  more?: RichNode[];
};

/** A counter's style and number: "12" decimal 12, "03" 3 with its zero,
    "c" lower-alpha 3, "iv" lower-roman 4, "IV" upper-roman 4. */
function countOf(token: string): Count | null {
  if (/^\d+$/.test(token)) return { counter: /^0\d$/.test(token) ? "decimal-leading-zero" : "decimal", value: Number(token) };
  const lower = token.toLowerCase();
  const upper = token === token.toUpperCase();
  if (token !== lower && !upper) return null;
  const numeral = ROMAN_NUMERAL.exec(lower);
  if (numeral) {
    const value = numeral[1].length * 10 + ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"].indexOf(numeral[2]);
    return { counter: upper ? "upper-roman" : "lower-roman", value };
  }
  return token.length === 1 ? { counter: upper ? "upper-alpha" : "lower-alpha", value: lower.charCodeAt(0) - 96 } : null;
}

/** The counter a line starts with: its characters, and the words around it. */
function counterAt(text: string): { length: number; token: string; before: string; after: string } | null {
  let m: RegExpExecArray | null;
  if ((m = LIST_PAREN.exec(text))) return { length: m[0].length, token: m[1], before: "(", after: ")" };
  if ((m = LIST_CITE.exec(text))) return { length: m[0].length, token: m[1], before: "[", after: "]" };
  // A prefix ("A-1.", an exhibit's items) comes before a number only.
  if ((m = LIST_CLOSED.exec(text)) && (!m[1] || /^\d+$/.test(m[2]))) return { length: m[0].length, token: m[2], before: m[1], after: m[3] };
  if ((m = LIST_NUMBER.exec(text))) return { length: m[0].length, token: m[2], before: m[1], after: "" };
  return null;
}

function listLine(line: Source): ListLine {
  const indent = /^ */.exec(line.text)?.[0].length ?? 0;
  const whole = sliceSource(line, indent, line.text.length, true);
  const out: ListLine = { depth: Math.floor(indent / 2), indent: Math.floor(indent / 2), type: null, checked: false, words: whole, whole };
  const text = whole.text;
  let m: RegExpExecArray | null;
  let cut = 0;
  if ((m = LIST_BOX.exec(text))) {
    out.type = "taskList";
    out.checked = m[1] !== "☐";
    cut = m[0].length;
  } else if ((m = LIST_BULLET.exec(text))) {
    out.type = "bulletList";
    out.bullet = text[0];
    cut = m[0].length;
    const box = TASK_BOX.exec(text.slice(cut));
    if (box) {
      out.type = "taskList";
      out.checked = box[1] !== "☐";
      cut += box[0].length;
    }
  } else if ((m = LIST_LEGAL.exec(text))) {
    out.type = "orderedList";
    out.count = { counter: "decimal", value: Number(m[2]), before: "", after: m[3], parents: m[1].slice(0, -1).split(".").map(Number) };
    cut = m[0].length;
  } else {
    const found = counterAt(text);
    const count = found && countOf(found.token);
    if (!found || !count) return out;
    out.type = "orderedList";
    out.count = { ...count, before: found.before, after: found.after };
    if (/^[ivx]$/i.test(found.token)) {
      out.letter = { counter: count.counter === "upper-roman" ? "upper-alpha" : "lower-alpha", value: found.token.toLowerCase().charCodeAt(0) - 96 };
    }
    cut = found.length;
  }
  out.words = sliceSource(whole, cut, whole.text.length, true);
  return out;
}

/** A printed bullet as the page editor draws it: a small hollow or square
    one is Google Docs' own (○ ■), any other as printed but "•", which is
    any bullet (the parse writes it where the page draws one the text does
    not hold, and for a Word file's round one): the level's own. */
const BULLET_GLYPHS: Record<string, string> = { "◦": "○", "▪": "■" };

/** Each marker's level at its line's depth, in reading order. A bullet the
    parse keeps as printed (`printed`) draws its glyph. A numeral of one
    letter reads as a letter where the line before it at its depth is the
    letter before it ("(h)", "(i)"). A legal number draws the numbers above
    its own from the lines above it when they are those numbers ("1.2"
    under "1.": "%0.%1"), else prints them ("1.2" at the top: "1.%0"). A
    counter whose words the page cannot draw (lib/docs/schema.ts
    formatParts) is no marker. */
function levelsOfLines(lines: ListLine[], printed: boolean): void {
  const open: ListLine[] = [];
  for (const line of lines) {
    const prev = open[line.depth];
    open[line.depth] = line;
    open.length = line.depth + 1;
    if (printed && line.type === "bulletList" && line.bullet && line.bullet !== "•") line.level = { bullet: BULLET_GLYPHS[line.bullet] ?? line.bullet };
    let count = line.count;
    if (!count) continue;
    const k = Math.min(line.depth, 8);
    const [letter, was] = [line.letter, prev?.count];
    if (letter && was && !was.parents && was.counter === letter.counter && was.value + 1 === letter.value && was.before === count.before && was.after === count.after) {
      count = line.count = { ...count, ...letter };
    }
    const parents = count.parents;
    const above = parents?.length === line.depth && line.depth <= 8 && parents.every((n, j) => open[j]?.type === "orderedList" && open[j]?.count?.value === n);
    const format = !parents
      ? `${count.before}%${k}${count.after}`
      : above
        ? `${Array.from({ length: k + 1 }, (_, j) => `%${j}`).join(".")}${count.after}`
        : `${parents.join(".")}.%${k}${count.after}`;
    if (formatParts(format, k)) line.level = { counter: count.counter, format };
    else line.type = null;
  }
}

/** The list a line joins: its type and its level. */
const keyOf = (line: ListLine) => (line.level ? `${line.type} ${JSON.stringify(line.level)}` : String(line.type));

/** The outermost list's levels with the lines' added, by depth; null when
    a line draws its depth otherwise and `strict`, else the first stands. */
function withLevels(seen: (ListLevel | undefined)[], lines: ListLine[], strict: boolean): (ListLevel | undefined)[] | null {
  const out = [...seen];
  for (const line of lines) {
    if (!line.level) continue;
    const k = Math.min(line.depth, 8);
    const had = out[k];
    if (had && !sameLevel(had, line.level)) {
      if (strict) return null;
      continue;
    }
    out[k] = line.level;
  }
  return out;
}

/** An outermost list and the levels its lines draw. */
type Top = { node: RichNode; seen: (ListLevel | undefined)[] };

function listNode(type: ListType, value: number): RichNode {
  return type === "orderedList" && value !== 1 ? { type, attrs: { start: value }, content: [] } : { type, content: [] };
}

/** The lists of the lines from `from` at `depth`: a line of another type or
    level, or a number that does not follow on, starts a new list. At the
    top, so does a line whose lines draw a level otherwise than the list's
    lines so far: a list draws one format a level. `tops` collects each
    outermost list. */
function listsAt(lines: ListLine[], from: number, depth: number, tops?: Top[]): { nodes: RichNode[]; next: number } {
  const nodes: RichNode[] = [];
  let list: RichNode | null = null;
  let key = "";
  let expected = 0;
  let i = from;
  while (i < lines.length && lines[i].depth >= depth) {
    const line = lines[i];
    let end = i + 1;
    while (end < lines.length && lines[end].depth > depth) end++;
    const value = line.count?.value ?? 1;
    const top = tops && list ? tops[tops.length - 1] : undefined;
    const levels = top ? withLevels(top.seen, lines.slice(i, end), true) : null;
    if (!list || keyOf(line) !== key || (line.type === "orderedList" && value !== expected) || (top && !levels)) {
      list = listNode(line.type ?? "bulletList", value);
      nodes.push(list);
      key = keyOf(line);
      tops?.push({ node: list, seen: withLevels([], lines.slice(i, end), false) ?? [] });
    } else if (top && levels) {
      top.seen = levels;
    }
    expected = value + 1;
    const sub = listsAt(lines, i + 1, depth + 1);
    line.node ??= paragraphNode(inline(line.words));
    const content = [line.node, ...(line.more ?? []), ...sub.nodes];
    const item: RichNode =
      line.type === "taskList" ? { type: "taskItem", attrs: { checked: line.checked }, content } : { type: "listItem", content };
    (list.content ??= []).push(item);
    i = sub.next;
  }
  return { nodes, next: i };
}

/** The last paragraph under a node, in reading order. */
function lastParagraph(nodes: RichNode[]): RichNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.type === "paragraph") return node;
    const inner = lastParagraph(node.content ?? []);
    if (inner) return inner;
  }
  return null;
}

/** The first node under these that a link to a place can land in: a
    paragraph, a heading, or a code block (components/docs/insert/links.ts). */
function firstTextblock(nodes: RichNode[]): RichNode | null {
  for (const node of nodes) {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock") return node;
    const inner = firstTextblock(node.content ?? []);
    if (inner) return inner;
  }
  return null;
}

// ── The converter ───────────────────────────────────────────────────────────

class Converter {
  private readonly out: RichNode[] = [];
  private readonly figures: ImportFigure[] = [];
  /** The open blockquote, while quoted paragraphs follow one another. */
  private quote: RichNode | null = null;
  /** The last list block drawn as lists: its lines, and its nodes from
      out[at], for a list that resumes after it. */
  private lastList: { lines: ListLine[]; nodes: RichNode[]; at: number } | null = null;
  /** The last page whose start is placed, and page starts a block could not
      hold, for the next block. */
  private page = 0;
  private carried: PageStart[] = [];
  /** A link's target: the id of the first paragraph a block became, given
      when the link comes before its target. */
  private readonly targets = new Map<number, string>();
  private readonly firstIds = new Map<number, string>();
  private readonly paged: boolean;
  private readonly pageSetup: PageSetup;
  /** The text column's width in px at 100%, the room a table fits in. */
  private readonly room: number;
  /** The footnotes with a reference: each footnote block's id, the numbers
      in place of each citing block's labels, and the footnotes' words. */
  private readonly footnoteIds = new Map<number, string>();
  private readonly numbers = new Map<ParsedBlock, Atom[]>();
  private readonly footnotes = new Map<string, RichNode>();
  /** The numbers at the Title's end, and the mark the first of them stands
      for when the title prints one (linkFootnotes). */
  private readonly titleNotes: RichNode[] = [];
  private titleMark = "";
  /** The named styles the page's look sets (styleLooks). */
  private readonly looks: Partial<Record<DocStyle, NamedStyle>>;
  /** The page's most common space after a paragraph, for a paragraph whose
      own it did not measure (a page's last); null where it measured none
      (a web page, a text file). */
  private readonly spacing: number | null;

  constructor(private readonly input: ImportInput) {
    this.looks = styleLooks(input);
    const counts = new Map<number, number>();
    for (const b of input.blocks) if (b.type === "PARAGRAPH" && b.spaceAfter !== undefined) counts.set(b.spaceAfter, (counts.get(b.spaceAfter) ?? 0) + 1);
    this.spacing = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    this.paged = input.kind === "pdf" && input.blocks.some((b) => typeof b.page === "number");
    this.pageSetup = pageSetupFor(input);
    const { pageless, width, margins } = this.pageSetup;
    this.room = pageless ? PAGELESS_COLUMN_PX : ((width - margins.left - margins.right) * 96) / 72;
    this.linkFootnotes();
  }

  /** Each reference (ParsedBlock.footnoteRefs) becomes the page editor's
      footnote number in place of the label's characters, when it names a
      footnote no reference before it named and stands in words the page
      editor keeps as words (a paragraph's, a heading's, a list's, outside a
      formula). A footnote no reference names stays a paragraph. */
  private linkFootnotes() {
    const { blocks } = this.input;
    blocks.forEach((block) => {
      if (!["PARAGRAPH", "HEADING", "LIST"].includes(block.type) || block.footnote || !block.text.trim()) return;
      const atoms: Atom[] = [];
      for (const ref of [...(block.footnoteRefs ?? [])].sort((a, b) => a.start - b.start)) {
        const inWords = ref.start >= (atoms.at(-1)?.end ?? 0) && ref.end > ref.start && ref.end <= block.text.length;
        const inMath = (block.math ?? []).some((m) => m.start < ref.end && ref.start < m.end);
        if (!blocks[ref.targetOrder]?.footnote || this.footnoteIds.has(ref.targetOrder) || !inWords || inMath) continue;
        const footnoteId = newBlockId();
        this.footnoteIds.set(ref.targetOrder, footnoteId);
        atoms.push({ start: ref.start, end: ref.end, node: { type: "footnoteReference", attrs: { footnoteId } } });
      }
      if (atoms.length > 0) this.numbers.set(block, atoms);
    });
    // The title's own footnotes on a PDF's first page: one whose label ends
    // the title ("…as SAT∗", LaTeX's \thanks; arxiv-2506-06752), and one the
    // page prints no mark for (an acknowledgment; arxiv-2506-08209's read as
    // a paragraph of the body). The title is no block the parse finds a
    // reference in, and the page editor has no footnote without a number:
    // their numbers stand at the Title's end, the mark's in place of it.
    const title = this.input.titleFromOriginal ? (this.input.title ?? "").replace(/\s+/g, " ").trim() : "";
    if (this.input.kind !== "pdf" || !title) return;
    const loose = blocks
      .map((block, index) => ({ label: block.footnote?.label.trim(), index }))
      .filter(({ label, index }) => label !== undefined && (blocks[index].page ?? 1) <= 1 && !this.footnoteIds.has(index) && blocks[index].text.trim());
    const marked = loose.find(({ label }) => label && title.endsWith(label) && /[\p{L})\].,:;!?]$/u.test(title.slice(0, -label.length)));
    if (marked) this.titleMark = marked.label ?? "";
    for (const { index } of [...(marked ? [marked] : []), ...loose.filter(({ label }) => label === "")]) {
      const footnoteId = newBlockId();
      this.footnoteIds.set(index, footnoteId);
      this.titleNotes.push({ type: "footnoteReference", attrs: { footnoteId } });
    }
  }

  /** The Title's words and then the numbers of the footnotes it cites, the
      mark a number stands for left out of the words. */
  private titleContent(content: RichNode[]): RichNode[] {
    const last = content.at(-1);
    const words = last?.type === "text" ? (last.text ?? "").trimEnd() : "";
    if (!this.titleMark || !last || !words.endsWith(this.titleMark)) return [...content, ...this.titleNotes];
    const rest = words.slice(0, -this.titleMark.length);
    return [...content.slice(0, -1), ...(rest ? [{ ...last, text: rest }] : []), ...this.titleNotes];
  }

  /** The footnotes a table's cells cite (a TABLE's footnoteRefs: a Word
      table's note marks, a PDF table's cell that sets a page footnote's
      label), each a footnote that stands after the table and that no
      reference before named. tableFromHtml puts their numbers in the cells. */
  private cellNotes(block: ParsedBlock, index: number): CellNotes & { targets: Map<string, number> } {
    const refs: CellNotes["refs"] = [];
    const targets = new Map<string, number>();
    for (const ref of [...(block.footnoteRefs ?? [])].sort((a, b) => a.start - b.start)) {
      const inWords = ref.start >= (refs.at(-1)?.end ?? 0) && ref.end > ref.start && ref.end <= block.text.length;
      const taken = this.footnoteIds.has(ref.targetOrder) || [...targets.values()].includes(ref.targetOrder);
      if (!this.input.blocks[ref.targetOrder]?.footnote || ref.targetOrder <= index || taken || !inWords) continue;
      const footnoteId = newBlockId();
      refs.push({ start: ref.start, end: ref.end, footnoteId });
      targets.set(footnoteId, ref.targetOrder);
    }
    return { text: block.text, refs, targets };
  }

  run(): ImportResult {
    const { blocks } = this.input;
    const title = this.input.titleFromOriginal ? (this.input.title ?? "").replace(/\s+/g, " ").trim() : "";
    // A heading among the first blocks that repeats the title is the Title,
    // where it stands; else the Title comes first, after the kicker.
    const repeat = title
      ? blocks
          .slice(0, TITLE_REACH)
          .findIndex((b) => b.type === "HEADING" && sameWords(b.text, title) && (!this.paged || (b.page ?? 1) <= 1))
      : -1;
    let lead = 0;
    while (lead < blocks.length && blocks[lead].type === "PARAGRAPH" && tokensOf(blocks[lead].html).includes("kicker")) lead++;
    blocks.forEach((block, i) => {
      if (i === lead && title && repeat < 0) this.title(title, blocks);
      this.block(block, i, i === repeat);
    });
    if (blocks.length <= lead && title && repeat < 0) this.title(title, blocks);
    this.closeQuote();
    return this.finish();
  }

  // ── Page starts ──

  /** The page starts of a block, in order: where its first word is on a
      later page than the last start placed, and each later page inside it.
      A page start only rises. */
  private startsOf(block: ParsedBlock): PageStart[] {
    const starts: PageStart[] = this.carried.map((p) => ({ offset: 0, page: p.page }));
    this.carried = [];
    if (!this.paged) return starts;
    const add = (offset: number, page: unknown) => {
      if (typeof page !== "number" || !Number.isInteger(page) || page <= this.page) return;
      starts.push({ offset: Math.max(0, Math.min(block.text.length, offset)), page });
      this.page = page;
    };
    add(0, block.page);
    for (const p of [...(block.pageStarts ?? [])].sort((a, b) => a.offset - b.offset)) add(p.offset, p.page);
    return starts;
  }

  /** A block with no words to hold page starts hands them to the next. */
  private carry(starts: PageStart[]) {
    this.carried.push(...starts);
  }

  // ── Output ──

  private push(node: RichNode, quoted = false) {
    if (!quoted) {
      this.closeQuote();
      this.out.push(node);
      return;
    }
    if (!this.quote) this.quote = { type: "blockquote", content: [] };
    this.quote.content?.push(node);
  }

  private closeQuote() {
    if (this.quote) this.out.push(this.quote);
    this.quote = null;
  }

  /** The nodes of block `index` into the page: its first paragraph takes
      the id a link to the block already holds. */
  private place(index: number, nodes: RichNode[], quoted = false) {
    const first = firstTextblock(nodes);
    if (first?.attrs) {
      const id = this.targets.get(index);
      if (id) first.attrs.blockId = id;
      if (typeof first.attrs.blockId === "string") this.firstIds.set(index, first.attrs.blockId);
    }
    for (const node of nodes) this.push(node, quoted);
  }

  /** The id a link to block `order` points at, or null when the block
      becomes no paragraph (a figure, a line, an equation, no words). */
  private targetId(order: number): string | null {
    const target = this.input.blocks[order];
    if (!target || !["PARAGRAPH", "HEADING", "LIST", "TABLE", "CODE"].includes(target.type)) return null;
    if (target.type !== "TABLE" && !target.text.trim()) return null;
    const known = this.firstIds.get(order) ?? this.targets.get(order);
    if (known) return known;
    const id = newBlockId();
    this.targets.set(order, id);
    return id;
  }

  /** The named style a block's words take: a heading's level's, else
      Normal text's. */
  private styleOf(block: ParsedBlock): DocStyle {
    return block.type === "HEADING" ? (`h${Math.min(6, Math.max(1, headingLevel(block.html)))}` as DocStyle) : "normal";
  }

  /** A named style as the import sets it, the face it leaves to Normal
      text filled in. */
  private named(style: DocStyle): NamedStyle {
    const look = this.looks[style] ?? DEFAULT_STYLES[style];
    return look.font ? look : { ...look, font: this.looks.normal?.font ?? DEFAULT_STYLES.normal.font };
  }

  /** The marks over all of a block's words where its look
      (ParsedBlock.font) differs from its named style: its face and size (a
      caption set small, a line in another face), and a heading's bold its
      level's style lacks. Its color is its runs' own (a color span each). */
  private lookMarks(block: ParsedBlock, style: DocStyle): RichMark[] {
    const font = block.font;
    if (!font) return [];
    const named = this.named(style);
    const attrs: Record<string, unknown> = {};
    if (font.family !== named.font) attrs.fontFamily = font.family;
    // A kicker, a label, a caption, a footnote, and a display line keep
    // their role's size (paragraph): no named style draws them.
    const role = block.type === "PARAGRAPH" && ROLES.some((r) => r !== "meta" && r !== "quote" && tokensOf(block.html).includes(r));
    if (font.size !== named.size && !role) attrs.fontSize = `${font.size}pt`;
    const marks: RichMark[] = Object.keys(attrs).length > 0 ? [{ type: "textStyle", attrs }] : [];
    if (block.type === "HEADING" && font.bold && !named.bold) marks.push({ type: "bold" });
    return marks;
  }

  /** The space after a block in points: the page's (ParsedBlock.spaceAfter),
      the page's most common for a block it measured none for, or Docs'
      "Add space after paragraph" where the parse measures no spacing. */
  private spaceAfter(block: ParsedBlock): number {
    return block.spaceAfter ?? this.spacing ?? PARAGRAPH_SPACE_PT;
  }

  /** A list's last line takes the space after its block. */
  private spaceLast(nodes: RichNode[], block: ParsedBlock) {
    const last = lastParagraph(nodes);
    if (!last?.attrs) return;
    const after = this.spaceAfter(block);
    if (after > 0) last.attrs.spaceAfter = after;
    else delete last.attrs.spaceAfter;
  }

  private sourceOf(block: ParsedBlock, starts: PageStart[], style: DocStyle = this.styleOf(block)): Source {
    // The block's look where it differs from its style, then its runs'
    // marks over it (a run's face or size over its block's). A code run
    // takes none of the block's look: the page editor's code mark holds no
    // other mark, and the block's face took its place (a footnote's web
    // address lost its code, real-jnlp-31-47).
    const code = (block.styles ?? []).filter((s) => s.style === "code").sort((a, b) => a.start - b.start);
    const spans: Source["spans"] = [];
    for (const mark of this.lookMarks(block, style)) {
      let at = 0;
      for (const c of code) {
        if (c.start > at) spans.push({ start: at, end: c.start, mark });
        at = Math.max(at, c.end);
      }
      if (at < block.text.length) spans.push({ start: at, end: block.text.length, mark });
    }
    const named = this.named(style);
    for (const s of block.styles ?? []) {
      const mark = styleMark(s.style, named);
      if (mark) spans.push({ start: s.start, end: s.end, mark });
    }
    for (const l of block.links ?? []) {
      const href = (l.targetOrder !== undefined ? this.headingHref(l.targetOrder) : null) ?? keptHref(l.href);
      if (href) spans.push({ start: l.start, end: l.end, mark: { type: "link", attrs: { href } } });
    }
    for (const c of block.citations ?? []) {
      if (/^[\w-]{1,64}$/.test(c.refId)) spans.push({ start: c.start, end: c.end, mark: { type: "citation", attrs: { refId: c.refId } } });
    }
    const atoms = [...mathAtoms(block), ...(this.numbers.get(block) ?? [])].sort((a, b) => a.start - b.start);
    return { text: block.text, spans, starts, atoms };
  }

  private headingHref(order: number): string | null {
    const id = this.targetId(order);
    return id ? `#heading=${id}` : null;
  }

  // ── Blocks ──

  private title(title: string, blocks: ParsedBlock[]) {
    // A PDF's title stands on its first page.
    const starts: PageStart[] = this.paged && this.page < 1 ? [{ offset: 0, page: 1 }] : [];
    if (starts.length > 0) this.page = 1;
    const meta = blocks.slice(0, TITLE_REACH).find((b) => b.type === "PARAGRAPH" && tokensOf(b.html).includes("meta"));
    const heading = blocks.find((b) => b.type === "HEADING");
    const centered =
      (blocks[0]?.type === "PARAGRAPH" && tokensOf(blocks[0].html).includes("kicker") && alignOf(tokensOf(blocks[0].html)) === "center") ||
      (meta !== undefined && alignOf(tokensOf(meta.html)) === "center") ||
      (heading !== undefined && alignOf(tokensOf(heading.html)) === "center");
    const attrs: Record<string, unknown> = { docStyle: "title" };
    // The parse's alignment when it read the title's look on the page (a
    // title it read and set flush left stays so); else the page's centered
    // masthead, byline, or first heading centers it.
    const align = this.input.titleAlign ?? (this.input.titleFont ? null : centered ? "center" : null);
    if (align) attrs.textAlign = align;
    this.push(paragraphNode(this.titleContent(inline({ text: title, spans: [], starts })), attrs));
  }

  private block(block: ParsedBlock, index: number, isTitle: boolean) {
    // A footnote with a reference takes no page start: it stands with the
    // footnotes, and the words after it keep theirs.
    const footnoteId = this.footnoteIds.get(index);
    if (footnoteId !== undefined) return this.footnote(block, footnoteId);
    const starts = this.startsOf(block);
    switch (block.type) {
      case "HEADING":
        return this.heading(block, index, starts, isTitle);
      case "LIST":
        return this.list(block, index, starts);
      case "TABLE":
        return this.table(block, index, starts);
      case "FIGURE":
        return this.figure(block, index, starts);
      case "EQUATION":
        return this.equation(block, index, starts);
      case "CODE":
        return this.code(block, index, starts);
      case "SEPARATOR":
        this.carry(starts);
        return this.place(index, [{ type: "horizontalRule", attrs: { blockId: newBlockId() } }]);
      default:
        return this.paragraph(block, index, starts);
    }
  }

  /** A footnote's words without its label (the page editor draws the
      number), for the footnotes at the document's end. */
  private footnote(block: ParsedBlock, footnoteId: string) {
    const label = block.footnote?.label ?? "";
    const rest = block.text.startsWith(label) ? block.text.slice(label.length) : block.text;
    const from = block.text.length - rest.trimStart().length;
    const words = sliceSource(this.sourceOf(block, []), from, block.text.length);
    this.footnotes.set(footnoteId, { type: "footnote", attrs: { footnoteId }, content: [paragraphNode(inline(words))] });
  }

  private paragraph(block: ParsedBlock, index: number, starts: PageStart[]) {
    if (!block.text.trim()) return this.carry(starts);
    const tokens = tokensOf(block.html);
    const role: Role | undefined = ROLES.find((r) => tokens.includes(r));
    const attrs: Record<string, unknown> = {};
    // A caption stands centered whatever the page's lines do.
    const align = role === "caption" && alignOf(tokens) !== "right" ? "center" : alignOf(tokens);
    if (align) attrs.textAlign = align;
    if (role === "meta") attrs.docStyle = "subtitle";
    else if (role !== "kicker" && this.spaceAfter(block) > 0) attrs.spaceAfter = this.spaceAfter(block);
    const indent = INDENT_TOKENS.find((k) => tokens.includes(k));
    if (indent) Object.assign(attrs, INDENTS[indent]);
    const size =
      role === "kicker" || role === "label" || role === "caption" || role === "footnote" ? SMALL_SIZE : role === "display" ? DISPLAY_SIZE : null;
    const extra: RichMark[] = size ? [{ type: "textStyle", attrs: { fontSize: size } }] : [];
    const nodes = splitLong(this.sourceOf(block, starts)).map((part) => paragraphNode(inline(part, extra), attrs));
    this.place(index, nodes, role === "quote");
  }

  private heading(block: ParsedBlock, index: number, starts: PageStart[], isTitle: boolean) {
    if (!block.text.trim()) return this.carry(starts);
    const align = alignOf(tokensOf(block.html));
    const content = inline(this.sourceOf(block, starts, isTitle ? "title" : undefined));
    if (isTitle) {
      this.place(index, [paragraphNode(this.titleContent(content), align ? { docStyle: "title", textAlign: align } : { docStyle: "title" })]);
      return;
    }
    const attrs: Record<string, unknown> = { level: Math.min(6, Math.max(1, headingLevel(block.html))), blockId: newBlockId() };
    if (align) attrs.textAlign = align;
    // The page's own space after the heading, where it measured one.
    if (block.spaceAfter !== undefined) attrs.spaceAfter = block.spaceAfter;
    this.place(index, [content.length > 0 ? { type: "heading", attrs, content } : { type: "heading", attrs }]);
  }

  private list(block: ParsedBlock, index: number, starts: PageStart[]) {
    // A line with no words is no line: its page starts go to the next one.
    const lines: ListLine[] = [];
    let waiting: PageStart[] = [];
    for (const line of linesOf(this.sourceOf(block, starts))) {
      if (!line.text.trim()) {
        waiting.push(...line.starts.map((p) => ({ offset: 0, page: p.page })));
        continue;
      }
      if (waiting.length > 0) line.starts = [...waiting, ...line.starts];
      waiting = [];
      lines.push(listLine(line));
    }
    this.carry(waiting);
    if (lines.length === 0) return;
    // A contents list: its class, or lines that link to headings, whatever
    // their markers ("1 Introduction", "2.1 Background").
    const contents =
      tokensOf(block.html).includes("contents") || (block.links ?? []).some((l) => l.targetOrder !== undefined);
    if (!contents && this.resume(lines, block, index)) return;
    // A line goes at most one level deeper than the line before it.
    let depth = -1;
    for (const l of lines) depth = l.depth = Math.min(l.depth, depth + 1);
    levelsOfLines(lines, this.printed);
    if (contents || lines.some((l) => l.type === null)) {
      // A contents list, or lines the page editor's lists cannot draw:
      // a paragraph per line, the words as they stand, indented as printed.
      const nodes = lines.map((l) => paragraphNode(inline(l.whole), l.indent > 0 ? { indentLeft: l.indent * INDENT_PT } : {}));
      this.spaceLast(nodes, block);
      this.place(index, nodes);
      this.lastList = null;
      return;
    }
    const nodes = this.lists(lines);
    this.spaceLast(nodes, block);
    this.place(index, nodes);
    this.lastList = { lines, nodes, at: this.out.length - nodes.length };
  }

  /** The lines as lists, each outermost list in its format. */
  private lists(lines: ListLine[]): RichNode[] {
    const tops: Top[] = [];
    const nodes = listsAt(lines, 0, 0, tops).nodes;
    for (const top of tops) {
      const attrs = listFormat(top.node.type, top.seen);
      if (attrs) top.node.attrs = { ...top.node.attrs, ...attrs };
    }
    return nodes;
  }

  /** A list that resumes a level in after a line or two between its items
      (a centered label under an item's fill-in line): its lines go on the
      list before it, and the last item of that list holds the blocks
      between, as they stand (the label stays centered), so every item keeps
      its level. The page editor's lists nest: an item a level in needs an
      item above it, and a list lifted to the top put the first resumed item
      a level out and the rest under it. False when the list before is not
      the last thing placed but those blocks, or the lines do not go on it. */
  private resume(lines: ListLine[], block: ParsedBlock, index: number): boolean {
    const last = this.lastList;
    if (!last || lines[0].depth < 1 || this.quote) return false;
    const between = this.out.slice(last.at + last.nodes.length);
    const placed = last.nodes.every((node, k) => this.out[last.at + k] === node);
    if (!placed || between.length > 2 || between.some((n) => n.type !== "paragraph" && n.type !== "blockMath")) return false;
    const tail = last.lines[last.lines.length - 1];
    let depth = tail.depth;
    for (const l of lines) depth = l.depth = Math.min(l.depth, depth + 1);
    const all = [...last.lines, ...lines];
    levelsOfLines(all, this.printed);
    if (lines.some((l) => l.type === null)) return false;
    // The list's last line is no longer its last.
    if (tail.node?.attrs) delete tail.node.attrs.spaceAfter;
    tail.more = [...(tail.more ?? []), ...between];
    this.out.splice(last.at);
    const nodes = this.lists(all);
    this.spaceLast(nodes, block);
    // A link to the resumed block lands on its first line.
    const first = lines[0].node;
    if (first?.attrs) {
      const id = this.targets.get(index);
      if (id) first.attrs.blockId = id;
      if (typeof first.attrs.blockId === "string") this.firstIds.set(index, first.attrs.blockId);
    }
    for (const node of nodes) this.push(node);
    this.lastList = { lines: all, nodes, at: this.out.length - nodes.length };
    return true;
  }

  /** A PDF's and a Word file's bullets are as printed; a web page's and a
      text file's "-" is any bullet. */
  private get printed(): boolean {
    return this.input.kind === "docx" || this.input.kind === "pdf";
  }

  private table(block: ParsedBlock, index: number, starts: PageStart[]) {
    const notes = this.cellNotes(block, index);
    const built = (block.html ? tableFromHtml(block.html, this.room, notes) : null) ?? tableFromText(block.text, this.room);
    if (!built) return this.carry(starts);
    // A footnote whose number the cell holds is the page editor's; one whose
    // label stayed words stays a paragraph after the table.
    walk(built.table, (node) => {
      const target = node.type === "footnoteReference" ? notes.targets.get(String(node.attrs?.footnoteId)) : undefined;
      if (target !== undefined) this.footnoteIds.set(target, String(node.attrs?.footnoteId));
    });
    // A page start goes into the first cell of the row the page begins at.
    // A table with a caption opens its text with the caption's line (the
    // PDF and Word parses): a page start there opens the caption.
    const captionLines = built.caption ? 1 : 0;
    const captionStarts: RichNode[] = [];
    for (const p of starts) {
      const line = block.text.slice(0, p.offset).split("\n").length - 1;
      if (line < captionLines) {
        captionStarts.push({ type: "pageStart", attrs: { page: p.page } });
        continue;
      }
      const row = line - captionLines;
      const cell = built.rowStarts.slice(row).find((c) => c !== null) ?? built.rowStarts.find((c) => c !== null);
      if (cell) cell.content = [{ type: "pageStart", attrs: { page: p.page } }, ...(cell.content ?? [])];
    }
    const nodes: RichNode[] = [];
    // The caption small: 9 pt, or the size the page sets it in when smaller.
    if (built.caption) nodes.push(paragraphNode([...captionStarts, ...built.caption.map((n) => sizedAtMost(n, parseFloat(SMALL_SIZE)))], { textAlign: "center" }));
    nodes.push(built.table);
    this.place(index, nodes);
  }

  private figure(block: ParsedBlock, index: number, starts: PageStart[]) {
    const mediaId = newBlockId();
    const caption = clip(block.text, MAX_CAPTION_CHARS);
    const page = this.input.kind === "pdf" && typeof block.page === "number" ? block.page : null;
    const region = block.region ?? null;
    const pageStart = starts.at(-1)?.page ?? null;
    this.figures.push({ mediaId, html: this.input.kind === "pdf" ? null : block.html ?? null, caption, page, region });
    this.place(index, [
      {
        type: "figure",
        attrs: {
          blockId: newBlockId(),
          mediaId,
          caption,
          page,
          region: region ? JSON.stringify(region) : null,
          pageStart,
        },
      },
    ]);
  }

  private equation(block: ParsedBlock, index: number, starts: PageStart[]) {
    const latex = block.text.trim();
    if (!latex) return this.carry(starts);
    if (latex.length > MAX_LATEX) return this.code({ ...block, text: latex }, index, starts);
    const attrs: Record<string, unknown> = { latex, blockId: newBlockId() };
    const pageStart = starts.at(-1)?.page;
    if (pageStart !== undefined) attrs.pageStart = pageStart;
    this.place(index, [{ type: "blockMath", attrs }]);
  }

  private code(block: ParsedBlock, index: number, starts: PageStart[]) {
    const raw = block.text;
    if (!raw.replaceAll(ZWSP, "").trim()) return this.carry(starts);
    // A code block holds no inline node: it draws the number of the first
    // page that begins at it or inside it at its top. A second page that
    // begins inside it begins a new code block at the line it begins on, so
    // no page loses its start.
    const pages = new Map<number, number>();
    [...starts]
      .sort((a, b) => a.offset - b.offset)
      .forEach((p, k) => {
        const at = k === 0 || p.offset <= 0 ? 0 : raw.lastIndexOf("\n", p.offset - 1) + 1;
        pages.set(at, Math.max(p.page, pages.get(at) ?? 0));
      });
    const cuts = [...pages.keys()].filter((at) => at > 0).sort((a, b) => a - b);
    const nodes: RichNode[] = [];
    let waiting: number | undefined;
    for (let from = 0; from < raw.length; ) {
      const cut = cuts.find((at) => at > from) ?? raw.length;
      let to = Math.min(cut, from + MAX_TEXT);
      if (to < cut) {
        const line = raw.lastIndexOf("\n", to - 1);
        to = line > from ? line + 1 : clip(raw.slice(from, to + 1), to - from).length + from;
      }
      // The line break at a cut is the break between the two blocks.
      const text = raw.slice(from, to < raw.length && raw[to - 1] === "\n" ? to - 1 : to).replaceAll(ZWSP, "");
      const page = pages.get(from) ?? waiting;
      if (text) {
        const attrs: Record<string, unknown> = { blockId: newBlockId() };
        if (page !== undefined) attrs.pageStart = page;
        nodes.push({ type: "codeBlock", attrs, content: [{ type: "text", text }] });
        waiting = undefined;
      } else {
        waiting = page;
      }
      from = to;
    }
    if (waiting !== undefined) this.carry([{ offset: 0, page: waiting }]);
    this.place(index, nodes);
  }

  // ── The document ──

  private finish(): ImportResult {
    const content = this.out;
    // The page editor ends a document on a line: after a table, a figure, or
    // any other object comes an empty line (its trailing node), here so the
    // editor adds none on open.
    const last = content.at(-1)?.type;
    if (!last || !["paragraph", "heading", "bulletList", "orderedList", "taskList"].includes(last)) content.push(paragraphNode([]));
    // The footnotes stand in one block at the end, in their numbers' order,
    // as the page editor keeps them (components/docs/insert/footnotes.ts).
    const numbered = new Set<string>();
    walk({ type: "doc", content }, (node) => {
      if (node.type === "footnoteReference" && typeof node.attrs?.footnoteId === "string") numbered.add(node.attrs.footnoteId);
    });
    const notes = [...numbered].flatMap((id) => this.footnotes.get(id) ?? []);
    if (notes.length > 0) content.push({ type: "footnotes", content: notes });
    // The named styles the page's look set, stored as the page editor stores
    // a style's changes (components/docs/toolbar/styles.ts).
    const attrs: Record<string, unknown> = {};
    for (const [style, look] of Object.entries(this.looks) as [DocStyle, NamedStyle][]) {
      const changes = styleChanges(style, look);
      if (Object.keys(changes).length > 0) attrs[STYLE_ATTR[style]] = JSON.stringify(changes);
    }
    const doc: RichNode = Object.keys(attrs).length > 0 ? { type: "doc", attrs, content } : { type: "doc", content };
    dropLostLinks(doc);
    const richText = sanitizeRichText(doc) ?? doc;
    const kept = new Set<string>();
    walk(richText, (node) => {
      if (node.type === "figure" && typeof node.attrs?.mediaId === "string") kept.add(node.attrs.mediaId);
    });
    let nodes = 0;
    let rows = 0;
    walk(richText, (node) => {
      nodes += 1;
      if (INDEXED_NODE_TYPES.has(node.type)) rows += 1;
    });
    return {
      richText,
      figures: this.figures.filter((f) => kept.has(f.mediaId)),
      pageSetup: this.pageSetup,
      size: { nodes, json: new TextEncoder().encode(JSON.stringify(richText)).length, rows },
    };
  }
}

function walk(node: RichNode, visit: (node: RichNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

/** A link to a place whose paragraph the document does not hold loses its
    link; its words stay. */
function dropLostLinks(doc: RichNode) {
  const ids = new Set<string>();
  walk(doc, (node) => {
    if ((node.type === "paragraph" || node.type === "heading" || node.type === "codeBlock") && typeof node.attrs?.blockId === "string") {
      ids.add(node.attrs.blockId);
    }
  });
  const lost = (mark: RichMark) => {
    const href = mark.type === "link" ? String(mark.attrs?.href ?? "") : "";
    return href.startsWith("#heading=") && !ids.has(href.slice("#heading=".length));
  };
  walk(doc, (node) => {
    if (!node.content?.some((c) => c.marks?.some(lost))) return;
    node.content = inlineNodes(
      node.content.map((c): Piece => (c.type === "text" ? { text: c.text ?? "", marks: (c.marks ?? []).filter((m) => !lost(m)) } : { node: c })),
    );
  });
}

/** A PDF: pages at its first page's size (clamped to what the page setup
    takes), 1 in margins (less on a page under 6 in). A web page or a text
    file: pageless. */
function pageSetupFor(input: ImportInput): PageSetup {
  if (input.kind !== "pdf") return { ...DEFAULT_PAGE_SETUP, pageless: true };
  const { width, height } = input.pageSize ?? {};
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) return { ...DEFAULT_PAGE_SETUP };
  const w = Math.round(Math.min(2000, Math.max(144, width)) * 100) / 100;
  const h = Math.round(Math.min(3000, Math.max(144, height)) * 100) / 100;
  const side = Math.min(72, Math.round(w / 6));
  const end = Math.min(72, Math.round(h / 6));
  return { ...DEFAULT_PAGE_SETUP, width: w, height: h, margins: { top: end, right: side, bottom: end, left: side } };
}

/** The parse's blocks of an import as the page editor's rich text, its
    figures' media, its page setup, and its size. */
export function richTextFromImport(input: ImportInput): ImportResult {
  return new Converter(input).run();
}
