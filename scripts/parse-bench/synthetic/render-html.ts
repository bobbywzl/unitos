/**
 * The HTML renderer: a spec's leaves → an .html page → Chromium's print to PDF. Math is KaTeX (its own fonts);
 * list markers are text, so the PDF prints them as the reference names them; running heads and page numbers
 * come from @page margin boxes in the spec's CSS. What the page's CSS sets beyond the spec (a caption's italics,
 * a justified column, each block's font) is read back from the browser's computed styles (`readLooks`), from a
 * copy of the page that marks each leaf and each span; the printed page is made without the marks.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import katex from "katex";
import type { Browser } from "playwright-core";
import { pictureSvg, picturePng } from "./pictures";
import type { Align, Font } from "../model";
import { pinPdf } from "./stamp";
import { ink, tableGrid, type Group, type Leaf, type LeafLook, type RenderBlock, type SpecRow, type SpecSpan } from "./spec";

export type HtmlLayout = {
  /** The page's stylesheet: fonts, sizes, @page size, margins and margin boxes, columns. */
  css: string;
  /** The page's head and foot bands in points from the top and bottom edges: what prints there is furniture. */
  bands: { top: number; bottom: number };
};

const require = createRequire(import.meta.url);
const KATEX_DIST = dirname(require.resolve("katex/dist/katex.min.css"));

