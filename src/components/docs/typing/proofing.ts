import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { acceptedIn, wordsOf } from "@/components/docs/typing/spelling";
import { cachedIssues, checkGrammar, clearGrammarQueue, sendable, subscribeGrammar } from "@/components/proofing/grammar-queue";
import { checkParagraphs } from "@/components/proofing/spell-service";
import { GRAMMAR_PAUSE_MS, type GrammarIssue } from "@/lib/grammar";

// The page editor's squiggles (SPEC.md §29, typing). A red squiggle under
// each misspelled English word of the whole document, and a blue one under
// the grammar and wording problems of English paragraphs, in Editing and
// Suggesting; none in Viewing. Both are decorations: nothing in the text
// changes until the reader accepts on a squiggle's card
// (proofing-card.tsx).
//
// The spelling: each paragraph's words go to the worker (components/
// proofing/spell-service.ts) in chunks, while the page is idle, and again
// only when the paragraph changes. A paragraph that does not read as
// English gets no red squiggle and keeps the browser's own check
// (spellcheck="true" on it; the page has it off), so two underlines never
// draw. The grammar: GRAMMAR_PAUSE_MS after the reader stops typing, the
// English paragraphs whose text changed go to /api/grammar
// (components/proofing/grammar-queue.ts); when the document opens, every
// English paragraph does, a few at a time. The answers are kept by the
// paragraph's text.

export type ProofingOn = { spelling: boolean; grammar: boolean };

type Result = { pos: number; node: PMNode; decos: Decoration[] };
type Meta = { on: ProofingOn } | { spell: Result[] } | { grammar: Result[]; taken?: boolean } | { recheck: number[] };

type ProofState = {
  on: ProofingOn;
  spell: DecorationSet;
  grammar: DecorationSet;
  /** The paragraphs (their start) whose spelling waits to be checked. */
  spellDirty: number[];
  /** The paragraphs changed since their grammar was last looked at. */
  grammarDirty: number[];
};

/** What a squiggle's card shows. */
export type Squiggle =
  | { kind: "spelling"; from: number; to: number; word: string }
  | { kind: "grammar"; from: number; to: number; issue: GrammarIssue; text: string };

const proofingKey = new PluginKey<ProofState>("docsProofing");
const OFF: ProofingOn = { spelling: false, grammar: false };
/** The most paragraphs in one spelling chunk. */
const CHUNK = 200;
/** The pause after a change before its paragraphs' spelling is checked. */
const SPELL_PAUSE_MS = 250;
/** The least number of words a paragraph needs for the grammar check. */
const GRAMMAR_MIN_WORDS = 3;

/** Every paragraph's start. */
function textblocks(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    out.push(pos);
    return false;
  });
  return out;
}

/** The decorations that stand on one paragraph. */
function within(set: DecorationSet, pos: number, node: PMNode): Decoration[] {
  const end = pos + node.nodeSize;
  return set.find(pos, end).filter((d) => d.from >= pos && d.to <= end);
}

function replaceIn(set: DecorationSet, doc: PMNode, results: Result[], dirty: number[]): { set: DecorationSet; dirty: number[] } {
  // One removal and one addition for the whole batch: a set rebuilt per
  // paragraph costs a long document a frame.
  const gone: Decoration[] = [];
  const added: Decoration[] = [];
  const done = new Set<number>();
  for (const r of results) {
    if (doc.nodeAt(r.pos) !== r.node) continue;
    gone.push(...within(set, r.pos, r.node));
    added.push(...r.decos);
    done.add(r.pos);
  }
  const next = done.size ? set.remove(gone).add(doc, added) : set;
  return { set: next, dirty: done.size ? dirty.filter((p) => !done.has(p)) : dirty };
}

const uniq = (list: number[]) => [...new Set(list)];

/** The paragraphs a transaction changed, in the new document, with the
    changed stretches. */
