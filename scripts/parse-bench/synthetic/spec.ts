/**
 * Synthetic documents: one spec per document, the source of truth for its reference.
 * A spec is the reference's blocks plus layout hints. The renderers (render-tex.ts,
 * render-html.ts, render-docx.ts) draw the same blocks; `flatten` gives both the
 * renderers' walk and the reference (`referenceBlocks`, the hints dropped).
 */
import katex from "katex";
import type { Category, RefBlock, Span } from "../model";
import type { DocxLayout } from "./render-docx";
import type { HtmlLayout } from "./render-html";
import type { TexLayout } from "./render-tex";

export type Renderer = "tex" | "html" | "docx";

/** A span as a spec writes it: the reference's span plus layout hints. */
export type SpecSpan = Span & {
  /** Upright inside a theorem's italic body. */
  up?: true;
  /** A background color behind the words (HTML, Word). */
  highlight?: string;
  /** A footnote mark: `text` is the mark as printed, `footnote` the footnote's words. */
  footnote?: SpecSpan[];
  /** The box a proof ends with; LaTeX's proof environment prints it itself. */
  qed?: true;
  /** A paragraph's first word set as a drop cap (IEEEtran's \IEEEPARstart): `text` is the word as printed. */
  dropCap?: true;
};
type Part = string | SpecSpan | SpecSpan[];

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TheoremStyle = "plain" | "definition" | "remark" | "proof";
/** A paragraph a class prints from its own command (LaTeX): an author line, an abstract. */
export type Role = "author" | "affiliation" | "date" | "abstract" | "keywords" | "subtitle";
export type Align = "l" | "c" | "r";

export type SpecItem = { depth: number; marker: string; spans: SpecSpan[]; checked?: boolean };
export type SpecCell = { spans: SpecSpan[]; header?: true; colspan?: number; rowspan?: number; align?: Align };
export type SpecRow = { cells: SpecCell[]; shade?: string; rule?: true };
export type TableLayout = {
  /** booktabs: top, middle, and bottom rules; grid: every line; none: no lines. */
  rules?: "booktabs" | "grid" | "none";
  /** One letter per column: l, c, r. */
  align?: string;
  /** Relative column widths (LaTeX p-columns, Word). */
  widths?: number[];
  /** Breaks across pages; the header rows repeat at the top of each page. */
  long?: true;
  /** Printed at the foot of a page the table runs past (LaTeX longtable): furniture. */
  continued?: string;
  /** Background of the header rows. */
  shadeHeader?: string;
  small?: true;
  /** Across both columns of a two-column page. */
  wide?: true;
};

/** A drawing: vector pictures keep their words as text in the PDF (the check excuses them); a photo is pixels. */
export type Picture =
  | { kind: "diagram"; width: number; height: number; boxes: DiagramBox[]; arrows: [string, string, string?][] }
  | { kind: "bars"; width: number; height: number; title: string; unit: string; bars: [string, number][] }
  | { kind: "photo"; width: number; height: number; seed: number };
export type DiagramBox = { id: string; label: string; x: number; y: number; w: number; h: number; round?: true };

export type SpecBlock =
  | { kind: "title"; spans: SpecSpan[] }
  | { kind: "heading"; level: HeadingLevel; spans: SpecSpan[]; runIn?: true; frame?: true }
  | { kind: "paragraph"; spans: SpecSpan[]; align?: "center" | "right"; indent?: "first" | "hanging" | "block"; role?: Role; small?: true }
  | { kind: "list"; items: SpecItem[]; flush?: true }
  | { kind: "equation"; latex: string; label?: string }
  | { kind: "table"; label?: string; caption?: SpecSpan[]; rows: SpecRow[]; layout?: TableLayout }
  | { kind: "figure"; label?: string; caption?: SpecSpan[]; picture: Picture; width?: number }
  | { kind: "code"; text: string }
  | { kind: "quote"; spans: SpecSpan[]; pull?: true }
  | { kind: "separator" }
  /** Definition, Exercise, Remark, Proof: a small-caps head, then the body's blocks. */
  | { kind: "theorem"; style: TheoremStyle; head: string; blocks: SpecBlock[]; indent?: "first" }
  /** "CHAPTER 2" over the chapter's title: a centered paragraph and a level 1 heading. */
  | { kind: "chapter"; number: number; spans: SpecSpan[] }
  /** A layout box around blocks (HTML columns, a sidebar); no words of its own. */
  | { kind: "box"; name: string; blocks: SpecBlock[] }
  | { kind: "pagebreak" };

