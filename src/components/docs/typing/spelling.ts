import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type NSpell from "nspell";
import { setTypingPrefs, typingPrefs } from "@/components/docs/typing/prefs";
import { checkParagraphs, spellingSuggestions } from "@/components/proofing/spell-service";
import { wordsInText, type TextWord } from "@/lib/spell-words";

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

// Spelling suggestions (SPEC.md §29, typing). Unitos draws the red squiggle
// under a misspelled English word (typing/proofing.ts) and offers the
// spelling suggestions — on the word's card, in the right-click menu — and
// the next and previous misspelling: nspell with the English Hunspell
// dictionary in public/spelling, in a worker (components/proofing).

type Word = TextWord;
export type Misspelling = Word & { suggestions: string[] };

let checker: Promise<NSpell | null> | null = null;

/** The English checker on the page's thread, loaded once per page (the next
    and previous misspelling); null when it cannot load. */
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

/** Words a suggested deletion strikes are not in the text. */
const struck = (node: PMNode) => node.marks.some((m) => m.type.name === "deletion");

/** The words of a paragraph the checker reads, with their positions: Latin
    words of two letters or more, outside code and outside the words a
    suggestion removes. */
export function wordsOf(block: PMNode, blockPos: number): Word[] {
  const words: Word[] = [];
  let run = "";
  let start = 0;
  const flush = () => {
    for (const w of wordsInText(run)) words.push({ word: w.word, from: start + w.from, to: start + w.to });
    run = "";
  };
  if (!block.type.spec.code) {
    block.forEach((child, offset) => {
      if (!child.isText || struck(child) || child.marks.some((m) => m.type.name === "code")) return flush();
      if (!run) start = blockPos + 1 + offset;
      run += child.text;
    });
  }
  flush();
  return words;
}

/** The misspelled English word at a position and its spelling suggestions
    (none, for a name the dictionary does not know), for the right-click
    menu and the word's card; null at once where there is none to check,
    where the word is one of the reader's own, or while the page is not
    editable or its spelling check is off. */
export function misspellingAt(editor: Editor, pos: number): Promise<Misspelling | null> | null {
  const $pos = editor.state.doc.resolve(pos);
  if (!editor.isEditable || !typingPrefs().showSpelling || !$pos.parent.isTextblock) return null;
  const word = wordsOf($pos.parent, $pos.before()).find((w) => w.from <= pos && pos <= w.to);
  if (!word || acceptedIn(editor.state).has(word.word.toLowerCase())) return null;
  return checkParagraphs([{ text: word.word, words: [{ word: word.word, from: 0, to: word.word.length }] }], NONE).then(async (found) => {
    if (!found || found[0].misspelled.length === 0) return null;
    return { ...word, suggestions: await spellingSuggestions(word.word) };
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

/** Every misspelled English word of the document, in order, the reader's
    own words (`accepted`, lower-cased) left out. */
export function misspelledWords(doc: PMNode, spell: NSpell, accepted: ReadonlySet<string> = new Set()): Word[] {
  const found: Word[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    found.push(...wordsOf(node, pos).filter((w) => !accepted.has(w.word.toLowerCase()) && !spell.correct(w.word)));
    return false;
  });
  return found;
}

// The reader's own words (SPEC.md §29, typing). Add to dictionary puts a word
// in the personal dictionary, which holds for every document in this browser;
// Ignore all puts it with the words ignored in this document. The check never
// flags them: the right-click menu offers nothing for them, the next and
// previous misspelling pass them, and the page turns the browser's own check
// off where each of them stands (spellcheck="false"), so no underline draws.

/** The most documents whose ignored words are kept: the newest. */
const MAX_IGNORED_DOCUMENTS = 200;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The words the check takes as spelled right in a document, lower-cased. */
export function acceptedWords(documentId: string | null): Set<string> {
  const prefs = typingPrefs();
  const ignored = documentId ? (prefs.ignoredWords[documentId] ?? []) : [];
  return new Set([...prefs.dictionary, ...ignored].map((w) => w.toLowerCase()));
}

export function addToDictionary(word: string): void {
  const { dictionary } = typingPrefs();
  if (dictionary.some((w) => same(w, word))) return;
  setTypingPrefs({ dictionary: [...dictionary, word].slice(-2000) });
}

export function removeFromDictionary(word: string): void {
  setTypingPrefs({ dictionary: typingPrefs().dictionary.filter((w) => !same(w, word)) });
}

export function ignoreAll(documentId: string, word: string): void {
  const { ignoredWords } = typingPrefs();
  const words = ignoredWords[documentId] ?? [];
  if (words.some((w) => same(w, word))) return;
  // The document goes last, so the oldest go first past the cap.
  const others = Object.entries(ignoredWords).filter(([id]) => id !== documentId).slice(-(MAX_IGNORED_DOCUMENTS - 1));
  setTypingPrefs({ ignoredWords: { ...Object.fromEntries(others), [documentId]: [...words, word].slice(-500) } });
}

type Exceptions = { words: ReadonlySet<string>; decos: DecorationSet };
const exceptionsKey = new PluginKey<Exceptions>("docsSpellingExceptions");
const NONE: ReadonlySet<string> = new Set();

/** The reader's own words in this page, lower-cased. */
export function acceptedIn(state: EditorState): ReadonlySet<string> {
  return exceptionsKey.getState(state)?.words ?? NONE;
}

/** The page's words set anew (the typing area sends them). */
export function setAcceptedWords(editor: Editor, words: ReadonlySet<string>): void {
  if (editor.isDestroyed) return;
  const now = acceptedIn(editor.state);
  if (now.size === words.size && [...words].every((w) => now.has(w))) return;
  editor.view.dispatch(editor.state.tr.setMeta(exceptionsKey, words).setMeta("addToHistory", false));
}

/** Where the reader's own words stand in a paragraph: the browser's check off there. */
function exceptionsIn(block: PMNode, blockPos: number, words: ReadonlySet<string>): Decoration[] {
  return wordsOf(block, blockPos)
    .filter((w) => words.has(w.word.toLowerCase()))
    .map((w) => Decoration.inline(w.from, w.to, { spellcheck: "false" }));
}

function exceptionsOf(doc: PMNode, words: ReadonlySet<string>): DecorationSet {
  if (words.size === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    decos.push(...exceptionsIn(node, pos, words));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** The reader's own words, marked where they stand. A change draws again
    only the paragraphs it touched. */
export function spellingExceptions(): Plugin<Exceptions> {
  return new Plugin<Exceptions>({
    key: exceptionsKey,
    state: {
      init: () => ({ words: NONE, decos: DecorationSet.empty }),
      apply(tr, value, _old, state) {
        const words = tr.getMeta(exceptionsKey) as ReadonlySet<string> | undefined;
        if (words) return { words, decos: exceptionsOf(state.doc, words) };
        if (!tr.docChanged || value.words.size === 0) return value;
        let decos = value.decos.map(tr.mapping, state.doc);
        const size = state.doc.content.size;
        tr.mapping.maps.forEach((map, i) => {
          const after = tr.mapping.slice(i + 1);
          map.forEach((_oldFrom, _oldTo, from, to) => {
            state.doc.nodesBetween(Math.max(0, after.map(from, -1)), Math.min(size, after.map(to, 1)), (node, pos) => {
              if (!node.isTextblock) return true;
              decos = decos.remove(decos.find(pos, pos + node.nodeSize)).add(state.doc, exceptionsIn(node, pos, value.words));
              return false;
            });
          });
        });
        return { words: value.words, decos };
      },
    },
    props: {
      decorations: (state) => exceptionsKey.getState(state)?.decos,
    },
  });
}
