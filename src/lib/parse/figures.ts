import { FIGURE_BOX_TEXT_MAX, isChartSvg } from "@/lib/parse/figure-style";
import { hasDirectText, normalizeText, separateBlocks, spacedText, withReadableMath } from "@/lib/parse/dom-text";
import { isFigureCaption } from "@/lib/parse/figure-audit";
import { stripCitationTokens } from "@/lib/parse/references";
import { sanitizeHtml, sanitizeSvgElement } from "@/lib/parse/sanitize";
import type { ParsedBlock } from "@/lib/parse/types";

// Figures in the URL walk (lib/parse/url.ts): which media is content, what
// a figure's caption is, and the FIGURE block an element becomes. Nothing is
// authored here: media URLs are the page's URLs, captions are the page's
// text (SPEC.md §2).
//
// A figure's html is one <figure>. Inside: the media, the captions as <p>
// or <figcaption> (class="center" when the page centers them), and for a
// figure row — a flex or grid parent whose columns each hold media and a
// caption — one nested <figure> per captioned column. Widths ride as
// data-width-pct, written by the page-style bake (lib/parse/figure-style.ts)
// and turned into inline style by the sanitizer; a figure the page sets
// wider than its text column carries the width past 100 on the <figure>
// itself. A figure's block text is its captions joined with "\n", else the
// image's alt, else "Figure".

export type WalkCtx = {
  url: string;
  blocks: ParsedBlock[];
  seenMedia: Set<string>;
};

// A caption without a "Figure N" label is at most this long; longer text
// beside media is prose.
const CAPTION_MAX_CHARS = 200;
// A caption folded into the figure beside it is at most this long.
const REPAIR_CAPTION_MAX_CHARS = 300;
// A box that holds a figure (data-box, from the page-style bake: an element
// the page paints its own background under, or sets in its own font around
// a chart) holds the figure's words: a chart's title, legend, axis labels,
// source line. They are at most FIGURE_BOX_TEXT_MAX long outside the media
// (lib/parse/figure-style.ts); a box with more text is a boxed section of
// prose, not a figure.
const MEDIA_SELECTOR = "img[src], video, iframe, svg";

// A decorative asset is not content: tiny dimensions, or an unlabeled .svg icon.
export function isContentImage(img: Element): boolean {
  const width = Number(img.getAttribute("width") ?? 0);
  const height = Number(img.getAttribute("height") ?? 0);
  // Icons and avatars: a declared size of 48px or less (a byline's 40px
  // avatar made a figure of the byline — import compare loop finding).
  if ((width > 0 && width <= 48) || (height > 0 && height <= 48)) return false;
  const src = img.getAttribute("src") ?? "";
  if (/\.svg(\?|#|$)/i.test(src) && !normalizeText(img.getAttribute("alt") ?? "")) return false;
  return true;
}

function isMedia(el: Element): boolean {
  return /^(img|video|iframe|svg)$/i.test(el.tagName);
}

/** Meaningful media in or at an element: a chart svg, a video, an iframe,
    a content image. */
function isMeaningfulMedia(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "svg") return isChartSvg(el);
  if (tag === "video" || tag === "iframe") return el.hasAttribute("src");
  if (tag === "img") return el.hasAttribute("src") && isContentImage(el);
  return false;
}

export function hasMeaningfulMedia(el: Element): boolean {
  if (isMeaningfulMedia(el)) return true;
  if ([...el.querySelectorAll("svg")].some(isChartSvg)) return true;
  if (el.querySelector("video[src], iframe[src]")) return true;
  return [...el.querySelectorAll("img[src]")].some(isContentImage);
}

/** An svg the page's scripts draw later: a viewBox and nothing inside. */
export function isEmptyChart(svg: Element): boolean {
  if (svg.tagName.toLowerCase() !== "svg" || svg.children.length > 0) return false;
  const viewBox = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  return (viewBox?.[2] ?? 0) > 100;
}

export function mediaKeys(html: string): string[] {
  return [...html.matchAll(/(?:src|poster)="([^"]+)"/g)].map((m) => m[1]);
}

/** Media inside a figure, deduped: a mobile variant of a src we already keep is
    the same asset twice. */
function dedupeFigureMedia(figure: Element) {
  const media = [...figure.querySelectorAll("img[src], video[src]")];
  const kept = new Set<string>();
  for (const el of media) {
    const src = el.getAttribute("src") ?? "";
    const canonical = src.replace(/[-_.](mobile|desktop|sm|md|lg|small|large)\b/gi, "");
    if (kept.has(canonical)) {
      el.remove();
      continue;
    }
    kept.add(canonical);
  }
}

function captionText(el: Element): string {
  return spacedText(withReadableMath(el));
}

/** The text an element holds outside its media. */
function textOutsideMedia(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const media of clone.querySelectorAll("svg, video, iframe, img")) media.remove();
  return spacedText(clone);
}

