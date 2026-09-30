// Blocks cut by a page break: a paragraph, a list, or a table joins its other
// half on the next page, and the block keeps where each later page begins.

import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { BULLET_RE, follows, readMarker } from "@/lib/parse/pdf/markers";
import { joinWrapped } from "@/lib/parse/pdf/text";
import type { PageBreak, Segment } from "@/lib/parse/pdf/types";

// ── Joins on one page ───────────────────────────────────────────────────────

// A table, a captioned figure, or a caption: set where it fits, it may stand
// between a paragraph's halves. A display's crop (a figure with no "Figure
// N" caption) stands where the sentence puts it.
const isFloat = (s: Segment) =>
  s.type === "TABLE" || ((s.type === "FIGURE" || s.type === "PARAGRAPH") && CAPTION_RE.test(s.text));

// A figure's labels the figure did not take, read as lines or as a
// display's crop, are set smaller than the paragraph around them: next to a
// float, they are the float's ("ac-" | labels, a figure | "cessible": arXiv
// 2411.19946).
const isLabel = (s: Segment, paragraph: Segment) =>
  s.type !== "HEADING" && paragraph.lineSize !== undefined && s.lineSize !== undefined && s.lineSize < paragraph.lineSize * 0.9;

// A part that ends in an abbreviation ends no sentence when the next opens
// with a number or a lowercase word ("(Zhuravlev et al. 2010; Erban et
// al." | "2014) and …": Springer p. 1).
const ABBREVIATION_END_RE = /(?:\bet al|\be\.g|\bi\.e|\bcf|\bvs|\bFigs?|\bEqs?|\bRefs?|\bSecs?|\bNo|\bpp?)\.$/;

// The next part goes on the first's sentence: it opens lowercase or with a
// parenthesis, or with a number that closes a parenthesis the first left
// open ("(Federico," | "2016). This leads…") or follows a word that takes
// one ("40 CFR part" | "178. To ensure…"). A number after any other word
// opens something of its own: an algorithm's line ("8: end for"), a
// section's heading ("3.2.3 Interim Conclusion.").
function goesOn(prev: string, next: string): boolean {
  if (/^[a-z(]/.test(next)) return true;
  if (!/^\d/.test(next)) return false;
  const open = (prev.match(/\(/g) ?? []).length - (prev.match(/\)/g) ?? []).length;
  if (open > 0 && /^\d[\d.,–-]*[a-z]?\)/.test(next)) return true;
  return /\b(?:parts?|sections?|chapters?|pages?|pp?|figures?|figs?|tables?|eqs?|equations?|nos?|vol|volumes?|articles?|rules?|items?|steps?|lines?|appendix|§)\.?$/i.test(prev.trimEnd());
}

// The second part goes on with the first on their page: the first ends
// mid-sentence and the second goes on its sentence (goesOn: "…3D fermionic
// TO" | "(fTO) characterized…", arxiv-2504-02736), or a column
// break cuts a sentence before a capitalized word (the first ends in a
// word, the second starts higher on the page and right of it). A second
// part that opens with no lowercase word, set at half the first's size or
// less, is no part of it: a page's keywords line and the licence line at
// its foot (real-jnlp-31-47-p1).
function continuesOnPage(prev: Segment, next: Segment): boolean {
  if (prev.type !== "PARAGRAPH" || next.type !== "PARAGRAPH" || prev.page !== next.page) return false;
  if (prev.listItem || next.listItem || prev.text.includes("\n")) return false;
  const sizes = prev.lineSize !== undefined && next.lineSize !== undefined ? [prev.lineSize, next.lineSize] : undefined;
  if (sizes && !/^[a-z]/.test(next.text) && Math.abs(sizes[0] - sizes[1]) > Math.min(...sizes) * 0.5) return false;
  // Two links, each on its own line, are two paragraphs: a Google Docs
  // export's list of links read as one. "…available at" and a link still
  // join.
  if (/(?:https?:\/\/|www\.)\S*$/.test(prev.text) && /^(?:https?:\/\/|www\.)/.test(next.text)) return false;
  if ((/[a-z,;\-–—]$/.test(prev.text) || ABBREVIATION_END_RE.test(prev.text)) && goesOn(prev.text, next.text)) return true;
  if (prev.text.length <= 60 || !/\s[\p{L}\p{M}]+$/u.test(prev.text)) return false;
  if (/^[a-z(]/.test(next.text)) return true;
  const size = prev.lineSize ?? 10;
  const columnBreak = prev.box !== undefined && next.box !== undefined && next.box.y2 > prev.box.y1 && next.box.x1 > prev.box.x2 - size;
  return columnBreak && /^\p{Lu}/u.test(next.text);
}

// A paragraph's halves on one page join, and a float set between them (a
// table atop the next column: arxiv-2504-02736 p3 and p4), with the labels
// its figure left, follows the paragraph.
export function joinOnPage(input: Segment[]): Segment[] {
  const segments = [...input];
  for (let b = 1; b < segments.length; b++) {
    const paragraph = segments[b - 1];
    const inRun = (s: Segment) => isFloat(s) || isLabel(s, paragraph);
    if (isFloat(paragraph) || !inRun(segments[b]) || segments[b].page !== paragraph.page) continue;
    let k = b;
    while (k < segments.length && segments[k].page === segments[b].page && inRun(segments[k])) k++;
    if (!segments.slice(b, k).some(isFloat)) continue;
    if (k < segments.length && continuesOnPage(paragraph, segments[k])) segments.splice(b, 0, ...segments.splice(k, 1));
  }
  const out: Segment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (prev && continuesOnPage(prev, segment)) {
      firstLineLayout(prev, segment);
      shiftSpansInto(prev, segment, joinWrapped(prev, segment.text));
      joinLayout(prev, segment);
      continue;
    }
    if (prev && itemGoesOn(prev, segment)) {
      shiftSpansInto(prev, segment, joinWrapped(prev, segment.text));
      joinLayout(prev, segment);
      continue;
    }
    out.push(segment);
  }
  return out;
}

