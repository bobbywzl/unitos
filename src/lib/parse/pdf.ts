import { getDocumentProxy } from "unpdf";
import type { ParsedBlock } from "@/lib/parse/types";

type Item = { str: string; x: number; y: number; w: number; size: number };
type Line = {
  items: Item[];
  x: number;
  xEnd: number;
  y: number;
  size: number;
  text: string;
  gaps: number[]; // x positions of wide gaps (table column candidates)
};

const BULLET_RE = /^\s*([•▪◦‣●·*-]|\d{1,2}[.)]|\([a-z\d]{1,3}\)|[ivx]{1,4}[.)])\s+/i;
const HEADING_NUM_RE = /^\d{1,2}(\.\d{1,2})*\.?\s+\S/;

function buildLines(items: Item[]): Line[] {
  const sorted = [...items].filter((i) => i.str.trim().length > 0);
  sorted.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(2, item.size * 0.4);
    if (last && Math.abs(last.y - item.y) < tolerance) {
      last.items.push(item);
    } else {
      lines.push({ items: [item], x: 0, xEnd: 0, y: item.y, size: 0, text: "", gaps: [] });
    }
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.x = line.items[0].x;
    const last = line.items[line.items.length - 1];
    line.xEnd = last.x + last.w;
    line.size = Math.max(...line.items.map((i) => i.size));
    let text = "";
    let prevEnd: number | null = null;
    for (const item of line.items) {
      if (prevEnd !== null) {
        const gap = item.x - prevEnd;
        if (gap > Math.max(8, line.size * 1.6)) {
          line.gaps.push(item.x);
          text += "\t";
        } else if (gap > line.size * 0.12 && !text.endsWith(" ")) {
          text += " ";
        }
      }
      text += item.str;
      prevEnd = item.x + item.w;
    }
    line.text = text.trim();
  }
  return lines.filter((l) => l.text.length > 0);
}

// Two-column pages: find a middle gutter that almost no text crosses.
// Returns ordered lines: per vertical band, left column then right column.
function pageLines(items: Item[], pageWidth: number): Line[] {
  const chars = (list: Item[]) => list.reduce((n, i) => n + i.str.length, 0);
  const total = chars(items);
  if (total === 0) return [];

  let best: { g: number; crossChars: number } | null = null;
  for (let g = pageWidth * 0.44; g <= pageWidth * 0.58; g += pageWidth * 0.02) {
    const crossers = items.filter((i) => i.x < g && i.x + i.w > g && i.str.trim().length > 0);
    const crossChars = chars(crossers);
    if (!best || crossChars < best.crossChars) best = { g, crossChars };
  }
  const g = best ? best.g : pageWidth / 2;
  const left = items.filter((i) => i.x + i.w <= g);
  const right = items.filter((i) => i.x >= g);
  const full = items.filter((i) => i.x < g && i.x + i.w > g);
  const twoColumn =
    best !== null &&
    best.crossChars / total < 0.12 &&
    chars(left) / total > 0.2 &&
    chars(right) / total > 0.2;

  if (!twoColumn) return buildLines(items);

  const leftLines = buildLines(left);
  const rightLines = buildLines(right);
  const fullLines = buildLines(full).sort((a, b) => b.y - a.y);

  const ordered: Line[] = [];
  let pendingLeft = [...leftLines];
  let pendingRight = [...rightLines];
  for (const boundary of fullLines) {
    const above = (l: Line) => l.y > boundary.y;
    ordered.push(...pendingLeft.filter(above));
    ordered.push(...pendingRight.filter(above));
    pendingLeft = pendingLeft.filter((l) => !above(l));
    pendingRight = pendingRight.filter((l) => !above(l));
    ordered.push(boundary);
  }
  ordered.push(...pendingLeft, ...pendingRight);
  return ordered;
}

