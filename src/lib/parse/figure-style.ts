import { JSDOM, VirtualConsole } from "jsdom";
import { outboundFetch } from "@/lib/outbound-fetch";

// The page-style bake (SPEC.md §2). The stored html never sees the page's
// stylesheets: the sanitizer drops class names and <style> blocks, and the
// reader draws every block on its own paper. So before the walk, the page's
// stylesheets load and the page's look is written into its DOM:
//
// 1. Figures keep their look. Every inline chart svg gets the page's
//    presentation (colors, fonts, backdrop) as inline style on its elements,
//    and every figure image gets the backdrop the page drew behind it. A dark
//    site's white-line diagram came out as faint lines on white with its
//    labels gone (reader report).
// 2. Figures keep their layout. The page as a 1280×900 desktop browser lays
//    it out: what that browser hides carries `data-unitos-hidden`; centered
//    and right-aligned blocks carry `data-align`; bold, italic, underlined,
//    and monospace elements carry `data-style`; headings and resized text
//    carry `data-font-size`; the body carries `data-body-font-size` and
//    `data-font`; and every media element and every column of a figure row
//    carries `data-width-pct`, its width as a percentage of the page's text
//    column. The walk (lib/parse/url.ts, lib/parse/figures.ts) and the
//    sanitizer read those attributes; without stylesheets none is written and
//    nothing depends on them.
//
// Bounded: the sheet, element, and rule budgets below stop the work, never
// the parse — a figure without its look is the old behavior, never a
// missing figure.

const SHEET_LIMIT = 8;
const SHEET_BYTES = 1_500_000;
const SHEET_TIMEOUT_MS = 8_000;
// The page as a desktop browser lays it out: width rules resolve against this.
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 900;
// Element-by-element styling stops past these: a bigger svg keeps its
// attributes only, and a page with more styled elements than this keeps the
// rest as they are.
const SVG_ELEMENT_LIMIT = 4_000;
const PAGE_ELEMENT_LIMIT = 40_000;
// Rules read from the sheets, and elements whose style the layout passes
// resolve, at most.
const RULE_LIMIT = 30_000;
const STYLE_BUDGET = 12_000;
// Elements matched by the layout passes' selectors, at most.
const MATCH_LIMIT = 60_000;
// Prose elements sampled for the text column's width, the body font, and
// the body font size.
const SAMPLE_LIMIT = 200;
// A prose element: a paragraph with this much text, or a block with this
// much text of its own (pages that set prose in div or span blocks).
const PROSE_MIN_CHARS = 60;
const PROSE_OWN_MIN_CHARS = 100;
// visibility:hidden marks short elements only: a page that hides its prose
// until a script reveals it on scroll keeps its prose.
const VISIBILITY_TEXT_LIMIT = 200;
// A figure row holds media in every column and no prose beyond captions.
const ROW_TEXT_LIMIT = 1_500;
// The text column when the page's paragraphs do not say.
const DEFAULT_COLUMN_PX = 680;
// Width percentages written: at or past the full mark, the element is as
// wide as the column and the attribute is omitted.
const FULL_WIDTH_PCT = 95;
const MIN_WIDTH_PCT = 15;
// Presentation properties written into svg elements.
const SVG_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-transform",
  "text-anchor",
  "dominant-baseline",
  "stop-color",
  "stop-opacity",
  "paint-order",
];
// Properties an svg inherits from the page around it: the root svg carries
// the nearest ancestor's values, so the chart reads the same on the reader's
// paper as it did on the page.
const INHERITED_PROPERTIES = [
  "color",
  "fill",
  "stroke",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-transform",
];
const COLOR_PROPERTIES = new Set(["fill", "stroke", "color", "stop-color"]);
// Words in a background shorthand that are not colors.
const BACKGROUND_WORDS = new Set([
  "repeat", "repeat-x", "repeat-y", "no-repeat", "space", "round", "center", "top", "left",
  "right", "bottom", "cover", "contain", "fixed", "scroll", "local", "border-box",
  "padding-box", "content-box", "auto", "none", "transparent", "initial", "inherit", "unset",
  "currentcolor", "revert",
]);
const TRANSPARENT = new Set(["", "transparent", "none", "initial", "inherit", "unset", "revert"]);

