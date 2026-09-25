import type { Editor } from "@tiptap/core";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { z } from "zod";
import type { DocStyle } from "@/components/docs/extensions";
import { firstFamily, FONT_NAME, fontStack } from "@/components/docs/fonts";

// The document's named styles (SPEC.md §29): Google Docs' defaults, and what
// the document changed ("Update 'Heading 1' to match") stored on the doc
// node as one JSON attribute per style; an unchanged style stores nothing.

export const STYLE_ORDER: DocStyle[] = ["normal", "title", "subtitle", "h1", "h2", "h3", "h4", "h5", "h6"];

export type Align = "left" | "center" | "right" | "justify";

export type NamedStyle = {
  /** The face; a heading, the title, and the subtitle take Normal text's
      when they set none. */
  font: string | null;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  lineSpacing: number;
  spaceBefore: number;
  spaceAfter: number;
  align: Align;
};

const base = {
  font: null,
  color: "#000000",
  bold: false,
  italic: false,
  underline: false,
  lineSpacing: 1.15,
  spaceBefore: 0,
  spaceAfter: 0,
  align: "left",
} as const;

/** A new document's styles: Google Docs' defaults. */
export const DEFAULT_STYLES: Record<DocStyle, NamedStyle> = {
  normal: { ...base, font: "Arial", size: 11 },
  title: { ...base, size: 26, spaceAfter: 3 },
  subtitle: { ...base, size: 15, color: "#666666", spaceAfter: 16 },
  h1: { ...base, size: 20, spaceBefore: 20, spaceAfter: 6 },
  h2: { ...base, size: 16, spaceBefore: 18, spaceAfter: 6 },
  h3: { ...base, size: 14, color: "#434343", spaceBefore: 16, spaceAfter: 4 },
  h4: { ...base, size: 12, color: "#666666", spaceBefore: 14, spaceAfter: 4 },
  h5: { ...base, size: 11, color: "#666666", spaceBefore: 12, spaceAfter: 4 },
  h6: { ...base, size: 11, color: "#666666", italic: true, spaceBefore: 12, spaceAfter: 4 },
};

