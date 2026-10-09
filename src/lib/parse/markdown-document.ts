import type {
  Definition,
  FootnoteDefinition,
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

function plainText(nodes: PhrasingContent[]): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode") out += node.value;
    else if (node.type === "image" || node.type === "imageReference") out += node.alt ?? "";
    else if ("children" in node) out += plainText(node.children as PhrasingContent[]);
  }
  return out.replace(/\s+/g, " ").trim();
}

// The mdast tree as HTML for the walk.
class Renderer {
  private readonly definitions = new Map<string, Definition>();
  private readonly footnotes = new Map<string, FootnoteDefinition>();
  private readonly footnoteOrder: string[] = [];
  private readonly slugs = new Map<string, number>();
  firstHeading: string | null = null;

  constructor(private readonly spans: TexSpan[]) {}

  render(root: Root): string {
    const collect = (node: RootContent | Root) => {
      if (node.type === "definition") this.definitions.set(node.identifier.toLowerCase(), node);
      if (node.type === "footnoteDefinition") this.footnotes.set(node.identifier.toLowerCase(), node);
      if ("children" in node) for (const child of node.children) collect(child as RootContent);
    };
    collect(root);
    const first = root.children.find((n) => n.type !== "definition" && n.type !== "footnoteDefinition" && n.type !== "html");
    if (first && first.type === "heading" && first.depth === 1) this.firstHeading = this.words(plainText(first.children)) || null;
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

  // Raw HTML, with the math set aside put back as text puts it back.
  private html(value: string): string {
    return value.replace(PLACEHOLDER_RX, (_, index: string) => this.math(Number(index)));
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

function shapeTextOutline(root: Root) {
  if (hasHeading(root)) return;
  const nodes = root.children;
  const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
  nodes.forEach((node, i) => {
    if (node.type !== "paragraph") return;
    const text = standingLine(nodes, i);
    if (text === null) return;
    const title = i === 0 && text.length <= TEXT_TITLE_CHARS_MAX && words(text) <= TEXT_TITLE_WORDS_MAX;
    const capitals =
      text.length <= TEXT_HEADING_CHARS_MAX &&
      words(text) <= TEXT_HEADING_WORDS_MAX &&
      (text.match(/\p{Lu}/gu) ?? []).length >= 2 &&
      !/\p{Ll}/u.test(text);
    if (title || capitals) nodes[i] = { type: "heading", depth: title ? 1 : 2, children: node.children, position: node.position };
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
  const { text, spans } = setAsideMath(body);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root;
  if (body === source) shapeTextOutline(tree);
  const renderer = new Renderer(spans);
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
