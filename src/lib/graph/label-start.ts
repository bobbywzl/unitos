// The canvas labels of titles that share a start (VIEW4-05, SPEC.md §13).
// A label shows two lines at most, so a run of titles with the same long
// start ("Beyond Good and Evil — I. …", "Beyond Good and Evil — II. …")
// would show the same words on every node. Each title of such a run keeps a
// short head of the start and the words that differ:
// "Beyond Good… II. The Free Spirit". The full title stays in the node's
// card, its accessible name, and every list.

// A cut may fall after one of these, or between two CJK characters.
const SEP = /[\s—–\-:·|,，：、]/;
const CJK = /[　-鿿＀-￯]/;
const LEAD = /^[\s—–\-:·|,，：、]+/;
const TRAIL = /[\s—–\-:·|,，：、]+$/;

/** Width in Latin letters: a CJK character counts two. */
function width(s: string): number {
  let w = 0;
  for (const c of s) w += CJK.test(c) ? 2 : 1;
  return w;
}

/** The shared start a label drops: at least this wide. */
const MIN_START = 14;
/** What is left must say something: at least this wide. */
const MIN_REST = 6;
/** The head kept of the start. */
const HEAD = 14;

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** The last cut at or before n: after a separator, or between two CJK characters. */
function cutAt(title: string, n: number): number {
  for (let i = Math.min(n, title.length - 1); i > 0; i--) {
    const before = title[i - 1];
    if (SEP.test(before) || (CJK.test(before) && CJK.test(title[i]))) return i;
  }
  return 0;
}

/** The head of a start: its first two words when they fit, else its first
    word; for CJK, its first four characters. */
function headOf(start: string): string {
  const words = start.trim().split(/\s+/);
  if (words.length > 1 || !CJK.test(start)) {
    const two = words.slice(0, 2).join(" ");
    const head = width(two) <= HEAD ? two : words[0];
    return head.replace(TRAIL, "");
  }
  return [...start].slice(0, 4).join("").replace(TRAIL, "");
}

/** The label of each title that shares a long start with another title, by
    index into `titles`. Titles not in the map keep their own label. */
export function labelStarts(titles: string[]): Map<number, string> {
  const order = titles.map((t, i) => ({ t: t.replace(/\s+/g, " ").trim(), i })).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out = new Map<number, string>();
  for (let k = 0; k < order.length; k++) {
    const { t, i } = order[k];
    const shared = Math.max(
      k > 0 ? commonPrefix(t, order[k - 1].t) : 0,
      k + 1 < order.length ? commonPrefix(t, order[k + 1].t) : 0,
    );
    // A title that is all start (it begins another title, or two titles are
    // the same) keeps its own label.
    if (shared === 0 || shared >= t.length) continue;
    let cut = cutAt(t, shared);
    let rest = t.slice(cut).replace(LEAD, "");
    while (cut > 0 && width(rest) < MIN_REST) {
      cut = cutAt(t, cut - 1);
      rest = t.slice(cut).replace(LEAD, "");
    }
    const start = t.slice(0, cut);
    if (width(start.trim()) < MIN_START || width(rest) < MIN_REST) continue;
    const head = headOf(start);
    if (!head || width(head) >= width(start.replace(TRAIL, "")) - 2) continue;
    out.set(i, CJK.test(head[head.length - 1]) ? `${head}…${rest}` : `${head}… ${rest}`);
  }
  return out;
}
