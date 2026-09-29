import type { User } from "@prisma/client";
import {
  AlignmentType,
  Bookmark,
  BookmarkEnd,
  BookmarkStart,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document as DocxDocument,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  InsertedTextRun,
  InternalHyperlink,
  LevelFormat,
  LevelSuffix,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IBorderOptions,
  type ILevelsOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type { DocStyle } from "@/components/docs/extensions";
import { firstFamily } from "@/components/docs/fonts";
import type { FigureMediaView } from "@/components/docs/insert/figure";
import { DEFAULT_HF_MARGIN_PT, PX_PER_PT } from "@/components/docs/page/geometry";
import { levelMarker, lineLevel } from "@/components/docs/toolbar/lists";
import { readStyles, sizeInPt, styleFont, type NamedStyle } from "@/components/docs/toolbar/styles";
import { authEnabled } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchFigureImage } from "@/lib/derive/figure";
import { isAssistantAuthor } from "@/lib/docs/assistant-suggestions";
import { hex6, inlineText } from "@/lib/docs/blocks";
import {
  captionParts,
  captionStylesOf,
  listIndentsOf,
  suggestionAuthor,
  suggestionTime,
  ZWSP,
  type CaptionStyle,
  type ListIndent,
  type PageSetup,
  type RichMark,
  type RichNode,
} from "@/lib/docs/schema";
import { CROP_PAD, CROP_PAGE_WIDTH, WHOLE_PAGE_WIDTH } from "@/lib/figure-crop";
import { cropPageRegion, renderPdfPage } from "@/lib/handwritten/pages";
import { serverT } from "@/lib/i18n/server";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/images";
import { outboundFetch } from "@/lib/outbound-fetch";
import { parseRegion, type Region } from "@/lib/video/types";

// File > Download > Microsoft Word (.docx) (SPEC.md §29): one walk of the
// stored rich text. The named styles become Word's styles, marks become run
// properties, lists become Word numbering, a suggestion becomes a tracked
// change, a comment a Word comment, and the page setup becomes the section.
// An import's figure object is its picture over its caption (§30); a page
// start adds nothing. What Word has no place for (a chip, an equation) goes
// in as its words.

type Block = Paragraph | Table;
type Picture = { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width: number; height: number };
/** A figure object's pictures, whether they are a PDF figure's crop, and
    the size in px a crop is printed at (FigureMediaView.size). */
type FigurePictures = { pictures: Picture[]; crop: boolean; printed?: { width: number; height: number } | null };

/** The figure objects' media (FigureMedia, by media id), the PDF a figure's
    crop is cut from, and the address a web figure's relative images
    resolve against. */
export type DocxFigures = {
  media: Record<string, FigureMediaView>;
  pdf: Uint8Array | null;
  pageUrl: string | null;
};
/** A comment on the text: its anchors (one per paragraph of its words), its author's account, time, and words. */
type DocxComment = {
  sources: { blockId: string; startOffset: number; endOffset: number }[];
  authorId: string | null;
  date: Date;
  text: string;
};
/** Where a comment's words start or end: an offset in a paragraph's index text. */
type Cut = { at: number; id: number; end: boolean };

type Ctx = {
  doc: RichNode;
  origin: string;
  /** The text column's width in CSS px, as the page draws it. */
  textWidth: number;
  pictures: Map<RichNode, Picture | null>;
  figures: Map<RichNode, FigurePictures>;
  /** Each footnote's number, in the order the text cites them. */
  footnotes: Map<string, number>;
  numbering: { reference: string; levels: ILevelsOptions[] }[];
  /** A page break came last: the next paragraph starts a page. */
  breakBefore: boolean;
  /** The last id Word's bookmarks, tracked changes, and comments took: each takes its own. */
  ids: number;
  /** The names of the accounts that made suggestions and comments, by account id. */
  authors: Map<string, string>;
  /** Each paragraph's comment ends, by block id, in the order of the text. */
  cuts: Map<string, Cut[]>;
};

const tw = (pt: number) => Math.round(pt * 20);

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const COUNTERS = {
  decimal: LevelFormat.DECIMAL,
  "decimal-leading-zero": LevelFormat.DECIMAL_ZERO,
  "lower-alpha": LevelFormat.LOWER_LETTER,
  "upper-alpha": LevelFormat.UPPER_LETTER,
  "lower-roman": LevelFormat.LOWER_ROMAN,
  "upper-roman": LevelFormat.UPPER_ROMAN,
} as const;

const DASHES: Record<string, IBorderOptions["style"]> = {
  solid: BorderStyle.SINGLE,
  dotted: BorderStyle.DOTTED,
  dashed: BorderStyle.DASHED,
};

const WORD_TYPES: Record<string, Picture["type"]> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

/** A stored color (#rrggbb, or rgb() from a paste) as Word writes it: rrggbb. */
function wordColor(value: unknown): string | undefined {
  return hex6(value)?.slice(1);
}

/** A Word bookmark name: a letter first, word characters, at most 40. */
function bookmarkName(kind: "h" | "b", id: string): string {
  return `${kind}_${id.replace(/\W/g, "_")}`.slice(0, 40);
}

/** A bookmark around `children`. docx numbers every bookmark 1, and Word
    pairs a bookmark's start and end by number, so each gets its own. */
function bookmark(ctx: Ctx, name: string, children: ParagraphChild[]): Bookmark {
  const id = ++ctx.ids;
  return Object.assign(new Bookmark({ id: name, children }), { start: new BookmarkStart(name, id), end: new BookmarkEnd(id) });
}

/** The words a suggestion adds or removes: its insertion or deletion mark;
    the deletion where another person's added words are struck. */
