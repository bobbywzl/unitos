import { JSDOM } from "jsdom";

// Allowlist sanitizer. Runs at ingest time; stored html is clean, render trusts it.
const ALLOWED: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["src", "alt"]),
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
};

const DROP_ENTIRELY = new Set(["script", "style", "iframe", "object", "embed", "noscript", "svg", "form", "input", "button", "link", "meta"]);

export function sanitizeHtml(html: string, baseUrl?: string): string {
  const dom = new JSDOM(`<body>${html}</body>`);
  const document = dom.window.document;

  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase();
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
      if (tag === "img") {
        const src = child.getAttribute("src") ?? "";
        if (!src || /^\s*javascript:/i.test(src)) {
          child.remove();
          continue;
        }
        if (baseUrl) {
          try {
            child.setAttribute("src", new URL(src, baseUrl).toString());
          } catch {
            child.remove();
          }
        }
      }
    }
  };
  walk(document.body);
  return document.body.innerHTML;
}
