import { z } from "zod";
import { regionSchema } from "@/lib/video/types";

// A document's rich text (SPEC.md §29): Tiptap (ProseMirror) JSON, of a blank
// document or an import. This file is the one shared description of it — the
// node and mark names, the request schema, and the sanitizer every save runs
// through. No database and no DOM here: the editor, the routes, and the sync
// all import it.

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
  // An import's: a figure object (its media in FigureMedia) and a page start.
  "figure",
  "pageStart",
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
  // An import's words set in small capitals (a theorem label, a defined term).
  "smallCaps",
  // A suggestion's (components/docs/ext/suggest.ts): on words, and on a
  // whole block.
  "insertion",
  "deletion",
  "modification",
  // An import's in-text citation: refId names its entry in Document.references.
  "citation",
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
    whose words a reader can select, plus the image, the figure object, and
    the separator. */
export const INDEXED_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "codeBlock",
  "image",
  "horizontalRule",
  "blockMath",
  "figure",
]);

/** The most characters a figure object's caption keeps. */
export const MAX_CAPTION_CHARS = 4_000;

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

// A side of a table cell ("1 solid #000000"), or of a paragraph, which may
// add the room between the line and the words ("2.5 solid #2e75b6 14").
const BORDER_SIDE = /^\d{1,2}(\.\d{1,2})? (solid|dotted|dashed) #[0-9a-fA-F]{6}( \d{1,2}(\.\d{1,2})?)?$/;
const DASHES = new Set(["solid", "dotted", "dashed"]);
/** The highest page number a page start or a figure may name. */
const MAX_PAGE = 100_000;

/** At most `max` characters, never cutting a character in two. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** A figure's region: a JSON string of the §11 percent-coordinate shape
    (lib/video/types.ts), kept as it was sent when it is one. */
function safeRegion(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 20_000) return null;
  try {
    return regionSchema.safeParse(JSON.parse(value)).success ? value : null;
  } catch {
    return null;
  }
}

const ATOM_TYPES: ReadonlySet<string> = new Set(["figure", "pageStart"]);

/** The only attributes an import's node or mark keeps: a figure object's
    media is its FigureMedia row, never markup in the rich text. */
const ONLY_ATTRS: Record<string, ReadonlySet<string>> = {
  figure: new Set(["blockId", "mediaId", "caption", "captionStyles", "page", "region", "pageStart"]),
  pageStart: new Set(["page"]),
  citation: new Set(["refId"]),
};

/** The styles a figure object's caption keeps from its page (a PDF's bold
    label, italic words, raised and lowered characters): its captionStyles,
    a JSON list of {start, end, style} over the caption's characters. The
    caption stays a plain string (FigureMedia.caption, the row's words). */
export const CAPTION_STYLES = ["bold", "italic", "underline", "strike", "smallCaps", "sub", "sup"] as const;
export type CaptionStyle = { start: number; end: number; style: (typeof CAPTION_STYLES)[number] };

/** A caption's styles from its captionStyles, or null when the value is
    not such a list. */
export function captionStylesOf(value: unknown): CaptionStyle[] | null {
  if (typeof value !== "string" || value.length > 4000) return null;
  let list: unknown;
  try {
    list = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > 100) return null;
  const styles: CaptionStyle[] = [];
  for (const item of list) {
    const { start, end, style } = (item ?? {}) as { start?: unknown; end?: unknown; style?: unknown };
    if (!Number.isInteger(start) || !Number.isInteger(end) || !CAPTION_STYLES.includes(style as CaptionStyle["style"])) return null;
    const [from, to] = [start as number, end as number];
    if (from < 0 || to <= from || to > MAX_CAPTION_CHARS) return null;
    styles.push({ start: from, end: to, style: style as CaptionStyle["style"] });
  }
  return styles;
}

/** A caption cut where its styles begin and end: each part's words and the
    styles over them. Styles past the caption's end are left out. */
