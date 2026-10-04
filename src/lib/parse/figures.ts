import { FIGURE_BOX_TEXT_MAX, isChartSvg } from "@/lib/parse/figure-style";
import { hasDirectText, normalizeText, separateBlocks, spacedText, withReadableMath } from "@/lib/parse/dom-text";
import { isFigureCaption } from "@/lib/parse/figure-audit";
import { stripCitationTokens } from "@/lib/parse/references";
import { sanitizeHtml, sanitizeSvgElement } from "@/lib/parse/sanitize";
import type { MediaCheck, ParsedBlock } from "@/lib/parse/types";

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
  // Every media element of the page a block carries (figureBlock marks the
  // media under the element it built from; the table and list cases mark
  // theirs). The media check reads what is left (checkMedia).
  consumed: WeakSet<Element>;
  // The text blocks the walk read out of a caption element whose figure did
  // not take them (the picture a placeholder the parse cannot load, or none):
  // they fold into the uncaptioned figure beside them (repairFigures), and
  // the rest drop (lib/parse/url.ts). Never the article's paragraphs.
  captionBlocks?: WeakSet<ParsedBlock>;
};

// An element the page names a caption: "caption", "image-caption",
// "wp-caption-text", "figcaption" in its class. Web benchmark finding: on 24
// of 181 pages such an element read as a paragraph of the story (a news
// photo's caption of 230 characters in a div beside its img, a caption whose
// picture a script draws, a video's title in a caption div); 126 such
// elements sit outside the marked bodies and 3 inside them. Held-out set:
// 41 marked as not the article's, 3 as the article's (two of them wrappers
// of more than this many characters). A caption-classed element with more
// text than this is a teaser box or a lead named for its look, not a caption.
const CAPTION_CLASS_RX = /caption/i;
const CAPTION_CLASS_MAX_CHARS = 400;

/** An element with a caption class and a caption's worth of text. */
export function isClassCaption(el: Element): boolean {
  if (/^(?:figcaption|img|a|button|svg)$/i.test(el.tagName)) return false;
  const cls = el.getAttribute("class") ?? "";
  if (!CAPTION_CLASS_RX.test(cls)) return false;
  const text = normalizeText(el.textContent ?? "");
  return text.length > 0 && text.length <= CAPTION_CLASS_MAX_CHARS;
}

// A video's caption describes the video, and reads as the story's own
// words: the web benchmark marks the lines under a video player as the
// article's on 3 pages ("A video showing the dramatic moment a kidnapped
// 8-year-old Fort Worth girl was rescued by police was released on
// Monday."), and a photo's caption as not the article's on 13. A caption
// within this many wrappers of a player keeps its paragraph.
const VIDEO_RX = /(?:^|[\s_-])(?:video|player)(?:$|[\s_-])|video/i;
const VIDEO_WRAPPERS_MAX = 4;

const VIDEO_SELECTOR = "video, iframe, [class*='video' i], [class*='player' i]";

/** A video player: an element that names a video or a player, or holds
    one, or a video or a frame. */
function isVideoPlayer(el: Element): boolean {
  return VIDEO_RX.test(`${el.getAttribute("class") ?? ""} ${el.id}`) || el.querySelector(VIDEO_SELECTOR) !== null;
}

/** Does a video player sit around the element: an ancestor within a few
    wrappers, or a sibling of one of them, that is or holds a player? */
export function nearVideo(el: Element, root: Element): boolean {
  let node: Element | null = el;
  for (let up = 0; node && node !== root && up <= VIDEO_WRAPPERS_MAX; node = node.parentElement, up++) {
    if (isVideoPlayer(node)) return true;
    for (const sibling of [node.previousElementSibling, node.nextElementSibling]) {
      if (sibling && isVideoPlayer(sibling)) return true;
    }
  }
  return false;
}

/** The nearest caption-classed element at or above the element, below the
    root; the outermost one when they nest (a caption div's own p). Null
    beside a video player: its caption is the story's words. */
export function captionClassAncestor(el: Element, root: Element): Element | null {
  let found: Element | null = null;
  for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
    if (isClassCaption(node)) found = node;
  }
  return found && !nearVideo(found, root) ? found : null;
}

