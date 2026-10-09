import type {
  Definition,
  FootnoteDefinition,
  Heading,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
} from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { MARKDOWN_EXTENSIONS } from "@/lib/markdown-file";
import { decodeTextFile } from "@/lib/parse/charset";
import type { ParsedDocument } from "@/lib/parse/types";
import { inlineTexText, parseHtmlContent } from "@/lib/parse/url";

// A Markdown file → blocks (SPEC.md §2). The file becomes one HTML page and
// the URL walk (lib/parse/url.ts) reads it: headings, paragraphs, lists,
// tables, code, blockquotes, figures, display math, footnotes, links, and
// raw HTML land in the same shapes a web page's do, through the same code
// path. Nothing is authored: the words are the file's words.
//
// Math is set aside before the markdown parse — its underscores and stars
// are not emphasis. $$…$$ and \[…\] become EQUATION blocks (an x-math marker,
// as a page's KaTeX does); $…$ and \(…\) become inline formulas (the page
// editor's <span data-type="inline-math">, which the walk reads into
// ParsedBlock.math, as a PDF's inline formula is). A dollar amount ("$5 and
// $10") and an escaped \$ stay words.
//
// The page has no base URL: an image or link with an absolute http(s) URL
// keeps it; an image with a relative path has no file to show and is its
// caption; a relative link is its text.

const MARKDOWN_BASE_URL = "https://markdown.invalid/";

export type TexSpan = { tex: string; display: boolean; source: string };

// Math set aside: one private-use placeholder per span.
const PLACEHOLDER_RX = /(\d+)/g;
// A code span (left alone), then display math, then inline math. Inline
// math opens and closes on non-space, does not open on an escaped \$, and
// does not close before a digit ("$5 and $6" is prose).
const MATH_RX =
  /(`+)[\s\S]*?\1|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|(?<!\\)\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/g;
const FENCE_RX = /^\s{0,3}(`{3,}|~{3,})/;

/** The file's math set aside: the text with one placeholder per span, and
    the spans. Exported for scripts/qa/file-keep.mts. */
export function setAsideMath(source: string): { text: string; spans: TexSpan[] } {
  const spans: TexSpan[] = [];
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length === 0) return;
    out.push(
      prose.join("\n").replace(MATH_RX, (m, _code, display, bracket, paren, inline) => {
        if (m.startsWith("`")) return m;
        const tex: string = display ?? bracket ?? paren ?? inline;
        spans.push({ tex: tex.trim(), display: display !== undefined || bracket !== undefined, source: m });
        return `${spans.length - 1}`;
      }),
    );
    prose = [];
  };
  for (const line of source.split("\n")) {
    const open = FENCE_RX.exec(line);
    if (fence === null && open) {
      flush();
      fence = open[1];
      out.push(line);
      continue;
    }
    if (fence !== null) {
      out.push(line);
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
      continue;
    }
    prose.push(line);
  }
  flush();
  return { text: out.join("\n"), spans };
}

// A text file's "#" lines as comments. In Markdown, "# Words" is a heading,
// and a heading mostly stands apart, a blank line before it and after it
// (the benchmark's Markdown in .txt files: pandoc's manual, 0 of 255
// headings between two written lines). A .txt file of code or settings (a
// CMakeLists.txt, a shell script, an org file's source blocks) writes its
// comments with "#", on the lines next to the code they comment on (json's
// CMakeLists.txt: 30 of 43). When half a .txt file's "#" lines or more
// have a written line right before and right after, its "#" lines are
// comments: each is escaped, and reads as the line it is. A .md file is
// Markdown by its name, and keeps its headings however tight (public-apis'
// README: 48 of 59 between written lines).
const ATX_LINE_RX = /^( {0,3})(#{1,6}(?:[ \t]|$))/;
const HASH_COMMENTS_SHARE_MIN = 0.5;

function hashLinesAsComments(source: string, filename: string): string {
  if (!/\.txt$/i.test(filename)) return source;
  const lines = source.split("\n");
  const hashes: number[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const open = FENCE_RX.exec(line);
    if (fence === null && open) fence = open[1];
    else if (fence !== null) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length) fence = null;
    } else if (ATX_LINE_RX.test(line)) hashes.push(i);
  });
  const between = hashes.filter((i) => lines[i - 1]?.trim() && lines[i + 1]?.trim()).length;
  if (hashes.length === 0 || between < hashes.length * HASH_COMMENTS_SHARE_MIN) return source;
  for (const i of hashes) lines[i] = lines[i].replace(ATX_LINE_RX, "$1\\$2");
  return lines.join("\n");
}

/** Text with each placeholder put back as words: an inline formula as its
    readable characters (inlineTexText), display math as its TeX (an
    EQUATION block's words), TeX KaTeX cannot draw as written. For text that
    holds words only: a title, a heading's id, an image's alt and caption.
    Exported for scripts/qa/file-keep.mts. */
export function mathAsWords(value: string, spans: TexSpan[]): string {
  return value.replace(PLACEHOLDER_RX, (_, index: string) => {
    const span = spans[Number(index)];
    if (!span) return "";
    if (span.display) return span.tex;
    return inlineTexText(span.tex) ?? span.source;
  });
}

/** Text with each placeholder put back as the file wrote it: a code block's
    lines, an indented one's among them. */
