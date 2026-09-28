/**
 * The PDF side of an arXiv reference, read from pdftotext's words and their positions: the page furniture, the
 * front matter in the PDF's own words (the author area, page 1's notes, the lines after the abstract), the printed
 * form of heading numbers, caption tags, and capitals, and the page a block's words are on.
 */
import { execFileSync } from "node:child_process";
import type { Span } from "../model";

export type Word = { text: string; x0: number; y0: number; x1: number; y1: number };
export type Line = { words: Word[]; x0: number; y0: number; x1: number; y1: number; text: string; furniture?: true };
export type Page = { number: number; width: number; height: number; lines: Line[] };

const STAMP_RE = /^arXiv:\d{4}\.\d{4,5}(v\d+)?\s*\[[^\]]+\]\s*\d{1,2}\s*[A-Z][a-z]{2}\s*\d{4}$/;
/** A note's mark on a line of its own: "∗", "†", "1" (LIPIcs' mail icon reads "#"). */
const MARK_LINE_RE = /^[\d*∗†‡§¶⋆∥‖#]{1,2}$/;
/** A note's mark before its text. */
const MARK_RE = /^([*∗†‡§¶⋆∥‖#]|\d{1,2}(?=\D))\s*/;

/** Every page's lines in pdftotext's reading order, each with its words. */
export function readPdf(path: string): Page[] {
  const xml = execFileSync("pdftotext", ["-bbox-layout", path, "-"], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
  const box = String.raw`xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)"`;
  const pages: Page[] = [];
  for (const page of xml.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
    const lines: Line[] = [];
    for (const line of page[3].matchAll(new RegExp(String.raw`<line ${box}>([\s\S]*?)</line>`, "g"))) {
      const words = [...line[5].matchAll(new RegExp(String.raw`<word ${box}>([\s\S]*?)</word>`, "g"))].map((w) => ({
        text: decode(w[5]),
        x0: Number(w[1]),
        y0: Number(w[2]),
        x1: Number(w[3]),
        y1: Number(w[4]),
      }));
      if (words.length) lines.push({ words, x0: Number(line[1]), y0: Number(line[2]), x1: Number(line[3]), y1: Number(line[4]), text: joinWords(words) });
    }
    pages.push({ number: pages.length + 1, width: Number(page[1]), height: Number(page[2]), lines });
  }
  return pages;
}

function decode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'").replace(/&amp;/g, "&");
}

/** Words that touch (a superscript after its word) join without a space; words of a rotated line (the arXiv stamp) never touch. */
function joinWords(words: Word[]): string {
  const rotated = words.length > 1 && Math.abs(words[1].y0 - words[0].y0) > Math.abs(words[1].x0 - words[0].x0);
  return words.map((w, i) => (i && (rotated || w.x0 - words[i - 1].x1 > 0.8) ? " " : "") + w.text).join("");
}

/** The words a check compares: runs of two or more letters, lowercased, accents and ligatures folded. */
export function tokens(text: string): string[] {
  return text.replace(/ı/g, "i").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/\p{L}{2,}/gu) ?? [];
}

/**
 * A page's words outside its furniture, in reading order. A word split by a line-end hyphen is joined when the
 * reference knows the whole word; its second half may start one of the next three lines (a formula's glyphs or a
 * column break can sit between).
 */
export function pageTokens(page: Page, vocabulary: Set<string>): string[] {
  const lines = page.lines.filter((l) => !l.furniture).map((l) => l.text);
  for (let i = 0; i < lines.length; i++) {
    const head = /(\p{L}+)[-‐]$/u.exec(lines[i]);
    if (!head) continue;
    for (let k = i + 1; k <= i + 3 && k < lines.length; k++) {
      const tail = /^(\p{L}+)/u.exec(lines[k]);
      if (!tail || !vocabulary.has(tokens(head[1] + tail[1])[0] ?? "")) continue;
      lines[i] = lines[i].slice(0, -1) + tail[1];
      lines[k] = lines[k].slice(tail[1].length);
      break;
    }
  }
  return tokens(lines.join("\n"));
}

/** A line split where a gap wider than a word space separates its parts (a page number and a running head on one row). */
function segments(line: Line): string[] {
  const parts: Word[][] = [[]];
  line.words.forEach((w, i) => {
    if (i && w.x0 - line.words[i - 1].x1 > 12) parts.push([]);
    parts.at(-1)!.push(w);
  });
  return parts.map(joinWords);
}

/**
 * Marks the furniture: the arXiv stamp, what page 1 prints above the title, the top and bottom rows of a page
 * that are page numbers (numbers that follow the page count) or repeat on other pages (running heads), and lines
 * the paper's own patterns name (a journal's license block).
 */
export function markFurniture(pages: Page[], title: Line[], patterns: RegExp[]) {
  const titleTop = Math.min(...title.map((l) => l.y0));
  for (const page of pages) {
    for (const line of page.lines) {
      const text = line.text.replace(/\s+/g, " ").trim();
      if (STAMP_RE.test(text) || patterns.some((p) => p.test(text)) || (page.number === 1 && line.y1 < titleTop - 1)) line.furniture = true;
    }
  }
  type Candidate = { page: Page; line: Line; parts: string[] };
  const candidates: Candidate[] = [];
  for (const page of pages) {
    const lines = page.lines.filter((l) => !l.furniture);
    if (!lines.length) continue;
    const top = Math.min(...lines.map((l) => l.y0));
    const bottom = Math.max(...lines.map((l) => l.y1));
    for (const line of lines) {
      if (title.includes(line)) continue; // a running head may repeat the title; page 1's title is text
      if (line.y0 < top + 3 || line.y1 > bottom - 3) candidates.push({ page, line, parts: segments(line) });
    }
  }
  const offsets = new Map<number, number>();
  const heads = new Map<string, Set<number>>();
  const key = (part: string) => part.replace(/[\divxlc]+$|^[\divxlc]+(?=\s)/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (const { page, parts } of candidates) {
    for (const part of parts) {
      if (/^\d{1,4}$/.test(part)) offsets.set(Number(part) - page.number, (offsets.get(Number(part) - page.number) ?? 0) + 1);
      else if (key(part).length > 3) heads.set(key(part), (heads.get(key(part)) ?? new Set()).add(page.number));
    }
  }
  const offset = [...offsets].sort((a, b) => b[1] - a[1])[0]?.[0];
  // a running head repeats on a fifth of the pages at least (alternating heads: each on every other page)
  const repeats = Math.max(2, Math.ceil(pages.length / 5));
  const accepted = (page: Page, part: string) =>
    (/^\d{1,4}$/.test(part) && Number(part) - page.number === offset) || (heads.get(key(part))?.size ?? 0) >= repeats;
  for (const { page, line, parts } of candidates) if (parts.every((p) => accepted(page, p))) line.furniture = true;
}

/** The printed strings of the furniture on the given pages, each once. */
export function furnitureStrings(pages: Page[], from: number, to: number): string[] {
  const out = new Set<string>();
  for (const page of pages.slice(from - 1, to)) {
    for (const line of page.lines.filter((l) => l.furniture)) for (const part of segments(line)) out.add(part.replace(/\s+/g, " ").trim());
  }
  return [...out].filter(Boolean);
}

/** Page 1's title lines: from the first line that starts the title, while every word of a line is a title word. */
export function titleLines(page: Page, titleText: string): Line[] {
  const title = tokens(titleText);
  const set = new Set(title);
  const lines = [...page.lines].sort((a, b) => a.y0 - b.y0);
  const start = lines.findIndex((l) => !STAMP_RE.test(l.text.trim()) && tokens(l.text)[0] === title[0]);
  if (start < 0) return [];
  const out: Line[] = [];
  for (const line of lines.slice(start)) {
    if (STAMP_RE.test(line.text.trim())) continue;
    const words = tokens(line.text);
    if (!words.length || !words.every((w) => set.has(w))) break;
    out.push(line);
  }
  return out;
}

/**
 * The author area: page 1's lines between the title and the abstract that start in the left half of the page,
 * or share a row with one that does (a figure's labels in the right column stay out). Lines of one row are one
 * paragraph; a line of only superscript marks joins the line after it. Affiliation and note marks the page
 * prints raised ("Ning,¹˒²", "¹Department of…") are sup spans: a word shorter than four fifths of its row's
 * words, its foot above theirs.
 */
export function authorLines(page: Page, below: number, above: number): Span[][] {
  const area = page.lines.filter((l) => !l.furniture && l.y0 >= below - 1 && l.y1 <= above + 1);
  const left = area.filter((l) => l.x0 < page.width / 2);
  const lines = area.filter((l) => left.some((k) => Math.abs(k.y0 - l.y0) < 2)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const rows: Line[][] = [];
  for (const line of lines) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].y0 - line.y0) < 2) row.push(line);
    else rows.push([line]);
  }
  const out: Span[][] = [];
  let carry: Span[] = [];
  for (const row of rows) {
    const text = row.map((l) => l.text).join(" ").replace(/\s+/g, " ").trim();
    if (/^[\d,*†‡§¶∗⋆\s]{1,6}$/.test(text)) {
      carry = [...carry, { text, sup: true }];
      continue;
    }
    out.push(tidy([...carry, ...rowSpans(row)]));
    carry = [];
  }
  return out;
}