/** KaTeX's stylesheet with its fonts loaded from node_modules. */
const katexCss = () =>
  readFileSync(join(KATEX_DIST, "katex.min.css"), "utf8").replace(/url\(fonts\//g, `url(${pathToFileURL(join(KATEX_DIST, "fonts")).href}/`);

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tex = (latex: string, displayMode: boolean) => katex.renderToString(latex, { displayMode, output: "html", throwOnError: true, strict: "error" });

/** The structure's own styles; a spec's CSS comes after and sets the look. */
const BASE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
p { margin: 0 0 0.6em; }
p.center { text-align: center; }
p.right { text-align: right; }
p.indent-first { text-indent: 1.5em; }
p.indent-hanging { padding-left: 2em; text-indent: -2em; }
p.indent-block { margin-left: 2em; }
p.continues { text-indent: 0; }
p.small { font-size: 0.85em; }
.sc { font-variant: small-caps; }
.list { margin: 0 0 0.6em; }
.item { display: flex; }
.item > .marker { flex: 0 0 auto; min-width: 2em; padding-right: 0.5em; text-align: right; }
.item > .text { flex: 1 1 auto; }
.depth-1 { margin-left: 2em; } .depth-2 { margin-left: 4em; } .depth-3 { margin-left: 6em; }
p.flush-item { margin: 0; }
.display { margin: 0.6em 0; }
table { border-collapse: collapse; margin: 0 auto; }
th, td { padding: 3px 8px; vertical-align: top; }
td.r, th.r { text-align: right; } td.c, th.c { text-align: center; } td.l, th.l { text-align: left; }
table.grid th, table.grid td { border: 1px solid #000; }
table.booktabs { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; }
table.booktabs thead tr:last-child th { border-bottom: 1px solid #000; }
figure { margin: 1em 0; text-align: center; break-inside: avoid; }
figure svg, figure img { max-width: 100%; height: auto; }
.table-wrap { margin: 1em 0; break-inside: avoid; }
.caption { text-align: center; margin: 0.4em 0; }
pre { margin: 0.6em 0; white-space: pre-wrap; }
.qed { float: right; }
sup.fn { font-size: 0.7em; line-height: 0; }
.pagebreak { break-after: page; }
.drop-cap { float: left; font-size: 2.9em; line-height: 0.85; padding: 0.05em 0.06em 0 0; }
.table-wrap.wide { column-span: all; }
`;

/** A span's words, marked `data-s="<key>/<index>"` when a key is given (the
    copy of the page whose computed styles are read back). */
function htmlSpans(spans: SpecSpan[], key: string | null = null): string {
  return spans
    .map((s, j) => {
      if (s.footnote !== undefined) return s.text ? `<sup class="fn">${escapeHtml(s.text)}</sup>` : "";
      if (s.qed) return `<span class="qed">□</span>`;
      if (s.latex) return tex(s.latex, false);
      const words = (html: string) => (key ? `<span data-s="${key}/${j}">${html}</span>` : html);
      if (s.dropCap) return words(`<span class="drop-cap">${escapeHtml(s.text[0])}</span>${escapeHtml(s.text.slice(1))}`);
      let out = words(escapeHtml(s.text));
      if (s.code) out = `<code>${out}</code>`;
      if (s.smallCaps) out = `<span class="sc">${out}</span>`;
      if (s.italic) out = `<i>${out}</i>`;
      if (s.bold) out = `<b>${out}</b>`;
      if (s.underline) out = `<u>${out}</u>`;
      if (s.strike) out = `<s>${out}</s>`;
      if (s.color) out = `<span style="color:${s.color}">${out}</span>`;
      if (s.highlight) out = `<mark style="background:${s.highlight}">${out}</mark>`;
      if (s.href) out = `<a href="${escapeHtml(s.href)}">${out}</a>`;
      return out;
    })
    .join("");
}

function htmlTable(block: Extract<RenderBlock, { kind: "table" }>, key: string | null): string {
  const tl = block.layout ?? {};
  const headerCount = block.rows.findIndex((r) => !r.cells.some((c) => c.header));
  const headers = headerCount === -1 ? block.rows.length : headerCount;
  const { slots } = tableGrid(block.rows);
  const rowHtml = (r: SpecRow, index: number) => {
    const shade = r.shade ?? (index < headers ? tl.shadeHeader : undefined);
    const cols = slots[index].flatMap((slot) => ("cell" in slot ? [slot.col] : []));
    const cells = r.cells.map((c, k) => {
      const tag = c.header ? "th" : "td";
      const align = c.align ?? tl.align?.[cols[k]] ?? "l";
      const attrs = `${c.colspan ? ` colspan="${c.colspan}"` : ""}${c.rowspan ? ` rowspan="${c.rowspan}"` : ""} class="${align}"`;
      return `<${tag}${attrs}>${htmlSpans(c.spans, key && `${key}/c${index}.${k}`)}</${tag}>`;
    });
    const rule = r.rule ? ' class="rule"' : "";
    return `<tr${rule}${shade ? ` style="background:${shade}"` : ""}>${cells.join("")}</tr>`;
  };
  const head = block.rows.slice(0, headers).map((r, k) => rowHtml(r, k));
  const body = block.rows.slice(headers).map((r, k) => rowHtml(r, k + headers));
  const caption = block.caption ? `<p class="caption">${htmlSpans(block.caption, key && `${key}/cap`)}</p>` : "";
  const total = tl.widths?.reduce((a, c) => a + c, 0) ?? 0;
  const cols = tl.widths ? `<colgroup>${tl.widths.map((w) => `<col style="width:${((100 * w) / total).toFixed(1)}%">`).join("")}</colgroup>` : "";
  const mark = key ? ` data-leaf="${key}"` : "";
  return `<div class="table-wrap${tl.small ? " small" : ""}${tl.wide ? " wide" : ""}"${mark}>${caption}<table class="${tl.rules ?? "booktabs"}"${tl.widths ? ' style="width:100%"' : ""}>${cols}<thead>${head.join("")}</thead><tbody>${body.join("")}</tbody></table></div>`;
}

/** The page's HTML; photos come as PNG files beside it (`photos`, in order of the figures). `marked`: each
    leaf's block marked `data-leaf="<index>"` and each span's words `data-s` (readLooks). */
export function htmlSource(title: string, layout: HtmlLayout, leaves: Leaf[], photos: string[], marked = false): string {
  const out: string[] = [];
  const open: Group[] = [];
  let photoIndex = 0;
  let runIn: string | null = null;

  leaves.forEach(({ block, groups }, index) => {
    const key = marked ? String(index) : null;
    const mark = marked ? ` data-leaf="${index}"` : "";
    let keep = 0;
    while (keep < open.length && keep < groups.length && open[keep].id === groups[keep].id) keep++;
    while (open.length > keep) {
      open.pop();
      out.push("</div>");
    }
    for (const group of groups.slice(keep)) {
      out.push(group.kind === "theorem" ? `<div class="thm thm-${group.style}">` : `<div class="box box-${group.name}">`);
      open.push(group);
    }
    switch (block.kind) {
      case "title":
        out.push(`<p class="title"${mark}>${htmlSpans(block.spans, key && `${key}/s`)}</p>`);
        break;
      case "heading": {
        if (block.runIn) {
          runIn = `<span class="run-in"${mark}>${htmlSpans(block.spans, key && `${key}/s`)}</span> `;
          break;
        }
        const level = Math.min(6, block.level);
        out.push(`<h${level}${block.chapter !== undefined ? ' class="chapter"' : ""}${mark}>${htmlSpans(block.spans, key && `${key}/s`)}</h${level}>`);
        break;
      }
      case "paragraph": {
        const classes = [
          block.align,
          block.indent ? `indent-${block.indent}` : "",
          block.role ? `role role-${block.role}` : "",
          block.small ? "small" : "",
          block.continues ? "continues" : "",
          block.chapterLabel ? "chapter-label" : "",
        ].filter(Boolean);
        let text = htmlSpans(block.spans, key && `${key}/s`);
        if (runIn) {
          text = runIn + text;
          runIn = null;
        }
        out.push(`<p${classes.length ? ` class="${classes.join(" ")}"` : ""}${mark}>${text}</p>`);
        break;
      }
      case "list":
        if (block.flush) {
          block.items.forEach((it, k) => out.push(`<p class="flush-item"${mark}>${escapeHtml(it.marker)} ${htmlSpans(it.spans, key && `${key}/i${k}`)}</p>`));
          break;
        }
        out.push(`<div class="list"${mark}>`);
        block.items.forEach((it, k) => {
          out.push(`<div class="item depth-${it.depth}"><span class="marker">${escapeHtml(it.marker)}</span><span class="text">${htmlSpans(it.spans, key && `${key}/i${k}`)}</span></div>`);
        });
        out.push("</div>");
        break;
      case "equation":
        out.push(`<div class="display">${tex(block.label ? `${block.latex}\\tag*{${block.label}}` : block.latex, true)}</div>`);
        break;
      case "table":
        out.push(htmlTable(block, key));
        break;
      case "figure": {
        const picture = block.picture.kind === "photo" ? `<img src="${photos[photoIndex++]}" width="${block.picture.width}" height="${block.picture.height}" alt="">` : pictureSvg(block.picture);
        const width = block.width ? ` style="width:${Math.round(block.width * 100)}%;margin-left:auto;margin-right:auto"` : "";
        out.push(`<figure${width}${mark}>${picture}${block.caption ? `<figcaption class="caption">${htmlSpans(block.caption, key && `${key}/cap`)}</figcaption>` : ""}</figure>`);
        break;
      }
      case "code":
        out.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "quote":
        out.push(`<blockquote${block.pull ? ' class="pull"' : ""}${mark}>${htmlSpans(block.spans, key && `${key}/s`)}</blockquote>`);
        break;
      case "footnote":
        out.push(`<p class="footnote"${mark}><sup>${escapeHtml(block.label)}</sup> ${htmlSpans(block.spans, key && `${key}/s`)}</p>`);
        break;
      case "separator":
        out.push("<hr>");
        break;
      case "contents":
        throw new Error("a contents field is a Word rendering's alone");
      case "pagebreak":
        out.push('<div class="pagebreak"></div>');
        break;
    }
  });
  while (open.pop()) out.push("</div>");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${katexCss()}</style>
<style>${BASE_CSS}</style>
<style>${layout.css}</style>
</head>
<body>
${out.join("\n")}
</body>
</html>
`;
}

/** A span as the browser draws it. */
export type DrawnSpan = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; color?: string; highlight?: string };

/** What the page shows of each leaf and each span, read back from the browser: `looks` by leaf, `drawn` by
    the span's key ("<leaf>/<part>/<index>"; the part: "s" a block's spans, "i3" a list's fourth item, "c2.1"
    a table's cell, "cap" a caption). */
export type Looks = { looks: LeafLook[]; drawn: Map<string, DrawnSpan> };

/** A CSS color ("rgb(r, g, b)") as "#rrggbb", or null for none or a transparent one. */
function cssHex(value: string): string | null {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value.trim());
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
}
/** A face's shape from a CSS font-family list: its generic family, else its first face's name. */
function cssShape(family: string): Font["shape"] {
  const names = family.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase());
  const generic = names.find((f) => f === "serif" || f === "sans-serif" || f === "monospace");
  if (generic) return generic === "serif" ? "serif" : generic === "monospace" ? "mono" : "sans";
  return /mono|courier|consol/.test(names[0] ?? "") ? "mono" : /serif|times|roman|georgia|garamond|cambria/.test(names[0] ?? "") && !/sans/.test(names[0] ?? "") ? "serif" : "sans";
}