// Elements that take data-align: the blocks the walk emits.
const ALIGN_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "section", "figcaption", "figure", "li",
  "blockquote", "td", "th", "dt", "dd",
]);
// Elements that take data-font-size when their own font-size differs from
// the body's.
const SIZE_TAGS = new Set(["p", "div", "span", "blockquote"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
// Elements that never take layout attributes.
const SKIP_TAGS = new Set(["html", "head", "body", "script", "style", "template", "link", "meta", "noscript", "title"]);
// Children a flex or grid container does not lay out.
const UNLAID_TAGS = new Set(["script", "style", "template", "link", "meta", "noscript", "title"]);

const GENERIC_FAMILIES: Record<string, PageFont> = {
  serif: "serif",
  "ui-serif": "serif",
  "sans-serif": "sans",
  "ui-sans-serif": "sans",
  "system-ui": "sans",
  monospace: "mono",
  "ui-monospace": "mono",
};
// Known faces, lower-cased, without their generic keyword.
const SERIF_FACES = [
  "georgia", "times", "charter", "merriweather", "garamond", "baskerville", "palatino", "cambria",
  "source serif", "noto serif", "pt serif", "ibm plex serif", "crimson", "lora", "playfair",
  "spectral", "literata", "newsreader", "fraunces", "tiempos", "freight", "minion", "caslon",
  "bookerly", "libre baskerville", "cormorant", "vollkorn", "iowan", "hoefler", "didot", "bodoni",
];
const MONO_FACES = [
  "menlo", "monaco", "consolas", "courier", "sf mono", "sfmono", "jetbrains mono", "fira code",
  "fira mono", "source code", "roboto mono", "ibm plex mono", "ubuntu mono", "dejavu sans mono",
  "liberation mono", "inconsolata", "hack", "cascadia", "berkeley mono", "geist mono", "iosevka",
];

export type PageFont = "sans" | "serif" | "mono";

type Decl = { value: string; weight: number };
type Decls = Map<string, Decl>;
// The last compound of a selector. `simple` when the whole selector is that
// one compound and it holds only a tag, classes, an id, and attribute
// presence or equality tests: matched by hand, never through the selector
// engine.
type Compound = {
  tag: string | null;
  classes: string[];
  id: string | null;
  attrs: { name: string; value: string | null }[];
  simple: boolean;
};
type Selector = { text: string; specificity: number; compound: Compound | null };
type Rule = { selectors: Selector[]; style: CSSStyleDeclaration; base: number };
type Entry = { rule: Rule; selector: Selector };
// Rules by the token their last compound must find on an element: one entry
// per selector, under its first class, else its id, else its tag, else
// universal.
type RuleIndex = { byClass: Map<string, Entry[]>; byId: Map<string, Entry[]>; byTag: Map<string, Entry[]>; universal: Entry[] };

type ElementStyle = {
  decls: Decls;
  parent: ElementStyle | null;
  // Resolved inherited values, parent first: currentColor, em sizes, and
  // custom properties read through these.
  color: string;
  fontSize: number;
  // The element's own font-size declaration resolved to pixels; null when it
  // has none, or one that only the browser can resolve.
  fontSizePx: number | null;
  custom: (name: string) => string | null;
};

type Page = {
  index: RuleIndex;
  rootFontPx: number;
  // Cascaded declarations and resolved styles, per element, across the passes.
  decls: Map<Element, Decls>;
  styles: Map<Element, ElementStyle>;
  // The elements each non-simple selector matches, queried once.
  matched: Map<string, Set<Element>>;
  // Laid-out widths, per element; null when only a browser could know.
  widths: Map<Element, number | null>;
  rows: Map<Element, boolean>;
  budget: { styles: number; matches: number };
  columnPx: number;
};

// ── The page's stylesheets ──────────────────────────────────────────────────

async function fetchCss(url: string): Promise<string | null> {
  try {
    const res = await outboundFetch(url, {
      headers: { Accept: "text/css,*/*;q=0.1" },
      signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (type && !/css|text\/plain|octet-stream/i.test(type)) return null;
    const text = await res.text();
    return text.length > SHEET_BYTES ? null : text;
  } catch {
    return null;
  }
}

// One level of @import at the top of a sheet, each wrapped in its media list.
async function resolveImports(css: string, baseUrl: string, budget: { left: number }): Promise<string> {
  const importRx = /@import\s+(?:url\(\s*['"]?([^'")]+)['"]?\s*\)|['"]([^'"]+)['"])\s*([^;]*);/g;
  const imports: { href: string; media: string }[] = [];
  const stripped = css.replace(importRx, (_, a: string | undefined, b: string | undefined, media: string) => {
    const href = (a ?? b ?? "").trim();
    if (href) imports.push({ href, media: media.trim() });
    return "";
  });
  const parts = await Promise.all(
    imports.map(async ({ href, media }) => {
      if (budget.left <= 0) return "";
      budget.left -= 1;
      let url: string;
      try {
        url = new URL(href, baseUrl).toString();
      } catch {
        return "";
      }
      const text = await fetchCss(url);
      if (text === null) return "";
      const body = text.replace(importRx, "");
      return media ? `@media ${media} { ${body} }` : body;
    }),
  );
  return `${parts.join("\n")}\n${stripped}`;
}

/** The top-level blocks of a sheet: rules, at-rules with their bodies, and
    at-statements. */
function splitBlocks(css: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blocks.push(css.slice(start, i + 1));
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      blocks.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (css.slice(start).trim()) blocks.push(css.slice(start));
  return blocks;
}

/** Does jsdom's CSS parser read this text? A failed parse leaves the style
    element without a sheet. */
function parses(document: Document, css: string): boolean {
  const probe = document.createElement("style");
  probe.textContent = css;
  document.head.appendChild(probe);
  const ok = probe.sheet !== null;
  probe.remove();
  return ok;
}

/** The sheet with what jsdom's parser cannot read taken out. One rule it
    rejects (a selector with an escaped quote, a nested rule) would drop the
    whole sheet — and a Tailwind sheet keeps every utility in one @layer
    block, so one bad rule dropped every class on the page. Escaped quotes
    become hex escapes (the same selector, readable by the parser); a block
    that still fails is split, and only the rules that fail are dropped. */
function readableCss(document: Document, css: string, depth = 0): string {
  const text = depth === 0 ? css.replace(/\\'/g, "\\27 ").replace(/\\"/g, "\\22 ") : css;
  if (!text.trim() || parses(document, text)) return text;
  if (depth > 3) return "";
  const blocks = splitBlocks(text);
  if (blocks.length <= 1) {
    // One block: an at-rule wrapper keeps what parses inside it; a bare
    // rule that fails is dropped.
    const block = blocks[0] ?? "";
    const open = block.indexOf("{");
    if (open === -1 || !/^\s*@(media|layer|supports|container)\b/.test(block) || !block.trimEnd().endsWith("}")) return "";
    const inner = readableCss(document, block.slice(open + 1, block.lastIndexOf("}")), depth + 1);
    const wrapper = `${block.slice(0, open + 1)}${inner}}`;
    return parses(document, wrapper) ? wrapper : "";
  }
  return blocks.map((block) => readableCss(document, block, depth + 1)).join("\n");
}

/** Fetch the page's linked stylesheets and put each in place as a <style>,
    so the cascade order stays the page's. A sheet that will not load is
    dropped. */
async function inlineStylesheets(document: Document, baseUrl: string): Promise<void> {
  // The page's own <style> blocks, repaired the same way.
  for (const style of [...document.querySelectorAll("style")]) {
    if (style.sheet !== null || !(style.textContent ?? "").trim()) continue;
    style.textContent = readableCss(document, style.textContent ?? "");
  }
  const links = [...document.querySelectorAll('link[rel~="stylesheet"][href]')].filter((link) => {
    const rel = link.getAttribute("rel") ?? "";
    const media = link.getAttribute("media") ?? "";
    return !/alternate/i.test(rel) && !link.hasAttribute("disabled") && !/^\s*print\s*$/i.test(media);
  });
  const budget = { left: SHEET_LIMIT };
  await Promise.all(
    links.slice(0, SHEET_LIMIT).map(async (link) => {
      budget.left -= 1;
      let url: string;
      try {
        url = new URL(link.getAttribute("href") ?? "", baseUrl).toString();
      } catch {
        link.remove();
        return;
      }
      const css = await fetchCss(url);
      if (css === null) {
        link.remove();
        return;
      }
      const text = await resolveImports(css, url, budget);
      const media = link.getAttribute("media")?.trim() ?? "";
      const style = document.createElement("style");
      style.textContent = readableCss(document, media && media.toLowerCase() !== "all" ? `@media ${media} { ${text} }` : text);
      link.replaceWith(style);
    }),
  );
  // A chart's own <style> block (exported charts carry one) joins the page's
  // sheets: its class rules apply to the chart like any other.
  for (const style of [...document.querySelectorAll("svg style")]) {
    const copy = document.createElement("style");
    copy.textContent = style.textContent;
    document.head.appendChild(copy);
  }
}

// ── Media queries, as a desktop browser answers them ────────────────────────

function lengthPx(value: string): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(px|em|rem)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] && m[2].toLowerCase() !== "px" ? n * 16 : n;
}

function featureMatches(feature: string): boolean {
  const text = feature.trim().toLowerCase();
  // Range syntax: (width >= 600px), (600px <= width).
  const range = /^(?:(\d*\.?\d+(?:px|em|rem)?)\s*(<=|<|>=|>)\s*)?(width|height)(?:\s*(<=|<|>=|>)\s*(\d*\.?\d+(?:px|em|rem)?))?$/.exec(text);
  if (range && (range[1] || range[5])) {
    const actual = range[3] === "width" ? VIEWPORT_WIDTH : VIEWPORT_HEIGHT;
    const compare = (op: string, a: number, b: number) =>
      op === "<" ? a < b : op === "<=" ? a <= b : op === ">" ? a > b : a >= b;
    if (range[1] && !compare(range[2], lengthPx(range[1]) ?? 0, actual)) return false;
    if (range[5] && !compare(range[4], actual, lengthPx(range[5]) ?? 0)) return false;
    return true;
  }
  const pair = /^([a-z-]+)\s*(?::\s*(.+))?$/.exec(text);
  if (!pair) return false;
  const [, name, raw] = pair;
  const value = (raw ?? "").trim();
  const px = lengthPx(value);
  switch (name) {
    case "min-width":
      return px !== null && VIEWPORT_WIDTH >= px;
    case "max-width":
      return px !== null && VIEWPORT_WIDTH <= px;
    case "min-height":
      return px !== null && VIEWPORT_HEIGHT >= px;
    case "max-height":
      return px !== null && VIEWPORT_HEIGHT <= px;
    case "width":
      return px !== null && VIEWPORT_WIDTH === px;
    case "height":
      return px !== null && VIEWPORT_HEIGHT === px;
    case "orientation":
      return value === "landscape";
    case "prefers-color-scheme":
      return value === "light";
    case "prefers-reduced-motion":
      return value === "no-preference";
    case "prefers-contrast":
      return value === "no-preference";
    case "hover":
      return value === "hover";
    case "any-hover":
      return value === "hover";
    case "pointer":
    case "any-pointer":
      return value === "fine";
    case "min-resolution":
    case "resolution":
      return true;
    case "max-resolution":
      return false;
    case "display-mode":
      return value === "browser";
    case "forced-colors":
      return value === "none";
    case "color":
    case "min-color":
      return true;
    default:
      return false;
  }
}

/** Does one media list match a desktop browser in light mode? */
export function mediaMatches(mediaText: string): boolean {
  const queries = mediaText.split(",").map((q) => q.trim()).filter(Boolean);
  if (queries.length === 0) return true;
  return queries.some((query) => {
    let text = query.toLowerCase();
    let negate = false;
    if (text.startsWith("not ")) {
      negate = true;
      text = text.slice(4).trim();
    } else if (text.startsWith("only ")) {
      text = text.slice(5).trim();
    }
    // "screen and (min-width: 600px)": the type, then the features.
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of text) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      cur += ch;
      if (depth === 0 && cur.endsWith(" and ")) {
        parts.push(cur.slice(0, -5).trim());
        cur = "";
      }
    }
    if (cur.trim()) parts.push(cur.trim());
    let matched = true;
    for (const part of parts) {
      if (part.startsWith("(")) {
        // "(a) or (b)" inside one query: any side matches.
        const sides = part.split(/\)\s+or\s+\(/).map((s) => s.replace(/^\(/, "").replace(/\)$/, ""));
        if (!sides.some((s) => featureMatches(s))) matched = false;
      } else if (!(part === "screen" || part === "all")) {
        matched = false;
      }
    }
    return negate ? !matched : matched;
  });
}

// ── The cascade ─────────────────────────────────────────────────────────────
// A declaration's weight: important (1e15) > inline (1e13) > cascade layer
// (unlayered rules above every @layer, layers in order of appearance, 1e10
// each) > specificity (1e5 each) > order in the sheets.

const INLINE_WEIGHT = 1e13;
const IMPORTANT_WEIGHT = 1e15;
const LAYER_WEIGHT = 1e10;
const SPECIFICITY_WEIGHT = 1e5;

function splitSelectors(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function specificityOf(selector: string): number {
  // An escaped character (Tailwind's `.w-\[172px\]`) is one letter of a name.
  const s = selector.replace(/\\./g, "x").replace(/\([^)]*\)/g, "()").replace(/\[[^\]]*\]/g, "[]");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (s.match(/\.[\w-]+/g) ?? []).length +
    (s.match(/\[\]/g) ?? []).length +
    (s.match(/:(?!:)[\w-]+/g) ?? []).length;
  const types = (s.match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*/g) ?? []).length + (s.match(/::[\w-]+/g) ?? []).length;
  return ids * 10_000 + classes * 100 + types;
}

/** The tokens a selector's last compound must find on an element: the tag,
    the classes, the id. Nothing → matches anything. A class written with
    escapes (Tailwind's `.page\:hidden`) is read as the element writes it. */
