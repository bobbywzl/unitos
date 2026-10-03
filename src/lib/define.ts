// Define (SPEC.md §6): the first row of the text toolbar, offered only when
// the selection is one word. The toolbar reads this to show the row;
// /api/derive reads it to refuse anything else. No server imports: client
// components import this file.

/** The most characters a word has. */
export const DEFINE_MAX_CHARS = 64;

// Quotes, brackets, and the punctuation that ends a clause or a sentence may
// stand around the word: "extinguishment." and “Dhamma,” are one word.
const EDGE = /^[\s"'“”‘’«»()[\]{}<>.,;:!?…—–-]+|[\s"'“”‘’«»()[\]{}<>.,;:!?…—–-]+$/gu;
// What stands between two words: a space, a comma, a semicolon, a colon, a
// question or an exclamation mark, an ellipsis, a dash. A hyphen, an
// apostrophe, a slash, and the dots of an abbreviation stay inside one word:
// "self-mortification", "Buddha's", "and/or", "U.S.".
const BREAK = /[\s,;:!?…—–]/u;
// Chinese and Japanese put no space between words, so no selection of them
// is one word that can be told apart: Define never shows on them.
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// A letter, a digit, or a mark that sits on a letter: what a word is made of.
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** Whether the selected text is one word. A tab or a newline inside is a
    break: a selection across two table cells or two lines is no word. */
export function definable(text: string): boolean {
  const word = text.replace(EDGE, "");
  if (!word || word.length > DEFINE_MAX_CHARS) return false;
  if (!/\p{L}/u.test(word)) return false;
  if (NO_SPACE_SCRIPT.test(word)) return false;
  return !BREAK.test(word);
}

/** Whether a selection is one whole word: one word (definable), and its
    edges are word boundaries in the block text — the text before it does not
    end in a letter it continues, and the text after it does not start with
    one. "re" of "readers" is a piece of a word, not a word. */
export function definableSelection(quote: string, before: string, after: string): boolean {
  if (!definable(quote)) return false;
  const chars = Array.from(quote);
  const prev = Array.from(before).at(-1) ?? "";
  const next = Array.from(after)[0] ?? "";
  if (WORD_CHAR.test(chars[0]) && WORD_CHAR.test(prev)) return false;
  if (WORD_CHAR.test(chars[chars.length - 1]) && WORD_CHAR.test(next)) return false;
  return true;
}

/** A word as a lookup key: case and surrounding space do not count. */
export function defineKey(text: string): string {
  return text.trim().toLowerCase();
}
