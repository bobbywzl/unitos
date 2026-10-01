// The picture as the reader sees it: each SVG drawn in Chromium at the card's
// width (320 px, at 2x), a filmstrip of four moments for a picture that
// moves, and the mechanical findings on what was drawn — text that overlaps
// text, anything outside the frame, text too small to read at the card's
// width, a text line past 36 characters, a color off the palette.
import { chromium, type Browser, type Page } from "playwright-core";

const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
export const CARD_WIDTH = 320;
// The moments of the 8-second loop the filmstrip shows.
export const FRAME_TIMES = [0, 2, 4, 6];

// The palette the prompt gives and the server draws with (lib/derive/visual-palette.ts).
const PALETTE = new Set([
  "#2b2622", "#6b625a", "#f3ede4", "#b5563c", "#ffffff", "#e5ddd0", "#5f7d5a", "#b8912e", "#6b5b95",
]);

export type Lint = {
  viewBox: string;
  heightAtCard: number;
  textRuns: number;
  // The smallest text as drawn at the card's width, in CSS px.
  minTextPx: number | null;
  overlaps: string[];
  outside: string[];
  smallText: string[];
  longLines: string[];
  offPalette: string[];
  animated: number;
  bytes: number;
};

export async function openBrowser(): Promise<Browser> {
  return chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}

const PAGE_CSS = "html,body{margin:0;background:#ffffff}#w{width:320px}#w svg{display:block;width:100%;height:auto}";

