/**
 * The Word renderer: a spec's leaves → a .docx (the `docx` package) → LibreOffice's PDF export.
 * Lists use Word numbering read from the spec's markers ("1.", "1.1", "(a)", "(i)", "•"); the renderer counts
 * the way Word does and refuses a list whose printed labels would differ from the markers. A checklist's box
 * is a text glyph. The .docx is kept for a Word parser.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableBorders,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ILevelsOptions,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";
import type { Browser } from "playwright-core";
import { picturePng } from "./pictures";
import { pinDocx, pinPdf } from "./stamp";
import { tableGrid, type HeadingLevel as Level, type Leaf, type RenderBlock, type SpecItem, type SpecSpan } from "./spec";

/** A header or footer line: its parts at the left margin, the center, and the right margin. "{PAGE}" and "{PAGES}" are fields. */
export type HeaderLine = { left?: string; center?: string; right?: string };

export type DocxLayout = {
  /** The body font as Word names it; LibreOffice draws its metric twin (Times New Roman → Liberation Serif). */
  font: string;
  /** Body size in points. */
  size: number;
  headingFont?: string;
  /** Sizes in points of the title and each heading level. */
  headingSizes: Partial<Record<Level | 0, number>>;
  headingColor?: string;
  /** Headings in bold (Word's default); Google Docs sets them in the regular weight. */
  headingBold?: boolean;
  /** Space after a body paragraph, in points. */
  after?: number;
  header?: HeaderLine;
  footer?: HeaderLine;
  /** The first page's own header and footer (none when empty). */
  firstPage?: { header?: HeaderLine; footer?: HeaderLine };
  /** The page's head and foot bands in points from the top and bottom edges: what prints there is furniture. */
  bands: { top: number; bottom: number };
};

const TWIPS_PER_POINT = 20;
const PAGE_WIDTH = 12240;
const MARGIN = 1440;
const TEXT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const SYMBOL_FONT = "DejaVu Sans";
const WORD_HIGHLIGHTS = new Set(["yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray", "black"]);
/** A CSS color that is one of Word's named highlights. */
const NAMED_HIGHLIGHT: Record<string, string> = { "#ffff00": "yellow", "#00ff00": "green", "#00ffff": "cyan" };

// ---------------------------------------------------------------- numbering

type LevelKind = "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman" | "bullet";
type LevelDef = { kind: LevelKind; text: string; start: number; bullet?: string };

const ROMAN = /^[ivxlc]+$/;
const romanValue = (roman: string) => {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  for (let k = 0; k < roman.length; k++) {
    const v = values[roman[k]];
    total += v < (values[roman[k + 1]] ?? 0) ? -v : v;
  }
  return total;
};
const toRoman = (n: number) => {
  const table: [number, string][] = [[100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [value, digits] of table) {
    while (n >= value) {
      out += digits;
      n -= value;
    }
  }
  return out;
};
const toLetter = (n: number) => String.fromCharCode(96 + ((n - 1) % 26) + 1).repeat(Math.floor((n - 1) / 26) + 1);

/** A level's Word format from the markers printed at that depth ("(i)" first means roman numerals, not letters). */
function levelDef(markers: string[], depth: number): LevelDef | null {
  const first = markers[0];
  if (/^[☐☑☒]$/.test(first)) return null;
  if (first === "o" || /^[^\p{L}\p{N}]$/u.test(first)) return { kind: "bullet", text: first, start: 1, bullet: first };
  const dotted = first.match(/^(\d+(?:\.\d+)+)(\.?)$/);
  if (dotted) {
    const parts = dotted[1].split(".");
    if (parts.length !== depth + 1) throw new Error(`marker “${first}” at depth ${depth}`);
    return { kind: "decimal", text: parts.map((_, k) => `%${k + 1}`).join(".") + dotted[2], start: Number(parts[depth]) };
  }
  const m = first.match(/^(\(?)([0-9]+|[a-zA-Z]+)([.)])$/);
  if (!m) throw new Error(`no Word numbering prints the marker “${first}”`);
  const [, open, value, close] = m;
  const text = `${open}%${depth + 1}${close}`;
  if (/^\d+$/.test(value)) return { kind: "decimal", text, start: Number(value) };
  const bare = markers.map((mk) => mk.replace(/^\(|[.)]$/g, ""));
  if (ROMAN.test(value.toLowerCase()) && value.toLowerCase() === "i" && bare.every((v) => ROMAN.test(v.toLowerCase()))) {
    return { kind: value === value.toLowerCase() ? "lowerRoman" : "upperRoman", text, start: romanValue(value.toLowerCase()) };
  }
  return { kind: value === value.toLowerCase() ? "lowerLetter" : "upperLetter", text, start: value.toLowerCase().charCodeAt(0) - 96 };
}

const FORMAT: Record<LevelKind, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  decimal: LevelFormat.DECIMAL,
  lowerLetter: LevelFormat.LOWER_LETTER,
  upperLetter: LevelFormat.UPPER_LETTER,
  lowerRoman: LevelFormat.LOWER_ROMAN,
  upperRoman: LevelFormat.UPPER_ROMAN,
  bullet: LevelFormat.BULLET,
};
const formatNumber = (kind: LevelKind, n: number) =>
  kind === "decimal" ? String(n) : kind === "lowerLetter" ? toLetter(n) : kind === "upperLetter" ? toLetter(n).toUpperCase() : kind === "lowerRoman" ? toRoman(n) : toRoman(n).toUpperCase();