export type Spec = {
  /** The ids are `synth-<name>-<renderer>`. */
  name: string;
  /** The document's name in the PDF's metadata and the HTML <title>. */
  title: string;
  category: Category;
  blocks: SpecBlock[];
  /** One entry per rendering: the layout its renderer draws the blocks with. */
  renderings: { tex?: TexLayout; html?: HtmlLayout; docx?: DocxLayout };
  notes?: string;
};

// ---------------------------------------------------------------- builders

function spans(parts: Part[]): SpecSpan[] {
  return parts.flatMap((part) => (typeof part === "string" ? [{ text: part }] : Array.isArray(part) ? part : [part]));
}
function styled(parts: Part[], style: Partial<SpecSpan>): SpecSpan[] {
  return spans(parts).map((span) => (span.latex ? span : { ...span, ...style }));
}

export const b = (...parts: Part[]) => styled(parts, { bold: true });
export const i = (...parts: Part[]) => styled(parts, { italic: true });
export const bi = (...parts: Part[]) => styled(parts, { bold: true, italic: true });
export const u = (...parts: Part[]) => styled(parts, { underline: true });
export const sc = (...parts: Part[]) => styled(parts, { smallCaps: true });
/** Upright words inside a theorem's italic body. */
export const up = (...parts: Part[]) => styled(parts, { up: true });
export const code = (text: string): SpecSpan => ({ text, code: true });
export const link = (href: string, ...parts: Part[]) => styled(parts, { href });
export const highlight = (color: string, ...parts: Part[]) => styled(parts, { highlight: color });
/** Inline math: the reference keeps the LaTeX and its plain reading. */
export const m = (latex: string): SpecSpan => ({ text: plainReading(latex), latex });
/** A footnote mark as printed ("1") and the footnote's words. */
export const fn = (mark: string, ...parts: Part[]): SpecSpan => ({ text: mark, footnote: spans(parts) });

export const title = (...parts: Part[]): SpecBlock => ({ kind: "title", spans: spans(parts) });
export const h = (level: HeadingLevel, ...parts: Part[]): SpecBlock => ({ kind: "heading", level, spans: spans(parts) });
/** A heading printed at the start of its paragraph's first line ("1.1.1. Title. The text…"). */
export const runIn = (level: HeadingLevel, ...parts: Part[]): SpecBlock => ({ kind: "heading", level, spans: spans(parts), runIn: true });
export const chapter = (number: number, ...parts: Part[]): SpecBlock => ({ kind: "chapter", number, spans: spans(parts) });
/** A slide's title: it starts a new slide (a beamer frame). */
export const frame = (...parts: Part[]): SpecBlock => ({ kind: "heading", level: 2, spans: spans(parts), frame: true });
/** A paragraph with no first-line indent. */
export const p = (...parts: Part[]): SpecBlock => ({ kind: "paragraph", spans: spans(parts) });
/** A paragraph with a first-line indent. */
export const pi = (...parts: Part[]): SpecBlock => ({ kind: "paragraph", spans: spans(parts), indent: "first" });
export const center = (...parts: Part[]): SpecBlock => ({ kind: "paragraph", spans: spans(parts), align: "center" });
/** A paragraph a class prints from its own command; title-page lines are centered, an abstract is a block. */
export const role = (name: Role, ...parts: Part[]): SpecBlock =>
  name === "abstract" || name === "keywords" ? { kind: "paragraph", spans: spans(parts), role: name } : { kind: "paragraph", spans: spans(parts), role: name, align: "center" };
export const eq = (latex: string, label?: string): SpecBlock => (label ? { kind: "equation", latex, label } : { kind: "equation", latex });
export const codeBlock = (text: string): SpecBlock => ({ kind: "code", text });
export const quote = (...parts: Part[]): SpecBlock => ({ kind: "quote", spans: spans(parts) });
export const hr = (): SpecBlock => ({ kind: "separator" });
export const pagebreak = (): SpecBlock => ({ kind: "pagebreak" });
export const box = (name: string, ...blocks: SpecBlock[]): SpecBlock => ({ kind: "box", name, blocks });
export const theorem = (style: TheoremStyle, head: string, ...blocks: SpecBlock[]): Extract<SpecBlock, { kind: "theorem" }> => ({ kind: "theorem", style, head, blocks });

