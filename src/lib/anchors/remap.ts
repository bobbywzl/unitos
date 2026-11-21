/** Remap anchor offsets through a block text edit, the way Google Docs moves
    highlights and comments while you type:
    - an edit before the anchor shifts it;
    - an insert inside the anchor grows it;
    - a delete inside the anchor shrinks it;
    - typing over the anchored words keeps the anchor on the replacement;
    - deleting all the anchored words orphans the anchor (visibly, never silently).
    Offsets are remapped at edit time, so anchors never drift between edits. */

type Segment = {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  matched: boolean;
};

function tokenize(s: string) {
  const tokens: { text: string; start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return tokens;
}

/** Split (before, after) into alternating matched and replaced segments, by
    word-level LCS. Matched segments map 1:1; replaced segments map an old span
    (possibly empty = insert) to a new span (possibly empty = delete). */
export function diffSegments(before: string, after: string): Segment[] {
  const a = tokenize(before);
  const b = tokenize(after);

  // The words both texts open with and end with match as they stand: an
  // edit is in the middle. So one cell changed in a sheet of thirty
  // thousand words costs the middle only, and every anchor outside it keeps
  // its place.
  let head = 0;
  while (head < a.length && head < b.length && a[head].text === b[head].text) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail].text === b[b.length - 1 - tail].text) tail++;
  const rows = a.length - head - tail;
  const cols = b.length - head - tail + 1;

  // Matched token pairs: the opening words, the middle via LCS, the ending
  // words. A middle past the budget is treated as replaced whole.
  const pairs: { ai: number; bi: number }[] = [];
  for (let k = 0; k < head; k++) pairs.push({ ai: k, bi: k });
  if (rows > 0 && cols > 1 && rows * (cols - 1) <= 500_000) {
    const dp = new Uint32Array((rows + 1) * cols);
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 2; j >= 0; j--) {
        dp[i * cols + j] =
          a[head + i].text === b[head + j].text
            ? dp[(i + 1) * cols + j + 1] + 1
            : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols - 1) {
      if (a[head + i].text === b[head + j].text) {
        pairs.push({ ai: head + i, bi: head + j });
        i++;
        j++;
      } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  }
  for (let k = tail; k > 0; k--) pairs.push({ ai: a.length - k, bi: b.length - k });

  const segments: Segment[] = [];
  let oldAt = 0;
  let newAt = 0;
  const pushGap = (oldEnd: number, newEnd: number) => {
    if (oldEnd === oldAt && newEnd === newAt) return;
    const sameText =
      before.slice(oldAt, oldEnd) === after.slice(newAt, newEnd) && oldEnd - oldAt > 0;
    segments.push({ oldStart: oldAt, oldEnd, newStart: newAt, newEnd, matched: sameText });
    oldAt = oldEnd;
    newAt = newEnd;
  };
  for (const { ai, bi } of pairs) {
    pushGap(a[ai].start, b[bi].start);
    segments.push({
      oldStart: a[ai].start,
      oldEnd: a[ai].end,
      newStart: b[bi].start,
      newEnd: b[bi].end,
      matched: true,
    });
    oldAt = a[ai].end;
    newAt = b[bi].end;
  }
  pushGap(before.length, after.length);
  return segments;
}

/** Map one offset. bias "start" excludes a pure insert sitting exactly at the
    offset (typing before a highlight stays outside it); bias "end" excludes it
    too (typing after a highlight stays outside it). Replaced spans are included
    whole — a replacement inside the anchor belongs to the anchor. */
function mapPoint(segments: Segment[], off: number, bias: "start" | "end"): number {
  for (const seg of segments) {
    const isInsert = seg.oldStart === seg.oldEnd;
    if (isInsert && seg.oldStart === off) {
      // Pure insert at this exact offset: stay outside it on either side.
      return bias === "start" ? seg.newEnd : seg.newStart;
    }
    if (off >= seg.oldStart && off < seg.oldEnd) {
      if (seg.matched) return seg.newStart + (off - seg.oldStart);
      return bias === "start" ? seg.newStart : seg.newEnd;
    }
  }
  // Past every segment: clamp to the end of the new text.
  const last = segments[segments.length - 1];
  return last ? last.newEnd : off;
}

export function remapRange(
  segments: Segment[],
  start: number,
  end: number,
): { start: number; end: number; orphaned: boolean } {
  const s = mapPoint(segments, start, "start");
  const e = mapPoint(segments, end, "end");
  if (e <= s) return { start, end, orphaned: true };
  return { start: s, end: e, orphaned: false };
}

const CONTEXT = 32; // prefix/suffix length, matches Source capture

export type RemappedAnchor = {
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
  orphaned: boolean;
};

/** Remap one stored anchor through an edit and recapture its quote and context
    from the new text. Orphaned result keeps the old quote — it is what the
    anchor pointed at, and the UI shows it. */
export function remapAnchor(
  segments: Segment[],
  newText: string,
  anchor: { startOffset: number; endOffset: number; quotedText: string },
): RemappedAnchor {
  const r = remapRange(segments, anchor.startOffset, anchor.endOffset);
  // Replaced spans come back whole, so the range can pick up edge whitespace —
  // trim it. A range left with nothing but whitespace is orphaned.
  if (!r.orphaned) {
    while (r.start < r.end && /\s/.test(newText[r.start])) r.start++;
    while (r.end > r.start && /\s/.test(newText[r.end - 1])) r.end--;
    if (r.end <= r.start) r.orphaned = true;
  }
  if (r.orphaned) {
    return {
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      quotedText: anchor.quotedText,
      prefix: "",
      suffix: "",
      orphaned: true,
    };
  }
  return {
    startOffset: r.start,
    endOffset: r.end,
    quotedText: newText.slice(r.start, r.end),
    prefix: newText.slice(Math.max(0, r.start - CONTEXT), r.start),
    suffix: newText.slice(r.end, r.end + CONTEXT),
    orphaned: false,
  };
}
