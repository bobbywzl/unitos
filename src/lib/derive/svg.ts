import { JSDOM } from "jsdom";

// Allowlist sanitizer for VISUALIZE output. Runs in the derive route before store;
// stored svg is clean, render trusts it (same trust model as Block.html).
const ALLOWED_TAGS = new Set([
  "svg",
  "g",
  "defs",
  "marker",
  "title",
  "desc",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "lineargradient",
  "radialgradient",
  "stop",
]);

const ALLOWED_ATTRS = new Set([
  "viewBox",
  "xmlns",
  "preserveAspectRatio",
  "role",
  "aria-label",
  "id",
  "transform",
  "opacity",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "d",
  "points",
  "dx",
  "dy",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "font-size",
  "font-family",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "letter-spacing",
  "marker-start",
  "marker-mid",
  "marker-end",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  "markerUnits",
  "gradientUnits",
  "gradientTransform",
  "offset",
  "stop-color",
  "stop-opacity",
]);

// url(#id) is the only url() form allowed: same-document marker and gradient references.
const REFERENCE_VALUE = /^url\(#[a-z0-9_-]+\)$/i;

const DRAWABLE = "rect, circle, ellipse, line, polyline, polygon, path, text";

function scrubAttrs(el: Element) {
  for (const attr of [...el.attributes]) {
    if (!ALLOWED_ATTRS.has(attr.name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    const value = attr.value.toLowerCase();
    if (value.includes("url(") && !REFERENCE_VALUE.test(attr.value.trim())) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (value.includes("javascript:") || value.includes("<")) el.removeAttribute(attr.name);
  }
}

// Returns clean markup, or null when nothing drawable survives.
export function sanitizeSvg(input: string): string | null {
  const dom = new JSDOM(`<body>${input}</body>`);
  const root = dom.window.document.body.querySelector("svg");
  if (!root) return null;

  const walk = (parent: Element) => {
    for (const child of [...parent.children]) {
      const tag = child.tagName.toLowerCase();
      // Nested <svg> is removed too: one root only.
      if (!ALLOWED_TAGS.has(tag) || tag === "svg") {
        child.remove();
        continue;
      }
      scrubAttrs(child);
      walk(child);
    }
  };

  scrubAttrs(root);
  walk(root);

  const viewBox = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/);
  if (viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(Number(n)))) return null;
  // The container scales the svg; viewBox alone controls the aspect ratio.
  root.removeAttribute("width");
  root.removeAttribute("height");
  root.setAttribute("role", "img");

  if (!root.querySelector(DRAWABLE)) return null;
  return root.outerHTML;
}