/** A box that holds a figure: a data-box element with meaningful media
    and no more text than a figure's words. */
function isFigureBox(el: Element): boolean {
  return el.hasAttribute("data-box") && hasMeaningfulMedia(el) && textOutsideMedia(el).length <= FIGURE_BOX_TEXT_MAX;
}

/** The boxes that hold a figure below a container, and the same elements
    in a clone of the container (a deep clone keeps document order). */
function figureBoxes(container: Element, clone: Element): Element[] {
  const original = [...container.querySelectorAll("[data-box]")];
  const copied = [...clone.querySelectorAll("[data-box]")];
  return copied.filter((_, i) => original[i] !== undefined && isFigureBox(original[i]));
}

/** Text in a box that holds the figure's media, below the container, is
    the figure's words, not its caption: a chart's title, legend, axis
    labels, source line. The caption sits outside the box, on the page's
    own background. A labeled caption is a caption wherever it sits. */
function isFigureWords(el: Element, container: Element): boolean {
  if (isLabeledCaption(el)) return false;
  for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
    if (node.hasAttribute("data-box") && hasMeaningfulMedia(node)) return isFigureBox(node);
  }
  return false;
}

/** Does the element, or an ancestor below the container, sit beside media? */
function besideMedia(el: Element, container: Element): boolean {
  for (let node: Element | null = el; node && node !== container; node = node.parentElement) {
    for (const sibling of [node.previousElementSibling, node.nextElementSibling]) {
      if (sibling && (isMeaningfulMedia(sibling) || hasMeaningfulMedia(sibling))) return true;
    }
  }
  return false;
}

/** A labeled caption: a figcaption, or text that opens like "Figure 2." */
function isLabeledCaption(el: Element): boolean {
  return el.tagName.toLowerCase() === "figcaption" || isFigureCaption(captionText(el));
}

/** A plain caption: short text beside media. */
function isPlainCaption(el: Element, container: Element): boolean {
  const text = captionText(el);
  return text.length > 0 && text.length <= CAPTION_MAX_CHARS && besideMedia(el, container);
}

/** The caption elements of a figure container: its labeled captions when it
    has any, else its plain captions. Never a caption inside a nested
    caption, never the figure's words. */
function captionElements(container: Element): Element[] {
  const candidates = [...container.querySelectorAll("figcaption, p")].filter(
    (el) => captionText(el).length > 0 && el.parentElement?.closest("figcaption") === null,
  );
  const labeled = candidates.filter(isLabeledCaption);
  if (labeled.length > 0) return labeled;
  return candidates.filter((el) => !isFigureWords(el, container) && isPlainCaption(el, container));
}

/** A figure's caption text: its captions joined with a line break; else
    whatever short text sits beside the media, the figure's words left out.
    Called on figure containers and on captioned tables (lib/parse/url.ts). */
export function figureCaption(el: Element): string {
  const captions = captionElements(el);
  if (captions.length > 0) return captions.map(captionText).join("\n");
  const clone = el.cloneNode(true) as Element;
  for (const box of figureBoxes(el, clone)) box.remove();
  for (const media of clone.querySelectorAll("svg, video, img")) media.remove();
  const residual = spacedText(clone);
  return residual.length <= CAPTION_MAX_CHARS ? residual : "";
}

/** The children of an element that hold meaningful media. */
function mediaColumns(el: Element): Element[] {
  return [...el.children].filter((child) => isMeaningfulMedia(child) || hasMeaningfulMedia(child));
}

/** The figure row inside a container: the topmost element whose children
    hold meaningful media two or more times over. */
function figureRow(container: Element): Element | null {
  const columns = mediaColumns(container);
  if (columns.length >= 2) return container;
  if (columns.length === 1 && !isMedia(columns[0])) return figureRow(columns[0]);
  return null;
}

// Width percentages: a column or a media element holds up to the column's
// width; a figure wider than the column holds up to twice it.
const WIDTH_PCT_MIN = 15;
const WIDTH_PCT_MAX = 200;

/** A width percentage attribute, or null. */
function widthPct(el: Element): number | null {
  const n = Number(el.getAttribute("data-width-pct") ?? "");
  return Number.isInteger(n) && n >= WIDTH_PCT_MIN && n <= WIDTH_PCT_MAX ? n : null;
}