function changed(tr: Transaction): { blocks: number[]; ranges: [number, number][] } {
  const blocks: number[] = [];
  const ranges: [number, number][] = [];
  const size = tr.doc.content.size;
  tr.mapping.maps.forEach((map, i) => {
    const after = tr.mapping.slice(i + 1);
    map.forEach((_oldFrom, _oldTo, from, to) => {
      const a = Math.max(0, after.map(from, -1));
      const b = Math.min(size, after.map(to, 1));
      ranges.push([a, b]);
      tr.doc.nodesBetween(a, b, (node, pos) => {
        if (!node.isTextblock) return true;
        blocks.push(pos);
        return false;
      });
    });
  });
  return { blocks: uniq(blocks), ranges };
}

function proofingState(): Plugin<ProofState> {
  return new Plugin<ProofState>({
    key: proofingKey,
    state: {
      init: () => ({ on: OFF, spell: DecorationSet.empty, grammar: DecorationSet.empty, spellDirty: [], grammarDirty: [] }),
      apply(tr, value, oldState, state) {
        let v = value;
        if (tr.docChanged) {
          const { blocks, ranges } = changed(tr);
          let spell = v.spell.map(tr.mapping, state.doc);
          let grammar = v.grammar.map(tr.mapping, state.doc);
          // The squiggles the change touched go at once; the rest of the
          // paragraph keeps its own until the paragraph is checked again.
          for (const [a, b] of ranges) {
            spell = spell.remove(spell.find(Math.max(0, a - 1), b + 1).filter((d) => d.spec.word !== undefined));
            grammar = grammar.remove(grammar.find(Math.max(0, a - 1), b + 1));
          }
          const map = (list: number[]) => list.map((p) => tr.mapping.map(p));
          v = {
            ...v,
            spell,
            grammar,
            spellDirty: v.on.spelling ? uniq([...blocks, ...map(v.spellDirty)]) : [],
            grammarDirty: v.on.grammar ? uniq([...blocks, ...map(v.grammarDirty)]) : [],
          };
        }
        // Added to the dictionary or ignored: every paragraph again.
        if (v.on.spelling && acceptedIn(oldState) !== acceptedIn(state)) v = { ...v, spellDirty: textblocks(state.doc) };
        const meta = tr.getMeta(proofingKey) as Meta | undefined;
        if (!meta) return v;
        if ("on" in meta) {
          const { spelling, grammar } = meta.on;
          return {
            on: meta.on,
            spell: spelling ? (v.on.spelling ? v.spell : DecorationSet.empty) : DecorationSet.empty,
            spellDirty: spelling ? (v.on.spelling ? v.spellDirty : textblocks(state.doc)) : [],
            grammar: grammar ? v.grammar : DecorationSet.empty,
            grammarDirty: grammar ? (v.on.grammar ? v.grammarDirty : textblocks(state.doc)) : [],
          };
        }
        if ("recheck" in meta) return { ...v, spellDirty: uniq([...meta.recheck, ...v.spellDirty]) };
        if ("spell" in meta) {
          if (!v.on.spelling) return v;
          const { set, dirty } = replaceIn(v.spell, state.doc, meta.spell, v.spellDirty);
          // A paragraph that is gone leaves the list too.
          return { ...v, spell: set, spellDirty: dirty.filter((p) => state.doc.nodeAt(p)?.isTextblock) };
        }
        if (!v.on.grammar) return v;
        const { set } = replaceIn(v.grammar, state.doc, meta.grammar, []);
        return { ...v, grammar: set, grammarDirty: meta.taken ? [] : v.grammarDirty };
      },
    },
    props: {
      decorations: (state) => proofingKey.getState(state)?.spell,
    },
    view: (view) => new Driver(view),
  });
}

/** The grammar's squiggles drawn as a set of their own. */
function grammarLayer(): Plugin {
  return new Plugin({
    props: {
      decorations: (state) => proofingKey.getState(state)?.grammar,
    },
  });
}

export function proofingPlugins(): Plugin[] {
  return [proofingState(), grammarLayer()];
}

/** The squiggles on or off: the typing area sends what the mode and the
    preferences allow. */
