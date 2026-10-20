// The words the spelling check reads (SPEC.md §29, typing), in plain text:
// shared by the page editor (components/docs/typing/spelling.ts), the note
// editor (components/proofing/note-proofing.tsx), and the spelling worker.

/** A word and where it stands. `opens`: the word starts a sentence (only
    then may a misspelled word start with a capital: elsewhere a capital
    marks a name). */
export type TextWord = { word: string; from: number; to: number; opens: boolean };

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
      words.push({ word: m[0], from, to: from + m[0].length, opens: opensSentence(text.slice(Math.max(0, from - 40), from), from <= 40) });
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

/** Whether a word starts a sentence, from the text before it (`fromStart`:
    that text starts the paragraph): nothing but spaces, quotes, and
    brackets since the paragraph's start or since a ".", "!", "?", ":", or
    "…". */
export function opensSentence(before: string, fromStart: boolean): boolean {
  let i = before.length - 1;
  while (i >= 0 && /[\s"'“‘(\[]/u.test(before[i])) i--;
  if (i < 0) return fromStart;
  while (i >= 0 && /["'”’)\]]/u.test(before[i])) i--;
  return i >= 0 && /[.!?:…]/u.test(before[i]);
}

// The red squiggle is drawn only where the check is sure (SPEC.md §29,
// typing): the dictionary does not know the word, and one word it knows is
// almost surely the one meant. Names, brands, jargon, and acronyms the
// dictionary does not know are left alone.

/** The everyday English typos and their fixes: "Automatically correct
    spelling" fixes them as they are typed (components/docs/typing/
    spelling.ts), and the spelling check is sure of them. */
export const TYPOS: Readonly<Record<string, string>> = {
  i: "I",
  im: "I'm",
  ive: "I've",
  dont: "don't",
  doesnt: "doesn't",
  didnt: "didn't",
  cant: "can't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  hasnt: "hasn't",
  havent: "haven't",
  hadnt: "hadn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  wouldnt: "wouldn't",
  youre: "you're",
  theyre: "they're",
  thats: "that's",
  theres: "there's",
  whats: "what's",
  teh: "the",
  hte: "the",
  adn: "and",
  nad: "and",
  taht: "that",
  thta: "that",
  waht: "what",
  wiht: "with",
  whit: "with",
  becuase: "because",
  beacuse: "because",
  becasue: "because",
  recieve: "receive",
  recieved: "received",
  beleive: "believe",
  belive: "believe",
  acheive: "achieve",
  seperate: "separate",
  definately: "definitely",
  definatly: "definitely",
  occured: "occurred",
  occurence: "occurrence",
  untill: "until",
  wich: "which",
  whcih: "which",
  thier: "their",
  freind: "friend",
  goverment: "government",
  enviroment: "environment",
  accomodate: "accommodate",
  adress: "address",
  begining: "beginning",
  calender: "calendar",
  comming: "coming",
  commited: "committed",
  completly: "completely",
  concious: "conscious",
  existance: "existence",
  foward: "forward",
  futher: "further",
  happend: "happened",
  independant: "independent",
  knowlege: "knowledge",
  neccessary: "necessary",
  necesary: "necessary",
  noticable: "noticeable",
  peice: "piece",
  posible: "possible",
  prefered: "preferred",
  probaly: "probably",
  realy: "really",
  reccomend: "recommend",
  recomend: "recommend",
  refered: "referred",
  relevent: "relevant",
  remeber: "remember",
  succesful: "successful",
  sucessful: "successful",
  suprise: "surprise",
  tommorow: "tomorrow",
  tomorow: "tomorrow",
  truely: "truly",
  wierd: "weird",
  writting: "writing",
  alot: "a lot",
  aswell: "as well",
  infact: "in fact",
};

const LOWER = /^[a-z]+$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** The word a misspelled word surely means, or null when the check cannot
    be sure. `correct` says whether the dictionary knows a word.
    - A word with a capital after its first letter (an acronym, a brand) is
      never sure; nor is a capitalized word that does not start a sentence
      (a name).
    - An everyday typo (TYPOS) is sure.
    - Otherwise, for a word of four letters or more, a candidate is a word
      the dictionary knows that is one slip away: two neighboring letters
      swapped; a letter missing, past the first, in a word of five letters
      or more; a doubled letter, past the first, in a word of five letters
      or more. One candidate is sure. With none, one letter past the first
      changed, in a word of eight letters or more: one candidate is sure.
      Two or more is never sure. */
export function sureFix(word: string, opens: boolean, correct: (word: string) => boolean): string | null {
  if (/\p{Lu}/u.test(word.slice(1))) return null;
  const capital = word[0] !== word[0].toLowerCase();
  if (capital && !opens) return null;
  const typed = word.toLowerCase().replace(/’/g, "'");
  const fix = Object.hasOwn(TYPOS, typed) ? TYPOS[typed] : surely(typed, correct);
  if (!fix) return null;
  return capital ? fix[0].toUpperCase() + fix.slice(1) : fix;
}

function surely(w: string, correct: (word: string) => boolean): string | null {
  const n = w.length;
  if (n < 4 || !LOWER.test(w)) return null;
  const found = new Set<string>();
  const add = (candidate: string) => {
    if (candidate !== w && correct(candidate)) found.add(candidate);
  };
  for (let i = 0; i < n - 1; i++) {
    if (w[i] !== w[i + 1]) add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  }
  if (n >= 5) {
    for (let i = 1; i <= n; i++) for (const c of ALPHABET) add(w.slice(0, i) + c + w.slice(i));
    for (let i = 1; i < n; i++) if (w[i] === w[i - 1]) add(w.slice(0, i) + w.slice(i + 1));
  }
  if (found.size > 0) return found.size === 1 ? [...found][0] : null;
  if (n < 8) return null;
  for (let i = 1; i < n; i++) for (const c of ALPHABET) if (c !== w[i]) add(w.slice(0, i) + c + w.slice(i + 1));
  return found.size === 1 ? [...found][0] : null;
}

/** One paragraph's words checked (the worker's and the page's fallback):
    the index of each word the dictionary does not know, with its sure fix
    (null: no red squiggle), and how many of the first SPELL_SAMPLE words
    the dictionary knows. */
export function checkWords(
  words: readonly { word: string; opens: boolean }[],
  correct: (word: string) => boolean,
): { bad: [number, string | null][]; known: number } {
  const bad: [number, string | null][] = [];
  let known = 0;
  words.forEach(({ word, opens }, i) => {
    if (correct(word)) {
      if (i < SAMPLE) known++;
      return;
    }
    bad.push([i, sureFix(word, opens, correct)]);
  });
  return { bad, known };
}
