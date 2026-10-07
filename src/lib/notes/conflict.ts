// Two saves of one note made from the same text (SPEC.md §6): two tabs, or
// two collaborators, each editing the text they opened. The second save is
// refused with the current text (409, the note PATCH), and the text the
// reader typed is put together with it here, so no words are lost:
//
// - lines only one side changed take that side's change;
// - lines both sides changed the same way are kept once;
// - lines both sides added at the same place are all kept, theirs first;
// - lines both sides changed differently are kept twice, the other version
//   first, each under a marker line that says what it is, so the reader
//   sees both and deletes the one they do not want.
//
// Line by line, a three-way merge of the text both saves started from (base),
// the stored text (theirs), and the reader's text (mine). Pure: the note
// route uses it for a write that cannot read a 409 (the offline queue, the
// closing flush), the editor for the rest.

export type ConflictLabels = {
  /** The line above the other version. */
  other: string;
  /** The line above the reader's version. */
  yours: string;
  /** The line after the two versions. */
  end: string;
};

export type Reconciled = {
  /** The text with every side's words. */
  text: string;
  /** True when some lines are kept twice under the marker lines. */
  conflict: boolean;
};

// Past this many line pairs the line match is too slow for a save; the two
// texts are then kept whole, one after the other.
const MAX_CELLS = 4_000_000;

/** For each line of `a`, the index of the line of `b` it is matched with in
    a longest common subsequence, or -1. */
function matchLines(a: string[], b: string[]): number[] | null {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return null;
  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      match[i] = j;
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return match;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((line, i) => line === b[i]);

function both(theirs: string[], mine: string[], labels: ConflictLabels): string[] {
  const block = (lines: string[]) => (lines.length > 0 ? [...lines, ""] : []);
  return [`**${labels.other}**`, "", ...block(theirs), `**${labels.yours}**`, "", ...block(mine), `**${labels.end}**`];
}

/** `text` as `base` with one run of words put in at one place: where, and
    the run. Null when `text` changed `base` any other way. */
function insertion(base: string, text: string): { at: number; run: string } | null {
  if (text.length <= base.length) return null;
  let at = 0;
  while (at < base.length && base[at] === text[at]) at++;
  let tail = 0;
  while (tail < base.length - at && base[base.length - 1 - tail] === text[text.length - 1 - tail]) tail++;
  if (at + tail !== base.length) return null;
  return { at, run: text.slice(at, text.length - tail) };
}

/** The reader's text put together with the stored text, both made from `base`. */
export function reconcileNoteText(base: string, theirs: string, mine: string, labels: ConflictLabels): Reconciled {
  if (theirs === base || theirs === mine) return { text: mine, conflict: false };
  if (mine === base) return { text: theirs, conflict: false };
  // The stored text put words in at one place, and the reader's text put in
  // more at the same place, the stored run among them: the reader typed on
  // from it (the same typing saved twice, once by an editor that closed and
  // once by the editor that took its place). The reader's text keeps every
  // word and undoes nothing, so it stands alone, with no marker lines.
  const added = insertion(base, theirs);
  const typed = added ? insertion(base, mine) : null;
  if (added && typed && typed.at === added.at && typed.run.includes(added.run)) return { text: mine, conflict: false };
  const b = base.split("\n");
  const t = theirs.split("\n");
  const m = mine.split("\n");
  const toT = matchLines(b, t);
  const toM = matchLines(b, m);
  if (!toT || !toM) return { text: both(t, m, labels).join("\n"), conflict: true };

  const out: string[] = [];
  let conflict = false;
  const chunk = (cb: string[], ct: string[], cm: string[]) => {
    if (same(ct, cb)) out.push(...cm);
    else if (same(cm, cb) || same(ct, cm)) out.push(...ct);
    // Both sides only added lines at the same place: both stay, theirs first.
    else if (cb.length === 0) out.push(...ct, ...cm);
    else {
      conflict = true;
      // Kept apart from the lines around them, so each marker reads as its own line.
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push(...both(ct, cm, labels), "");
    }
  };
  let i = 0;
  let j = 0;
  let k = 0;
  for (let at = 0; at <= b.length; at++) {
    // A line of the base both sides kept: everything before it is one chunk.
    if (at < b.length && (toT[at] === -1 || toM[at] === -1)) continue;
    const tEnd = at < b.length ? toT[at] : t.length;
    const mEnd = at < b.length ? toM[at] : m.length;
    if (at > i || tEnd > j || mEnd > k) chunk(b.slice(i, at), t.slice(j, tEnd), m.slice(k, mEnd));
    if (at < b.length) out.push(b[at]);
    i = at + 1;
    j = tEnd + 1;
    k = mEnd + 1;
  }
  const text = out.join("\n");
  return { text: conflict ? text.replace(/\n+$/, "") : text, conflict };
}