async function load(page: Page, html: string): Promise<void> {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body>${html}</body></html>`);
  // tsx names every function it compiles with a __name helper the page does
  // not have; a string defines it before any compiled function runs there.
  await page.evaluate("window.__name = (f) => f; document.fonts.ready");
}

/** Draws `svg` at the card's width to `png` (and, when it moves, four frames
    to `frames`), and returns the mechanical findings. */
export async function rasterize(
  browser: Browser,
  svg: string,
  out: { png: string; frames?: string },
  opts: { modelDrawn: boolean },
): Promise<Lint> {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  try {
    await load(page, `<div id="w">${svg}</div>`);
    const lint = await page.evaluate(
      ({ palette, modelDrawn }) => {
        const root = document.querySelector("#w svg") as SVGSVGElement;
        const animated = root.querySelectorAll("animate, animateTransform, animateMotion, set").length;
        root.pauseAnimations();
        root.setCurrentTime(0);
        const frame = root.getBoundingClientRect();
        const vb = root.viewBox.baseVal;
        const scale = frame.width / (vb && vb.width ? vb.width : frame.width);
        const visible = (el: Element): boolean => {
          for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
          }
          return true;
        };
        // Text runs: a tspan with words, or a text element without tspans.
        type Run = { text: string; rect: DOMRect; px: number };
        const runs: Run[] = [];
        for (const t of Array.from(root.querySelectorAll("text"))) {
          const spans = Array.from(t.querySelectorAll("tspan")).filter((s) => (s.textContent ?? "").trim());
          const items: Element[] = spans.length > 0 ? spans : [t];
          for (const it of items) {
            const text = (it.textContent ?? "").trim();
            if (!text || !visible(it)) continue;
            const rect = it.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            const px = parseFloat(getComputedStyle(it).fontSize) * scale;
            runs.push({ text, rect, px });
          }
        }
        const cut = (s: string) => (s.length > 40 ? `${s.slice(0, 37)}…` : s);
        const overlaps: string[] = [];
        for (let i = 0; i < runs.length; i++) {
          for (let j = i + 1; j < runs.length; j++) {
            const a = runs[i].rect;
            const b = runs[j].rect;
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w <= 0 || h <= 0) continue;
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            if (w * h > 0.2 * smaller && w * h > 4) overlaps.push(`"${cut(runs[i].text)}" × "${cut(runs[j].text)}"`);
          }
        }
        const outside: string[] = [];
        for (const el of Array.from(root.querySelectorAll("text, rect, circle, ellipse, line, polyline, polygon, path"))) {
          if (!visible(el) || el.closest("defs, clipPath, marker")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          const over = Math.max(frame.left - r.left, r.right - frame.right, frame.top - r.top, r.bottom - frame.bottom);
          if (over > 2) {
            const label = el.localName === "text" ? `text "${cut((el.textContent ?? "").trim())}"` : el.localName;
            outside.push(`${label} by ${Math.round(over)} px`);
          }
        }
        const smallText = runs.filter((r) => r.px < 9).map((r) => `"${cut(r.text)}" at ${r.px.toFixed(1)} px`);
        const longLines = modelDrawn ? runs.filter((r) => [...r.text].length > 36).map((r) => `"${cut(r.text)}" (${[...r.text].length} chars)`) : [];
        const off = new Set<string>();
        for (const el of Array.from(root.querySelectorAll("*"))) {
          for (const name of ["fill", "stroke", "stop-color", "color"]) {
            const v = (el.getAttribute(name) ?? "").trim().toLowerCase();
            if (!v || v === "none" || v === "transparent" || v === "currentcolor" || v.startsWith("url(")) continue;
            if (!palette.includes(v)) off.add(v);
          }
        }
        return {
          viewBox: vb ? `${vb.x} ${vb.y} ${vb.width} ${vb.height}` : "",
          heightAtCard: Math.round(frame.height),
          textRuns: runs.length,
          minTextPx: runs.length ? Math.round(Math.min(...runs.map((r) => r.px)) * 10) / 10 : null,
          overlaps: overlaps.slice(0, 12),
          outside: outside.slice(0, 12),
          smallText: smallText.slice(0, 12),
          longLines: longLines.slice(0, 12),
          offPalette: [...off].slice(0, 12),
          animated,
        };
      },
      { palette: [...PALETTE], modelDrawn: opts.modelDrawn },
    );
    // The still: the first moment for a still, two seconds in for a picture
    // that moves (the first frame of a loop is often its empty start).
    if (lint.animated > 0) {
      await page.evaluate(() => {
        const root = document.querySelector("#w svg") as SVGSVGElement;
        root.setCurrentTime(2);
      });
    }
    await page.locator("#w").screenshot({ path: out.png });
    if (out.frames && lint.animated > 0) {
      const strip = FRAME_TIMES.map((t) => `<div class="f"><div class="t">t = ${t} s</div><div id="w">${svg}</div></div>`).join("");
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_CSS}#s{display:flex;gap:12px;padding:8px;background:#ffffff}.t{font:12px sans-serif;color:#6b625a;margin-bottom:4px}</style></head><body><div id="s">${strip}</div></body></html>`,
      );
      await page.evaluate("window.__name = (f) => f");
      await page.evaluate((times) => {
        const roots = Array.from(document.querySelectorAll("#s svg")) as SVGSVGElement[];
        roots.forEach((r, i) => {
          r.pauseAnimations();
          r.setCurrentTime(times[i]);
        });
      }, FRAME_TIMES);
      await page.locator("#s").screenshot({ path: out.frames });
    }
    return { ...lint, bytes: svg.length };
  } finally {
    await page.close();
  }
}

/** The findings as lines a reader or a model can act on, one line per kind
    of fault; empty when clean. */
export function lintLines(lint: Lint): string[] {
  const line = (what: string, items: string[]) => (items.length ? [`${what} (${items.length}): ${items.slice(0, 4).join("; ")}.`] : []);
  return [
    ...line("Text overlaps text", lint.overlaps),
    ...line("Outside the frame", lint.outside),
    ...line("Too small to read at the card's width, under 9 px", lint.smallText),
    ...line("Text line past 36 characters", lint.longLines),
    ...line("Colors off the palette, which stay light on a dark page", lint.offPalette),
  ];
}