export const list = (...items: SpecItem[]): SpecBlock => ({ kind: "list", items });
/** A list whose markers stand at the margin, one item per line, no hanging indent. */
export const flushList = (...items: SpecItem[]): SpecBlock => ({ kind: "list", items, flush: true });
const item = (depth: number) => (marker: string, ...parts: Part[]): SpecItem => ({ depth, marker, spans: spans(parts) });
export const li = item(0);
export const li1 = item(1);
export const li2 = item(2);
export const li3 = item(3);
/** A task item of a checklist: the box as printed is the marker. */
export const task = (checked: boolean, ...parts: Part[]): SpecItem => ({ depth: 0, marker: checked ? "☑" : "☐", spans: spans(parts), checked });

type CellOptions = { colspan?: number; rowspan?: number; align?: Align };
type CellInput = Part | { cell: CellOptions; parts: Part[] };
function toCell(input: CellInput, header: boolean): SpecCell {
  const withOptions = typeof input === "object" && !Array.isArray(input) && "cell" in input;
  const opts: CellOptions = withOptions ? input.cell : {};
  const out: SpecCell = { spans: withOptions ? spans(input.parts) : spans([input as Part]) };
  if (header) out.header = true;
  if (opts.colspan && opts.colspan > 1) out.colspan = opts.colspan;
  if (opts.rowspan && opts.rowspan > 1) out.rowspan = opts.rowspan;
  if (opts.align) out.align = opts.align;
  return out;
}
export const row = (...cells: CellInput[]): SpecRow => ({ cells: cells.map((c) => toCell(c, false)) });
export const hrow = (...cells: CellInput[]): SpecRow => ({ cells: cells.map((c) => toCell(c, true)) });
/** A cell that spans columns or rows, or aligns apart from its column: `cell({ colspan: 2 }, "Text")`. */
export const cell = (opts: CellOptions, ...parts: Part[]): CellInput => ({ cell: opts, parts });
export const table = (opts: { label?: string; caption?: Part[]; layout?: TableLayout }, ...rows: SpecRow[]): SpecBlock => ({
  kind: "table",
  ...(opts.label ? { label: opts.label } : {}),
  ...(opts.caption ? { caption: spans(opts.caption) } : {}),
  rows,
  ...(opts.layout ? { layout: opts.layout } : {}),
});
export const figure = (opts: { label?: string; caption?: Part[]; width?: number }, picture: Picture): SpecBlock => ({
  kind: "figure",
  ...(opts.label ? { label: opts.label } : {}),
  ...(opts.caption ? { caption: spans(opts.caption) } : {}),
  picture,
  ...(opts.width ? { width: opts.width } : {}),
});

export type Slot = { cell: SpecCell; col: number } | { covered: SpecCell; col: number; last: boolean };

/** Each row's slots, with the columns a cell from a row above still covers. */
export function tableGrid(rows: SpecRow[]): { slots: Slot[][]; columns: number } {
  const below = new Map<number, { cell: SpecCell; left: number }>();
  const slots: Slot[][] = [];
  let columns = 0;
  for (const r of rows) {
    const out: Slot[] = [];
    let col = 0;
    const queue = [...r.cells];
    while (queue.length || below.has(col)) {
      const cover = below.get(col);
      if (cover) {
        out.push({ covered: cover.cell, col, last: cover.left === 1 });
        if (cover.left === 1) below.delete(col);
        else below.set(col, { ...cover, left: cover.left - 1 });
        col += cover.cell.colspan ?? 1;
        continue;
      }
      const cell = queue.shift();
      if (!cell) break;
      out.push({ cell, col });
      if ((cell.rowspan ?? 1) > 1) below.set(col, { cell, left: (cell.rowspan ?? 1) - 1 });
      col += cell.colspan ?? 1;
    }
    columns = Math.max(columns, col);
    slots.push(out);
  }
  return { slots, columns };
}

// ---------------------------------------------------------------- math