function lastCompound(selector: string): Compound | null {
  // The last compound starts after the last combinator outside parentheses
  // and brackets; an escaped character is never a combinator.
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  const last = selector.slice(start).trim();
  if (!last) return null;
  const compound: Compound = { tag: null, classes: [], id: null, attrs: [], simple: start === 0 };
  const name = (from: number): [string, number] => {
    let out = "";
    let i = from;
    while (i < last.length) {
      const ch = last[i];
      if (ch === "\\" && i + 1 < last.length) {
        out += last[i + 1];
        i += 2;
        continue;
      }
      if (!/[\w-]/.test(ch)) break;
      out += ch;
      i++;
    }
    return [out, i];
  };
  let i = 0;
  const tag = /^([a-zA-Z][\w-]*|\*)/.exec(last);
  if (tag) {
    if (tag[1] !== "*") compound.tag = tag[1].toLowerCase();
    i = tag[0].length;
  }
  while (i < last.length) {
    const ch = last[i];
    if (ch === "." || ch === "#") {
      const [text, next] = name(i + 1);
      if (text) {
        if (ch === ".") compound.classes.push(text);
        else compound.id = text;
      }
      i = next;
      continue;
    }
    if (ch === "[" || ch === "(") {
      // Skip to the matching close.
      let d = 0;
      const from = i;
      for (; i < last.length; i++) {
        if (last[i] === "\\") {
          i++;
          continue;
        }
        if (last[i] === "[" || last[i] === "(") d++;
        else if (last[i] === "]" || last[i] === ")") d--;
        if (d === 0) {
          i++;
          break;
        }
      }
      if (ch === "(") {
        compound.simple = false;
        continue;
      }
      // [name] or [name="value"]; any other test needs the engine.
      const attr = /^\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+)))?\s*\]$/.exec(last.slice(from, i));
      if (attr) compound.attrs.push({ name: attr[1].toLowerCase(), value: attr[2] ?? attr[3] ?? attr[4] ?? null });
      else compound.simple = false;
      continue;
    }
    if (ch === ":") compound.simple = false;
    i++;
  }
  return compound;
}

/** Does an element carry a simple compound's tokens? */
function matchesCompound(el: Element, compound: Compound, classes: DOMTokenList): boolean {
  if (compound.tag && compound.tag !== el.tagName.toLowerCase()) return false;
  if (compound.id && compound.id !== el.getAttribute("id")) return false;
  for (const c of compound.classes) if (!classes.contains(c)) return false;
  for (const { name, value } of compound.attrs) {
    const actual = el.getAttribute(name);
    if (actual === null || (value !== null && actual !== value)) return false;
  }
  return true;
}

type RuleLike = {
  selectorText?: string;
  style?: CSSStyleDeclaration;
  cssRules?: CSSRuleList;
  media?: { mediaText?: string } | string;
  conditionText?: string;
  layerName?: string;
};

function collectRules(document: Document): Rule[] {
  const rules: { rule: Rule; layer: string | null }[] = [];
  const layers: string[] = [];
  let order = 0;
  let anonymous = 0;
  const visit = (list: CSSRuleList, layer: string | null) => {
    for (const rule of Array.from(list) as unknown as RuleLike[]) {
      if (rules.length >= RULE_LIMIT) return;
      if (typeof rule.selectorText === "string" && rule.style) {
        const selectors = splitSelectors(rule.selectorText).map((text) => ({
          text,
          specificity: specificityOf(text),
          compound: lastCompound(text),
        }));
        if (selectors.length > 0) rules.push({ rule: { selectors, style: rule.style, base: order++ }, layer });
        continue;
      }
      if (rule.media !== undefined) {
        const mediaText = typeof rule.media === "string" ? rule.media : (rule.media.mediaText ?? "");
        if (mediaMatches(mediaText) && rule.cssRules) visit(rule.cssRules, layer);
        continue;
      }
      if (typeof rule.layerName === "string" && rule.cssRules) {
        // A nested layer ranks with its outermost layer; an anonymous layer
        // is its own.
        const name = layer ?? (rule.layerName.split(".")[0] || `anonymous-${anonymous++}`);
        if (!layers.includes(name)) layers.push(name);
        visit(rule.cssRules, name);
        continue;
      }
      // @supports, @container, and the like: their rules apply.
      if (rule.cssRules) visit(rule.cssRules, layer);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules, null);
    } catch {
      // a sheet that would not parse contributes nothing
    }
  }
  // Unlayered rules rank above every layer.
  for (const { rule, layer } of rules) {
    const rank = layer === null ? layers.length + 1 : layers.indexOf(layer) + 1;
    rule.base += rank * LAYER_WEIGHT;
  }
  return rules.map((r) => r.rule);
}

// A pseudo-element never has a DOM element; a state pseudo-class never holds
// in a static page; :has() takes the selector engine a second per query.
const NEVER_RX = /::|:(?:hover|focus|active|visited|checked|focus-within|focus-visible|target|placeholder-shown|autofill|has)\b|:-webkit-|:-moz-/;

function neverMatches(selector: string): boolean {
  return NEVER_RX.test(selector);
}

function indexRules(rules: Rule[]): RuleIndex {
  const index: RuleIndex = { byClass: new Map(), byId: new Map(), byTag: new Map(), universal: [] };
  const add = (map: Map<string, Entry[]>, key: string, entry: Entry) => {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  };
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      const entry = { rule, selector };
      const compound = selector.compound;
      if (!compound || neverMatches(selector.text)) continue;
      if (compound.classes.length > 0) add(index.byClass, compound.classes[0], entry);
      else if (compound.id) add(index.byId, compound.id, entry);
      else if (compound.tag) add(index.byTag, compound.tag, entry);
      else index.universal.push(entry);
    }
  }
  return index;
}

function propertiesOf(style: CSSStyleDeclaration): string[] {
  const out: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style.item ? style.item(i) : (style as unknown as Record<number, string>)[i];
    if (name) out.push(name);
  }
  return out;
}

function addDeclarations(decls: Decls, style: CSSStyleDeclaration, baseWeight: number) {
  for (const prop of propertiesOf(style)) {
    const value = style.getPropertyValue(prop);
    if (!value) continue;
    const important = style.getPropertyPriority(prop) === "important";
    const weight = baseWeight + (important ? IMPORTANT_WEIGHT : 0);
    const existing = decls.get(prop);
    if (!existing || weight >= existing.weight) decls.set(prop, { value: value.trim(), weight });
  }
}

/** The rules that could match an element, by its tokens. */
function candidateEntries(el: Element, index: RuleIndex): Entry[] {
  const out: Entry[] = [...index.universal];
  const tagEntries = index.byTag.get(el.tagName.toLowerCase());
  if (tagEntries) out.push(...tagEntries);
  const id = el.getAttribute("id");
  if (id) {
    const idEntries = index.byId.get(id);
    if (idEntries) out.push(...idEntries);
  }
  const cls = el.getAttribute("class");
  if (cls) {
    for (const c of cls.split(/\s+/)) {
      if (!c) continue;
      const classEntries = index.byClass.get(c);
      if (classEntries) out.push(...classEntries);
    }
  }
  return out;
}

/** The elements one selector matches, queried once per page. A selector
    the engine does not know matches nothing. */
function matchedSet(document: Document, selector: string, page: Page): Set<Element> {
  const cached = page.matched.get(selector);
  if (cached) return cached;
  let set: Set<Element>;
  if (neverMatches(selector) || page.budget.matches <= 0) set = new Set();
  else {
    try {
      const matched = document.querySelectorAll(selector);
      page.budget.matches -= matched.length;
      set = new Set(matched);
    } catch {
      set = new Set();
    }
  }
  page.matched.set(selector, set);
  return set;
}

/** One element's cascaded declarations: the matching rules, then inline
    style. Cached per element across the passes. */
function declsOf(el: Element, page: Page): Decls {
  const cached = page.decls.get(el);
  if (cached) return cached;
  const decls: Decls = new Map();
  const tag = el.tagName.toLowerCase();
  for (const { rule, selector } of candidateEntries(el, page.index)) {
    const compound = selector.compound;
    if (!compound || (compound.tag && compound.tag !== tag)) continue;
    if (compound.simple ? !matchesCompound(el, compound, el.classList) : !matchedSet(el.ownerDocument, selector.text, page).has(el)) continue;
    addDeclarations(decls, rule.style, rule.base + selector.specificity * SPECIFICITY_WEIGHT);
  }
  const inline = (el as HTMLElement).style;
  if (inline && inline.length > 0) addDeclarations(decls, inline, INLINE_WEIGHT);
  expandFontShorthand(decls);
  page.decls.set(el, decls);
  return decls;
}

// A `font` shorthand sets style, weight, size, and family at once: each
// becomes its longhand at the shorthand's weight, unless a heavier longhand
// already stands.
function expandFontShorthand(decls: Decls) {
  const font = decls.get("font");
  if (!font) return;
  const tokens = font.value.match(/"[^"]*"|'[^']*'|[^\s,]+,?/g) ?? [];
  const sizeAt = tokens.findIndex((t) => /^(\d|\.\d|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)/.test(t));
  if (sizeAt === -1) return;
  const set = (prop: string, value: string) => {
    const existing = decls.get(prop);
    if (!existing || existing.weight < font.weight) decls.set(prop, { value, weight: font.weight });
  };
  for (const token of tokens.slice(0, sizeAt)) {
    const t = token.toLowerCase();
    if (t === "italic" || t === "oblique") set("font-style", t);
    else if (t === "bold" || t === "bolder" || t === "lighter" || /^[1-9]00$/.test(t)) set("font-weight", t);
  }
  set("font-size", tokens[sizeAt].split("/")[0]);
  const family = tokens.slice(sizeAt + 1).join(" ").replace(/,\s*/g, ", ").trim();
  if (family) set("font-family", family);
}

// ── Values ──────────────────────────────────────────────────────────────────

/** var(--x, fallback) → its value through the custom property lookup. Null
    when a reference has no value and no fallback. */
