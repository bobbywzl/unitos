import { stripCitationTokens } from "@/lib/parse/references";

// Text helpers shared by the URL walk (lib/parse/url.ts) and the figure
// functions (lib/parse/figures.ts): the page's text read the way a reader
// sees it, with a space at every block boundary and every display-math
// marker turned back into readable text.

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Block-level elements: a boundary between two of them is at least a line
// break on the page, never the middle of a word.
export const BLOCK_SELECTOR =
  "address, article, aside, blockquote, dd, details, div, dl, dt, fieldset, figcaption, figure, footer, " +
  "h1, h2, h3, h4, h5, h6, header, li, main, nav, ol, p, pre, section, summary, table, tbody, td, tfoot, th, thead, tr, ul";

/** The element's text with a space at every block boundary. textContent alone
    fuses the words on either side of a boundary — a caption span and the
    credit span stacked under it read "2026.Photo by" (import compare loop
    finding). */
export function spacedText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  separateBlocks(clone);
  return normalizeText(clone.textContent ?? "");
}

/** In place: a space at every block boundary, and between two adjacent inline
    elements where one text ends and the next begins ("2026." then "Photo by",
    "Jim Edwards" then "Executive Editor" — a flex column's spans). */
export function separateBlocks(el: Element) {
  const document = el.ownerDocument;
  for (const block of [...el.querySelectorAll(BLOCK_SELECTOR)]) {
    block.before(document.createTextNode(" "));
    block.after(document.createTextNode(" "));
  }
  for (const node of [...el.querySelectorAll("*")]) {
    // React leaves "<!-- -->" between adjacent text runs: comments and blank
    // text between two elements do not separate their words.
    let prev = node.previousSibling;
    while (prev && (prev.nodeType === 8 || (prev.nodeType === 3 && !(prev.textContent ?? "").trim()))) {
      prev = prev.previousSibling;
    }
    if (!prev || prev.nodeType !== 1) continue;
    // A link's text ends in its citation token: look past it to the words.
    const left = stripCitationTokens(prev.textContent ?? "").trimEnd();
    const right = stripCitationTokens(node.textContent ?? "").trimStart();
    if (/[.!?:;,)\]\p{Ll}\d]$/u.test(left) && /^[\p{Lu}\d(]/u.test(right)) {
      node.before(document.createTextNode(" "));
    }
  }
}

/** A copy of the element with every display-math marker turned into its
    readable text, for blocks whose text and html cannot carry an EQUATION. */
export function withReadableMath(el: Element): Element {
  const clone = el.cloneNode(true) as Element;
  for (const marker of [...clone.querySelectorAll("x-math")]) {
    const readable = marker.getAttribute("data-readable") || marker.getAttribute("data-tex") || "";
    marker.replaceWith(clone.ownerDocument.createTextNode(` ${readable} `));
  }
  return clone;
}

export function removeTextNodes(el: Element) {
  for (const node of [...el.childNodes]) {
    if (node.nodeType === 3) node.remove();
    else if (node.nodeType === 1) removeTextNodes(node as Element);
  }
}

export function hasDirectText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim()) return true;
  }
  return false;
}
