import { JSDOM } from "jsdom";
import { z } from "zod";
import { imageUrl } from "@/lib/images";

// VISUALIZE (SPEC.md §20, Unitos Ultra): the model's output contract, the
// diagram layout, and the SVG the reader sees. A diagram arrives as nodes and
// edges and is laid out here with measured text, so no label overflows; a
// picture or an animation arrives as SVG source and is reduced to the
// elements and attributes the prompt allows before it is stored. Either way
// the result is one SVG ImageAsset the annotation's markdown points at.

// ── Output contract ────────────────────────────────────────────────────────

const nodeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  detail: z.string().max(240).nullish(),
});

const edgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  label: z.string().max(80).nullish(),
});

export const diagramSchema = z.object({
  direction: z.enum(["right", "down"]).default("right"),
  nodes: z.array(nodeSchema).min(2).max(16),
  edges: z.array(edgeSchema).max(48),
});

export const visualizeOutputSchema = z.object({
  judgment: z.object({
    structure: z.string().max(600).default(""),
    certain: z.boolean(),
    reason: z.string().min(1).max(1200),
  }),
  visual: z
    .object({
      kind: z.enum(["diagram", "picture", "animation"]),
      caption: z.string().min(1).max(400),
      diagram: diagramSchema.nullish(),
      svg: z.string().max(400_000).nullish(),
    })
    .nullable(),
});

export type VisualizeOutput = z.infer<typeof visualizeOutputSchema>;
export type Visual = NonNullable<VisualizeOutput["visual"]>;
export type Diagram = z.infer<typeof diagramSchema>;

/** The annotation's markdown: the image, then the caption under it. */
export function visualizationMarkdown(imageId: string, caption: string): string {
  const alt = caption.replace(/[[\]\n]/g, " ").trim();
  return `![${alt}](${imageUrl(imageId)})\n\n*${caption.replace(/\n+/g, " ").trim()}*`;
}

/** The SVG of one visual: laid out for a diagram, reduced for a picture or
    an animation. error: what made it unusable, for the reader's card. */
export async function renderVisual(visual: Visual): Promise<{ svg: string } | { error: string }> {
  if (visual.kind === "diagram") {
    if (!visual.diagram) return { error: "The diagram has no nodes." };
    return { svg: await renderDiagram(visual.diagram) };
  }
  if (!visual.svg) return { error: "The picture has no SVG." };
  return sanitizeSvg(visual.svg);
}

// ── Text measurement ───────────────────────────────────────────────────────

type Measure = (text: string, size: number, bold: boolean) => number;

// A CJK character is as wide as the font size; a Latin one about half.
function estimate(text: string, size: number): number {
  let width = 0;
  for (const ch of text) width += ch.codePointAt(0)! >= 0x2e80 ? size : size * 0.56;
  return width;
}

// @napi-rs/canvas measures with its own font, and the reader draws the SVG
// with the system font, so every measure carries a margin. Without the
// canvas (a build without native modules) the estimate stands.
async function measurer(): Promise<Measure> {
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const ctx = createCanvas(4, 4).getContext("2d");
    return (text, size, bold) => {
      ctx.font = `${bold ? "bold " : ""}${size}px sans-serif`;
      const width = ctx.measureText(text).width;
      return Math.max(width, estimate(text, size) * 0.8) * 1.12;
    };
  } catch {
    return (text, size) => estimate(text, size) * 1.05;
  }
}

/** Lines of `text` no wider than `maxWidth`: word by word, and character by
    character when a word (or a run of CJK) is wider than the line. */
function wrap(text: string, size: number, bold: boolean, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  const pushWord = (line: string, word: string): string => {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size, bold) <= maxWidth) return candidate;
    if (line) lines.push(line);
    if (measure(word, size, bold) <= maxWidth) return word;
    // Too wide alone: cut by characters.
    let run = "";
    for (const ch of word) {
      if (measure(run + ch, size, bold) > maxWidth && run) {
        lines.push(run);
        run = ch;
      } else {
        run += ch;
      }
    }
    return run;
  };
  for (const paragraph of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (!paragraph) continue;
    const last = lines.length ? lines.pop()! : "";
    const next = pushWord(last, paragraph);
    if (next) lines.push(next);
  }
  return lines.length ? lines : [""];
}

