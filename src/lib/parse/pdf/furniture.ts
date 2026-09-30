// Page furniture: running heads, running feet, and page numbers. They sit at
// a page's top or bottom, apart from the text block, and they repeat: the
// same words (digits aside), a number that follows the page, or the place,
// size, and weight of furniture on other pages. parsePdf drops them before
// segmentation.
//
// A fixed band (the top and bottom 8.5% of the page) missed most heads:
// Grinstead–Snell sets them 13% down, the Supreme Court's slip opinions
// 15% and 18.5% down in two rows, a scanned book's foot sits
// 83% down (census class 4). So each page's own first and last rows are the
// candidates, and a candidate drops only on evidence from other pages.

import { median } from "@/lib/parse/pdf/geometry";
import type { Line } from "@/lib/parse/pdf/types";

// A row: the lines on one baseline (a head split by the column gutter is
// one row: "Constraining the redshift …" and its page number "3").
type Row = {
  page: number; // 0-based
  lines: Line[];
  y: number;
  top: number; // the baseline's distance from the page's top edge
  bottom: number; // and from its bottom edge
  size: number;
  bold: boolean;
  text: string;
  words: number;
  key: string; // lower case, digits folded: "12 Chapter 3. The River" is "# chapter #. the river"
  // What sameWords compares: the key's letters alone, and its words of four
  // letters or more.
  letters: string;
  longWords: string[];
  numbers: number[]; // a page number the row may carry, at its start or its end
  lone: boolean; // the row is only a page number: "12", "- 12 -", "Page 3 of 12", "xii"
};

type Side = "head" | "foot";
// A candidate: a row at the page's top or bottom. Strong when a gap wider
// than the text's leading sets it apart; weak when it only is the first or
// last row (a tall formula right under the head closes the gap), or the
// second under a strong first (the Supreme Court's first page sets its
// notice 18.5 pt under "Per Curiam").
type Candidate = { row: Row; side: Side; strong: boolean };

export type FurnitureDrop = { page: number; line: Line; why: "repeat" | "page number" | "place" | "cell" | "continued" | "band" | "blank" | "mark" };

// A period may close the number: the 10-K prints "53." at each foot, and
// its 97 page numbers stayed in the text.
const LONE_NUMBER_RE = /^[-–—\s]*(?:(?:page|p\.)\s*)?(\d{1,4}|[ivxlc]{1,7})\.?(?:\s*(?:of|\/)\s*\d{1,4})?[-–—\s]*$/i;
// The notice a book or a thesis prints on a page it leaves empty: the only
// words of their page on six pages of the NPS thesis.
const BLANK_PAGE_RE = /^\(?(?:this page (?:is |has been )?(?:intentionally|deliberately) left blank|(?:page )?intentionally left blank)\.?\)?$/i;
// A printer's job mark at a page's foot: its number, a degree sign, the
// year, and the sheet ("13061°—22", "9218°—13——1").
const JOB_MARK_RE = /^\d{3,6}\s*[°º*]\s*[—–-]{1,2}\s*\d{2}(?:\s*[—–-]{1,3}\s*\d{1,3})?$/;
// A long table's foot on each page it breaks at (LaTeX longtable, Word).
const CONTINUED_RE = /^\(?continued (?:on (?:the )?next page|overleaf)\)?\.?$/i;

