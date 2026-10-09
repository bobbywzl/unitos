// The window of a change (SPEC.md §7, the plan card): the words that
// differ between a block's text and its new text, with a little of the
// unchanged words on each side, so the reader sees the change itself
// rather than the start of a paragraph that reads the same before and
// after. Client-safe: the plan card and the eval's rendering share it.

export type ChangeWindow = { before: string; after: string; whole: boolean };

const ELLIPSIS = "…";

/** The changed span of `before` → `after`, each with up to `radius`
    characters of the unchanged words around it, cut at a word; `whole`
    when the window shows the whole text. */
export function changeWindow(before: string, after: string, radius = 36): ChangeWindow {
  const a = before.replace(/\s+/g, " ").trim();
  const b = after.replace(/\s+/g, " ").trim();
  if (a === b) return { before: a, after: b, whole: true };
  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(a.length, b.length) - prefix;
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  // Back the prefix up to a word boundary, so a changed word shows whole.
  while (prefix > 0 && a[prefix - 1] !== " ") prefix--;
  while (suffix > 0 && a[a.length - suffix] !== " ") suffix--;
  const leftStart = Math.max(0, prefix - radius);
  const left = a.slice(leftStart, prefix);
  const leftCut = leftStart > 0 ? ELLIPSIS + left.replace(/^\S*\s/, "") : left;
  const rightEnd = Math.min(a.length, a.length - suffix + radius);
  const right = a.slice(a.length - suffix, rightEnd);
  const rightCut = rightEnd < a.length ? right.replace(/\s\S*$/, "") + ELLIPSIS : right;
  const oldMid = a.slice(prefix, a.length - suffix);
  const newMid = b.slice(prefix, b.length - suffix);
  const cap = (text: string) => (text.length > 160 ? `${text.slice(0, 159)}${ELLIPSIS}` : text);
  return {
    before: `${leftCut}${cap(oldMid)}${rightCut}`.trim(),
    after: `${leftCut}${cap(newMid)}${rightCut}`.trim(),
    whole: leftStart === 0 && rightEnd === a.length,
  };
}

export type ChangedSpan = { before: string; after: string };

/** Every stretch of words that differs between `before` and `after`, in
    order, as the old words and the new (either side "" for words only added
    or only removed); stretches a word or two apart are one. Texts past
    `maxWords` on either side give one span, their whole difference. */
export function changedSpans(before: string, after: string, maxWords = 400): ChangedSpan[] {
  const a = before.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const b = after.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (a.join(" ") === b.join(" ")) return [];
  if (a.length > maxWords || b.length > maxWords) {
    const w = changeWindow(before, after, 0);
    return [{ before: w.before, after: w.after }];
  }
  // The longest common subsequence of the words, then the gaps between
  // common words are the changes.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const spans: { from: number; to: number; fromB: number; toB: number }[] = [];
  let i = 0;
  let j = 0;
  let open: { from: number; to: number; fromB: number; toB: number } | null = null;
  const close = () => {
    if (open) spans.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i++;
      j++;
      continue;
    }
    if (!open) open = { from: i, to: i, fromB: j, toB: j };
    if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      open.toB = ++j;
    } else {
      open.to = ++i;
    }
  }
  close();
  // Spans a word or two apart read as one change.
  const merged: typeof spans = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from - last.to <= 2 && span.fromB - last.toB <= 2) {
      last.to = span.to;
      last.toB = span.toB;
    } else merged.push({ ...span });
  }
  return merged.map((s) => ({ before: a.slice(s.from, s.to).join(" "), after: b.slice(s.fromB, s.toB).join(" ") }));
}
