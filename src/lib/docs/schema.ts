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
] as const;

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
] as const;

/** The nodes that hold a paragraph index row each (a Block): every node
    whose words a reader can select, plus the figure and the separator. */
export const INDEXED_NODE_TYPES = new Set(["paragraph", "heading", "codeBlock", "image", "horizontalRule"]);

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
const FONT_FAMILY = /^[\w\s,'"\-.]{1,120}$/;
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
      return safeColor(value);
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

function cleanAttrs(attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!/^[A-Za-z][\w-]{0,40}$/.test(key)) continue;
    out[key] = cleanAttr(key, value);
  }
  return out;
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
    if (node.type === "text") {
      if (!node.text) return null;
      out.text = node.text;
      const marks = (node.marks ?? []).flatMap((m) => {
        if (!MARK_TYPES.has(m.type)) return [];
        const markAttrs = cleanAttrs(m.attrs);
        if (m.type === "link" && !markAttrs?.href) return [];
        return [markAttrs && Object.keys(markAttrs).length > 0 ? { type: m.type, attrs: markAttrs } : { type: m.type }];
      });
      if (marks.length > 0) out.marks = marks;
      return out;
    }
    if (node.content) {
      const content = node.content.map(walk).filter((c): c is RichNode => c !== null);
      if (count > MAX_NODES) return null;
      if (content.length > 0) out.content = content;
    }
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

/** The page setup (Document.pageSetup), in points. */
export type PageSetup = {
  pageless: boolean;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  color: string;
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
});

/** The stored page setup, or the default when it is missing or broken. */
export function readPageSetup(value: unknown): PageSetup {
  const parsed = pageSetupSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PAGE_SETUP;
}
