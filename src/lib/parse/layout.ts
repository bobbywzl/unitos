import { JSDOM, VirtualConsole } from "jsdom";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { claude, claudeConfigured, claudeOptions } from "@/lib/claude";
import { PARSE_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { isFigureCaption } from "@/lib/parse/figure-audit";
import type { CitationSpan, LinkSpan, ParsedBlock, StyleSpan } from "@/lib/parse/types";
import type { UsageMeta } from "@/lib/usage";

// The layout pass for URL ingest (SPEC.md §2): the second AI pass, after the
// core pass, and it does the structure pass's work too (drop residual junk,
// fix a wrong type, merge a split fragment) — one call instead of two, on the
// page's HTML instead of the block list alone. The mechanical walk reads the
// page's HTML by rule; this pass reads it the way a person reads the browser's inspector —
// the page's own elements with their class names, inline styles, and the
// layout facts the page-style bake wrote into them (text alignment, weight,
// font size, figure widths) — and says what each block IS on the page: the
// kicker over the title, the metadata line, the contents list, a heading and
// its level, a pull quote, a caption, the figures that share one row, and the
// chrome that is not the article. The reader renders those roles as the
// page's layout tokens, so the document reads as a replica of the page.
//
// Same discipline as the other passes: ops reference blocks by index and never
// write text. A join concatenates blocks with one of four separators, a
// merge_up joins a fragment to the block above it with a space, a figure row
// wraps figure blocks in one figure; nothing else changes a block's words. On
// any failure, or past its time budget, the blocks stand as they came in.
// Runs on PARSE_MODEL, like every parse pass.

export type PageFont = "sans" | "serif" | "mono";

const MAX_LISTED_BLOCKS = 500;
const DIGEST_CHARS = 60_000;
const TEXT_CHARS = 72;
const ATTR_CHARS = 120;
const CLASS_TOKENS = 8;
// Blocks this short are lines the page may set as one row (a label and its
// value); joins never touch longer text.
const JOIN_MAX_CHARS = 200;
const CAPTION_MAX_CHARS = 300;
const DROP_CEILING = 0.4;
const DROP_CEILING_INSTRUCTED = 0.9;

const ROLES = ["kicker", "meta", "label", "display", "quote", "caption", "paragraph"] as const;
const RETYPES = ["PARAGRAPH", "HEADING", "LIST", "CODE"] as const;
const ALIGNS = ["center", "right", "left"] as const;
const SEPARATORS = [" · ", " ", " — ", ": "] as const;
// Every token the reader knows (block-view.tsx). A token outside this list
// never reaches the stored html.
const LAYOUT_TOKENS = new Set(["center", "right", ...ROLES.filter((r) => r !== "paragraph"), "contents"]);
const ROLE_TOKENS = new Set<string>(ROLES);

const index = z.number().int().min(0);
const opSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role"), index, role: z.enum(ROLES), align: z.enum(ALIGNS).optional() }),
  z.object({ action: z.literal("heading"), index, level: z.number().int().min(1).max(3), align: z.enum(ALIGNS).optional() }),
  z.object({ action: z.literal("contents"), index }),
  z.object({ action: z.literal("join"), indexes: z.array(index).min(2).max(24), separator: z.enum(SEPARATORS) }),
  z.object({ action: z.literal("figure_row"), indexes: z.array(index).min(2).max(12) }),
  z.object({ action: z.literal("drop"), index }),
  z.object({ action: z.literal("retype"), index, type: z.enum(RETYPES) }),
  z.object({ action: z.literal("merge_up"), index }),
]);
const layoutSchema = z.object({
  font: z.enum(["sans", "serif", "mono"]).optional(),
  ops: z.array(opSchema).max(400),
});
export type LayoutOp = z.infer<typeof opSchema>;
export type LayoutResult = z.infer<typeof layoutSchema>;

// ── The page digest: the inspector's view, bounded ──────────────────────────

const DIGEST_ATTRS = [
  "id", "class", "style", "role", "aria-label", "href", "src", "poster", "alt", "viewBox",
  "width", "height", "colspan", "rowspan",
  // The page-style bake's layout facts (lib/parse/figure-style.ts).
  "data-align", "data-style", "data-font-size", "data-width-pct", "data-body-font-size", "data-font", "data-box",
];
const DIGEST_SKIP = new Set(["script", "style", "noscript", "template", "link", "meta", "head", "title"]);
const TEXT_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "figcaption", "blockquote", "dt", "dd", "pre"]);

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function shortUrl(value: string): string {
  try {
    const u = new URL(value, "https://x/");
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return clip(last || u.pathname, 60);
  } catch {
    return clip(value, 60);
  }
}

