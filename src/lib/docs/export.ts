import {
  AlignmentType,
  Bookmark,
  BookmarkEnd,
  BookmarkStart,
  BorderStyle,
  Document as DocxDocument,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HeightRule,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
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
import { DEFAULT_HF_MARGIN_PT, PX_PER_PT } from "@/components/docs/page/geometry";
import { BULLET_PRESETS, NUMBER_PRESETS, type ListPreset } from "@/components/docs/toolbar/lists";
import { readStyles, sizeInPt, styleFont, type NamedStyle } from "@/components/docs/toolbar/styles";
import { db } from "@/lib/db";
import { hex6, inlineText } from "@/lib/docs/blocks";
import type { PageSetup, RichMark, RichNode } from "@/lib/docs/schema";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/images";
import { outboundFetch } from "@/lib/outbound-fetch";

// File > Download > Microsoft Word (.docx) (SPEC.md §29): one walk of the
// stored rich text. The named styles become Word's styles, marks become run
// properties, lists become Word numbering, and the page setup becomes the
// section. What Word has no place for (a chip, an equation) goes in as its
// words.

type Block = Paragraph | Table;
type Picture = { data: Uint8Array; type: "png" | "jpg" | "gif" | "bmp"; width: number; height: number };

type Ctx = {
  doc: RichNode;
  origin: string;
  /** The text column's width in CSS px, as the page draws it. */
  textWidth: number;
  pictures: Map<RichNode, Picture | null>;
  /** Each footnote's number, in the order the text cites them. */
  footnotes: Map<string, number>;
  numbering: { reference: string; levels: ILevelsOptions[] }[];
  /** A page break came last: the next paragraph starts a page. */
  breakBefore: boolean;
  bookmarks: number;
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
function anchor(kind: "h" | "b", id: string): string {
  return `${kind}_${id.replace(/\W/g, "_")}`.slice(0, 40);
}

/** A bookmark around `children`. docx numbers every bookmark 1, and Word
    pairs a bookmark's start and end by number, so each gets its own. */
function bookmark(ctx: Ctx, name: string, children: ParagraphChild[]): Bookmark {
  const id = ++ctx.bookmarks;
  return Object.assign(new Bookmark({ id: name, children }), { start: new BookmarkStart(name, id), end: new BookmarkEnd(id) });
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
    color: wordColor(style.color),
    size: size ? size * 2 : undefined,
    font: has("code") ? "Courier New" : (face ?? undefined),
    shading: highlight ? { type: ShadingType.CLEAR, color: "auto", fill: highlight } : undefined,
  };
}

function runOf(node: RichNode, ctx: Ctx, extra: IRunOptions): ParagraphChild | null {
  const props = { ...runStyle(node.marks), ...extra };
  switch (node.type) {
    case "text":
      return new TextRun({ ...props, children: (node.text ?? "").split("\t").flatMap((part, i) => (i > 0 ? [new Tab(), part] : [part])) });
    case "hardBreak":
      return new TextRun({ ...props, break: 1 });
    case "footnoteReference": {
      const n = ctx.footnotes.get(String(node.attrs?.footnoteId));
      return n ? new FootnoteReferenceRun(n) : null;
    }
    case "bookmark":
      return bookmark(ctx, anchor("b", String(node.attrs?.bookmarkId ?? "")), []);
    case "pageNumber":
      return new TextRun({ ...props, children: [PageNumber.CURRENT] });
    case "pageCount":
      return new TextRun({ ...props, children: [PageNumber.TOTAL_PAGES] });
    case "inlineMath":
      return new TextRun({ ...props, text: String(node.attrs?.latex ?? "") });
    default: {
      const text = inlineText(node);
      return text ? new TextRun({ ...props, text }) : null;
    }
  }
}

function hyperlink(href: string, children: ParagraphChild[], origin: string): ParagraphChild {
  const place = /^#(heading|bookmark)=([\w.-]+)$/.exec(href);
  if (place) return new InternalHyperlink({ anchor: anchor(place[1] === "heading" ? "h" : "b", place[2]), children });
  return new ExternalHyperlink({ link: href.startsWith("/") ? `${origin}${href}` : href, children });
}

/** A paragraph's words: runs, with the runs under one link in one hyperlink. */
function inline(nodes: RichNode[] = [], ctx: Ctx, extra: IRunOptions = {}): ParagraphChild[] {
  const groups: { href: string | null; runs: ParagraphChild[] }[] = [];
  for (const node of nodes) {
    const mark = node.marks?.find((m) => m.type === "link")?.attrs?.href;
    const href = typeof mark === "string" ? mark : null;
    const run = runOf(node, ctx, href ? { style: "Hyperlink", ...extra } : extra);
    if (!run) continue;
    const last = groups.at(-1);
    if (last && href && last.href === href) last.runs.push(run);
    else groups.push({ href, runs: [run] });
  }
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
  let children = inline(node.content, ctx, run);
  if (node.type === "heading" && typeof a.blockId === "string") children = [bookmark(ctx, anchor("h", a.blockId), children)];
  const stops = typeof a.tabStops === "string" ? a.tabStops.split(" ").map((stop) => stop.split(":")) : [];
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
      left: num(a.indentLeft) === undefined ? undefined : tw(a.indentLeft as number),
      right: num(a.indentRight) === undefined ? undefined : tw(a.indentRight as number),
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
    keepNext: a.keepWithNext === true || undefined,
    keepLines: a.keepLinesTogether === true || undefined,
    widowControl: a.preventSingleLines !== false,
    pageBreakBefore: a.pageBreakBefore === true || undefined,
    children,
    ...extra,
  });
}

// ── Lists ───────────────────────────────────────────────────────────────────

