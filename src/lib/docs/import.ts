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
  type Piece,
} from "@/lib/docs/import-table";
import type { PageStart, ParsedBlock } from "@/lib/parse/types";
import type { Region } from "@/lib/video/types";

// The converter (SPEC.md §29): an import — a PDF, a web page, or a Markdown
// or text file — becomes the page editor's rich text at import, one code path
// for the three parses. The Block rows are then the paragraph index of this
// rich text (lib/docs/blocks.ts deriveBlocks), never the parse's own rows, so
// the first save changes only what the reader changed.
//
// What each parse block becomes:
//   PARAGRAPH  a paragraph; "\n" a line break; its layout tokens the page
//              editor's own formats: kicker and label small, caption small
//              and centered, display large, meta the Subtitle, quote inside
//              a blockquote, center and right the alignment
//   HEADING    a heading of its level; one that repeats the title is the Title
//   LIST       lists from the marker lines, nested two spaces a level, the
//              markers drawn by the list (a Markdown task line a checklist
//              line); a contents list is one paragraph per entry, each entry
//              a link to its heading
//   TABLE      a table (lib/docs/import-table.ts)
//   CODE       a code block        EQUATION  an equation on its own line
//   SEPARATOR  a horizontal line   FIGURE    a figure object, its media a
//                                            FigureMedia row (the figures)
// The title, when it came from the original, is a Title paragraph after the
// kicker. A PDF opens in pages at its first page's size, with a page start
// where each of its pages begins; a web page and a text file are pageless.
// It loads with the parse chain only (import-table.ts reads html with jsdom).

export type ImportKind = "pdf" | "url" | "markdown";

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

/** Words, the marks over them (offsets into the words), and the page starts
    inside them: where each page of the PDF begins (lib/parse/pdf.ts). */
type Source = { text: string; spans: { start: number; end: number; mark: RichMark }[]; starts: PageStart[] };

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

const ROLES = ["kicker", "meta", "label", "display", "quote", "caption"] as const;
type Role = (typeof ROLES)[number];

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
    a page start where a page begins, `extra` marks on every word. */
function inline(src: Source, extra: RichMark[] = []): RichNode[] {
  const { text } = src;
  const clamp = (n: number) => Math.max(0, Math.min(text.length, n));
  const spans = src.spans.filter((s) => clamp(s.end) > clamp(s.start));
  // Two page starts at one place: the later page's words begin there.
  const starts = new Map<number, number>();
  for (const p of src.starts) starts.set(clamp(p.offset), Math.max(p.page, starts.get(clamp(p.offset)) ?? 0));
  const cuts = new Set<number>([0, text.length, ...starts.keys()]);
  for (const s of spans) {
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
    const marks = [...extra, ...spans.filter((s) => s.start <= at && s.end >= next).map((s) => s.mark)];
    pieces.push({ text: text.slice(at, next), marks });
  });
  return inlineNodes(pieces);
}

// ── Lists ───────────────────────────────────────────────────────────────────

// A list line's marker, after its indent: "-" (a bullet), "N." or "N)", "(N)",
// "(a)". Any other line start is words.
const LIST_MARKER = /^(?:([-*•▪◦‣●·∙])|(\d{1,3})([.)])|\((\d{1,3})\)|\(([a-z])\))(?: +|$)/;
// A Markdown task line's box, after its bullet (lib/parse/markdown-document.ts).
const TASK_BOX = /^([☐☑]) /;

type ListLine = {
  depth: number;
  /** The list the line belongs to: "bullet", "task", "ordered", or
      "ordered:<preset>"; null when its start is no marker. */
  key: string | null;
  value: number;
  checked: boolean;
  /** The words after the marker; `whole` keeps the marker. */
  words: Source;
  whole: Source;
};