/** The doc node's attribute that holds a style's changes. */
export const STYLE_ATTR: Record<DocStyle, string> = {
  normal: "namedStyleNormal",
  title: "namedStyleTitle",
  subtitle: "namedStyleSubtitle",
  h1: "namedStyleH1",
  h2: "namedStyleH2",
  h3: "namedStyleH3",
  h4: "namedStyleH4",
  h5: "namedStyleH5",
  h6: "namedStyleH6",
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** One style's changes, as stored. Anything else in the JSON is dropped. */
const changesSchema = z
  .object({
    font: z.string().regex(FONT_NAME),
    size: z.number().min(1).max(400),
    color: z.string().regex(HEX),
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean(),
    lineSpacing: z.number().min(0.06).max(100),
    spaceBefore: z.number().min(0).max(1584),
    spaceAfter: z.number().min(0).max(1584),
    align: z.enum(["left", "center", "right", "justify"]),
  })
  .partial();

type StyleChanges = z.infer<typeof changesSchema>;

function parseChanges(value: unknown): StyleChanges {
  if (typeof value !== "string" || value.length > 2000) return {};
  try {
    const parsed = changesSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Each style's changes in the document. */
export function readChanges(doc: { attrs: Readonly<Record<string, unknown>> }): Record<DocStyle, StyleChanges> {
  const out = {} as Record<DocStyle, StyleChanges>;
  for (const style of STYLE_ORDER) out[style] = parseChanges(doc.attrs[STYLE_ATTR[style]]);
  return out;
}

/** The document's named styles: the defaults with its changes. */
export function readStyles(doc: { attrs: Readonly<Record<string, unknown>> }): Record<DocStyle, NamedStyle> {
  const changes = readChanges(doc);
  const out = {} as Record<DocStyle, NamedStyle>;
  for (const style of STYLE_ORDER) out[style] = { ...DEFAULT_STYLES[style], ...changes[style] };
  return out;
}

/** A style's face, a heading taking Normal text's when it sets none. */
export function styleFont(styles: Record<DocStyle, NamedStyle>, style: DocStyle): string {
  return styles[style].font ?? styles.normal.font ?? "Arial";
}

/** The named style of a text block: a heading's level, Title, Subtitle, or
    Normal text for every other paragraph (a list line, a table cell). */
export function blockStyle(node: PMNode): DocStyle {
  if (node.type.name === "heading") {
    const level = Number(node.attrs.level);
    return level >= 1 && level <= 6 ? (`h${level}` as DocStyle) : "h1";
  }
  const docStyle = node.attrs.docStyle;
  return docStyle === "title" || docStyle === "subtitle" ? docStyle : "normal";
}

/** A style's stored changes: the fields that differ from the default. */
function diff(style: DocStyle, value: NamedStyle): StyleChanges {
  const d = DEFAULT_STYLES[style];
  const out: StyleChanges = {};
  if (value.font !== null && value.font !== (style === "normal" ? d.font : null)) out.font = value.font;
  if (value.size !== d.size) out.size = value.size;
  if (value.color.toLowerCase() !== d.color) out.color = value.color.toLowerCase();
  if (value.bold !== d.bold) out.bold = value.bold;
  if (value.italic !== d.italic) out.italic = value.italic;
  if (value.underline !== d.underline) out.underline = value.underline;
  if (Math.abs(value.lineSpacing - d.lineSpacing) > 0.001) out.lineSpacing = value.lineSpacing;
  if (value.spaceBefore !== d.spaceBefore) out.spaceBefore = value.spaceBefore;
  if (value.spaceAfter !== d.spaceAfter) out.spaceAfter = value.spaceAfter;
  if (value.align !== d.align) out.align = value.align;
  return out;
}

/** Store a style's changes on the doc node (one undo step with the rest of
    the transaction). */
function setStyleChanges(tr: Transaction, style: DocStyle, changes: StyleChanges): Transaction {
  const json = Object.keys(changes).length > 0 ? JSON.stringify(changes) : null;
  if ((tr.doc.attrs[STYLE_ATTR[style]] ?? null) === json) return tr;
  return tr.setDocAttribute(STYLE_ATTR[style], json);
}

/** A size mark's value in points ("12pt", "16px"), or null. */
export function sizeInPt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)(pt|px)$/.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "px" ? Math.round(n * 0.75 * 2) / 2 : n;
}

type Run = { marks: readonly Mark[]; style: DocStyle };

/** The runs of the selection with their paragraph's style; a collapsed
    selection is the text the next keystroke types. */
function selectionRuns(state: EditorState): Run[] {
  const { selection, doc } = state;
  const runs: Run[] = [];
  if (!selection.empty) {
    for (const range of selection.ranges) {
      doc.nodesBetween(range.$from.pos, range.$to.pos, (node, _pos, parent) => {
        if (node.isText && parent) runs.push({ marks: node.marks, style: blockStyle(parent) });
        return true;
      });
    }
  }
  if (runs.length === 0) {
    const $from = selection.$from;
    const parent = $from.parent.isTextblock ? $from.parent : null;
    runs.push({
      marks: state.storedMarks ?? $from.marks(),
      style: parent ? blockStyle(parent) : "normal",
    });
  }
  return runs;
}

function textStyleOf(marks: Run["marks"]): Record<string, unknown> | null {
  return marks.find((m) => m.type.name === "textStyle")?.attrs ?? null;
}

/** The one value every run shares, or null when they differ. */
function shared<T>(values: T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? first : null;
}

/** The face of the selection, or null when it mixes faces. */
export function selectionFont(state: EditorState, styles: Record<DocStyle, NamedStyle>): string | null {
  return shared(
    selectionRuns(state).map((r) => firstFamily(textStyleOf(r.marks)?.fontFamily as string | undefined) ?? styleFont(styles, r.style)),
  );
}

/** The size of the selection in points, or null when it mixes sizes. */
export function selectionSize(state: EditorState, styles: Record<DocStyle, NamedStyle>): number | null {
  return shared(selectionRuns(state).map((r) => sizeInPt(textStyleOf(r.marks)?.fontSize) ?? styles[r.style].size));
}

/** The named style of the paragraphs the selection touches, or null when
    they differ. */
export function selectionStyle(state: EditorState): DocStyle | null {
  const { from, to, $from } = state.selection;
  const found: DocStyle[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isTextblock) {
      found.push(blockStyle(node));
      return false;
    }
    return true;
  });
  if (found.length === 0) return $from.parent.isTextblock ? blockStyle($from.parent) : "normal";
  return shared(found);
}

