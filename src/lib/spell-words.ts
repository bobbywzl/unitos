// The words the spelling check reads (SPEC.md §29, typing), in plain text:
// shared by the page editor (components/docs/typing/spelling.ts), the note
// editor (components/proofing/note-proofing.tsx), and the spelling worker.

export type TextWord = { word: string; from: number; to: number };

/** Letters, with apostrophes inside ("don't"). */
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const LATIN = /^[\p{Script=Latin}\p{M}'’]+$/u;
/** What the browser leaves unchecked too: an address, a number, a file name. */
const UNCHECKED = /[@/\\_\d]|\p{L}\.\p{L}/u;
const HAN_KANA_HANGUL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LETTER = /\p{L}/gu;

/** The words of a run of text the checker reads, with their offsets: Latin
    words of two letters or more, skipping any stretch with a digit, "@",
    "/", "\", "_", or a dot between letters. */
export function wordsInText(text: string): TextWord[] {
  const words: TextWord[] = [];
  for (const chunk of text.matchAll(/\S+/g)) {
    if (UNCHECKED.test(chunk[0])) continue;
    for (const m of chunk[0].matchAll(WORD)) {
      if (m[0].length < 2 || !LATIN.test(m[0])) continue;
      const from = chunk.index + m.index;
      words.push({ word: m[0], from, to: from + m[0].length });
    }
  }
  return words;
}

/** The most words of a paragraph the spelling check judges its language by. */
const SAMPLE = 40;

/** Whether a paragraph reads as English, from the words the dictionary
    knows: Chinese, Japanese, or Korean text is not; a paragraph of four
    Latin words or more is when at least half of them are known (a French
    paragraph is not). `known` is how many of `words` the dictionary knows,
    of the first SAMPLE. */
export function readsAsEnglish(text: string, words: number, known: number): boolean {
  const letters = text.match(LETTER)?.length ?? 0;
  const cjk = text.match(HAN_KANA_HANGUL)?.length ?? 0;
  if (letters > 0 && cjk / letters > 0.2) return false;
  const sampled = Math.min(words, SAMPLE);
  return sampled < 4 || known / sampled >= 0.5;
}

export const SPELL_SAMPLE = SAMPLE;

/** Up to five spelling suggestions: two neighboring letters swapped first,
    then the words that keep the first letter — the slips typing makes most. */
export function rankedSuggestions(word: string, suggestions: string[]): string[] {
  const typed = word.toLowerCase();
  const rank = (suggestion: string) => {
    const s = suggestion.toLowerCase();
    let i = 0;
    while (i < s.length && s[i] === typed[i]) i++;
    const swapped = s.length === typed.length && s[i] === typed[i + 1] && s[i + 1] === typed[i] && s.slice(i + 2) === typed.slice(i + 2);
    return swapped ? 0 : s[0] === typed[0] ? 1 : 2;
  };
  return [...suggestions].sort((a, b) => rank(a) - rank(b)).slice(0, 5);
}