export function setProofing(editor: Editor, on: ProofingOn): void {
  if (editor.isDestroyed) return;
  const now = proofingKey.getState(editor.state)?.on;
  if (!now || (now.spelling === on.spelling && now.grammar === on.grammar)) return;
  editor.view.dispatch(editor.state.tr.setMeta(proofingKey, { on } satisfies Meta).setMeta("addToHistory", false));
}

/** The squiggle at a position: a grammar issue first, then a misspelled word. */
export function squiggleAt(state: EditorState, pos: number): Squiggle | null {
  const s = proofingKey.getState(state);
  if (!s) return null;
  const hit = (set: DecorationSet) => set.find(pos, pos).find((d) => d.from <= pos && pos <= d.to && d.from < d.to && !isNode(d));
  const grammar = hit(s.grammar);
  if (grammar) {
    // The paragraph's text now, not as it was checked: an Accept or a word
    // typed elsewhere in it since must not send Ignore to the old text.
    const $pos = state.doc.resolve(grammar.from);
    const text = $pos.parent.isTextblock && $pos.depth > 0 ? paragraphText($pos.parent, $pos.before()).text : grammar.spec.text;
    return { kind: "grammar", from: grammar.from, to: grammar.to, issue: grammar.spec.issue, text };
  }
  const spell = hit(s.spell);
  if (spell?.spec.word !== undefined) return { kind: "spelling", from: spell.from, to: spell.to, word: spell.spec.word };
  return null;
}

const isNode = (d: Decoration) => (d.spec as { node?: boolean }).node === true;

/** A paragraph's text as the grammar check reads it — without the words a
    suggestion removes — and where each stretch of it stands on the page. */
export function paragraphText(node: PMNode, pos: number): { text: string; at: (from: number, to: number) => [number, number] | null } {
  let text = "";
  const runs: { offset: number; pos: number; len: number }[] = [];
  node.forEach((child, offset) => {
    const start = pos + 1 + offset;
    if (child.isText) {
      if (child.marks.some((m) => m.type.name === "deletion")) return;
      const last = runs[runs.length - 1];
      const t = child.text ?? "";
      if (last && last.pos + last.len === start && last.offset + last.len === text.length) last.len += t.length;
      else runs.push({ offset: text.length, pos: start, len: t.length });
      text += t;
    } else {
      text += " ";
    }
  });
  const at = (from: number, to: number): [number, number] | null => {
    const run = runs.find((r) => r.offset <= from && to <= r.offset + r.len);
    return run ? [run.pos + from - run.offset, run.pos + to - run.offset] : null;
  };
  return { text, at };
}

function grammarDecos(node: PMNode, pos: number, issues: readonly GrammarIssue[]): Decoration[] {
  const { text, at } = paragraphText(node, pos);
  const decos: Decoration[] = [];
  for (const issue of issues) {
    const i = text.indexOf(issue.wrong);
    const range = i >= 0 ? at(i, i + issue.wrong.length) : null;
    if (range) decos.push(Decoration.inline(range[0], range[1], { class: "docs-grammar" }, { issue, text, inclusiveStart: false, inclusiveEnd: false }));
  }
  return decos;
}

const idle = (fn: () => void, timeout: number): (() => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1);
  return () => clearTimeout(id);
};

/** The work off the typing path: the spelling chunks, the grammar pause,
    and the answers drawn when they arrive. */
class Driver {
  private spellTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelIdle: (() => void) | null = null;
  private spellRunning = false;
  private grammarTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: () => void;
  /** Whether each paragraph text read as English, from its spelling. */
  private english = new Map<string, boolean>();
  /** The misspelled word left alone while the caret ends it. */
  private held: { pos: number; to: number } | null = null;
  private destroyed = false;

  constructor(private view: EditorView) {
    this.unsubscribe = subscribeGrammar((texts) => this.drawGrammar(texts));
    // A driver made again (the editor took new plugins) picks up the work
    // the last one left.
    setTimeout(() => {
      if (!this.destroyed) this.update(this.view, this.view.state);
    }, 0);
  }