/** The document uses a style: Heading 4 shows in the menu once a Heading 3
    or deeper is in the text, Heading 5 once a Heading 4, Heading 6 once a
    Heading 5. */
export function deepestHeading(doc: PMNode): number {
  let deepest = 0;
  doc.descendants((node) => {
    if (node.type.name === "heading") deepest = Math.max(deepest, Number(node.attrs.level) || 0);
    return !node.isTextblock;
  });
  return deepest;
}

/** The formatting at the caret, as a named style (Update 'X' to match). */
function styleAtCaret(state: EditorState, style: DocStyle): NamedStyle {
  const styles = readStyles(state.doc);
  const current = styles[style];
  const $from = state.selection.$from;
  const marks = state.storedMarks ?? $from.marks();
  const text = textStyleOf(marks);
  const block = $from.parent;
  const has = (name: string) => marks.some((m) => m.type.name === name);
  const align = block.attrs.textAlign;
  const font = firstFamily(text?.fontFamily as string | undefined);
  return {
    font: font ?? current.font,
    size: sizeInPt(text?.fontSize) ?? current.size,
    color: typeof text?.color === "string" && HEX.test(text.color) ? text.color.toLowerCase() : current.color,
    bold: has("bold") || current.bold,
    italic: has("italic") || current.italic,
    underline: has("underline") || current.underline,
    lineSpacing: typeof block.attrs.lineSpacing === "number" ? block.attrs.lineSpacing : current.lineSpacing,
    spaceBefore: typeof block.attrs.spaceBefore === "number" ? block.attrs.spaceBefore : current.spaceBefore,
    spaceAfter: typeof block.attrs.spaceAfter === "number" ? block.attrs.spaceAfter : current.spaceAfter,
    align: align === "center" || align === "right" || align === "justify" || align === "left" ? align : current.align,
  };
}

/** Update 'Heading 1' to match: the style takes the formatting at the
    caret, every paragraph with the style follows, and the caret's
    paragraph drops the formatting that is now its style's. */
export function updateStyleToMatch(editor: Editor, style: DocStyle): void {
  const { state } = editor;
  const next = styleAtCaret(state, style);
  const tr = setStyleChanges(state.tr, style, diff(style, next));
  const $from = state.selection.$from;
  const block = $from.parent;
  if (block.isTextblock && blockStyle(block) === style) {
    const start = $from.start();
    const { marks } = state.schema;
    block.forEach((child, offset) => {
      if (!child.isText) return;
      const from = start + offset;
      const to = from + child.nodeSize;
      const ts = child.marks.find((m) => m.type.name === "textStyle");
      if (ts && marks.textStyle) {
        const attrs = { ...ts.attrs };
        if (firstFamily(attrs.fontFamily as string | undefined) === next.font) attrs.fontFamily = null;
        if (sizeInPt(attrs.fontSize) === next.size) attrs.fontSize = null;
        if (typeof attrs.color === "string" && attrs.color.toLowerCase() === next.color) attrs.color = null;
        tr.removeMark(from, to, marks.textStyle);
        if (Object.values(attrs).some((v) => v !== null && v !== undefined)) {
          tr.addMark(from, to, marks.textStyle.create(attrs));
        }
      }
      if (next.bold && marks.bold) tr.removeMark(from, to, marks.bold);
      if (next.italic && marks.italic) tr.removeMark(from, to, marks.italic);
      if (next.underline && marks.underline) tr.removeMark(from, to, marks.underline);
    });
    const pos = $from.before();
    tr.setNodeMarkup(pos, undefined, {
      ...block.attrs,
      lineSpacing: null,
      spaceBefore: null,
      spaceAfter: null,
      textAlign: null,
    });
  }
  editor.view.dispatch(tr);
}

