import { NUMBER_PRESETS, listPreset } from "@/components/docs/toolbar/lists";
import {
  DEFAULT_PAGE_SETUP,
  INDEXED_NODE_TYPES,
  MAX_CAPTION_CHARS,
  newBlockId,
  sanitizeRichText,
  ZWSP,
  type PageSetup,
  type RichMark,
  type RichNode,
} from "@/lib/docs/schema";
import {
  clip,
  inlineNodes,
  keptHref,
  paragraphNode,
  tableFromHtml,
  tableFromText,
  type CellNotes,
  type Piece,
} from "@/lib/docs/import-table";
import type { PageStart, ParsedBlock, StyleSpan } from "@/lib/parse/types";
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
// subscript or superscript), and an inline formula becomes an inline
// equation of its TeX in place of its readable characters.
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
    reads as one wall of words. */
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

function alignOf(tokens: string[]): "center" | "right" | null {
  return tokens.includes("center") ? "center" : tokens.includes("right") ? "right" : null;
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
    const marks = [...extra, ...spans.filter((s) => s.start <= at && s.end >= next).map((s) => s.mark)];
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
// or "☒" checked), or a counter: "1." "1)" "(1)" "1.1" "a." "a)" "(a)"
// "A." "(A)" "i." "(i)" "I.", a number alone (an exercise's "15" or
// "*15"), or a reference's number ("[12]"). Any other line start is words.
const LIST_BULLET = /^[-*•▪◦‣●·∙○■□◆❖➢➤►✓✔–—](?: +|$)/;
const LIST_BOX = /^([☐☑☒])(?: +|$)/;
const LIST_LEGAL = /^(?:\d{1,3}\.)+(\d{1,3})\.?(?: +|$)/;
const LIST_CITE = /^\[(\d{1,3})\](?: +|$)/;
const LIST_COUNTER = /^(?:\(([a-zA-Z]{1,5}|\d{1,3})\)|([a-zA-Z]{1,5}|\d{1,3})(\)\.?|\.\)?))(?: +|$)/;
const LIST_NUMBER = /^\*?(\d{1,3})(?: +|$)/;
// A task line's box after its bullet (lib/parse/markdown-document.ts).
const TASK_BOX = /^([☐☑☒]) /;
// The page editor's preset for a counter's kind and its printed form
// (components/docs/toolbar/lists.ts). A lower-case numeral has no preset of
// its own at the first level: the upper-case numerals' preset counts the
// same.
const PRESETS: Record<string, Record<string, string>> = {
  decimal: { ".": "", ")": "NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS", "()": "NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS", ".)": "NUMBERED_DECIMAL_ALPHA_ROMAN_PERIOD_PARENS" },
  alpha: { ".": "NUMBERED_ALPHA_ROMAN_DECIMAL", ")": "NUMBERED_ALPHA_ROMAN_DECIMAL_PARENS", "()": "NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS" },
  upperAlpha: { ".": "NUMBERED_UPPERALPHA_ALPHA_ROMAN", ")": "NUMBERED_UPPERALPHA_ALPHA_ROMAN_PARENS", "()": "NUMBERED_UPPERALPHA_ALPHA_ROMAN_TWO_PARENS" },
  roman: { ".": "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL" },
  upperRoman: { ".": "NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL" },
};
const ROMAN_NUMERAL = /^(x{0,3})(ix|iv|v?i{0,3})$/;

type ListLine = {
  depth: number;
  /** The list the line belongs to: "bullet", "task", "ordered", or
      "ordered:<preset>"; null when its start is no marker. */
  key: string | null;
  value: number;
  /** A one-letter numeral ("(i)", "v.") read as a letter: the list it
      continues when the letter follows on ("(h)" then "(i)"). */
  letter?: { key: string; value: number };
  checked: boolean;
  /** A counter as printed ("1.", "(a)", "2.3"), and whether it is a legal
      number, for the preset that draws it (bestPreset). */
  marker?: string;
  legal?: boolean;
  /** The words after the marker; `whole` keeps the marker. */
  words: Source;
  whole: Source;
};

/** A counter's list key and value: "c" with ")" → the lower-case letters'
    parenthesis preset and 3. */
function counterKey(counter: string, form: string): { key: string; value: number } | null {
  const shape = form === "()" || form === "." || form === ".)" ? form : ")";
  const lower = counter.toLowerCase();
  const numeral = ROMAN_NUMERAL.exec(lower);
  const kind = /^\d+$/.test(counter)
    ? "decimal"
    : counter !== lower && counter !== counter.toUpperCase()
      ? null
      : numeral && lower.length > 0
        ? counter === lower ? "roman" : "upperRoman"
        : counter.length === 1
          ? counter === lower ? "alpha" : "upperAlpha"
          : null;
  if (!kind) return null;
  const value =
    kind === "decimal" ? Number(counter)
    : kind === "alpha" || kind === "upperAlpha" ? lower.charCodeAt(0) - 96
    : numeral![1].length * 10 + ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"].indexOf(numeral![2]);
  const preset = PRESETS[kind][shape] ?? PRESETS[kind]["."];
  return { key: preset ? `ordered:${preset}` : "ordered", value };
}

