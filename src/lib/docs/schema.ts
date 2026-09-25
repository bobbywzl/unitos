import { z } from "zod";

// A blank document's rich text (SPEC.md §29): Tiptap (ProseMirror) JSON. This
// file is the one shared description of it — the node and mark names, the
// request schema, and the sanitizer every save runs through. No database and
// no DOM here: the editor, the routes, and the sync all import it.

export type RichMark = { type: string; attrs?: Record<string, unknown> };
export type RichNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
};

/** The nodes a blank document may hold. A new node type is added here, in
    the editor's extensions (components/docs/extensions.ts), and in
    lib/docs/blocks.ts when it carries text. */
export const RICH_NODE_TYPES = [
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "pageBreak",
  // A header's or a footer's fields (PageSetup.header): the page's number
  // and the page count.
  "pageNumber",
  "pageCount",
  // The insert area's nodes (components/docs/insert).
  "dateChip",
  "personChip",
  "fileChip",
  "dropdownChip",
  "bookmark",
  "footnoteReference",
  "footnotes",
  "footnote",
  "inlineMath",
  "blockMath",
  "tableOfContents",
] as const;

/** The smart chips: each draws its `label`, which is its words in the
    paragraph index (lib/docs/blocks.ts). */
export const CHIP_NODE_TYPES = new Set(["dateChip", "personChip", "fileChip", "dropdownChip"]);

export const RICH_MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "textStyle",
  "subscript",
  "superscript",
  // A suggestion's (components/docs/ext/suggest.ts): on words, and on a
  // whole block.
  "insertion",
  "deletion",
  "modification",
] as const;

/** A suggestion's marks: formatting tools leave them alone. */
export const SUGGESTION_MARK_TYPES: ReadonlySet<string> = new Set(["insertion", "deletion", "modification"]);
/** What a suggestion puts at a paragraph's edge to hold a suggested break. */
export const ZWSP = "\u200B";

/** The account id a suggestion's id ("<account id>.<ms>") names. */
export function suggestionAuthor(id: unknown): string {
  const s = String(id);
  return s.slice(0, Math.max(0, s.lastIndexOf(".")));
}

/** When a suggestion was made (ms since epoch). */
export function suggestionTime(id: unknown): number {
  const s = String(id);
  return Number(s.slice(s.lastIndexOf(".") + 1));
}

/** The nodes that hold a paragraph index row each (a Block): every node
    whose words a reader can select, plus the figure and the separator. */
export const INDEXED_NODE_TYPES = new Set(["paragraph", "heading", "codeBlock", "image", "horizontalRule", "blockMath"]);

const NODE_TYPES = new Set<string>(RICH_NODE_TYPES);
const MARK_TYPES = new Set<string>(RICH_MARK_TYPES);

/** The longest rich text a save may send, as JSON characters. */
export const MAX_RICH_TEXT_CHARS = 4_000_000;
/** The most nodes one document may hold. */
const MAX_NODES = 60_000;

const markSchema = z.object({
  type: z.string().min(1).max(40),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

export const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(40),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(richNodeSchema).max(20_000).optional(),
    marks: z.array(markSchema).max(24).optional(),
    text: z.string().max(200_000).optional(),
  }),
);

