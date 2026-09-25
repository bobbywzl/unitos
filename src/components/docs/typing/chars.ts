// Google Docs' character classes (SPEC.md §29, typing): what word jumps, word
// delete, double-click, automatic capitalization, substitutions, and the
// word count treat as a word. Four classes: whitespace, punctuation,
// transparent (never splits a word: don't, well-known, a—b), and word
// (everything else: letters, digits, "_", CJK, "…").

type CharClass = "s" | "p" | "t" | "w";

/** A line break (Shift+Enter) as the editor's text helpers write it. */
export const LINE_BREAK = "\v";
/** An inline object (an image, a chip) in a text index: never matches. */
export const OBJECT_CHAR = "\uFFFC";

const WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\uE906"]);
const PUNCTUATION = new Set([..."!@#$%^&*()+=\\|{}[];:\"/?.,<>~`“”¿¡"]);
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

export function isTransparent(ch: string | undefined): boolean {
  return ch !== undefined && TRANSPARENT.has(ch);
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
  while (i > 0) {
    const c = charClass(text[i - 1]);
    if (c === "w" || c === "t") i--;
    else break;
  }
  return i;
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
    while (i < text.length) {
      const c = charClass(text[i]);
      if (c === "w" || c === "t") i++;
      else break;
    }
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
  return from < to ? { from, to } : null;
}
