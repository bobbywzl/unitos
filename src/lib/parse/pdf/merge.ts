// Blocks cut by a page break: a paragraph, a list, or a table joins its other
// half on the next page, and the block keeps where each later page begins.

import { CAPTION_RE } from "@/lib/parse/pdf/figures";
import { BULLET_RE } from "@/lib/parse/pdf/segment";
import type { PageBreak, Segment } from "@/lib/parse/pdf/types";

// ── Cross-page merges ───────────────────────────────────────────────────────

export function shiftSpansInto(target: Segment, source: Segment, offset: number) {
  if (!source.runs) return;
  target.runs = [
    ...(target.runs ?? []),
    ...source.runs.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset })),
  ];
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
    if (listBreak ? tail.type !== "LIST" || Boolean(tail.tocEntries) : tail.type !== "PARAGRAPH" || !/^[a-z($€£0-9"'“]/.test(tail.text)) continue;
    out.splice(k, 1);
    out.splice(b, 0, tail);
  }
  return out;
}

export function mergeAcrossPages(input: Segment[]): Segment[] {
  const segments = liftFloatsOffParagraphBreaks(input);
  const out: Segment[] = [];
  for (const segment of segments) {
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
      /[\p{L}\d,;\-–—]$/u.test(prev.text) &&
      (/^[a-z($€£0-9"'“]/.test(segment.text) ||
        // "… the" | "AAR only stages": a paragraph that ends without a stop
        // is unfinished, whatever the case of the next page's first word.
        (/\s\p{L}+$/u.test(prev.text) && prev.text.length > 60))
    ) {
      const glue = /[A-Za-z0-9][-–]$/.test(prev.text) && /^[A-Za-z0-9(]/.test(segment.text) ? "" : " ";
      const offset = prev.text.length + glue.length;
      prev.breaks = joinBreaks(prev, segment, offset);
      prev.text = prev.text + glue + segment.text;
      shiftSpansInto(prev, segment, offset);
      continue;
    }

    // List split by the page break: LIST + LIST concatenate.
    if (
      segment.type === "LIST" &&
      prev.type === "LIST" &&
      Boolean(prev.tocEntries) === Boolean(segment.tocEntries)
    ) {
      const offset = prev.text.length + 1;
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
    if (
      segment.type === "PARAGRAPH" &&
      prev.type === "LIST" &&
      !prev.tocEntries &&
      !/[.!?…:]$/.test(prev.text.trim()) &&
      /^[a-z($€£0-9"'“]/.test(segment.text)
    ) {
      const lastNum = lastListNumber(prev.text);
      const offset = prev.text.length + 1;
      prev.breaks = joinBreaks(prev, segment, offset);
      prev.text = prev.text + " " + segment.text;
      shiftSpansInto(prev, segment, offset);
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
    if (segment.type === "LIST" && prev.type === "PARAGRAPH" && prev.listItem && !segment.tocEntries) {
      const marker = BULLET_RE.test(prev.text) ? "" : "- ";
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
    if (segment.type === "PARAGRAPH" && segment.listItem && prev.type === "LIST" && !prev.tocEntries) {
      const marker = BULLET_RE.test(segment.text) ? "" : "- ";
      const offset = prev.text.length + 1 + marker.length;
      // The page starts at the item's line, its marker included.
      prev.breaks = joinBreaks(prev, segment, prev.text.length + 1);
      prev.text = prev.text + "\n" + marker + segment.text;
      shiftSpansInto(prev, segment, offset);
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