export const richDocSchema = richNodeSchema.refine((n) => n.type === "doc", { message: "not a document" });

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/;
// A face's name may be in any script (宋体, 맑은 고딕).
const FONT_FAMILY = /^[\p{L}\p{M}\p{N}_\s,'"\-.]{1,120}$/u;
const FONT_SIZE = /^\d{1,3}(\.\d{1,2})?(pt|px)$/;
const BLOCK_ID = /^[\w-]{1,64}$/;
const ALIGN = new Set(["left", "center", "right", "justify"]);

function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  const href = value.trim();
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

function safeSrc(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  if (value.startsWith("/api/images/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function safeColor(value: unknown): string | null {
  return typeof value === "string" && (HEX.test(value) || RGB.test(value)) ? value : null;
}

const CELL_BORDER = /^\d{1,2}(\.\d{1,2})? (solid|dotted|dashed) #[0-9a-fA-F]{6}$/;
const DASHES = new Set(["solid", "dotted", "dashed"]);

/** A dropdown chip's options, a JSON list of {label, color}: kept only as
    short labels with hex colors. */
function safeDropdownOptions(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const list: unknown = JSON.parse(value);
    if (!Array.isArray(list) || list.length === 0 || list.length > 50) return null;
    const clean = list.map((o: unknown) => {
      const option = o as { label?: unknown; color?: unknown };
      if (typeof option.label !== "string" || option.label.length > 200) throw new Error("label");
      if (typeof option.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(option.color)) throw new Error("color");
      return { label: option.label, color: option.color };
    });
    return JSON.stringify(clean);
  } catch {
    return null;
  }
}

/** One attribute value, kept only when it is a plain value: null, a boolean,
    a finite number, a short string, or a short list of numbers. The
    attributes that end up in a style, an href, or a src are checked by
    name, so no saved document can carry markup or a script into the page. */
function cleanAttr(name: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (name) {
    case "href":
      return safeHref(value);
    case "src":
      return safeSrc(value);
    case "color":
    case "backgroundColor":
    case "borderColor":
      return safeColor(value);
    // A table cell's side ("1 solid #000000") and an image's border dash.
    case "borderTop":
    case "borderRight":
    case "borderBottom":
    case "borderLeft":
      return typeof value === "string" && CELL_BORDER.test(value) ? value : null;
    case "borderDash":
      return typeof value === "string" && DASHES.has(value) ? value : null;
    case "dropdownOptions":
      return safeDropdownOptions(value);
    case "fontFamily":
      return typeof value === "string" && FONT_FAMILY.test(value) ? value : null;
    case "fontSize":
      return typeof value === "string" && FONT_SIZE.test(value) ? value : null;
    case "textAlign":
      return typeof value === "string" && ALIGN.has(value) ? value : null;
    case "blockId":
      return typeof value === "string" && BLOCK_ID.test(value) ? value : null;
    case "style":
    case "class":
      // Never stored: a style or a class comes from the named attributes.
      return null;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length <= 2000 ? value : null;
  if (Array.isArray(value) && value.length <= 200 && value.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return value;
  }
  return null;
}

const ATTR_NAME = /^[A-Za-z][\w-]{0,40}$/;

function cleanAttrs(attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!ATTR_NAME.test(key)) continue;
    out[key] = cleanAttr(key, value);
  }
  return out;
}

/** A suggestion's id: its author's account id and its time, "<id>.<ms>". */
const SUGGESTION_ID = /^[\w-]{1,64}\.\d{1,15}$/;

const isMarkJson = (value: unknown): value is RichMark =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

/** A mark as it may be stored, or null. */
function cleanMark(mark: RichMark): RichMark | null {
  if (!MARK_TYPES.has(mark.type)) return null;
  if (SUGGESTION_MARK_TYPES.has(mark.type)) return cleanSuggestion(mark);
  const attrs = cleanAttrs(mark.attrs);
  if (mark.type === "link" && !attrs?.href) return null;
  return attrs && Object.keys(attrs).length > 0 ? { type: mark.type, attrs } : { type: mark.type };
}

/** A suggestion keeps its id. A format change also keeps what it changed
    and its values before and after, each checked as the mark, the
    attribute, or the node type that rejecting it puts back. */
function cleanSuggestion({ type, attrs = {} }: RichMark): RichMark | null {
  const { id, type: kind, attrName, previousValue, newValue } = attrs;
  if (typeof id !== "string" || !SUGGESTION_ID.test(id)) return null;
  if (type !== "modification") return { type, attrs: { id } };
  const name = typeof attrName === "string" && ATTR_NAME.test(attrName) ? attrName : null;
  const value = (v: unknown): unknown => {
    if (kind === "mark") return isMarkJson(v) && !SUGGESTION_MARK_TYPES.has(v.type) ? cleanMark(v) : null;
    if (kind === "attr") return name ? cleanAttr(name, v) : null;
    return typeof v === "string" && NODE_TYPES.has(v) ? v : null;
  };
  if (kind !== "mark" && kind !== "attr" && kind !== "nodeType") return null;
  return { type, attrs: { id, type: kind, attrName: name, previousValue: value(previousValue), newValue: value(newValue) } };
}

/** The rich text as it may be stored: unknown node and mark types dropped,
    every attribute checked (cleanAttr), a link without a safe href and an
    image without a safe src dropped. Null when the input is not a document
    or is too large. */
export function sanitizeRichText(input: RichNode): RichNode | null {
  if (input.type !== "doc") return null;
  let count = 0;
  const walk = (node: RichNode): RichNode | null => {
    count += 1;
    if (count > MAX_NODES) return null;
    if (!NODE_TYPES.has(node.type)) return null;
    const attrs = cleanAttrs(node.attrs);
    if (node.type === "image" && !attrs?.src) return null;
    const out: RichNode = { type: node.type };
    if (attrs && Object.keys(attrs).length > 0) out.attrs = attrs;
    // A block carries only a suggestion's marks.
    const marks = (node.marks ?? []).flatMap((m) => {
      const mark = node.type === "text" || SUGGESTION_MARK_TYPES.has(m.type) ? cleanMark(m) : null;
      return mark ? [mark] : [];
    });
    if (node.type === "text") {
      if (!node.text) return null;
      out.text = node.text;
      if (marks.length > 0) out.marks = marks;
      return out;
    }
    if (node.content) {
      const content = node.content.map(walk).filter((c): c is RichNode => c !== null);
      if (count > MAX_NODES) return null;
      if (content.length > 0) out.content = content;
    }
    if (marks.length > 0) out.marks = marks;
    return out;
  };
  const doc = walk(input);
  if (!doc || count > MAX_NODES) return null;
  if (!doc.content || doc.content.length === 0) doc.content = [{ type: "paragraph" }];
  return doc;
}

/** A fresh block id for a node of the rich text: the paragraph index row
    (Block.id) takes the same id. */
export function newBlockId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `d${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20)}`;
}