const changeOf = (node: RichNode) => node.marks?.find((m) => m.type === "deletion") ?? node.marks?.find((m) => m.type === "insertion");

/** A suggestion as Word's revision: its author's name (else Unitos) and the
    time its id holds, to the second. */
function revision(ctx: Ctx, mark: RichMark) {
  const id = mark.attrs?.id;
  return { id: ++ctx.ids, author: ctx.authors.get(suggestionAuthor(id)) ?? "Unitos", date: new Date(suggestionTime(id)).toISOString().replace(/\.\d+Z$/, "Z") };
}

/** Inside a block a suggestion adds or removes as a whole, every run is added or removed. */
function tracked(node: RichNode, block?: RichMark): RichNode {
  const change = changeOf(node) ?? block;
  if (node.content) return { ...node, content: node.content.map((child) => tracked(child, change)) };
  return change && !changeOf(node) ? { ...node, marks: [...(node.marks ?? []), change] } : node;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ── Runs ────────────────────────────────────────────────────────────────────

function runStyle(marks: RichMark[] = []): IRunOptions {
  const has = (type: string) => marks.some((m) => m.type === type);
  const style = marks.find((m) => m.type === "textStyle")?.attrs ?? {};
  const size = sizeInPt(style.fontSize);
  const highlight = wordColor(style.backgroundColor);
  const face = firstFamily(typeof style.fontFamily === "string" ? style.fontFamily : null);
  return {
    bold: has("bold") || Number(style.fontWeight) >= 600 || undefined,
    italics: has("italic") || undefined,
    underline: has("underline") ? {} : undefined,
    strike: has("strike") || undefined,
    subScript: has("subscript") || undefined,
    superScript: has("superscript") || undefined,
    smallCaps: has("smallCaps") || undefined,
    color: wordColor(style.color),
    size: size ? size * 2 : undefined,
    font: has("code") ? "Courier New" : (face ?? undefined),
    shading: highlight ? { type: ShadingType.CLEAR, color: "auto", fill: highlight } : undefined,
  };
}

function runOf(node: RichNode, ctx: Ctx, extra: IRunOptions): ParagraphChild | null {
  const props = { ...runStyle(node.marks), ...extra };
  const change = changeOf(node);
  const run = (options: IRunOptions) =>
    !change
      ? new TextRun(options)
      : change.type === "insertion"
        ? new InsertedTextRun({ ...options, ...revision(ctx, change) })
        : new DeletedTextRun({ ...options, ...revision(ctx, change) });
  switch (node.type) {
    case "text": {
      // The zero-width spaces of a suggested paragraph break are no words.
      const text = (node.text ?? "").replaceAll(ZWSP, "");
      return text ? run({ ...props, children: text.split("\t").flatMap((part, i) => (i > 0 ? [new Tab(), part] : [part])) }) : null;
    }
    case "hardBreak":
      return run({ ...props, break: 1 });
    case "footnoteReference": {
      const n = ctx.footnotes.get(String(node.attrs?.footnoteId));
      return n ? new FootnoteReferenceRun(n) : null;
    }
    case "bookmark":
      return bookmark(ctx, bookmarkName("b", String(node.attrs?.bookmarkId ?? "")), []);
    case "pageNumber":
      return run({ ...props, children: [PageNumber.CURRENT] });
    case "pageCount":
      return run({ ...props, children: [PageNumber.TOTAL_PAGES] });
    case "inlineMath":
      return run({ ...props, text: String(node.attrs?.latex ?? "") });
    default: {
      // A chip's label, also when a suggestion removes it.
      const text = inlineText({ ...node, marks: undefined });
      return text ? run({ ...props, text }) : null;
    }
  }
}

function hyperlink(href: string, children: ParagraphChild[], origin: string): ParagraphChild {
  const place = /^#(heading|bookmark)=([\w.-]+)$/.exec(href);
  if (place) return new InternalHyperlink({ anchor: bookmarkName(place[1] === "heading" ? "h" : "b", place[2]), children });
  return new ExternalHyperlink({ link: href.startsWith("/") ? `${origin}${href}` : href, children });
}

/** A paragraph's words: runs, with the runs under one link in one hyperlink,
    and each comment's ends where its words start and end. */
function inline(nodes: RichNode[] = [], ctx: Ctx, extra: IRunOptions = {}, cuts: Cut[] = []): ParagraphChild[] {
  const groups: { href: string | null; runs: ParagraphChild[] }[] = [];
  const put = (href: string | null, runs: ParagraphChild[]) => {
    const last = groups.at(-1);
    if (last && last.href === href) last.runs.push(...runs);
    else groups.push({ href, runs });
  };
  // A comment's end takes no room: it joins whatever comes before it. Its
  // start waits for words (struck words and atoms read as none).
  let next = 0;
  const cutsTo = (at: number, starts = true) => {
    for (; next < cuts.length && cuts[next].at <= at && (starts || cuts[next].end); next++) {
      const { id, end } = cuts[next];
      put(groups.at(-1)?.href ?? null, end ? [new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })] : [new CommentRangeStart(id)]);
    }
  };
  let at = 0;
  for (const node of nodes) {
    const mark = node.marks?.find((m) => m.type === "link")?.attrs?.href;
    const href = typeof mark === "string" ? mark : null;
    // Words split where a comment starts or ends inside them.
    const size = inlineText(node).length;
    const inside = [...new Set(cuts.map((c) => c.at - at).filter((o) => o > 0 && o < size))];
    const text = (node.text ?? "").replaceAll(ZWSP, "");
    const parts = node.type === "text" && inside.length > 0 ? [0, ...inside].map((o, i, all) => ({ ...node, text: text.slice(o, all[i + 1] ?? size) })) : [node];
    for (const part of parts) {
      const length = inlineText(part).length;
      cutsTo(at, length > 0);
      const run = runOf(part, ctx, href ? { style: "Hyperlink", ...extra } : extra);
      if (run) put(href, [run]);
      at += length;
    }
  }
  cutsTo(Infinity);
  return groups.flatMap((g) => (g.href ? [hyperlink(g.href, g.runs, ctx.origin)] : g.runs));
}