const ACCENTS: Record<string, string> = {
  "^": "\u0302", "~": "\u0303", "ˉ": "\u0304", "˘": "\u0306", "˙": "\u0307", "¨": "\u0308", "ˇ": "\u030c", "→": "\u20d7", "ˊ": "\u0301", "ˋ": "\u0300",
};
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The characters a reader sees in a formula, in order: the text of KaTeX's MathML without its TeX
    annotation; an accent over one letter becomes the letter and a combining mark. */
export function plainReading(latex: string): string {
  const mathml = katex.renderToString(latex, { output: "mathml", throwOnError: true, strict: "error" });
  const text = mathml
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<mover accent="true"><mi[^>]*>([^<]+)<\/mi><mo[^>]*>([^<]+)<\/mo><\/mover>/g, (all, base: string, accent: string) =>
      ACCENTS[accent] ? base + ACCENTS[accent] : all,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, name: string) =>
      name[0] === "#" ? String.fromCodePoint(Number.parseInt(name.slice(name[1] === "x" ? 2 : 1), name[1] === "x" ? 16 : 10)) : (ENTITIES[name] ?? all),
    )
    .replace(/[\u2061-\u2064]/g, "");
  return text.replace(/\s+/g, " ").trim().normalize("NFC");
}

// ---------------------------------------------------------------- flatten

/** A layout group around blocks: a theorem's environment or a box. */
export type Group = { id: number; kind: "theorem"; style: TheoremStyle; head: string } | { id: number; kind: "box"; name: string };

/** A reference block with its layout hints, as the renderers draw it. */
export type RenderBlock =
  | { kind: "title"; spans: SpecSpan[] }
  | { kind: "heading"; level: HeadingLevel; spans: SpecSpan[]; runIn?: true; frame?: true; chapter?: number }
  | {
      kind: "paragraph";
      spans: SpecSpan[];
      align?: "center" | "right";
      indent?: "first" | "hanging" | "block";
      role?: Role;
      small?: true;
      /** The paragraph that prints "CHAPTER 2" (the class prints it with the heading). */
      chapterLabel?: true;
      /** A theorem's head: the head span is spans[0]; "only" when the body starts with a list or a display. */
      head?: "with-body" | "only";
      /** Follows a display or a list inside one paragraph of the source: no new paragraph. */
      continues?: true;
    }
  | { kind: "list"; items: SpecItem[]; flush?: true }
  | { kind: "equation"; latex: string; label?: string }
  | { kind: "table"; caption?: SpecSpan[]; label?: string; captionText?: SpecSpan[]; rows: SpecRow[]; layout?: TableLayout }
  | { kind: "figure"; caption?: SpecSpan[]; label?: string; captionText?: SpecSpan[]; picture: Picture; width?: number }
  | { kind: "code"; text: string }
  | { kind: "quote"; spans: SpecSpan[]; pull?: true }
  | { kind: "footnote"; label: string; spans: SpecSpan[]; atMark?: true }
  | { kind: "separator" }
  | { kind: "pagebreak" };

export type Leaf = { block: RenderBlock; groups: Group[] };

export type FlattenOptions = {
  /** Where footnote blocks stand: after the block with the mark (the page's foot), or at the document's end. */
  footnotes: "after" | "end";
  /** The text a small-caps span shows in the PDF's text layer: its own letters, or capitals (fake small caps). */
  smallCaps: "keep" | "upper";
  /** How a renderer prints a caption's label before the caption ("Table 1." then the caption, one space between). */
  captionJoin?: string;
};

