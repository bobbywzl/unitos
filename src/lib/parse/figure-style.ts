import { JSDOM, VirtualConsole } from "jsdom";
import { outboundFetch } from "@/lib/outbound-fetch";

// Figures keep their look (SPEC.md §2). An inline chart's colors, fonts, and
// backdrop come from the page's stylesheets, and the stored html never sees
// those: the sanitizer drops class names and <style> blocks, and the reader
// draws the chart on its own paper. A dark site's white-line diagram came out
// as faint lines on white with its labels gone (reader report). So before the
// walk, the page's stylesheets load, every inline svg gets the page's
// presentation written into its elements as inline style, and every figure
// image and svg gets the backdrop the page drew behind it.

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

type Decl = { value: string; weight: number };
type Decls = Map<string, Decl>;
type Selector = { text: string; specificity: number };
type Rule = { selectors: Selector[]; style: CSSStyleDeclaration; order: number };

type ElementStyle = {
  decls: Decls;
  // Resolved inherited values, parent first: currentColor, em sizes, and
  // custom properties read through these.
  color: string;
  fontSize: number;
  // The element's own font-size declaration resolved to pixels; null when it
  // has none, or one that only the browser can resolve (calc, clamp).
  fontSizePx: number | null;
  custom: (name: string) => string | null;
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

/** Fetch the page's linked stylesheets and put each in place as a <style>,
    so the cascade order stays the page's. A sheet that will not load is
    dropped. */
async function inlineStylesheets(document: Document, baseUrl: string): Promise<void> {
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
      style.textContent = media && media.toLowerCase() !== "all" ? `@media ${media} { ${text} }` : text;
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
  const s = selector.replace(/\([^)]*\)/g, "()").replace(/\[[^\]]*\]/g, "[]");
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (s.match(/\.[\w-]+/g) ?? []).length +
    (s.match(/\[\]/g) ?? []).length +
    (s.match(/:(?!:)[\w-]+/g) ?? []).length;
  const types = (s.match(/(?:^|[\s>+~(])[a-zA-Z][\w-]*/g) ?? []).length + (s.match(/::[\w-]+/g) ?? []).length;
  return ids * 10_000 + classes * 100 + types;
}

type RuleLike = {
  selectorText?: string;
  style?: CSSStyleDeclaration;
  cssRules?: CSSRuleList;
  media?: { mediaText?: string } | string;
  conditionText?: string;
};

function collectRules(document: Document): Rule[] {
  const rules: Rule[] = [];
  let order = 0;
  const visit = (list: CSSRuleList) => {
    for (const rule of Array.from(list) as unknown as RuleLike[]) {
      if (typeof rule.selectorText === "string" && rule.style) {
        const selectors = splitSelectors(rule.selectorText).map((text) => ({
          text,
          specificity: specificityOf(text),
        }));
        if (selectors.length > 0) rules.push({ selectors, style: rule.style, order: order++ });
        continue;
      }
      if (rule.media !== undefined) {
        const mediaText = typeof rule.media === "string" ? rule.media : (rule.media.mediaText ?? "");
        if (mediaMatches(mediaText) && rule.cssRules) visit(rule.cssRules);
        continue;
      }
      // @supports, @layer, and the like: their rules apply.
      if (rule.cssRules) visit(rule.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      // a sheet that would not parse contributes nothing
    }
  }
  return rules;
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
    const weight = baseWeight + (important ? 1e12 : 0);
    const existing = decls.get(prop);
    if (!existing || weight >= existing.weight) decls.set(prop, { value: value.trim(), weight });
  }
}

/** The tokens a selector's last compound must find on an element: the tag,
    the classes, the id. Nothing → matches anything. */
function lastCompound(selector: string): { tag: string | null; classes: string[]; id: string | null } | null {
  const blanked = selector.replace(/\([^)]*\)/g, "()").replace(/\[[^\]]*\]/g, "[]");
  const compounds = blanked.split(/\s*[\s>+~]\s*/).filter(Boolean);
  const last = compounds[compounds.length - 1];
  if (!last) return null;
  const tag = /^([a-zA-Z][\w-]*|\*)/.exec(last)?.[1] ?? null;
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const id = /#([\w-]+)/.exec(last)?.[1] ?? null;
  return { tag: tag && tag !== "*" ? tag.toLowerCase() : null, classes, id };
}