/** Level n sits n + 1 half inches in, its glyph a quarter inch before it. */
const levelIndent = (level: number) => ({ left: 720 * (level + 1), hanging: 360 });

function bulletLevels(glyph: string): ILevelsOptions[] {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: LevelFormat.BULLET,
    text: glyph,
    style: { paragraph: { indent: levelIndent(level) } },
  }));
}

/** A list's nine levels in its preset's glyphs; a numbered list starts at its start. */
function listLevels(list: RichNode): ILevelsOptions[] {
  const presets: ListPreset[] = list.type === "orderedList" ? NUMBER_PRESETS : BULLET_PRESETS;
  const preset = presets.find((p) => p.style === (list.attrs?.listStyle ?? null)) ?? presets[0];
  return preset.levels.map((glyph, level) => ({
    level,
    ...("bullet" in glyph
      ? { format: LevelFormat.BULLET, text: glyph.bullet }
      : "nested" in glyph
        ? { format: LevelFormat.DECIMAL, text: `${Array.from({ length: level + 1 }, (_, i) => `%${i + 1}`).join(".")}.` }
        : { format: COUNTERS[glyph.counter], text: `${glyph.before}%${level + 1}${glyph.after}` }),
    start: level === 0 ? Number(list.attrs?.start) || 1 : 1,
    style: { paragraph: { indent: levelIndent(level) } },
  }));
}

/** A list's lines. A list nested in a list of its kind goes one level down
    the outer list's numbering; a checklist line takes the ticked or the
    empty box, and a ticked line is struck through unless the preset says not. */
function list(node: RichNode, ctx: Ctx, outer: { type: string; reference: string } | null, level: number): Block[] {
  const own = outer?.type === node.type ? outer : { type: node.type, reference: `list${ctx.numbering.length}` };
  if (own !== outer && node.type !== "taskList") ctx.numbering.push({ reference: own.reference, levels: listLevels(node) });
  const strike = node.attrs?.listStyle !== "CHECKLIST_NO_STRIKETHROUGH";
  const out: Block[] = [];
  for (const item of node.content ?? []) {
    const ticked = item.attrs?.checked === true;
    const reference = node.type === "taskList" ? (ticked ? "ticked" : "unticked") : own.reference;
    (item.content ?? []).forEach((child, i) => {
      if (child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList") {
        out.push(...list(child, ctx, own, level + 1));
      } else if (child.type === "paragraph" || child.type === "heading") {
        const lineStyle = ticked && strike ? { strike: true, color: "666666" } : {};
        out.push(paragraph(child, ctx, i === 0 ? { numbering: { reference, level } } : { indent: { left: levelIndent(level).left } }, lineStyle));
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
  return new ImageRun({
    type: picture.type,
    data: picture.data,
    transformation: { width, height, rotation: num(a.rotation) },
    altText: alt ? { name: alt, description: alt, title: alt } : undefined,
  });
}

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
      case "tableOfContents": {
        const levels = Array.isArray(a.levels) ? a.levels : [1, 2, 3];
        const links = a.tocStyle !== "plain" && a.tocStyle !== "dotted";
        for (const heading of headingsOf(ctx.doc.content)) {
          if (!levels.includes(heading.level)) continue;
          const run = new TextRun({ text: heading.text, style: links ? "Hyperlink" : undefined });
          out.push(
            para(ctx, {
              indent: { left: (heading.level - 1) * 360 },
              children: [links ? new InternalHyperlink({ anchor: anchor("h", heading.id), children: [run] }) : run],
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

/** An image as Word takes it: cropped as the page shows it, and a format
    Word reads (anything else is redrawn as a PNG). */
async function pictureOf(node: RichNode): Promise<Picture | null> {
  const bytes = await imageBytes(String(node.attrs?.src ?? ""));
  if (!bytes) return null;
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(Buffer.from(bytes)).catch(() => null);
  if (!image || !(image.width > 0 && image.height > 0)) return null;
  const [top, right, bottom, left] = ["cropTop", "cropRight", "cropBottom", "cropLeft"].map((key) =>
    Math.min(0.95, Math.max(0, num(node.attrs?.[key]) ?? 0)),
  );
  const type = WORD_TYPES[sniffImage(bytes) ?? ""];
  if (type && top + right + bottom + left === 0) return { data: bytes, type, width: image.width, height: image.height };
  const width = Math.max(1, Math.round(image.width * (1 - left - right)));
  const height = Math.max(1, Math.round(image.height * (1 - top - bottom)));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, image.width * left, image.height * top, width, height, 0, 0, width, height);
  return { data: canvas.toBuffer("image/png"), type: "png", width, height };
}

function imageNodes(node: RichNode | null | undefined): RichNode[] {
  if (!node) return [];
  return node.type === "image" ? [node] : (node.content ?? []).flatMap(imageNodes);
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

/** The .docx of a blank document. `origin` makes the app's own links whole. */
export async function richTextDocx(title: string, doc: RichNode, setup: PageSetup, origin: string): Promise<Buffer> {
  const styles = readStyles({ attrs: doc.attrs ?? {} });
  const shown = (hf: RichNode | null | undefined) => (setup.pageless ? null : hf);
  const parts = [doc, shown(setup.header), shown(setup.footer), shown(setup.firstHeader), shown(setup.firstFooter)];
  const images = parts.flatMap(imageNodes);
  const ctx: Ctx = {
    doc,
    origin,
    textWidth: (setup.width - setup.margins.left - setup.margins.right) * PX_PER_PT,
    pictures: new Map(await Promise.all(images.map(async (node) => [node, await pictureOf(node)] as const))),
    footnotes: new Map(),
    numbering: [
      { reference: "unticked", levels: bulletLevels("☐") },
      { reference: "ticked", levels: bulletLevels("☑") },
    ],
    breakBefore: false,
    bookmarks: 0,
  };
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
