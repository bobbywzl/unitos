/** Character ranges of `current` that differ from `original` — word-level LCS,
    so an inserted or replaced word paints without dragging the whole block in.
    Punctuation tokenizes separately, so "fox," with only "fox" changed does not
    paint the comma. A pure deletion paints the word after the join, so removed
    text still leaves a visible trace. Ranges cover current-text offsets, the
    same space highlights paint in. */
export function editedRanges(
  original: string,
  current: string,
): { start: number; end: number }[] {
  if (original === current) return [];
  if (!original) return current.length ? [{ start: 0, end: current.length }] : [];

  const tokenize = (s: string) => {
    const tokens: { text: string; start: number; end: number }[] = [];
    // Words (apostrophes included) and single punctuation marks are separate tokens.
    const re = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return tokens;
  };
  const a = tokenize(original);
  const b = tokenize(current);
  if (b.length === 0) return [];
  // LCS is quadratic; past this budget, paint the whole block as edited.
  if (a.length * b.length > 500_000) return [{ start: 0, end: current.length }];

  // LCS table over token texts.
  const cols = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * cols + j] =
        a[i].text === b[j].text
          ? dp[(i + 1) * cols + j + 1] + 1
          : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }

  // Walk: current-side tokens not on the LCS are edited. A deletion (original-side
  // token skipped) marks the next current-side token, so the join stays visible.
  const editedTokens: boolean[] = new Array<boolean>(b.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].text === b[j].text) {
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
      editedTokens[j] = true; // deletion before this token
      i++;
    } else {
      editedTokens[j] = true;
      j++;
    }
  }
  if (i < a.length && b.length > 0) editedTokens[b.length - 1] = true; // deletion at the end
  for (; j < b.length; j++) editedTokens[j] = true;

  // Merge adjacent edited tokens into ranges (spanning the whitespace between).
  const ranges: { start: number; end: number }[] = [];
  for (let k = 0; k < b.length; k++) {
    if (!editedTokens[k]) continue;
    const last = ranges[ranges.length - 1];
    if (last && (k === 0 || editedTokens[k - 1])) {
      last.end = b[k].end;
    } else {
      ranges.push({ start: b[k].start, end: b[k].end });
    }
  }
  return ranges;
}
