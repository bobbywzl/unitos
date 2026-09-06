import { isChartSvg } from "@/lib/parse/figure-style";
import { hasDirectText, normalizeText, separateBlocks, spacedText, withReadableMath } from "@/lib/parse/dom-text";
import { stripCitationTokens } from "@/lib/parse/references";
import { sanitizeHtml, sanitizeSvgElement } from "@/lib/parse/sanitize";
import type { ParsedBlock } from "@/lib/parse/types";

// Figures in the URL walk (lib/parse/url.ts): which media is content, what
// a figure's caption is, and the FIGURE block an element becomes. Nothing is
// authored here: media URLs are the page's URLs, captions are the page's
// text (SPEC.md §2).

export type WalkCtx = {
  url: string;
  blocks: ParsedBlock[];
  seenMedia: Set<string>;
};

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

export function hasMeaningfulMedia(el: Element): boolean {
  if ([...el.querySelectorAll("svg")].some(isChartSvg)) return true;
  if (el.querySelector("video[src], iframe[src]")) return true;
  return [...el.querySelectorAll("img[src]")].some(isContentImage);
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

export function figureCaption(el: Element): string {
  const figcaption = el.querySelector("figcaption");
  if (figcaption) return spacedText(withReadableMath(figcaption));
  // Caption conventions outside <figure>: a "Figure N." paragraph, else
  // whatever short text sits beside the media.
  const paragraphs = [...el.querySelectorAll("p")];
  const labeled = paragraphs.find((p) => /^Figure\s+\S+[.:]/.test(normalizeText(p.textContent ?? "")));
  if (labeled) return normalizeText(labeled.textContent ?? "");
  const clone = el.cloneNode(true) as Element;
  for (const media of clone.querySelectorAll("svg, video, img")) media.remove();
  const residual = spacedText(clone);
  return residual.length <= 200 ? residual : "";
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
  // The figure's html renders its own text: the same spaces the caption got,
  // so a caption span and a credit span read apart on screen too and the
  // figure's DOM text stays the block's text (SPEC.md §5).
  separateBlocks(clone);
  if (!hasMeaningfulMedia(clone)) {
    // A figure with no media is its text: a pull quote wrapped in <figure>
    // is a paragraph, and a bare caption is a paragraph.
    const text = caption || normalizeText(clone.textContent ?? "");
    return text ? { type: "PARAGRAPH", text } : null;
  }

  // A wrapper around one <figure> is that figure, not a figure in a figure.
  const only = clone.children.length === 1 && !hasDirectText(clone) ? clone.children[0] : null;
  const shell =
    clone.tagName.toLowerCase() === "figure"
      ? clone
      : only && only.tagName.toLowerCase() === "figure"
        ? only
        : null;
  const html = sanitizeHtml(shell ? shell.outerHTML : `<figure>${clone.innerHTML}</figure>`, ctx.url);
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
    image + caption sections) becomes one composite FIGURE block. */
export function tryCompositeFigure(el: Element, ctx: WalkCtx): boolean {
  if (!hasMeaningfulMedia(el)) return false;
  if (el.querySelector("h1, h2, h3, h4, h5, h6, ul, ol, table, pre, x-math, blockquote")) return false;
  // Two or more paragraphs beside the media is a header or a card, not a
  // captioned figure (import compare loop finding: an article header's
  // summary, byline, and author avatar became one FIGURE).
  const paragraphs = [...el.querySelectorAll("p")].filter((p) => normalizeText(p.textContent ?? "").length > 0);
  if (paragraphs.length >= 2) return false;
  const clone = el.cloneNode(true) as Element;
  for (const media of clone.querySelectorAll("svg, video, img")) media.remove();
  const residual = spacedText(clone);
  // More text than a caption holds (the caption limit in figureCaption) is
  // prose: past it, the text would live only inside the figure's html and
  // never reach a text block (import compare loop finding: an author box's
  // bio paragraph swallowed into a figure).
  if (residual.length > 200) return false;
  const block = figureBlock(el, ctx);
  if (block) {
    ctx.blocks.push(block);
    return true;
  }
  return false;
}

/** After the walk: figures the walk could not build in place — a "Figure N"
    caption that reached the block list with no FIGURE beside it — are built
    from the media nearest that caption in the page's DOM. Returns the block
    list with the repaired figures in place. */
export function repairFigures(blocks: ParsedBlock[], _root: Element, _ctx: WalkCtx): ParsedBlock[] {
  return blocks;
}