/** Reads the computed styles of a marked copy of the page (htmlSource with `marked`). A leaf's font is the
    look most of its words take (a table's and a figure's: the caption's); its alignment, a title's, a
    heading's, or a paragraph's. A span's decorations and inline background come from the elements between it
    and its leaf's block (the browser does not inherit them). */
export async function readLooks(browser: Browser, htmlPath: string, leaves: Leaf[]): Promise<Looks> {
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const read = await page.evaluate(async () => {
      await document.fonts.ready;
      const spans = [...document.querySelectorAll<HTMLElement>("[data-s]")].map((el) => {
        const cs = getComputedStyle(el);
        let underline = false;
        let strike = false;
        let highlight = "";
        for (let a: HTMLElement | null = el; a; a = a.parentElement) {
          const style = getComputedStyle(a);
          if (style.textDecorationLine.includes("underline")) underline = true;
          if (style.textDecorationLine.includes("line-through")) strike = true;
          if (!highlight && style.display === "inline" && style.backgroundColor !== "rgba(0, 0, 0, 0)") highlight = style.backgroundColor;
          if (a.hasAttribute("data-leaf")) break;
        }
        return {
          key: el.dataset.s ?? "",
          chars: (el.textContent ?? "").length,
          family: cs.fontFamily,
          size: Number.parseFloat(cs.fontSize),
          weight: Number(cs.fontWeight),
          italic: cs.fontStyle !== "normal",
          underline,
          strike,
          color: cs.color,
          highlight,
          link: el.closest("a") !== null,
        };
      });
      const blocks = [...document.querySelectorAll<HTMLElement>("[data-leaf]")].map((el) => ({ leaf: Number(el.dataset.leaf), align: getComputedStyle(el).textAlign, inline: getComputedStyle(el).display === "inline" }));
      return { spans, blocks };
    });
    const drawn = new Map<string, DrawnSpan>();
    const faces = new Map<number, Map<string, number>>();
    for (const span of read.spans) {
      const color = ink(cssHex(span.color));
      const highlight = cssHex(span.highlight);
      drawn.set(span.key, { bold: span.weight >= 600, italic: span.italic, underline: span.underline, strike: span.strike, ...(color ? { color } : {}), ...(highlight ? { highlight } : {}) });
      const [leaf, part] = span.key.split("/");
      const block = leaves[Number(leaf)]?.block;
      if (!block || ((block.kind === "table" || block.kind === "figure") && part !== "cap")) continue;
      // A link's blue is the link's, not its words' color.
      const font: Font = { shape: cssShape(span.family), size: Math.round(span.size * 0.75 * 100) / 100, ...(span.weight >= 600 ? { bold: true } : {}), ...(color && !span.link ? { color } : {}) };
      const tally = faces.get(Number(leaf)) ?? new Map<string, number>();
      tally.set(JSON.stringify(font), (tally.get(JSON.stringify(font)) ?? 0) + span.chars);
      faces.set(Number(leaf), tally);
    }
    const looks: LeafLook[] = leaves.map(() => ({}));
    for (const [leaf, tally] of faces) looks[leaf].font = JSON.parse([...tally].sort((a, b) => b[1] - a[1])[0][0]) as Font;
    for (const { leaf, align, inline } of read.blocks) {
      const kind = leaves[leaf]?.block.kind;
      if (inline || !(kind === "title" || kind === "heading" || kind === "paragraph")) continue;
      // A title or a heading inherits a justified column's alignment, but one line draws flush left.
      const value: Align | undefined =
        align === "center" ? "center" : align === "right" || align === "end" ? "right" : align === "justify" && kind === "paragraph" ? "justify" : undefined;
      if (value) looks[leaf].align = value;
    }
    return { looks, drawn };
  } finally {
    await page.close();
  }
}