/** Word's numbering for one list, checked against the spec's markers by counting as Word counts. */
function listNumbering(items: SpecItem[], reference: string) {
  const depths = [...new Set(items.map((it) => it.depth))].sort((a, c) => a - c);
  const defs: (LevelDef | null)[] = [];
  for (const depth of depths) defs[depth] = levelDef(items.filter((it) => it.depth === depth).map((it) => it.marker), depth);
  const counters: number[] = [];
  for (const it of items) {
    const def = defs[it.depth];
    if (!def) continue;
    counters[it.depth] = counters[it.depth] === undefined ? def.start : counters[it.depth] + 1;
    counters.length = it.depth + 1;
    const label = def.kind === "bullet" ? def.text : def.text.replace(/%(\d)/g, (_, k: string) => formatNumber(defs[Number(k) - 1]?.kind ?? "decimal", counters[Number(k) - 1] ?? 1));
    if (label !== it.marker) throw new Error(`Word would print “${label}” where the spec says “${it.marker}”`);
  }
  const widest = (depth: number) => Math.max(...items.filter((it) => it.depth === depth).map((it) => it.marker.length));
  const levels: ILevelsOptions[] = depths.flatMap((depth) => {
    const def = defs[depth];
    if (!def) return [];
    const hanging = Math.max(360, 140 * widest(depth) + 160);
    return [
      {
        level: depth,
        format: FORMAT[def.kind],
        text: def.text,
        start: def.start,
        alignment: AlignmentType.LEFT,
        style: {
          // The marker stands 0.25 in from the margin plus 0.5 in per depth; the text a hanging indent further.
          paragraph: { indent: { left: 360 + 720 * depth + hanging, hanging } },
          ...(def.bullet && def.bullet !== "•" ? { run: { font: def.bullet === "o" ? "Courier New" : SYMBOL_FONT } } : {}),
        },
      },
    ];
  });
  return { config: { reference, levels }, numbered: (it: SpecItem) => defs[it.depth] !== null };
}

// ---------------------------------------------------------------- runs

type Context = { layout: DocxLayout; footnotes: Record<number, { children: Paragraph[] }>; footnoteCount: number };