// A list's last item that a column break cuts goes on in the next column:
// the item stops mid-sentence and the part opens lowercase, higher on the
// page and right of it ("• We propose RONA, a novel prompting strategy" |
// "that leverages Coherence Relations …": arXiv 2503.10997 p. 2).
function itemGoesOn(list: Segment, next: Segment): boolean {
  if (list.type !== "LIST" || list.tocEntries || next.type !== "PARAGRAPH" || next.listItem || list.page !== next.page) return false;
  if (/[.!?:…"”)]$/.test(list.text.trim()) || !/^\p{Ll}/u.test(next.text) || !list.box || !next.box) return false;
  const size = list.lineSize ?? 10;
  return next.box.y2 > list.box.y1 && next.box.x1 > list.box.x2 - size;
}

const INDENT_TOKEN_RE = /\s*\bindent-(?:first|hanging|block)\b/g;

// A paragraph's first line read alone, joined to the lines after it: the
// paragraph's lines stand where the later part's do, and the first line's
// inset against them is its first-line indent. Kept as the first part's,
// the one line's inset set the whole paragraph in (a right column's first
// line, 22 pt in: Elsevier).
function firstLineLayout(first: Segment, rest: Segment) {
  const size = first.lineSize ?? 10;
  if (!first.box || first.box.y2 - first.box.y1 > size * 1.6) return;
  const at = (first.indent?.left ?? 0) + (first.indent?.first ?? 0);
  const body = rest.indent?.left ?? 0;
  const shift = at - body;
  const indent = Math.abs(shift) >= 1 ? { left: body, first: shift } : body > 0 ? { left: body, first: 0 } : undefined;
  const token = !indent ? null : indent.first > 0 ? "indent-first" : indent.first < 0 ? "indent-hanging" : "indent-block";
  const html = first.html?.replace(INDENT_TOKEN_RE, "").replace(/class="\s*"/, "");
  first.html = token ? withToken(html && /\bclass="/.test(html) ? html : undefined, "p", token) : html && /\bclass="/.test(html) ? html : undefined;
  if (indent) first.indent = indent;
  else delete first.indent;
}

// ── Cross-page merges ───────────────────────────────────────────────────────

export function shiftSpansInto(target: Segment, source: Segment, offset: number) {
  if (!source.runs) return;
  target.runs = [
    ...(target.runs ?? []),
    ...source.runs.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
  ];
}

// A block joined across a page break takes the space the page leaves under
// its later part (the first part's page ended under it, and a list that ran
// from one page to the next lost the blank line under it); a list keeps the
// first part's layout, and takes the later part's
// where the first shows none (one item measures no spacing; a depth, a
// justified item).
function joinLayout(prev: Segment, next: Segment) {
  prev.spaceAfter = next.spaceAfter;
  if (prev.type === "LIST") {
    if (!prev.text.includes("\n")) prev.itemSpace ??= next.itemSpace;
    if (next.listIndents && next.listIndents.length > (prev.listIndents?.length ?? 0)) prev.listIndents = [...(prev.listIndents ?? []), ...next.listIndents.slice(prev.listIndents?.length ?? 0)];
  }
  if (!ALIGN_RE.test(prev.html ?? "") && /\bjustify\b/.test(next.html ?? "")) prev.html = withToken(prev.html, prev.type === "LIST" ? "ul" : "p", "justify");
}

const ALIGN_RE = /\bclass="[^"]*\b(?:center|right|justify)\b/;

// A block's html with one more layout token on its class.
function withToken(html: string | undefined, tag: string, token: string): string {
  return html && /\bclass="/.test(html) ? html.replace(/\bclass="/, `class="${token} `) : `<${tag} class="${token}"></${tag}>`;
}

// A lone item joins a list across the page break only as one of its items:
// no footnote, set where the list's items are, and its marker of the list's
// family and next in its sequence (a line with no marker, a bulleted list's).
// With the running head gone from between them, a one-line paragraph and a
// footnote at a page's end joined the next page's list.
function itemOfList(item: Segment, list: Segment, before: boolean): boolean {
  if (item.footnote) return false;
  if (item.box && list.box && Math.abs(item.box.x1 - list.box.x1) > (list.lineSize ?? 10) * 1.5) return false;
  const lines = list.text.split("\n");
  const next = readMarker({ text: (before ? lines[0] : lines[lines.length - 1]).trimStart(), runs: [] });
  const own = readMarker({ text: item.text, runs: item.runs ?? [] });
  if (!own) return next?.family === "bullet";
  if (!next) return false;
  return before ? follows(own, next) : follows(next, own);
}

function lastListNumber(text: string): number | null {
  const matches = [...text.matchAll(/(?:^|\n)(\d{1,2})[.)]\s/g)];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
}