function resolveVars(value: string, custom: (name: string) => string | null, depth = 0): string | null {
  if (!value.includes("var(") || depth > 8) return value.includes("var(") ? null : value;
  let out = "";
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf("var(", i);
    if (at === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    // The balanced argument.
    let depthParens = 1;
    let j = at + 4;
    while (j < value.length && depthParens > 0) {
      if (value[j] === "(") depthParens++;
      else if (value[j] === ")") depthParens--;
      j++;
    }
    if (depthParens !== 0) return null;
    const inner = value.slice(at + 4, j - 1);
    const comma = inner.indexOf(",");
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? null : inner.slice(comma + 1).trim();
    let resolved = custom(name);
    if (resolved !== null) resolved = resolveVars(resolved, custom, depth + 1);
    if (resolved === null && fallback !== null) resolved = resolveVars(fallback, custom, depth + 1);
    if (resolved === null) return null;
    out += resolved;
    i = j;
  }
  return out;
}

function isTransparent(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (TRANSPARENT.has(v)) return true;
  return /^rgba?\(\s*\d+\s*,?\s*\d+\s*,?\s*\d+\s*[,/]\s*0(?:\.0+)?\s*\)$/.test(v) || /^#[0-9a-f]{6}00$/.test(v) || /^#[0-9a-f]{3}0$/.test(v);
}

/** The color in a background shorthand's last layer, or null. */
function backgroundColorOf(shorthand: string): string | null {
  let depth = 0;
  let cur = "";
  const layers: string[] = [];
  for (const ch of shorthand) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      layers.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  layers.push(cur.trim());
  const last = layers[layers.length - 1] ?? "";
  const tokens = last.match(/#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|[a-zA-Z]+/g) ?? [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith("#") || /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/.test(lower)) return token;
    if (/^[a-z]+$/.test(lower) && !BACKGROUND_WORDS.has(lower) && !/gradient|url/.test(lower)) return token;
  }
  return null;
}

