import { isAssistantSuggestion } from "@/lib/docs/assistant-suggestions";
import {
  CHIP_NODE_TYPES,
  INDEXED_NODE_TYPES,
  newBlockId,
  SUGGESTION_MARK_TYPES,
  ZWSP,
  type RichMark,
  type RichNode,
} from "@/lib/docs/schema";

// The paragraph index of a document with rich text, a blank document or an
// import (SPEC.md §29). The rich text is the document; its Block rows are
// derived from it on every save, one per node a reader can select — a
// paragraph, a heading, a list item's paragraph, a table cell's paragraph, a
// code block — plus images and figure objects (FIGURE) and horizontal lines
// (SEPARATOR). A row's id is the node's blockId and its text is the node's
// words as if every person's suggestion were accepted and every one of the
// assistant's rejected, counted as the editor's anchors count them
// (layer/anchor.ts), so an anchor captured in the editor (data-block-id +
// offsets, SPEC.md §5) resolves against the row. The same function runs in
// the editor and on the server, so both sides agree.

export type DerivedBlockType = "PARAGRAPH" | "HEADING" | "LIST" | "CODE" | "FIGURE" | "SEPARATOR" | "EQUATION";

export type StyleSpan = { start: number; end: number; style: string; quotedText: string };
export type LinkSpan = { start: number; end: number; quotedText: string; href: string };
/** An in-text citation: words of the row and their entry in Document.references. */
export type CitationSpan = { start: number; end: number; refId: string; quotedText: string };
/** A table cell's place, 1-based: the table's number in the document, the
    row, and the column of the cell's first grid slot. */
export type CellPlace = { table: number; row: number; column: number };

export type DerivedBlock = {
  id: string;
  type: DerivedBlockType;
  text: string;
  html: string | null;
  styles: StyleSpan[];
  links: LinkSpan[];
  /** The PDF page the row starts on, from the page starts before it; a
      figure object's own page. Null in a document without page starts. */
  page: number | null;
  /** A figure object's region on its page (the §11 percent-coordinate shape). */
  region: unknown | null;
  /** A figure object's FigureMedia row. */
  mediaId: string | null;
  citations: CitationSpan[];
  /** Where a row inside a table cell sits. */
  cell: CellPlace | null;
};

type Context = {
  list: "bullet" | "ordered" | "task" | null;
  quote: boolean;
  cell: CellPlace | null;
  /** The places of the cells of the table the walk is in. */
  places: Map<RichNode, { row: number; column: number }> | null;
  table: number;
};

const HEX6 = /^#[0-9a-f]{6}$/;