// The elements a figure's caption may be: a figcaption, a paragraph, or an
// element the page names a caption.
const CAPTION_CANDIDATE_SELECTOR = "figcaption, p, [class*='caption' i]";

/** The caption candidates below a container, the outermost of a nest only:
    never a paragraph inside a figcaption, never a caption div's own p. */
function captionCandidates(container: Element): Element[] {
  return [...container.querySelectorAll(CAPTION_CANDIDATE_SELECTOR)].filter((el) => {
    if (el.tagName.toLowerCase() !== "figcaption" && el.tagName.toLowerCase() !== "p" && !isClassCaption(el)) return false;
    for (let node = el.parentElement; node && node !== container; node = node.parentElement) {
      if (node.tagName.toLowerCase() === "figcaption" || isClassCaption(node)) return false;
    }
    return true;
  });
}

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

// A tracking pixel's host: the image is a beacon, not a picture.
const TRACKING_PIXEL_RX = /^(?:https?:)?\/\/(?:[^/]*\.)?(?:scorecardresearch\.com|google-analytics\.com|doubleclick\.net|facebook\.com\/tr\b|quantserve\.com|ioam\.de|xiti\.com|wt-safetag\.com|chartbeat\.com)/i;

// A decorative asset is not content: tiny dimensions, an unlabeled .svg
// icon, an inline data-URL placeholder with no words (a gray box a script
// swaps for the picture), or a tracking pixel.
export function isContentImage(img: Element): boolean {
  const width = Number(img.getAttribute("width") ?? 0);
  const height = Number(img.getAttribute("height") ?? 0);
  // Icons and avatars: a declared size of 48px or less (a byline's 40px
  // avatar made a figure of the byline — import compare loop finding).
  if ((width > 0 && width <= 48) || (height > 0 && height <= 48)) return false;
  const src = img.getAttribute("src") ?? "";
  const alt = normalizeText(img.getAttribute("alt") ?? "");
  if (/\.svg(\?|#|$)/i.test(src) && !alt) return false;
  if (src.startsWith("data:") && !alt) return false;
  if (TRACKING_PIXEL_RX.test(src)) return false;
  return true;
}

// A link to a writer's page: "/autoren/kathrin-hofmeister", "/author/jane".
export const AUTHOR_PAGE_RX = /\/(?:authors?|autor(?:en|in)?|auteurs?|autore)\//i;

/** The writer's picture: an image inside a link to the writer's page, its
    alt the link's words (the writer's name). */
function isAuthorPicture(media: Element): boolean {
  if (media.tagName.toLowerCase() !== "img") return false;
  const link = media.closest("a[href]");
  if (!link || !AUTHOR_PAGE_RX.test(link.getAttribute("href") ?? "")) return false;
  const alt = normalizeText(media.getAttribute("alt") ?? "");
  return alt !== "" && alt === normalizeText(link.textContent ?? "");
}

function isMedia(el: Element): boolean {
  return /^(img|video|iframe|svg)$/i.test(el.tagName);
}

/** Meaningful media in or at an element: a chart svg, a video, an iframe,
    a content image. */
// An iframe the page hides is a tracker or a widget's plumbing, not content:
// no size, or hidden by its own style.
function isHiddenFrame(el: Element): boolean {
  const width = el.getAttribute("width") ?? "";
  const height = el.getAttribute("height") ?? "";
  if ((width !== "" && Number(width) <= 1) || (height !== "" && Number(height) <= 1)) return true;
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute("style") ?? "");
}

function isMeaningfulMedia(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "svg") return isChartSvg(el);
  if (tag === "iframe") return el.hasAttribute("src") && !isHiddenFrame(el);
  if (tag === "video") return el.hasAttribute("src");
  if (tag === "img") return el.hasAttribute("src") && isContentImage(el);
  return false;
}

export function hasMeaningfulMedia(el: Element): boolean {
  if (isMeaningfulMedia(el)) return true;
  if ([...el.querySelectorAll("svg")].some(isChartSvg)) return true;
  if (el.querySelector("video[src], iframe[src]")) return true;
  return [...el.querySelectorAll("img[src]")].some(isContentImage);
}