function safeValue(value: string): boolean {
  return !/url\s*\(|expression|javascript:|@import|\\|<|>/i.test(value);
}

// ── Lengths ─────────────────────────────────────────────────────────────────
// A length as pixels: units, calc(), min(), max(), clamp(). Percentages need
// the parent's pixels; without them the value is unknown (null).

type LengthEnv = { parentPx: number | null; fontPx: number; rootFontPx: number };
// A number with a unit: px, or a bare factor.
type Quantity = { n: number; px: boolean };

class LengthParser {
  private i = 0;
  constructor(private readonly text: string, private readonly env: LengthEnv) {}

  parse(): number | null {
    const q = this.expr();
    this.ws();
    if (q === null || this.i < this.text.length) return null;
    return q.px || q.n === 0 ? q.n : null;
  }

  private ws() {
    while (this.i < this.text.length && /\s/.test(this.text[this.i])) this.i++;
  }

  private expr(): Quantity | null {
    let left = this.term();
    for (;;) {
      this.ws();
      const op = this.text[this.i];
      if (op !== "+" && op !== "-") return left;
      this.i++;
      const right = this.term();
      if (left === null || right === null || left.px !== right.px) {
        if (left !== null && right !== null && ((left.n === 0 && !left.px) || (right.n === 0 && !right.px))) {
          left = { n: op === "+" ? left.n + right.n : left.n - right.n, px: true };
          continue;
        }
        left = null;
        continue;
      }
      left = { n: op === "+" ? left.n + right.n : left.n - right.n, px: left.px };
    }
  }

  private term(): Quantity | null {
    let left = this.factor();
    for (;;) {
      this.ws();
      const op = this.text[this.i];
      if (op !== "*" && op !== "/") return left;
      this.i++;
      const right = this.factor();
      if (left === null || right === null) {
        left = null;
        continue;
      }
      if (op === "*") {
        if (left.px && right.px) left = null;
        else left = { n: left.n * right.n, px: left.px || right.px };
      } else {
        if (right.px || right.n === 0) left = null;
        else left = { n: left.n / right.n, px: left.px };
      }
    }
  }

  private factor(): Quantity | null {
    this.ws();
    const ch = this.text[this.i];
    if (ch === "-" || ch === "+") {
      this.i++;
      const q = this.factor();
      return q === null ? null : { n: ch === "-" ? -q.n : q.n, px: q.px };
    }
    if (ch === "(") {
      this.i++;
      const q = this.expr();
      this.ws();
      if (this.text[this.i] !== ")") return null;
      this.i++;
      return q;
    }
    const fn = /^(calc|min|max|clamp)\(/i.exec(this.text.slice(this.i));
    if (fn) {
      this.i += fn[0].length;
      const args: (Quantity | null)[] = [];
      for (;;) {
        args.push(this.expr());
        this.ws();
        if (this.text[this.i] === ",") {
          this.i++;
          continue;
        }
        if (this.text[this.i] !== ")") return null;
        this.i++;
        break;
      }
      return this.call(fn[1].toLowerCase(), args);
    }
    const num = /^(-?\d*\.?\d+)([a-zA-Z%]*)/.exec(this.text.slice(this.i));
    if (!num) return null;
    this.i += num[0].length;
    return this.quantity(Number(num[1]), num[2].toLowerCase());
  }

  private call(name: string, args: (Quantity | null)[]): Quantity | null {
    const px = args.filter((a): a is Quantity => a !== null && a.px);
    switch (name) {
      case "calc":
        return args.length === 1 ? args[0] : null;
      case "min":
        // An unknown arm cannot raise the minimum: the known arms bound it.
        return px.length > 0 ? { n: Math.min(...px.map((a) => a.n)), px: true } : null;
      case "max":
        return px.length === args.length && px.length > 0 ? { n: Math.max(...px.map((a) => a.n)), px: true } : null;
      case "clamp": {
        if (args.length !== 3) return null;
        const [lo, mid, hi] = args;
        let n = mid?.px ? mid.n : hi?.px ? hi.n : null;
        if (n === null) return null;
        if (hi?.px) n = Math.min(n, hi.n);
        if (lo?.px) n = Math.max(n, lo.n);
        return { n, px: true };
      }
      default:
        return null;
    }
  }

  private quantity(n: number, unit: string): Quantity | null {
    switch (unit) {
      case "":
        return { n, px: false };
      case "px":
        return { n, px: true };
      case "rem":
        return { n: n * this.env.rootFontPx, px: true };
      case "em":
        return { n: n * this.env.fontPx, px: true };
      case "ch":
        return { n: n * this.env.fontPx * 0.5, px: true };
      case "%":
        return this.env.parentPx === null ? null : { n: (n / 100) * this.env.parentPx, px: true };
      case "vw":
        return { n: (n / 100) * VIEWPORT_WIDTH, px: true };
      case "vh":
        return { n: (n / 100) * VIEWPORT_HEIGHT, px: true };
      case "pt":
        return { n: n * (4 / 3), px: true };
      case "in":
        return { n: n * 96, px: true };
      case "cm":
        return { n: n * 37.8, px: true };
      case "mm":
        return { n: n * 3.78, px: true };
      default:
        return null;
    }
  }
}

/** A length value in pixels, or null when only a browser could know. */
function lengthOf(value: string, env: LengthEnv): number | null {
  const text = value.trim().toLowerCase();
  if (!text || /^(auto|none|inherit|initial|unset|revert|fit-content|max-content|min-content)$/.test(text)) return null;
  if (/^-?\d*\.?\d+(px|rem|em|%|vw|vh|ch|pt|in|cm|mm)?$/.test(text)) {
    return new LengthParser(text, env).parse();
  }
  if (!/^(calc|min|max|clamp)\(/.test(text)) return null;
  return new LengthParser(text, env).parse();
}

// ── Inheritance down a chain of elements ────────────────────────────────────

/** The style an element resolves to, given its parent's: colors through
    currentColor, font sizes through em, custom properties up the chain. */
function resolveElement(decls: Decls, parent: ElementStyle | null, rootFontPx: number): ElementStyle {
  const custom = (name: string): string | null => decls.get(name)?.value ?? parent?.custom(name) ?? null;
  const parentColor = parent?.color ?? "";
  const parentFontSize = parent?.fontSize ?? 16;
  let color = parentColor;
  const colorDecl = decls.get("color");
  if (colorDecl) {
    const resolved = resolveVars(colorDecl.value, custom);
    if (resolved && !/^(inherit|currentcolor)$/i.test(resolved.trim())) color = resolved.trim();
  }
  let fontSize = parentFontSize;
  let fontSizePx: number | null = null;
  const sizeDecl = decls.get("font-size");
  if (sizeDecl) {
    const resolved = resolveVars(sizeDecl.value, custom);
    fontSizePx = resolved ? lengthOf(resolved, { parentPx: parentFontSize, fontPx: parentFontSize, rootFontPx }) : null;
    if (fontSizePx !== null && fontSizePx > 0) fontSize = fontSizePx;
    else fontSizePx = null;
  }
  return { decls, parent, color, fontSize, fontSizePx, custom };
}

/** One element's resolved style, its ancestors' first. Cached across the
    passes; null past the style budget. */
function styleOf(el: Element, page: Page): ElementStyle | null {
  const cached = page.styles.get(el);
  if (cached) return cached;
  if (page.budget.styles <= 0) return null;
  page.budget.styles -= 1;
  const parentEl = el.parentElement;
  const parent = parentEl ? styleOf(parentEl, page) : null;
  if (parentEl && !parent) return null;
  const style = resolveElement(declsOf(el, page), parent, page.rootFontPx);
  page.styles.set(el, style);
  if (el.tagName.toLowerCase() === "html" && style.fontSizePx !== null) page.rootFontPx = style.fontSizePx;
  return style;
}

/** One property's value as inline style, or null when it cannot be written
    plainly: an unresolved var(), an external reference. */
function bakedValue(prop: string, style: ElementStyle): string | null {
  const decl = style.decls.get(prop);
  if (!decl) return null;
  let value = resolveVars(decl.value, style.custom);
  if (value === null) return null;
  value = value.replace(/\s+/g, " ").trim();
  if (/^(inherit|unset|revert|initial)$/i.test(value)) return null;
  if (COLOR_PROPERTIES.has(prop) && /^currentcolor$/i.test(value)) {
    return style.color && safeValue(style.color) ? style.color : null;
  }
  if (prop === "font-size") {
    if (style.fontSizePx !== null) return `${Math.round(style.fontSizePx * 100) / 100}px`;
    return safeValue(value) ? value : null;
  }
  return safeValue(value) ? value : null;
}

/** An element's own resolved value of a property, lower-cased; null when
    it has none or the value is a keyword that defers to the parent. */
function ownValue(style: ElementStyle, prop: string): string | null {
  const decl = style.decls.get(prop);
  if (!decl) return null;
  const value = resolveVars(decl.value, style.custom);
  if (value === null) return null;
  const text = value.replace(/\s+/g, " ").trim().toLowerCase();
  return /^(inherit|unset|revert|initial|revert-layer)$/.test(text) ? null : text;
}

/** The value an element inherits for a property: its own, else its
    parent's. */
function inheritedValue(style: ElementStyle, prop: string): string | null {
  for (let s: ElementStyle | null = style; s; s = s.parent) {
    const value = ownValue(s, prop);
    if (value !== null) return value;
  }
  return null;
}

function setInlineStyle(el: Element, declarations: Map<string, string>) {
  if (declarations.size === 0) return;
  const text = [...declarations].map(([prop, value]) => `${prop}: ${value}`).join("; ");
  el.setAttribute("style", text);
}

// ── The backdrop behind a figure ────────────────────────────────────────────

/** The background the page drew behind an element: the nearest non-transparent
    background from the element up, gradients kept when they are plain
    gradients, as a background value; null when the page drew nothing. */
function backdropOf(chain: { el: Element; style: ElementStyle }[]): { el: Element; background: string } | null {
  for (const { el, style } of chain) {
    const colorDecl = style.decls.get("background-color");
    const shorthand = style.decls.get("background");
    // The later of the two declarations wins the color.
    const color = colorDecl && (!shorthand || colorDecl.weight >= shorthand.weight)
      ? resolveVars(colorDecl.value, style.custom)
      : null;
    if (color !== null && !isTransparent(color) && safeValue(color)) {
      return { el, background: color.replace(/\s+/g, " ").trim() };
    }
    if (shorthand && (!colorDecl || shorthand.weight >= colorDecl.weight)) {
      const resolved = resolveVars(shorthand.value, style.custom);
      if (resolved === null) continue;
      if (/url\s*\(/i.test(resolved)) {
        const only = backgroundColorOf(resolved);
        if (only && !isTransparent(only) && safeValue(only)) return { el, background: only };
        continue;
      }
      const layerColor = backgroundColorOf(resolved);
      if (/gradient\(/i.test(resolved) && safeValue(resolved)) {
        return { el, background: resolved.replace(/\s+/g, " ").trim() };
      }
      if (layerColor && !isTransparent(layerColor) && safeValue(layerColor)) return { el, background: layerColor };
    }
  }
  return null;
}

// ── Figures keep their look ─────────────────────────────────────────────────

/** An svg that is a chart, not an icon: it has text, or enough shapes at a
    real width. */
export function isChartSvg(svg: Element): boolean {
  if (svg.querySelector("text")) return true;
  const shapes = svg.querySelectorAll("path, rect, circle, line, polyline, polygon").length;
  const viewBox = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const width = viewBox?.[2] ?? Number(svg.getAttribute("width") ?? 0);
  return shapes > 6 && width > 100;
}

/** The resolved styles of an element's ancestors, outermost first. */
function ancestorChain(el: Element, page: Page): { el: Element; style: ElementStyle }[] {
  const chain: { el: Element; style: ElementStyle }[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = styleOf(node, page);
    if (!style) return [];
    chain.unshift({ el: node, style });
  }
  return chain;
}

function bakeSvg(svg: Element, page: Page, budget: { left: number }) {
  const chain = ancestorChain(svg, page);
  const parentStyle = chain[chain.length - 1]?.style ?? null;
  const elements = [svg, ...svg.querySelectorAll("*")];
  if (elements.length > SVG_ELEMENT_LIMIT || elements.length > budget.left) return;
  budget.left -= elements.length;
  const styles = new Map<Element, ElementStyle>();
  // Custom properties read up through the page: the svg's chain of
  // declarations, then its ancestors'.
  const resolveTree = (el: Element, parent: ElementStyle | null) => {
    const style = resolveElement(declsOf(el, page), parent, page.rootFontPx);
    styles.set(el, style);
    for (const child of el.children) resolveTree(child, style);
  };
  resolveTree(svg, parentStyle);

  for (const [el, style] of styles) {
    if (!el.isConnected) continue;
    // Hidden on the page: hidden here.
    const display = bakedValue("display", style);
    const visibility = bakedValue("visibility", style);
    if (display === "none" || visibility === "hidden" || visibility === "collapse") {
      if (el !== svg) el.remove();
      continue;
    }
    const baked = new Map<string, string>();
    if (el === svg) {
      // The root carries what the page's surroundings gave it.
      for (const prop of INHERITED_PROPERTIES) {
        if (style.decls.has(prop)) continue; // its own declaration bakes below
        for (let i = chain.length - 1; i >= 0; i--) {
          const value = bakedValue(prop, chain[i].style);
          if (value !== null) {
            baked.set(prop, value);
            break;
          }
          if (chain[i].style.decls.has(prop)) break; // declared, but not writable
        }
      }
      if (!baked.has("color") && style.color && safeValue(style.color)) baked.set("color", style.color);
      const backdrop = backdropOf([{ el: svg, style }, ...[...chain].reverse()]);
      if (backdrop) {
        baked.set("background", backdrop.background);
        // A wrapper around the svg alone: its padding is the figure's margin
        // inside the backdrop.
        const wrapper = backdrop.el;
        const alone = wrapper === svg.parentElement && [...wrapper.children].length === 1;
        const padding = alone ? bakedValue("padding", chain[chain.length - 1].style) : null;
        if (padding) baked.set("padding", padding);
      }
    }
    // The element's own inline declarations stay, resolved; the presentation
    // properties join them.
    const inline = (el as HTMLElement).style;
    const props = new Set([...(inline && inline.length > 0 ? propertiesOf(inline) : []), ...SVG_PROPERTIES]);
    for (const prop of props) {
      if (prop.startsWith("--")) continue;
      const value = bakedValue(prop, style);
      if (value !== null) baked.set(prop, value);
    }
    // A chart sized by its stylesheet alone: the size becomes its viewBox, so
    // the reader can scale it.
    if (el === svg && !svg.hasAttribute("viewBox")) {
      const w = lengthPx(bakedValue("width", style) ?? svg.getAttribute("width") ?? "");
      const h = lengthPx(bakedValue("height", style) ?? svg.getAttribute("height") ?? "");
      if (w && h && w > 0 && h > 0) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    }
    setInlineStyle(el, baked);
  }
}

function bakeImage(img: Element, page: Page) {
  const chain = ancestorChain(img, page);
  const style = styleOf(img, page);
  if (!style) return;
  const backdrop = backdropOf([{ el: img, style }, ...[...chain].reverse()]);
  if (!backdrop) return;
  // The sanitizer turns this into the image's inline background.
  img.setAttribute("data-backdrop", backdrop.background);
}

// ── Figures keep their layout ───────────────────────────────────────────────

function isHidden(el: Element): boolean {
  return el.closest("[data-unitos-hidden]") !== null;
}

function textLength(el: Element): number {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
}

/** The elements the given selectors match, within the match budget. */
function matchAll(document: Document, selectors: Iterable<string>, page: Page): Set<Element> {
  const out = new Set<Element>();
  for (const selector of selectors) {
    if (page.budget.matches <= 0) break;
    for (const el of matchedSet(document, selector, page)) out.add(el);
  }
  return out;
}

/** The selectors of the rules that declare one of the properties, filtered
    by the declared value when a test is given. */
function selectorsDeclaring(rules: Rule[], properties: string[], test?: (value: string) => boolean): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    let declares = false;
    for (const prop of properties) {
      const value = rule.style.getPropertyValue(prop);
      if (!value) continue;
      if (!test || test(value.trim().toLowerCase())) {
        declares = true;
        break;
      }
    }
    if (declares) for (const selector of rule.selectors) out.push(selector.text);
  }
  return out;
}

/** A hiding value, or one only the cascade can tell (a var()). */
function mayHide(value: string): boolean {
  return value === "none" || value === "hidden" || value === "collapse" || value.includes("var(");
}

/** Mark what a desktop browser hides: display none, or visibility hidden on
    a short element. Hidden subtrees stay out of every later pass. */
function markHidden(document: Document, rules: Rule[], page: Page) {
  const candidates = matchAll(document, selectorsDeclaring(rules, ["display", "visibility"], mayHide), page);
  for (const el of document.querySelectorAll('[style*="display"], [style*="visibility"]')) candidates.add(el);
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag) || el.closest("svg")) continue;
    const style = styleOf(el, page);
    if (!style) return;
    const display = ownValue(style, "display");
    if (display === "none") {
      el.setAttribute("data-unitos-hidden", "1");
      continue;
    }
    const visibility = ownValue(style, "visibility");
    if (visibility !== "hidden" && visibility !== "collapse") continue;
    if (textLength(el) > VISIBILITY_TEXT_LIMIT) continue;
    if ([...el.querySelectorAll("svg")].some(isChartSvg)) continue;
    el.setAttribute("data-unitos-hidden", "1");
  }
}