/** A row's words as spans, joined as joinWords joins them, the raised ones sup. */
function rowSpans(row: Line[]): Span[] {
  const words = row.flatMap((l) => l.words);
  const heights = words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  const feet = words.map((w) => w.y1).sort((a, b) => a - b);
  const height = heights[Math.floor(heights.length / 2)];
  const foot = feet[Math.floor(feet.length / 2)];
  const raised = (w: Word) => w.y1 - w.y0 < height * 0.8 && w.y1 < foot - height * 0.1;
  const out: Span[] = [];
  row.forEach((line, k) => {
    const rotated = line.words.length > 1 && Math.abs(line.words[1].y0 - line.words[0].y0) > Math.abs(line.words[1].x0 - line.words[0].x0);
    line.words.forEach((w, i) => {
      const gap = i ? (rotated || w.x0 - line.words[i - 1].x1 > 0.8 ? " " : "") : k ? " " : "";
      if (gap) out.push({ text: gap });
      out.push(raised(w) ? { text: w.text, sup: true } : { text: w.text });
    });
  });
  return out;
}

/** Spans with runs of one look joined, spaces collapsed, the ends trimmed. A
    space between two raised words is raised with them ("1, 2"). */
function tidy(spans: Span[]): Span[] {
  const flagged = spans.map((s, i) => (s.text.trim() || !(spans[i - 1]?.sup && spans[i + 1]?.sup) ? s : { ...s, sup: true as const }));
  const out: Span[] = [];
  for (const span of flagged) {
    const last = out.at(-1);
    if (last && Boolean(last.sup) === Boolean(span.sup)) last.text += span.text;
    else out.push({ ...span });
  }
  out.forEach((s, i) => {
    s.text = s.text.replace(/\s+/g, " ");
    if (i > 0 && out[i - 1].text.endsWith(" ") && s.text.startsWith(" ")) s.text = s.text.slice(1);
  });
  if (out[0]) out[0].text = out[0].text.trimStart();
  const last = out.at(-1);
  if (last) last.text = last.text.trimEnd();
  return out.filter((s) => s.text);
}

