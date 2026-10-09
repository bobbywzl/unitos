import type NSpell from "nspell";
import { rankedSuggestions, readsAsEnglish, SPELL_SAMPLE, wordsInText, type TextWord } from "@/lib/spell-words";

// The spelling check's client (SPEC.md §29, typing): the page editor's and
// the note editor's red squiggles ask it which words of a paragraph are
// misspelled, and their cards ask it for spelling suggestions. The check
// runs in a worker (spell.worker.ts); where a worker cannot start, nspell
// runs here, built once.

type Ask = { kind: "check"; paragraphs: string[][] } | { kind: "suggest"; word: string };
export type SpellRequest = Ask & { id: number };
export type SpellReply =
  | { id: number; failed: true }
  | { id: number; suggestions: string[] }
  | { id: number; results: { bad: number[]; known: number }[] };

/** A paragraph's spelling: its misspelled words, and whether it reads as
    English (a paragraph that does not gets no red squiggle). */
export type ParagraphSpelling = { english: boolean; misspelled: TextWord[] };

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
  return {
    id,
    results: request.paragraphs.map((words) => {
      const bad: number[] = [];
      let known = 0;
      words.forEach((word, i) => {
        if (spell.correct(word)) {
          if (i < SPELL_SAMPLE) known++;
        } else bad.push(i);
      });
      return { bad, known };
    }),
  };
}

/** The spelling of each paragraph, its words as wordsInText reads them (or
    as given): the reader's own words (`accepted`, lower-cased) count as
    spelled right. Null when the dictionary cannot load. */
export async function checkParagraphs(
  paragraphs: { text: string; words?: TextWord[] }[],
  accepted: ReadonlySet<string>,
): Promise<ParagraphSpelling[] | null> {
  const words = paragraphs.map((p) => p.words ?? wordsInText(p.text));
  const reply = await ask({ kind: "check", paragraphs: words.map((list) => list.map((w) => w.word)) });
  if (!("results" in reply)) return null;
  return reply.results.map(({ bad, known }, i) => {
    const list = words[i];
    const misspelled: TextWord[] = [];
    let k = known;
    for (const at of bad) {
      if (accepted.has(list[at].word.toLowerCase())) {
        if (at < SPELL_SAMPLE) k++;
      } else misspelled.push(list[at]);
    }
    return { english: readsAsEnglish(paragraphs[i].text, list.length, k), misspelled };
  });
}

/** Up to five spelling suggestions for a word, the likeliest first. */
export async function spellingSuggestions(word: string): Promise<string[]> {
  const reply = await ask({ kind: "suggest", word });
  return "suggestions" in reply ? rankedSuggestions(word, reply.suggestions) : [];
}
