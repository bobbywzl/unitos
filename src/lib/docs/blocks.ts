import { CHIP_NODE_TYPES, INDEXED_NODE_TYPES, newBlockId, type RichMark, type RichNode } from "@/lib/docs/schema";

// The paragraph index of a blank document (SPEC.md §29). The rich text is the
// document; its Block rows are derived from it on every save, one per node a
// reader can select — a paragraph, a heading, a list item's paragraph, a
// table cell's paragraph, a code block — plus images (FIGURE) and horizontal
// lines (SEPARATOR). A row's id is the node's blockId and its text is the
// node's words exactly as the editor draws them, so an anchor captured in the
// editor (data-block-id + offsets, SPEC.md §5) resolves against the row. The
// same function runs in the editor and on the server, so both sides agree.

export type DerivedBlockType = "PARAGRAPH" | "HEADING" | "LIST" | "CODE" | "FIGURE" | "SEPARATOR" | "EQUATION";

export type StyleSpan = { start: number; end: number; style: string; quotedText: string };
export type LinkSpan = { start: number; end: number; quotedText: string; href: string };

export type DerivedBlock = {
  id: string;
  type: DerivedBlockType;
  text: string;
  html: string | null;
  styles: StyleSpan[];
  links: LinkSpan[];
};

type Context = { list: "bullet" | "ordered" | "task" | null; quote: boolean; cell: boolean };

const HEX6 = /^#[0-9a-f]{6}$/;

/** A color attribute as #rrggbb, or null when it is not one. */
function hex6(value: unknown): string | null {
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

/** The words of one node as the editor draws them: text as it is, a line
    break (Shift+Enter) as "\n". The zero-width space a suggestion keeps at a
    suggested paragraph break (components/docs/ext/suggest.ts) is no word. */
export function inlineText(node: RichNode): string {
  if (node.type === "text") return (node.text ?? "").replaceAll("​", "");
  if (node.type === "hardBreak") return "\n";
  // A smart chip's words are its label; other atoms add none.
  if (CHIP_NODE_TYPES.has(node.type)) return typeof node.attrs?.label === "string" ? node.attrs.label : "";
  return (node.content ?? []).map(inlineText).join("");
}

function textblockRuns(node: RichNode): { text: string; styles: StyleSpan[]; links: LinkSpan[] } {
  let text = "";
  const open = new Map<string, number>();
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  let link: { href: string; start: number } | null = null;
  const closeLink = (at: number) => {
    if (link && at > link.start) links.push({ start: link.start, end: at, quotedText: text.slice(link.start, at), href: link.href });
    link = null;
  };
  const visit = (child: RichNode) => {
    if (child.type !== "text") {
      const piece = inlineText(child);
      // A line break carries no style: every open run closes before it.
      for (const [style, start] of open) {
        if (text.length > start) styles.push({ start, end: text.length, style, quotedText: text.slice(start, text.length) });
      }
      open.clear();
      closeLink(text.length);
      text += piece;
      return;
    }
    const piece = inlineText(child);
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
    text += piece;
  };
  for (const child of node.content ?? []) visit(child);
  for (const [style, start] of open) {
    if (text.length > start) styles.push({ start, end: text.length, style, quotedText: text.slice(start, text.length) });
  }
  closeLink(text.length);
  return { text, styles, links };
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
  const walk = (node: RichNode, ctx: Context) => {
    if (INDEXED_NODE_TYPES.has(node.type)) {
      const id = node.attrs?.blockId;
      if (typeof id !== "string" || !id) return;
      if (node.type === "image") {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        out.push({
          id,
          type: "FIGURE",
          text: "",
          html: `<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"></figure>`,
          styles: [],
          links: [],
        });
        return;
      }
      if (node.type === "horizontalRule") {
        out.push({ id, type: "SEPARATOR", text: "", html: null, styles: [], links: [] });
        return;
      }
      if (node.type === "blockMath") {
        // An equation on its own line keeps its TeX.
        const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
        out.push({ id, type: "EQUATION", text: latex, html: null, styles: [], links: [] });
        return;
      }
      const { text, styles, links } = textblockRuns(node);
      if (node.type === "codeBlock") {
        out.push({ id, type: "CODE", text, html: null, styles: [], links: [] });
        return;
      }
      if (node.type === "heading") {
        const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
        out.push({ id, type: "HEADING", text, html: `<h${level}${tokens(node, ctx)}>`, styles, links });
        return;
      }
      // A paragraph: the Title style reads as the document's first heading,
      // a list item's paragraph as a list line.
      if (node.attrs?.docStyle === "title") {
        out.push({ id, type: "HEADING", text, html: `<h1${tokens(node, ctx)}>`, styles, links });
        return;
      }
      const html = tokens(node, ctx);
      out.push({
        id,
        type: ctx.list ? "LIST" : "PARAGRAPH",
        text,
        html: html ? `<p${html}>` : null,
        styles,
        links,
      });
      return;
    }
    const next: Context =
      node.type === "bulletList"
        ? { ...ctx, list: "bullet" }
        : node.type === "orderedList"
          ? { ...ctx, list: "ordered" }
          : node.type === "taskList"
            ? { ...ctx, list: "task" }
            : node.type === "blockquote"
              ? { ...ctx, quote: true }
              : node.type === "tableCell" || node.type === "tableHeader"
                ? { ...ctx, cell: true, list: null }
                : ctx;
    for (const child of node.content ?? []) walk(child, next);
  };
  walk(doc, { list: null, quote: false, cell: false });
  return out;
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
