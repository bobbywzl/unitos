import katex from "katex";
import type { BlockType } from "@prisma/client";
import { KATEX_MACROS } from "@/lib/katex";
import type { LinkSpan, ParsedBlock, StyleSpan } from "@/lib/parse/types";
import { parseSpeakers } from "@/lib/video/types";

// A document's download (SPEC.md §15): the document itself as a file, made
// from its Block rows — an article, slides, sheets, a handwritten document's
// converted text, a recording's transcript. A document with rich text (a
// blank document, an import) is downloaded from its rich text instead
// (lib/docs/export.ts, components/docs/page/download.ts).
//
// What a download never holds: the reader's notes, annotations, highlights,
// comments, and replies. They stay in Unitos; no function here reads them.
// A recording's download is its transcript: the video or audio file itself
// is never served from here.

/** A stored block, as a download reads it. */
export type ExportRow = {
  id: string;
  type: BlockType;
  text: string;
  html: string | null;
  styles: unknown;
  links: unknown;
  page: number | null;
  region: unknown;
  startTime: number | null;
  speaker: string | null;
};

export type ExportDocument = {
  title: string;
  sourceUrl: string | null;
  /** VideoAsset.speakers of a recording, else null. */
  speakers: unknown;
  rows: ExportRow[];
};

/** The words a download adds of its own, in the reader's language. */
export type ExportWords = { slide: (n: number) => string; page: (n: number) => string };

const spans = <T extends { start: number; end: number }>(value: unknown): T[] =>
  Array.isArray(value)
    ? value.filter((s): s is T => Boolean(s) && typeof s === "object" && typeof (s as T).start === "number" && typeof (s as T).end === "number")
    : [];

/** A time of a recording as its transcript shows it: 1:05, 1:02:07. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** The blocks a download holds, in order. A recording gives its transcript,
    each line after its time and its speaker; the player block is left out.
    A handwritten page is a picture of the stored file, so it is left out and
    the converted text stands under its page's number. A slide is a heading
    and its lines; a sheet is a table of its rows. */
export function exportBlocks(doc: ExportDocument, words: ExportWords): ParsedBlock[] {
  const names = new Map(parseSpeakers(doc.speakers).map((s) => [s.id, s.name]));
  const out: ParsedBlock[] = [];
  for (const row of doc.rows) {
    const styles = spans<StyleSpan>(row.styles);
    const links = spans<LinkSpan>(row.links);
    switch (row.type) {
      case "VIDEO":
        break;
      case "PAGE":
        if (row.page !== null) out.push({ type: "HEADING", html: "<h2>", text: words.page(row.page) });
        break;
      case "TRANSCRIPT": {
        const speaker = row.speaker ? names.get(row.speaker) : undefined;
        const lead = `${row.startTime !== null ? `[${clock(row.startTime)}] ` : ""}${speaker ? `${speaker}: ` : ""}`;
        const shift = <T extends { start: number; end: number }>(list: T[]) =>
          list.map((s) => ({ ...s, start: s.start + lead.length, end: s.end + lead.length }));
        out.push({ type: "PARAGRAPH", text: lead + row.text, styles: shift(styles), links: shift(links) });
        break;
      }
      case "SLIDE":
        if (row.page !== null) out.push({ type: "HEADING", html: "<h2>", text: words.slide(row.page) });
        if (row.text.trim()) out.push({ type: "PARAGRAPH", text: row.text });
        break;
      case "SHEET":
        if (row.text.trim()) out.push({ type: "TABLE", text: row.text });
        break;
      default:
        out.push({
          type: row.type,
          text: row.text,
          ...(row.html ? { html: row.html } : {}),
          ...(row.page !== null ? { page: row.page } : {}),
          ...(row.region ? { region: row.region as ParsedBlock["region"] } : {}),
          ...(styles.length > 0 ? { styles } : {}),
          ...(links.length > 0 ? { links } : {}),
        });
    }
  }
  // A page's heading with no converted text under it says nothing.
  return out.filter((b, i) => !(b.type === "HEADING" && isPageHeading(doc, b, words) && (i + 1 >= out.length || out[i + 1].type === "HEADING")));
}

function isPageHeading(doc: ExportDocument, block: ParsedBlock, words: ExportWords): boolean {
  return doc.rows.some((r) => r.type === "PAGE" && r.page !== null && words.page(r.page) === block.text);
}

/** The blocks under the title: a first heading that says the title again
    is the title, and stands once. */
function underTitle(title: string, blocks: ParsedBlock[]): ParsedBlock[] {
  const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
  return blocks[0]?.type === "HEADING" && same(blocks[0].text, title) ? blocks.slice(1) : blocks;
}

/** Whether the document holds words to download at all. */
export function hasWords(blocks: ParsedBlock[]): boolean {
  return blocks.some((b) => b.text.trim() !== "" || Boolean(b.html));
}