/** A line's typical word height: its font size, near enough. */
function lineHeight(line: Line): number {
  const heights = line.words.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

/** The body's type size: the most common height of a page's full lines (page 2's: page 1's abstract may be in other type). */
export function typicalHeight(page: Page): number {
  const counts = new Map<number, number>();
  for (const l of page.lines.filter((l) => !l.furniture && l.words.length >= 4)) {
    const h = Math.round(lineHeight(l) * 10) / 10;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/**
 * Page 1's front notes: the small-type lines at the foot of a column below the abstract (a \thanks note, the
 * authors' addresses, amsart's subject classification). Lines join into one note until a gap or a new mark.
 * The note's mark ("∗", "1") is its label.
 */
export function frontNotes(page: Page, below: number, joinable: Set<string>, bodyHeight: number): { label: string; text: string }[] {
  const body = page.lines.filter((l) => !l.furniture);
  const small = (l: Line) => lineHeight(l) < bodyHeight * 0.93;
  const right = (l: Line) => l.x0 >= page.width / 2;
  const mark = (l: Line) => MARK_LINE_RE.test(l.text.trim());
  const text = (l: Line) => l.words.length >= 3 && !small(l);
  const foot = (l: Line) => l.y0 > below && l.y0 > page.height * 0.6;
  // a mark on a line of its own at the foot starts a note whatever the note's type size (fonts' boxes differ):
  // the note is the text beside the mark and the lines under it
  const marked = new Set<Line>();
  for (const m of body.filter((l) => foot(l) && mark(l))) {
    const beside = body.find((l) => l !== m && Math.abs(l.y0 - m.y0) < 4 && l.x0 >= m.x1 - 1 && l.x0 - m.x1 < 12);
    if (!beside) continue;
    marked.add(m);
    let lastY = beside.y1;
    for (const l of body.filter((l) => l.y0 >= beside.y0 && right(l) === right(beside)).sort((a, b) => a.y0 - b.y0)) {
      if (l !== beside && l.y0 - lastY > lineHeight(l) * 0.9) break;
      marked.add(l);
      lastY = l.y1;
    }
  }
  const lines = body
    .filter((l) => marked.has(l) || (foot(l) && (small(l) || mark(l)) && !body.some((b) => text(b) && !marked.has(b) && right(b) === right(l) && b.y0 > l.y0)))
    .sort((a, b) => Number(right(a)) - Number(right(b)) || (Math.abs(a.y0 - b.y0) < 3 ? a.x0 - b.x0 : a.y0 - b.y0));
  const notes: { label: string; text: string; y1: number }[] = [];
  let carry = "";
  for (const line of lines) {
    const own = line.text.replace(/\s+/g, " ").trim();
    if (mark(line)) {
      carry = own; // a mark on a line of its own starts the next note
      continue;
    }
    const text = carry + own;
    const lead = MARK_RE.exec(text);
    const prev = notes.at(-1);
    if (prev && !lead && line.y0 - prev.y1 < lineHeight(line) * 0.9) {
      const hyphen = /(\p{L}+)-$/u.exec(prev.text);
      const next = /^(\p{L}+)/u.exec(text);
      prev.text = hyphen && next && joinable.has(tokens(hyphen[1] + next[1])[0] ?? "") ? prev.text.slice(0, -1) + text : `${prev.text} ${text}`;
      prev.y1 = line.y1;
    } else {
      notes.push({ label: lead ? lead[1] : "", text: lead ? text.slice(lead[0].length) : text, y1: line.y1 });
    }
    carry = "";
  }
  return notes.filter((n) => tokens(n.text).length >= 3).map(({ label, text }) => ({ label, text }));
}

/**
 * The lines of page 1 between two heights, as paragraphs: a gap wider than the lines' usual spacing, or a change
 * of type size, starts a new one. Lines whose words the reference already holds (`known` covers most of them)
 * stay out. The front matter a class prints after the abstract (keywords, classification, funding) is read so.
 */
export function linesBetween(page: Page, top: number, bottom: number, known: (words: string[]) => boolean): string[] {
  const lines = page.lines
    .filter((l) => !l.furniture && l.y0 > top - 1 && l.y1 < bottom + 1 && !known(tokens(l.text)))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const gaps = lines.slice(1).map((l, i) => l.y0 - lines[i].y0).sort((a, b) => a - b);
  const pitch = gaps[Math.floor(gaps.length / 3)] ?? 12;
  const out: string[] = [];
  lines.forEach((line, i) => {
    const prev = lines[i - 1];
    const text = line.text.replace(/\s+/g, " ").trim();
    const same = prev && line.y0 - prev.y0 < pitch * 1.4 && Math.abs(lineHeight(line) - lineHeight(prev)) < 1;
    if (same) out[out.length - 1] = /\p{L}-$/u.test(out.at(-1)!) ? out.at(-1)!.slice(0, -1) + text : `${out.at(-1)} ${text}`;
    else out.push(text);
  });
  return out;
}

/** The first line at or after `from` (a y on page 1) where `words` end (the abstract's last words). */
export function lineEnding(page: Page, words: string[], from: number): Line | undefined {
  const want = words.slice(-4);
  if (!want.length) return undefined;
  const lines = page.lines.filter((l) => !l.furniture && l.y0 >= from - 1).sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < lines.length; i++) {
    const have = [...tokens(lines[i - 1]?.text ?? ""), ...tokens(lines[i].text)];
    if (want.every((w, k) => have[have.length - want.length + k] === w)) return lines[i];
  }
  return undefined;
}

/** The first line at or after `from` (a y on page 1) whose words start with `start` (the abstract's first words). */
export function findLine(page: Page, start: string[], from: number): Line | undefined {
  const lines = page.lines.filter((l) => !l.furniture && l.y0 >= from - 1).sort((a, b) => a.y0 - b.y0);
  const want = start.slice(0, 4);
  for (let i = 0; i < lines.length; i++) {
    const words = [...tokens(lines[i].text), ...tokens(lines[i + 1]?.text ?? "")];
    for (let p = 0; p <= Math.min(words.length - want.length, 3); p++) {
      if (want.every((w, k) => words[p + k] === w)) return lines[i];
    }
  }
  return undefined;
}

/** What printedForm finds: the page, the words before the text on its line, its capitals (set as capitals, or small
    capitals: a tall first letter beside smaller ones), and the words after it on its line. */
export type Printed = { page: number; line: number; prefix: string; upper: boolean; smallCaps: boolean; after: string[] };

/** A line's words as touching groups (a small capital run after its first letter, a subscript after its letter), each
    with its words' tokens and the index of its first word. */
function glued(line: Line): { t: string; index: number }[] {
  const out: { t: string; index: number }[] = [];
  let start = 0;
  for (let k = 1; k <= line.words.length; k++) {
    if (k < line.words.length && line.words[k].x0 - line.words[k - 1].x1 <= 0.8) continue;
    for (const t of tokens(line.words.slice(start, k).map((w) => w.text).join(""))) out.push({ t, index: start });
    start = k;
  }
  return out;
}

/**
 * How the PDF prints a heading or a caption whose words are `start`: the words before them on their line (the
 * number "II." or the tag "FIG. 1."), which `prefixOk` must accept, and whether their letters are capitals.
 * Searched from page `from` on, past the lines in `taken`. `lead` is the text's own start that holds no word to
 * match ("A" of "A simple example", "(a)", a formula's glyphs): it is no part of the prefix. A heading (`whole`)
 * fills its line; when no line holds it alone, the first line where other words follow it is returned with those
 * words (`after`): a heading that runs in (amsart's subsections).
 */
export function printedForm(
  pages: Page[],
  from: number,
  start: string[],
  options: { maxBefore: number; whole: boolean; lead: string; prefixOk: (prefix: string) => boolean; taken?: Set<string> },
): Printed | null {
  const want = start.slice(0, options.whole ? start.length : 10);
  if (!want.length) return null;
  let runIn: Printed | null = null;
  for (const page of pages.slice(Math.max(0, from - 1))) {
    const lines = page.lines.filter((l) => !l.furniture);
    for (let i = 0; i < lines.length; i++) {
      if (options.taken?.has(`${page.number}:${i}`)) continue; // another heading's line
      const own = glued(lines[i]);
      const nextText = [lines[i + 1], lines[i + 2]].map((l) => l?.text ?? "").join("\n");
      const next = tokens(nextText).map((t) => ({ t, index: -1 }));
      // a word broken at the line's end by a hyphen joins its second half
      if (/(\p{L}+)-$/u.test(lines[i].text) && /^\p{Ll}/u.test(nextText) && own.length && next.length) {
        own[own.length - 1] = { ...own[own.length - 1], t: own[own.length - 1].t + next.shift()!.t };
      }
      const all = [...own, ...next];
      for (let p = 0; p <= Math.min(own.length - 1, options.maxBefore); p++) {
        if (all[p].t !== want[0]) continue;
        const end = follows(want, all.map((a) => a.t), p);
        if (end < 0) continue;
        const first = own[p].index;
        let prefix = withoutLead(joinWords(lines[i].words.slice(0, first)).trim(), options.lead);
        if (!prefix) {
          // a number set apart by a wide space (revtex's "I.  INTRODUCTION") is a line of its own on the row
          const em = lines[i].y1 - lines[i].y0;
          const left = lines.find((l) => l !== lines[i] && Math.abs(l.y0 - lines[i].y0) < 1.5 && l.x1 <= lines[i].x0 && lines[i].x0 - l.x1 < 2.2 * em);
          if (left) prefix = left.text.trim();
        }
        if (!options.prefixOk(prefix)) continue;
        const set = printedCase(lines[i].words.slice(first));
        const found = { page: page.number, line: i, prefix, upper: set === "upper", smallCaps: set === "smallCaps", after: [] as string[] };
        if (!options.whole || own.length - end <= 1) return found;
        runIn ??= { ...found, after: own.slice(end).map((o) => o.t) };
      }
    }
  }
  return runIn;
}

/** A prefix without the words at its end that spell `lead` (the text's own start that holds no word to match). */
function withoutLead(prefix: string, lead: string): string {
  const words = prefix.split(/\s+/).filter(Boolean);
  let rest = lead.replace(/\s+/g, "");
  while (rest && words.length && rest.endsWith(words.at(-1)!)) rest = rest.slice(0, -words.pop()!.length);
  return words.join(" ");
}

/** A text's own start that holds no word to match: its first words without two letters in a row ("A", "(a)", "L2"). */
export function leadOf(text: string): string {
  const words = text.trim().split(/\s+/);
  return words.slice(0, Math.max(0, words.findIndex((w) => /\p{L}{2}/u.test(w)))).join(" ");
}

/** How words are set when their letters are all capitals: as capitals, or as small capitals (a tall first letter
    touching smaller ones). Null when they hold lower case. */
export function printedCase(words: Word[]): "upper" | "smallCaps" | null {
  const letters = words.map((w) => w.text).join("").replace(/[^\p{L}]/gu, "");
  if (letters.length <= 2 || letters !== letters.toUpperCase()) return null;
  const height = (w: Word) => w.y1 - w.y0;
  return words.some((w, k) => k > 0 && w.x0 - words[k - 1].x1 <= 0.8 && height(words[k - 1]) > height(w) * 1.1) ? "smallCaps" : "upper";
}

/**
 * Where `want` ends when it follows `words` from `at`. A text of five words or more may have a word here and there
 * skipped or changed on either side (a formula's glyphs read differently) and still match with four in five of its
 * words; a shorter one matches word for word. -1 when it does not match.
 */
function follows(want: string[], words: string[], at: number): number {
  let i = 0;
  let j = at;
  let matched = 0;
  let end = at;
  while (i < want.length && j < words.length) {
    if (want[i] === words[j]) {
      matched++;
      i++;
      j++;
      end = j;
    } else if (want[i] === words[j + 1]) j++;
    else if (want[i + 1] === words[j]) i++;
    else {
      i++;
      j++;
    }
  }
  return matched >= (want.length < 5 ? want.length : Math.ceil(want.length * 0.8)) ? end : -1;
}

/** The page whose words hold the most of a block's word triples (pairs for a short block), or null when too few match. */
export function locate(blockTokens: string[], pages: string[][]): number | null {
  const n = blockTokens.length >= 6 ? 3 : blockTokens.length >= 2 ? 2 : 1;
  const grams = new Set<string>();
  for (let i = 0; i + n <= blockTokens.length; i++) grams.add(blockTokens.slice(i, i + n).join(" "));
  if (!grams.size) return null;
  let best: number | null = null;
  let bestScore = 0;
  pages.forEach((words, index) => {
    const own = new Set<string>();
    for (let i = 0; i + n <= words.length; i++) own.add(words.slice(i, i + n).join(" "));
    const score = [...grams].filter((g) => own.has(g)).length;
    if (score > bestScore) [best, bestScore] = [index + 1, score];
  });
  return bestScore >= Math.max(1, Math.ceil(grams.size * 0.3)) ? best : null;
}