// ── Paragraphs ──────────────────────────────────────────────────────────────

/** Every paragraph goes through here: a page break before it starts its page. */
function para(ctx: Ctx, options: IParagraphOptions): Paragraph {
  const paragraph = new Paragraph({ ...options, pageBreakBefore: options.pageBreakBefore || ctx.breakBefore || undefined });
  ctx.breakBefore = false;
  return paragraph;
}

function paragraph(node: RichNode, ctx: Ctx, extra: IParagraphOptions = {}, run: IRunOptions = {}): Paragraph {
  const a = node.attrs ?? {};
  const level = Math.min(6, Math.max(1, Number(a.level) || 1));
  const lineSpacing = num(a.lineSpacing);
  const firstLine = num(a.indentFirstLine) ?? 0;
  let children = inline(node.content, ctx, run, typeof a.blockId === "string" ? ctx.cuts.get(a.blockId) : undefined);
  if (node.type === "heading" && typeof a.blockId === "string") children = [bookmark(ctx, bookmarkName("h", a.blockId), children)];
  const stops = typeof a.tabStops === "string" ? a.tabStops.split(" ").map((stop) => stop.split(":")) : [];
  // A side's line and its padding stand in the indent, as the page draws
  // them: Word's indent is where the words start.
  const inset = (side: unknown) => (typeof side === "string" ? side.split(" ").reduce((sum, v, k) => sum + (k === 0 || k === 3 ? Number(v) || 0 : 0), 0) : 0);
  const [left, right] = [num(a.indentLeft), num(a.indentRight)];
  const [insetLeft, insetRight] = [inset(a.borderLeft), inset(a.borderRight)];
  return para(ctx, {
    heading: node.type === "heading" ? HEADINGS[level - 1] : a.docStyle === "title" ? HeadingLevel.TITLE : undefined,
    style: a.docStyle === "subtitle" ? "Subtitle" : undefined,
    alignment: ALIGN[a.textAlign as keyof typeof ALIGN],
    spacing: {
      before: num(a.spaceBefore) === undefined ? undefined : tw(a.spaceBefore as number),
      after: num(a.spaceAfter) === undefined ? undefined : tw(a.spaceAfter as number),
      line: lineSpacing ? Math.round(lineSpacing * 240) : undefined,
      lineRule: lineSpacing ? LineRuleType.AUTO : undefined,
    },
    indent: {
      left: left === undefined && !insetLeft ? undefined : tw((left ?? 0) + insetLeft),
      right: right === undefined && !insetRight ? undefined : tw((right ?? 0) + insetRight),
      firstLine: firstLine > 0 ? tw(firstLine) : undefined,
      hanging: firstLine < 0 ? tw(-firstLine) : undefined,
    },
    tabStops:
      stops.length > 0
        ? stops.map(([at, kind]) => ({
            type: kind === "center" ? TabStopType.CENTER : kind === "right" ? TabStopType.RIGHT : TabStopType.LEFT,
            position: tw(Number(at) || 0),
          }))
        : undefined,
    border: paragraphBorders(a),
    keepNext: a.keepWithNext === true || undefined,
    keepLines: a.keepLinesTogether === true || undefined,
    widowControl: a.preventSingleLines !== false,
    pageBreakBefore: a.pageBreakBefore === true || undefined,
    children,
    ...extra,
  });
}

/** A paragraph's borders as Word's (w:pBdr): each side as a cell's side,
    with the room between the line and the words (an import's Word file). */