function listLine(line: Source): ListLine {
  const indent = /^ */.exec(line.text)?.[0].length ?? 0;
  const depth = Math.floor(indent / 2);
  const whole = sliceSource(line, indent, line.text.length, true);
  const m = LIST_MARKER.exec(whole.text);
  const out: ListLine = { depth, key: null, value: 1, checked: false, words: whole, whole };
  if (!m) return out;
  let cut = m[0].length;
  if (m[1]) {
    out.key = "bullet";
    const box = TASK_BOX.exec(whole.text.slice(cut));
    if (box) {
      out.key = "task";
      out.checked = box[1] === "☑";
      cut += box[0].length;
    }
  } else if (m[2]) {
    out.value = Number(m[2]);
    out.key = m[3] === "." ? "ordered" : "ordered:NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS";
  } else if (m[4]) {
    out.value = Number(m[4]);
    out.key = "ordered:NUMBERED_DECIMAL_ALPHA_ROMAN_TWO_PARENS";
  } else if (m[5]) {
    out.value = m[5].charCodeAt(0) - 96;
    out.key = "ordered:NUMBERED_ALPHA_ROMAN_DECIMAL_TWO_PARENS";
  }
  out.words = sliceSource(whole, cut, whole.text.length, true);
  return out;
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
    or a number that does not follow on, starts a new list. */
function listsAt(lines: ListLine[], from: number, depth: number): { nodes: RichNode[]; next: number } {
  const nodes: RichNode[] = [];
  let list: RichNode | null = null;
  let key: string | null = null;
  let expected = 0;
  let i = from;
  while (i < lines.length && lines[i].depth >= depth) {
    const line = lines[i];
    const lineKey = line.key ?? "bullet";
    const ordered = lineKey.startsWith("ordered");
    if (!list || lineKey !== key || (ordered && line.value !== expected)) {
      list = listNode(lineKey, line.value, depth === 0);
      nodes.push(list);
      key = lineKey;
    }
    expected = line.value + 1;
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

  constructor(private readonly input: ImportInput) {
    this.paged = input.kind === "pdf" && input.blocks.some((b) => typeof b.page === "number");
    this.pageSetup = pageSetupFor(input);
    const { pageless, width, margins } = this.pageSetup;
    this.room = pageless ? PAGELESS_COLUMN_PX : ((width - margins.left - margins.right) * 96) / 72;
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
      if (["bold", "italic", "underline", "code"].includes(s.style)) spans.push({ start: s.start, end: s.end, mark: { type: s.style } });
    }
    for (const l of block.links ?? []) {
      const href = (l.targetOrder !== undefined ? this.headingHref(l.targetOrder) : null) ?? keptHref(l.href);
      if (href) spans.push({ start: l.start, end: l.end, mark: { type: "link", attrs: { href } } });
    }
    for (const c of block.citations ?? []) {
      if (/^[\w-]{1,64}$/.test(c.refId)) spans.push({ start: c.start, end: c.end, mark: { type: "citation", attrs: { refId: c.refId } } });
    }
    return { text: block.text, spans, starts };
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
    this.push(paragraphNode(inline({ text: title, spans: [], starts }), attrs));
  }

  private block(block: ParsedBlock, index: number, isTitle: boolean) {
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

  private paragraph(block: ParsedBlock, index: number, starts: PageStart[]) {
    if (!block.text.trim()) return this.carry(starts);
    const tokens = tokensOf(block.html);
    const role: Role | undefined = ROLES.find((r) => tokens.includes(r));
    const attrs: Record<string, unknown> = {};
    const align = alignOf(tokens) ?? (role === "caption" ? "center" : null);
    if (align) attrs.textAlign = align;
    if (role === "meta") attrs.docStyle = "subtitle";
    else if (role !== "kicker") attrs.spaceAfter = PARAGRAPH_SPACE_PT;
    const size = role === "kicker" || role === "label" || role === "caption" ? SMALL_SIZE : role === "display" ? DISPLAY_SIZE : null;
    const extra: RichMark[] = size ? [{ type: "textStyle", attrs: { fontSize: size } }] : [];
    const nodes = splitLong(this.sourceOf(block, starts)).map((part) => paragraphNode(inline(part, extra), attrs));
    this.place(index, nodes, role === "quote");
  }

  private heading(block: ParsedBlock, index: number, starts: PageStart[], isTitle: boolean) {
    if (!block.text.trim()) return this.carry(starts);
    const align = alignOf(tokensOf(block.html));
    const content = inline(this.sourceOf(block, starts));
    if (isTitle) {
      this.place(index, [paragraphNode(content, align ? { docStyle: "title", textAlign: align } : { docStyle: "title" })]);
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
    const contents =
      tokensOf(block.html).includes("contents") ||
      (lines.every((l) => l.key === null) && (block.links ?? []).some((l) => l.targetOrder !== undefined));
    let nodes: RichNode[];
    if (contents || lines.some((l) => l.key === null)) {
      // A contents list, or lines the page editor's lists cannot draw:
      // a paragraph per line, the words as they stand, indented by depth.
      nodes = lines.map((l) => paragraphNode(inline(l.whole), l.depth > 0 ? { indentLeft: l.depth * INDENT_PT } : {}));
    } else {
      let depth = -1;
      for (const l of lines) depth = l.depth = Math.min(l.depth, depth + 1);
      nodes = listsAt(lines, 0, 0).nodes;
    }
    const last = lastParagraph(nodes);
    if (last?.attrs) last.attrs.spaceAfter = PARAGRAPH_SPACE_PT;
    this.place(index, nodes);
  }

  private table(block: ParsedBlock, index: number, starts: PageStart[]) {
    const built = (block.html ? tableFromHtml(block.html, this.room) : null) ?? tableFromText(block.text, this.room);
    if (!built) return this.carry(starts);
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