// ── Inline runs ──────────────────────────────────────────────────────────────

type Run = { text: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean; code: boolean; sub: boolean; sup: boolean; href: string | null };

/** The block's words cut where a style or a link starts or ends. */
function runs(block: ParsedBlock): Run[] {
  const { text } = block;
  const styles = (block.styles ?? []).filter((s) => typeof s.style === "string");
  const links = (block.links ?? []).filter((l) => typeof l.href === "string" && /^(https?:|mailto:)/i.test(l.href));
  const cuts = new Set<number>([0, text.length]);
  for (const s of [...styles, ...links]) {
    cuts.add(Math.max(0, Math.min(text.length, s.start)));
    cuts.add(Math.max(0, Math.min(text.length, s.end)));
  }
  const at = [...cuts].sort((a, b) => a - b);
  const out: Run[] = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const [from, to] = [at[i], at[i + 1]];
    if (from === to) continue;
    const on = (style: string) => styles.some((s) => s.style === style && s.start <= from && s.end >= to);
    out.push({
      text: text.slice(from, to),
      bold: on("bold"),
      italic: on("italic"),
      underline: on("underline"),
      strike: on("strike"),
      code: on("code"),
      sub: on("sub"),
      sup: on("sup"),
      href: links.find((l) => l.start <= from && l.end >= to)?.href ?? null,
    });
  }
  return out;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runsHtml(block: ParsedBlock): string {
  return runs(block)
    .map((r) => {
      let html = escapeHtml(r.text).replace(/\n/g, "<br>");
      if (r.code) html = `<code>${html}</code>`;
      if (r.sub) html = `<sub>${html}</sub>`;
      if (r.sup) html = `<sup>${html}</sup>`;
      if (r.strike) html = `<s>${html}</s>`;
      if (r.underline) html = `<u>${html}</u>`;
      if (r.italic) html = `<em>${html}</em>`;
      if (r.bold) html = `<strong>${html}</strong>`;
      if (r.href) html = `<a href="${escapeHtml(r.href)}">${html}</a>`;
      return html;
    })
    .join("");
}

/** Markdown's own characters in running words, written as words. */
const escapeMarkdown = (text: string) => text.replace(/([\\`*_[\]<>])/g, "\\$1");

function runsMarkdown(block: ParsedBlock): string {
  return runs(block)
    .map((r) => {
      // The marks stand against the words: the spaces around them stay outside.
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text) ?? ["", "", r.text, ""];
      if (!core) return r.text;
      let md = r.code ? `\`${core.replace(/`/g, "'")}\`` : escapeMarkdown(core);
      if (r.strike) md = `~~${md}~~`;
      if (r.italic) md = `*${md}*`;
      if (r.bold) md = `**${md}**`;
      if (r.href) md = `[${md}](${r.href})`;
      return lead + md + trail;
    })
    .join("");
}

// ── Lists and tables ─────────────────────────────────────────────────────────

/** A list line: its depth (two spaces a level), whether its marker counts,
    and where its words start in the line. */
function listLine(line: string): { depth: number; ordered: boolean; from: number } {
  const m = /^(\s*)((?:[-*•◦▪]|\d+[.)]|[a-zA-Z][.)]|\[[ xX]\])\s+)?/.exec(line);
  const indent = m?.[1].length ?? 0;
  const marker = m?.[2] ?? "";
  return { depth: Math.floor(indent / 2), ordered: /^(\d+|[a-zA-Z])[.)]/.test(marker), from: indent + marker.length };
}

/** The block's lines, each with its own styles and links, moved to the line. */
function lines(block: ParsedBlock): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  let at = 0;
  for (const text of block.text.split("\n")) {
    const [from, to] = [at, at + text.length];
    const within = <T extends { start: number; end: number }>(list: T[] | undefined) =>
      (list ?? []).filter((s) => s.start < to && s.end > from).map((s) => ({ ...s, start: Math.max(s.start, from) - from, end: Math.min(s.end, to) - from }));
    out.push({ type: block.type, text, styles: within(block.styles), links: within(block.links) });
    at = to + 1;
  }
  return out;
}

/** A line's words after `from` characters, its spans moved with them. */
function after(line: ParsedBlock, from: number): ParsedBlock {
  const move = <T extends { start: number; end: number }>(list: T[] | undefined) =>
    (list ?? []).filter((s) => s.end > from).map((s) => ({ ...s, start: Math.max(0, s.start - from), end: s.end - from }));
  return { ...line, text: line.text.slice(from), styles: move(line.styles), links: move(line.links) };
}