type Tokens = { tags: Set<string>; classes: Set<string>; ids: Set<string> };

function tokensOf(elements: Element[]): Tokens {
  const tokens: Tokens = { tags: new Set(), classes: new Set(), ids: new Set() };
  for (const el of elements) {
    tokens.tags.add(el.tagName.toLowerCase());
    const cls = el.getAttribute("class");
    if (cls) for (const c of cls.split(/\s+/)) if (c) tokens.classes.add(c);
    const id = el.getAttribute("id");
    if (id) tokens.ids.add(id);
  }
  return tokens;
}

function couldMatch(selector: string, tokens: Tokens): boolean {
  const last = lastCompound(selector);
  if (!last) return false;
  if (last.tag && !tokens.tags.has(last.tag)) return false;
  if (last.id && !tokens.ids.has(last.id)) return false;
  return last.classes.every((c) => tokens.classes.has(c));
}

const INLINE_WEIGHT = 1e10;

/** Every element of a subtree with its cascaded declarations: the sheets'
    rules matched once per selector over the subtree, then inline style. */
function cascadeSubtree(root: Element, rules: Rule[]): Map<Element, Decls> {
  const elements = [root, ...root.querySelectorAll("*")];
  const byElement = new Map<Element, Decls>(elements.map((el) => [el, new Map()]));
  const tokens = tokensOf(elements);
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!couldMatch(selector.text, tokens)) continue;
      let matched: Element[];
      try {
        matched = [...root.querySelectorAll(selector.text)];
        if (root.matches(selector.text)) matched.push(root);
      } catch {
        continue; // a selector the matcher does not know
      }
      for (const el of matched) {
        const decls = byElement.get(el);
        if (decls) addDeclarations(decls, rule.style, selector.specificity * 1e5 + rule.order);
      }
    }
  }
  for (const el of elements) {
    const inline = (el as HTMLElement).style;
    if (inline && inline.length > 0) addDeclarations(byElement.get(el)!, inline, INLINE_WEIGHT);
  }
  return byElement;
}

/** One element's cascaded declarations, for the ancestors of a figure. */
function cascadeElement(el: Element, rules: Rule[]): Decls {
  const decls: Decls = new Map();
  const tokens = tokensOf([el]);
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!couldMatch(selector.text, tokens)) continue;
      try {
        if (!el.matches(selector.text)) continue;
      } catch {
        continue;
      }
      addDeclarations(decls, rule.style, selector.specificity * 1e5 + rule.order);
    }
  }
  const inline = (el as HTMLElement).style;
  if (inline && inline.length > 0) addDeclarations(decls, inline, INLINE_WEIGHT);
  return decls;
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

// ── Inheritance down a chain of elements ────────────────────────────────────

function customLookup(chain: Decls[]): (name: string) => string | null {
  return (name) => {
    for (const decls of chain) {
      const found = decls.get(name);
      if (found) return found.value;
    }
    return null;
  };
}

function resolveFontSize(value: string, parentPx: number): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(px|em|rem|%|pt)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  switch ((m[2] ?? "px").toLowerCase()) {
    case "px":
      return n;
    case "pt":
      return n * (4 / 3);
    case "rem":
      return n * 16;
    case "em":
      return n * parentPx;
    case "%":
      return (n / 100) * parentPx;
    default:
      return null;
  }
}

/** The style an element resolves to, given its parent's: colors through
    currentColor, font sizes through em, custom properties up the chain. */
function resolveElement(decls: Decls, parent: ElementStyle | null, chain: Decls[]): ElementStyle {
  const custom = customLookup(chain);
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
    fontSizePx = resolved ? resolveFontSize(resolved, parentFontSize) : null;
    if (fontSizePx !== null) fontSize = fontSizePx;
  }
  return { decls, color, fontSize, fontSizePx, custom };
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

// ── The bake ────────────────────────────────────────────────────────────────

/** An svg that is a chart, not an icon: it has text, or enough shapes at a
    real width. */