function listLine(line: Source): ListLine {
  const indent = /^ */.exec(line.text)?.[0].length ?? 0;
  const depth = Math.floor(indent / 2);
  const whole = sliceSource(line, indent, line.text.length, true);
  const out: ListLine = { depth, key: null, value: 1, checked: false, words: whole, whole };
  const text = whole.text;
  let m: RegExpExecArray | null;
  let cut = 0;
  if ((m = LIST_BOX.exec(text))) {
    out.key = "task";
    out.checked = m[1] !== "☐";
    cut = m[0].length;
  } else if ((m = LIST_BULLET.exec(text))) {
    out.key = "bullet";
    cut = m[0].length;
    const box = TASK_BOX.exec(text.slice(cut));
    if (box) {
      out.key = "task";
      out.checked = box[1] !== "☐";
      cut += box[0].length;
    }
  } else if ((m = LIST_LEGAL.exec(text))) {
    out.key = "ordered:NUMBERED_DECIMAL_NESTED";
    out.value = Number(m[1]);
    out.legal = true;
    cut = m[0].length;
  } else if ((m = LIST_COUNTER.exec(text))) {
    const counter = m[1] ?? m[2];
    const form = m[1] !== undefined ? "()" : m[3] === ")." ? ")" : m[3];
    const read = counterKey(counter, form);
    if (!read) return out;
    out.key = read.key;
    out.value = read.value;
    if (/^[ivx]$/i.test(counter)) {
      const letter = counterKey(counter === counter.toLowerCase() ? "a" : "A", form);
      if (letter) out.letter = { key: letter.key, value: counter.toLowerCase().charCodeAt(0) - 96 };
    }
    cut = m[0].length;
  } else if ((m = LIST_NUMBER.exec(text)) || (m = LIST_CITE.exec(text))) {
    // A number alone and a reference's number count as "1." does: Docs
    // draws no other number.
    out.key = "ordered";
    out.value = Number(m[1]);
    cut = m[0].length;
  } else {
    return out;
  }
  if (m && out.key !== "bullet" && out.key !== "task") out.marker = m[0].trim();
  out.words = sliceSource(whole, cut, whole.text.length, true);
  return out;
}

// Every numbered preset the page editor draws.
const ORDERED_STYLES: (string | null)[] = [
  ...new Set([...NUMBER_PRESETS.map((p) => p.style), ...Object.values(PRESETS).flatMap((forms) => Object.values(forms).filter((s) => s !== ""))]),
];

function toRoman(n: number): string {
  const parts: [number, string][] = [[100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, text] of parts) {
    while (n >= value) {
      out += text;
      n -= value;
    }
  }
  return out;
}

/** The marker a preset draws for item n at a level; a nested level's is
    the number alone ("1." at the first level, "1.1." below it). */
function drawn(style: string | null, depth: number, n: number): string {
  const glyph = listPreset(true, style).levels[Math.min(depth, 8)];
  if ("nested" in glyph) return depth === 0 ? `${n}.` : "nested";
  if (!("counter" in glyph)) return glyph.bullet;
  const counter =
    glyph.counter === "decimal" ? String(n)
    : glyph.counter === "decimal-leading-zero" ? String(n).padStart(2, "0")
    : glyph.counter === "lower-alpha" ? String.fromCharCode(96 + n)
    : glyph.counter === "upper-alpha" ? String.fromCharCode(64 + n)
    : glyph.counter === "lower-roman" ? toRoman(n)
    : toRoman(n).toUpperCase();
  return `${glyph.before}${counter}${glyph.after}`;
}

/** A preset draws a line's counter as printed ("2.3" under "2." is the
    nested preset's). */
function draws(style: string | null, line: ListLine): boolean {
  if (!line.marker) return false;
  const values = [line.value, ...(line.letter ? [line.letter.value] : [])];
  return values.some((n) => {
    const mark = drawn(style, line.depth, n);
    return mark === line.marker || (mark === "nested" && line.legal === true);
  });
}

/** The outermost list's preset: of the presets that draw its first item as
    its own preset does, the one that draws the most of its lines' counters
    as printed. "1." over "1.1" and "1.2" takes Docs' nested numbering: the
    default drew them "a." and "b.". */
function bestPreset(current: string | null, lines: ListLine[]): string | null {
  const first = drawn(current, 0, lines[0].value);
  const count = (style: string | null) => lines.filter((l) => draws(style, l)).length;
  let best = current;
  let most = count(current);
  for (const style of ORDERED_STYLES) {
    if (drawn(style, 0, lines[0].value) !== first) continue;
    const n = count(style);
    if (n > most) {
      best = style;
      most = n;
    }
  }
  return best;
}

function listNode(key: string, value: number, outermost: boolean): RichNode {
  if (key === "bullet") return { type: "bulletList", content: [] };
  if (key === "task") return { type: "taskList", content: [] };
  const attrs: Record<string, unknown> = {};
  if (value !== 1) attrs.start = value;
  // A preset is the outermost list's; a nested list draws its level of it.
  if (key.startsWith("ordered:") && outermost) attrs.listStyle = key.slice("ordered:".length);
  return Object.keys(attrs).length > 0 ? { type: "orderedList", attrs, content: [] } : { type: "orderedList", content: [] };
}

