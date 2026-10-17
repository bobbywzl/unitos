// Google Docs' character classes (SPEC.md §29, typing): what word jumps, word
// delete, double-click, automatic capitalization, substitutions, and the
// word count treat as a word. Four classes: whitespace, punctuation (the
// full-width forms too: ，。「」), transparent (never splits a word: don't,
// well-known, a—b), and word (everything else: letters, digits, "_", CJK,
// "…"). Chinese and Japanese put no space between words, so a run of word
// characters that holds them splits by Intl.Segmenter's words (阅读|时).

type CharClass = "s" | "p" | "t" | "w";

/** A line break (Shift+Enter) as the editor's text helpers write it. */
export const LINE_BREAK = "\v";
/** An inline object (an image, a chip) in a text index: never matches. */
export const OBJECT_CHAR = "\uFFFC";

const WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\uE906"]);
const PUNCTUATION = new Set([..."!@#$%^&*()+=\\|{}[];:\"/?.,<>~`“”¿¡", ..."，。、：；！？「」『』《》〈〉（）【】〔〕〖〗"]);
const TRANSPARENT = new Set(["'", "‘", "’", "-", "–", "—"]);

export function charClass(ch: string): CharClass {
  if (WHITESPACE.has(ch)) return "s";
  if (TRANSPARENT.has(ch)) return "t";
  if (PUNCTUATION.has(ch)) return "p";
  return "w";
}

export function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE.has(ch);
}

/** CJK ideographs: a boundary for substitutions and spelling. */
function isCjkIdeograph(ch: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch);
}

/** The characters that fire substitutions and spelling corrections:
    whitespace, punctuation except "/", the transparent characters, and CJK
    ideographs. "/" is not one, so 1/2 and c/o stay whole tokens. */
export function isWordBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const cls = charClass(ch);
  if (cls === "s" || cls === "t") return true;
  if (cls === "p") return ch !== "/";
  return isCjkIdeograph(ch);
}

/** Letters and digits, any script. */
export function isLetterOrDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** The previous grapheme cluster's length in UTF-16 units: a whole emoji,
    or a base letter with its combining marks. */
export function lastGraphemeLength(text: string): number {
  if (!text) return 0;
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    let last = "";
    for (const part of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) last = part.segment;
    return last.length || 1;
  }
  const code = text.charCodeAt(text.length - 1);
  return code >= 0xdc00 && code <= 0xdfff && text.length > 1 ? 2 : 1;
}

/** The next grapheme cluster's length in UTF-16 units. */
export function firstGraphemeLength(text: string): number {
  if (!text) return 0;
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    for (const part of new Segmenter(undefined, { granularity: "grapheme" }).segment(text)) return part.segment.length || 1;
  }
  const code = text.charCodeAt(0);
  return code >= 0xd800 && code <= 0xdbff && text.length > 1 ? 2 : 1;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
let segmenter: Intl.Segmenter | null | undefined;

/** The word inside a run of word characters [from, to) that holds `at`: the
    whole run, or for Chinese and Japanese the segmenter's word. */
function wordInRun(text: string, from: number, to: number, at: number): { from: number; to: number } {
  const run = text.slice(from, to);
  if (!CJK.test(run)) return { from, to };
  if (segmenter === undefined) {
    const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    segmenter = Segmenter ? new Segmenter("zh", { granularity: "word" }) : null;
  }
  if (!segmenter) return { from, to };
  for (const part of segmenter.segment(run)) {
    const start = from + part.index;
    const end = start + part.segment.length;
    if (at >= start && at < end) return { from: start, to: end };
  }
  return { from, to };
}

const inRun = (ch: string | undefined) => {
  if (ch === undefined) return false;
  const c = charClass(ch);
  return c === "w" || c === "t";
};

/** Where a word delete backward from `offset` stops: over the whitespace
    before the caret, then over one run of word characters (transparent
    characters inside a word count as word) or of punctuation. */
export function wordStartBefore(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && charClass(text[i - 1]) === "s") i--;
  if (i === 0) return 0;
  const cls = charClass(text[i - 1]);
  if (cls === "p") {
    while (i > 0 && charClass(text[i - 1]) === "p") i--;
    return i;
  }
  const end = i;
  while (i > 0 && inRun(text[i - 1])) i--;
  let runEnd = end;
  while (runEnd < text.length && inRun(text[runEnd])) runEnd++;
  return wordInRun(text, i, runEnd, end - 1).from;
}

/** Where a word delete forward from `offset` stops. Windows and ChromeOS
    delete the rest of the word and the spaces after it; a Mac skips the
    spaces first and deletes the word after them. */
export function wordEndAfter(text: string, offset: number, mac: boolean): number {
  let i = offset;
  const run = () => {
    if (i >= text.length) return;
    const cls = charClass(text[i]);
    if (cls === "p") {
      while (i < text.length && charClass(text[i]) === "p") i++;
      return;
    }
    if (cls === "s") return;
    const at = i;
    let runStart = i;
    while (runStart > 0 && inRun(text[runStart - 1])) runStart--;
    while (i < text.length && inRun(text[i])) i++;
    i = wordInRun(text, runStart, i, at).to;
  };
  if (mac) {
    while (i < text.length && charClass(text[i]) === "s") i++;
    run();
  } else {
    const start = i;
    run();
    if (i === start && charClass(text[i]) !== "s") i++;
    while (i < text.length && charClass(text[i]) === "s" && text[i] !== "\v") i++;
  }
  return i;
}

/** The word around `offset` for a double-click: word characters joined by
    transparent ones, without a trailing space. Null when the offset is not
    on a word. */
export function wordAt(text: string, offset: number): { from: number; to: number } | null {
  const inWord = (i: number) => {
    const c = charClass(text[i] ?? " ");
    return c === "w" || c === "t";
  };
  let at = offset;
  if (!inWord(at) && at > 0 && inWord(at - 1)) at -= 1;
  if (!inWord(at)) return null;
  let from = at;
  let to = at + 1;
  while (from > 0 && inWord(from - 1)) from--;
  while (to < text.length && inWord(to)) to++;
  // A transparent character at either end is punctuation, not the word.
  while (from < to && charClass(text[from]) === "t") from++;
  while (to > from && charClass(text[to - 1]) === "t") to--;
  if (from >= to) return null;
  if (at < from || at >= to) return { from, to };
  return wordInRun(text, from, to, at);
}
