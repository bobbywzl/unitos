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