// ── Diagram layout ─────────────────────────────────────────────────────────

const LABEL_SIZE = 15;
const DETAIL_SIZE = 12;
const LABEL_LINE = 19;
const DETAIL_LINE = 15;
const EDGE_SIZE = 12;
const PAD_X = 14;
const PAD_Y = 10;
const MAX_TEXT = 190;
const MIN_WIDTH = 90;
const GAP = 28; // between nodes of one rank
const RANK_GAP = 84; // between ranks
const MARGIN = 24;
const BACK_LIFT = 64; // how far a back edge arcs outside the nodes

const INK = "#2b2622";
const MUTED = "#6b625a";
const FILL = "#f3ede4";
const ACCENT = "#b5563c";

type Box = {
  id: string;
  label: string[];
  detail: string[];
  w: number;
  h: number;
  x: number;
  y: number;
  rank: number;
};

type Edge = { from: string; to: string; label: string | null; back: boolean };

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Ranks by longest path over the forward edges; a DFS marks the edges that
    close a cycle as back edges so the layering ends. */
function layer(ids: string[], edges: Edge[]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const state = new Map<string, 0 | 1 | 2>();
  const index = new Map(ids.map((id, i) => [id, i]));
  for (const e of edges) out.get(e.from)!.push(e.to);
  const byPair = new Map(edges.map((e) => [`${e.from}>${e.to}`, e]));
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id)!) {
      const s = state.get(to) ?? 0;
      if (s === 1) byPair.get(`${id}>${to}`)!.back = true;
      else if (s === 0) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);

  const rank = new Map(ids.map((id) => [id, 0]));
  const forward = edges.filter((e) => !e.back);
  // n ≤ 16: relax until stable.
  for (let pass = 0; pass < ids.length + 1; pass++) {
    let moved = false;
    for (const e of forward) {
      const r = rank.get(e.from)! + 1;
      if (r > rank.get(e.to)!) {
        rank.set(e.to, r);
        moved = true;
      }
    }
    if (!moved) break;
  }
  // A node nobody points at and that points at nothing sits at rank 0 with
  // the sources; its index keeps the model's order.
  void index;
  return rank;
}

/** The diagram as SVG. The model picks the direction; when that reads as a
    strip too wide for the card (a long chain laid out left to right), the
    other direction stands in, so the picture is legible at card width. */
export async function renderDiagram(diagram: Diagram): Promise<string> {
  const measure = await measurer();
  const right = diagram.direction === "right";
  let drawn = drawDiagram(diagram, right, measure);
  if (drawn.width > drawn.height * 1.6) {
    const flipped = drawDiagram(diagram, !right, measure);
    if (flipped.width / flipped.height < drawn.width / drawn.height) drawn = flipped;
  }
  return drawn.svg;
}

