import { PDF_CMAPS } from "@/lib/pdf-runtime";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { readDrawing, type FontLookup } from "@/lib/parse/pdf/drawing";
import { ROOT } from "./load";

// What a PDF's pages paint that pdftotext's lines do not tell: the images
// (the parser's own walk of the operator list, drawing.ts), the text pdf.js
// reads (its text layer, which reads fonts poppler cannot: a CID font in a
// vertical writing mode, a script whose map this sandbox lacks), and the ink
// poppler draws (pdftoppm). Places are in points from the page's top left,
// as pdftotext measures them.

export type Rect = { x1: number; y1: number; x2: number; y2: number };
/** A run of text as pdf.js's text layer reads it: its box (from its baseline, 0.8 of its size above and 0.2
    below; a column of vertical writing, its width about its origin) and its words. */
export type TextItem = Rect & { text: string; vertical?: true };
export type PagePaint = { width: number; height: number; images: Rect[]; items: TextItem[] };

/** The walk's pages kept between runs (never committed), named by the PDF's
    bytes and the walk's code, as the glyph checks keep theirs (glyphs.ts). */
const DISK = join(ROOT, ".bench", "cache", "paint");
const WALK_CODE = join(ROOT, "src", "lib", "parse", "pdf", "drawing.ts");
/** This file's own reading of the walk: a change to it reads every PDF anew. */
const FORMAT = "2";

const memo = new Map<string, Promise<PagePaint[]>>();

/** Let a PDF's paint go once no document still to score reads it. */
export function forgetPaint(path: string) {
  memo.delete(path);
  for (const key of [...inkMemo.keys()]) if (key.startsWith(`${path}|`)) inkMemo.delete(key);
}

/** Every page's paint, read once per file and kept on disk. */
export function pdfPaint(path: string): Promise<PagePaint[]> {
  let hit = memo.get(path);
  if (!hit) {
    hit = (async () => {
      const bytes = readFileSync(path);
      const pdfKey = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
      const code = createHash("sha1").update(readFileSync(WALK_CODE)).update(FORMAT).digest("hex").slice(0, 16);
      const name = `${pdfKey}-${code}.json`;
      const stored = join(DISK, name);
      if (existsSync(stored)) return JSON.parse(readFileSync(stored, "utf8")) as PagePaint[];
      const pdf = await getDocumentProxy(new Uint8Array(bytes), PDF_CMAPS);
      const pages: PagePaint[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 1 });
        const at = (x: number, y: number) => viewport.convertToViewportPoint(x, y) as [number, number];
        const out: PagePaint = { width: viewport.width, height: viewport.height, images: [], items: [] };
        try {
          const ops = (await page.getOperatorList()) as { fnArray: number[]; argsArray: unknown[] };
          const lookup: FontLookup = (id) => {
            try {
              const font = page.commonObjs.get(id) as { name?: string; fontMatrix?: number[]; vertical?: boolean } | null;
              return font ? { name: font.name ?? "", fontMatrix: font.fontMatrix, vertical: font.vertical } : null;
            } catch {
              return null;
            }
          };
          const [vx1, vy1, vx2, vy2] = page.view;
          const drawing = readDrawing(ops, lookup, viewport.width, viewport.height, { x1: vx1, y1: vy1, x2: vx2, y2: vy2 });
          for (const box of drawing.images) {
            const corners = [at(box.x1, box.y1), at(box.x2, box.y1), at(box.x1, box.y2), at(box.x2, box.y2)];
            const xs = corners.map((c) => c[0]);
            const ys = corners.map((c) => c[1]);
            const rect = { x1: Math.max(0, Math.min(...xs)), y1: Math.max(0, Math.min(...ys)), x2: Math.min(viewport.width, Math.max(...xs)), y2: Math.min(viewport.height, Math.max(...ys)) };
            if (rect.x2 - rect.x1 >= 2 && rect.y2 - rect.y1 >= 2) out.images.push(rect);
          }
          const content = (await page.getTextContent()) as { items: { str?: string; transform?: number[]; width?: number; height?: number; dir?: string }[] };
          for (const item of content.items) {
            const text = (item.str ?? "").trim();
            if (!text || !item.transform) continue;
            const [a, b, , , e, f] = item.transform;
            const size = Math.hypot(a, b) || item.height || 0;
            const [x, y] = at(e, f);
            const width = item.width ?? 0;
            const rect =
              item.dir === "ttb" ? { x1: x - size / 2, y1: y, x2: x + size / 2, y2: y + width } : { x1: Math.min(x, x + width), y1: y - 0.8 * size, x2: Math.max(x, x + width), y2: y + 0.2 * size };
            out.items.push({ ...rect, text, ...(item.dir === "ttb" ? { vertical: true as const } : {}) });
          }
        } catch {
          // A page whose resources pdf.js cannot read paints nothing here.
        }
        pages.push(out);
        page.cleanup();
      }
      await pdf.loadingTask.destroy();
      mkdirSync(DISK, { recursive: true });
      for (const old of readdirSync(DISK)) if (old !== name && old.startsWith(`${pdfKey}-`)) rmSync(join(DISK, old), { force: true });
      writeFileSync(stored, JSON.stringify(pages));
      return pages;
    })();
    memo.set(path, hit);
  }
  return hit;
}