// pageNumbers: each page's 0-based number in the PDF, where the pages are
// not all of it (a parse of the pages the reader chose, parsePdf); a page
// number counts with these. scans: the pages that are a scan's text layer.
export function findFurniture(pages: Line[][], pageHeights: number[], pageNumbers?: number[], scans?: boolean[]): FurnitureDrop[] {
  const rows = pages.map((lines, p) => rowsOf(lines, pageNumbers?.[p] ?? p, pageHeights[p]));
  // A scan's specks at a page's head or foot drop first: a short row with no
  // letter or digit (the OCR read the paper's edge or a smudge as "—" or
  // "'") stood over the running head or under the page number, and they
  // were no first or last row of their page (NASA SP-4408).
  const specks: Row[] = [];
  rows.forEach((pageRows, p) => {
    if (!scans?.[p]) return;
    const bare = (r: Row | undefined) => r !== undefined && r.text.length <= 8 && !/[\p{L}\p{N}]/u.test(r.text);
    while (bare(pageRows[0])) specks.push(pageRows.shift()!);
    while (bare(pageRows[pageRows.length - 1])) specks.push(pageRows.pop()!);
  });
  const { lead, bodySize } = measures(pages, rows);
  const candidates = rows.flatMap((pageRows) => candidatesOf(pageRows, lead));
  const strong = candidates.filter((c) => c.strong);
  const strongRows = new Set(strong.map((c) => c.row));
  const pageCount = pages.length;
  // Evidence needs three pages; a document of four pages or fewer shows its
  // head on two at most.
  const needed = pageCount <= 4 ? 2 : 3;
  const dropped = new Map<Row, FurnitureDrop["why"]>();

  // The pages whose strong candidates carry a number at the same distance
  // from the page's index as one of the row's: page numbers. A restart
  // (documents bound in one file) starts a new distance.
  const tracks = (row: Row): number => {
    let best = 0;
    for (const n of row.numbers) {
      const on = new Set<number>([row.page]);
      for (const s of strong) {
        if (s.row.page !== row.page && s.row.numbers.some((m) => m - s.row.page === n - row.page)) on.add(s.row.page);
      }
      best = Math.max(best, on.size);
    }
    return best;
  };
  const sameOffset = (a: Row, b: Row) => a.numbers.some((n) => b.numbers.some((m) => m - b.page === n - a.page));
  // sameWords reads only the rows' keys: it runs once for each pair of keys
  // (a book's heads repeat on hundreds of pages, and each candidate's row
  // meets every other page's).
  const sameKeys = new Map<string, Map<string, boolean>>();
  const same = (a: Row, b: Row): boolean => {
    let byKey = sameKeys.get(a.key);
    if (!byKey) sameKeys.set(a.key, (byKey = new Map()));
    let hit = byKey.get(b.key);
    if (hit === undefined) byKey.set(b.key, (hit = sameWords(a, b)));
    return hit;
  };

  // A head is furniture only above the text block of the other pages, a
  // foot only below it: any other row of another page that reaches the
  // candidate's edge and does not read like it puts it inside. A contract
  // may start pages with section titles, and a landscape page's table
  // caption sits where the other pages' first lines do.
  const allowed = Math.max(pageCount >= 5 ? 1 : 0, Math.floor(pageCount * 0.1));
  const known = new Map<Candidate, boolean>();
  // Each page's other rows by their distance from the top, and from the
  // bottom: a candidate reads only the rows that reach its edge (every row
  // of every page, for each candidate, took seconds on a 517-page book).
  const byEdge = (edge: (r: Row) => number) =>
    rows.map((pageRows) => pageRows.filter((r) => !strongRows.has(r) && !Number.isNaN(edge(r))).sort((a, b) => edge(a) - edge(b)));
  const byTop = byEdge((r) => r.top);
  const byBottom = byEdge((r) => r.bottom);
  // A page number in another numbering reads like it: roman before arabic
  // (the NPS thesis kept "i" to "xiv", the arabic numbers of its weak feet
  // standing at their place).
  const outside = (c: Candidate): boolean => {
    const hit = known.get(c);
    if (hit !== undefined) return hit;
    const head = c.side === "head";
    const edge = head ? c.row.top : c.row.bottom;
    let inside = 0;
    for (const pageRows of head ? byTop : byBottom) {
      for (const r of pageRows) {
        if (!((head ? r.top : r.bottom) <= edge + 2)) break;
        if (r.page !== c.row.page && !same(r, c.row) && !sameOffset(r, c.row) && !(r.lone && c.row.lone)) {
          inside++;
          break;
        }
      }
      if (inside > allowed) break;
    }
    known.set(c, inside <= allowed);
    return inside <= allowed;
  };

  // The row reads the same as strong candidates on the same side of other
  // pages, enough of them. Only for rows of three letters or more (a
  // diagram's label "o3" tops three pages of a paper) and no larger than the
  // body text (a slide deck repeats a title on the slides that continue it).
  const repeated = (c: Candidate): boolean => {
    if (c.row.size > bodySize * 1.15 || (c.row.key.match(/\p{L}/gu)?.length ?? 0) < 3) return false;
    const on = new Set<number>([c.row.page]);
    for (const s of strong) {
      if (s.side !== c.side || on.has(s.row.page)) continue;
      if (same(c.row, s.row) && closeSize(c.row, s.row)) on.add(s.row.page);
      if (on.size >= needed) return true;
    }
    return false;
  };

  // 0. The notice of a page left blank, its page's only words but its number.
  for (const pageRows of rows) {
    const words = pageRows.filter((r) => !r.lone);
    if (words.length === 1 && BLANK_PAGE_RE.test(words[0].text)) dropped.set(words[0], "blank");
  }

  // 1. Strong candidates with evidence of their own.
  for (const c of strong) {
    if (dropped.has(c.row) || !outside(c)) continue;
    if (c.row.lone) dropped.set(c.row, "page number");
    else if (tracks(c.row) >= needed) dropped.set(c.row, "page number");
    else if (repeated(c)) dropped.set(c.row, "repeat");
    else if (c.side === "foot" && CONTINUED_RE.test(c.row.text)) dropped.set(c.row, "continued");
  }

  // 2. Candidates at the place of the furniture of other pages: the same
  // distance from the edge, size, and weight. A strong one is short and no
  // larger than the body text ("© 2024 The Authors" where the other pages
  // print the journal's foot); a weak one reads like them or carries their
  // page numbers.
  const found = [...dropped.keys()];
  for (const c of candidates) {
    if (dropped.has(c.row) || !outside(c)) continue;
    const peers = found.filter((d) => d.page !== c.row.page && samePlace(c, d));
    if (new Set(peers.map((d) => d.page)).size < needed - 1) continue;
    const fits = c.strong
      ? c.row.words <= 8 && c.row.size <= bodySize * 1.15
      : peers.some((d) => same(c.row, d)) || tracks(c.row) >= needed;
    if (fits) dropped.set(c.row, "place");
  }

  // 3. A strong candidate with a cell that reads like dropped furniture: the
  // journal's foot opening the first page's head, next to the preprint date.
  // A row of two cells or more may match a cell of dropped furniture too: the
  // W-9's "Form W-9 (Rev. 3-2024)", beside each later page's number in its
  // head, beside its catalog number at the first page's foot. A row of one
  // cell never does: amsart's running heads repeat the author's name and the
  // title, and the first page sets them alone on their lines.
  const byKey = new Map<string, Row>();
  const byCell = new Map<string, Row>();
  const keep = (map: Map<string, Row>, key: string, d: Row) => {
    if (/\p{L}.*\p{L}/u.test(key) && key.length >= 8 && !map.has(key)) map.set(key, d);
  };
  for (const d of dropped.keys()) {
    keep(byKey, d.key, d);
    for (const line of d.lines) for (const cell of line.cells) keep(byCell, keyOf(cell.text), d);
  }
  for (const c of strong) {
    if (dropped.has(c.row)) continue;
    const keys = c.row.lines.flatMap((l) => l.cells.map((cell) => keyOf(cell.text)));
    const matches = (map: Map<string, Row>) =>
      keys.some((k) => {
        const d = map.get(k);
        return d !== undefined && closeSize(c.row, d);
      });
    // Set smaller than the body, a row of cells needs no place outside the
    // other pages' text: the W-9's later pages run their text lower than
    // its first page's foot.
    const whole = matches(byKey) && outside(c);
    const part = keys.length >= 2 && matches(byCell) && (outside(c) || c.row.size < bodySize * 0.95);
    if (whole || part) dropped.set(c.row, "cell");
  }

  // 4. A printer's mark on a scan: a short foot under the text of the
  // other pages, a job number ("13061°—22") or its words of four letters or
  // more on no other line of the document (the OCR read a bulletin's
  // "9218°—13——1" as "Geass ay").
  const scanned = new Set(pages.flatMap((_, p) => (scans?.[p] ? [pageNumbers?.[p] ?? p] : [])));
  const seen = new Map<string, number>();
  for (const row of rows.flat()) for (const w of new Set(wordsOf(row.text))) seen.set(w, (seen.get(w) ?? 0) + 1);
  for (const c of candidates) {
    if (c.side !== "foot" || !scanned.has(c.row.page) || dropped.has(c.row) || c.row.words > 3 || c.row.text.length > 16) continue;
    const long = wordsOf(c.row.text).filter((w) => w.length >= 4);
    const mark = JOB_MARK_RE.test(c.row.text) || (long.length > 0 && long.every((w) => seen.get(w) === 1));
    if (mark && outside(c)) dropped.set(c.row, "mark");
  }

  const drops: FurnitureDrop[] = [];
  for (const row of specks) dropped.set(row, "mark");
  for (const [row, why] of dropped) for (const line of row.lines) drops.push({ page: row.page, line, why });

  // 5. A line of one to four digits in the top or bottom 8% of its page.
  const gone = new Set(drops.map((d) => d.line));
  for (const [p, lines] of pages.entries()) {
    const h = pageHeights[p];
    for (const line of lines) {
      if (gone.has(line) || !/^\d{1,4}\.?$/.test(line.text) || (line.y >= h * 0.08 && line.y <= h * 0.92)) continue;
      drops.push({ page: pageNumbers?.[p] ?? p, line, why: "band" });
    }
  }
  return drops;
}

