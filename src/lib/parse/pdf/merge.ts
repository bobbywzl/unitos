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

// The second part goes on with the first on their page: the first ends
// mid-sentence and the second opens lowercase or with a parenthesis ("…3D
// fermionic TO" | "(fTO) characterized…", arxiv-2504-02736), or a column
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
  if (/[a-z,;\-–—]$/.test(prev.text) && /^[a-z(]/.test(next.text)) return true;
  if (prev.text.length <= 60 || !/\s[\p{L}\p{M}]+$/u.test(prev.text)) return false;
  if (/^[a-z(]/.test(next.text)) return true;
  const size = prev.lineSize ?? 10;
  const columnBreak = prev.box !== undefined && next.box !== undefined && next.box.y2 > prev.box.y1 && next.box.x1 > prev.box.x2 - size;
  return columnBreak && /^\p{Lu}/u.test(next.text);
}

// A paragraph's halves on one page join, and a float set between them (a
// table atop the next column: arxiv-2504-02736 p3 and p4) follows the
// paragraph.
export function joinOnPage(input: Segment[]): Segment[] {
  const segments = [...input];
  for (let b = 1; b < segments.length; b++) {
    if (!isFloat(segments[b]) || segments[b].page !== segments[b - 1].page) continue;
    let k = b;
    while (k < segments.length && segments[k].page === segments[b].page && isFloat(segments[k])) k++;
    if (k < segments.length && continuesOnPage(segments[b - 1], segments[k])) segments.splice(b, 0, ...segments.splice(k, 1));
  }
  const out: Segment[] = [];
  for (const segment of segments) {
    const prev = out[out.length - 1];
    if (prev && continuesOnPage(prev, segment)) {
      shiftSpansInto(prev, segment, joinWrapped(prev, segment.text));
      prev.spaceAfter = segment.spaceAfter;
      continue;
    }
    out.push(segment);
  }
  return out;
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

// A page-top float (figure, table, its caption) between the two halves of a
// paragraph: the halves join and the float follows the paragraph.
function liftFloatsOffParagraphBreaks(segments: Segment[]): Segment[] {
  const out = [...segments];
  const isFloat = (s: Segment) =>
    s.type === "FIGURE" || s.type === "TABLE" || (s.type === "PARAGRAPH" && CAPTION_RE.test(s.text));
  for (let b = 1; b < out.length; b++) {
    const prev = out[b - 1];
    if (out[b].page === prev.page) continue;
    // A list cut by the page break continues under the floats too (import
    // compare loop finding: a rubric list split in two by a figure).
    const listBreak = prev.type === "LIST" && !prev.tocEntries;
    if (!listBreak && (prev.type !== "PARAGRAPH" || /[.!?:…"”)]$/.test(prev.text.trim()))) continue;
    let k = b;
    while (k < out.length && out[k].page === out[b].page && isFloat(out[k])) k++;
    if (k === b || k >= out.length) continue;
    const tail = out[k];
    if (tail.page !== out[b].page) continue;
    // A references entry's end at the page's top goes with the list after it.
    const lift = listBreak && hangingTail(tail, out[k + 1]) ? 2 : 1;
    if (lift === 1 && (listBreak ? tail.type !== "LIST" || Boolean(tail.tocEntries) : tail.type !== "PARAGRAPH" || !/^[a-z($€£0-9"'“]/.test(tail.text))) continue;
    out.splice(b, 0, ...out.splice(k, lift));
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

    // Paragraph that continues across the page break.
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "PARAGRAPH" &&
      !prev.listItem &&
      // A letter may end in a mark: a hat over 𝒮 has no precomposed form.
      /[\p{L}\p{M}\d,;\-–—]$/u.test(prev.text) &&
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