  update(view: EditorView, prev: EditorState) {
    this.view = view;
    const s = proofingKey.getState(view.state);
    const was = proofingKey.getState(prev);
    if (!s || !was) return;
    const edited = view.state.doc !== prev.doc;
    if (s.on.spelling && s.spellDirty.length > 0) this.scheduleSpell(edited ? SPELL_PAUSE_MS : 0);
    if (!s.on.grammar && was.on.grammar) clearGrammarQueue();
    // Typing waits for the pause; the check that starts with the document
    // (every paragraph dirty) runs now.
    if (s.on.grammar && s.grammarDirty.length > 0) {
      if (edited) this.scheduleGrammar(GRAMMAR_PAUSE_MS, true);
      else if (!this.grammarTimer) this.scheduleGrammar(0, false);
    }
    // The caret left the word it was ending: that word is checked now.
    if (this.held && !edited && view.state.selection.head !== this.held.to) {
      const { pos } = this.held;
      this.held = null;
      setTimeout(() => {
        if (!this.destroyed) this.view.dispatch(this.view.state.tr.setMeta(proofingKey, { recheck: [pos] } satisfies Meta).setMeta("addToHistory", false));
      }, 0);
    }
  }

  destroy() {
    this.destroyed = true;
    this.unsubscribe();
    if (this.spellTimer) clearTimeout(this.spellTimer);
    if (this.grammarTimer) clearTimeout(this.grammarTimer);
    this.cancelIdle?.();
  }

  private scheduleSpell(delay: number) {
    if (this.spellRunning) return;
    if (this.spellTimer) clearTimeout(this.spellTimer);
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.spellTimer = setTimeout(() => {
      this.spellTimer = null;
      this.cancelIdle = idle(() => {
        this.cancelIdle = null;
        void this.runSpell();
      }, 1000);
    }, delay);
  }

  private async runSpell() {
    const { state } = this.view;
    const s = proofingKey.getState(state);
    if (this.destroyed || !s?.on.spelling || s.spellDirty.length === 0) return;
    this.spellRunning = true;
    const items: { pos: number; node: PMNode; words: ReturnType<typeof wordsOf>; text: string }[] = [];
    // The paragraphs on screen first, then in order.
    for (const pos of this.visibleFirst(s.spellDirty)) {
      if (items.length >= CHUNK) break;
      const node = state.doc.nodeAt(pos);
      if (!node?.isTextblock) continue;
      items.push({ pos, node, words: wordsOf(node, pos), text: paragraphText(node, pos).text });
    }
    let found: Awaited<ReturnType<typeof checkParagraphs>> = null;
    try {
      found = items.length ? await checkParagraphs(items.map((i) => ({ text: i.text, words: i.words })), acceptedIn(state)) : [];
    } finally {
      this.spellRunning = false;
    }
    if (this.destroyed || !found) return;
    const now = this.view.state;
    const head = now.selection.empty ? now.selection.head : -1;
    const results: Result[] = items.map((item, i) => {
      const { english, misspelled } = found[i];
      this.remember(item.text, english);
      if (!english) return { pos: item.pos, node: item.node, decos: [Decoration.node(item.pos, item.pos + item.node.nodeSize, { spellcheck: "true" }, { node: true })] };
      const decos: Decoration[] = [];
      for (const w of misspelled) {
        // The word the caret is ending is not marked until the caret leaves it.
        if (w.to === head) {
          this.held = { pos: item.pos, to: w.to };
          continue;
        }
        decos.push(Decoration.inline(w.from, w.to, { class: "docs-misspelled" }, { word: w.word, inclusiveStart: false, inclusiveEnd: false }));
      }
      return { pos: item.pos, node: item.node, decos };
    });
    this.view.dispatch(now.tr.setMeta(proofingKey, { spell: results } satisfies Meta).setMeta("addToHistory", false));
  }