/** A figure wider than the text column: the width past 100 moves from the
    figure's media (or its row) to the figure itself, so the sanitizer writes
    it on the <figure> and the reader draws the figure past the column's
    edges. The media inside is then as wide as the figure. */
function liftWideWidth(shell: Element, row: Element | null) {
  // A video keeps the column: drawn past it, a video runs past its own
  // pixels on a high-density screen and goes soft, where a chart or a
  // photo holds up (the videos of a page are made for its column, not for
  // twice the pixels).
  if (shell.querySelector("video")) return;
  const candidates: Element[] = [];
  if (row) candidates.push(row);
  for (const media of shell.querySelectorAll(MEDIA_SELECTOR)) {
    if (media.parentElement?.closest("figure") === shell) candidates.push(media);
  }
  let wide: number | null = null;
  for (const el of candidates) {
    const pct = widthPct(el);
    if (pct !== null && pct > 100 && (wide === null || pct > wide)) wide = pct;
  }
  if (wide === null) return;
  shell.setAttribute("data-width-pct", String(wide));
  for (const el of candidates) {
    const pct = widthPct(el);
    if (pct !== null && pct > 100) el.removeAttribute("data-width-pct");
  }
}

// Block elements the sanitizer unwraps. One that holds only inline content
// (a legend row of spans, a chart's title in a div) becomes a paragraph, so
// its words stay on one row in the figure instead of falling out one per
// line.
const INLINE_ONLY_WRAPPERS = new Set(["div", "section", "header", "footer", "aside", "nav", "small", "label"]);
const BLOCK_SELECTOR = "p, div, section, header, footer, aside, nav, figure, figcaption, ul, ol, li, table, pre, blockquote, h1, h2, h3, h4, h5, h6, img, svg, video, iframe";

/** Inside a figure, every wrapper that holds only inline content becomes a
    <p> that keeps the wrapper's look and alignment. */
function inlineWrappersToParagraphs(root: Element) {
  const document = root.ownerDocument;
  for (const el of [...root.querySelectorAll("*")].reverse()) {
    if (!INLINE_ONLY_WRAPPERS.has(el.tagName.toLowerCase()) || el === root) continue;
    if (el.querySelector(BLOCK_SELECTOR) || el.closest("svg")) continue;
    if (normalizeText(el.textContent ?? "").length === 0) continue;
    const p = document.createElement("p");
    for (const name of ["style", "data-align", "class"]) {
      const value = el.getAttribute(name);
      if (value) p.setAttribute(name, value);
    }
    p.append(...el.childNodes);
    el.replaceWith(p);
  }
}

/** Wrap each captioned column of a row in its own figure. The column's
    width is the row's share it had on the page; the media inside is
    resized to the column. A box inside the column stays a box: the
    sanitizer keeps it as a div with the box's look. */
function nestColumns(row: Element) {
  const document = row.ownerDocument;
  for (const column of mediaColumns(row)) {
    if (isMedia(column) || captionElements(column).length === 0) continue;
    const figure = document.createElement("figure");
    const columnPct = widthPct(column);
    if (columnPct !== null) figure.setAttribute("data-width-pct", String(columnPct));
    for (const media of column.querySelectorAll(MEDIA_SELECTOR)) {
      const mediaPct = widthPct(media);
      if (mediaPct === null || columnPct === null) {
        media.removeAttribute("data-width-pct");
        continue;
      }
      const inColumn = Math.round((100 * mediaPct) / columnPct);
      if (inColumn >= 95) media.removeAttribute("data-width-pct");
      else media.setAttribute("data-width-pct", String(Math.max(WIDTH_PCT_MIN, inColumn)));
    }
    figure.append(...column.childNodes);
    column.replaceWith(figure);
  }
}