/** Every style's changes set at once (Use my default styles, Reset styles). */
export function replaceAllChanges(editor: Editor, changes: Partial<Record<DocStyle, StyleChanges>>): void {
  let tr = editor.state.tr;
  for (const style of STYLE_ORDER) tr = setStyleChanges(tr, style, changes[style] ?? {});
  if (tr.docChanged) editor.view.dispatch(tr);
}

const DEFAULTS_KEY = "unitos-docs-default-styles";

/** Save as my default styles: kept in this browser. */
export function saveDefaultStyles(doc: PMNode): void {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(readChanges(doc)));
  } catch {
    // Private mode: nothing is kept.
  }
}

/** The styles saved with Save as my default styles; none saved = Google
    Docs' defaults. */
export function savedDefaultStyles(): Partial<Record<DocStyle, StyleChanges>> {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<DocStyle, StyleChanges>> = {};
    for (const style of STYLE_ORDER) {
      const value = (parsed as Record<string, unknown>)[style];
      const checked = changesSchema.safeParse(value);
      if (checked.success) out[style] = checked.data;
    }
    return out;
  } catch {
    return {};
  }
}

/** Where each named style's paragraphs are in the page. */
const STYLE_SELECTOR: Record<DocStyle, string> = {
  normal: "p:not([data-doc-style])",
  title: 'p[data-doc-style="title"]',
  subtitle: 'p[data-doc-style="subtitle"]',
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
};

/** The CSS that draws the document's changes to its named styles in the
    editor `root` (a selector); an unchanged style leaves the page's own
    rules. Normal text's face, size, and color go on the root, so lists,
    tables, and headings without a face of their own take them. A
    paragraph's own spacing and alignment still win: they are inline. */
export function namedStyleSheet(doc: PMNode, root: string): string {
  const changes = readChanges(doc);
  const rules: string[] = [];
  const rule = (selector: string, decls: (string | false | undefined)[]) => {
    const list = decls.filter(Boolean);
    if (list.length > 0) rules.push(`${root} ${selector} { ${list.join("; ")} }`);
  };
  for (const style of STYLE_ORDER) {
    const c = changes[style];
    const face = [c.font && `font-family: ${fontStack(c.font)}`, c.size !== undefined && `font-size: ${c.size}pt`, c.color && `color: ${c.color}`];
    const paragraph = [
      c.bold !== undefined && `font-weight: ${c.bold ? 700 : 400}`,
      c.italic !== undefined && `font-style: ${c.italic ? "italic" : "normal"}`,
      c.underline !== undefined && `text-decoration-line: ${c.underline ? "underline" : "none"}`,
      c.lineSpacing !== undefined && `line-height: calc(var(--docs-ls, ${c.lineSpacing}) * 1.15)`,
      c.spaceBefore !== undefined && `padding-top: ${c.spaceBefore}pt`,
      c.spaceAfter !== undefined && `padding-bottom: ${c.spaceAfter}pt`,
      c.align && `text-align: ${c.align}`,
    ];
    if (style === "normal") rule("", face);
    rule(STYLE_SELECTOR[style], style === "normal" ? paragraph : [...face, ...paragraph]);
  }
  if (rules.length > 0) rules.push(`${root} > :first-child { padding-top: 0 }`);
  return rules.join("\n");
}