/** The spec's blocks in reading order, with the groups around each: the renderers' walk and the reference's source. */
export function flatten(spec: Spec, opts: FlattenOptions): Leaf[] {
  const leaves: Leaf[] = [];
  const endNotes: Leaf[] = [];
  let groupId = 0;

  const caseOf = (list: SpecSpan[]): SpecSpan[] =>
    opts.smallCaps === "upper" ? list.map((s) => (s.smallCaps && !s.latex ? { ...s, text: s.text.toUpperCase() } : s)) : list;
  // In an italic body every span but math, upright words, and footnote marks is italic.
  const bodyStyle = (list: SpecSpan[], italic: boolean): SpecSpan[] =>
    italic ? list.map((s) => (s.latex || s.up || s.footnote ? s : { ...s, italic: true })) : list;

  const push = (block: RenderBlock, groups: Group[]) => {
    const footnotes: Leaf[] = [];
    const collect = (list: SpecSpan[] | undefined) => {
      for (const s of list ?? []) if (s.footnote) footnotes.push({ block: { kind: "footnote", label: s.text, spans: caseOf(s.footnote), atMark: true }, groups });
    };
    if ("spans" in block) collect(block.spans);
    if (block.kind === "list") block.items.forEach((it) => collect(it.spans));
    if (block.kind === "table") block.rows.forEach((r) => r.cells.forEach((c) => collect(c.spans)));
    leaves.push({ block, groups });
    if (opts.footnotes === "after") leaves.push(...footnotes);
    else endNotes.push(...footnotes.map((n) => ({ ...n, groups: [] })));
  };

  const caption = (label: string | undefined, text: SpecSpan[] | undefined): SpecSpan[] | undefined => {
    if (!label) return text ? caseOf(text) : undefined;
    const labelSpan: SpecSpan = { text: label };
    return caseOf(text ? [labelSpan, { text: opts.captionJoin ?? " " }, ...text] : [labelSpan]);
  };

  const walk = (blocks: SpecBlock[], groups: Group[], italicBody: boolean) => {
    let previous: SpecBlock["kind"] | undefined;
    for (const block of blocks) {
      const after = previous;
      previous = block.kind;
      switch (block.kind) {
        case "theorem": {
          const group: Group = { id: ++groupId, kind: "theorem", style: block.style, head: block.head };
          const inner = [...groups, group];
          const italic = block.style === "plain";
          const headSpan: SpecSpan = { text: `${block.head}.`, smallCaps: true };
          const [first, ...rest] = block.blocks;
          const indent = block.indent ? { indent: block.indent } : {};
          if (first?.kind === "paragraph") {
            const body = bodyStyle(caseOf(first.spans), italic);
            const spaced = body.length && !body[0].latex ? [{ ...body[0], text: ` ${body[0].text}` }, ...body.slice(1)] : [{ text: " " }, ...body];
            push({ kind: "paragraph", spans: [...caseOf([headSpan]), ...spaced], ...indent, head: "with-body" }, inner);
            walkInner(rest, inner, italic, "paragraph");
          } else {
            push({ kind: "paragraph", spans: caseOf([headSpan]), ...indent, head: "only" }, inner);
            walkInner(block.blocks, inner, italic, "paragraph");
          }
          if (block.style === "proof") {
            const last = [...leaves].reverse().find((leaf) => leaf.groups.includes(group) && leaf.block.kind === "paragraph");
            if (!last || last.block.kind !== "paragraph") throw new Error(`${spec.name}: a proof ends with a paragraph`);
            last.block.spans = [...last.block.spans, { text: " □", qed: true }];
          }
          break;
        }
        case "box":
          walk(block.blocks, [...groups, { id: ++groupId, kind: "box", name: block.name }], italicBody);
          break;
        case "chapter":
          push({ kind: "paragraph", spans: [{ text: `CHAPTER ${block.number}` }], align: "center", chapterLabel: true }, groups);
          push({ kind: "heading", level: 1, spans: caseOf(block.spans), chapter: block.number }, groups);
          break;
        default:
          push(leafOf(block, italicBody, after), groups);
      }
    }
  };
  const walkInner = (blocks: SpecBlock[], groups: Group[], italic: boolean, start: SpecBlock["kind"]) => {
    let previous: SpecBlock["kind"] = start;
    for (const block of blocks) {
      push(leafOf(block, italic, previous), groups);
      previous = block.kind;
    }
  };

  const leafOf = (block: SpecBlock, italic: boolean, after: SpecBlock["kind"] | undefined): RenderBlock => {
    switch (block.kind) {
      case "paragraph": {
        const leaf: RenderBlock = { ...block, spans: bodyStyle(caseOf(block.spans), italic) };
        // A flush paragraph right after a display or a list continues the source's paragraph.
        if (!block.indent && !block.align && (after === "equation" || after === "list")) leaf.continues = true;
        return leaf;
      }
      case "title":
      case "quote":
        return { ...block, spans: caseOf(block.spans) };
      case "heading":
        return { ...block, spans: caseOf(block.spans) };
      case "list":
        return { ...block, items: block.items.map((it) => ({ ...it, spans: bodyStyle(caseOf(it.spans), italic) })) };
      case "table":
        return {
          ...block,
          caption: caption(block.label, block.caption),
          captionText: block.caption && caseOf(block.caption),
          rows: block.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, spans: caseOf(c.spans) })) })),
        };
      case "figure":
        return { ...block, caption: caption(block.label, block.caption), captionText: block.caption && caseOf(block.caption) };
      case "theorem":
      case "box":
      case "chapter":
        throw new Error(`${spec.name}: a ${block.kind} inside a theorem is not supported`);
      default:
        return block;
    }
  };

  walk(spec.blocks, [], false);
  return [...leaves, ...endNotes];
}

