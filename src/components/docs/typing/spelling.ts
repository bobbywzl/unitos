import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type NSpell from "nspell";

// "Automatically correct spelling" (SPEC.md §29, typing). Google Docs asks its
// spelling service; Unitos keeps the everyday English typos it fixes on its
// own. A fix fires when a word ends; the typed word's first capital stays.

const FIXES: Record<string, string> = {
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

/** The correction for a word just finished, or null. A one-letter word
    before "." is left alone: "i.e." stays. */
export function spellingFix(word: string, trigger: string): string | null {
  const key = word.toLowerCase().replace(/’/g, "'");
  const fix = FIXES[key];
  if (!fix || fix === word) return null;
  if (key.length === 1 && trigger === ".") return null;
  if (word[0] !== word[0].toLowerCase() && fix[0] === fix[0].toLowerCase()) {
    return fix[0].toUpperCase() + fix.slice(1);
  }
  return fix;
}

// Spelling suggestions (SPEC.md §29, typing). The browser draws the red
// underline, in the reader's languages. Unitos adds what the page cannot ask
// the browser for — spelling suggestions in the right-click menu, and the
// next and previous misspelling — in English: nspell with the English
// Hunspell dictionary in public/spelling, loaded on first use.

type Word = { word: string; from: number; to: number };
export type Misspelling = Word & { suggestions: string[] };

let checker: Promise<NSpell | null> | null = null;

/** The English checker, loaded once per page; null when it cannot load. */
export function loadChecker(): Promise<NSpell | null> {
  const text = (url: string) => fetch(url).then((res) => (res.ok ? res.text() : Promise.reject(new Error(url))));
  checker ??= Promise.all([import("nspell"), text("/spelling/en.aff"), text("/spelling/en.dic")])
    .then(([{ default: nspell }, aff, dic]) => nspell(aff, dic))
    .catch(() => {
      checker = null;
      return null;
    });
  return checker;
}

/** Letters, with apostrophes inside ("don't"). */
const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const LATIN = /^[\p{Script=Latin}\p{M}'’]+$/u;
/** What the browser leaves unchecked too: an address, a number, a file name. */
const UNCHECKED = /[@/\\_\d]|\p{L}\.\p{L}/u;

/** The words of a paragraph the checker reads, with their positions: Latin
    words of two letters or more, outside code. */
function wordsOf(block: PMNode, blockPos: number): Word[] {
  const words: Word[] = [];
  let run = "";
  let start = 0;
  const flush = () => {
    for (const chunk of run.matchAll(/\S+/g)) {
      if (UNCHECKED.test(chunk[0])) continue;
      for (const m of chunk[0].matchAll(WORD)) {
        if (m[0].length < 2 || !LATIN.test(m[0])) continue;
        const from = start + chunk.index + m.index;
        words.push({ word: m[0], from, to: from + m[0].length });
      }
    }
    run = "";
  };
  if (!block.type.spec.code) {
    block.forEach((child, offset) => {
      if (!child.isText || child.marks.some((m) => m.type.name === "code")) return flush();
      if (!run) start = blockPos + 1 + offset;
      run += child.text;
    });
  }
  flush();
  return words;
}

/** Up to five spelling suggestions: two neighboring letters swapped first,
    then the words that keep the first letter — the slips typing makes most. */
function ranked(word: string, suggestions: string[]): string[] {
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

/** The misspelled English word at a position and its spelling suggestions,
    for the right-click menu; null at once where there is none to check, or
    while the page is not editable or its spelling check is off. */
export function misspellingAt(editor: Editor, pos: number): Promise<Misspelling | null> | null {
  const $pos = editor.state.doc.resolve(pos);
  if (!editor.isEditable || !editor.view.dom.spellcheck || !$pos.parent.isTextblock) return null;
  const word = wordsOf($pos.parent, $pos.before()).find((w) => w.from <= pos && pos <= w.to);
  if (!word) return null;
  return loadChecker().then((spell) => {
    if (!spell || spell.correct(word.word)) return null;
    const suggestions = ranked(word.word, spell.suggest(word.word));
    return suggestions.length > 0 ? { ...word, suggestions } : null;
  });
}

/** A spelling suggestion takes the misspelled word's place, with the
    word's marks: one undo step. */
export function replaceWord(editor: Editor, misspelling: Misspelling, suggestion: string): void {
  const { state } = editor;
  const { from, to } = misspelling;
  if (state.doc.textBetween(from, to) !== misspelling.word) return;
  const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to));
  const tr = state.tr.replaceWith(from, to, state.schema.text(suggestion, marks));
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + suggestion.length)));
}

/** Every misspelled English word of the document, in order. */
export function misspelledWords(doc: PMNode, spell: NSpell): Word[] {
  const found: Word[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    found.push(...wordsOf(node, pos).filter((w) => !spell.correct(w.word)));
    return false;
  });
  return found;
}