// The pages' lines without their furniture.
export function dropFurniture(pages: Line[][], pageHeights: number[], pageNumbers?: number[], scans?: boolean[]): Line[][] {
  const gone = new Set(findFurniture(pages, pageHeights, pageNumbers, scans).map((d) => d.line));
  return pages.map((lines) => lines.filter((l) => !gone.has(l)));
}

// ── Rows and candidates ─────────────────────────────────────────────────────

// A line without words (a ruled table the lattice took out of the flow, as
// one line at its top edge) is never furniture, whatever its place.
function rowsOf(lines: Line[], page: number, height: number): Row[] {
  const groups: Line[][] = [];
  for (const line of lines.filter((l) => l.text.trim()).sort((a, b) => b.y - a.y)) {
    const group = groups[groups.length - 1];
    if (group && group[0].y - line.y <= Math.max(1.5, 0.3 * Math.min(group[0].size, line.size))) group.push(line);
    else groups.push([line]);
  }
  return groups.map((group) => {
    const lines = group.sort((a, b) => a.x - b.x);
    const text = lines.map((l) => l.text.replace(/\t/g, " ")).join(" ").replace(/\s+/g, " ").trim();
    const longest = lines.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    let boldChars = 0;
    let chars = 0;
    for (const l of lines) {
      chars += l.text.length;
      for (const r of l.runs) if (r.bold) boldChars += r.end - r.start;
    }
    const lone = LONE_NUMBER_RE.exec(text);
    const tokens = text.split(" ");
    const bold = chars > 0 && boldChars / chars >= 0.5;
    // A page number at the row's start or end is bare digits: "3." and
    // "(3)" number a heading or an item. A bold row's leading number is a
    // heading's ("3 Results") unless it stands in a cell of its own.
    const edges = [
      bold && lines[0].cells[0]?.text.trim() !== tokens[0] ? "" : tokens[0],
      tokens.length > 1 ? tokens[tokens.length - 1] : "",
    ];
    const numbers = lone
      ? [/^\d/.test(lone[1]) ? Number(lone[1]) : romanValue(lone[1])]
      : tokens.length > 1
        ? edges.filter((t) => /^\d{1,4}$/.test(t)).map(Number)
        : [];
    const key = keyOf(text);
    // The size most of the row's characters are set in: a head's number set
    // larger than its words (a 12.8 pt "1" in the 8.5 pt head "第 1 節 …",
    // cjk-mic-whitepaper-r06-1-2-1) leaves the row at its words' size.
    const bySize = new Map<number, number>();
    for (const l of lines) {
      for (const i of l.items) {
        const size = Math.round(i.size * 10) / 10;
        bySize.set(size, (bySize.get(size) ?? 0) + i.str.trim().length);
      }
    }
    const size = bySize.size > 0 ? [...bySize].reduce((a, b) => (b[1] > a[1] ? b : a))[0] : longest.size;
    return {
      page,
      lines,
      y: group[0].y,
      top: height - group[0].y,
      bottom: group[0].y,
      size,
      bold,
      text,
      words: tokens.length,
      key,
      letters: key.replace(/[^\p{L}]/gu, ""),
      longWords: key.split(/[^\p{L}]+/u).filter((w) => w.length >= 4),
      numbers,
      lone: lone !== null,
    };
  });
}