// An image the page lays out narrower than this share of the text column
// inside a paragraph of text is an inline icon (an emoji, a flag, a badge),
// not a figure. Read from the width the page-style bake wrote.
const INLINE_ICON_PCT = 10;

/** An image set inline in prose at an icon's width. */
export function isInlineIcon(img: Element): boolean {
  const pct = Number(img.getAttribute("data-width-pct") ?? "");
  return pct > 0 && pct < INLINE_ICON_PCT;
}

/** The meaningful media elements under an element, in document order: the
    content images, the videos and iframes with a src, the chart svgs. A
    media element inside another (an svg in an svg) counts once, as the
    outer one. */
export function meaningfulMediaIn(root: Element): Element[] {
  const out: Element[] = [];
  for (const el of root.querySelectorAll(MEDIA_SELECTOR)) {
    if (!isMeaningfulMedia(el)) continue;
    if (el.parentElement?.closest("svg, video, iframe")) continue;
    out.push(el);
  }
  if (isMeaningfulMedia(root)) out.unshift(root);
  return out;
}

/** Mark the media under an element as carried by a block. */
export function consumeMedia(el: Element, ctx: WalkCtx) {
  for (const media of meaningfulMediaIn(el)) ctx.consumed.add(media);
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

/** A labeled caption: a figcaption, an element the page names a caption, or
    text that opens like "Figure 2." */
function isLabeledCaption(el: Element): boolean {
  return el.tagName.toLowerCase() === "figcaption" || isClassCaption(el) || isFigureCaption(captionText(el));
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
  const candidates = captionCandidates(container).filter((el) => captionText(el).length > 0);
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

// A control inside a figure: a print button, a pin button, a share button,
// a jump link drawn as a button (role="button", a class token "button" or
// "btn": "wprm-recipe-print-wide-button"). Its words are no caption: a
// recipe card's picture read "Zum Rezept Drucken Pinnen" and "Rezept
// drucken Bei Pinterest speichern" as its caption (held-out set finding,
// two lines marked as not the article; 17 figures of the set hold such a
// control, none marked as the article's). A control that holds the media
// (a lightbox button around the picture) stays.
const CONTROL_SELECTOR = "[role='button'], [class*='button' i], [class*='btn' i]";
const CONTROL_CLASS_RX = /(?:^|[\s_-])(?:button|btn)(?:$|[\s_-])/i;

function isControl(el: Element): boolean {
  return el.getAttribute("role") === "button" || CONTROL_CLASS_RX.test(el.getAttribute("class") ?? "");
}

/** Remove the controls under a figure's clone. */
function dropControls(clone: Element) {
  for (const el of [...clone.querySelectorAll(CONTROL_SELECTOR)]) {
    // The clone stands outside the document: containment, not isConnected.
    if (clone.contains(el) && isControl(el) && !hasMeaningfulMedia(el)) el.remove();
  }
}

// A link to a picture file: a figure's own link, opening its picture.
export const PICTURE_LINK_RX = /\.(?:jpe?g|png|gif|webp|avif|svg)(?:[?#]|$)/i;

/** A picture linked to another page is the link's picture: a banner, a
    teaser, a logo. Its alt is the link's words (a calendar banner's "Alle
    wichtigen Termine für Unternehmerinnen und Unternehmer", a partner's
    logo's name), not the picture's caption, and is no figure text (held-out
    set finding: 8 such alts read as a figure's text, each marked as not the
    article; the set holds 4884 linked pictures with an alt, 40 of them
    marked so and 6 marked as the article's, each of those 6 said in the
    text too). A link to the picture itself, to a fragment of the page, or
    to the picture's own attachment page (rel="attachment") is a figure's
    own link. */
function linkedAway(img: Element, el: Element): boolean {
  const a = img.closest("a[href]") ?? el.closest("a[href]");
  if (!a) return false;
  const href = (a.getAttribute("href") ?? "").trim();
  if (!href || /^(?:#|javascript:)/i.test(href) || PICTURE_LINK_RX.test(href)) return false;
  return !/(?:^|\s)attachment(?:$|\s)/i.test(a.getAttribute("rel") ?? "");
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
  dropControls(clone);
  const caption = figureCaption(clone);
  // The img may be the element itself (a bare <img> in the flow).
  const altImg = clone.matches("img[alt]") ? clone : clone.querySelector("img[alt]");
  const alt = altImg && !linkedAway(altImg, el) ? normalizeText(altImg.getAttribute("alt") ?? "") : "";
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
    if (!text) return null;
    const block: ParsedBlock = { type: "PARAGRAPH", text };
    // A figure that is its labeled caption alone has a picture a script
    // draws: the caption is a caption still, never the article's paragraph
    // (web benchmark finding: a news photo's figcaption read as a line of
    // the story).
    if (
      caption &&
      captionElements(clone).some(isLabeledCaption) &&
      normalizeText(clone.textContent ?? "") === normalizeText(caption) &&
      !nearVideo(el, el.ownerDocument.body ?? el)
    ) {
      ctx.captionBlocks?.add(block);
    }
    return block;
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
  if (!/<(?:img|video|iframe|svg)\b/i.test(html)) {
    if (!caption) return null;
    const block: ParsedBlock = { type: "PARAGRAPH", text: caption };
    // A picture the parse cannot load (a data: placeholder with no URL to
    // swap in) leaves its labeled caption a caption, never a paragraph (web
    // benchmark finding: a lead photo's caption read as the story's first
    // line). A frame or a video the sanitizer refused keeps its caption as
    // the paragraph that says what was there.
    if (
      !nearVideo(el, el.ownerDocument.body ?? el) &&
      captionElements(shell).some(isLabeledCaption)
    ) {
      ctx.captionBlocks?.add(block);
    }
    return block;
  }
  // The same asset appearing again (repeated hero, shared illustration) is not
  // a second figure.
  const keys = mediaKeys(html);
  if (keys.length > 0 && keys.every((k) => ctx.seenMedia.has(k))) {
    consumeMedia(el, ctx);
    return null;
  }
  for (const key of keys) ctx.seenMedia.add(key);
  consumeMedia(el, ctx);

  return { type: "FIGURE", text: caption || alt || "Figure", html };
}

export function svgBlock(svg: Element, ctx?: WalkCtx): ParsedBlock | null {
  if (!isChartSvg(svg)) return null;
  const clone = svg.cloneNode(true) as Element;
  if (!sanitizeSvgElement(clone)) return null;
  const html = stripCitationTokens(clone.outerHTML);
  if (html.length > 400_000) return null; // pathological svg; keep the document light
  const label = normalizeText(
    svg.getAttribute("aria-label") ?? svg.querySelector("title")?.textContent ?? "",
  );
  ctx?.consumed.add(svg);
  return { type: "FIGURE", text: label || "Figure", html: `<figure>${html}</figure>` };
}

/** A container whose media IS the content (chart panels, video galleries,
    image + caption sections, figure rows) becomes one composite FIGURE
    block. Every paragraph in it must be a caption: labeled, or short and
    beside media, at most one plain caption per column. The figure's words
    (text in a box that holds the media) are neither and count as neither. */
export function tryCompositeFigure(el: Element, ctx: WalkCtx): boolean {
  if (!hasMeaningfulMedia(el)) return false;
  // The writer's picture is no figure's media: a paragraph beside it is the
  // article's, never its caption (held-out set finding: an author's picture
  // and the dek beside it read as one figure, the dek its caption).
  if (meaningfulMediaIn(el).every(isAuthorPicture)) return false;
  if (el.querySelector("h1, h2, h3, h4, h5, h6, ul, ol, table, pre, x-math, blockquote")) return false;
  const paragraphs = captionCandidates(el).filter((p) => captionText(p).length > 0 && !isFigureWords(p, el));
  const labeled = paragraphs.filter(isLabeledCaption);
  const plain = paragraphs.filter((p) => !isLabeledCaption(p) && isPlainCaption(p, el));
  // A paragraph that is neither is prose beside media: a header, a card
  // (import compare loop finding: an article header's summary, byline, and
  // author avatar became one FIGURE).
  if (labeled.length + plain.length < paragraphs.length) return false;
  // A paragraph above the media, when the media's caption is already a
  // figcaption, is not a second caption: it is the lead set over the lead
  // photo (held-out set finding: a story's standfirst swallowed into the
  // figure under it, which had its own figcaption). A caption follows its
  // picture.
  const firstMedia = meaningfulMediaIn(el)[0];
  if (
    firstMedia &&
    labeled.some((c) => c.tagName.toLowerCase() === "figcaption") &&
    plain.some((p) => (p.compareDocumentPosition(firstMedia) & 4) !== 0)
  )
    return false;
  const row = figureRow(el);
  const columnEls = row ? mediaColumns(row) : [];
  const columns = row ? columnEls.length : 1;
  if (plain.length > columns) return false;
  // A row's captions sit in its columns, under each column's media. A line
  // of prose outside every column and above the media is not a caption: a
  // caption follows its picture. It is the text the pictures illustrate
  // (held-out set finding: a lesson's lines around its comic strips, a
  // story's lead above its photo and audio, and a note above a story's
  // maps, all read as one figure's caption and lost to the text).
  if (
    row &&
    firstMedia &&
    plain.some(
      (p) =>
        !columnEls.some((column) => column.contains(p)) &&
        captionText(p).length >= PROSE_LINE_MIN_CHARS &&
        (p.compareDocumentPosition(firstMedia) & 4) !== 0,
    )
  )
    return false;
  // The row's columns are marked before the clone, so the text outside
  // every column can be read from the clone.
  for (const column of columnEls) column.setAttribute("data-unitos-column", "");
  const clone = el.cloneNode(true) as Element;
  for (const column of columnEls) column.removeAttribute("data-unitos-column");
  for (const box of figureBoxes(el, clone)) box.remove();
  for (const media of clone.querySelectorAll("svg, video, img")) media.remove();
  for (const p of captionCandidates(clone)) p.remove();
  const residual = spacedText(clone);
  // More text than a caption holds is prose: past it, the text would live
  // only inside the figure's html and never reach a text block (import
  // compare loop finding: an author box's bio paragraph swallowed into a
  // figure). A row holds a caption's worth per column.
  if (residual.length > CAPTION_MAX_CHARS * columns) return false;
  // The columns' allowance is for the words under each column's media. Prose
  // beside the columns is one caption's worth at most: a blog post's body
  // set in divs between its photos is not a row's captions (web benchmark
  // finding: a whole Blogger post became one figure). Prose is lines of
  // words; a menu's short labels are not.
  for (const column of clone.querySelectorAll("[data-unitos-column]")) column.remove();
  if (row && proseLength(clone) > CAPTION_MAX_CHARS) return false;
  const block = figureBlock(el, ctx);
  if (block) {
    ctx.blocks.push(block);
    return true;
  }
  return false;
}

// A line of prose is a run of words this long between two block edges.
const PROSE_LINE_MIN_CHARS = 60;
const BLOCK_TAG_RX = /^(address|article|aside|blockquote|dd|div|dl|dt|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)$/i;

/** The characters of an element's lines of prose: its text cut at block
    elements and line breaks, counting the runs of PROSE_LINE_MIN_CHARS or
    more. */
function proseLength(el: Element): number {
  const runs: string[] = [""];
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) runs[runs.length - 1] += child.textContent ?? "";
      else if (child.nodeType === 1) {
        const tag = (child as Element).tagName;
        if (/^(script|style|noscript)$/i.test(tag)) continue;
        const edge = BLOCK_TAG_RX.test(tag) || /^br$/i.test(tag);
        if (edge) runs.push("");
        walk(child);
        if (edge) runs.push("");
      }
    }
  };
  walk(el);
  return runs.map((run) => normalizeText(run).length).filter((n) => n >= PROSE_LINE_MIN_CHARS).reduce((a, b) => a + b, 0);
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

// An agency credit closing a caption: "(Manu Fernandez/AP)", "(NASA/JPL-
// Caltech/ASU)", "(AP Photo/Gene J. Puskar)" — names and agencies set apart
// by slashes in parentheses, each opening with a capital or a digit, and no
// sentence after. A unit or a pair of words in parentheses ("(km/h)",
// "(and/or)") opens lowercase. "via" sets them apart as a slash does: "(NASA
// via AP, File)", "(Photo by Zhao Yun/VCG via Getty Images)" (web benchmark
// finding: a lead photo's caption, 38 words, read as a news story's first
// paragraph; 5 pages close a caption so, none in the article's text).
const AGENCY_CREDIT_END_RX = /\(\s*(?:[^()/]{1,40}?(?:\/| via )){1,4}[^()/]{1,40}\)$/u;
const AGENCY_CREDIT_SPLIT_RX = /\/| via /;
const CREDITED_CAPTION_WORDS_MAX = 40;

/** A caption told by the agency credit that closes it, at most forty words,
    with the caption's own words before the credit: a credit alone,
    "(Credit: Clayton Aldern / Grist)", is a credit line, not a caption
    (held-out set finding). Web benchmark finding: a lead photo's caption set
    as a paragraph beside the uncaptioned figure, read as the story's first
    line. */
export function isCreditedCaption(text: string): boolean {
  const t = text.trim();
  const m = AGENCY_CREDIT_END_RX.exec(t);
  if (!m || t.split(/\s+/).length > CREDITED_CAPTION_WORDS_MAX) return false;
  if (!/\p{L}/u.test(t.slice(0, m.index))) return false;
  return m[0]
    .slice(1, -1)
    .split(AGENCY_CREDIT_SPLIT_RX)
    .every((part) => /^[\p{Lu}\d©]/u.test(part.trim()));
}

// A credit closing a caption with its mark or its label and no sentence
// after: "Suzanne Schulting, Short Trackerin. © AFP / WANG ZHAO",
// "installation views, photos © Inexhibit, 2018", "… daily briefings.
// Photo: Jonathan Nackstrand/AFP". Read only beside a figure without a
// caption: a story's paragraph may end in "©" words elsewhere. Web
// benchmark finding: a caption after its picture read as the story's text;
// held-out set finding: 8 such captions, 3 of their credits marked as not
// the article's.
const MARK_CREDIT_END_RX = /(?:©|\(c\)|(?<![\p{L}])(?:photos?|fotos?|bild|bilder|image|images|credit)\s*:)[^.!?©:]{1,60}$/iu;

/** A caption closed by a credit's mark or label, its own words before the
    credit, at most forty words. */
function isMarkCreditedCaption(text: string): boolean {
  const t = text.trim();
  const m = MARK_CREDIT_END_RX.exec(t);
  return m !== null && t.split(/\s+/).length <= CREDITED_CAPTION_WORDS_MAX && /\p{L}/u.test(t.slice(0, m.index));
}

function isCreditedCaptionBlock(block: ParsedBlock | undefined): boolean {
  return block !== undefined && block.type === "PARAGRAPH" && (isCreditedCaption(block.text) || isMarkCreditedCaption(block.text));
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
  return captionCandidates(el).some(
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
  // A caption beside a figure without one: the figure takes it. A labeled
  // caption, or one told by its agency credit.
  for (let i = 0; i < out.length; i++) {
    const block = out[i];
    if (!isCaptionBlock(block) && !isCreditedCaptionBlock(block) && !ctx.captionBlocks?.has(block)) continue;
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

// ── The media check ─────────────────────────────────────────────────────────
// The walk builds figures from what it recognizes; what it does not
// recognize it must not lose. After the walk and the figure repair, every
// image, video, iframe, and chart in the page's content is checked against
// the blocks: a media element no block carries is built into a FIGURE and
// set where the page set it. The counts travel with the document
// (ParsedDocument.mediaCheck) to the upload assistant, the progress card,
// and the document bar (SPEC.md §15).

// The shortest text worth matching a block by.
const PROBE_MIN_CHARS = 8;
// The longest probe: a text node's tail or head.
const PROBE_MAX_CHARS = 60;
// How many text nodes before or after a media element are tried.
const PROBE_NODES = 20;

/** A media element's name for a report: an image's or a video's file name,
    an iframe's host, else its kind. */
export function mediaName(el: Element): string {
  const src = el.getAttribute("src") ?? "";
  const tag = el.tagName.toLowerCase();
  if (!src) return tag === "svg" ? "chart" : tag;
  try {
    const url = new URL(src, "https://x/");
    if (tag === "iframe") return url.hostname === "x" ? tag : url.hostname;
    const file = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
    return file || tag;
  } catch {
    return tag;
  }
}

// The shortest text node worth a probe at all: a heading of one word
// ("Gallery") still names its block, matched whole.
const PROBE_WHOLE_MIN_CHARS = 3;
// A container with more text than this is a section, not the block that
// holds the media.
const CONTAINER_TEXT_MAX = 600;

/** The text nodes of the root in document order, with their normalized
    text; nodes shorter than PROBE_WHOLE_MIN_CHARS are skipped. */
function textNodesOf(root: Element): { node: Node; text: string }[] {
  const out: { node: Node; text: string }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = normalizeText(node.textContent ?? "");
    if (text.length >= PROBE_WHOLE_MIN_CHARS) out.push({ node, text });
  }
  return out;
}

/** The block at or past `from` whose text holds the probe — a probe
    shorter than PROBE_MIN_CHARS must be the block's whole text — else -1. */
function blockHolding(blocks: ParsedBlock[], from: number, probe: string): number {
  const whole = probe.length < PROBE_MIN_CHARS;
  for (let i = from; i < blocks.length; i++) {
    const text = normalizeText(blocks[i].text);
    if (whole ? text === probe : text.includes(probe)) return i;
  }
  return -1;
}

/** The block that holds the text of the element the media sits in: the
    nearest ancestor with text of its own outside the media, when that text
    is a block's worth and a block holds it. A media element set inside a
    list item or a table cell follows that list or table. */
function containerBlock(blocks: ParsedBlock[], cursor: number, el: Element, root: Element): number {
  for (let node = el.parentElement; node && node !== root; node = node.parentElement) {
    const text = textOutsideMedia(node);
    if (!text) continue;
    if (text.length > CONTAINER_TEXT_MAX) return -1;
    return blockHolding(blocks, cursor, text.slice(0, PROBE_MAX_CHARS));
  }
  return -1;
}

/** Where a figure built for a media element goes in the block list: after
    the block holding its container's text (containerBlock), else after the
    block holding the text nearest before the element on the page, else
    before the block holding the text nearest after it, else the end. Only
    blocks at or past `cursor` are considered, so figures keep the page's
    order. */
function figureSlot(
  blocks: ParsedBlock[],
  cursor: number,
  el: Element,
  root: Element,
  texts: { node: Node; text: string }[],
  at: number,
): number {
  const container = containerBlock(blocks, cursor, el, root);
  if (container !== -1) return container + 1;
  // Text before the element: the nearest node first, its tail as the probe.
  for (let i = at - 1, tried = 0; i >= 0 && tried < PROBE_NODES; i--) {
    const { node, text } = texts[i];
    if (el.contains(node)) continue;
    tried += 1;
    const found = blockHolding(blocks, cursor, text.slice(-PROBE_MAX_CHARS));
    if (found !== -1) return found + 1;
  }
  for (let i = at, tried = 0; i < texts.length && tried < PROBE_NODES; i++) {
    const { node, text } = texts[i];
    if (el.contains(node)) continue;
    tried += 1;
    const found = blockHolding(blocks, cursor, text.slice(0, PROBE_MAX_CHARS));
    if (found !== -1) return found;
  }
  return blocks.length;
}

/** After the walk: every media element in the page's content against the
    blocks. A media element no block carries becomes a FIGURE where the page
    set it (figureSlot). What cannot be built (a video the sanitizer refuses)
    is reported by name. Inline icons are not media. */
export function checkMedia(
  blocks: ParsedBlock[],
  root: Element,
  ctx: WalkCtx,
): { blocks: ParsedBlock[]; check: MediaCheck } {
  const media = meaningfulMediaIn(root).filter((el) => !(el.tagName.toLowerCase() === "img" && isInlineIcon(el)));
  const check: MediaCheck = { onPage: media.length, kept: 0, lost: [] };
  if (media.length === 0) return { blocks, check };
  const out = [...blocks];
  const texts = textNodesOf(root);
  // The index in `texts` of the first text node after each media element.
  let at = 0;
  let cursor = 0;
  for (const el of media) {
    while (at < texts.length && !(el.compareDocumentPosition(texts[at].node) & 4 /* FOLLOWING */)) at += 1;
    if (ctx.consumed.has(el)) {
      check.kept += 1;
      continue;
    }
    const figure = figureBlock(el, ctx);
    // A duplicate of an asset a figure already carries is kept by that figure.
    if (ctx.consumed.has(el) && (figure === null || figure.type !== "FIGURE")) {
      check.kept += 1;
      continue;
    }
    if (figure === null || figure.type !== "FIGURE") {
      check.lost.push(mediaName(el));
      continue;
    }
    const slot = figureSlot(out, cursor, el, root, texts, at);
    out.splice(slot, 0, figure);
    cursor = slot + 1;
    check.kept += 1;
  }
  return { blocks: out, check };
}

/** A figure's identity across the model passes: its media keys, else the
    opening of its svg. */
function figureIdentity(block: ParsedBlock): string[] {
  const html = block.html ?? "";
  const keys = mediaKeys(html);
  if (keys.length > 0) return keys;
  const svg = /<svg\b[^>]*>[\s\S]{0,200}/.exec(html)?.[0];
  return svg ? [svg] : [];
}

/** Is the figure's media carried by one of these blocks? */
function figureCarried(identity: string[], blocks: ParsedBlock[]): boolean {
  return identity.some((key) => blocks.some((b) => b.type === "FIGURE" && (b.html ?? "").includes(key)));
}

/** The block among `blocks` at or past `from` that holds this text block's
    text (the passes join and merge text, never rewrite it), else -1. */
function textBlockIn(blocks: ParsedBlock[], from: number, block: ParsedBlock): number {
  const probe = normalizeText(block.text).slice(0, PROBE_MAX_CHARS);
  if (probe.length < PROBE_WHOLE_MIN_CHARS) return -1;
  return blockHolding(blocks, from, probe);
}

/** After the model passes (SPEC.md §2): the passes reference blocks by index
    and may drop a figure with the chrome around it, or by mistake between
    two blocks of the article. A figure the walk built whose media no block
    carries any more is restored when the blocks beside it survived — the
    article kept its place, so the figure keeps its place — and left out when
    they went too: it was chrome. */
export function restoreFigures(walked: ParsedBlock[], refined: ParsedBlock[]): ParsedBlock[] {
  const out = [...refined];
  let restored = 0;
  for (let i = 0; i < walked.length; i++) {
    const figure = walked[i];
    if (figure.type !== "FIGURE") continue;
    const identity = figureIdentity(figure);
    if (identity.length === 0 || figureCarried(identity, out)) continue;
    let before: ParsedBlock | undefined;
    for (let j = i - 1; j >= 0 && !before; j--) if (walked[j].type !== "FIGURE") before = walked[j];
    let after: ParsedBlock | undefined;
    for (let j = i + 1; j < walked.length && !after; j++) if (walked[j].type !== "FIGURE") after = walked[j];
    const beforeAt = before ? textBlockIn(out, 0, before) : -1;
    if (before && beforeAt === -1) continue;
    const afterAt = after ? textBlockIn(out, Math.max(0, beforeAt), after) : -1;
    if (after && afterAt === -1) continue;
    if (!before && !after) continue;
    const slot = before ? beforeAt + 1 : afterAt;
    out.splice(slot, 0, figure);
    restored += 1;
  }
  if (restored > 0) console.log(`[ingest] restored ${restored} figures the passes dropped between kept blocks`);
  return out;
}