function runs(spans: SpecSpan[], ctx: Context, base: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): ParagraphChild[] {
  return spans.flatMap((s): ParagraphChild[] => {
    if (s.latex) throw new Error("Word renderings carry no math");
    if (s.footnote) {
      const id = ++ctx.footnoteCount;
      if (s.text !== String(id)) throw new Error(`Word numbers footnotes in order: the mark “${s.text}” would print as ${id}`);
      ctx.footnotes[id] = { children: [new Paragraph({ children: runs(s.footnote, ctx, { size: ctx.layout.size - 2 }) })] };
      return [new FootnoteReferenceRun(id)];
    }
    const named = s.highlight ? (NAMED_HIGHLIGHT[s.highlight.toLowerCase()] ?? s.highlight) : undefined;
    const highlight = named && WORD_HIGHLIGHTS.has(named) ? { highlight: named as "yellow" } : named ? { shading: { type: ShadingType.CLEAR, fill: named.replace("#", ""), color: "auto" } } : {};
    // A box or bullet glyph takes a font that has it; the words around it keep the body font.
    const pieces = s.code ? [s.text] : s.text.split(/([☐☑☒▪◦●○■]+)/).filter(Boolean);
    const made = pieces.map(
      (piece) =>
        new TextRun({
          text: piece,
          bold: s.bold ?? base.bold,
          italics: s.italic ?? base.italic,
          underline: s.underline ? {} : undefined,
          smallCaps: s.smallCaps,
          ...(s.code ? { font: "Courier New" } : /^[☐☑☒▪◦●○■]+$/.test(piece) ? { font: SYMBOL_FONT } : {}),
          ...(base.size ? { size: base.size * 2 } : {}),
          ...(base.color ? { color: base.color } : {}),
          ...(s.href ? { style: "Hyperlink" } : {}),
          ...highlight,
        }),
    );
    return s.href ? [new ExternalHyperlink({ link: s.href, children: made })] : made;
  });
}

// ---------------------------------------------------------------- blocks

const ALIGN = { l: AlignmentType.LEFT, c: AlignmentType.CENTER, r: AlignmentType.RIGHT } as const;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const line = (size: number): IBorderOptions => ({ style: BorderStyle.SINGLE, size, color: "000000" });
const NO_LINE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

function docxTable(block: Extract<RenderBlock, { kind: "table" }>, ctx: Context): (Paragraph | Table)[] {
  const tl = block.layout ?? {};
  const rules = tl.rules ?? "booktabs";
  const { slots, columns } = tableGrid(block.rows);
  const headerCount = block.rows.findIndex((r) => !r.cells.some((c) => c.header));
  const headers = headerCount === -1 ? block.rows.length : headerCount;
  const weights = tl.widths ?? Array.from({ length: columns }, () => 1);
  const total = weights.reduce((a, c) => a + c, 0);
  const columnWidths = weights.map((w) => Math.round((TEXT_WIDTH * w) / total));
  const size = tl.small ? ctx.layout.size - 1 : ctx.layout.size;
  const rows = block.rows.map((r, index) => {
    const shade = r.shade ?? (index < headers ? tl.shadeHeader : undefined);
    const cols = slots[index].flatMap((slot) => ("cell" in slot ? [slot.col] : []));
    return new TableRow({
      tableHeader: index < headers ? true : undefined,
      cantSplit: true,
      children: r.cells.map(
        (c, k) =>
          new TableCell({
            children: [new Paragraph({ alignment: ALIGN[c.align ?? ((tl.align?.[cols[k]] ?? "l") as "l")], children: runs(c.spans, ctx, { size }) })],
            ...(c.colspan ? { columnSpan: c.colspan } : {}),
            ...(c.rowspan ? { rowSpan: c.rowspan } : {}),
            ...(shade ? { shading: { type: ShadingType.CLEAR, fill: shade.replace("#", ""), color: "auto" } } : {}),
            ...(rules === "booktabs" && (index === headers - 1 || r.rule) ? { borders: { bottom: line(6) } } : {}),
          }),
      ),
    });
  });
  const borders =
    rules === "grid"
      ? { top: line(4), bottom: line(4), left: line(4), right: line(4), insideHorizontal: line(4), insideVertical: line(4) }
      : rules === "none"
        ? TableBorders.NONE
        : { top: line(12), bottom: line(12), left: NO_LINE, right: NO_LINE, insideHorizontal: NO_LINE, insideVertical: NO_LINE };
  const out: (Paragraph | Table)[] = [];
  if (block.caption) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 80 }, keepNext: true, children: runs(block.caption, ctx, { size: size }) }));
  out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths, borders }));
  out.push(new Paragraph({ spacing: { after: 0 }, children: [] }));
  return out;
}