export function figureBlock(el: Element, ctx: WalkCtx): ParsedBlock | null {
  const clone = el.cloneNode(true) as Element;
  dedupeFigureMedia(clone);
  // Charts render as themselves; icon svgs and decorative images are noise.
  for (const svg of [...clone.querySelectorAll("svg")]) {
    if (!isChartSvg(svg)) svg.remove();
  }
  for (const img of [...clone.querySelectorAll("img")]) {
    if (!isContentImage(img)) img.remove();
  }
  const caption = figureCaption(clone);
  const alt = normalizeText(clone.querySelector("img[alt]")?.getAttribute("alt") ?? "");
  // A figure row: one nested figure per captioned column.
  const row = figureRow(clone);
  if (row) nestColumns(row);
  // The figure's html renders its own text: the same spaces the caption got,
  // so a caption span and a credit span read apart on screen too and the
  // figure's DOM text stays the block's text (SPEC.md §5).
  separateBlocks(clone);
  // The figure's words keep their rows: a legend of spans in a div is one
  // paragraph, not one line per span.
  inlineWrappersToParagraphs(clone);
  if (!hasMeaningfulMedia(clone)) {
    // A figure with no media is its text: a pull quote wrapped in <figure>
    // is a paragraph, and a bare caption is a paragraph.
    const text = caption || normalizeText(clone.textContent ?? "");
    return text ? { type: "PARAGRAPH", text } : null;
  }

  // A wrapper around one <figure> is that figure, not a figure in a figure.
  const only = clone.children.length === 1 && !hasDirectText(clone) ? clone.children[0] : null;
  let shell =
    clone.tagName.toLowerCase() === "figure"
      ? clone
      : only && only.tagName.toLowerCase() === "figure"
        ? only
        : null;
  if (!shell) {
    shell = clone.ownerDocument.createElement("figure");
    // A bare media element is the figure's whole content; a container's
    // children are. A container that is itself a box keeps the box's look
    // on the figure: the shell takes its data-box-style.
    shell.append(...(isMedia(clone) ? [clone] : [...clone.childNodes]));
    const boxStyle = clone.getAttribute("data-box-style");
    if (boxStyle && !isMedia(clone)) shell.setAttribute("data-box-style", boxStyle);
  }
  liftWideWidth(shell, row && shell.contains(row) ? row : null);
  const html = sanitizeHtml(shell.outerHTML, ctx.url);
  // The sanitizer drops what it does not keep (an iframe from an unknown
  // host): a figure left with no media is its caption or nothing (import
  // compare loop finding: an empty FIGURE where a nutrition-label iframe was).
  if (!/<(?:img|video|iframe|svg)\b/i.test(html)) return caption ? { type: "PARAGRAPH", text: caption } : null;
  // The same asset appearing again (repeated hero, shared illustration) is not
  // a second figure.
  const keys = mediaKeys(html);
  if (keys.length > 0 && keys.every((k) => ctx.seenMedia.has(k))) return null;
  for (const key of keys) ctx.seenMedia.add(key);

  return { type: "FIGURE", text: caption || alt || "Figure", html };
}

export function svgBlock(svg: Element): ParsedBlock | null {
  if (!isChartSvg(svg)) return null;
  const clone = svg.cloneNode(true) as Element;
  if (!sanitizeSvgElement(clone)) return null;
  const html = stripCitationTokens(clone.outerHTML);
  if (html.length > 400_000) return null; // pathological svg; keep the document light
  const label = normalizeText(
    svg.getAttribute("aria-label") ?? svg.querySelector("title")?.textContent ?? "",
  );
  return { type: "FIGURE", text: label || "Figure", html: `<figure>${html}</figure>` };
}

/** A container whose media IS the content (chart panels, video galleries,
    image + caption sections, figure rows) becomes one composite FIGURE
    block. Every paragraph in it must be a caption: labeled, or short and
    beside media, at most one plain caption per column. The figure's words
    (text in a box that holds the media) are neither and count as neither. */
export function tryCompositeFigure(el: Element, ctx: WalkCtx): boolean {
  if (!hasMeaningfulMedia(el)) return false;
  if (el.querySelector("h1, h2, h3, h4, h5, h6, ul, ol, table, pre, x-math, blockquote")) return false;
  const paragraphs = [...el.querySelectorAll("p, figcaption")].filter(
    (p) => captionText(p).length > 0 && !isFigureWords(p, el),
  );
  const labeled = paragraphs.filter(isLabeledCaption);
  const plain = paragraphs.filter((p) => !isLabeledCaption(p) && isPlainCaption(p, el));
  // A paragraph that is neither is prose beside media: a header, a card
  // (import compare loop finding: an article header's summary, byline, and
  // author avatar became one FIGURE).
  if (labeled.length + plain.length < paragraphs.length) return false;
  const row = figureRow(el);
  const columns = row ? mediaColumns(row).length : 1;
  if (plain.length > columns) return false;
  const clone = el.cloneNode(true) as Element;
  for (const box of figureBoxes(el, clone)) box.remove();
  for (const media of clone.querySelectorAll("svg, video, img")) media.remove();
  for (const p of clone.querySelectorAll("p, figcaption")) p.remove();
  const residual = spacedText(clone);
  // More text than a caption holds is prose: past it, the text would live
  // only inside the figure's html and never reach a text block (import
  // compare loop finding: an author box's bio paragraph swallowed into a
  // figure). A row holds a caption's worth per column.
  if (residual.length > CAPTION_MAX_CHARS * columns) return false;
  const block = figureBlock(el, ctx);
  if (block) {
    ctx.blocks.push(block);
    return true;
  }
  return false;
}

