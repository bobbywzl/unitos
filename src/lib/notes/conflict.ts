// Two saves of one note made from the same text (SPEC.md §6): two tabs, or
// two collaborators, each editing the text they opened. The second save is
// refused with the current text (409, the note PATCH), and the text the
// reader typed is put together with it here, so no words are lost:
//
// - lines only one side changed take that side's change;
// - lines both sides changed the same way are kept once;
// - lines both sides added at the same place are all kept, theirs first;
// - lines both sides changed, at different words, take both changes (two
//   people typing in one paragraph at once); words both sides put in at the
//   same place are all kept, the reader's first;
// - lines both sides changed at the same words are kept twice, the other
//   version first, each under a marker line that says what it is, so the
//   reader sees both and deletes the one they do not want. A text that
//   already holds marker lines takes the new version into that block,
//   never a block inside a block.
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
  // One side's lines already hold a block of versions: the other side's
  // version goes into it, before its end line, never a block inside a block.
  const end = `**${labels.end}**`;
  const at = theirs.lastIndexOf(end);
  if (at >= 0) return [...theirs.slice(0, at), `**${labels.yours}**`, "", ...block(mine), ...theirs.slice(at)];
  const mineAt = mine.lastIndexOf(end);
  if (mineAt >= 0) return [...mine.slice(0, mineAt), `**${labels.other}**`, "", ...block(theirs), ...mine.slice(mineAt)];
  return [`**${labels.other}**`, "", ...block(theirs), `**${labels.yours}**`, "", ...block(mine), end];
}

// A word, a run of spaces, a line break, or one other character; each
// Chinese or Japanese character is a word of its own.
const WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}\p{M}_'’]+|[^\S\n]+|\n|[^]/gu;
// Past this many word pairs the word match is too slow for a save.
const MAX_WORD_CELLS = 1_000_000;

type Change = { start: number; end: number; words: string[] };

/** The changes that make `to` from `from`, by word: each replaces the words
    from..end of `from` (none, for words put in) with `words`. */
function changes(from: string[], to: string[]): Change[] | null {
  const match = matchLines(from, to);
  if (!match) return null;
  const out: Change[] = [];
  let i = 0;
  let j = 0;
  for (let at = 0; at <= from.length; at++) {
    if (at < from.length && match[at] === -1) continue;
    const toEnd = at < from.length ? match[at] : to.length;
    if (at > i || toEnd > j) out.push({ start: i, end: at, words: to.slice(j, toEnd) });
    i = at + 1;
    j = toEnd + 1;
  }
  return out;
}

/** True when the words of `part` stand in `whole` in a row, spaces aside. */
function within(part: string[], whole: string[]): boolean {
  const words = (run: string[]) => run.filter((w) => w.trim() !== "");
  const a = words(part);
  const b = words(whole);
  if (a.length === 0) return false;
  for (let i = 0; i + a.length <= b.length; i++) if (a.every((w, k) => w === b[i + k])) return true;
  return false;
}

/** Both sides' changes to the same lines put together word by word, when
    they change different words: the text, or null when both change the
    same words (the lines are then kept twice). */
function mergeWords(base: string, theirs: string, mine: string): string | null {
  const b = base.match(WORD) ?? [];
  const t = theirs.match(WORD) ?? [];
  const m = mine.match(WORD) ?? [];
  if (b.length * Math.max(t.length, m.length) > MAX_WORD_CELLS) return null;
  const ours = changes(b, m);
  const other = changes(b, t);
  if (!ours || !other) return null;
  const all = [...ours.map((c) => ({ ...c, mine: true })), ...other.map((c) => ({ ...c, mine: false }))];
  // In the order of the base; at one place, words put in come before a
  // replacement there, and the reader's words before the other side's.
  all.sort((x, y) => x.start - y.start || (x.end - x.start) - (y.end - y.start) || (x.mine === y.mine ? 0 : x.mine ? -1 : 1));
  const out: string[] = [];
  let at = 0;
  let last: (Change & { mine: boolean }) | null = null;
  for (const c of all) {
    // The same change on both sides counts once; words both sides put in at
    // one place, one side's among the other's (the same typing saved twice,
    // once from an older text), are kept once, the longer run.
    if (last && last.mine !== c.mine && last.start === c.start && last.end === c.end) {
      if (same(last.words, c.words) || (c.start === c.end && within(c.words, last.words))) continue;
      if (c.start === c.end && within(last.words, c.words)) {
        out.splice(out.length - last.words.length, last.words.length, ...c.words);
        last = c;
        continue;
      }
    }
    // Two changes of the same words: no word merge.
    if (c.start < at || (last && c.start === last.start && c.end > c.start && last.end > last.start)) return null;
    out.push(...b.slice(at, c.start), ...c.words);
    at = c.end;
    last = c;
  }
  out.push(...b.slice(at));
  return out.join("");
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
      // Both sides changed these lines: their words put together when they
      // changed different words.
      const words = mergeWords(cb.join("\n"), ct.join("\n"), cm.join("\n"));
      if (words !== null) {
        out.push(...words.split("\n"));
        return;
      }
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