function listHtml(block: ParsedBlock): string {
  let html = "";
  const open: string[] = [];
  for (const line of lines(block)) {
    if (!line.text.trim()) continue;
    const { depth, ordered, from } = listLine(line.text);
    const tag = ordered ? "ol" : "ul";
    while (open.length > depth + 1) html += `</li></${open.pop()}>`;
    if (open.length === depth + 1 && open[depth] !== tag) html += `</li></${open.pop()}>`;
    if (open.length === depth + 1) html += "</li>";
    while (open.length < depth + 1) {
      html += `<${tag}>`;
      open.push(tag);
      if (open.length < depth + 1) html += "<li>";
    }
    html += `<li>${runsHtml(after(line, from))}`;
  }
  while (open.length > 0) html += `</li></${open.pop()}>`;
  return html;
}

/** A table's rows from its text: a line per row, a tab between cells. */
function tableRows(text: string): string[][] {
  const rows = text.split("\n").filter((line) => line.trim() !== "").map((line) => line.split("\t"));
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
}

// ── Plain text and Markdown ──────────────────────────────────────────────────

function headingLevel(html: string | undefined): number {
  const m = html?.match(/^<h([1-6])/);
  return m ? Number(m[1]) : 2;
}

/** The first picture a figure's html names, made whole against the page it came from. */
function figureImage(html: string | undefined, pageUrl: string | null): string | null {
  const src = html ? /<img\b[^>]*?\bsrc=["']([^"']+)["']/i.exec(html)?.[1] : undefined;
  if (!src || src.startsWith("data:")) return null;
  try {
    const url = new URL(src.replace(/&amp;/g, "&"), pageUrl ?? undefined);
    return /^https?:$/.test(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** The document as plain text: its title, then a block's words per paragraph. */
export function documentText(title: string, blocks: ParsedBlock[]): string {
  const parts = [title, ...underTitle(title, blocks).map((b) => (b.type === "SEPARATOR" ? "* * *" : b.text.trim())).filter((text) => text !== "")];
  return `${parts.join("\n\n")}\n`;
}

/** The document as Markdown. A figure is its picture, where the picture is
    on the web, and its caption. */
export function documentMarkdown(title: string, blocks: ParsedBlock[], pageUrl: string | null): string {
  const out: string[] = [`# ${escapeMarkdown(title)}`];
  for (const block of underTitle(title, blocks)) {
    switch (block.type) {
      case "HEADING":
        // The title is the one level-one heading: the document's own start at two.
        out.push(`${"#".repeat(Math.max(2, headingLevel(block.html)))} ${runsMarkdown(block).replace(/\n/g, " ")}`);
        break;
      case "LIST":
        out.push(
          lines(block)
            .filter((line) => line.text.trim())
            .map((line) => {
              const { depth, ordered, from } = listLine(line.text);
              const marker = ordered ? line.text.slice(0, from).trim().replace(/\)$/, ".") : "-";
              return `${"  ".repeat(depth)}${marker} ${runsMarkdown(after(line, from))}`;
            })
            .join("\n"),
        );
        break;
      case "TABLE": {
        const rows = tableRows(block.text);
        if (rows.length === 0) break;
        const row = (cells: string[]) => `| ${cells.map((c) => escapeMarkdown(c.trim()).replace(/\|/g, "\\|")).join(" | ")} |`;
        out.push([row(rows[0]), `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map(row)].join("\n"));
        break;
      }
      case "CODE":
        out.push(`\`\`\`\n${block.text}\n\`\`\``);
        break;
      case "EQUATION":
        out.push(`$$\n${block.text.trim()}\n$$`);
        break;
      case "SEPARATOR":
        out.push("---");
        break;
      case "FIGURE": {
        const image = figureImage(block.html, pageUrl);
        const caption = block.text.trim();
        if (image) out.push(`![${escapeMarkdown(caption).replace(/\n/g, " ")}](${image})`);
        if (caption) out.push(`*${escapeMarkdown(caption).replace(/\n/g, " ")}*`);
        break;
      }
      default:
        if (block.text.trim()) out.push(runsMarkdown(block).replace(/\n/g, "  \n"));
    }
  }
  return `${out.join("\n\n")}\n`;
}

// ── The web page ─────────────────────────────────────────────────────────────

const PAGE_CSS = `
body { max-width: 720px; margin: 48px auto; padding: 0 24px; font: 17px/1.6 Georgia, "Times New Roman", serif; color: #1f1b16; }
h1, h2, h3, h4, h5, h6 { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.25; margin: 1.6em 0 0.5em; }
h1 { font-size: 30px; margin-top: 0; }
h2 { font-size: 23px; } h3 { font-size: 19px; } h4, h5, h6 { font-size: 17px; }
p, ul, ol, table, pre, figure { margin: 0 0 1em; }
ul, ol { padding-left: 1.4em; }
pre { padding: 14px; overflow-x: auto; background: #f1ece2; border-radius: 8px; font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; }
code { font: 0.9em ui-monospace, Menlo, Consolas, monospace; }
table { border-collapse: collapse; width: 100%; font-size: 15px; }
td, th { border: 1px solid #cfc7b8; padding: 5px 9px; text-align: left; vertical-align: top; }
figure { margin-left: 0; margin-right: 0; }
img, svg, video { max-width: 100%; height: auto; }
figcaption, .caption { font-size: 14px; color: #5f574b; font-style: italic; }
hr { border: 0; border-top: 1px solid #cfc7b8; margin: 2em 0; }
.source { font: 13px system-ui, sans-serif; color: #5f574b; margin: -0.3em 0 2em; }
@media print { body { margin: 0; max-width: none; } a { color: inherit; text-decoration: none; } }
`;

/** A block's own html as a download holds it: nothing that runs, and every
    address whole. `picture` gives a stored picture's data address. */
function ownHtml(html: string, pageUrl: string | null, picture: (src: string) => string | null): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\b(src|href)=(["'])([^"']*)\2/gi, (whole, attr: string, quote: string, value: string) => {
      if (/^(data:|#|mailto:)/i.test(value)) return whole;
      if (/^javascript:/i.test(value.trim())) return `${attr}=${quote}#${quote}`;
      const stored = attr.toLowerCase() === "src" ? picture(value) : null;
      if (stored) return `${attr}=${quote}${stored}${quote}`;
      try {
        return `${attr}=${quote}${escapeHtml(new URL(value.replace(/&amp;/g, "&"), pageUrl ?? undefined).href)}${quote}`;
      } catch {
        return whole;
      }
    });
}

/** The document as a web page of its own. `pictures`: the app's own
    pictures by the address the blocks name them with, as data addresses,
    and a PDF figure's crop by its place among the blocks ("#<index>"). */
export function documentHtml(
  title: string,
  blocks: ParsedBlock[],
  options: { pageUrl: string | null; pictures: Map<string, string>; lang: string },
): string {
  const { pageUrl, pictures } = options;
  const picture = (src: string) => pictures.get(src) ?? null;
  const body: string[] = [`<h1>${escapeHtml(title)}</h1>`];
  if (pageUrl && /^https?:/i.test(pageUrl)) body.push(`<p class="source"><a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></p>`);
  // A crop is named by its block's place among all the blocks.
  const shown = new Set(underTitle(title, blocks));
  blocks.forEach((block, index) => {
    if (!shown.has(block)) return;
    switch (block.type) {
      case "HEADING": {
        const level = Math.max(2, headingLevel(block.html));
        body.push(`<h${level}>${runsHtml(block)}</h${level}>`);
        break;
      }
      case "LIST":
        body.push(listHtml(block));
        break;
      case "TABLE": {
        if (block.html && /^\s*<table\b/i.test(block.html)) {
          body.push(ownHtml(block.html, pageUrl, picture));
          break;
        }
        const rows = tableRows(block.text);
        body.push(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</table>`);
        break;
      }
      case "CODE":
        body.push(`<pre>${escapeHtml(block.text)}</pre>`);
        break;
      case "EQUATION":
        body.push(
          `<p>${katex.renderToString(block.text, { output: "mathml", displayMode: true, throwOnError: false, macros: { ...KATEX_MACROS } })}</p>`,
        );
        break;
      case "SEPARATOR":
        body.push("<hr>");
        break;
      case "FIGURE": {
        if (block.html) {
          const own = ownHtml(block.html, pageUrl, picture);
          body.push(/^\s*<figure\b/i.test(own) ? own : `<figure>${own}</figure>`);
          break;
        }
        const crop = pictures.get(`#${index}`);
        const caption = block.text.trim() ? `<figcaption>${runsHtml(block)}</figcaption>` : "";
        if (crop || caption) body.push(`<figure>${crop ? `<img src="${crop}" alt="">` : ""}${caption}</figure>`);
        break;
      }
      default:
        if (block.text.trim()) body.push(`<p>${runsHtml(block)}</p>`);
    }
  });
  return `<!DOCTYPE html>\n<html lang="${escapeHtml(options.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body>\n${body.join("\n")}\n</body></html>\n`;
}

/** The app's own pictures a block's html names (`/api/images/<id>`). */
export function storedPictureIds(blocks: ParsedBlock[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const block of blocks) {
    for (const m of (block.html ?? "").matchAll(/\bsrc=["']((?:https?:\/\/[^"'/]+)?\/api\/images\/([a-z0-9]+)[^"']*)["']/gi)) found.set(m[1], m[2]);
  }
  return found;
}

/** A file name the title makes: no character a file system refuses. */
export function fileName(title: string, extension: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
  return `${base}.${extension}`;
}