export function isChartSvg(svg: Element): boolean {
  if (svg.querySelector("text")) return true;
  const shapes = svg.querySelectorAll("path, rect, circle, line, polyline, polygon").length;
  const viewBox = svg.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const width = viewBox?.[2] ?? Number(svg.getAttribute("width") ?? 0);
  return shapes > 6 && width > 100;
}

type Page = { rules: Rule[]; ancestorStyles: Map<Element, ElementStyle>; ancestorDecls: Map<Element, Decls> };

/** The resolved styles of an element's ancestors, outermost first, cached
    across the figures of one page. */
function ancestorChain(el: Element, page: Page): { el: Element; style: ElementStyle }[] {
  const ancestors: Element[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) ancestors.unshift(node);
  const chain: { el: Element; style: ElementStyle }[] = [];
  const declsChain: Decls[] = [];
  let parent: ElementStyle | null = null;
  for (const ancestor of ancestors) {
    let decls = page.ancestorDecls.get(ancestor);
    if (!decls) {
      decls = cascadeElement(ancestor, page.rules);
      page.ancestorDecls.set(ancestor, decls);
    }
    declsChain.unshift(decls);
    let style = page.ancestorStyles.get(ancestor);
    if (!style) {
      style = resolveElement(decls, parent, [...declsChain]);
      page.ancestorStyles.set(ancestor, style);
    }
    chain.push({ el: ancestor, style });
    parent = style;
  }
  return chain;
}

function bakeSvg(svg: Element, page: Page, budget: { left: number }) {
  const chain = ancestorChain(svg, page);
  const parentStyle = chain[chain.length - 1]?.style ?? null;
  const byElement = cascadeSubtree(svg, page.rules);
  if (byElement.size > SVG_ELEMENT_LIMIT || byElement.size > budget.left) return;
  budget.left -= byElement.size;
  const styles = new Map<Element, ElementStyle>();
  // Custom properties read up through the page: the svg's chain of
  // declarations, then its ancestors'.
  const ancestorDecls = chain.map((c) => c.style.decls).reverse();
  const resolveTree = (el: Element, parent: ElementStyle | null, parentChain: Decls[]) => {
    const decls = byElement.get(el) ?? new Map<string, Decl>();
    const ownChain = [decls, ...parentChain];
    const style = resolveElement(decls, parent, [...ownChain, ...ancestorDecls]);
    styles.set(el, style);
    for (const child of el.children) resolveTree(child, style, ownChain);
  };
  resolveTree(svg, parentStyle, []);

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
  const decls = cascadeElement(img, page.rules);
  const style = resolveElement(decls, chain[chain.length - 1]?.style ?? null, [decls, ...chain.map((c) => c.style.decls).reverse()]);
  const backdrop = backdropOf([{ el: img, style }, ...[...chain].reverse()]);
  if (!backdrop) return;
  // The sanitizer turns this into the image's inline background.
  img.setAttribute("data-backdrop", backdrop.background);
}

/** The page's html with every chart svg and every image carrying the page's
    presentation as inline style. The html comes back unchanged when the page
    has no figures, when its stylesheets will not load, or when anything in
    here fails — a figure without its look is the old behavior, never a
    missing figure. */
export async function bakeFigureStyles(rawHtml: string, url: string): Promise<string> {
  if (!/<(?:svg|img)[\s>]/i.test(rawHtml)) return rawHtml;
  try {
    // A fresh console with no listener: the page's stylesheets may hold
    // syntax jsdom's parser does not know, and that is not worth a log line.
    const dom = new JSDOM(rawHtml, { url, virtualConsole: new VirtualConsole() });
    const { document } = dom.window;
    await inlineStylesheets(document, url);
    const page: Page = { rules: collectRules(document), ancestorStyles: new Map(), ancestorDecls: new Map() };
    const budget = { left: PAGE_ELEMENT_LIMIT };
    for (const svg of [...document.querySelectorAll("svg")]) {
      if (!svg.isConnected || svg.parentElement?.closest("svg")) continue;
      if (!isChartSvg(svg)) continue;
      bakeSvg(svg, page, budget);
    }
    for (const img of [...document.querySelectorAll("img")]) bakeImage(img, page);
    return dom.serialize();
  } catch {
    return rawHtml;
  }
}