/** The rich text of a new blank document: one empty paragraph. */
export function emptyRichText(blockId: string): RichNode {
  return { type: "doc", content: [{ type: "paragraph", attrs: { blockId } }] };
}

/** The page setup (Document.pageSetup), in points. Landscape is a width
    past the height; the paper size is the width and height. The fields
    after `color` came later: an older stored setup has none of them. */
export type PageSetup = {
  pageless: boolean;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  color: string;
  /** Where the header's text starts below the page's top edge, and where
      the footer's text ends above its bottom edge; absent = 36 (0.5 in). */
  headerMargin?: number;
  footerMargin?: number;
  /** The header and the footer on every page: rich text (a doc) whose
      pageNumber and pageCount nodes draw each page's number and the page
      count; absent or null = none. */
  header?: RichNode | null;
  footer?: RichNode | null;
  /** Different first page: the first page shows firstHeader and firstFooter. */
  differentFirst?: boolean;
  firstHeader?: RichNode | null;
  firstFooter?: RichNode | null;
  /** The first page's number; absent = 1. */
  pageNumberStart?: number;
};

/** Letter, 1 in margins, pages, white: a new document's page (SPEC.md §29). */
export const DEFAULT_PAGE_SETUP: PageSetup = {
  pageless: false,
  width: 612,
  height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  color: "#ffffff",
};

export const pageSetupSchema = z.object({
  pageless: z.boolean(),
  width: z.number().min(144).max(2000),
  height: z.number().min(144).max(3000),
  margins: z.object({
    top: z.number().min(0).max(700),
    right: z.number().min(0).max(700),
    bottom: z.number().min(0).max(700),
    left: z.number().min(0).max(700),
  }),
  color: z.string().regex(HEX),
  headerMargin: z.number().min(0).max(700).optional(),
  footerMargin: z.number().min(0).max(700).optional(),
  header: richDocSchema.nullable().optional(),
  footer: richDocSchema.nullable().optional(),
  differentFirst: z.boolean().optional(),
  firstHeader: richDocSchema.nullable().optional(),
  firstFooter: richDocSchema.nullable().optional(),
  pageNumberStart: z.number().int().min(0).max(999).optional(),
});

/** The stored page setup, or the default when it is missing or broken. */
export function readPageSetup(value: unknown): PageSetup {
  const parsed = pageSetupSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PAGE_SETUP;
}