/** The document's parts from the leaves; pictures are PNG files in `pictures`, in order. */
function docxDocument(title: string, layout: DocxLayout, leaves: Leaf[], pictures: { data: Buffer; width: number; height: number }[]): Document {
  const ctx: Context = { layout, footnotes: {}, footnoteCount: 0 };
  const children: (Paragraph | Table)[] = [];
  const numbering: { reference: string; levels: ILevelsOptions[] }[] = [];
  const after = (layout.after ?? 8) * TWIPS_PER_POINT;
  let pictureIndex = 0;

  for (const { block } of leaves) {
    switch (block.kind) {
      case "title":
        children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: runs(block.spans, ctx) }));
        break;
      case "heading":
        children.push(new Paragraph({ heading: HEADINGS[block.level - 1], keepNext: true, children: runs(block.spans, ctx) }));
        break;
      case "paragraph": {
        const alignment = block.align === "center" ? AlignmentType.CENTER : block.align === "right" ? AlignmentType.RIGHT : undefined;
        const indent =
          block.indent === "first" ? { firstLine: 360 } : block.indent === "hanging" ? { left: 720, hanging: 720 } : block.indent === "block" ? { left: 720 } : undefined;
        const base = block.role === "subtitle" ? { size: layout.size + 3, color: "595959" } : block.small ? { size: layout.size - 2 } : {};
        children.push(new Paragraph({ alignment, indent, spacing: { after }, children: runs(block.spans, ctx, base) }));
        break;
      }
      case "list": {
        const reference = `list-${numbering.length + 1}`;
        const { config, numbered } = listNumbering(block.items, reference);
        if (config.levels.length) numbering.push(config);
        block.items.forEach((it, k) => {
          const spacing = { after: k === block.items.length - 1 ? after : 40 };
          if (numbered(it)) children.push(new Paragraph({ numbering: { reference, level: it.depth }, spacing, children: runs(it.spans, ctx) }));
          else {
            // A task item: its box is a glyph, then a tab to the text.
            children.push(
              new Paragraph({
                indent: { left: 720 * (it.depth + 1), hanging: 360 },
                spacing,
                children: [new TextRun({ text: it.marker, font: SYMBOL_FONT }), new TextRun({ children: [new Tab()] }), ...runs(it.spans, ctx)],
              }),
            );
          }
        });
        break;
      }
      case "table":
        children.push(...docxTable(block, ctx));
        break;
      case "figure": {
        const picture = pictures[pictureIndex++];
        const scale = Math.min(1, (TEXT_WIDTH / TWIPS_PER_POINT / 0.75) * (block.width ?? 1) / picture.width);
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            children: [new ImageRun({ type: "png", data: picture.data, transformation: { width: Math.round(picture.width * scale), height: Math.round(picture.height * scale) } })],
          }),
        );
        if (block.caption) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children: runs(block.caption, ctx, { size: layout.size - 1 }) }));
        break;
      }
      case "code":
        block.text.split("\n").forEach((codeLine, k, all) =>
          children.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" },
              spacing: { after: k === all.length - 1 ? after : 0 },
              children: [new TextRun({ text: codeLine, font: "Courier New", size: (layout.size - 2) * 2 })],
            }),
          ),
        );
        break;
      case "quote":
        children.push(new Paragraph({ indent: { left: 720, right: 720 }, border: { left: line(12) }, spacing: { after }, children: runs(block.spans, ctx) }));
        break;
      case "footnote":
        if (!block.atMark) throw new Error("a footnote block without a mark");
        break;
      case "separator":
        children.push(new Paragraph({ border: { bottom: line(6) }, spacing: { after }, children: [] }));
        break;
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "equation":
        throw new Error("Word renderings carry no display math");
    }
  }

  const headerParagraph = (parts: HeaderLine | undefined) => {
    if (!parts) return new Paragraph({ children: [] });
    const size = (layout.size - 2) * 2;
    // Each piece its own run, so the page fields take the header's size too.
    const text = (value: string | undefined) =>
      (value ?? "")
        .split(/(\{PAGE\}|\{PAGES\})/)
        .filter(Boolean)
        .map((piece) => new TextRun({ size, children: [piece === "{PAGE}" ? PageNumber.CURRENT : piece === "{PAGES}" ? PageNumber.TOTAL_PAGES : piece] }));
    return new Paragraph({
      tabStops: [
        { type: TabStopType.CENTER, position: TEXT_WIDTH / 2 },
        { type: TabStopType.RIGHT, position: TEXT_WIDTH },
      ],
      children: [...text(parts.left), new TextRun({ size, children: [new Tab()] }), ...text(parts.center), new TextRun({ size, children: [new Tab()] }), ...text(parts.right)],
    });
  };
  const heading = (level: Level | 0) => ({
    run: { font: layout.headingFont ?? layout.font, size: (layout.headingSizes[level] ?? layout.size) * 2, bold: level !== 0 && layout.headingBold !== false, color: layout.headingColor ?? "000000" },
    paragraph: { spacing: { before: level === 0 ? 0 : 240, after: 120 } },
  });
  return new Document({
    title,
    creator: "parse-bench",
    styles: {
      default: {
        document: { run: { font: layout.font, size: layout.size * 2 } },
        title: heading(0),
        heading1: heading(1),
        heading2: heading(2),
        heading3: heading(3),
        heading4: heading(4),
        hyperlink: { run: { color: "1155CC", underline: {} } },
      },
    },
    numbering: { config: numbering },
    footnotes: ctx.footnotes,
    sections: [
      {
        properties: { titlePage: Boolean(layout.firstPage), page: { margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 720, footer: 720 } } },
        headers: {
          default: new Header({ children: [headerParagraph(layout.header)] }),
          ...(layout.firstPage ? { first: new Header({ children: [headerParagraph(layout.firstPage.header)] }) } : {}),
        },
        footers: {
          default: new Footer({ children: [headerParagraph(layout.footer)] }),
          ...(layout.firstPage ? { first: new Footer({ children: [headerParagraph(layout.firstPage.footer)] }) } : {}),
        },
        children,
      },
    ],
  });
}

/** Writes the .docx into `dir`, converts it with LibreOffice, and returns the PDF's path. */
export async function renderDocx(opts: { name: string; title: string; layout: DocxLayout; leaves: Leaf[]; dir: string; browser: Browser }): Promise<string> {
  const pictures: { data: Buffer; width: number; height: number }[] = [];
  for (const { block } of opts.leaves) {
    if (block.kind !== "figure") continue;
    const file = join(opts.dir, `${opts.name}-figure-${pictures.length + 1}.png`);
    await picturePng(opts.browser, block.picture, file);
    pictures.push({ data: readFileSync(file), width: block.picture.width, height: block.picture.height });
  }
  const docxPath = join(opts.dir, `${opts.name}.docx`);
  writeFileSync(docxPath, pinDocx(await Packer.toBuffer(docxDocument(opts.title, opts.layout, opts.leaves, pictures))));
  const profile = join(opts.dir, "lo-profile");
  execFileSync("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--norestore", "--nologo", "--convert-to", "pdf", "--outdir", opts.dir, docxPath], { stdio: "pipe" });
  rmSync(profile, { recursive: true, force: true });
  pinPdf(join(opts.dir, `${opts.name}.pdf`));
  return join(opts.dir, `${opts.name}.pdf`);
}