function median(values: number[]): number {
  if (values.length === 0) return 10;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function joinParagraph(parts: string[]): string {
  let out = "";
  for (const part of parts) {
    if (!out) {
      out = part;
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(part)) {
      out = out.slice(0, -1) + part; // de-hyphenate line break
    } else {
      out += " " + part;
    }
  }
  return out.replace(/[  ]+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tableHtml(rows: string[][]): string {
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

export async function parsePdf(
  data: Uint8Array,
): Promise<{ title: string | null; blocks: ParsedBlock[] }> {
  // pdf.js transfers (detaches) the buffer it receives — parse a copy so callers keep theirs.
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const blocks: ParsedBlock[] = [];
  let title: string | null = null;
  let titleSize = 0;

  const allBodySizes: number[] = [];
  const pages: Line[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string") continue;
      const t = raw.transform as number[];
      const size = Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 10;
      if (Math.abs(t[1]) > size * 0.3) continue; // rotated text (margin watermarks)
      items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width, size });
    }
    const lines = pageLines(items, viewport.width).filter(
      (l) => !(/^\d{1,4}$/.test(l.text) && (l.y < viewport.height * 0.08 || l.y > viewport.height * 0.92)),
    );
    pages.push(lines);
    for (const line of lines) {
      if (line.text.length > 40) allBodySizes.push(line.size);
    }
  }
  const bodySize = median(allBodySizes);

  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p];
    let i = 0;
    let paragraph: string[] = [];
    let prevLine: Line | null = null;

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const text = joinParagraph(paragraph);
      if (text) blocks.push({ type: "PARAGRAPH", text });
      paragraph = [];
    };

    while (i < lines.length) {
      const line = lines[i];

      // Table: >=2 consecutive lines with wide gaps.
      if (line.gaps.length >= 1) {
        let j = i;
        while (j < lines.length && lines[j].gaps.length >= 1) j++;
        const run = lines.slice(i, j);
        if (run.length >= 2 && run.some((l) => l.gaps.length >= 2)) {
          flushParagraph();
          const rows = run.map((l) => l.text.split("\t").map((c) => c.trim()));
          const cells = rows.flat();
          const shortCells = cells.filter((c) => c.length <= 2).length;
          if (shortCells / cells.length > 0.6) {
            // Fragmented figure text, not a real table.
            blocks.push({ type: "FIGURE", text: run.map((l) => l.text.replace(/\t/g, " ")).join(" ") });
          } else {
            blocks.push({
              type: "TABLE",
              text: run.map((l) => l.text).join("\n"),
              html: tableHtml(rows),
            });
          }
          prevLine = run[run.length - 1];
          i = j;
          continue;
        }
      }

      // Heading: larger than body, short, no trailing period — or numbered like "3.1 Results".
      const isLarger = line.size > bodySize * 1.14;
      const isShort = line.text.length < 120;
      const noPeriod = !/[.,;:]$/.test(line.text);
      const numbered =
        HEADING_NUM_RE.test(line.text) &&
        isShort &&
        line.size >= bodySize * 0.98 &&
        noPeriod &&
        !BULLET_RE.test(line.text) &&
        line.gaps.length === 0;
      if ((isLarger && isShort && noPeriod && line.text.length > 1) || numbered) {
        flushParagraph();
        const ratio = line.size / bodySize;
        const level = ratio > 1.6 ? 1 : ratio > 1.25 ? 2 : 3;
        blocks.push({
          type: "HEADING",
          text: line.text,
          html: `<h${level}>${escapeHtml(line.text)}</h${level}>`,
        });
        if (p === 0 && line.size > titleSize && line.text.length > 4) {
          title = line.text;
          titleSize = line.size;
        }
        prevLine = line;
        i++;
        continue;
      }

      // List: run of bullet lines.
      if (BULLET_RE.test(line.text) && line.size <= bodySize * 1.15) {
        let j = i;
        const listLines: string[] = [];
        let current = "";
        while (j < lines.length && lines[j].size <= bodySize * 1.15) {
          if (BULLET_RE.test(lines[j].text)) {
            if (current) listLines.push(current);
            current = lines[j].text;
          } else if (current && lines[j].x > line.x + line.size * 0.5) {
            current = joinParagraph([current, lines[j].text]); // wrapped list item
          } else {
            break;
          }
          j++;
        }
        if (current) listLines.push(current);
        if (listLines.length >= 2) {
          flushParagraph();
          blocks.push({ type: "LIST", text: listLines.join("\n") });
          prevLine = lines[j - 1];
          i = j;
          continue;
        }
      }

      // Paragraph assembly.
      if (prevLine && paragraph.length > 0) {
        const gap = prevLine.y - line.y;
        const newBand = gap < 0 || gap > line.size * 2.1; // column/page jump or blank gap
        const indented = line.x > prevLine.x + line.size * 1.1 && line.x < prevLine.x + line.size * 4;
        const sizeChange = Math.abs(line.size - prevLine.size) > 0.6;
        if (newBand || indented || sizeChange) flushParagraph();
      }
      paragraph.push(line.text);
      prevLine = line;
      i++;
    }
    flushParagraph();
  }

  // Merge single-line paragraph fragments that end mid-sentence with the next paragraph.
  const merged: ParsedBlock[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (
      block.type === "PARAGRAPH" &&
      prev &&
      prev.type === "PARAGRAPH" &&
      /[a-z,;-]$/.test(prev.text) &&
      /^[a-z(]/.test(block.text)
    ) {
      prev.text = joinParagraph([prev.text, block.text]);
    } else {
      merged.push(block);
    }
  }

  return { title, blocks: merged.filter((b) => b.text.trim().length > 0) };
}