// ---------------------------------------------------------------- reference

const cleanSpan = (s: SpecSpan): Span => {
  const out: Span = { text: s.text };
  if (s.latex) out.latex = s.latex;
  if (s.bold) out.bold = true;
  if (s.italic) out.italic = true;
  if (s.underline) out.underline = true;
  if (s.code) out.code = true;
  if (s.smallCaps) out.smallCaps = true;
  if (s.href) out.href = s.href;
  return out;
};

/** Adjacent spans with the same styles become one span, so the reference reads as the page does. */
function cleanSpans(list: SpecSpan[]): Span[] {
  const out: Span[] = [];
  for (const span of list.map(cleanSpan)) {
    const last = out[out.length - 1];
    const same = (a: Span, b2: Span) =>
      !a.latex && !b2.latex && a.bold === b2.bold && a.italic === b2.italic && a.underline === b2.underline && a.code === b2.code && a.smallCaps === b2.smallCaps && a.href === b2.href;
    if (last && same(last, span)) last.text += span.text;
    else if (span.text || span.latex) out.push(span);
  }
  return out;
}

/** The reference blocks of a rendering: the leaves without layout hints. */
export function referenceBlocks(leaves: Leaf[]): RefBlock[] {
  const out: RefBlock[] = [];
  for (const { block } of leaves) {
    switch (block.kind) {
      case "title":
        out.push({ kind: "title", spans: cleanSpans(block.spans) });
        break;
      case "heading":
        out.push({ kind: "heading", level: block.level, spans: cleanSpans(block.spans) });
        break;
      case "paragraph": {
        const para: RefBlock = { kind: "paragraph", spans: cleanSpans(block.spans) };
        if (block.align) para.align = block.align;
        if (block.indent) para.indent = block.indent;
        out.push(para);
        break;
      }
      case "list":
        out.push({
          kind: "list",
          items: block.items.map((it) => ({ depth: it.depth, marker: it.marker, spans: cleanSpans(it.spans), ...(it.checked === undefined ? {} : { checked: it.checked }) })),
        });
        break;
      case "equation":
        out.push(block.label ? { kind: "equation", latex: block.latex, label: block.label } : { kind: "equation", latex: block.latex });
        break;
      case "table":
        out.push({
          kind: "table",
          ...(block.caption ? { caption: cleanSpans(block.caption) } : {}),
          rows: block.rows.map((r) => ({
            cells: r.cells.map((c) => ({
              spans: cleanSpans(c.spans),
              ...(c.header ? { header: true as const } : {}),
              ...(c.colspan ? { colspan: c.colspan } : {}),
              ...(c.rowspan ? { rowspan: c.rowspan } : {}),
            })),
          })),
        });
        break;
      case "figure":
        out.push(block.caption ? { kind: "figure", caption: cleanSpans(block.caption) } : { kind: "figure" });
        break;
      case "code":
        out.push({ kind: "code", text: block.text });
        break;
      case "quote":
        out.push({ kind: "quote", spans: cleanSpans(block.spans) });
        break;
      case "footnote":
        out.push({ kind: "footnote", label: block.label, spans: cleanSpans(block.spans) });
        break;
      case "separator":
        out.push({ kind: "separator" });
        break;
      case "pagebreak":
        break;
    }
  }
  return out;
}

/** The words a picture draws as text (a vector picture's labels); a photo has none. */
export function pictureWords(picture: Picture): string[] {
  switch (picture.kind) {
    case "diagram":
      return [...picture.boxes.map((box) => box.label), ...picture.arrows.flatMap((a) => (a[2] ? [a[2]] : []))];
    case "bars":
      return [picture.title, picture.unit, ...picture.bars.flatMap(([name, value]) => [name, String(value)])];
    case "photo":
      return [];
  }
}