function paragraphBorders(a: Record<string, unknown>): IParagraphOptions["border"] {
  const sides = (["top", "right", "bottom", "left"] as const).flatMap((name) => {
    const value = a[`border${name[0].toUpperCase()}${name.slice(1)}`];
    return typeof value === "string" ? [[name, { ...side(value), space: Number(value.split(" ")[3] ?? 0) || 0 }] as const] : [];
  });
  return sides.length > 0 ? Object.fromEntries(sides) : undefined;
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** Level n sits n + 1 half inches in, its glyph a quarter inch before it,
    or farther for a wider glyph and a space ("*15", "1.1", "A-1." ran into
    their words at a quarter inch). `width` is in twips. A list whose page
    set its depths (listIndents: an import's) takes them, as the page draws
    them, the levels past them a half inch a level further. */
function levelIndent(level: number, width = 0, indents: ListIndent[] | null = null): { left: number; hanging?: number; firstLine?: number } {
  const hanging = Math.max(360, width + 110);
  if (!indents) return { left: 720 * (level + 1), hanging };
  const last = indents.length - 1;
  if (level > last) return { left: tw(indents[last][0]) + 720 * (level - last), hanging };
  const [left, first] = indents[level];
  return first < 0 ? { left: tw(left), hanging: tw(-first) } : { left: tw(left), firstLine: first > 0 ? tw(first) : undefined };
}

/** A glyph's width in Arial 11 pt, in twips: about 70 a narrow character
    ("i", ".", "(") and 122 any other. */
const glyphWidth = (glyph: string) => [...glyph].reduce((w, c) => w + (/[iljtfr.,:;()[\]*'-]/.test(c) ? 70 : 122), 0);

function bulletLevels(glyph: string): ILevelsOptions[] {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: glyph,
    style: { paragraph: { indent: levelIndent(level) } },
  }));
}

/** A list's nine levels in Word: each the level the page draws for the
    list's kind (toolbar/lists.ts lineLevel: the levels of the list that
    draws it, else the default's), its glyph format as Word's level text
    ("(%1)" for "(%0)"), a legal level's numbers above it as numbers, as the
    page draws them. A level that draws no marker (an empty bullet) is
    Word's none, its words where the page sets them: at the level's left,
    the first line at its own place, and no marker's hanging indent. The
    list starts at its start at its own level. */
function listLevels(list: RichNode, drawer: RichNode, depth: number, indents: ListIndent[] | null): ILevelsOptions[] {
  const widths = markerWidths(list, drawer, depth, []);
  return Array.from({ length: 9 }, (_, level) => {
    const glyph = lineLevel(drawer, level, list.type === "orderedList");
    const none = "bullet" in glyph && glyph.bullet === "";
    const indent = levelIndent(level, widths[level], indents);
    return {
      level,
      ...(none
        ? { format: LevelFormat.NONE, text: "", suffix: LevelSuffix.NOTHING }
        : "bullet" in glyph
          ? { format: LevelFormat.BULLET, text: glyph.bullet }
          : {
              format: COUNTERS[glyph.counter],
              text: glyph.format.replace(/%([0-8])/g, (_, k: string) => `%${Number(k) + 1}`),
              isLegalNumberingStyle: /%\d.*%\d/.test(glyph.format) || undefined,
            }),
      start: level === depth ? Number(list.attrs?.start) || 1 : 1,
      style: { paragraph: { indent: none && !(indents && level < indents.length) ? { left: indent.left } : indent } },
    };
  });
}

/** The widest glyph of a list at each level, in twips: its lines' and
    those of the lists of its kind inside it, numbered from `above`. */
function markerWidths(list: RichNode, drawer: RichNode, depth: number, above: number[], out: number[] = []): number[] {
  const start = Number(list.attrs?.start) || 1;
  (list.content ?? []).forEach((item, i) => {
    const numbers = [...above, start + i];
    const glyph = levelMarker(lineLevel(drawer, depth, list.type === "orderedList"), numbers);
    out[depth] = Math.max(out[depth] ?? 0, glyphWidth(glyph));
    for (const child of item.content ?? []) if (child.type === list.type) markerWidths(child, drawer, depth + 1, numbers, out);
  });
  return out;
}

/** A list's lines. A list nested in a list of its kind goes one level down
    the outer list's numbering; a checklist line takes the ticked or the
    empty box, and a ticked line is struck through unless the preset says
    not. `drawer` is the list whose format draws this one: the outermost,
    or the nearest with a preset or levels of its own. */
function list(
  node: RichNode,
  ctx: Ctx,
  outer: { type: string; reference: string } | null,
  level: number,
  drawer: RichNode = node,
  indents: ListIndent[] | null = listIndentsOf(node.attrs?.listIndents),
): Block[] {
  const own = outer?.type === node.type ? outer : { type: node.type, reference: `list${ctx.numbering.length}` };
  const draws = node.attrs?.listStyle || node.attrs?.listLevels ? node : drawer;
  if (own !== outer && node.type !== "taskList") ctx.numbering.push({ reference: own.reference, levels: listLevels(node, draws, level, indents) });
  const strike = node.attrs?.listStyle !== "CHECKLIST_NO_STRIKETHROUGH";
  const out: Block[] = [];
  for (const item of node.content ?? []) {
    const ticked = item.attrs?.checked === true;
    const reference = node.type === "taskList" ? (ticked ? "ticked" : "unticked") : own.reference;
    (item.content ?? []).forEach((child, i) => {
      if (child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList") {
        out.push(...list(child, ctx, own, level + 1, draws, indents));
      } else if (child.type === "paragraph" || child.type === "heading") {
        const lineStyle = ticked && strike ? { strike: true, color: "666666" } : {};
        out.push(paragraph(child, ctx, i === 0 ? { numbering: { reference, level } } : { indent: { left: levelIndent(level, 0, indents).left } }, lineStyle));
      } else {
        out.push(...blocks([child], ctx));
      }
    });
  }
  return out;
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** A cell's side ("1 solid #000000", checked by the sanitizer); none = the grid. */
function side(value: unknown): IBorderOptions {
  if (typeof value !== "string") return { style: BorderStyle.SINGLE, size: 8, color: "000000" };
  const [width, dash, color] = value.split(" ");
  if (Number(width) === 0) return { style: BorderStyle.NONE };
  return { style: DASHES[dash] ?? BorderStyle.SINGLE, size: Math.round(Number(width) * 8), color: color.slice(1) };
}

function table(node: RichNode, ctx: Ctx): Table {
  const rows = node.content ?? [];
  // Column widths from the first row; columns without one share the rest.
  const widths = (rows[0]?.content ?? []).flatMap((cell) => {
    const set = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs.colwidth as unknown[]) : [];
    return Array.from({ length: Number(cell.attrs?.colspan) || 1 }, (_, i) => num(set[i]) ?? null);
  });
  const fixed = widths.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const open = widths.filter((w) => w === null).length;
  const share = open > 0 ? Math.max(40, (ctx.textWidth - fixed) / open) : 0;
  const columnWidths = widths.map((w) => Math.round((w ?? share) * 15));
  const align = node.attrs?.tableAlign;
  const indent = num(node.attrs?.tableIndent);
  return new Table({
    columnWidths,
    width: { size: columnWidths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
    alignment: align === "center" ? AlignmentType.CENTER : align === "right" ? AlignmentType.RIGHT : undefined,
    indent: indent && align !== "center" && align !== "right" ? { size: tw(indent), type: WidthType.DXA } : undefined,
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    rows: rows.map((row) => {
      const minHeight = num(row.attrs?.minHeight);
      return new TableRow({
        tableHeader: row.attrs?.pinned === true || undefined,
        height: minHeight ? { value: tw(minHeight), rule: HeightRule.ATLEAST } : undefined,
        children: (row.content ?? []).map((cell) => {
          const a = cell.attrs ?? {};
          const fill = wordColor(a.backgroundColor);
          const padding = num(a.padding);
          const children = blocks(cell.content, ctx);
          // Word ends every cell with a paragraph.
          if (!(children.at(-1) instanceof Paragraph)) children.push(new Paragraph({}));
          return new TableCell({
            children,
            columnSpan: Number(a.colspan) || undefined,
            rowSpan: Number(a.rowspan) || undefined,
            shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
            verticalAlign: a.valign === "middle" ? VerticalAlignTable.CENTER : a.valign === "bottom" ? VerticalAlignTable.BOTTOM : undefined,
            margins: padding === undefined ? undefined : { top: tw(padding), bottom: tw(padding), left: tw(padding), right: tw(padding) },
            borders: { top: side(a.borderTop), right: side(a.borderRight), bottom: side(a.borderBottom), left: side(a.borderLeft) },
          });
        }),
      });
    }),
  });
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function imageRun(node: RichNode, ctx: Ctx): ImageRun | null {
  const picture = ctx.pictures.get(node);
  if (!picture) return null;
  const a = node.attrs ?? {};
  // Unsized, an image is its own size, at most the text column's width.
  const width = num(a.width) ?? Math.min(picture.width, ctx.textWidth);
  const height = num(a.height) ?? (width * picture.height) / picture.width;
  const alt = typeof a.alt === "string" && a.alt ? a.alt : undefined;
  const change = changeOf(node);
  return new ImageRun({
    type: picture.type,
    data: picture.data,
    transformation: { width, height, rotation: num(a.rotation) },
    altText: alt ? { name: alt, description: alt, title: alt } : undefined,
    insertion: change?.type === "insertion" ? revision(ctx, change) : undefined,
    deletion: change?.type === "deletion" ? revision(ctx, change) : undefined,
  });
}

/** A web figure's picture takes at most the text column's width and 28rem
    of height. A row of pictures shares the width, FIGURE_GAP px apart. */
const FIGURE_MAX_HEIGHT = 448;
const FIGURE_GAP = 12;

/** A figure object (SPEC.md §30), as the page draws it: its pictures
    centered on one line, kept with its caption under them (9 pt, gray, in
    the marks a PDF figure's caption keeps). A figure with no picture (a
    video, an embed, a crop that did not render) is its caption. */
function figure(node: RichNode, ctx: Ctx): Paragraph[] {
  const { pictures, crop, printed } = ctx.figures.get(node) ?? { pictures: [], crop: false };
  const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption.trim() : "";
  const change = changeOf(node);
  const out: Paragraph[] = [];
  if (pictures.length > 0) {
    const room = (ctx.textWidth - FIGURE_GAP * (pictures.length - 1)) / pictures.length;
    const children = pictures.flatMap((picture, i) => {
      // A crop takes the size the PDF prints it at, as the page draws it;
      // any other picture keeps its own size when it fits.
      const scale =
        crop && printed
          ? Math.min(room / picture.width, printed.width / picture.width)
          : Math.min(room / picture.width, FIGURE_MAX_HEIGHT / picture.height, crop ? Infinity : 1);
      const run = new ImageRun({
        type: picture.type,
        data: picture.data,
        transformation: { width: Math.round(picture.width * scale), height: Math.round(picture.height * scale) },
        insertion: change?.type === "insertion" ? revision(ctx, change) : undefined,
        deletion: change?.type === "deletion" ? revision(ctx, change) : undefined,
      });
      return i > 0 ? [new TextRun({ text: " ", size: Math.round(FIGURE_GAP * 1.5) }), run] : [run];
    });
    out.push(
      para(ctx, {
        alignment: AlignmentType.CENTER,
        spacing: { before: tw(9), after: caption ? tw(3) : tw(9) },
        keepNext: caption ? true : undefined,
        children,
      }),
    );
  }
  if (caption) {
    // A PDF figure's caption keeps its bold label and the rest of its marks.
    const styles = captionStylesOf(node.attrs?.captionStyles) ?? [];
    const runs = captionParts(caption, styles).flatMap((part) => {
      const marks = [...(node.marks ?? []), ...part.styles.map((style) => ({ type: CAPTION_MARKS[style] }))];
      return runOf({ type: "text", text: part.text, marks }, ctx, { size: 18, color: "666666" }) ?? [];
    });
    out.push(para(ctx, { spacing: { before: pictures.length > 0 ? 0 : tw(9), after: tw(9) }, children: runs }));
  }
  return out;
}

/** A caption style's mark (lib/docs/schema.ts CaptionStyle). */
const CAPTION_MARKS: Record<CaptionStyle["style"], string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strike",
  smallCaps: "smallCaps",
  sub: "subscript",
  sup: "superscript",
};

/** The document's headings, for its tables of contents. */
function headingsOf(nodes: RichNode[] = []): { level: number; text: string; id: string }[] {
  return nodes.flatMap((node) => {
    if (node.type === "table" || node.type === "footnotes") return [];
    if (node.type !== "heading") return headingsOf(node.content);
    const text = inlineText(node);
    const id = node.attrs?.blockId;
    return text.trim() && typeof id === "string" ? [{ level: Number(node.attrs?.level) || 1, text, id }] : [];
  });
}

function blocks(nodes: RichNode[] = [], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    const a = node.attrs ?? {};
    switch (node.type) {
      case "paragraph":
      case "heading":
        out.push(paragraph(node, ctx));
        break;
      case "bulletList":
      case "orderedList":
      case "taskList":
        out.push(...list(node, ctx, null, 0));
        break;
      case "blockquote":
        for (const child of node.content ?? []) {
          if (child.type !== "paragraph" && child.type !== "heading") out.push(...blocks([child], ctx));
          // A quote that draws its own bar (an import's Word quote) keeps
          // it and its indent, as the page draws it.
          else if (typeof child.attrs?.borderLeft === "string") out.push(paragraph(child, ctx));
          else out.push(paragraph(child, ctx, { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "DADCE0", space: 12 } } }));
        }
        break;
      case "codeBlock":
        out.push(
          para(ctx, {
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "F1F3F4" },
            children: inlineText(node)
              .split("\n")
              .map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, font: "Courier New", size: 20 })),
          }),
        );
        break;
      case "horizontalRule":
        out.push(para(ctx, { border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "A0A0A0", space: 1 } } }));
        break;
      case "image": {
        const run = imageRun(node, ctx);
        out.push(para(ctx, { alignment: ALIGN[a.align as keyof typeof ALIGN], children: [run ?? new TextRun(String(a.alt ?? ""))] }));
        break;
      }
      case "blockMath":
        out.push(para(ctx, { alignment: AlignmentType.CENTER, children: [new TextRun(String(a.latex ?? ""))] }));
        break;
      case "figure":
        out.push(...figure(node, ctx));
        break;
      case "tableOfContents": {
        const levels = Array.isArray(a.levels) ? a.levels : [1, 2, 3];
        const links = a.tocStyle !== "plain" && a.tocStyle !== "dotted";
        for (const heading of headingsOf(ctx.doc.content)) {
          if (!levels.includes(heading.level)) continue;
          const run = new TextRun({ text: heading.text, style: links ? "Hyperlink" : undefined });
          out.push(
            para(ctx, {
              indent: { left: (heading.level - 1) * 360 },
              children: [links ? new InternalHyperlink({ anchor: bookmarkName("h", heading.id), children: [run] }) : run],
            }),
          );
        }
        break;
      }
      case "table":
        if (ctx.breakBefore) out.push(new Paragraph({ children: [new PageBreak()] }));
        ctx.breakBefore = false;
        out.push(table(node, ctx));
        break;
      case "pageBreak":
        ctx.breakBefore = true;
        break;
      case "footnotes":
        // Each footnote goes to Word's footnotes, under its number.
        break;
      default:
        out.push(...blocks(node.content, ctx));
    }
  }
  return out;
}