/** Text alignment inherits: every block under a centered element is
    centered until a nearer declaration says otherwise. */
function markAlignment(document: Document, rules: Rule[], page: Page) {
  const aligned = matchAll(document, selectorsDeclaring(rules, ["text-align"]), page);
  for (const el of document.querySelectorAll('[style*="text-align"], [align], center')) aligned.add(el);
  const ownAlign = new Map<Element, string | null>();
  const alignOf = (el: Element): string | null => {
    const style = styleOf(el, page);
    let value = style ? ownValue(style, "text-align") : null;
    if (value === null) {
      const attr = (el.getAttribute("align") ?? "").toLowerCase();
      if (attr) value = attr;
      else if (el.tagName.toLowerCase() === "center") value = "center";
    }
    if (value === "end" || value === "-webkit-right" || value === "-moz-right") value = "right";
    if (value === "-webkit-center" || value === "-moz-center") value = "center";
    return value;
  };
  for (const el of aligned) {
    if (el.closest("svg")) continue;
    ownAlign.set(el, alignOf(el));
  }
  const mark = (el: Element, align: string) => {
    if (ALIGN_TAGS.has(el.tagName.toLowerCase())) el.setAttribute("data-align", align);
    for (const child of el.children) {
      if (child.hasAttribute("data-unitos-hidden") || child.tagName.toLowerCase() === "svg") continue;
      const own = ownAlign.get(child);
      if (own !== undefined && own !== null) {
        if (own === "center" || own === "right") mark(child, own);
        continue;
      }
      mark(child, align);
    }
  };
  for (const [el, align] of ownAlign) {
    if (align !== "center" && align !== "right") continue;
    if (isHidden(el)) continue;
    // The nearest aligned ancestor's walk marks this subtree when it
    // aligns the same way.
    let outer: string | null | undefined;
    for (let node = el.parentElement; node && outer === undefined; node = node.parentElement) {
      const own = ownAlign.get(node);
      if (own !== undefined && own !== null) outer = own;
    }
    if (outer === align) continue;
    mark(el, align);
  }
}

/** The numeric font weight an element renders with: its own resolved
    declaration, else its parent's. */
function weightOf(style: ElementStyle | null): number {
  if (!style) return 400;
  const own = ownValue(style, "font-weight");
  if (own === null) return weightOf(style.parent);
  if (own === "bold") return 700;
  if (own === "normal") return 400;
  if (own === "bolder") return Math.min(900, weightOf(style.parent) + 300);
  if (own === "lighter") return Math.max(100, weightOf(style.parent) - 300);
  const n = Number(own);
  return Number.isFinite(n) && n > 0 ? n : weightOf(style.parent);
}

/** The generic family a font-family list resolves to: its last generic
    keyword, else a known face, else a face named after its kind, else sans. */
export function classifyFontFamily(list: string): PageFont {
  const faces = list.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "").toLowerCase()).filter(Boolean);
  for (let i = faces.length - 1; i >= 0; i--) {
    const generic = GENERIC_FAMILIES[faces[i]];
    if (generic) return generic;
  }
  for (const face of faces) {
    if (MONO_FACES.some((known) => face.startsWith(known))) return "mono";
    if (SERIF_FACES.some((known) => face.startsWith(known))) return "serif";
  }
  for (const face of faces) {
    if (/mono|code|courier|consol/.test(face)) return "mono";
    if (/serif/.test(face) && !/sans/.test(face)) return "serif";
  }
  return "sans";
}

/** Mark bold, italic, underlined, and monospace elements. Weight, style,
    and family inherit: the blocks under a styled container carry its
    tokens too, until a descendant with its own declaration says otherwise. */
function markStyles(document: Document, rules: Rule[], page: Page) {
  const properties = ["font-weight", "font-style", "text-decoration", "text-decoration-line", "font-family"];
  const candidates = matchAll(document, selectorsDeclaring(rules, properties), page);
  for (const el of document.querySelectorAll('[style*="font"], [style*="text-decoration"]')) candidates.add(el);
  const inherited = new Map<Element, string[]>();
  for (const el of candidates) {
    if (SKIP_TAGS.has(el.tagName.toLowerCase()) || el.closest("svg") || isHidden(el)) continue;
    const style = styleOf(el, page);
    if (!style) return;
    const tokens: string[] = [];
    const weight = weightOf(style);
    if (weight >= 600 || weight - weightOf(style.parent) >= 150) tokens.push("bold");
    const fontStyle = inheritedValue(style, "font-style");
    if (fontStyle === "italic" || fontStyle?.startsWith("oblique")) tokens.push("italic");
    const family = inheritedValue(style, "font-family");
    if (family && classifyFontFamily(family) === "mono") tokens.push("code");
    inherited.set(el, [...tokens]);
    const decoration = ownValue(style, "text-decoration-line") ?? ownValue(style, "text-decoration");
    if (decoration?.includes("underline")) tokens.push("underline");
    if (tokens.length > 0) el.setAttribute("data-style", tokens.join(" "));
  }
  const mark = (el: Element, tokens: string[]) => {
    for (const child of el.children) {
      // A child with its own declaration computed its own tokens above.
      if (inherited.has(child) || child.hasAttribute("data-unitos-hidden") || child.tagName.toLowerCase() === "svg") continue;
      child.setAttribute("data-style", tokens.join(" "));
      mark(child, tokens);
    }
  };
  for (const [el, tokens] of inherited) if (tokens.length > 0) mark(el, tokens);
}

/** The page's prose: paragraphs, and the blocks pages set prose in without
    <p> (a div or span per paragraph). A bounded sample, visible only. */
function proseSample(document: Document): Element[] {
  const out: Element[] = [];
  for (const el of document.body.querySelectorAll("p, div, span, li")) {
    if (out.length >= SAMPLE_LIMIT) break;
    if (isHidden(el) || el.closest("svg, nav, header, footer")) continue;
    if (el.tagName.toLowerCase() === "p") {
      if (textLength(el) >= PROSE_MIN_CHARS) out.push(el);
      continue;
    }
    let own = 0;
    for (const node of el.childNodes) {
      if (node.nodeType === 3) own += (node.textContent ?? "").trim().length;
      else if (node.nodeType === 1 && /^(a|b|i|em|strong|span|code|u|s|sub|sup|mark|small|abbr|cite|q|time)$/i.test((node as Element).tagName)) {
        own += (node.textContent ?? "").trim().length;
      }
    }
    if (own >= PROSE_OWN_MIN_CHARS) out.push(el);
  }
  return out;
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  let best: T | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Headings, and resized text, carry their font size; the body carries the
    body text's size and generic font. */
function markFontSizes(document: Document, rules: Rule[], page: Page, prose: Element[]) {
  const body = document.body;
  const sizes: number[] = [];
  const families: PageFont[] = [];
  for (const el of prose) {
    const style = styleOf(el, page);
    if (!style) break;
    sizes.push(Math.round(style.fontSize));
    const family = inheritedValue(style, "font-family");
    if (family) families.push(classifyFontFamily(family));
  }
  const bodyStyle = styleOf(body, page);
  const bodyPx = mode(sizes) ?? (bodyStyle ? Math.round(bodyStyle.fontSize) : 16);
  body.setAttribute("data-body-font-size", String(bodyPx));
  const bodyFamily = bodyStyle ? inheritedValue(bodyStyle, "font-family") : null;
  body.setAttribute("data-font", mode(families) ?? (bodyFamily ? classifyFontFamily(bodyFamily) : "sans"));

  const candidates = matchAll(document, selectorsDeclaring(rules, ["font-size"]), page);
  for (const el of document.querySelectorAll('[style*="font-size"], h1, h2, h3, h4, h5, h6')) candidates.add(el);
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    if (el.closest("svg") || isHidden(el)) continue;
    const style = styleOf(el, page);
    if (!style) return;
    if (HEADING_TAGS.has(tag)) {
      el.setAttribute("data-font-size", String(Math.round(style.fontSize)));
      continue;
    }
    if (!SIZE_TAGS.has(tag) || style.fontSizePx === null) continue;
    const px = Math.round(style.fontSizePx);
    if (px !== bodyPx) el.setAttribute("data-font-size", String(px));
  }
}

// ── Widths: a small layout walk ─────────────────────────────────────────────
// The page's own boxes, top down: a px width sets, a percentage multiplies,
// padding subtracts, a grid divides by its tracks, a flex row shares the
// rest among its growing children. Enough for a figure's proportions, never
// a browser.

function lengthEnv(style: ElementStyle, parentPx: number | null, page: Page): LengthEnv {
  return { parentPx, fontPx: style.fontSize, rootFontPx: page.rootFontPx };
}

/** A property's resolved length for an element, or null. */
function lengthProp(style: ElementStyle, prop: string, parentPx: number | null, page: Page): number | null {
  const value = ownValue(style, prop);
  return value === null ? null : lengthOf(value, lengthEnv(style, parentPx, page));
}

/** A value's space-separated parts, a function call with its arguments
    one part: "calc(1rem * 2) 4px" → ["calc(1rem * 2)", "4px"]. */
function valueParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** One side of a shorthand: the n-th of 1–4 values. */
function shorthandSide(value: string, side: "left" | "right"): string | null {
  const parts = valueParts(value);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (side === "right") return parts[1];
  return parts.length === 4 ? parts[3] : parts[1];
}

/** The horizontal padding (or margin) of an element in pixels: the shorthand
    and its longhands, the heaviest declaration per side. */