/** A color attribute as #rrggbb, or null when it is not one. */
export function hex6(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (HEX6.test(v)) return v;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(v);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/** The styles one run of text carries, in the Block.styles vocabulary
    (lib/text-style.ts): bold, italic, underline, code, a color, a highlight. */
function runStyles(marks: RichMark[] | undefined): string[] {
  const out: string[] = [];
  for (const mark of marks ?? []) {
    if (mark.type === "bold" || mark.type === "italic" || mark.type === "underline" || mark.type === "code") {
      out.push(mark.type);
    } else if (mark.type === "textStyle") {
      const color = hex6(mark.attrs?.color);
      if (color) out.push(`color:${color}`);
      const highlight = hex6(mark.attrs?.backgroundColor);
      if (highlight) out.push(`highlight:${highlight}`);
    }
  }
  return out;
}

/** A suggestion's mark whose words or block the paragraph index leaves out:
    a person's deletion, or the assistant's insertion. */
export const outOfIndex = (type: string, id: unknown): boolean =>
  type === "deletion" ? !isAssistantSuggestion(id) : type === "insertion" && isAssistantSuggestion(id);

/** The words of one node as the paragraph index reads them: text as it is,
    a line break (Shift+Enter) as "\n". Words a person's suggestion removes
    or the assistant's adds, and the zero-width space that holds a suggested
    paragraph break (components/docs/ext/suggest.ts), are no words. */
export function inlineText(node: RichNode): string {
  if (node.marks?.some((m) => outOfIndex(m.type, m.attrs?.id))) return "";
  if (node.type === "text") return (node.text ?? "").replaceAll(ZWSP, "");
  if (node.type === "hardBreak") return "\n";
  // A smart chip's words are its label; other atoms add none.
  if (CHIP_NODE_TYPES.has(node.type)) return typeof node.attrs?.label === "string" ? node.attrs.label : "";
  return (node.content ?? []).map(inlineText).join("");
}

/** Rich text as if the suggestions `which` picks by id (every one by
    default) were rejected: their added words and blocks go, the words they
    remove stay, a format change goes back, and the zero-width spaces of a
    suggested break go. */
export function withoutSuggestions(nodes: RichNode[], which: (id: unknown) => boolean = () => true): RichNode[] {
  const out: RichNode[] = [];
  for (const node of nodes) {
    const marks = node.marks ?? [];
    const rejected = marks.filter((m) => SUGGESTION_MARK_TYPES.has(m.type) && which(m.attrs?.id));
    if (rejected.some((m) => m.type === "insertion")) continue;
    let { type, attrs } = node;
    let kept = marks.filter((m) => !rejected.includes(m));
    for (const { type: name, attrs: change } of rejected) {
      if (name !== "modification" || !change) continue;
      if (change.type === "nodeType" && typeof change.previousValue === "string") type = change.previousValue;
      if (change.type === "attr" && typeof change.attrName === "string") attrs = { ...attrs, [change.attrName]: change.previousValue };
      if (change.type === "mark") {
        kept = kept.filter((m) => m.type !== (change.newValue as RichMark | null)?.type);
        if (change.previousValue) kept.push(change.previousValue as RichMark);
      }
    }
    const next: RichNode = { ...node, type, attrs, marks: kept };
    // A suggestion that stays keeps its zero-width spaces.
    const stays = kept.some((m) => SUGGESTION_MARK_TYPES.has(m.type));
    if (node.type === "text" && !stays) next.text = (node.text ?? "").replaceAll(ZWSP, "");
    else if (node.content) next.content = withoutSuggestions(node.content, which);
    if (next.text === "") continue;
    // Words beside words with the same marks join, as the editor holds them.
    const last = out.at(-1);
    if (next.type === "text" && last?.type === "text" && JSON.stringify(last.marks) === JSON.stringify(next.marks)) {
      last.text = `${last.text ?? ""}${next.text ?? ""}`;
    } else {
      out.push(next);
    }
  }
  return out;
}

/** The page a page start names, or null. */
function pageOf(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

type Runs = {
  text: string;
  styles: StyleSpan[];
  links: LinkSpan[];
  citations: CitationSpan[];
  /** The page starts inside the node: the words before each, and its page. */
  starts: { at: number; page: number }[];
};

function textblockRuns(node: RichNode): Runs {
  let text = "";
  const open = new Map<string, number>();
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  const citations: CitationSpan[] = [];
  const starts: Runs["starts"] = [];
  let link: { href: string; start: number } | null = null;
  let citation: { refId: string; start: number } | null = null;
  const closeLink = (at: number) => {
    if (link && at > link.start) links.push({ start: link.start, end: at, quotedText: text.slice(link.start, at), href: link.href });
    link = null;
  };
  const closeCitation = (at: number) => {
    if (citation && at > citation.start) {
      citations.push({ start: citation.start, end: at, refId: citation.refId, quotedText: text.slice(citation.start, at) });
    }
    citation = null;
  };
  const visit = (child: RichNode) => {
    // A page start adds no words; it says where a page of the PDF begins.
    if (child.type === "pageStart") {
      const page = pageOf(child.attrs?.page);
      if (page) starts.push({ at: text.length, page });
      return;
    }
    const piece = inlineText(child);
    // What adds no words (a removed word, a footnote's number) leaves the runs open.
    if (!piece) return;
    if (child.type !== "text") {
      // A line break carries no style: every open run closes before it.
      for (const [style, start] of open) {
        if (text.length > start) styles.push({ start, end: text.length, style, quotedText: text.slice(start, text.length) });
      }
      open.clear();
      closeLink(text.length);
      closeCitation(text.length);
      text += piece;
      return;
    }
    const here = new Set(runStyles(child.marks));
    for (const [style, start] of [...open]) {
      if (!here.has(style)) {
        styles.push({ start, end: text.length, style, quotedText: text.slice(start, text.length) });
        open.delete(style);
      }
    }
    for (const style of here) if (!open.has(style)) open.set(style, text.length);
    const href = child.marks?.find((m) => m.type === "link")?.attrs?.href;
    if (typeof href === "string") {
      if (!link || link.href !== href) {
        closeLink(text.length);
        link = { href, start: text.length };
      }
    } else {
      closeLink(text.length);
    }
    const refId = child.marks?.find((m) => m.type === "citation")?.attrs?.refId;
    if (typeof refId === "string") {
      if (!citation || citation.refId !== refId) {
        closeCitation(text.length);
        citation = { refId, start: text.length };
      }
    } else {
      closeCitation(text.length);
    }
    text += piece;
  };
  for (const child of node.content ?? []) visit(child);
  for (const [style, start] of open) {
    if (text.length > start) styles.push({ start, end: text.length, style, quotedText: text.slice(start, text.length) });
  }
  closeLink(text.length);
  closeCitation(text.length);
  return { text, styles, links, citations, starts };
}

/** The last page that begins inside a node: its page starts, and the pages
    that begin at a code block, an equation, or a figure. */
function lastPageIn(node: RichNode): number | null {
  let last: number | null = pageOf(node.attrs?.pageStart);
  if (node.type === "pageStart") last = pageOf(node.attrs?.page) ?? last;
  for (const child of node.content ?? []) last = lastPageIn(child) ?? last;
  return last;
}

/** Each cell of a table and its place in the table's grid: the row, and
    the column of its first slot, past the slots a cell above holds with
    its rowspan. */
function cellPlaces(table: RichNode): Map<RichNode, { row: number; column: number }> {
  const places = new Map<RichNode, { row: number; column: number }>();
  const span = (value: unknown) => Math.min(1000, Math.max(1, Math.floor(Number(value)) || 1));
  // A column, and the last row a cell above holds it to.
  const heldTo = new Map<number, number>();
  (table.content ?? []).forEach((tableRow, i) => {
    const row = i + 1;
    let column = 1;
    for (const cell of tableRow.content ?? []) {
      while ((heldTo.get(column) ?? 0) >= row) column++;
      places.set(cell, { row, column });
      const colspan = span(cell.attrs?.colspan);
      const rowspan = span(cell.attrs?.rowspan);
      if (rowspan > 1) for (let c = column; c < column + colspan; c++) heldTo.set(c, row + rowspan - 1);
      column += colspan;
    }
  });
  return places;
}

function escapeAttr(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The layout tokens a block's html opens with (block-view.tsx layoutTokens),
    so a reader that draws the index still centers and quotes. */
function tokens(node: RichNode, ctx: Context): string {
  const list: string[] = [];
  if (node.attrs?.textAlign === "center") list.push("center");
  if (ctx.quote) list.push("quote");
  return list.length > 0 ? ` class="${list.join(" ")}"` : "";
}

/** The paragraph index of a rich text, in document order. A node without a
    blockId is skipped: the editor gives every indexed node one before it
    saves, and the server refuses a save that lacks them. */
export function deriveBlocks(doc: RichNode): DerivedBlock[] {
  const out: DerivedBlock[] = [];
  // The PDF page the walk is on: the page of the last page start before it.
  let page: number | null = null;
  let tables = 0;
  const push = (ctx: Context, row: Pick<DerivedBlock, "id" | "type" | "text"> & Partial<DerivedBlock>) => {
    out.push({
      id: row.id,
      type: row.type,
      text: row.text,
      html: row.html ?? null,
      styles: row.styles ?? [],
      links: row.links ?? [],
      page: row.page !== undefined ? row.page : page,
      region: row.region ?? null,
      mediaId: row.mediaId ?? null,
      citations: row.citations ?? [],
      cell: ctx.cell,
    });
  };
  const walk = (node: RichNode, ctx: Context) => {
    // A block a person's suggestion removes is read as removed; a page that
    // begins in it still begins.
    if (node.marks?.some((m) => m.type === "deletion")) {
      page = lastPageIn(node) ?? page;
      return;
    }
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const id = node.attrs?.blockId;
      if (typeof id !== "string" || !id) {
        page = lastPageIn(node) ?? page;
        return;
      }
      // A page that begins at a code block, an equation, or a figure.
      const begins = pageOf(node.attrs?.pageStart);
      if (node.type === "image") {
        page = begins ?? page;
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        push(ctx, {
          id,
          type: "FIGURE",
          text: "",
          html: `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"></figure>`,
        });
        return;
      }
      if (node.type === "figure") {
        // A figure object: its words are its caption; its media stays in
        // FigureMedia, and the save copies the html onto the row.
        page = begins ?? page;
        const mediaId = typeof node.attrs?.mediaId === "string" ? node.attrs.mediaId : null;
        push(ctx, {
          id,
          type: "FIGURE",
          text: typeof node.attrs?.caption === "string" ? node.attrs.caption : "",
          page: pageOf(node.attrs?.page) ?? page,
          region: parseRegionAttr(node.attrs?.region),
          mediaId,
        });
        return;
      }
      if (node.type === "horizontalRule") {
        page = begins ?? page;
        push(ctx, { id, type: "SEPARATOR", text: "" });
        return;
      }
      if (node.type === "blockMath") {
        // An equation on its own line keeps its TeX.
        page = begins ?? page;
        const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
        push(ctx, { id, type: "EQUATION", text: latex });
        return;
      }
      const { text, styles, links, citations, starts } = textblockRuns(node);
      // The row starts on the page of a page start before its first word.
      const first = starts[0];
      const startsOn = begins ?? (first && !text.slice(0, first.at).trim() ? first.page : null);
      const rowPage = startsOn ?? page;
      page = starts.at(-1)?.page ?? begins ?? page;
      if (node.type === "codeBlock") {
        push(ctx, { id, type: "CODE", text, page: rowPage });
        return;
      }
      if (node.type === "heading") {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        push(ctx, { id, type: "HEADING", text, html: `<h${level}${tokens(node, ctx)}>`, styles, links, citations, page: rowPage });
        return;
      }
      // A paragraph: the Title style reads as the document's first heading,
      // a list item's paragraph as a list line.
      if (node.attrs?.docStyle === "title") {
        push(ctx, { id, type: "HEADING", text, html: `<h1${tokens(node, ctx)}>`, styles, links, citations, page: rowPage });
        return;
      }
      const html = tokens(node, ctx);
      push(ctx, {
        id,
        type: ctx.list ? "LIST" : "PARAGRAPH",
        text,
        html: html ? `<p${html}>` : null,
        styles,
        links,
        citations,
        page: rowPage,
      });
      return;
    }
    let next = ctx;
    if (node.type === "bulletList") next = { ...ctx, list: "bullet" };
    else if (node.type === "orderedList") next = { ...ctx, list: "ordered" };
    else if (node.type === "taskList") next = { ...ctx, list: "task" };
    else if (node.type === "blockquote") next = { ...ctx, quote: true };
    else if (node.type === "table") next = { ...ctx, places: cellPlaces(node), table: ++tables };
    else if (node.type === "tableCell" || node.type === "tableHeader") {
      const place = ctx.places?.get(node);
      next = { ...ctx, list: null, cell: place ? { table: ctx.table, row: place.row, column: place.column } : null };
    }
    for (const child of node.content ?? []) walk(child, next);
  };
  // The assistant's suggestions read as not made yet: their words, blocks,
  // and format changes as before them.
  for (const node of withoutSuggestions([doc], isAssistantSuggestion)) {
    walk(node, { list: null, quote: false, cell: null, places: null, table: 0 });
  }
  return out;
}

/** A figure object's region attribute (a JSON string) as the row stores
    it; null when it is not JSON. */
function parseRegionAttr(value: unknown): unknown | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Every indexed node of the rich text holds a blockId, and no two share one. */
export function hasBlockIds(doc: RichNode): boolean {
  const seen = new Set<string>();
  let ok = true;
  const walk = (node: RichNode) => {
    if (!ok) return;
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const id = node.attrs?.blockId;
      if (typeof id !== "string" || !id || seen.has(id)) {
        ok = false;
        return;
      }
      seen.add(id);
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return ok;
}

/** Give every indexed node that lacks one, or repeats one, a fresh blockId. */
export function ensureBlockIds(doc: RichNode): RichNode {
  const seen = new Set<string>();
  const walk = (node: RichNode): RichNode => {
    let out = node;
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const id = node.attrs?.blockId;
      if (typeof id !== "string" || !id || seen.has(id)) {
        const fresh = newBlockId();
        seen.add(fresh);
        out = { ...node, attrs: { ...node.attrs, blockId: fresh } };
      } else {
        seen.add(id);
      }
    }
    return out.content ? { ...out, content: out.content.map(walk) } : out;
  };
  return walk(doc);
}

// ── An older blank document: its blocks become rich text ────────────────────
// A blank document made before the page editor (SPEC.md §29) holds only
// Block rows. On first open they turn into rich text once, each paragraph
// keeping its block's id, so every anchor on it still resolves.

type OldBlock = { id: string; type: string; text: string; html: string | null; styles: unknown };

function textWithMarks(text: string, spans: { start: number; end: number; style: string }[]): RichNode[] {
  if (!text) return [];
  const bounds = new Set<number>([0, text.length]);
  for (const s of spans) {
    bounds.add(Math.max(0, Math.min(text.length, s.start)));
    bounds.add(Math.max(0, Math.min(text.length, s.end)));
  }
  const points = [...bounds].sort((a, b) => a - b);
  const out: RichNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const covering = spans.filter((s) => s.start <= from && s.end >= to);
    const marks: RichMark[] = [];
    const textStyle: Record<string, string> = {};
    for (const s of covering) {
      if (s.style === "bold" || s.style === "italic" || s.style === "underline" || s.style === "code") {
        if (!marks.some((m) => m.type === s.style)) marks.push({ type: s.style });
      } else if (s.style.startsWith("color:")) textStyle.color = s.style.slice(6);
      else if (s.style.startsWith("highlight:")) textStyle.backgroundColor = s.style.slice(10);
    }
    if (Object.keys(textStyle).length > 0) marks.push({ type: "textStyle", attrs: textStyle });
    const segment = text.slice(from, to);
    // A newline in the stored text is a line break in the paragraph.
    segment.split("\n").forEach((part, j) => {
      if (j > 0) out.push({ type: "hardBreak" });
      if (part) out.push(marks.length > 0 ? { type: "text", text: part, marks } : { type: "text", text: part });
    });
  }
  return out;
}

/** The rich text for an older blank document's blocks. */
export function richTextFromBlocks(blocks: OldBlock[]): RichNode {
  const content: RichNode[] = [];
  for (const block of blocks) {
    const spans = Array.isArray(block.styles)
      ? (block.styles as { start: number; end: number; style: string }[]).filter(
          (s) => typeof s?.start === "number" && typeof s?.end === "number" && typeof s?.style === "string",
        )
      : [];
    switch (block.type) {
      case "HEADING": {
        const level = Number(/^<h([1-6])/.exec(block.html ?? "")?.[1] ?? 2);
        content.push({ type: "heading", attrs: { level, blockId: block.id }, content: textWithMarks(block.text, spans) });
        break;
      }
      case "LIST": {
        // One list item per line, the markers taken off; the first item keeps
        // the block's id.
        const lines = block.text.split("\n").filter((l) => l.trim());
        const ordered = lines.length > 0 && /^\s*\d{1,3}[.)]\s/.test(lines[0]);
        const items = (lines.length > 0 ? lines : [""]).map((line, i) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: { blockId: i === 0 ? block.id : newBlockId() },
              content: textWithMarks(line.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, ""), []),
            },
          ],
        }));
        content.push({ type: ordered ? "orderedList" : "bulletList", content: items });
        break;
      }
      case "CODE":
        content.push({
          type: "codeBlock",
          attrs: { blockId: block.id },
          content: block.text ? [{ type: "text", text: block.text }] : [],
        });
        break;
      case "SEPARATOR":
        content.push({ type: "horizontalRule", attrs: { blockId: block.id } });
        break;
      case "FIGURE": {
        const src = /<img[^>]*\ssrc="([^"]+)"/.exec(block.html ?? "")?.[1];
        if (src) content.push({ type: "image", attrs: { src, alt: block.text, blockId: block.id } });
        break;
      }
      default:
        content.push({ type: "paragraph", attrs: { blockId: block.id }, content: textWithMarks(block.text, spans) });
    }
  }
  if (content.length === 0) content.push({ type: "paragraph", attrs: { blockId: newBlockId() } });
  return { type: "doc", content };
}

const AUTHORED_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "SEPARATOR", "FIGURE"]);

/** A blank document made before the page editor: no file, no source, no
    video, not generated, and every block written by the reader (originalText
    "" marks a user-authored block, SPEC.md §15). */
export function isOlderBlankDocument(document: {
  sourceUrl: string | null;
  fileHash: string | null;
  format: string | null;
  handwritten: boolean;
  generatedCommand: string | null;
  video: unknown;
  blocks: { type: string; originalText: string | null }[];
}): boolean {
  return (
    !document.sourceUrl &&
    !document.fileHash &&
    !document.format &&
    !document.handwritten &&
    !document.generatedCommand &&
    !document.video &&
    document.blocks.length > 0 &&
    document.blocks.every((b) => b.originalText === "" && AUTHORED_TYPES.has(b.type))
  );
}
