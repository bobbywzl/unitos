/**
 * The HTML renderer: a spec's leaves → an .html page → Chromium's print to PDF. Math is KaTeX (its own fonts);
 * list markers are text, so the PDF prints them as the reference names them; running heads and page numbers
 * come from @page margin boxes in the spec's CSS.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import katex from "katex";
import type { Browser } from "playwright-core";
import { pictureSvg, picturePng } from "./pictures";
import { pinPdf } from "./stamp";
import { tableGrid, type Group, type Leaf, type RenderBlock, type SpecRow, type SpecSpan } from "./spec";

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

function htmlSpans(spans: SpecSpan[]): string {
  return spans
    .map((s) => {
      if (s.footnote !== undefined) return s.text ? `<sup class="fn">${escapeHtml(s.text)}</sup>` : "";
      if (s.qed) return `<span class="qed">□</span>`;
      if (s.latex) return tex(s.latex, false);
      if (s.dropCap) return `<span class="drop-cap">${escapeHtml(s.text[0])}</span>${escapeHtml(s.text.slice(1))}`;
      let out = escapeHtml(s.text);
      if (s.code) out = `<code>${out}</code>`;
      if (s.smallCaps) out = `<span class="sc">${out}</span>`;
      if (s.italic) out = `<i>${out}</i>`;
      if (s.bold) out = `<b>${out}</b>`;
      if (s.underline) out = `<u>${out}</u>`;
      if (s.highlight) out = `<mark style="background:${s.highlight}">${out}</mark>`;
      if (s.href) out = `<a href="${escapeHtml(s.href)}">${out}</a>`;
      return out;
    })
    .join("");
}

function htmlTable(block: Extract<RenderBlock, { kind: "table" }>): string {
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
      return `<${tag}${attrs}>${htmlSpans(c.spans)}</${tag}>`;
    });
    const rule = r.rule ? ' class="rule"' : "";
    return `<tr${rule}${shade ? ` style="background:${shade}"` : ""}>${cells.join("")}</tr>`;
  };
  const head = block.rows.slice(0, headers).map((r, k) => rowHtml(r, k));
  const body = block.rows.slice(headers).map((r, k) => rowHtml(r, k + headers));
  const caption = block.caption ? `<p class="caption">${htmlSpans(block.caption)}</p>` : "";
  const total = tl.widths?.reduce((a, c) => a + c, 0) ?? 0;
  const cols = tl.widths ? `<colgroup>${tl.widths.map((w) => `<col style="width:${((100 * w) / total).toFixed(1)}%">`).join("")}</colgroup>` : "";
  return `<div class="table-wrap${tl.small ? " small" : ""}${tl.wide ? " wide" : ""}">${caption}<table class="${tl.rules ?? "booktabs"}"${tl.widths ? ' style="width:100%"' : ""}>${cols}<thead>${head.join("")}</thead><tbody>${body.join("")}</tbody></table></div>`;
}

/** The page's HTML; photos come as PNG files beside it (`photos`, in order of the figures). */
export function htmlSource(title: string, layout: HtmlLayout, leaves: Leaf[], photos: string[]): string {
  const out: string[] = [];
  const open: Group[] = [];
  let photoIndex = 0;
  let runIn: string | null = null;

  for (const { block, groups } of leaves) {
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
        out.push(`<p class="title">${htmlSpans(block.spans)}</p>`);
        break;
      case "heading": {
        if (block.runIn) {
          runIn = `<span class="run-in">${htmlSpans(block.spans)}</span> `;
          break;
        }
        const level = Math.min(6, block.level);
        out.push(`<h${level}${block.chapter !== undefined ? ' class="chapter"' : ""}>${htmlSpans(block.spans)}</h${level}>`);
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
        let text = htmlSpans(block.spans);
        if (runIn) {
          text = runIn + text;
          runIn = null;
        }
        out.push(`<p${classes.length ? ` class="${classes.join(" ")}"` : ""}>${text}</p>`);
        break;
      }
      case "list":
        if (block.flush) {
          for (const it of block.items) out.push(`<p class="flush-item">${escapeHtml(it.marker)} ${htmlSpans(it.spans)}</p>`);
          break;
        }
        out.push('<div class="list">');
        for (const it of block.items) {
          out.push(`<div class="item depth-${it.depth}"><span class="marker">${escapeHtml(it.marker)}</span><span class="text">${htmlSpans(it.spans)}</span></div>`);
        }
        out.push("</div>");
        break;
      case "equation":
        out.push(`<div class="display">${tex(block.label ? `${block.latex}\\tag*{${block.label}}` : block.latex, true)}</div>`);
        break;
      case "table":
        out.push(htmlTable(block));
        break;
      case "figure": {
        const picture = block.picture.kind === "photo" ? `<img src="${photos[photoIndex++]}" width="${block.picture.width}" height="${block.picture.height}" alt="">` : pictureSvg(block.picture);
        const width = block.width ? ` style="width:${Math.round(block.width * 100)}%;margin-left:auto;margin-right:auto"` : "";
        out.push(`<figure${width}>${picture}${block.caption ? `<figcaption class="caption">${htmlSpans(block.caption)}</figcaption>` : ""}</figure>`);
        break;
      }
      case "code":
        out.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "quote":
        out.push(`<blockquote${block.pull ? ' class="pull"' : ""}>${htmlSpans(block.spans)}</blockquote>`);
        break;
      case "footnote":
        out.push(`<p class="footnote"><sup>${escapeHtml(block.label)}</sup> ${htmlSpans(block.spans)}</p>`);
        break;
      case "separator":
        out.push("<hr>");
        break;
      case "pagebreak":
        out.push('<div class="pagebreak"></div>');
        break;
    }
  }
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

/** Writes the page and its photos into `dir`, prints it with Chromium, and returns the PDF's path. */
export async function renderHtml(opts: { name: string; title: string; layout: HtmlLayout; leaves: Leaf[]; dir: string; browser: Browser }): Promise<string> {
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
  return pdfPath;
}