export function mathAsWritten(value: string, spans: TexSpan[]): string {
  return value.replace(PLACEHOLDER_RX, (_, index: string) => spans[Number(index)]?.source ?? "");
}

// Front matter: the title line, when there is one; the rest drops.
function splitFrontMatter(source: string): { body: string; title: string | null } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!m) return { body: source, title: null };
  const line = /^title:\s*(.+)$/m.exec(m[1]);
  const title = line ? line[1].trim().replace(/^["']|["']$/g, "").trim() : null;
  return { body: source.slice(m[0].length), title: title || null };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

// A heading's id, the way GitHub writes it: lower case, punctuation gone,
// spaces as hyphens, a counter on a repeat. A contents list in the file
// ([Intro](#intro)) resolves against these.
function slugOf(text: string, seen: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

function plainText(nodes: PhrasingContent[], alts = true): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") out += node.value;
    else if (node.type === "image" || node.type === "imageReference") out += alts ? (node.alt ?? "") : " ";
    else if ("children" in node) out += plainText(node.children as PhrasingContent[], alts);
  }
  return out.replace(/\s+/g, " ").trim();
}

// A tag in raw HTML, and the names of HTML's elements (and the SVG and
// MathML ones a page sets inside HTML). A bare tag (<Esc>: no attribute,
// not self-closed) whose name is no element and that the file never
// closes is words: a key or a placeholder the author wrote in angle
// brackets. A component's tag (<Sandpack>...</Sandpack>, <Intro />) stays
// markup. Before, every such tag read as markup and its words went: a
// text file's "press <Esc>", a manual's "<CR>" (Markdown benchmark
// finding: the Vim reference manual lost 172 words).
const TAG_RX = /<\/?([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/g;
const BARE_TAG_RX = /^<([A-Za-z][A-Za-z0-9-]*)>$/;
const CLOSING_TAG_RX = /<\/([A-Za-z][A-Za-z0-9-]*)\s*>/g;
const HTML_ELEMENTS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup " +
    "data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 " +
    "head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript " +
    "object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot " +
    "small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u " +
    "ul var video wbr center font big tt strike acronym marquee nobr " +
    "svg g path rect circle ellipse line polyline polygon text tspan defs use symbol clippath lineargradient radialgradient " +
    "stop mask pattern image foreignobject desc " +
    "math mi mo mn ms mtext mrow mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mspace semantics annotation"
  ).split(" "),
);

// GFM tables, resolved one table at a time. micromark-extension-gfm-table
// resolves every table of a file in one pass whose edit list it searches
// from the start on each edit: the time grows with the square of the
// file's table cells (Markdown benchmark finding: public-apis' README, 2,100
// table rows, took 6.3 s in the table pass alone). Each table's events are
// handed to the same resolver on their own, from the table's head to its
// last row; the resolver keeps no state from one table to the next, so the
// tree is the same.
type MicromarkEvent = [string, { type: string }, unknown];
type MicromarkContext = { events: MicromarkEvent[] };
type TableResolver = (events: MicromarkEvent[], context: MicromarkContext) => MicromarkEvent[];
type FlowConstruct = { name?: string; resolveAll?: TableResolver };

function tablesOneByOne(resolve: TableResolver): TableResolver {
  return (events, context) => {
    if (events !== context.events) return resolve(events, context);
    const spans: Array<[number, number]> = [];
    events.forEach(([side, token], i) => {
      if (side === "enter" && token.type === "tableHead") spans.push([i, i]);
      else if (side === "exit" && spans.length > 0 && /^table(Head|Row|DelimiterRow)$/.test(token.type)) {
        spans[spans.length - 1][1] = i;
      }
    });
    if (spans.length < 2) return resolve(events, context);
    const out: MicromarkEvent[] = [];
    let at = 0;
    for (const [start, end] of spans) {
      for (let i = at; i < start; i++) out.push(events[i]);
      const own: MicromarkContext = Object.create(context);
      own.events = events.slice(start, end + 1);
      resolve(own.events, own);
      for (const event of own.events) out.push(event[2] === own ? [event[0], event[1], context] : event);
      at = end + 1;
    }
    for (let i = at; i < events.length; i++) out.push(events[i]);
    events.length = 0;
    for (const event of out) events.push(event);
    return events;
  };
}

function remarkTablesOneByOne(this: { data: () => Record<string, unknown> }) {
  const extensions = (this.data().micromarkExtensions ?? []) as Array<{ flow?: Record<string, FlowConstruct | FlowConstruct[]> }>;
  for (const extension of extensions) {
    const flow = extension.flow;
    if (!flow) continue;
    for (const [code, constructs] of Object.entries(flow)) {
      flow[code] = (Array.isArray(constructs) ? constructs : [constructs]).map((construct) =>
        construct.name === "table" && construct.resolveAll
          ? { ...construct, resolveAll: tablesOneByOne(construct.resolveAll) }
          : construct,
      );
    }
  }
}

// The mdast tree as HTML for the walk.
class Renderer {
  private readonly definitions = new Map<string, Definition>();
  private readonly footnotes = new Map<string, FootnoteDefinition>();
  private readonly footnoteOrder: string[] = [];
  private readonly slugs = new Map<string, number>();
  firstHeading: string | null = null;

  constructor(
    private readonly spans: TexSpan[],
    private readonly closed: Set<string> = new Set(),
  ) {}

  render(root: Root): string {
    const collect = (node: RootContent | Root) => {
      if (node.type === "definition") this.definitions.set(node.identifier.toLowerCase(), node);
      if (node.type === "footnoteDefinition") this.footnotes.set(node.identifier.toLowerCase(), node);
      if ("children" in node) for (const child of node.children) collect(child as RootContent);
    };
    collect(root);
    const first = root.children.find((n) => n.type !== "definition" && n.type !== "footnoteDefinition" && n.type !== "html");
    // The title is the heading's words; its images' alt words (a README's
    // badges: "GitHub license", "npm version") only when it has no words
    // but them. Before, a README's title read "React · GitHub license npm
    // version (Runtime) Build and Test ..." (Markdown benchmark finding).
    if (first && first.type === "heading" && first.depth === 1) {
      this.firstHeading = this.words(plainText(first.children, false)) || this.words(plainText(first.children)) || null;
    }
    let html = root.children.map((node) => this.block(node)).join("\n");
    if (this.footnoteOrder.length > 0) {
      const items = this.footnoteOrder.map((id, i) => {
        const definition = this.footnotes.get(id);
        const body = definition ? definition.children.map((n) => this.block(n)).join("\n") : "";
        return `<li id="fn-${escapeAttr(id)}">${i + 1}. ${body}</li>`;
      });
      html += `\n<hr>\n<ol class="footnotes">${items.join("")}</ol>`;
    }
    return html;
  }

  private block(node: RootContent): string {
    switch (node.type) {
      case "heading": {
        const id = slugOf(this.words(plainText(node.children)), this.slugs);
        return `<h${node.depth} id="${escapeAttr(id)}">${this.inline(node.children)}</h${node.depth}>`;
      }
      case "paragraph": {
        const content = node.children.filter((n) => !(n.type === "text" && !n.value.trim()));
        const only = content.length === 1 ? content[0] : null;
        if (only && (only.type === "image" || only.type === "imageReference")) return this.figure(only);
        return `<p>${this.inline(node.children)}</p>`;
      }
      case "blockquote":
        return `<blockquote>${node.children.map((n) => this.block(n)).join("\n")}</blockquote>`;
      case "list": {
        const tag = node.ordered ? "ol" : "ul";
        const start = node.ordered && node.start !== null && node.start !== undefined && node.start !== 1 ? ` start="${node.start}"` : "";
        return `<${tag}${start}>${node.children.map((item) => this.listItem(item)).join("")}</${tag}>`;
      }
      case "code": {
        const lang = node.lang ? ` class="language-${escapeAttr(node.lang)}"` : "";
        return `<pre><code${lang}>${escapeHtml(mathAsWritten(node.value, this.spans))}</code></pre>`;
      }
      case "thematicBreak":
        return "<hr>";
      case "html":
        return this.html(node.value);
      case "table":
        return this.table(node);
      case "definition":
      case "footnoteDefinition":
        return "";
      case "yaml":
        return "";
      default:
        // A phrasing node at the top level (a stray break) is its text.
        return `<p>${this.inline([node as PhrasingContent])}</p>`;
    }
  }

  private listItem(item: ListItem): string {
    const mark = item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
    const parts = item.children.map((child, i) =>
      // A tight item's paragraph is the item's own words: no <p> around them.
      i === 0 && child.type === "paragraph" ? this.inline(child.children) : this.block(child),
    );
    return `<li>${mark}${parts.join("\n")}</li>`;
  }

  private table(table: Table): string {
    const rows = table.children.map((row, r) => {
      const cell = r === 0 ? "th" : "td";
      return `<tr>${row.children.map((c) => `<${cell}>${this.inline(c.children)}</${cell}>`).join("")}</tr>`;
    });
    const head = rows.length > 0 ? `<thead>${rows[0]}</thead>` : "";
    const body = rows.length > 1 ? `<tbody>${rows.slice(1).join("")}</tbody>` : "";
    return `<table>${head}${body}</table>`;
  }

  // An image standing as its own paragraph is a figure: the image when its
  // URL is absolute, its caption (the title, else the alt) either way.
  private figure(node: PhrasingContent): string {
    const resolved = this.resolveImage(node);
    if (!resolved) return "";
    const { url, alt, title } = resolved;
    const caption = (title ?? "").trim() || (url && isAbsoluteUrl(url) ? "" : alt.trim());
    const media = url && isAbsoluteUrl(url) ? `<img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}">` : "";
    const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "";
    if (!media && !figcaption) return "";
    return `<figure>${media}${figcaption}</figure>`;
  }

  private resolveImage(node: PhrasingContent): { url: string | null; alt: string; title: string | null } | null {
    const alt = this.words(node.type === "image" || node.type === "imageReference" ? (node.alt ?? "") : "");
    if (node.type === "image") return { url: node.url, alt, title: node.title ? this.words(node.title) : null };
    if (node.type === "imageReference") {
      const definition = this.definitions.get(node.identifier.toLowerCase());
      if (!definition) return { url: null, alt, title: null };
      return { url: definition.url, alt, title: definition.title ? this.words(definition.title) : null };
    }
    return null;
  }

  private inline(nodes: PhrasingContent[]): string {
    return nodes.map((node) => this.phrasing(node)).join("");
  }

  private phrasing(node: PhrasingContent): string {
    switch (node.type) {
      case "text":
        return this.text(node.value);
      case "emphasis":
        return `<em>${this.inline(node.children)}</em>`;
      case "strong":
        return `<strong>${this.inline(node.children)}</strong>`;
      case "delete":
        return `<s>${this.inline(node.children)}</s>`;
      case "inlineCode":
        return `<code>${escapeHtml(node.value)}</code>`;
      case "break":
        return "<br>";
      case "html":
        return this.html(node.value);
      case "link":
        return this.link(node.url, node.children);
      case "linkReference": {
        const definition = this.definitions.get(node.identifier.toLowerCase());
        if (!definition) return `[${this.inline(node.children)}]`;
        return this.link(definition.url, node.children);
      }
      case "image":
      case "imageReference": {
        const resolved = this.resolveImage(node);
        if (!resolved) return "";
        if (resolved.url && isAbsoluteUrl(resolved.url)) {
          return `<img src="${escapeAttr(resolved.url)}" alt="${escapeAttr(resolved.alt)}">`;
        }
        return escapeHtml(resolved.alt);
      }
      case "footnoteReference": {
        const id = node.identifier.toLowerCase();
        let n = this.footnoteOrder.indexOf(id);
        if (n === -1) {
          this.footnoteOrder.push(id);
          n = this.footnoteOrder.length - 1;
        }
        return `<sup><a href="#fn-${escapeAttr(id)}">${n + 1}</a></sup>`;
      }
      default:
        return "";
    }
  }

  private link(url: string, children: PhrasingContent[]): string {
    const inner = this.inline(children);
    if (isAbsoluteUrl(url) || url.startsWith("#") || /^mailto:/i.test(url)) {
      return `<a href="${escapeAttr(url)}">${inner}</a>`;
    }
    return inner;
  }

  private words(value: string): string {
    return mathAsWords(value, this.spans);
  }

  // Raw HTML, with the math set aside put back as text puts it back, and a
  // bare tag of no element's name that the file never closes as its words.
  private html(value: string): string {
    return value
      .replace(TAG_RX, (tag: string, name: string) => {
        const lower = name.toLowerCase();
        return BARE_TAG_RX.test(tag) && !HTML_ELEMENTS.has(lower) && !this.closed.has(lower) ? escapeHtml(tag) : tag;
      })
      .replace(PLACEHOLDER_RX, (_, index: string) => this.math(Number(index)));
  }

  private math(index: number): string {
    const span = this.spans[index];
    if (!span) return "";
    if (span.display) return `<x-math data-tex="${escapeAttr(span.tex)}"></x-math>`;
    return `<span data-type="inline-math" data-latex="${escapeAttr(span.tex)}">${escapeHtml(span.source)}</span>`;
  }

  // Text, with the math set aside put back: display math as the marker the
  // walk turns into an EQUATION block, inline math as an inline formula that
  // holds the words as written until the walk reads its TeX.
  private text(value: string): string {
    return escapeHtml(value).replace(PLACEHOLDER_RX, (_, index: string) => this.math(Number(index)));
  }
}

// A text file's outline (SPEC.md §2): a file whose Markdown holds no heading
// (a .txt file, most often) has its outline in how its lines stand, and two
// rules read it. Each reads a line that stands alone: one line, a blank line
// under it, and a blank line above it past the file's first line.
//   1. The file's first line, when short, is the Title ("Imports audit 5").
//   2. A short line in capitals is a heading ("THE REPLAY WINDOW").
// A line that ends a sentence (a period, a comma, a colon, a semicolon) is
// neither. A file with a heading of its own, or with front matter, is
// Markdown as written, and neither rule runs.
const TEXT_TITLE_CHARS_MAX = 80;
const TEXT_TITLE_WORDS_MAX = 12;
const TEXT_HEADING_CHARS_MAX = 60;
const TEXT_HEADING_WORDS_MAX = 8;
const TEXT_SENTENCE_END_RX = /[.,;:。，；：]["'”’)\]]*$/;

function hasHeading(node: Root | RootContent): boolean {
  if (node.type === "heading") return true;
  if (node.type === "html") return /<h[1-6][\s>]/i.test(node.value);
  return "children" in node && (node.children as RootContent[]).some(hasHeading);
}

/** A top-level paragraph that stands alone and ends no sentence: its text. */
function standingLine(nodes: RootContent[], i: number): string | null {
  const node = nodes[i];
  if (node.type !== "paragraph" || !node.position) return null;
  // An image's line is a figure, not a title: its alt words are no heading.
  if (node.children.some((n) => n.type === "image" || n.type === "imageReference")) return null;
  const { start, end } = node.position;
  if (start.line !== end.line) return null;
  const prev = nodes[i - 1];
  const next = nodes[i + 1];
  if (prev?.position && prev.position.end.line >= start.line - 1) return null;
  if (!next?.position || next.position.start.line <= end.line + 1) return null;
  const text = plainText(node.children);
  if (!/\p{L}/u.test(text) || TEXT_SENTENCE_END_RX.test(text)) return null;
  return text;
}

// 3. A paragraph's lines stay lines when the paragraph is not prose
//    wrapped to a width: a poem's stanza, an address, a log, a list of
//    requirements. Prose wrapped to a width, by a program or by hand, has
//    each line nearly full: the line, a space, and the next line's first
//    word pass four fifths of the width (the file's long lines: the 90th
//    percentile of its paragraph lines' lengths, in columns, a CJK
//    character two). A file whose width is under 40 columns has no prose
//    wrapped to it (a requirements file's short lines). A paragraph of three
//    lines or more keeps its line ends as line breaks when at most half of
//    its lines are full, when most of its lines end on a stop (a verse's
//    lines end on a comma, a period; wrapped prose ends there by chance,
//    one line in four or five), or when its lines open alike (a log's
//    lines: the first word's shape, letters and digits as their kind, the
//    same on four lines in five). A paragraph of two lines keeps them when
//    its first line is not full and ends on a stop. A paragraph with
//    Markdown's own marks (a backslash escape, an entity, a link or image
//    in brackets, inline code, raw HTML, emphasis in asterisks) is
//    Markdown, and its line ends are soft breaks ("aaa" then "bbb" reads
//    "aaa bbb"), unless it has five lines or more that open alike (a log
//    with a <tag> in a line).
// Before, every paragraph of a text file read as one run of words: a
// log's 2,000 lines as one line (Markdown benchmark finding).
const TEXT_LINES_MIN = 2;
const TEXT_STOP_LINES_MIN = 0.6;
const TEXT_STOP_RX = /[.,;:!?)\]"'”’»。，；：！？）]$/;
const TEXT_FULL_SHARE = 0.8;
const TEXT_FULL_LINES_MAX = 0.5;
const TEXT_SAME_OPENING_MIN = 0.8;
const TEXT_ALIKE_OVER_MARKS_MIN = 5;
const TEXT_WRAP_COLUMNS_MIN = 40;
const WIDE_RX = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** A line's width in columns: a CJK character is two. */
function columns(line: string): number {
  let n = 0;
  for (const c of line) n += WIDE_RX.test(c) ? 2 : 1;
  return n;
}
const MARKDOWN_MARKS_RX = /\\[!-/:-@[-`{-~]|\]\(|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i;
const MARKDOWN_NODES = new Set(["html", "inlineCode", "linkReference", "imageReference", "footnoteReference", "delete"]);

/** A paragraph's inline Markdown: a node only Markdown writes, or a link,
    image, or emphasis written with Markdown's marks (a bare address and
    _words_ are a text file's too). */
function hasMarkdownMarks(nodes: PhrasingContent[], source: string): boolean {
  return nodes.some((node) => {
    if (MARKDOWN_NODES.has(node.type)) return true;
    const first = node.position ? source[node.position.start.offset ?? -1] : undefined;
    if ((node.type === "link" || node.type === "image") && (first === "[" || first === "!" || first === "<")) return true;
    if ((node.type === "emphasis" || node.type === "strong") && first === "*") return true;
    return "children" in node && hasMarkdownMarks(node.children as PhrasingContent[], source);
  });
}

// A table of values saved as text (a .csv or .tsv file named .txt): every
// line holds the same count of field separators, two or more, outside
// double quotes. Its lines are its rows, and stay lines, however long
// (Markdown benchmark finding: a CSV of 250 rows read as one paragraph).
const FIELD_SEPARATORS = [",", "\t", ";"];
const DELIMITED_SHARE_MIN = 0.9;

function fieldSeparators(line: string, separator: string): number {
  let n = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === separator && !quoted) n++;
  }
  return n;
}

function isDelimited(lines: string[]): boolean {
  if (lines.length < 3) return false;
  return FIELD_SEPARATORS.some((separator) => {
    const counts = new Map<number, number>();
    for (const line of lines) {
      const n = fieldSeparators(line, separator);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const [n, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
    return n >= 2 && count >= lines.length * DELIMITED_SHARE_MIN;
  });
}

// A verse's lines each open with a capital letter (after a quote mark or
// a dash): a stanza of four lines or more whose every line does is verse,
// though its lines are full and end on no stop ("Eagerly I wished the
// morrow;--vainly I had sought to borrow"). Wrapped prose opens most of
// its lines on a small letter. Markdown benchmark finding: half the
// Raven's stanzas read as one run of words.
const VERSE_LINES_MIN = 4;
const CAPITAL_OPENING_RX = /^[\p{P}\s]*\p{Lu}/u;

function verseCapitals(lines: string[]): boolean {
  return lines.length >= VERSE_LINES_MIN && lines.every((line) => CAPITAL_OPENING_RX.test(line));
}

/** A line's first word's shape: each letter as "a", each digit as "0". */
function openingShape(line: string): string {
  return (/^\S+/.exec(line)?.[0] ?? "").replace(/\p{L}/gu, "a").replace(/\p{N}/gu, "0");
}

/** The phrasing nodes with each line end as a break. */
function withLineBreaks(nodes: PhrasingContent[]): PhrasingContent[] {
  return nodes.flatMap((node): PhrasingContent[] => {
    if (node.type === "text") {
      return node.value.split("\n").flatMap((part, i): PhrasingContent[] => [
        ...(i > 0 ? [{ type: "break" } as PhrasingContent] : []),
        ...(part ? [{ type: "text", value: part } as PhrasingContent] : []),
      ]);
    }
    if ("children" in node) return [{ ...node, children: withLineBreaks(node.children as PhrasingContent[]) } as PhrasingContent];
    return [node];
  });
}

function keepTextLines(root: Root, source: string, comments: boolean) {
  const lines = source.split("\n");
  const linesOf = (node: RootContent) =>
    node.position ? lines.slice(node.position.start.line - 1, node.position.end.line).map((l) => l.trim()) : [];
  const paragraphs = root.children.filter(
    (n) => n.type === "paragraph" && n.position && n.position.end.line - n.position.start.line + 1 >= TEXT_LINES_MIN,
  );
  const lengths = paragraphs.flatMap((n) => linesOf(n).map(columns)).sort((a, b) => a - b);
  if (lengths.length === 0) return;
  const p90 = lengths[Math.floor((lengths.length - 1) * 0.9)];
  const width = p90 < TEXT_WRAP_COLUMNS_MIN ? Infinity : p90;
  for (const node of paragraphs) {
    if (node.type !== "paragraph") continue;
    const own = linesOf(node);
    let full = 0;
    for (let i = 0; i < own.length - 1; i++) {
      const next = /^\S+/.exec(own[i + 1])?.[0] ?? "";
      if (columns(own[i]) + 1 + columns(next) > width * TEXT_FULL_SHARE) full++;
    }
    const stops = own.slice(0, -1).filter((line) => TEXT_STOP_RX.test(line)).length;
    const shapes = new Map<string, number>();
    for (const line of own) shapes.set(openingShape(line), (shapes.get(openingShape(line)) ?? 0) + 1);
    const alike = Math.max(...shapes.values()) >= own.length * TEXT_SAME_OPENING_MIN || isDelimited(own);
    // A comment's escaped "#" (hashLinesAsComments) is the file's own mark, not Markdown's.
    const marks =
      own.some((line) => MARKDOWN_MARKS_RX.test(comments ? line.replace(/^\\#/, "#") : line)) || hasMarkdownMarks(node.children, source);
    if (marks && !(alike && own.length >= TEXT_ALIKE_OVER_MARKS_MIN)) continue;
    const keep =
      own.length === 2
        ? full === 0 && stops === 1
        : full <= (own.length - 1) * TEXT_FULL_LINES_MAX || stops >= (own.length - 1) * TEXT_STOP_LINES_MIN || alike || verseCapitals(own);
    if (keep) node.children = withLineBreaks(node.children);
  }
}

/** A heading written with "#" (or an HTML heading): Markdown's own. An
    underlined heading (a line of "=" or "-" under it) is a text file's as
    often: a MAINTAINERS file's, an RST manual's. */
function hasHashHeading(node: Root | RootContent, lines: string[]): boolean {
  if (node.type === "heading") return /^ {0,3}#/.test(lines[(node.position?.start.line ?? 1) - 1] ?? "#");
  if (node.type === "html") return /<h[1-6][\s>]/i.test(node.value);
  return "children" in node && (node.children as RootContent[]).some((n) => hasHashHeading(n, lines));
}

// 4. A file whose words are indented (an RFC: half its paragraphs' lines
//    open with a space) sets its headings at the margin: a line that stands alone at
//    the margin, of twelve words or fewer, ending no sentence, is a
//    heading ("Abstract", "4.2 Message Headers", an ordered list's one
//    item "1.  Introduction"). Its number sets its level: one level under
//    the Title for each part ("4" a level 2, "4.2" a level 3). A line with
//    a wide gap (three spaces inside it: a page's header or footer, "RFC
//    2616   HTTP/1.1   June 1999") is none. A numbered line set in from
//    the margin, standing alone, is a heading too when its number has two
//    parts or more ("1.2.1  Error Logging") or its title is in capitals
//    ("2.  LINK LAYER"): an older RFC indents its sections. Before, an RFC's every
//    section heading read as a paragraph or a one-item list (Markdown
//    benchmark finding: five RFCs, 3 to 260 headings each, none found).
// 5. A line that stands alone and opens with a chapter's word and its
//    number ("CHAPTER II. The Pool of Tears", "Letter 4", "BOOK I",
//    "Chapitre XII", "SCÈNE 2e": a French ordinal's ending is the number's)
//    is a heading at level 2, though it ends on a period.
//    Before, a novel's chapters read as paragraphs: the capitals rule
//    takes no small letter, and no line ending on a period (Markdown
//    benchmark finding: every Gutenberg novel of the set).
const CHAPTER_RX =
  /^(?:chapter|book|part|act|scene|canto|letter|volume|stave|chapitre|livre|partie|acte|scène|kapitel|teil|buch|cap[ií]tulo|capitolo|libro|parte)\s+(?:\d+(?:e|er|re|ère|ème)?|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|the\s+\w+)\b/iu;
const TEXT_INDENTED_SHARE_MIN = 0.5;
const TEXT_MARGIN_WORDS_MAX = 12;
const INDENTED_SECTION_RX = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/;
const SECTION_NUMBER_RX = /^((?:\d+|[A-Z])(?:\.\d+)*)[.)]?\s+\S/;

/** A short line in capitals (rule 2). */
function isCapitalsLine(text: string): boolean {
  return (
    text.length <= TEXT_HEADING_CHARS_MAX &&
    text.split(/\s+/).filter(Boolean).length <= TEXT_HEADING_WORDS_MAX &&
    (text.match(/\p{Lu}/gu) ?? []).length >= 2 &&
    !/\p{Ll}/u.test(text)
  );
}

/** A top-level node whose lines have a blank line above and under them. */
function standsAlone(nodes: RootContent[], i: number): boolean {
  const node = nodes[i];
  const prev = nodes[i - 1];
  const next = nodes[i + 1];
  if (!node.position) return false;
  if (prev?.position && prev.position.end.line >= node.position.start.line - 1) return false;
  return !next?.position || next.position.start.line > node.position.end.line + 1;
}

/** A margin heading's level: one level under the Title for each part of
    its number, else level 2. */
function marginDepth(text: string): Heading["depth"] {
  const number = SECTION_NUMBER_RX.exec(text)?.[1];
  const parts = number ? number.split(".").length : 1;
  return Math.min(6, parts + 1) as Heading["depth"];
}

// 6. Words set in four spaces or more (a poem's stanzas, an old RFC's
//    sections, a letter or a quote set in) are Markdown's indented code,
//    but a text file's words: in a file with no "#" heading and no fenced
//    code, an indented code block whose lines are words is the file's
//    paragraphs, one per run of lines between blank lines, and the lines
//    rule reads each (a stanza keeps its lines, wrapped prose joins). A
//    line of words holds no sign code writes ({ } = < > | \ ` ^ $ ~), no
//    gap of three spaces (a table's columns, a contents line's leaders), and
//    letters for most of its characters; nine lines in ten are such lines,
//    and one has six words or more. Before, a poem indented five spaces read
//    as one code block, and an RFC's indented sections as code with their
//    headings inside (Markdown benchmark finding: the Rime of the Ancient
//    Mariner, RFC 1122).
const CODE_SIGN_RX = /[{}=<>|\\`^$~]/;
const COLUMN_GAP_RX = /\S {3,}\S/;
const WORDS_LINES_SHARE_MIN = 0.9;
const WORDS_LINE_LETTERS_MIN = 0.6;
const PROSE_LINE_WORDS_MIN = 6;

function isWordsLine(line: string): boolean {
  const text = line.trim();
  if (CODE_SIGN_RX.test(text) || COLUMN_GAP_RX.test(text)) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters >= text.replace(/\s/g, "").length * WORDS_LINE_LETTERS_MIN;
}

function setInWordsAsParagraphs(root: Root, lines: string[]) {
  if (lines.some((line) => FENCE_RX.test(line))) return;
  root.children = root.children.flatMap((node): RootContent[] => {
    if (node.type !== "code" || node.lang || !node.position) return [node];
    const from = node.position.start.line;
    const own = lines.slice(from - 1, node.position.end.line);
    const filled = own.filter((line) => line.trim());
    if (filled.length === 0) return [node];
    if (filled.filter(isWordsLine).length < filled.length * WORDS_LINES_SHARE_MIN) return [node];
    if (!filled.some((line) => line.trim().split(/\s+/).length >= PROSE_LINE_WORDS_MIN)) return [node];
    // One paragraph per run of lines between blank lines.
    const out: RootContent[] = [];
    let start = -1;
    own.forEach((line, i) => {
      const blank = !line.trim();
      if (!blank && start < 0) start = i;
      if (start >= 0 && (blank || i === own.length - 1)) {
        const end = blank ? i - 1 : i;
        out.push({
          type: "paragraph",
          children: [{ type: "text", value: own.slice(start, end + 1).map((l) => l.trim()).join("\n") }],
          position: { start: { line: from + start, column: 1 }, end: { line: from + end, column: own[end].length + 1 } },
        });
        start = -1;
      }
    });
    return out;
  });
}

function shapeTextOutline(root: Root, source: string, comments: boolean) {
  const lines = source.split("\n");
  // The lines rule runs in a file with no "#" heading: an underlined
  // heading does not make a text file Markdown.
  if (!hasHashHeading(root, lines)) {
    setInWordsAsParagraphs(root, lines);
    keepTextLines(root, source, comments);
  }
  if (hasHeading(root)) return;
  const nodes = root.children;
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  // The paragraphs' lines: a code block is indented in every file.
  const filled = nodes
    .filter((n) => n.type === "paragraph" && n.position)
    .flatMap((n) => lines.slice((n.position?.start.line ?? 1) - 1, n.position?.end.line ?? 0))
    .filter((line) => line.trim());
  const indented = filled.length > 0 && filled.filter((line) => /^\s/.test(line)).length >= filled.length * TEXT_INDENTED_SHARE_MIN;
  const atMargin = (node: RootContent) => {
    const line = node.position ? (lines[node.position.start.line - 1] ?? "") : "";
    return line.length > 0 && !/^\s/.test(line) && !/\S {3,}\S/.test(line.trim());
  };
  nodes.forEach((node, i) => {
    // An ordered list's one item at the margin, standing alone: a numbered
    // heading ("1.  Introduction").
    if (indented && node.type === "list" && node.ordered && node.children.length === 1 && atMargin(node) && standsAlone(nodes, i)) {
      const item = node.children[0];
      const only = item.children.length === 1 ? item.children[0] : null;
      if (!only || only.type !== "paragraph" || !node.position || node.position.start.line !== node.position.end.line) return;
      const marker = /^\s*(\d+[.)])/.exec(lines[node.position.start.line - 1] ?? "")?.[1] ?? `${node.start ?? 1}.`;
      const text = `${marker} ${plainText(only.children)}`;
      if (words(text) > TEXT_MARGIN_WORDS_MAX || TEXT_SENTENCE_END_RX.test(text)) return;
      nodes[i] = { type: "heading", depth: marginDepth(text), children: [{ type: "text", value: `${marker} ` }, ...only.children], position: node.position };
      return;
    }
    // A numbered section line set in from the margin (an older RFC's
    // "      1.2.1  Continuing Internet Evolution", which Markdown reads as
    // code or a list): a heading, when its number has two parts or more or
    // its title is in capitals.
    if (indented && standsAlone(nodes, i) && node.position && node.position.start.line === node.position.end.line) {
      const raw = (lines[node.position.start.line - 1] ?? "").trim();
      const numbered = INDENTED_SECTION_RX.exec(raw);
      if (
        numbered &&
        (node.type === "code" || node.type === "list" || node.type === "paragraph") &&
        (numbered[1].includes(".") || isCapitalsLine(numbered[2])) &&
        words(raw) <= TEXT_MARGIN_WORDS_MAX &&
        !TEXT_SENTENCE_END_RX.test(raw) &&
        !/\S {3,}\S|\.{4,}/.test(numbered[2])
      ) {
        nodes[i] = { type: "heading", depth: marginDepth(raw), children: [{ type: "text", value: raw }], position: node.position };
        return;
      }
    }
    if (node.type !== "paragraph") return;
    // A chapter's line: a heading, though it ends on a period.
    const line = node.position && node.position.start.line === node.position.end.line && standsAlone(nodes, i) ? plainText(node.children) : "";
    if (line && i > 0 && CHAPTER_RX.test(line) && words(line) <= TEXT_MARGIN_WORDS_MAX) {
      nodes[i] = { type: "heading", depth: 2, children: node.children, position: node.position };
      return;
    }
    const text = standingLine(nodes, i);
    if (text === null) return;
    // A first line written with Markdown's own marks (a link in brackets,
    // an escape, an entity, inline code, emphasis in asterisks) is
    // Markdown, which writes its title with "#": it stays a paragraph.
    // Before, a note that opens on "[Intro](#intro)" or "&#42; foo" read
    // it as the Title (Markdown benchmark finding: 35 spec examples).
    const marked = i === 0 && (MARKDOWN_MARKS_RX.test(lines[(node.position?.start.line ?? 1) - 1] ?? "") || hasMarkdownMarks(node.children, source));
    const title = i === 0 && !marked && text.length <= TEXT_TITLE_CHARS_MAX && words(text) <= TEXT_TITLE_WORDS_MAX;
    const capitals = isCapitalsLine(text);
    const margin = indented && !title && words(text) <= TEXT_MARGIN_WORDS_MAX && atMargin(node);
    if (title || capitals || margin) {
      const depth = title ? 1 : margin ? marginDepth(text) : 2;
      nodes[i] = { type: "heading", depth, children: node.children, position: node.position };
    }
  });
}

/** The HTML page a Markdown file becomes, and its title: the front matter's
    title, else the file's first heading, else the file name (titleFromFile:
    the file's words name nothing, so an import opens with no Title). */
export function markdownToHtml(
  markdown: string,
  filename: string,
): { html: string; title: string; titleFromFile: boolean } {
  const source = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const { body, title: frontTitle } = splitFrontMatter(source);
  const commented = hashLinesAsComments(body, filename);
  const { text, spans } = setAsideMath(commented);
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkTablesOneByOne).parse(text) as Root;
  if (body === source) shapeTextOutline(tree, text, commented !== body);
  const closed = new Set([...text.matchAll(CLOSING_TAG_RX)].map((m) => m[1].toLowerCase()));
  const renderer = new Renderer(spans, closed);
  const article = renderer.render(tree);
  const ownTitle = frontTitle ?? renderer.firstHeading;
  const title = ownTitle ?? filename.replace(MARKDOWN_EXTENSIONS, "").trim() ?? "Document";
  // The page's <title> is the file's own title only: a file name there would
  // let the walk read a first heading that says the same words as the
  // banner, and drop it.
  const head = ownTitle !== null ? `<title>${escapeHtml(ownTitle)}</title>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8">${head}</head><body><article>${article}</article></body></html>`;
  return { html, title, titleFromFile: ownTitle === null };
}

/** A Markdown or text file's bytes as text, in the charset the bytes say
    (decodeTextFile, lib/parse/charset.ts: UTF-8, UTF-16, or a legacy one):
    the add and the re-parse read the file the same way
    (scripts/parse-bench/markdown.mts measures it). */
export function markdownFileText(bytes: Uint8Array): string {
  return decodeTextFile(bytes);
}

/** A Markdown file's blocks: the same walk a web page takes, no model pass,
    with every block of the file kept (no furniture rule drops one). */
export async function parseMarkdownDocument(
  markdown: string,
  filename: string,
): Promise<ParsedDocument & { titleFromFile: boolean }> {
  const { html, title, titleFromFile } = markdownToHtml(markdown, filename);
  // The file is the author's words: the walk keeps every block it holds.
  const parsed = await parseHtmlContent(html, MARKDOWN_BASE_URL, undefined, { source: "file" });
  return { ...parsed, title, titleFromFile, font: undefined, columnWidth: undefined };
}