function horizontalSpace(style: ElementStyle, base: "padding" | "margin", parentPx: number | null, page: Page): number {
  const env = lengthEnv(style, parentPx, page);
  let total = 0;
  for (const side of ["left", "right"] as const) {
    const candidates: { weight: number; value: string | null }[] = [];
    const shorthand = style.decls.get(base);
    if (shorthand) candidates.push({ weight: shorthand.weight, value: shorthandSide(resolveVars(shorthand.value, style.custom) ?? "", side) });
    const inline = style.decls.get(`${base}-inline`);
    if (inline) {
      const parts = valueParts(resolveVars(inline.value, style.custom) ?? "");
      candidates.push({ weight: inline.weight, value: parts.length === 0 ? null : side === "left" ? parts[0] : (parts[1] ?? parts[0]) });
    }
    const logical = style.decls.get(`${base}-inline-${side === "left" ? "start" : "end"}`);
    if (logical) candidates.push({ weight: logical.weight, value: resolveVars(logical.value, style.custom) });
    const longhand = style.decls.get(`${base}-${side}`);
    if (longhand) candidates.push({ weight: longhand.weight, value: resolveVars(longhand.value, style.custom) });
    const best = candidates.sort((a, b) => b.weight - a.weight)[0];
    if (!best || best.value === null) continue;
    const px = lengthOf(best.value, env);
    if (px !== null) total += px;
  }
  return total;
}

/** The column gap of a flex or grid container. */
function columnGap(style: ElementStyle, parentPx: number | null, page: Page): number {
  const env = lengthEnv(style, parentPx, page);
  const candidates: { weight: number; value: string | null }[] = [];
  const gap = style.decls.get("gap") ?? style.decls.get("grid-gap");
  if (gap) {
    const parts = valueParts(resolveVars(gap.value, style.custom) ?? "");
    candidates.push({ weight: gap.weight, value: parts[1] ?? parts[0] ?? null });
  }
  const column = style.decls.get("column-gap") ?? style.decls.get("grid-column-gap");
  if (column) candidates.push({ weight: column.weight, value: resolveVars(column.value, style.custom) });
  const best = candidates.sort((a, b) => b.weight - a.weight)[0];
  if (!best || best.value === null) return 0;
  return lengthOf(best.value, env) ?? 0;
}

type Display = "flex" | "grid" | "block";

function displayOf(style: ElementStyle): Display {
  const value = ownValue(style, "display") ?? "";
  if (value === "flex" || value === "inline-flex") {
    const direction = ownValue(style, "flex-direction") ?? "row";
    return direction.startsWith("column") ? "block" : "flex";
  }
  if (value === "grid" || value === "inline-grid") return "grid";
  return "block";
}

function isReplaced(el: Element): boolean {
  return /^(img|video|iframe|svg|canvas|embed|object)$/i.test(el.tagName);
}

/** The children a container lays out in flow, with their styles. */
function laidOutChildren(parent: Element, page: Page): { el: Element; style: ElementStyle }[] {
  const out: { el: Element; style: ElementStyle }[] = [];
  for (const child of parent.children) {
    if (UNLAID_TAGS.has(child.tagName.toLowerCase()) || child.hasAttribute("data-unitos-hidden")) continue;
    const style = styleOf(child, page);
    if (!style) continue;
    const position = ownValue(style, "position");
    if (position === "absolute" || position === "fixed") continue;
    if (ownValue(style, "display") === "none") continue;
    out.push({ el: child, style });
  }
  return out;
}

/** An element's own width in pixels: its width declaration, else its width
    attribute for media; null when auto. */
function ownWidth(el: Element, style: ElementStyle, parentPx: number | null, page: Page): number | null {
  const declared = lengthProp(style, "width", parentPx, page);
  if (declared !== null) return declared;
  if (isReplaced(el) && ownValue(style, "width") === null) {
    const attr = Number(el.getAttribute("width") ?? "");
    if (Number.isFinite(attr) && attr > 0 && /^\d+(\.\d+)?$/.test((el.getAttribute("width") ?? "").trim())) return attr;
    // An inline svg with a viewBox and no size fills its container.
    if (el.tagName.toLowerCase() === "svg" && el.hasAttribute("viewBox")) return parentPx;
  }
  return null;
}

/** An element's width capped by its max-width. */
function capWidth(width: number | null, style: ElementStyle, parentPx: number | null, page: Page): number | null {
  if (width === null) return null;
  const max = lengthProp(style, "max-width", parentPx, page);
  return max !== null && max < width ? max : width;
}

type FlexItem = { el: Element; style: ElementStyle; basis: number | null; grow: number; shrink: number };

/** flex, flex-grow, flex-shrink, and flex-basis as one triple. */
function flexOf(style: ElementStyle, parentPx: number | null, page: Page): { grow: number; shrink: number; basis: number | null; basisAuto: boolean } {
  let grow = 0;
  let shrink = 1;
  let basis: number | null = null;
  let basisAuto = true;
  let weight = -1;
  const shorthand = style.decls.get("flex");
  if (shorthand) {
    const value = (resolveVars(shorthand.value, style.custom) ?? "").trim().toLowerCase();
    weight = shorthand.weight;
    if (value === "none") [grow, shrink] = [0, 0];
    else if (value === "auto") [grow, shrink] = [1, 1];
    else if (value !== "initial" && value !== "") {
      const parts = value.split(/\s+/);
      const numbers = parts.filter((p) => /^\d*\.?\d+$/.test(p)).map(Number);
      const lengths = parts.filter((p) => !/^\d*\.?\d+$/.test(p) && p !== "auto");
      if (numbers.length > 0) grow = numbers[0];
      if (numbers.length > 1) shrink = numbers[1];
      if (lengths.length > 0) {
        basis = lengthOf(lengths[0], lengthEnv(style, parentPx, page));
        basisAuto = false;
      } else if (numbers.length > 0 && !parts.includes("auto")) {
        basis = 0;
        basisAuto = false;
      }
    }
  }
  const longhand = (prop: string) => {
    const decl = style.decls.get(prop);
    return decl && decl.weight >= weight ? (resolveVars(decl.value, style.custom) ?? "").trim().toLowerCase() : null;
  };
  const growValue = longhand("flex-grow");
  if (growValue !== null && /^\d*\.?\d+$/.test(growValue)) grow = Number(growValue);
  const shrinkValue = longhand("flex-shrink");
  if (shrinkValue !== null && /^\d*\.?\d+$/.test(shrinkValue)) shrink = Number(shrinkValue);
  const basisValue = longhand("flex-basis");
  if (basisValue !== null) {
    if (basisValue === "auto") {
      basis = null;
      basisAuto = true;
    } else {
      basis = lengthOf(basisValue, lengthEnv(style, parentPx, page));
      basisAuto = false;
    }
  }
  return { grow, shrink, basis, basisAuto };
}

/** The widths of a flex row's children: fixed bases keep their pixels, the
    rest is shared by growing children, and an overflow shrinks what may
    shrink. */
function flexWidths(parent: Element, parentStyle: ElementStyle, content: number, page: Page) {
  const wrap = (ownValue(parentStyle, "flex-wrap") ?? "nowrap") !== "nowrap";
  const gap = columnGap(parentStyle, content, page);
  const items: FlexItem[] = laidOutChildren(parent, page).map(({ el, style }) => {
    const flex = flexOf(style, content, page);
    let basis = flex.basisAuto ? ownWidth(el, style, content, page) : flex.basis;
    let grow = flex.grow;
    // An auto-sized item with nothing to say shares the row like a growing
    // one: columns of a figure row are equal more often than not.
    if (basis === null) {
      basis = 0;
      if (grow === 0) grow = 1;
    }
    return { el, style, basis, grow, shrink: flex.shrink };
  });
  const gaps = gap * Math.max(0, items.length - 1);
  const used = items.reduce((sum, item) => sum + (item.basis ?? 0), 0);
  const free = content - gaps - used;
  const widths = new Map<Element, number>();
  const totalGrow = items.reduce((sum, item) => sum + item.grow, 0);
  const totalShrink = items.reduce((sum, item) => sum + item.shrink * (item.basis ?? 0), 0);
  for (const item of items) {
    let width = item.basis ?? 0;
    if (free > 0 && totalGrow > 0 && !wrap) width += (free * item.grow) / totalGrow;
    else if (free < 0 && totalShrink > 0 && !wrap) width += (free * item.shrink * (item.basis ?? 0)) / totalShrink;
    width = capWidth(width, item.style, content, page) ?? width;
    widths.set(item.el, Math.max(0, width));
  }
  return widths;
}