function drawDiagram(
  diagram: Diagram,
  right: boolean,
  measure: Measure,
): { svg: string; width: number; height: number } {
  const seen = new Set<string>();
  const nodes = diagram.nodes.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
  const ids = nodes.map((n) => n.id);
  const edgeSeen = new Set<string>();
  const edges: Edge[] = diagram.edges
    .filter((e) => seen.has(e.from) && seen.has(e.to) && e.from !== e.to)
    .filter((e) => {
      const key = `${e.from}>${e.to}`;
      if (edgeSeen.has(key)) return false;
      edgeSeen.add(key);
      return true;
    })
    .map((e) => ({ from: e.from, to: e.to, label: e.label?.trim() || null, back: false }));

  const rank = layer(ids, edges);
  const boxes: Box[] = nodes.map((n) => {
    const label = wrap(n.label, LABEL_SIZE, true, MAX_TEXT, measure);
    const detail = n.detail?.trim() ? wrap(n.detail, DETAIL_SIZE, false, MAX_TEXT, measure) : [];
    const textW = Math.max(
      ...label.map((l) => measure(l, LABEL_SIZE, true)),
      ...detail.map((l) => measure(l, DETAIL_SIZE, false)),
    );
    return {
      id: n.id,
      label,
      detail,
      w: Math.max(MIN_WIDTH, Math.ceil(textW) + PAD_X * 2),
      h: label.length * LABEL_LINE + detail.length * DETAIL_LINE + (detail.length ? 4 : 0) + PAD_Y * 2,
      x: 0,
      y: 0,
      rank: rank.get(n.id)!,
    };
  });
  const byId = new Map(boxes.map((b) => [b.id, b]));

  // Ranks, in order; within a rank, by the mean position of the forward
  // predecessors (one barycenter pass), the model's order breaking ties.
  const rankCount = Math.max(...boxes.map((b) => b.rank)) + 1;
  const ranks: Box[][] = Array.from({ length: rankCount }, () => []);
  for (const b of boxes) ranks[b.rank].push(b);
  const position = new Map<string, number>();
  ranks[0].forEach((b, i) => position.set(b.id, i));
  for (let r = 1; r < rankCount; r++) {
    const key = (b: Box) => {
      const preds = edges.filter((e) => !e.back && e.to === b.id).map((e) => position.get(e.from) ?? 0);
      return preds.length ? preds.reduce((a, c) => a + c, 0) / preds.length : Number.MAX_SAFE_INTEGER;
    };
    ranks[r] = ranks[r]
      .map((b, i) => ({ b, i, k: key(b) }))
      .sort((a, c) => a.k - c.k || a.i - c.i)
      .map((x) => x.b);
    ranks[r].forEach((b, i) => position.set(b.id, i));
  }

  // Coordinates: along = the rank axis, across = the stacking axis.
  const along = (b: Box) => (right ? b.w : b.h);
  const across = (b: Box) => (right ? b.h : b.w);
  const rankSize = ranks.map((r) => Math.max(...r.map(along)));
  const rankSpan = ranks.map((r) => r.reduce((s, b) => s + across(b), 0) + GAP * (r.length - 1));
  const maxSpan = Math.max(...rankSpan);
  const hasBack = edges.some((e) => e.back);
  const lift = hasBack ? BACK_LIFT : 0;
  let alongAt = MARGIN;
  ranks.forEach((r, i) => {
    let acrossAt = MARGIN + lift + (maxSpan - rankSpan[i]) / 2;
    for (const b of r) {
      const centered = alongAt + (rankSize[i] - along(b)) / 2;
      if (right) {
        b.x = centered;
        b.y = acrossAt;
      } else {
        b.y = centered;
        b.x = acrossAt;
      }
      acrossAt += across(b) + GAP;
    }
    alongAt += rankSize[i] + RANK_GAP;
  });
  const total = alongAt - RANK_GAP + MARGIN;
  const width = right ? total : MARGIN * 2 + lift + maxSpan;
  const height = right ? MARGIN * 2 + lift + maxSpan : total;

  // Edges: a cubic curve between the facing sides; a back edge arcs over the
  // top (or the left) so it never crosses the nodes it passes.
  const paths: string[] = [];
  const labels: string[] = [];
  for (const e of edges) {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    let d: string;
    let mx: number;
    let my: number;
    if (!e.back) {
      const x1 = right ? a.x + a.w : a.x + a.w / 2;
      const y1 = right ? a.y + a.h / 2 : a.y + a.h;
      const x2 = right ? b.x : b.x + b.w / 2;
      const y2 = right ? b.y + b.h / 2 : b.y;
      const c1x = right ? x1 + RANK_GAP / 2 : x1;
      const c1y = right ? y1 : y1 + RANK_GAP / 2;
      const c2x = right ? x2 - RANK_GAP / 2 : x2;
      const c2y = right ? y2 : y2 - RANK_GAP / 2;
      d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
      mx = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
      my = (y1 + 3 * c1y + 3 * c2y + y2) / 8;
    } else {
      const x1 = right ? a.x + a.w / 2 : a.x;
      const y1 = right ? a.y : a.y + a.h / 2;
      const x2 = right ? b.x + b.w / 2 : b.x;
      const y2 = right ? b.y : b.y + b.h / 2;
      const c1x = right ? x1 : x1 - BACK_LIFT;
      const c1y = right ? y1 - BACK_LIFT : y1;
      const c2x = right ? x2 : x2 - BACK_LIFT;
      const c2y = right ? y2 - BACK_LIFT : y2;
      d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
      mx = (x1 + 3 * c1x + 3 * c2x + x2) / 8;
      my = (y1 + 3 * c1y + 3 * c2y + y2) / 8;
    }
    paths.push(
      `<path d="${d}" fill="none" stroke="${e.back ? ACCENT : INK}" stroke-width="2" marker-end="url(#arrow${e.back ? "-back" : ""})"/>`,
    );
    if (e.label) {
      const lines = wrap(e.label, EDGE_SIZE, false, 120, measure);
      const lw = Math.max(...lines.map((l) => measure(l, EDGE_SIZE, false))) + 10;
      const lh = lines.length * 15 + 4;
      labels.push(
        `<rect x="${(mx - lw / 2).toFixed(1)}" y="${(my - lh / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh}" rx="4" fill="#ffffff" stroke="#e5ddd0" stroke-width="1"/>`,
        ...lines.map(
          (l, i) =>
            `<text x="${mx.toFixed(1)}" y="${(my - lh / 2 + 2 + (i + 1) * 15 - 4).toFixed(1)}" font-size="${EDGE_SIZE}" fill="${MUTED}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(l)}</text>`,
        ),
      );
    }
  }

  const nodeMarkup = boxes.map((b) => {
    const lines: string[] = [];
    let y = b.y + PAD_Y + LABEL_SIZE - 1;
    for (const l of b.label) {
      lines.push(
        `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${y.toFixed(1)}" font-size="${LABEL_SIZE}" font-weight="700" fill="${INK}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(l)}</text>`,
      );
      y += LABEL_LINE;
    }
    y += b.detail.length ? 4 - (LABEL_LINE - DETAIL_LINE) : 0;
    for (const l of b.detail) {
      lines.push(
        `<text x="${(b.x + b.w / 2).toFixed(1)}" y="${y.toFixed(1)}" font-size="${DETAIL_SIZE}" fill="${MUTED}" text-anchor="middle" font-family="system-ui, sans-serif">${escapeXml(l)}</text>`,
      );
      y += DETAIL_LINE;
    }
    return (
      `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.w}" height="${b.h}" rx="10" fill="${FILL}" stroke="${b.rank === 0 ? ACCENT : INK}" stroke-width="1.5"/>` +
      lines.join("")
    );
  });

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" role="img">`,
    `<defs>`,
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker>`,
    `<marker id="arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${ACCENT}"/></marker>`,
    `</defs>`,
    `<rect x="0" y="0" width="${Math.ceil(width)}" height="${Math.ceil(height)}" fill="#ffffff"/>`,
    ...paths,
    ...nodeMarkup,
    ...labels,
    `</svg>`,
  ].join("");
  return { svg, width, height };
}

// ── Picture and animation: the model's SVG, reduced ────────────────────────

const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "title",
  "desc",
  "defs",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "animate",
  "animateTransform",
  "animateMotion",
  "mpath",
  "set",
]);

const MAX_SVG_BYTES = 300_000;

/** The model's SVG with only the allowed elements and attributes left: no
    script, no foreign content, no external reference, no event handler. The
    root keeps its viewBox and loses width and height, so the card scales it. */
export function sanitizeSvg(source: string): { svg: string } | { error: string } {
  const text = source.trim();
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return { error: "The output is not an SVG." };
  const dom = new JSDOM("");
  const { DOMParser, XMLSerializer } = dom.window;
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    return { error: "The SVG is not well-formed." };
  }
  const root = doc.documentElement;
  if (root.localName !== "svg") return { error: "The output is not an SVG." };
  if (!root.getAttribute("viewBox")) return { error: "The SVG has no viewBox." };

  const clean = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED_ELEMENTS.has(child.localName)) {
        // A link or a switch keeps what it wraps; anything else goes whole.
        if (child.localName === "a" || child.localName === "switch") {
          child.replaceWith(...Array.from(child.childNodes));
          clean(el);
          return;
        }
        child.remove();
        continue;
      }
      clean(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const drop =
        name.startsWith("on") ||
        ((name === "href" || name.endsWith(":href")) && !value.startsWith("#")) ||
        (name === "style" && /url\s*\(|expression|@import/i.test(value)) ||
        /javascript:|data:/i.test(value);
      if (drop) el.removeAttribute(attr.name);
    }
  };
  clean(root);
  root.removeAttribute("width");
  root.removeAttribute("height");
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const svg = new XMLSerializer().serializeToString(root);
  if (svg.length > MAX_SVG_BYTES) return { error: "The SVG is too large." };
  if (root.children.length === 0) return { error: "The SVG is empty." };
  return { svg };
}
