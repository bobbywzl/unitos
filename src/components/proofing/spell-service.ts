import type NSpell from "nspell";
import { checkWords, rankedSuggestions, readsAsEnglish, SPELL_SAMPLE, wordsInText, type TextWord } from "@/lib/spell-words";

// The spelling check's client (SPEC.md §29, typing): the page editor's and
// the note editor's red squiggles ask it which words of a paragraph are
// misspelled, and their cards ask it for spelling suggestions. The check
// runs in a worker (spell.worker.ts); where a worker cannot start, nspell
// runs here, built once.

type Ask = { kind: "check"; paragraphs: { word: string; opens: boolean }[][] } | { kind: "suggest"; word: string };
export type SpellRequest = Ask & { id: number };
export type SpellReply =
  | { id: number; failed: true }
  | { id: number; suggestions: string[] }
  | { id: number; results: { bad: [number, string | null][]; known: number }[] };

/** A misspelled word the check is sure of, and the word it surely means
    (lib/spell-words.ts, sureFix). */
export type SureMisspelling = TextWord & { fix: string };

/** A paragraph's spelling: the misspelled words that get a red squiggle,
    and whether it reads as English (a paragraph that does not gets no red
    squiggle). */
export type ParagraphSpelling = { english: boolean; misspelled: SureMisspelling[] };

type Pending = (reply: SpellReply) => void;

let worker: Worker | null = null;
let workerBroken = false;
let fallback: Promise<NSpell | null> | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function startWorker(): Worker | null {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./spell.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<SpellReply>) => {
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      // The worker failed: what it owed answers from here.
      worker?.terminate();
      worker = null;
      workerBroken = true;
      for (const [id, done] of pending) done({ id, failed: true });
      pending.clear();
    };
  } catch {
    worker = null;
    workerBroken = true;
  }
  return worker;
}

function loadHere(): Promise<NSpell | null> {
  const text = (url: string) => fetch(url).then((res) => (res.ok ? res.text() : Promise.reject(new Error(url))));
  fallback ??= Promise.all([import("nspell"), text("/spelling/en.aff"), text("/spelling/en.dic")])
    .then(([{ default: nspell }, aff, dic]) => nspell(aff, dic))
    .catch(() => {
      fallback = null;
      return null;
    });
  return fallback;
}

async function ask(request: Ask): Promise<SpellReply> {
  const id = nextId++;
  const w = workerBroken ? null : startWorker();
  if (w) {
    return new Promise<SpellReply>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ ...request, id });
    });
  }
  const spell = await loadHere();
  if (!spell) return { id, failed: true };
  if (request.kind === "suggest") return { id, suggestions: spell.suggest(request.word) };
  const correct = (word: string) => spell.correct(word);
  return { id, results: request.paragraphs.map((words) => checkWords(words, correct)) };
}

/** The spelling of each paragraph, its words as wordsInText reads them (or
    as given): the reader's own words (`accepted`, lower-cased) count as
    spelled right. Null when the dictionary cannot load. */
export async function checkParagraphs(
  paragraphs: { text: string; words?: TextWord[] }[],
  accepted: ReadonlySet<string>,
): Promise<ParagraphSpelling[] | null> {
  const words = paragraphs.map((p) => p.words ?? wordsInText(p.text));
  const reply = await ask({ kind: "check", paragraphs: words.map((list) => list.map((w) => ({ word: w.word, opens: w.opens }))) });
  if (!("results" in reply)) return null;
  return reply.results.map(({ bad, known }, i) => {
    const list = words[i];
    const misspelled: SureMisspelling[] = [];
    let k = known;
    for (const [at, fix] of bad) {
      if (accepted.has(list[at].word.toLowerCase())) {
        if (at < SPELL_SAMPLE) k++;
      } else if (fix) misspelled.push({ ...list[at], fix });
    }
    return { english: readsAsEnglish(paragraphs[i].text, list.length, k), misspelled };
  });
}

/** Up to five spelling suggestions for a word, the likeliest first: the
    word it surely means (`fix`) heads them. */
export async function spellingSuggestions(word: string, fix?: string): Promise<string[]> {
  const reply = await ask({ kind: "suggest", word });
  const ranked = "suggestions" in reply ? rankedSuggestions(word, reply.suggestions) : [];
  return fix ? [fix, ...ranked.filter((s) => s !== fix)].slice(0, 5) : ranked;
}