/** The leaves with each span of a paragraph, a list, a quote, a footnote, a table, and a caption styled as the
    browser draws it (a caption's or a pull quote's italics come from the page's CSS, not the spec); a title's
    and a heading's look is their font's. Math, footnote marks, and code keep the spec's. */
export function withDrawn(leaves: Leaf[], drawn: Map<string, DrawnSpan>): Leaf[] {
  const restyle = (spans: SpecSpan[], key: string): SpecSpan[] =>
    spans.map((span, j) => {
      const d = drawn.get(`${key}/${j}`);
      if (!d || span.latex || span.footnote || span.qed || span.code) return span;
      const out: SpecSpan = { ...span };
      for (const flag of ["bold", "italic", "underline", "strike"] as const) {
        if (d[flag]) out[flag] = true;
        else delete out[flag];
      }
      for (const value of ["color", "highlight"] as const) {
        if (d[value]) out[value] = d[value];
        else delete out[value];
      }
      return out;
    });
  return leaves.map((leaf, k): Leaf => {
    const block = leaf.block;
    switch (block.kind) {
      case "paragraph":
      case "quote":
      case "footnote":
        return { ...leaf, block: { ...block, spans: restyle(block.spans, `${k}/s`) } };
      case "list":
        return { ...leaf, block: { ...block, items: block.items.map((it, i) => ({ ...it, spans: restyle(it.spans, `${k}/i${i}`) })) } };
      case "table":
        return {
          ...leaf,
          block: {
            ...block,
            ...(block.caption ? { caption: restyle(block.caption, `${k}/cap`) } : {}),
            rows: block.rows.map((r, ri) => ({ ...r, cells: r.cells.map((c, ci) => ({ ...c, spans: restyle(c.spans, `${k}/c${ri}.${ci}`) })) })),
          },
        };
      case "figure":
        return block.caption ? { ...leaf, block: { ...block, caption: restyle(block.caption, `${k}/cap`) } } : leaf;
      default:
        return leaf;
    }
  });
}

/** Writes the page and its photos into `dir`, prints it with Chromium, and reads back what the page shows
    beyond the spec (readLooks); the PDF is `<name>.pdf` in `dir`. */
export async function renderHtml(opts: { name: string; title: string; layout: HtmlLayout; leaves: Leaf[]; dir: string; browser: Browser }): Promise<Looks> {
  const photos: string[] = [];
  for (const { block } of opts.leaves) {
    if (block.kind !== "figure" || block.picture.kind !== "photo") continue;
    const file = `${opts.name}-figure-${photos.length + 1}.png`;
    await picturePng(opts.browser, block.picture, join(opts.dir, file));
    photos.push(file);
  }
  const htmlPath = join(opts.dir, `${opts.name}.html`);
  writeFileSync(htmlPath, htmlSource(opts.title, opts.layout, opts.leaves, photos));
  const pdfPath = join(opts.dir, `${opts.name}.pdf`);
  const page = await opts.browser.newPage();
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
  pinPdf(pdfPath);
  const markedPath = join(opts.dir, `${opts.name}-marked.html`);
  writeFileSync(markedPath, htmlSource(opts.title, opts.layout, opts.leaves, photos, true));
  return readLooks(opts.browser, markedPath, opts.leaves);
}
