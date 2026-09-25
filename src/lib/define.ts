// Define (SPEC.md §6): the first row of the text toolbar, offered only when
// the selection is one word or one phrase. The toolbar reads this to show
// the row; /api/derive reads it to refuse anything longer. No server
// imports: client components import this file.

/** The most words a phrase has. Past it the selection is a clause. */
export const DEFINE_MAX_WORDS = 6;
/** The most characters a word or a phrase has. */
export const DEFINE_MAX_CHARS = 64;
/** The most CJK characters a phrase has: Chinese and Japanese put no space between words. */
export const DEFINE_MAX_CJK = 12;

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
// A clause break in CJK text: a full-width comma, stop, semicolon, colon,
// question mark, exclamation mark, or enumeration comma.
const CJK_BREAK = /[，。；：！？、]/;
// A sentence end inside the selection: a word of two letters or more, a stop,
// a question mark, or an exclamation mark, then a space and a capital, a
// digit, or an opening quote or bracket. "results. We" ends a sentence;
// "U.S. Treasury", "e.g. rates", and "risk vs. return" do not.
const SENTENCE_END = /\p{L}{2,}[.!?]["'”’)\]]*\s+[\p{Lu}\d"“'‘(]/u;

/** Whether the selected text is one word or one phrase. */
export function definable(text: string): boolean {
  const s = text.trim();
  if (!s || s.length > DEFINE_MAX_CHARS) return false;
  if (/[\r\n]/.test(s)) return false;
  if (!/\p{L}/u.test(s)) return false;
  const cjk = s.match(CJK)?.length ?? 0;
  if (cjk > DEFINE_MAX_CJK) return false;
  if (cjk > 0 && CJK_BREAK.test(s)) return false;
  if (s.split(/\s+/).length > DEFINE_MAX_WORDS) return false;
  return !SENTENCE_END.test(s);
}

/** A word or a phrase as a lookup key: case and surrounding space do not count. */
export function defineKey(text: string): string {
  return text.trim().toLowerCase();
}