// ── Images ──────────────────────────────────────────────────────────────────

/** An image's bytes: an uploaded one from the store, any other from its address. */
async function imageBytes(src: string): Promise<Uint8Array | null> {
  const id = /^\/api\/images\/([\w-]+)$/.exec(src)?.[1];
  if (id) {
    const image = await db.imageAsset.findUnique({ where: { id }, select: { data: true } });
    return image ? new Uint8Array(image.data) : null;
  }
  if (!/^https?:\/\//i.test(src)) return null;
  try {
    const res = await outboundFetch(src, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || Number(res.headers.get("content-length")) > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length <= MAX_IMAGE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Image bytes as Word takes them: cut by `crop` (the part of each side, top
    right bottom left), and a format Word reads (anything else, an svg too,
    is redrawn as a PNG). */
async function picture(bytes: Uint8Array, crop: number[] = [0, 0, 0, 0]): Promise<Picture | null> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(Buffer.from(bytes)).catch(() => null);
  if (!image || !(image.width > 0 && image.height > 0)) return null;
  const [top, right, bottom, left] = crop;
  const type = WORD_TYPES[sniffImage(bytes) ?? ""];
  if (type && top + right + bottom + left === 0) return { data: bytes, type, width: image.width, height: image.height };
  const width = Math.max(1, Math.round(image.width * (1 - left - right)));
  const height = Math.max(1, Math.round(image.height * (1 - top - bottom)));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, image.width * left, image.height * top, width, height, 0, 0, width, height);
  return { data: canvas.toBuffer("image/png"), type: "png", width, height };
}

/** An image as Word takes it: cropped as the page shows it. */
async function pictureOf(node: RichNode): Promise<Picture | null> {
  const bytes = await imageBytes(String(node.attrs?.src ?? ""));
  if (!bytes) return null;
  const crop = ["cropTop", "cropRight", "cropBottom", "cropLeft"].map((key) => Math.min(0.95, Math.max(0, num(node.attrs?.[key]) ?? 0)));
  return picture(bytes, crop);
}

function imageNodes(node: RichNode | null | undefined): RichNode[] {
  if (!node) return [];
  return node.type === "image" ? [node] : (node.content ?? []).flatMap(imageNodes);
}

function figureNodes(node: RichNode): RichNode[] {
  return node.type === "figure" ? [node] : (node.content ?? []).flatMap(figureNodes);
}

/** A figure's pictures take this long at most: the route's time (60 s)
    keeps room for the rest of the file. A crop not started by then leaves
    its figure's caption. */
const FIGURE_RENDER_MS = 40_000;

/** A PDF figure's crop of its page, as the figure route cuts it: each page
    rendered once, one render at a time. */
function pdfCrops(pdf: Uint8Array, deadline: number) {
  const renders = new Map<string, Promise<Uint8Array | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  return async (page: number, region: Region | null): Promise<Uint8Array | null> => {
    const width = region ? CROP_PAGE_WIDTH : WHOLE_PAGE_WIDTH;
    const key = `${page}:${width}`;
    let render = renders.get(key);
    if (!render) {
      render = queue.then(() => (Date.now() < deadline ? renderPdfPage(pdf, page, width) : null)).catch(() => null);
      queue = render;
      renders.set(key, render);
    }
    const image = await render;
    if (!image || !region) return image;
    return (await cropPageRegion(image, region, { pad: CROP_PAD, scaleUp: false })) ?? image;
  };
}

/** A figure's pictures (SPEC.md §30): a PDF figure's crop of its page; a web
    figure's images, else its charts' svg. None for a video or an embed. */
async function figurePictures(
  node: RichNode,
  figures: DocxFigures,
  crop: ((page: number, region: Region | null) => Promise<Uint8Array | null>) | null,
): Promise<FigurePictures> {
  const mediaId = String(node.attrs?.mediaId ?? "");
  const media = Object.hasOwn(figures.media, mediaId) ? figures.media[mediaId] : null;
  if (!media) return { pictures: [], crop: false };
  if (media.html === null) {
    const bytes = media.page !== null && crop ? await crop(media.page, parseRegion(media.region)) : null;
    const shown = bytes ? await picture(bytes) : null;
    return { pictures: shown ? [shown] : [], crop: true, printed: media.size };
  }
  const srcs = [...media.html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)].map((m) => m[1].replaceAll("&amp;", "&"));
  // An svg in a page needs no namespace; a file of its own does.
  const svgs =
    srcs.length > 0
      ? []
      : [...media.html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map((m) =>
          /^<svg\b[^>]*\sxmlns=/.test(m[0]) ? m[0] : m[0].replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"'),
        );
  const pictures = await Promise.all([
    ...srcs.map(async (src) => {
      const image = await fetchFigureImage(src, figures.pageUrl);
      return image ? picture(image.bytes) : null;
    }),
    ...svgs.map((svg) => picture(new TextEncoder().encode(svg))),
  ]);
  return { pictures: pictures.filter((p) => p !== null), crop: false };
}

// ── The file ────────────────────────────────────────────────────────────────

function styleRun(styles: Record<DocStyle, NamedStyle>, style: DocStyle): IRunOptions {
  const s = styles[style];
  return {
    font: styleFont(styles, style),
    size: s.size * 2,
    color: s.color.slice(1),
    bold: s.bold || undefined,
    italics: s.italic || undefined,
    underline: s.underline ? {} : undefined,
  };
}

function styleParagraph(styles: Record<DocStyle, NamedStyle>, style: DocStyle, outlineLevel?: number) {
  const s = styles[style];
  return {
    alignment: ALIGN[s.align],
    spacing: { before: tw(s.spaceBefore), after: tw(s.spaceAfter), line: Math.round(s.lineSpacing * 240), lineRule: LineRuleType.AUTO },
    // The Title, the Subtitle, and the headings stay with the paragraph after them.
    ...(style === "normal" ? {} : { keepNext: true, keepLines: true, outlineLevel }),
  };
}

/** The names of the authors whose suggestions the text holds, and of the
    accounts in `more`, by author id: an account's name, or Assistant. */
async function authorNames(doc: RichNode, more: (string | null)[]): Promise<Map<string, string>> {
  const ids = new Set(more.filter((id) => id !== null));
  const walk = (node: RichNode) => {
    const change = changeOf(node);
    if (change) ids.add(suggestionAuthor(change.attrs?.id));
    node.content?.forEach(walk);
  };
  walk(doc);
  const users = await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const assistant = (await serverT())("reader.assistant");
  for (const id of ids) if (isAssistantAuthor(id)) names.set(id, assistant);
  return names;
}

/** A document's open comments in the projects `user` can open (every one
    with sign-in off), oldest first: a resolved comment stays out of the file. */
export async function docxComments(documentId: string, user: User): Promise<DocxComment[]> {
  const mine = { OR: [{ userId: user.id }, { collaborators: { some: { email: user.email } } }] };
  const here = { documentId, orphaned: false, layer: null };
  const notes = await db.note.findMany({
    where: {
      derivationType: null,
      color: null,
      resolvedById: null,
      status: { not: "REJECTED" },
      section: { hidden: true, ...(authEnabled() ? { notebook: mine } : {}) },
      sources: { some: here },
    },
    orderBy: { createdAt: "asc" },
    select: { content: true, createdAt: true, createdById: true, sources: { where: here, select: { blockId: true, startOffset: true, endOffset: true } } },
  });
  return notes.map((n) => ({ sources: n.sources, authorId: n.createdById, date: n.createdAt, text: n.content }));
}

/** The .docx of a document with rich text (a blank document or an
    import), with its comments and its figures. `origin` makes the app's
    own links whole. */
export async function richTextDocx(
  title: string,
  stored: RichNode,
  setup: PageSetup,
  origin: string,
  comments: DocxComment[] = [],
  figures: DocxFigures = { media: {}, pdf: null, pageUrl: null },
): Promise<Buffer> {
  const doc = tracked(stored);
  const styles = readStyles({ attrs: doc.attrs ?? {} });
  const shown = (hf: RichNode | null | undefined) => (setup.pageless ? null : hf);
  const parts = [doc, shown(setup.header), shown(setup.footer), shown(setup.firstHeader), shown(setup.firstFooter)];
  const images = parts.flatMap(imageNodes);
  const crop = figures.pdf ? pdfCrops(figures.pdf, Date.now() + FIGURE_RENDER_MS) : null;
  const [imageRows, figureRows] = await Promise.all([
    Promise.all(images.map(async (node) => [node, await pictureOf(node)] as const)),
    Promise.all(figureNodes(doc).map(async (node) => [node, await figurePictures(node, figures, crop)] as const)),
  ]);
  const ctx: Ctx = {
    doc,
    origin,
    textWidth: (setup.width - setup.margins.left - setup.margins.right) * PX_PER_PT,
    pictures: new Map(imageRows),
    figures: new Map(figureRows),
    footnotes: new Map(),
    numbering: [
      { reference: "unticked", levels: bulletLevels("☐") },
      { reference: "ticked", levels: bulletLevels("☑") },
    ],
    breakBefore: false,
    ids: 0,
    authors: await authorNames(doc, comments.map((c) => c.authorId)),
    cuts: new Map(),
  };
  // A comment runs from its first paragraph's anchor to its last's, in the
  // body's order; words in a footnote or a code block take none.
  const order = new Map<string, number>();
  const visit = (node: RichNode) => {
    if (node.type === "footnotes") return;
    if ((node.type === "paragraph" || node.type === "heading") && typeof node.attrs?.blockId === "string") order.set(node.attrs.blockId, order.size);
    node.content?.forEach(visit);
  };
  visit(doc);
  const placed = comments.flatMap((c) => {
    const sources = c.sources.filter((s) => order.has(s.blockId)).sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0));
    const [first, last] = [sources[0], sources.at(-1)];
    if (!first || !last) return [];
    const id = ++ctx.ids;
    for (const [blockId, cut] of [[first.blockId, { at: first.startOffset, id, end: false }], [last.blockId, { at: last.endOffset, id, end: true }]] as const) {
      ctx.cuts.set(blockId, [...(ctx.cuts.get(blockId) ?? []), cut]);
    }
    const author = ctx.authors.get(c.authorId ?? "") ?? "Unitos";
    return [{ id, author, date: c.date, children: c.text.split("\n").map((line) => new Paragraph({ children: [new TextRun(line)] })) }];
  });
  // At one offset, the words that end come before the ones that start.
  for (const cuts of ctx.cuts.values()) cuts.sort((a, b) => a.at - b.at || Number(b.end) - Number(a.end));
  const cite = (node: RichNode) => {
    if (node.type === "footnotes") return;
    const id = node.attrs?.footnoteId;
    if (node.type === "footnoteReference" && typeof id === "string" && !ctx.footnotes.has(id)) ctx.footnotes.set(id, ctx.footnotes.size + 1);
    node.content?.forEach(cite);
  };
  cite(doc);
  const body = blocks(doc.content, ctx);
  if (ctx.breakBefore) body.push(new Paragraph({ children: [new PageBreak()] }));
  ctx.breakBefore = false;
  const notes = (doc.content ?? []).filter((n) => n.type === "footnotes").flatMap((n) => n.content ?? []);
  const footnotes = Object.fromEntries(
    [...ctx.footnotes].map(([id, n]) => [
      n,
      {
        children: (notes.find((f) => f.attrs?.footnoteId === id)?.content ?? []).map((p) => paragraph(p, ctx, { style: "FootnoteText" })),
      },
    ]),
  );
  const part = (hf: RichNode | null | undefined) => {
    const children = blocks(hf?.content, ctx);
    return { children: children.length > 0 ? children : [new Paragraph({})] };
  };
  const header = shown(setup.header);
  const footer = shown(setup.footer);
  const first = setup.differentFirst && !setup.pageless;
  const landscape = setup.width > setup.height;
  const file = new DocxDocument({
    title,
    styles: {
      default: {
        document: { run: styleRun(styles, "normal"), paragraph: styleParagraph(styles, "normal") },
        title: { run: styleRun(styles, "title"), paragraph: styleParagraph(styles, "title", 0) },
        heading1: { run: styleRun(styles, "h1"), paragraph: styleParagraph(styles, "h1", 0) },
        heading2: { run: styleRun(styles, "h2"), paragraph: styleParagraph(styles, "h2", 1) },
        heading3: { run: styleRun(styles, "h3"), paragraph: styleParagraph(styles, "h3", 2) },
        heading4: { run: styleRun(styles, "h4"), paragraph: styleParagraph(styles, "h4", 3) },
        heading5: { run: styleRun(styles, "h5"), paragraph: styleParagraph(styles, "h5", 4) },
        heading6: { run: styleRun(styles, "h6"), paragraph: styleParagraph(styles, "h6", 5) },
        hyperlink: { run: { color: "1155CC", underline: {} } },
      },
      paragraphStyles: [
        {
          id: "Subtitle",
          name: "Subtitle",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: styleRun(styles, "subtitle"),
          paragraph: styleParagraph(styles, "subtitle"),
        },
      ],
    },
    numbering: { config: ctx.numbering },
    footnotes,
    comments: { children: placed },
    background: setup.color.toLowerCase() === "#ffffff" ? undefined : { color: setup.color.slice(1) },
    sections: [
      {
        properties: {
          titlePage: first || undefined,
          page: {
            // Word takes the portrait sides and turns them for landscape.
            size: {
              width: tw(Math.min(setup.width, setup.height)),
              height: tw(Math.max(setup.width, setup.height)),
              orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: tw(setup.margins.top),
              right: tw(setup.margins.right),
              bottom: tw(setup.margins.bottom),
              left: tw(setup.margins.left),
              header: tw(setup.headerMargin ?? DEFAULT_HF_MARGIN_PT),
              footer: tw(setup.footerMargin ?? DEFAULT_HF_MARGIN_PT),
            },
            pageNumbers: setup.pageNumberStart === undefined ? undefined : { start: setup.pageNumberStart },
          },
        },
        headers: {
          default: header ? new Header(part(header)) : undefined,
          first: first ? new Header(part(setup.firstHeader)) : undefined,
        },
        footers: {
          default: footer ? new Footer(part(footer)) : undefined,
          first: first ? new Footer(part(setup.firstFooter)) : undefined,
        },
        children: body,
      },
    ],
  });
  return Packer.toBuffer(file);
}