/** The column tracks of a grid in pixels. */
function gridTracks(parentStyle: ElementStyle, content: number, gap: number, page: Page): number[] {
  const template = ownValue(parentStyle, "grid-template-columns") ?? "none";
  const env = lengthEnv(parentStyle, content, page);
  const share = (n: number) => Math.max(0, (content - gap * (n - 1)) / n);
  if (template === "none" || template === "auto") return [content];
  const repeat = /^repeat\(\s*(\d+|auto-fit|auto-fill)\s*,\s*(.+)\)$/.exec(template);
  if (repeat) {
    if (/^\d+$/.test(repeat[1])) {
      const n = Math.max(1, Math.min(24, Number(repeat[1])));
      return Array.from({ length: n }, () => share(n));
    }
    const min = /minmax\(\s*([^,]+),/.exec(repeat[2]);
    const minPx = min ? lengthOf(min[1], env) : null;
    if (minPx === null || minPx <= 0) return [content];
    const n = Math.max(1, Math.floor((content + gap) / (minPx + gap)));
    return Array.from({ length: n }, () => share(n));
  }
  // An explicit track list: pixel tracks keep their pixels, fr tracks share
  // the rest, auto tracks count as one fr.
  const tokens = template.match(/minmax\([^)]*\)|fit-content\([^)]*\)|\S+/g) ?? [];
  if (tokens.length === 0) return [content];
  const tracks: { px: number | null; fr: number }[] = tokens.map((token) => {
    const fr = /^(\d*\.?\d+)fr$/.exec(token);
    if (fr) return { px: null, fr: Number(fr[1]) };
    if (token === "auto" || token.startsWith("minmax(") || token.startsWith("fit-content(")) return { px: null, fr: 1 };
    const px = lengthOf(token, env);
    return px === null ? { px: null, fr: 1 } : { px, fr: 0 };
  });
  const fixed = tracks.reduce((sum, t) => sum + (t.px ?? 0), 0);
  const totalFr = tracks.reduce((sum, t) => sum + t.fr, 0);
  const rest = Math.max(0, content - gap * (tracks.length - 1) - fixed);
  return tracks.map((t) => (t.px !== null ? t.px : totalFr > 0 ? (rest * t.fr) / totalFr : 0));
}

/** The widths of a grid's children: each takes its track, or the tracks
    it spans. */
function gridWidths(parent: Element, parentStyle: ElementStyle, content: number, page: Page) {
  const gap = columnGap(parentStyle, content, page);
  const tracks = gridTracks(parentStyle, content, gap, page);
  const widths = new Map<Element, number>();
  let column = 0;
  for (const { el, style } of laidOutChildren(parent, page)) {
    const placement = ownValue(style, "grid-column") ?? "";
    let span = 1;
    const spanMatch = /span\s+(\d+)/.exec(placement);
    if (spanMatch) span = Math.max(1, Math.min(tracks.length, Number(spanMatch[1])));
    else if (/^1\s*\/\s*-1$/.test(placement)) span = tracks.length;
    if (column + span > tracks.length) column = 0;
    let width = 0;
    for (let i = 0; i < span; i++) width += tracks[column + i] ?? 0;
    width += gap * (span - 1);
    column = (column + span) % tracks.length;
    widths.set(el, capWidth(width, style, content, page) ?? width);
  }
  return widths;
}

/** The content width of a box: its width less its horizontal padding. */
function contentWidth(el: Element, style: ElementStyle, page: Page): number | null {
  const width = widthOf(el, page);
  if (width === null) return null;
  const parentPx = el.parentElement ? widthOf(el.parentElement, page) : null;
  if (ownValue(style, "box-sizing") === "content-box" && ownValue(style, "width") !== null) return width;
  return Math.max(0, width - horizontalSpace(style, "padding", parentPx, page));
}

/** An element's laid-out width in pixels, or null when only a browser
    could know. Cached per element. */
function widthOf(el: Element, page: Page): number | null {
  const cached = page.widths.get(el);
  if (cached !== undefined) return cached;
  page.widths.set(el, null); // a cycle answers unknown
  const width = computeWidth(el, page);
  page.widths.set(el, width);
  return width;
}

function computeWidth(el: Element, page: Page): number | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "html") return VIEWPORT_WIDTH;
  const parent = el.parentElement;
  const style = styleOf(el, page);
  if (!parent || !style) return null;
  const parentStyle = styleOf(parent, page);
  if (!parentStyle) return null;
  const content = contentWidth(parent, parentStyle, page);
  const display = displayOf(parentStyle);
  if (content !== null && (display === "flex" || display === "grid")) {
    const widths = display === "flex" ? flexWidths(parent, parentStyle, content, page) : gridWidths(parent, parentStyle, content, page);
    // Every sibling is known now.
    for (const [sibling, width] of widths) if (sibling !== el) page.widths.set(sibling, width);
    const own = widths.get(el);
    if (own !== undefined) return own;
  }
  const own = ownWidth(el, style, content, page);
  if (own !== null) return capWidth(own, style, content, page);
  if (content === null) return null;
  // Inline content sizes to its text, and media to its pixels: unknown.
  // Block boxes fill the parent.
  const displayValue = ownValue(style, "display") ?? (/^(span|a|b|i|em|strong|code|small|label|abbr|cite|q|time|sub|sup|mark|u|s)$/.test(tag) ? "inline" : "block");
  if (displayValue === "inline" || displayValue.startsWith("inline-") || isReplaced(el)) return null;
  return capWidth(Math.max(0, content - horizontalSpace(style, "margin", content, page)), style, content, page);
}

function holdsMedia(el: Element): boolean {
  return /^(img|video|iframe|svg)$/i.test(el.tagName) || el.querySelector("img, video, iframe, svg") !== null;
}

/** A figure row: a flex row or a grid whose laid-out children each hold
    media, with no prose beyond captions. */
function isFigureRow(el: Element, page: Page): boolean {
  const cached = page.rows.get(el);
  if (cached !== undefined) return cached;
  let row = false;
  const style = styleOf(el, page);
  if (style && displayOf(style) !== "block" && textLength(el) <= ROW_TEXT_LIMIT) {
    const children = laidOutChildren(el, page);
    row = children.length >= 2 && children.every(({ el: child }) => holdsMedia(child));
  }
  page.rows.set(el, row);
  return row;
}

/** The width percentage an element gets: its pixels over the wider of the
    text column, itself, and the widest figure row it sits in; null when the
    element is as wide as that or its width is unknown. */
function widthPercent(el: Element, page: Page): number | null {
  const width = widthOf(el, page);
  if (width === null || width <= 0) return null;
  let denominator = Math.max(page.columnPx, width);
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!isFigureRow(node, page)) continue;
    const rowWidth = widthOf(node, page);
    if (rowWidth !== null) denominator = Math.max(denominator, rowWidth);
  }
  const pct = Math.round((100 * width) / denominator);
  // At the full mark the element is as wide as the column; under the
  // minimum it is an icon or a thumbnail, and the reader keeps its own size.
  if (pct >= FULL_WIDTH_PCT || pct < MIN_WIDTH_PCT) return null;
  return pct;
}

/** Every media element, and every column of a figure row, carries its
    width as a percentage of the text column. */
function markWidths(document: Document, page: Page) {
  const media = [...document.body.querySelectorAll("img[src], video, iframe, svg")].filter((el) => {
    if (isHidden(el) || el.parentElement?.closest("svg")) return false;
    return el.tagName.toLowerCase() !== "svg" || isChartSvg(el);
  });
  const rows = new Set<Element>();
  for (const el of media) {
    if (page.budget.styles <= 0) return;
    const pct = widthPercent(el, page);
    if (pct !== null) el.setAttribute("data-width-pct", String(pct));
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (isFigureRow(node, page)) rows.add(node);
    }
  }
  for (const row of rows) {
    for (const { el } of laidOutChildren(row, page)) {
      if (isReplaced(el)) continue;
      const pct = widthPercent(el, page);
      if (pct !== null) el.setAttribute("data-width-pct", String(pct));
    }
  }
}

/** The text column's width: the most common laid-out width among the page's
    prose elements. */
function columnWidth(prose: Element[], page: Page): number {
  const widths: number[] = [];
  for (const el of prose) {
    const width = widthOf(el, page);
    if (width !== null && width > 0) widths.push(Math.round(width));
  }
  return mode(widths) ?? DEFAULT_COLUMN_PX;
}

// ── The bake ────────────────────────────────────────────────────────────────

/** The page's html with the page's look written into its DOM: hidden,
    alignment, style, font-size, and width attributes on its elements, and
    every chart svg and image carrying the page's presentation as inline
    style. The html comes back unchanged when the page has no stylesheet
    and no figure, when its stylesheets will not load, or when anything in
    here fails — a figure without its look is the old behavior, never a
    missing figure. */
export async function bakeFigureStyles(rawHtml: string, url: string): Promise<string> {
  if (!/<(?:svg|img|link|style)[\s>]/i.test(rawHtml)) return rawHtml;
  try {
    // A fresh console with no listener: the page's stylesheets may hold
    // syntax jsdom's parser does not know, and that is not worth a log line.
    const dom = new JSDOM(rawHtml, { url, virtualConsole: new VirtualConsole() });
    const { document } = dom.window;
    if (!document.body) return rawHtml;
    await inlineStylesheets(document, url);
    const rules = collectRules(document);
    const page: Page = {
      index: indexRules(rules),
      rootFontPx: 16,
      decls: new Map(),
      styles: new Map(),
      matched: new Map(),
      widths: new Map(),
      rows: new Map(),
      budget: { styles: STYLE_BUDGET, matches: MATCH_LIMIT },
      columnPx: DEFAULT_COLUMN_PX,
    };
    if (rules.length > 0) {
      markHidden(document, rules, page);
      const prose = proseSample(document);
      page.columnPx = columnWidth(prose, page);
      markFontSizes(document, rules, page, prose);
      markAlignment(document, rules, page);
      markStyles(document, rules, page);
      markWidths(document, page);
    }
    // Figures keep their look: visible charts first, so the budget goes to
    // what the reader sees.
    const budget = { left: PAGE_ELEMENT_LIMIT };
    const svgs = [...document.querySelectorAll("svg")].filter(
      (svg) => svg.isConnected && !svg.parentElement?.closest("svg") && isChartSvg(svg),
    );
    for (const svg of [...svgs.filter((s) => !isHidden(s)), ...svgs.filter(isHidden)]) bakeSvg(svg, page, budget);
    for (const img of [...document.querySelectorAll("img")]) bakeImage(img, page);
    return dom.serialize();
  } catch {
    return rawHtml;
  }
}