// The page a segment's first words are on, and the page its last words are on.
export function firstPageOf(s: Segment): number {
  return s.firstPage ?? s.page;
}
function lastPageOf(s: Segment): number {
  return s.breaks && s.breaks.length > 0 ? s.breaks[s.breaks.length - 1].page : firstPageOf(s);
}

// target's page starts once source's words join its text at offset (target's
// own text moved by shift): the join is a page start when source's words sit
// on a later page than target's last words. The merge also joins a segment
// on the page target already ends on, and that is no page start. Segments
// reach the merge on one page each, so source brings no page starts of its own.
function joinBreaks(target: Segment, source: Segment, offset: number, shift = 0): PageBreak[] {
  const breaks = (target.breaks ?? []).map((b) => ({ offset: b.offset + shift, page: b.page }));
  const page = firstPageOf(source);
  if (page > lastPageOf(target)) breaks.push({ offset, page });
  return breaks;
}

// A float (figure, table, its caption, and the labels its figure left)
// between the two halves of a paragraph cut by the page break: the halves
// join, and a float atop the next page follows the paragraph, one at the
// foot of the first page comes before it (each block after the page it
// stands on has begun). Pages of floats between the halves keep them
// apart: after the paragraph, those floats would stand past the next
// page's start, and an import's page starts only rise (lib/docs/import.ts).
function liftFloatsOffParagraphBreaks(segments: Segment[]): Segment[] {
  const out = [...segments];
  // A display's crop stands where the sentence puts it.
  const isPageFloat = (s: Segment) =>
    (s.type === "FIGURE" && !s.mathCrop) || s.type === "TABLE" || (s.type === "PARAGRAPH" && CAPTION_RE.test(s.text));
  // Floats a lift set after a paragraph's joined part: a join past them
  // would set them past the next page's start, so the halves stay apart.
  const following = new Set<Segment>();
  for (let b = 1; b < out.length; b++) {
    if (out[b].page === out[b - 1].page) continue;
    // The page's last paragraph, past the figures, tables, and whole
    // captions set after it on its page (a caption that ends mid-sentence
    // goes on over the page), and past a short line under it set smaller (a
    // license line at the page's foot: IEEE Access p. 1).
    let a = b - 1;
    let footLine = false;
    for (; a > 0 && out[a - 1].page === out[a].page; a--) {
      if (isPageFloat(out[a]) && (out[a].type !== "PARAGRAPH" || /[.!?:)]$/.test(out[a].text.trim()))) continue;
      if (out[a].type !== "PARAGRAPH" || out[a - 1].type !== "PARAGRAPH" || out[a].text.length >= 200 || !isLabel(out[a], out[a - 1])) break;
      footLine = true;
    }
    const prev = out[a];
    // A list cut by the page break continues under the floats too (import
    // compare loop finding: a rubric list split in two by a figure). A
    // caption the break cuts goes on by itself.
    const listBreak = prev.type === "LIST" && !prev.tocEntries;
    const ended = /[.!?:…"”)]$/.test(prev.text.trim()) && !ABBREVIATION_END_RE.test(prev.text.trim());
    if (!listBreak && (prev.type !== "PARAGRAPH" || isPageFloat(prev) || ended)) continue;
    let k = b;
    while (k < out.length && out[k].page === out[b].page && (isPageFloat(out[k]) || isLabel(out[k], prev))) k++;
    if (k >= out.length || (k === b && a === b - 1) || !(footLine || out.slice(a + 1, k).some(isPageFloat))) continue;
    const tail = out[k];
    if (tail.page !== out[b].page) continue;
    // A references entry's end at the page's top goes with the list after it.
    const lift = listBreak && hangingTail(tail, out[k + 1]) ? 2 : 1;
    if (lift === 1 && (listBreak ? tail.type !== "LIST" || Boolean(tail.tocEntries) : tail.type !== "PARAGRAPH" || !/^[a-z($€£0-9"'“]/.test(tail.text))) continue;
    if (out.slice(a + 1, b).some((s) => following.has(s))) continue;
    for (const s of out.slice(b, k)) following.add(s);
    const joined = out.splice(k, lift);
    const floats = out.splice(a + 1, b - a - 1);
    out.splice(a, 0, ...floats);
    out.splice(a + floats.length + 1, 0, ...joined);
  }
  return out;
}

// The end of a list's entry that a page break cut: a paragraph set at the
// hanging indent of the entries that follow it on its page (a references
// entry's end, "In Proceedings of …", arXiv 2503.10997).
function hangingTail(tail: Segment, after: Segment | undefined): boolean {
  const size = after?.lineSize ?? 10;
  return (
    tail.type === "PARAGRAPH" &&
    after?.type === "LIST" &&
    after.page === tail.page &&
    tail.box !== undefined &&
    after.box !== undefined &&
    tail.box.x1 > after.box.x1 + size * 0.3 &&
    tail.box.x1 < after.box.x1 + size * 3
  );
}

export function mergeAcrossPages(input: Segment[]): Segment[] {
  const segments = liftFloatsOffParagraphBreaks(input);
  const out: Segment[] = [];
  for (const [index, segment] of segments.entries()) {
    const prev = out[out.length - 1];
    if (!prev || segment.page === prev.page) {
      out.push(segment);
      continue;
    }

    // Paragraph that continues across the page break. A lone line set in
    // at a page's foot may be a paragraph's first line: it goes on into a
    // part that opens lowercase ("…the difficulty of reliably elim-" |
    // "inating default tendencies…", arXiv 2506.06352).
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "PARAGRAPH" &&
      (!prev.listItem || /^\p{Ll}/u.test(segment.text)) &&
      // A letter may end in a mark: a hat over 𝒮 has no precomposed form.
      (/[\p{L}\p{M}\d,;\-–—]$/u.test(prev.text) || (ABBREVIATION_END_RE.test(prev.text) && goesOn(prev.text, segment.text))) &&
      // A numbered heading read as a paragraph starts its own block: with
      // the running head gone from between them, "6. Relations and arrows"
      // joined the display above it (the synthetic formula sheet).
      !/^\d+(?:\.\d+)*\.\s+\p{Lu}/u.test(segment.text) &&
      (/^[a-z($€£0-9"'“]/.test(segment.text) ||
        // "… the" | "AAR only stages": a paragraph that ends without a stop
        // is unfinished, whatever the case of the next page's first word.
        (/\s[\p{L}\p{M}]+$/u.test(prev.text) && prev.text.length > 60))
    ) {
      const offset = joinWrapped(prev, segment.text);
      prev.breaks = joinBreaks(prev, segment, offset);
      shiftSpansInto(prev, segment, offset);
      joinLayout(prev, segment);
      continue;
    }

    // List split by the page break: LIST + LIST concatenate.
    if (
      segment.type === "LIST" &&
      prev.type === "LIST" &&
      Boolean(prev.tocEntries) === Boolean(segment.tocEntries)
    ) {
      const offset = prev.text.length + 1;
      joinLayout(prev, segment);
      prev.breaks = joinBreaks(prev, segment, offset);
      prev.text = prev.text + "\n" + segment.text;
      shiftSpansInto(prev, segment, offset);
      if (segment.tocEntries) {
        prev.tocEntries = [
          ...(prev.tocEntries ?? []),
          ...segment.tocEntries.map((e) => ({ ...e, start: e.start + offset, end: e.end + offset })),
        ];
      }
      continue;
    }

    // A numbered list whose last item wraps into a paragraph on the next page:
    // the paragraph's leading words finish the item, and any "N." markers that
    // continue the numbering become items again. Checked before item-append so
    // a mid-sentence tail continues the item instead of becoming a new one.
    // The tail starts where the list's lines start, never well right of them:
    // a form's centered hint in parentheses under an item is its own line.
    // A tail set at the hanging indent of the entries after it finishes the
    // last entry whatever its words.
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "LIST" &&
      !prev.tocEntries &&
      (hangingTail(segment, segments[index + 1]) ||
        (!/[.!?…:]$/.test(prev.text.trim()) &&
          /^[a-z($€£0-9"'“]/.test(segment.text) &&
          !(segment.box && prev.box && segment.box.x1 > prev.box.x1 + (prev.lineSize ?? 10) * 3)))
    ) {
      const lastNum = lastListNumber(prev.text);
      const offset = prev.text.length + 1;
      prev.breaks = joinBreaks(prev, segment, offset);
      prev.text = prev.text + " " + segment.text;
      shiftSpansInto(prev, segment, offset);
      prev.spaceAfter = segment.spaceAfter;
      if (lastNum !== null) {
        let expect = lastNum + 1;
        const re = /([ \n])(\d{1,2})([.)] )/g;
        let m: RegExpExecArray | null;
        const breaks: number[] = [];
        while ((m = re.exec(prev.text)) !== null) {
          if (m.index + 1 < offset) continue;
          if (Number(m[2]) === expect) {
            breaks.push(m.index);
            expect++;
          }
        }
        const chars = prev.text.split("");
        for (const at of breaks) chars[at] = "\n";
        prev.text = chars.join("");
      }
      continue;
    }

    // A lone item cut off at the page end joins the LIST that follows.
    if (segment.type === "LIST" && prev.type === "PARAGRAPH" && prev.listItem && !segment.tocEntries && itemOfList(prev, segment, true)) {
      const marker = BULLET_RE.test(prev.text) ? "" : "• ";
      const offset = marker.length;
      // The list now starts with the item's words, on the item's page; its
      // page stays the list's, the page the merge compares against.
      segment.breaks = joinBreaks(prev, segment, marker.length + prev.text.length + 1, marker.length);
      segment.firstPage = firstPageOf(prev);
      segment.text = marker + prev.text + "\n" + segment.text;
      segment.runs = [
        ...(prev.runs ?? []).map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
        ...(segment.runs ?? []).map((r) => ({
          ...r,
          start: r.start + marker.length + prev.text.length + 1,
          end: r.end + marker.length + prev.text.length + 1,
        })),
      ];
      out.pop();
      out.push(segment);
      continue;
    }
    if (segment.type === "PARAGRAPH" && segment.listItem && prev.type === "LIST" && !prev.tocEntries && itemOfList(segment, prev, false)) {
      const marker = BULLET_RE.test(segment.text) ? "" : "• ";
      const offset = prev.text.length + 1 + marker.length;
      // The page starts at the item's line, its marker included.
      prev.breaks = joinBreaks(prev, segment, prev.text.length + 1);
      prev.text = prev.text + "\n" + marker + segment.text;
      shiftSpansInto(prev, segment, offset);
      prev.spaceAfter = segment.spaceAfter;
      continue;
    }

    // Table split by the page break: same column count concatenates; a
    // repeated header row drops. The html takes the rows the text takes: one
    // <tr> per text row, the header row first. (A cell gap holds "\n", so a
    // "." pattern over the rows matched nothing and the html kept only the
    // first page's rows while the text had them all.)
    if (segment.type === "TABLE" && prev.type === "TABLE" && prev.html && segment.html) {
      const cols = (t: string) => t.split("\n")[0]?.split("\t").length ?? 0;
      if (cols(prev.text) === cols(segment.text)) {
        const prevHeader = prev.text.split("\n")[0];
        let rows = segment.text.split("\n");
        let rowsHtml: string[] = segment.html.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
        if (rows[0] === prevHeader) {
          rows = rows.slice(1);
          rowsHtml = rowsHtml.slice(1);
        }
        if (rows.length > 0) {
          prev.breaks = joinBreaks(prev, segment, prev.text.length + 1);
          prev.text = prev.text + "\n" + rows.join("\n");
          // The first page's last row ended the table: it takes the row gap
          // now, so the table's DOM text stays its text (SPEC.md §5).
          prev.html = prev.html.replace(
            /<\/td><\/tr><\/tbody><\/table>$/,
            () => `<span class="cell-gap">\n</span></td></tr>${rowsHtml.join("")}</tbody></table>`,
          );
        }
        continue;
      }
    }

    out.push(segment);
  }
  return out;
}
