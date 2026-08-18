import { JSDOM } from "jsdom";
import { stripCitationTokens } from "@/lib/parse/references";

// Allowlist sanitizer. Runs at ingest time; stored html is clean, render trusts it.
const ALLOWED: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt", "width", "height"]),
  table: new Set([]),
  thead: new Set([]),
  tbody: new Set([]),
  tfoot: new Set([]),
  caption: new Set([]),
  tr: new Set([]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  ul: new Set([]),
  ol: new Set(["start"]),
  li: new Set([]),
  pre: new Set([]),
  code: new Set([]),
  b: new Set([]),
  i: new Set([]),
  em: new Set([]),
  strong: new Set([]),
  sub: new Set([]),
  sup: new Set([]),
  br: new Set([]),
  hr: new Set([]),
  p: new Set([]),
  h1: new Set([]),
  h2: new Set([]),
  h3: new Set([]),
  h4: new Set([]),
  h5: new Set([]),
  h6: new Set([]),
  figure: new Set([]),
  figcaption: new Set([]),
  blockquote: new Set([]),
  span: new Set([]),
  // Video figures: muted loops read like gifs. Sources are resolved to absolute
  // URLs; playback attributes pass through so the page behaves like the original.
  video: new Set(["src", "poster", "autoplay", "loop", "muted", "playsinline", "controls", "preload", "width", "height"]),
  source: new Set(["src", "type"]),
};

const DROP_ENTIRELY = new Set(["script", "style", "iframe", "object", "embed", "noscript", "form", "input", "button", "link", "meta"]);

// Embedded players kept as iframes; anything else is dropped by DROP_ENTIRELY.
const EMBED_HOSTS = new Set(["www.youtube.com", "www.youtube-nocookie.com", "youtube.com", "player.vimeo.com"]);

// ── SVG (inline charts) ─────────────────────────────────────────────────────
// Charts on article pages are inline <svg>. Text extraction turns them into
// tick-label soup; the accurate rendering is the vector itself, sanitized.
const SVG_ELEMENTS = new Set([
  "svg", "g", "path", "line", "polyline", "polygon", "rect", "circle", "ellipse",
  "text", "tspan", "defs", "clippath", "lineargradient", "radialgradient", "stop",
  "marker", "symbol", "use", "title", "desc", "pattern", "mask",
]);
const SVG_ATTRIBUTES = new Set([
  "id", "viewbox", "width", "height", "x", "y", "x1", "x2", "y1", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points", "dx", "dy", "offset",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-dasharray",
  "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-opacity",
  "stroke-miterlimit", "opacity", "transform", "font-size", "font-family",
  "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline",
  "letter-spacing", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "clip-path", "mask", "preserveaspectratio", "vector-effect", "paint-order",
  "patternunits", "markerunits", "markerwidth", "markerheight", "refx", "refy", "orient",
  "xmlns", "style", "href", "xlink:href",
]);

// A url(...) that is not a local #reference can load external resources.
function safeSvgValue(value: string): boolean {
  const urls = value.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
  if (!urls) return true;
  return urls.every((u) => /url\(\s*['"]?#/.test(u));
}

/** Prune one <svg> subtree in place to the SVG allowlist. Returns false when the
    svg cannot be kept safely (contains foreignObject/script content). */
export function sanitizeSvgElement(svg: Element): boolean {
  const walk = (node: Element): boolean => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (!SVG_ELEMENTS.has(tag)) {
        child.remove();
        continue;
      }
      if (!walk(child)) return false;
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (!SVG_ATTRIBUTES.has(name) || name.startsWith("on")) {
        node.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "xlink:href") && !attr.value.trim().startsWith("#")) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (name === "style") {
        if (/expression|@import|javascript:/i.test(attr.value) || !safeSvgValue(attr.value)) {
          node.removeAttribute(attr.name);
        }
        continue;
      }
      if (!safeSvgValue(attr.value)) node.removeAttribute(attr.name);
    }
    return true;
  };
  return walk(svg);
}

export function sanitizeHtml(html: string, baseUrl?: string): string {
  const dom = new JSDOM(`<body>${html}</body>`);
  const document = dom.window.document;

  const resolveUrl = (el: Element, attr: string): boolean => {
    const value = el.getAttribute(attr) ?? "";
    if (!value || /^\s*(javascript|data|blob):/i.test(value)) {
      el.removeAttribute(attr);
      return false;
    }
    if (baseUrl) {
      try {
        el.setAttribute(attr, new URL(value, baseUrl).toString());
      } catch {
        el.removeAttribute(attr);
        return false;
      }
    }
    return true;
  };

  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
      if (tag === "svg") {
        if (!sanitizeSvgElement(child)) child.remove();
        continue;
      }
      if (tag === "iframe") {
        // Keep only known players; everything else drops with DROP_ENTIRELY.
        const src = child.getAttribute("src") ?? "";
        let keep = false;
        try {
          const parsed = new URL(src, baseUrl);
          keep = parsed.protocol === "https:" && EMBED_HOSTS.has(parsed.hostname);
          if (keep) {
            for (const attr of [...child.attributes]) {
              if (!["src", "title", "allowfullscreen", "width", "height"].includes(attr.name.toLowerCase())) {
                child.removeAttribute(attr.name);
              }
            }
            child.setAttribute("src", parsed.toString());
            child.setAttribute("loading", "lazy");
            child.setAttribute("referrerpolicy", "no-referrer");
          }
        } catch {
          keep = false;
        }
        if (!keep) child.remove();
        continue;
      }
      if (DROP_ENTIRELY.has(tag)) {
        child.remove();
        continue;
      }
      walk(child);
      if (!(tag in ALLOWED)) {
        // Unwrap: keep children, drop the element.
        child.replaceWith(...child.childNodes);
        continue;
      }
      const allowed = ALLOWED[tag];
      for (const attr of [...child.attributes]) {
        if (!allowed.has(attr.name)) child.removeAttribute(attr.name);
      }
      if (tag === "a") {
        const href = child.getAttribute("href") ?? "";
        if (/^\s*javascript:/i.test(href)) child.removeAttribute("href");
        else if (baseUrl && href) {
          try {
            child.setAttribute("href", new URL(href, baseUrl).toString());
          } catch {
            child.removeAttribute("href");
          }
        }
        child.setAttribute("rel", "noopener noreferrer");
        child.setAttribute("target", "_blank");
      }
      if (tag === "img" || tag === "source") {
        if (!resolveUrl(child, "src")) {
          child.remove();
          continue;
        }
      }
      if (tag === "video") {
        const hasSrc = resolveUrl(child, "src");
        if (child.getAttribute("poster")) resolveUrl(child, "poster");
        if (!hasSrc && !child.querySelector("source[src]")) {
          child.remove();
          continue;
        }
        // Never autoplay with sound; the reader is a library, not a billboard.
        child.setAttribute("muted", "");
        if (!child.hasAttribute("autoplay")) child.setAttribute("controls", "");
        child.setAttribute("preload", "metadata");
        child.setAttribute("playsinline", "");
      }
    }
  };
  walk(document.body);
  // Citation sentinel tokens belong in block text, never in stored html.
  return stripCitationTokens(document.body.innerHTML);
}