  /** The positions with those whose paragraph is on screen first. */
  private visibleFirst(list: number[]): number[] {
    const dom = this.view.dom;
    const box = (dom.closest(".overflow-y-auto") ?? document.documentElement).getBoundingClientRect();
    let top: number | null = null;
    let bottom: number | null = null;
    try {
      top = this.view.posAtCoords({ left: box.left + box.width / 2, top: Math.max(box.top, 0) + 2 })?.pos ?? null;
      bottom = this.view.posAtCoords({ left: box.left + box.width / 2, top: Math.min(box.bottom, window.innerHeight) - 2 })?.pos ?? null;
    } catch {
      top = bottom = null;
    }
    const sorted = [...list].sort((a, b) => a - b);
    if (top === null || bottom === null) return sorted;
    const lo = top - 2000;
    const hi = bottom + 2000;
    return [...sorted.filter((p) => p >= lo && p <= hi), ...sorted.filter((p) => p < lo || p > hi)];
  }

  private remember(text: string, english: boolean) {
    if (this.english.size > 5000) this.english.clear();
    this.english.set(text, english);
  }

  private scheduleGrammar(delay: number, first: boolean) {
    if (this.grammarTimer) clearTimeout(this.grammarTimer);
    this.grammarTimer = setTimeout(() => {
      this.grammarTimer = null;
      this.runGrammar(first);
    }, delay);
  }

  /** The paragraphs changed since the last look (every one when the check
      starts): those answered are drawn now, the English ones not yet
      answered are asked for — before the others waiting when the reader
      just wrote them (`first`). */
  private runGrammar(first: boolean) {
    if (this.destroyed) return;
    const { state } = this.view;
    const s = proofingKey.getState(state);
    if (!s?.on.grammar) return;
    // The paragraphs on screen first.
    const list = first ? s.grammarDirty : this.visibleFirst(s.grammarDirty);
    const results: Result[] = [];
    const unknown: { text: string }[] = [];
    const ask: string[] = [];
    for (const pos of first ? [...list].sort((a, b) => a - b) : list) {
      const node = state.doc.nodeAt(pos);
      if (!node?.isTextblock || node.type.spec.code) continue;
      const { text } = paragraphText(node, pos);
      const issues = cachedIssues(text);
      if (issues) results.push({ pos, node, decos: grammarDecos(node, pos, issues) });
      else if (!sendable(text) || wordsOf(node, pos).length < GRAMMAR_MIN_WORDS) results.push({ pos, node, decos: [] });
      else if (this.english.get(text) === undefined) unknown.push({ text });
      else if (this.english.get(text)) ask.push(text);
    }
    this.view.dispatch(state.tr.setMeta(proofingKey, { grammar: results, taken: true } satisfies Meta).setMeta("addToHistory", false));
    if (ask.length) checkGrammar(ask, first);
    if (unknown.length === 0) return;
    // Paragraphs whose language is not known yet: their spelling first.
    void checkParagraphs(unknown, acceptedIn(state)).then((found) => {
      if (!found || this.destroyed) return;
      const english: string[] = [];
      found.forEach((f, i) => {
        this.remember(unknown[i].text, f.english);
        if (f.english) english.push(unknown[i].text);
      });
      if (english.length && proofingKey.getState(this.view.state)?.on.grammar) checkGrammar(english, first);
    });
  }

  /** Answers arrived (or an issue was ignored): the paragraphs with those texts. */
  private drawGrammar(texts: ReadonlySet<string>) {
    if (this.destroyed) return;
    const { state } = this.view;
    if (!proofingKey.getState(state)?.on.grammar) return;
    const results: Result[] = [];
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const { text } = paragraphText(node, pos);
      if (texts.has(text)) results.push({ pos, node, decos: grammarDecos(node, pos, cachedIssues(text) ?? []) });
      return false;
    });
    if (results.length) this.view.dispatch(state.tr.setMeta(proofingKey, { grammar: results } satisfies Meta).setMeta("addToHistory", false));
  }
}