function digestAttrs(el: Element): string {
  const parts: string[] = [];
  for (const name of DIGEST_ATTRS) {
    const raw = el.getAttribute(name);
    if (raw === null || raw === "") continue;
    let value = raw;
    if (name === "class") value = raw.split(/\s+/).filter(Boolean).slice(0, CLASS_TOKENS).join(" ");
    else if (name === "href") value = raw.startsWith("#") ? raw : shortUrl(raw);
    else if (name === "src" || name === "poster") value = shortUrl(raw);
    else value = clip(raw, ATTR_CHARS);
    parts.push(`${name}="${value.replace(/"/g, "'")}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

// The page's content root, the way the walk picks it (lib/parse/url.ts): the
// last largest article, main, or role=main; the body when the page has none.
function pageRoot(document: Document): Element {
  let best: Element | null = null;
  let bestLength = 0;
  for (const candidate of document.querySelectorAll("article, main, [role='main']")) {
    const length = (candidate.textContent ?? "").length;
    if (length >= bestLength) {
      best = candidate;
      bestLength = length;
    }
  }
  return best && bestLength > 200 ? best : document.body;
}

/** The page's HTML as one bounded listing: one element per line, nesting by
    indent, attributes the layout depends on, text clipped, scripts and
    styles gone, hidden elements gone, a chart svg as one line. */
export function pageDigest(pageHtml: string, url: string): string {
  let dom: JSDOM;
  try {
    dom = new JSDOM(pageHtml, { url, virtualConsole: new VirtualConsole() });
  } catch {
    return "";
  }
  const document = dom.window.document;
  const root = pageRoot(document);
  const lines: string[] = [];
  let used = 0;
  let cut = false;
  const body = document.body;
  const bodyFacts = body ? digestAttrs(body) : "";
  if (bodyFacts) lines.push(`<body${bodyFacts}>`);

  const push = (line: string): boolean => {
    if (used + line.length > DIGEST_CHARS) {
      cut = true;
      return false;
    }
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  const write = (el: Element, depth: number): boolean => {
    const tag = el.tagName.toLowerCase();
    if (DIGEST_SKIP.has(tag) || el.hasAttribute("data-unitos-hidden")) return true;
    const indent = " ".repeat(depth);
    if (tag === "svg") {
      const count = el.querySelectorAll("*").length;
      return push(`${indent}<svg${digestAttrs(el)} elements="${count}"/>`);
    }
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.textContent ?? "";
    }
    // A text block's own words, whole enough to match a block by; an inline
    // element inside it keeps its words on its own line.
    const shown = clip(text, TEXT_TAGS.has(tag) ? TEXT_CHARS * 2 : TEXT_CHARS);
    if (!push(`${indent}<${tag}${digestAttrs(el)}>${shown}`)) return false;
    for (const child of el.children) {
      if (!write(child, depth + 1)) return false;
    }
    return true;
  };
  write(root, 0);
  if (cut) lines.push("… (the page digest stops here)");
  return lines.join("\n");
}

// ── The block listing ───────────────────────────────────────────────────────

function classTokens(html: string | undefined): string[] {
  const m = /^<[a-z][a-z0-9]*\b[^>]*\bclass="([^"]*)"/i.exec(html ?? "");
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

function headingLevelOf(block: ParsedBlock): number {
  const m = /^<h([1-6])/i.exec(block.html ?? "");
  return m ? Math.min(3, Number(m[1])) : 2;
}

function mediaSummary(html: string | undefined): string {
  if (!html) return "";
  const counts: Record<string, number> = {};
  for (const m of html.matchAll(/<(img|video|iframe|svg)\b/gi)) {
    const tag = m[1].toLowerCase();
    counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return Object.entries(counts).map(([tag, n]) => `${tag}×${n}`).join(" ");
}

function listBlocks(blocks: ParsedBlock[]): string {
  return blocks
    .map((b, i) => {
      const kind = b.type === "HEADING" ? `HEADING h${headingLevelOf(b)}` : b.type;
      const tokens = classTokens(b.html);
      const tokenText = tokens.length > 0 ? ` [${tokens.join(" ")}]` : "";
      const media = b.type === "FIGURE" ? ` {${mediaSummary(b.html) || "no media"}}` : "";
      return `[${i}] ${kind}${tokenText}${media}: ${clip(b.text, 140)}`;
    })
    .join("\n");
}

// ── The prompt ──────────────────────────────────────────────────────────────

function instructionLines(instructions: string | undefined): string[] {
  if (!instructions?.trim()) return [];
  return [
    "The reader gave instructions for this upload. Follow the ones about layout, headings, block types, merging, and what to keep or drop; ignore the rest:",
    instructions.trim(),
    "",
  ];
}

function layoutPrompt(
  title: string | null,
  blocks: ParsedBlock[],
  digest: string,
  instructions?: string,
): string {
  return [
    `A web page${title ? ` titled "${title}"` : ""} was parsed into the numbered blocks below. The page's own HTML follows the blocks, as a browser lays it out: class names, inline styles, and the resolved layout facts — data-align (text alignment), data-style (bold italic underline code), data-font-size (px), data-width-pct (a figure's width as a percentage of the text column), data-font on body, data-box (an element the page boxes: its own background, or its own font around a chart). Elements a desktop browser hides are already gone.`,
    "Make the blocks an exact replica of the page's structure. Return ops that say what each block is on the page. Ops reference blocks by index. Never write, rewrite, or shorten text.",
    "1. role: what a text block is on the page. kicker: the short label line set above the title. meta: the byline, date, category, or reading-time line. label: a small label that names what follows, such as the word Contents with its section count. display: a large standalone statement or pull quote. quote: a quotation set apart from the body. caption: a figure caption standing alone, outside the figure's box. Text inside a data-box element that holds the figure is the figure's words (a chart's title, legend, axis label, source line), never a caption. paragraph: plain body text; use it to take a wrong role off. align: center or right when the page centers or right-aligns the block; left takes an alignment off.",
    "2. heading: a block that is a section heading on the page — by its size, weight, and position, or because the contents list points at it — with its level: 1 for the page's top sections, 2 for subsections, 3 below that. Use the page's own hierarchy, not the tag name: an article whose sections are h2 has level 1 sections.",
    "3. contents: the list block that is the page's table of contents, and the paragraph that is its label.",
    "4. join: consecutive short blocks that are one line on the page — a byline split into label and value rows, a label and its value — become one block, joined with the separator. Consecutive indexes only. Never join body paragraphs.",
    "5. figure_row: consecutive figure blocks, with the caption blocks between them, that sit side by side in one row on the page become one figure row. Consecutive indexes only.",
    "6. drop: a block that is not article content — page chrome such as navigation, footer link lists, newsletter and subscribe forms, share and cookie fragments, player controls such as [Sound] or [ Fullscreen ], unhydrated widget values (a bare \"0\" or \"0.0M\" and the labels around them), a leading heading that merely repeats the document title. Never body text, never a figure with a caption, never the contents list.",
    "7. retype: a block that has the wrong type. Allowed between PARAGRAPH, HEADING, LIST, CODE only. Use heading for a heading with its level; retype is for LIST and CODE, and for a heading that is body text.",
    "8. merge_up: a block that is a fragment split mid-sentence from the block above it. Both must be PARAGRAPH.",
    "9. font: the body text's typeface family on the page: sans, serif, or mono.",
    "10. Leave a block that is already right alone. Keep every block that is article content; when unsure, keep. An empty ops array is a valid answer.",
    ...instructionLines(instructions),
    'Return ONLY JSON: {"font": "sans", "ops": [{"action": "role", "index": 0, "role": "kicker", "align": "center"}, {"action": "join", "indexes": [1, 2, 3, 4], "separator": " · "}, {"action": "role", "index": 1, "role": "meta", "align": "center"}, {"action": "contents", "index": 5}, {"action": "heading", "index": 9, "level": 2}, {"action": "figure_row", "indexes": [40, 41, 42]}, {"action": "drop", "index": 98}, {"action": "retype", "index": 61, "type": "LIST"}, {"action": "merge_up", "index": 63}]}',
    "",
    "Blocks:",
    listBlocks(blocks),
    "",
    "The page's HTML:",
    digest,
  ].join("\n");
}

// ── Applying the ops ────────────────────────────────────────────────────────

/** The stored html for a text block's layout tokens: the opening tag alone,
    the heading level kept, tokens the reader knows and nothing else. */
export function layoutHtml(block: ParsedBlock, tokens: string[]): string | undefined {
  const kept = [...new Set(tokens.filter((t) => LAYOUT_TOKENS.has(t)))];
  const attr = kept.length > 0 ? ` class="${kept.join(" ")}"` : "";
  if (block.type === "HEADING") return `<h${headingLevelOf(block)}${attr}>`;
  if (kept.length === 0) return undefined;
  if (block.type === "LIST") return `<${/^\s*\d{1,3}[.)]\s/.test(block.text) ? "ol" : "ul"}${attr}>`;
  return `<p${attr}>`;
}

function withTokens(block: ParsedBlock, change: (tokens: string[]) => string[]): ParsedBlock {
  const next = change(classTokens(block.html));
  const html = layoutHtml(block, next);
  return html === undefined ? { ...block, html: undefined } : { ...block, html };
}

function setAlign(tokens: string[], align: (typeof ALIGNS)[number] | undefined): string[] {
  if (!align) return tokens;
  const rest = tokens.filter((t) => t !== "center" && t !== "right");
  return align === "left" ? rest : [...rest, align];
}

function setRole(tokens: string[], role: (typeof ROLES)[number]): string[] {
  const rest = tokens.filter((t) => !ROLE_TOKENS.has(t) && t !== "contents");
  return role === "paragraph" ? rest : [...rest, role];
}

const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST"]);
const RETYPABLE = new Set<string>(RETYPES);

function isCaptionText(block: ParsedBlock): boolean {
  return block.type === "PARAGRAPH" && block.text.length <= CAPTION_MAX_CHARS && isFigureCaption(block.text);
}

function consecutive(indexes: number[]): boolean {
  const sorted = [...indexes].sort((a, b) => a - b);
  return sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1) && new Set(sorted).size === sorted.length;
}

function shifted<T extends { start: number; end: number }>(spans: T[] | undefined, by: number): T[] {
  return (spans ?? []).map((s) => ({ ...s, start: s.start + by, end: s.end + by }));
}

/** Consecutive short text blocks as one line. Styles, links, and citations
    of later parts shift by the text before them. */
function joinBlocks(parts: ParsedBlock[], separator: string): ParsedBlock {
  let text = "";
  const styles: StyleSpan[] = [];
  const links: LinkSpan[] = [];
  const citations: CitationSpan[] = [];
  for (const part of parts) {
    // A label ending in a colon takes its value after one space; the
    // separator sits between the pairs: "Category: Research · Author: Dyna".
    const glue = text.length === 0 ? "" : text.endsWith(":") ? " " : separator;
    const at = text.length + glue.length;
    text = `${text}${glue}${part.text}`;
    styles.push(...shifted(part.styles, at));
    links.push(...shifted(part.links, at));
    citations.push(...shifted(part.citations, at));
  }
  const tokens = parts.flatMap((p) => classTokens(p.html));
  // The first part's other fields (its fragment id among them) carry over.
  const joined: ParsedBlock = { ...parts[0], type: "PARAGRAPH", text };
  delete joined.html;
  delete joined.styles;
  delete joined.links;
  delete joined.citations;
  if (styles.length > 0) joined.styles = styles;
  if (links.length > 0) joined.links = links;
  if (citations.length > 0) joined.citations = citations;
  return withTokens(joined, () => tokens);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function figureInner(html: string | undefined): string {
  const m = /^\s*<figure\b[^>]*>([\s\S]*)<\/figure>\s*$/i.exec(html ?? "");
  return m ? m[1] : (html ?? "");
}

/** Consecutive figure blocks, with the captions between them, as one figure
    row: one nested figure per column, equal widths, each caption under its
    media. The row's text is its captions. */
function figureRow(parts: ParsedBlock[]): ParsedBlock | null {
  type Column = { media: ParsedBlock; caption: string | null; captionInHtml: boolean };
  const columns: Column[] = [];
  let pending: string | null = null;
  for (const part of parts) {
    if (part.type === "FIGURE") {
      const own = isFigureCaption(part.text) ? part.text : null;
      columns.push({ media: part, caption: own ?? pending, captionInHtml: own !== null });
      pending = null;
    } else if (isCaptionText(part)) {
      const last = columns[columns.length - 1];
      if (last && last.caption === null) last.caption = part.text;
      else pending = part.text;
    } else return null;
  }
  if (columns.length < 2) return null;
  const width = Math.max(15, Math.floor(100 / columns.length) - 1);
  const html = columns
    .map((c) => {
      const caption = c.caption !== null && !c.captionInHtml ? `<p class="center">${escapeHtml(c.caption)}</p>` : "";
      return `<figure style="width:${width}%">${figureInner(c.media.html)}${caption}</figure>`;
    })
    .join("");
  const text = columns.map((c) => c.caption ?? c.media.text).join("\n");
  // The first column's other fields (its fragment id among them) carry over.
  const row: ParsedBlock = { ...columns[0].media, type: "FIGURE", text, html: `<figure>${html}</figure>` };
  delete row.styles;
  delete row.links;
  delete row.citations;
  return row;
}

/** Apply a validated op list to the blocks. Ops that break the rules — an
    index out of range, a join or row over non-consecutive or wrong blocks,
    a drop past the ceiling — are skipped one by one; the rest apply. */
export function applyLayoutOps(
  blocks: ParsedBlock[],
  result: LayoutResult,
  instructions?: string,
): { blocks: ParsedBlock[]; applied: number } {
  const listed = Math.min(blocks.length, MAX_LISTED_BLOCKS);
  const inRange = (i: number) => i >= 0 && i < listed;
  let applied = 0;

  // Groups first: a join, a merge, or a row claims its indexes; single ops
  // on those indexes land on the group.
  const groups = new Map<number, { kind: "join"; indexes: number[]; separator: string } | { kind: "row"; indexes: number[] }>();
  const claimed = new Set<number>();
  const claim = (indexes: number[], group: { kind: "join"; indexes: number[]; separator: string } | { kind: "row"; indexes: number[] }) => {
    groups.set(indexes[0], group);
    for (const i of indexes) claimed.add(i);
    applied += 1;
  };
  for (const op of result.ops) {
    if (op.action !== "join" && op.action !== "figure_row") continue;
    const indexes = [...op.indexes].sort((a, b) => a - b);
    if (!indexes.every(inRange) || !consecutive(indexes) || indexes.some((i) => claimed.has(i))) continue;
    const members = indexes.map((i) => blocks[i]);
    if (op.action === "join") {
      if (!members.every((b) => TEXT_TYPES.has(b.type) && b.text.length <= JOIN_MAX_CHARS)) continue;
      claim(indexes, { kind: "join", indexes, separator: op.separator });
    } else {
      const figures = members.filter((b) => b.type === "FIGURE").length;
      if (figures < 2 || !members.every((b) => b.type === "FIGURE" || isCaptionText(b))) continue;
      claim(indexes, { kind: "row", indexes });
    }
  }
  // A merge_up joins a fragment to the block above it with one space; a chain
  // of merge_ups (a paragraph split three ways) is one group. Both must be
  // paragraphs, whatever their length.
  const mergeUps = [...new Set(result.ops.flatMap((op) => (op.action === "merge_up" ? [op.index] : [])))]
    .filter((i) => inRange(i) && i > 0)
    .sort((a, b) => a - b);
  for (let k = 0; k < mergeUps.length; ) {
    let end = k;
    while (end + 1 < mergeUps.length && mergeUps[end + 1] === mergeUps[end] + 1) end += 1;
    const indexes = [mergeUps[k] - 1, ...mergeUps.slice(k, end + 1)];
    k = end + 1;
    if (indexes.some((i) => claimed.has(i)) || !indexes.every((i) => blocks[i].type === "PARAGRAPH")) continue;
    claim(indexes, { kind: "join", indexes, separator: " " });
  }

  const drops = new Set<number>();
  for (const op of result.ops) {
    if (op.action === "drop" && inRange(op.index) && !claimed.has(op.index)) drops.add(op.index);
  }
  const ceiling = instructions?.trim() ? DROP_CEILING_INSTRUCTED : DROP_CEILING;
  if (drops.size > blocks.length * ceiling) {
    console.warn(`[ingest] layout pass wanted ${drops.size}/${blocks.length} drops, drops ignored`);
    drops.clear();
  } else applied += drops.size;

  const singles = new Map<number, LayoutOp[]>();
  for (const op of result.ops) {
    if (op.action === "join" || op.action === "figure_row" || op.action === "drop" || op.action === "merge_up") continue;
    if (!inRange(op.index) || drops.has(op.index)) continue;
    // A single op on a group member lands on the group.
    let at = op.index;
    for (const [start, group] of groups) {
      if (group.indexes.includes(op.index)) at = start;
    }
    singles.set(at, [...(singles.get(at) ?? []), op]);
  }

  const applySingles = (block: ParsedBlock, ops: LayoutOp[]): ParsedBlock => {
    let next = block;
    for (const op of ops) {
      if (op.action === "role") {
        if (!TEXT_TYPES.has(next.type)) continue;
        next = withTokens(next, (tokens) => setAlign(setRole(tokens, op.role), op.align));
        applied += 1;
      } else if (op.action === "heading") {
        if (next.type !== "PARAGRAPH" && next.type !== "HEADING") continue;
        const tokens = setAlign(classTokens(next.html).filter((t) => !ROLE_TOKENS.has(t)), op.align);
        // A style over the whole heading is the heading's own weight.
        const styles = (next.styles ?? []).filter((s) => !(s.start <= 0 && s.end >= next.text.length));
        const heading: ParsedBlock = { ...next, type: "HEADING", html: `<h${op.level}>` };
        if (styles.length > 0) heading.styles = styles;
        else delete heading.styles;
        next = withTokens(heading, () => tokens);
        applied += 1;
      } else if (op.action === "contents") {
        if (next.type === "LIST") next = withTokens(next, (tokens) => [...tokens.filter((t) => !ROLE_TOKENS.has(t)), "contents"]);
        else if (next.type === "PARAGRAPH") next = withTokens(next, (tokens) => setRole(tokens, "label"));
        else continue;
        applied += 1;
      } else if (op.action === "retype") {
        // Between the text types only; the alignment travels, a role belonged
        // to the old type, and a span over a whole heading is the heading's
        // own weight.
        if (!RETYPABLE.has(next.type) || next.type === op.type) continue;
        const tokens = classTokens(next.html).filter((t) => !ROLE_TOKENS.has(t) && t !== "contents");
        const styles =
          op.type === "HEADING"
            ? (next.styles ?? []).filter((s) => !(s.start <= 0 && s.end >= next.text.length))
            : (next.styles ?? []);
        const retyped: ParsedBlock = { ...next, type: op.type, html: op.type === "HEADING" ? "<h2>" : undefined };
        if (styles.length > 0) retyped.styles = styles;
        else delete retyped.styles;
        next = withTokens(retyped, () => tokens);
        applied += 1;
      }
    }
    return next;
  };

  const out: ParsedBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const group = groups.get(i);
    if (group) {
      const members = group.indexes.map((j) => blocks[j]);
      const built = group.kind === "join" ? joinBlocks(members, group.separator) : figureRow(members);
      if (built) out.push(applySingles(built, singles.get(i) ?? []));
      else out.push(...members);
      i = group.indexes[group.indexes.length - 1];
      continue;
    }
    if (claimed.has(i) || drops.has(i)) continue;
    out.push(applySingles(blocks[i], singles.get(i) ?? []));
  }
  return { blocks: out.length > 0 ? out : blocks, applied };
}

// ── The pass ────────────────────────────────────────────────────────────────

/** Lay the blocks out as the page does. The blocks come back unchanged when
    there is no key, no page html, or the model call fails. */
export async function layoutBlocks(input: {
  blocks: ParsedBlock[];
  title: string | null;
  pageHtml: string | null;
  url: string;
  instructions?: string;
  // The pass's time budget (lib/parse/ingest.ts modelPassSignal): past it the
  // call aborts and the blocks stand.
  signal?: AbortSignal;
}): Promise<{ blocks: ParsedBlock[]; font?: PageFont }> {
  const { blocks, title, pageHtml, url, instructions, signal } = input;
  if (!claudeConfigured() || !pageHtml || blocks.length < 3) return { blocks };
  const digest = pageDigest(pageHtml, url);
  if (!digest) return { blocks };
  const listed = blocks.slice(0, MAX_LISTED_BLOCKS);
  const messages: ModelMessage[] = [
    { role: "user", content: layoutPrompt(title, listed, digest, instructions) },
  ];
  const result = await callForJson({
    model: await claude(PARSE_MODEL),
    messages,
    maxOutputTokens: 24576,
    providerOptions: claudeOptions(),
    schema: layoutSchema,
    label: "INGEST_LAYOUT",
    usage: { userId: null, feature: "parse", model: PARSE_MODEL } satisfies UsageMeta,
    abortSignal: signal,
  });
  if (!result.ok) {
    console.warn(`[ingest] layout pass failed, keeping blocks as they are: ${result.error}`);
    return { blocks };
  }
  const { blocks: laid, applied } = applyLayoutOps(blocks, result.data, instructions);
  console.log(`[ingest] layout: ${applied} of ${result.data.ops.length} ops applied`);
  return { blocks: laid, font: result.data.font };
}