function isFigureWithMedia(block: ParsedBlock | undefined): boolean {
  return block !== undefined && block.type === "FIGURE" && /<(?:img|video|iframe|svg)\b/i.test(block.html ?? "");
}

function isCaptionBlock(block: ParsedBlock | undefined): boolean {
  return (
    block !== undefined &&
    (block.type === "PARAGRAPH" || block.type === "HEADING") &&
    isFigureCaption(block.text) &&
    block.text.length <= REPAIR_CAPTION_MAX_CHARS
  );
}

/** The element in the page whose text is this caption. */
function captionElement(root: Element, text: string, index: Map<string, Element>): Element | null {
  if (index.size === 0) {
    for (const el of root.querySelectorAll("p, figcaption, div, span, li, h1, h2, h3, h4, h5, h6")) {
      const t = captionText(el);
      if (isFigureCaption(t) && !index.has(t)) index.set(t, el);
    }
  }
  return index.get(normalizeText(text)) ?? null;
}

/** Does the element hold a labeled caption other than this one? */
function holdsOtherCaption(el: Element, caption: Element): boolean {
  return [...el.querySelectorAll("p, figcaption")].some(
    (p) => p !== caption && !caption.contains(p) && !p.contains(caption) && isLabeledCaption(p),
  );
}

/** A caption escaped as html, with class="center" when the page centers it. */
function captionHtml(text: string, centered: boolean): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<p${centered ? ' class="center"' : ""}>${escaped}</p>`;
}

/** After the walk: figures the walk could not build in place. A "Figure N"
    caption that reached the block list with no FIGURE beside it is built
    from the media nearest that caption in the page's DOM — unless the only
    media there is a chart the page's scripts draw (the audit reports it; a
    browser render is the fix). A caption beside a FIGURE that has none is
    folded into that figure. Returns the block list with the repaired
    figures in place. */
export function repairFigures(blocks: ParsedBlock[], root: Element, ctx: WalkCtx): ParsedBlock[] {
  const index = new Map<string, Element>();
  const out = [...blocks];
  for (let i = 0; i < out.length; i++) {
    const block = out[i];
    if (!isCaptionBlock(block)) continue;
    if (isFigureWithMedia(out[i - 1]) || isFigureWithMedia(out[i + 1])) continue;
    const caption = captionElement(root, block.text, index);
    if (!caption) continue;
    // The nearest ancestor holding media decides: meaningful media becomes
    // the figure; a scripted chart's empty svg leaves the caption as it is.
    let container: Element | null = null;
    for (let node = caption.parentElement; node && node !== root.parentElement; node = node.parentElement) {
      const meaningful = hasMeaningfulMedia(node);
      const scripted = [...node.querySelectorAll("svg, canvas")].some((el) => el.tagName.toLowerCase() === "canvas" || isEmptyChart(el));
      if (!meaningful && !scripted) continue;
      if (meaningful && !holdsOtherCaption(node, caption)) container = node;
      break;
    }
    if (!container) continue;
    const figure = figureBlock(container, ctx);
    if (figure && figure.type === "FIGURE") out[i] = figure;
  }
  // A caption beside a figure without one: the figure takes it.
  for (let i = 0; i < out.length; i++) {
    const block = out[i];
    if (!isCaptionBlock(block)) continue;
    const before = out[i - 1];
    const after = out[i + 1];
    const target = isFigureWithMedia(before) && !isFigureCaption(before.text) ? i - 1 : isFigureWithMedia(after) && !isFigureCaption(after.text) ? i + 1 : -1;
    if (target === -1) continue;
    const figure = out[target];
    const html = figure.html ?? "";
    const caption = captionElement(root, block.text, index);
    const centered = caption?.getAttribute("data-align") === "center";
    const p = captionHtml(block.text, centered);
    out[target] = {
      ...figure,
      text: block.text,
      html: target < i ? html.replace(/<\/figure>\s*$/, `${p}</figure>`) : html.replace(/^\s*<figure>/, `<figure>${p}`),
    };
    out.splice(i, 1);
    i -= 1;
  }
  return out;
}
