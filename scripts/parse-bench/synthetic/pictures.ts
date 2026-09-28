/**
 * Pictures for figures: one SVG per picture. HTML draws the SVG; LaTeX includes it as a vector PDF
 * (its labels stay text, as in a figure made by a plotting tool); Word takes a PNG. A photo is always pixels.
 */
import { writeFileSync } from "node:fs";
import type { Browser } from "playwright-core";
import type { Picture } from "./spec";
import { pinPdf } from "./stamp";

const FONT = "Liberation Sans, Arial, sans-serif";

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A small deterministic generator, so a photo is the same picture on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

export function pictureSvg(picture: Picture): string {
  const { width, height } = picture;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  switch (picture.kind) {
    case "diagram": {
      const boxes = new Map(picture.boxes.map((box) => [box.id, box]));
      const parts = [
        `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#333"/></marker></defs>`,
        `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>`,
      ];
      for (const box of picture.boxes) {
        parts.push(
          `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${box.round ? box.h / 2 : 4}" fill="#eef3fb" stroke="#333" stroke-width="1.2"/>`,
          `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 + 5}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#111">${escapeXml(box.label)}</text>`,
        );
      }
      for (const [from, to, label] of picture.arrows) {
        const a = boxes.get(from);
        const c = boxes.get(to);
        if (!a || !c) throw new Error(`diagram arrow ${from} → ${to}: no such box`);
        const [x1, y1, x2, y2] = edgePoints(a, c);
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="1.4" marker-end="url(#arrow)"/>`);
        if (label) {
          parts.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-family="${FONT}" font-size="12" font-style="italic" fill="#333">${escapeXml(label)}</text>`);
        }
      }
      return `${open}${parts.join("")}</svg>`;
    }
    case "bars": {
      const left = 56;
      const bottom = height - 36;
      const top = 40;
      const max = Math.max(...picture.bars.map(([, value]) => value));
      const step = (width - left - 16) / picture.bars.length;
      const parts = [
        `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>`,
        `<text x="${width / 2}" y="20" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="bold" fill="#111">${escapeXml(picture.title)}</text>`,
        `<text x="${left - 8}" y="${top - 12}" text-anchor="end" font-family="${FONT}" font-size="11" fill="#333">${escapeXml(picture.unit)}</text>`,
        `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#333"/>`,
        `<line x1="${left}" y1="${bottom}" x2="${width - 8}" y2="${bottom}" stroke="#333"/>`,
      ];
      picture.bars.forEach(([name, value], index) => {
        const barHeight = ((bottom - top) * value) / max;
        const x = left + index * step + step * 0.2;
        parts.push(
          `<rect x="${x}" y="${bottom - barHeight}" width="${step * 0.6}" height="${barHeight}" fill="#5b7fb9"/>`,
          `<text x="${x + step * 0.3}" y="${bottom - barHeight - 5}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#111">${value}</text>`,
          `<text x="${x + step * 0.3}" y="${bottom + 16}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#111">${escapeXml(name)}</text>`,
        );
      });
      return `${open}${parts.join("")}</svg>`;
    }
    case "photo": {
      const next = random(picture.seed);
      const hue = Math.floor(next() * 360);
      const parts = [
        `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,90%)"/></linearGradient></defs>`,
        `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#sky)"/>`,
        `<circle cx="${width * (0.2 + next() * 0.6)}" cy="${height * 0.3}" r="${height * 0.12}" fill="hsl(45,90%,70%)"/>`,
      ];
      for (let layer = 0; layer < 3; layer++) {
        const base = height * (0.55 + layer * 0.14);
        let d = `M0 ${height} L0 ${base}`;
        for (let x = 0; x <= width; x += width / 8) d += ` Q${x + width / 16} ${base - next() * height * 0.2} ${x + width / 8} ${base}`;
        parts.push(`<path d="${d} L${width} ${height} Z" fill="hsl(${(hue + 120 + layer * 20) % 360},${35 + layer * 10}%,${45 - layer * 10}%)"/>`);
      }
      return `${open}${parts.join("")}</svg>`;
    }
  }
}

/** The points where a line from box a's center to box c's center leaves a and enters c. */
function edgePoints(a: { x: number; y: number; w: number; h: number }, c: { x: number; y: number; w: number; h: number }) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const clip = (box: typeof a, px: number, py: number, dx: number, dy: number) => {
    const tx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
    const ty = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
    const t = Math.min(tx, ty);
    return [px + dx * t, py + dy * t];
  };
  const [x1, y1] = clip(a, ax, ay, cx - ax, cy - ay);
  const [x2, y2] = clip(c, cx, cy, ax - cx, ay - cy);
  const round = (n: number) => Math.round(n * 10) / 10;
  return [round(x1), round(y1), round(x2), round(y2)];
}

const pageOf = (svg: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`;

/** The picture as a one-page vector PDF the size of the picture. */
export async function picturePdf(browser: Browser, picture: Picture, path: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.setContent(pageOf(pictureSvg(picture)));
    await page.pdf({ path, width: `${picture.width}px`, height: `${picture.height}px`, printBackground: true, pageRanges: "1" });
    pinPdf(path);
  } finally {
    await page.close();
  }
}

/** The picture as a PNG at twice its size. */
export async function picturePng(browser: Browser, picture: Picture, path: string): Promise<void> {
  const context = await browser.newContext({ viewport: { width: picture.width, height: picture.height }, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    await page.setContent(pageOf(pictureSvg(picture)));
    writeFileSync(path, await page.screenshot({ clip: { x: 0, y: 0, width: picture.width, height: picture.height } }));
  } finally {
    await context.close();
  }
}