/** The lists of the lines from `from` at `depth`: a line of another kind,
    or a number that does not follow on, starts a new list. `tops` collects
    each outermost list and its first line. */
function listsAt(
  lines: ListLine[],
  from: number,
  depth: number,
  tops?: { node: RichNode; from: number }[],
): { nodes: RichNode[]; next: number } {
  const nodes: RichNode[] = [];
  let list: RichNode | null = null;
  let key: string | null = null;
  let expected = 0;
  let i = from;
  while (i < lines.length && lines[i].depth >= depth) {
    const line = lines[i];
    // "(i)" after "(h)" is the ninth letter, not the first numeral.
    const read: { key: string; value: number } | null =
      line.letter && list && key === line.letter.key && line.letter.value === expected ? line.letter : null;
    const lineKey: string = read?.key ?? line.key ?? "bullet";
    const value = read?.value ?? line.value;
    const ordered = lineKey.startsWith("ordered");
    if (!list || lineKey !== key || (ordered && value !== expected)) {
      list = listNode(lineKey, value, depth === 0);
      nodes.push(list);
      tops?.push({ node: list, from: i });
      key = lineKey;
    }
    expected = value + 1;
    const sub = listsAt(lines, i + 1, depth + 1);
    const item: RichNode =
      lineKey === "task"
        ? { type: "taskItem", attrs: { checked: line.checked }, content: [paragraphNode(inline(line.words)), ...sub.nodes] }
        : { type: "listItem", content: [paragraphNode(inline(line.words)), ...sub.nodes] };
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

  constructor(private readonly input: ImportInput) {
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

  private sourceOf(block: ParsedBlock, starts: PageStart[]): Source {
    const spans: Source["spans"] = [];
    for (const s of block.styles ?? []) {
      const mark = STYLE_MARKS[s.style];
      if (mark) spans.push({ start: s.start, end: s.end, mark: { type: mark } });
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
    if (centered) attrs.textAlign = "center";
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
    const align = alignOf(tokens) ?? (role === "caption" ? "center" : null);
    if (align) attrs.textAlign = align;
    if (role === "meta") attrs.docStyle = "subtitle";
    else if (role !== "kicker") attrs.spaceAfter = PARAGRAPH_SPACE_PT;
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
    const content = inline(this.sourceOf(block, starts));
    if (isTitle) {
      this.place(index, [paragraphNode(this.titleContent(content), align ? { docStyle: "title", textAlign: align } : { docStyle: "title" })]);
      return;
    }
    const attrs: Record<string, unknown> = { level: Math.min(6, Math.max(1, headingLevel(block.html))), blockId: newBlockId() };
    if (align) attrs.textAlign = align;
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
    let nodes: RichNode[];
    if (contents || lines.some((l) => l.key === null)) {
      // A contents list, or lines the page editor's lists cannot draw:
      // a paragraph per line, the words as they stand, indented by depth.
      nodes = lines.map((l) => paragraphNode(inline(l.whole), l.depth > 0 ? { indentLeft: l.depth * INDENT_PT } : {}));
    } else {
      let depth = -1;
      for (const l of lines) depth = l.depth = Math.min(l.depth, depth + 1);
      const tops: { node: RichNode; from: number }[] = [];
      nodes = listsAt(lines, 0, 0, tops).nodes;
      tops.forEach((top, k) => {
        if (top.node.type !== "orderedList") return;
        const current = typeof top.node.attrs?.listStyle === "string" ? top.node.attrs.listStyle : null;
        const style = bestPreset(current, lines.slice(top.from, tops[k + 1]?.from ?? lines.length));
        if (style === current) return;
        const attrs: Record<string, unknown> = { ...(top.node.attrs ?? {}) };
        if (style) attrs.listStyle = style;
        else delete attrs.listStyle;
        if (Object.keys(attrs).length > 0) top.node.attrs = attrs;
        else delete top.node.attrs;
      });
    }
    const last = lastParagraph(nodes);
    if (last?.attrs) last.attrs.spaceAfter = PARAGRAPH_SPACE_PT;
    this.place(index, nodes);
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
    for (const p of starts) {
      const row = block.text.slice(0, p.offset).split("\n").length - 1;
      const cell = built.rowStarts.slice(row).find((c) => c !== null) ?? built.rowStarts.find((c) => c !== null);
      if (cell) cell.content = [{ type: "pageStart", attrs: { page: p.page } }, ...(cell.content ?? [])];
    }
    const nodes: RichNode[] = [];
    if (built.caption) {
      const size: RichMark = { type: "textStyle", attrs: { fontSize: SMALL_SIZE } };
      nodes.push(paragraphNode(inline({ text: built.caption, spans: [], starts: [] }, [size]), { textAlign: "center" }));
    }
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
    const doc: RichNode = { type: "doc", content };
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