export function captionParts(caption: string, styles: CaptionStyle[]): { text: string; styles: CaptionStyle["style"][] }[] {
  const cuts = [...new Set([0, caption.length, ...styles.flatMap((s) => [s.start, s.end]).filter((at) => at < caption.length)])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((from, k) => ({
    text: caption.slice(from, cuts[k + 1]),
    styles: [...new Set(styles.filter((s) => s.start <= from && s.end >= cuts[k + 1]).map((s) => s.style))],
  }));
}

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

/** A counter a list level draws its numbers in: CSS's counter styles, which
    the page draws them with (1, 01, a, A, i, I). */
export const LIST_COUNTERS = ["decimal", "decimal-leading-zero", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"] as const;
export type ListCounter = (typeof LIST_COUNTERS)[number];

/** One of a list's nine nesting levels, as the Google Docs API has it: a
    bullet's glyph, or a counter and its glyph format, the text around the
    numbers ("%0.", "(%1)", "[%0]", "%0.%1."; %k is level k's number). */
export type ListLevel = { bullet: string } | { counter: ListCounter; format: string };

/** The words around a list line's numbers ("(", ")", "A-", "1."): up to six
    letters, digits, and punctuation marks, none a quote, a backslash, or a
    percent sign. A bullet: up to three visible characters of that kind;
    none ("") draws no marker, as Google Docs' glyph type NONE (an import's
    list without markers: a bibliography, an algorithm's steps). */
const MARKER_TEXT = /^(?:(?!["\\%])[\p{L}\p{N}\p{P}]){0,6}$/u;
const BULLET_TEXT = /^[^\s"\\%\p{C}]{0,3}$/u;

/** A level's glyph format as the page can draw it: the text before the
    numbers, between them, and after. One number is the level's own (%k);
    several are levels 0 to k in order with one separator between them, as
    legal numbers are ("%0.%1.%2"). Null for any other format. */
export function formatParts(format: string, level: number): { before: string; sep: string | null; after: string } | null {
  const parts = format.split(/%([0-8])/);
  const holders = parts.filter((_, i) => i % 2 === 1).map(Number);
  const texts = parts.filter((_, i) => i % 2 === 0);
  const before = texts[0];
  const after = texts[texts.length - 1];
  if (!MARKER_TEXT.test(before) || !MARKER_TEXT.test(after)) return null;
  if (holders.length === 1) return holders[0] === level ? { before, sep: null, after } : null;
  const sep = texts[1];
  const legal =
    holders.length === level + 1 &&
    holders.every((k, i) => k === i) &&
    texts.slice(1, -1).every((t) => t === sep) &&
    sep !== "" &&
    sep.length <= 3 &&
    MARKER_TEXT.test(sep);
  return legal ? { before, sep, after } : null;
}

/** Where a list's depths stand as its page sets them (an import's
    listIndents, on the outermost list): one [left, first] pair a depth, in
    points, as a paragraph's indents (lib/parse/types.ts Indent): the
    wrapped lines' left, and the marker's place against it (negative: the
    marker hangs before the words). At most nine; the depths past them go
    on a half inch a depth. */
export type ListIndent = [left: number, first: number];

/** A list's depths from its `listIndents` (a JSON string), or null when it
    is not one to nine pairs within the page. */
export function listIndentsOf(value: unknown): ListIndent[] | null {
  if (typeof value !== "string" || value.length > 400) return null;
  let list: unknown;
  try {
    list = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > 9) return null;
  const ok = (pair: unknown): pair is ListIndent =>
    Array.isArray(pair) &&
    pair.length === 2 &&
    pair.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    pair[0] >= 0 &&
    pair[0] <= 432 &&
    pair[0] + pair[1] >= 0 &&
    pair[0] + pair[1] <= 432;
  return list.every(ok) ? list : null;
}

/** A list's nine levels from its `listLevels` (a JSON string), or null
    when it is not nine levels the page can draw: a bullet of up to three
    characters, or a known counter with a format formatParts reads. */
export function listLevelsOf(value: unknown): ListLevel[] | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  let list: unknown;
  try {
    list = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length !== 9) return null;
  const levels: ListLevel[] = [];
  for (const [k, item] of list.entries()) {
    const { bullet, counter, format } = (item ?? {}) as { bullet?: unknown; counter?: unknown; format?: unknown };
    if (typeof bullet === "string" && BULLET_TEXT.test(bullet)) levels.push({ bullet });
    else if (LIST_COUNTERS.includes(counter as ListCounter) && typeof format === "string" && formatParts(format, k)) {
      levels.push({ counter: counter as ListCounter, format });
    } else return null;
  }
  return levels;
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
    // A table cell's and a paragraph's sides, and an image's border dash.
    case "borderTop":
    case "borderRight":
    case "borderBottom":
    case "borderLeft":
      return typeof value === "string" && BORDER_SIDE.test(value) ? value : null;
    case "borderDash":
      return typeof value === "string" && DASHES.has(value) ? value : null;
    case "dropdownOptions":
      return safeDropdownOptions(value);
    // A list's own levels and depths, written the one way JSON writes them.
    case "listLevels": {
      const levels = listLevelsOf(value);
      return levels ? JSON.stringify(levels) : null;
    }
    case "listIndents": {
      const indents = listIndentsOf(value);
      return indents ? JSON.stringify(indents) : null;
    }
    case "fontFamily":
      return typeof value === "string" && FONT_FAMILY.test(value) ? value : null;
    case "fontSize":
      return typeof value === "string" && FONT_SIZE.test(value) ? value : null;
    case "textAlign":
      return typeof value === "string" && ALIGN.has(value) ? value : null;
    case "blockId":
    case "mediaId":
    case "refId":
      return typeof value === "string" && BLOCK_ID.test(value) ? value : null;
    case "caption":
      return typeof value === "string" ? clip(value, MAX_CAPTION_CHARS) : null;
    case "captionStyles": {
      const styles = captionStylesOf(value);
      return styles ? JSON.stringify(styles) : null;
    }
    case "region":
      return safeRegion(value);
    // A PDF page: a figure's, a page start's, and the page a code block, an
    // equation, or a figure begins.
    case "page":
    case "pageStart":
      return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PAGE ? value : null;
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

function cleanAttrs(attrs: Record<string, unknown> | undefined, type: string): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const only = ONLY_ATTRS[type];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!ATTR_NAME.test(key) || (only && !only.has(key))) continue;
    const clean = cleanAttr(key, value);
    out[key] = typeof clean === "string" ? wellFormed(clean) : clean;
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
  const attrs = cleanAttrs(mark.attrs, mark.type);
  if (mark.type === "link" && !attrs?.href) return null;
  if (mark.type === "citation" && !attrs?.refId) return null;
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

/** Half of a surrogate pair: a character past the Basic Multilingual Plane
    (the math letters 𝑝 and 𝒜) cut in two. */
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
let loneSurrogateLogged = false;

/** A string as the database takes it: the database client refuses a string
    that holds half of a surrogate pair, and the whole save with it. In
    development that fails with the words around it; in production the half
    is dropped and logged once. */
function wellFormed(text: string): string {
  if (text.isWellFormed()) return text;
  const at = text.search(LONE_SURROGATE_RE);
  const words = JSON.stringify(text.slice(Math.max(0, at - 60), at + 20));
  if (process.env.NODE_ENV !== "production") throw new Error(`The rich text holds half of a surrogate pair: ${words}`);
  if (!loneSurrogateLogged) console.error(`[rich text] dropped half of a surrogate pair: ${words}`);
  loneSurrogateLogged = true;
  return text.replace(LONE_SURROGATE_RE, "");
}

/** The rich text as it may be stored: unknown node and mark types dropped,
    every attribute checked (cleanAttr), a link without a safe href, an image
    without a safe src, a figure object without a mediaId, a page start
    without a page, and a citation without a refId dropped. Whether a figure
    object's media is the document's own is the save's check
    (lib/docs/sync.ts), not this one. Null when the input is not a document
    or is too large. */
export function sanitizeRichText(input: RichNode): RichNode | null {
  if (input.type !== "doc") return null;
  let count = 0;
  const walk = (node: RichNode): RichNode | null => {
    count += 1;
    if (count > MAX_NODES) return null;
    if (!NODE_TYPES.has(node.type)) return null;
    const attrs = cleanAttrs(node.attrs, node.type);
    if (node.type === "image" && !attrs?.src) return null;
    if (node.type === "figure" && !attrs?.mediaId) return null;
    if (node.type === "pageStart" && !attrs?.page) return null;
    const out: RichNode = { type: node.type };
    if (attrs && Object.keys(attrs).length > 0) out.attrs = attrs;
    // A block carries only a suggestion's marks.
    const marks = (node.marks ?? []).flatMap((m) => {
      const mark = node.type === "text" || SUGGESTION_MARK_TYPES.has(m.type) ? cleanMark(m) : null;
      return mark ? [mark] : [];
    });
    if (node.type === "text") {
      const text = node.text ? wellFormed(node.text) : "";
      if (!text) return null;
      out.text = text;
      if (marks.length > 0) out.marks = marks;
      return out;
    }
    // A figure object and a page start hold nothing.
    if (node.content && !ATOM_TYPES.has(node.type)) {
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

/** JSON with sorted keys: a value read back from a jsonb column has its
    keys in another order than the one it was written in. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The attributes whose default is null, by node and mark type, as the
    editor's schema declares them. */
export type NullDefaults = {
  nodes: Record<string, ReadonlySet<string>>;
  marks: Record<string, ReadonlySet<string>>;
};

/** The rich text without the attributes that hold their default, null: the
    form the converter writes an import in (lib/docs/import.ts) and a save
    sends (components/docs/use-docs-save.ts). Every reader sees the same
    text: the editor fills the null back in, and the others read a missing
    attribute as null. The editor's own JSON writes every attribute out,
    which grew an import's rich text by half on its first save. A default
    other than null stays written: a reader may take it only as written (an
    image's alignment in the Word export). A suggestion's marks keep all of
    theirs. */
export function compactRichText(node: RichNode, nullDefaults: NullDefaults): RichNode {
  const kept = (attrs: Record<string, unknown> | undefined, nulls: ReadonlySet<string> | undefined) => {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(attrs ?? {})) {
      if (value !== undefined && !(value === null && nulls?.has(name))) out[name] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  };
  const walk = (n: RichNode): RichNode => {
    const out: RichNode = { type: n.type };
    const attrs = kept(n.attrs, nullDefaults.nodes[n.type]);
    if (attrs) out.attrs = attrs;
    if (n.content) out.content = n.content.map(walk);
    if (n.marks) {
      out.marks = n.marks.map((mark) => {
        if (SUGGESTION_MARK_TYPES.has(mark.type)) return mark;
        const markAttrs = kept(mark.attrs, nullDefaults.marks[mark.type]);
        return markAttrs ? { type: mark.type, attrs: markAttrs } : { type: mark.type };
      });
    }
    if (n.text !== undefined) out.text = n.text;
    return out;
  };
  return walk(node);
}

/** A figure object's media as the document holds it (FigureMedia, without
    its html). */
export type FigureMediaFields = { caption: string; page: number | null; region: unknown };

/** The rich text with every figure object checked against the document's
    own media (SPEC.md §29): a figure whose mediaId is not the document's is
    dropped — a crafted save, a paste from another document — and each one
    kept takes its caption, page, and region from its media, so no save
    changes a figure's words. A container left empty keeps one empty
    paragraph. */
export function withDocumentFigures(doc: RichNode, media: ReadonlyMap<string, FigureMediaFields>): RichNode {
  const fix = (node: RichNode): RichNode | null => {
    if (node.type === "figure") {
      const found = media.get(String(node.attrs?.mediaId));
      if (!found) return null;
      const region = node.attrs?.region;
      let same = found.region == null && region == null;
      if (typeof region === "string" && found.region != null) {
        try {
          same = stableJson(JSON.parse(region)) === stableJson(found.region);
        } catch {
          same = false;
        }
      }
      const page = cleanAttr("page", found.page);
      return {
        ...node,
        attrs: {
          ...node.attrs,
          caption: clip(found.caption, MAX_CAPTION_CHARS),
          page,
          region: same ? (region ?? null) : safeRegion(found.region == null ? null : JSON.stringify(found.region)),
        },
      };
    }
    if (!node.content) return node;
    const content = node.content.map(fix).filter((c): c is RichNode => c !== null);
    if (content.length === node.content.length && content.every((c, i) => c === node.content![i])) return node;
    return { ...node, content: content.length > 0 ? content : [{ type: "paragraph", attrs: { blockId: newBlockId() } }] };
  };
  return fix(doc) ?? doc;
}

/** Whether the rich text holds a figure object. */
export function hasFigures(node: RichNode): boolean {
  return node.type === "figure" || (node.content ?? []).some(hasFigures);
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