// ── Ink ─────────────────────────────────────────────────────────────────────

/** Pixels a point where the page is drawn to read its ink. */
const SCALE = 4;
const inkMemo = new Map<string, { counts: Uint16Array; top: number } | null>();

/** The ink in a box of a page (1-based): each pixel row's count of dark
    pixels (under 150 of 255), poppler drawing the page at SCALE pixels a
    point; the rows start at `top` (points). pdftoppm writes the picture to
    its output only (no file). A fill's inside is no ink: rows of one gray
    across the box, three points tall or more, count none (parse bench
    finding: a Keynote deck's slides are purple, 138 of 255, and a callout
    box on a slide is purple too; every row under a block read as ink, and
    a title slide's subtitle, 150 pt over its author, as a block whose
    space no ink under it shows). A rule, thinner, stays ink. */
export function inkRows(path: string, page: number, box: Rect): { counts: Uint16Array; top: number } | null {
  const [x, y] = [Math.max(0, Math.floor(box.x1 * SCALE)), Math.max(0, Math.floor(box.y1 * SCALE))];
  const [w, h] = [Math.ceil(box.x2 * SCALE) - x, Math.ceil(box.y2 * SCALE) - y];
  const key = `${path}|${page}|${x} ${y} ${w} ${h}`;
  if (inkMemo.has(key)) return inkMemo.get(key) ?? null;
  let out: { counts: Uint16Array; top: number } | null = null;
  if (w > 0 && h > 0) {
    try {
      const pgm = execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-r", String(72 * SCALE), "-gray", "-x", String(x), "-y", String(y), "-W", String(w), "-H", String(h), path], {
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      // P5: "P5", the width, the height, the largest value, one space, then a byte a pixel.
      const head = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.subarray(0, 64).toString("latin1"));
      if (head) {
        const [width, height] = [Number(head[1]), Number(head[2])];
        const start = head[0].length;
        const counts = new Uint16Array(height);
        const even = new Uint8Array(height);
        for (let r = 0; r < height; r++) {
          let n = 0;
          let [lo, hi] = [255, 0];
          for (let c = 0; c < width; c++) {
            const v = pgm[start + r * width + c];
            if (v < 150) n++;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
          counts[r] = n;
          even[r] = n > 0 && hi - lo <= 30 ? 1 : 0;
        }
        for (let r = 0; r < height; ) {
          if (!even[r]) {
            r++;
            continue;
          }
          const from = r;
          while (r < height && even[r]) r++;
          if (r - from >= 3 * SCALE) counts.fill(0, from, r);
        }
        out = { counts, top: y / SCALE };
      }
    } catch {
      out = null;
    }
  }
  if (inkMemo.size > 2000) inkMemo.clear();
  inkMemo.set(key, out);
  return out;
}

/** The rightmost ink in a box of a page, in points; null for none. */
export function inkRight(path: string, page: number, box: Rect): number | null {
  const [x, y] = [Math.max(0, Math.floor(box.x1 * SCALE)), Math.max(0, Math.floor(box.y1 * SCALE))];
  const [w, h] = [Math.ceil(box.x2 * SCALE) - x, Math.ceil(box.y2 * SCALE) - y];
  if (w <= 0 || h <= 0) return null;
  try {
    const pgm = execFileSync("pdftoppm", ["-f", String(page), "-l", String(page), "-r", String(72 * SCALE), "-gray", "-x", String(x), "-y", String(y), "-W", String(w), "-H", String(h), path], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const head = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.subarray(0, 64).toString("latin1"));
    if (!head) return null;
    const [width, height] = [Number(head[1]), Number(head[2])];
    const start = head[0].length;
    for (let c = width - 1; c >= 0; c--) for (let r = 0; r < height; r++) if (pgm[start + r * width + c] < 150) return (x + c + 1) / SCALE;
    return null;
  } catch {
    return null;
  }
}

/** A run of rows with ink: its top and bottom, and where its letters stand
    (the last row with a third of the band's most ink or more: under it only
    descenders reach), in points. */
export type InkBand = { top: number; bottom: number; baseline: number };

/** The bands of ink in a box of a page, top to bottom. */
export function inkBands(path: string, page: number, box: Rect): InkBand[] {
  const ink = inkRows(path, page, box);
  if (!ink) return [];
  const out: InkBand[] = [];
  const { counts, top } = ink;
  for (let r = 0; r < counts.length; ) {
    if (counts[r] === 0) {
      r++;
      continue;
    }
    const start = r;
    while (r < counts.length && counts[r] > 0) r++;
    const band = counts.subarray(start, r);
    const most = Math.max(...band);
    let base = r - 1;
    while (base > start && counts[base] * 3 < most) base--;
    out.push({ top: top + start / SCALE, bottom: top + r / SCALE, baseline: top + (base + 1) / SCALE });
  }
  return out;
}
