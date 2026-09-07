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
import type { ParsedDocument } from "@/lib/parse/types";
import { parseHtmlContent } from "@/lib/parse/url";

// A Markdown file → blocks (SPEC.md §2). The file becomes one HTML page and
// the URL walk (lib/parse/url.ts) reads it: headings, paragraphs, lists,
// tables, code, blockquotes, figures, display math, footnotes, links, and
// raw HTML land in the same shapes a web page's do, through the same code
// path. Nothing is authored: the words are the file's words.
//
// Math is set aside before the markdown parse — its underscores and stars
// are not emphasis. $$…$$ and \[…\] become EQUATION blocks (an x-math marker,
// as a page's KaTeX does); $…$ and \(…\) stay as written, in the text.
//
// The page has no base URL: an image or link with an absolute http(s) URL
// keeps it; an image with a relative path has no file to show and is its
// caption; a relative link is its text.

const MARKDOWN_BASE_URL = "https://markdown.invalid/";

type MathSpan = { tex: string; display: boolean };

// Math set aside: one private-use placeholder per span.
const PLACEHOLDER_RX = /(\d+)/g;
// A code span (left alone), then display math, then inline math. Inline
// math opens and closes on non-space and does not close before a digit
// ("$5 and $6" is prose).
const MATH_RX =
  /(`+)[\s\S]*?\1|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/g;
const FENCE_RX = /^\s{0,3}(`{3,}|~{3,})/;

function setAsideMath(source: string): { text: string; spans: MathSpan[] } {
  const spans: MathSpan[] = [];
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (prose.length === 0) return;
    out.push(
      prose.join("\n").replace(MATH_RX, (m, _code, display, bracket, paren, inline) => {
        if (m.startsWith("`")) return m;
        const tex: string = display ?? bracket ?? paren ?? inline;
        spans.push({ tex: tex.trim(), display: display !== undefined || bracket !== undefined });
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

  constructor(private readonly spans: MathSpan[]) {}

  render(root: Root): string {
    const collect = (node: RootContent | Root) => {
      if (node.type === "definition") this.definitions.set(node.identifier.toLowerCase(), node);
      if (node.type === "footnoteDefinition") this.footnotes.set(node.identifier.toLowerCase(), node);
      if ("children" in node) for (const child of node.children) collect(child as RootContent);
    };
    collect(root);
    const first = root.children.find((n) => n.type !== "definition" && n.type !== "footnoteDefinition" && n.type !== "html");
    if (first && first.type === "heading" && first.depth === 1) this.firstHeading = plainText(first.children) || null;
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
        const id = slugOf(plainText(node.children), this.slugs);
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
        return `<pre><code${lang}>${escapeHtml(node.value)}</code></pre>`;
      }
      case "thematicBreak":
        return "<hr>";
      case "html":
        return node.value;
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
    if (node.type === "image") return { url: node.url, alt: node.alt ?? "", title: node.title ?? null };
    if (node.type === "imageReference") {
      const definition = this.definitions.get(node.identifier.toLowerCase());
      if (!definition) return { url: null, alt: node.alt ?? "", title: null };
      return { url: definition.url, alt: node.alt ?? "", title: definition.title ?? null };
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
        return node.value;
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

  // Text, with the math set aside put back: display math as the marker the
  // walk turns into an EQUATION block, inline math as written.
  private text(value: string): string {
    return escapeHtml(value).replace(PLACEHOLDER_RX, (_, index: string) => {
      const span = this.spans[Number(index)];
      if (!span) return "";
      if (span.display) return `<x-math data-tex="${escapeAttr(span.tex)}"></x-math>`;
      return escapeHtml(`$${span.tex}$`);
    });
  }
}

/** The HTML page a Markdown file becomes, and its title: the front matter's
    title, else the file's first heading, else the file name. */
export function markdownToHtml(markdown: string, filename: string): { html: string; title: string } {
  const source = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const { body, title: frontTitle } = splitFrontMatter(source);
  const { text, spans } = setAsideMath(body);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root;
  const renderer = new Renderer(spans);
  const article = renderer.render(tree);
  const title = frontTitle ?? renderer.firstHeading ?? filename.replace(MARKDOWN_EXTENSIONS, "").trim() ?? "Document";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><article>${article}</article></body></html>`;
  return { html, title };
}

/** A Markdown file's blocks: the same walk a web page takes, no model pass. */
export async function parseMarkdownDocument(markdown: string, filename: string): Promise<ParsedDocument> {
  const { html, title } = markdownToHtml(markdown, filename);
  const parsed = await parseHtmlContent(html, MARKDOWN_BASE_URL);
  return { ...parsed, title, font: undefined, columnWidth: undefined };
}