// A row's words of two letters or more, lower case.
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/\p{L}{2,}/gu) ?? [];
}

function keyOf(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function romanValue(s: string): number {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  const chars = s.toLowerCase();
  let total = 0;
  for (let i = 0; i < chars.length; i++) {
    const v = values[chars[i]];
    total += v < (values[chars[i + 1]] ?? 0) ? -v : v;
  }
  return total;
}

// The body text's size (the lines longer than 40 characters, as parsePdf
// measures it) and leading: the median gap between two rows of body text
// (both longer than 40 characters, of one size). A formula sheet has few of
// them; there the tight pairs (at most 1.6 times the size apart) decide,
// since its displays set most rows 1.8 lines apart. A ruled table's rows
// count toward the size, as they do in parsePdf: without them a statement
// made of tables took its size from its notes, and its head, set at the
// size of the rows, read as larger than the body (Apple's "Apple Inc.").
function measures(pages: Line[][], rows: Row[][]): { lead: number; bodySize: number } {
  const long = pages
    .flat()
    .flatMap((l) => l.table?.lines ?? [l])
    .filter((l) => l.text.length > 40)
    .map((l) => l.size);
  const sizes = rows.flat().map((r) => r.size);
  const bodySize = long.length > 0 ? median(long) : sizes.length > 0 ? median(sizes) : 10;
  const body: number[] = [];
  const tight: number[] = [];
  const loose: number[] = [];
  for (const pageRows of rows) {
    for (let i = 0; i + 1 < pageRows.length; i++) {
      const [a, b] = [pageRows[i], pageRows[i + 1]];
      const gap = a.y - b.y;
      if (Math.abs(a.size - b.size) >= 0.6 || gap < a.size || gap > a.size * 2.2) continue;
      loose.push(gap);
      if (gap <= a.size * 1.6) tight.push(gap);
      if (a.text.length > 40 && b.text.length > 40) body.push(gap);
    }
  }
  const lead =
    body.length >= 10 ? median(body) : tight.length >= 5 ? median(tight) : loose.length >= 5 ? median(loose) : 1.45 * bodySize;
  return { lead, bodySize };
}

// A page's first and last rows. Up to two rows each: the Supreme Court sets
// its head in two ("2 TRUMP v. ANDERSON", then "Per Curiam").
function candidatesOf(rows: Row[], lead: number): Candidate[] {
  const n = rows.length;
  if (n === 0) return [];
  if (n === 1) return [{ row: rows[0], side: "head", strong: true }, { row: rows[0], side: "foot", strong: true }];
  const out: Candidate[] = [];
  const apart = (a: Row, b: Row) => Math.abs(a.y - b.y) > 1.4 * lead;
  const close = (a: Row, b: Row) => Math.abs(a.y - b.y) <= 1.2 * lead;
  for (const side of ["head", "foot"] as const) {
    const [r0, r1, r2] = side === "head" ? [rows[0], rows[1], rows[2]] : [rows[n - 1], rows[n - 2], rows[n - 3]];
    if (apart(r0, r1)) {
      out.push({ row: r0, side, strong: true });
      if (r2) out.push({ row: r1, side, strong: apart(r1, r2) });
    } else if (r2 && close(r0, r1) && apart(r1, r2)) {
      out.push({ row: r0, side, strong: true }, { row: r1, side, strong: true });
    } else {
      out.push({ row: r0, side, strong: false });
    }
  }
  return out;
}

// ── Comparing rows ──────────────────────────────────────────────────────────

// The same words, digits aside, in any order: facing pages set a head's
// parts in mirror order ("第 1 節 <title>" on one, "<title> 第 1 節" on the
// next, cjk-mic-whitepaper-r06-1-2-1). OCR spells a foot differently on
// each page ("CHALLENGE TO APOLLO", "CHALLENGE TO _POLLO", "CHRLLENGE TO
// APOLLO"): letters within a fifth, and every word of four letters or more
// close to one of the other's, so two captions that differ in one word
// stay apart.
function sameWords(a: Row, b: Row): boolean {
  if (a.key === b.key) return true;
  const words = (key: string) => key.split(" ").sort().join(" ");
  if (words(a.key) === words(b.key)) return true;
  const n = Math.min(a.letters.length, b.letters.length);
  if (n < 10 || editDistance(a.letters, b.letters, Math.floor(n * 0.2)) > Math.floor(n * 0.2)) return false;
  const near = (w: string, list: string[]) => list.some((v) => editDistance(w, v, Math.floor(w.length / 3)) <= Math.floor(w.length / 3));
  return a.longWords.every((w) => near(w, b.longWords)) && b.longWords.every((w) => near(w, a.longWords));
}

function closeSize(a: Row, b: Row): boolean {
  return Math.max(a.size, b.size) <= Math.min(a.size, b.size) * 1.2;
}

function samePlace(c: Candidate, d: Row): boolean {
  const edge = (r: Row) => (c.side === "head" ? r.top : r.bottom);
  return Math.abs(edge(c.row) - edge(d)) <= 2 && Math.abs(c.row.size - d.size) <= 0.6 && c.row.bold === d.bold;
}

// Levenshtein distance, stopping once it passes max. Two rows of the table,
// reused: a 517-page book compares its heads and feet pairwise.
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
