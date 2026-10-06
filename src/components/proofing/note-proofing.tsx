"use client";

import { useEffect, useReducer, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import "@/components/proofing/proofing.css";
import { useCollab } from "@/components/collab/collab-context";
import { serverTypingPrefs, subscribeTypingPrefs, typingPrefs } from "@/components/docs/typing/prefs";
import { acceptedWords, addToDictionary, ignoreAll } from "@/components/docs/typing/spelling";
import { cachedIssues, checkGrammar, ignoreIssue, sendable, subscribeGrammar } from "@/components/proofing/grammar-queue";
import { ProofingCard, type CardContent } from "@/components/proofing/proofing-card";
import { checkParagraphs, spellingSuggestions } from "@/components/proofing/spell-service";
import { GRAMMAR_PAUSE_MS, type GrammarIssue } from "@/lib/grammar";
import { lineElements, ownLeaves } from "@/lib/note-doc";
import { wordsInText } from "@/lib/spell-words";

// The note editor's squiggles (SPEC.md §29, typing; §6): the same red
// squiggle under a misspelled English word and blue squiggle under a
// grammar or wording problem as the page editor, with the same card. The
// note editor paints its text again after every edit (lib/note-editable.ts),
// so the squiggles are not in its text: they are ranges the browser draws
// over it (the CSS Custom Highlight API, proofing.css), worked out again a
// moment after each paint. Accept selects the wrong words and types the
// replacement, so the note editor makes it one edit with its own undo. A
// browser without the API keeps its own spelling check.

/** The key the words ignored in notes are kept under (Ignore all). */
const NOTES_KEY = "notes";
const SPELLING = "unitos-spelling";
const GRAMMAR = "unitos-grammar";
const PAINT_PAUSE_MS = 200;
const GRAMMAR_MIN_WORDS = 3;

type Line = { el: Element; text: string; at: (from: number, to: number) => Range | null };
type Mark = { range: Range; kind: "spelling"; word: string } | { range: Range; kind: "grammar"; issue: GrammarIssue; text: string };

type Registry = { add(range: Range): void; delete(range: Range): boolean };
type HighlightApi = { highlights: Map<string, Registry> & { set(name: string, h: Registry): void }; Highlight: new () => Registry };

function highlightApi(): HighlightApi | null {
  const css = (globalThis as { CSS?: { highlights?: unknown } }).CSS;
  const Highlight = (globalThis as { Highlight?: new () => Registry }).Highlight;
  if (!css?.highlights || !Highlight) return null;
  return { highlights: css.highlights as HighlightApi["highlights"], Highlight };
}

/** The highlight of a name, shared by every note editor on the page. */
function registry(name: string): Registry | null {
  const api = highlightApi();
  if (!api) return null;
  let h = api.highlights.get(name);
  if (!h) {
    h = new api.Highlight();
    api.highlights.set(name, h);
  }
  return h;
}

/** Each line's text — outside code, chips, and images — and a range for any
    stretch of it. */
function linesOf(root: HTMLElement): Line[] {
  return lineElements(root).map((el) => {
    let text = "";
    const runs: { node: Text; offset: number }[] = [];
    for (const leaf of ownLeaves(el)) {
      if (leaf.nodeType !== Node.TEXT_NODE || (leaf as Text).parentElement?.closest("code, pre, [contenteditable='false']")) {
        text += " ";
        continue;
      }
      runs.push({ node: leaf as Text, offset: text.length });
      text += (leaf as Text).data;
    }
    const at = (from: number, to: number): Range | null => {
      const run = runs.find((r) => r.offset <= from && to <= r.offset + r.node.data.length);
      if (!run) return null;
      const range = document.createRange();
      range.setStart(run.node, from - run.offset);
      range.setEnd(run.node, to - run.offset);
      return range;
    };
    return { el, text, at };
  });
}

const inRange = (range: Range, node: Node, offset: number) => {
  try {
    return range.comparePoint(node, offset) === 0;
  } catch {
    return false;
  }
};

export function NoteProofing({ target }: { target: RefObject<HTMLElement | null> }) {
  const { premium } = useCollab();
  const prefs = useSyncExternalStore(subscribeTypingPrefs, typingPrefs, serverTypingPrefs);
  const spelling = prefs.showSpelling;
  const grammar = prefs.showGrammar && premium;
  const marks = useRef<Mark[]>([]);
  const [open, setOpen] = useState<{ mark: Mark; suggestions: string[] | null } | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const el = target.current;
    const api = highlightApi();
    if (!el || !api || (!spelling && !grammar)) return;
    // Unitos draws the spelling here: the browser's own check stays off,
    // except on a line that does not read as English.
    const browserCheck = el.getAttribute("spellcheck");
    el.setAttribute("spellcheck", "false");
    const red = registry(SPELLING);
    const blue = registry(GRAMMAR);
    let disposed = false;
    let paintTimer: ReturnType<typeof setTimeout> | null = null;
    let grammarTimer: ReturnType<typeof setTimeout> | null = null;
    const english = new Map<string, boolean>();
    let opened = false;
    let lastTexts = "";

    const clear = (kind?: Mark["kind"]) => {
      marks.current = marks.current.filter((m) => {
        if (kind && m.kind !== kind) return true;
        (m.kind === "spelling" ? red : blue)?.delete(m.range);
        return false;
      });
    };
    const add = (mark: Mark) => {
      marks.current.push(mark);
      (mark.kind === "spelling" ? red : blue)?.add(mark.range);
    };

    /** The grammar squiggles of the lines answered so far. */
    const paintGrammar = (lines: Line[]) => {
      clear("grammar");
      if (!grammar) return;
      for (const line of lines) {
        for (const issue of cachedIssues(line.text) ?? []) {
          const i = line.text.indexOf(issue.wrong);
          const range = i >= 0 ? line.at(i, i + issue.wrong.length) : null;
          if (range) add({ range, kind: "grammar", issue, text: line.text });
        }
      }
    };

    /** Ask for the lines not answered yet that read as English. */
    const askGrammar = (lines: Line[], first: boolean) => {
      const texts = lines
        .map((l) => l.text)
        .filter((text) => sendable(text) && english.get(text) === true && wordsInText(text).length >= GRAMMAR_MIN_WORDS && !cachedIssues(text));
      if (texts.length) checkGrammar(texts, first);
    };

    const paint = async () => {
      if (disposed) return;
      const lines = linesOf(el);
      const found = await checkParagraphs(lines.map((l) => ({ text: l.text })), acceptedWords(NOTES_KEY));
      if (disposed || !found) return;
      // The text was painted again meanwhile: the next pass draws it.
      if (lines.some((l) => !l.el.isConnected)) return;
      clear("spelling");
      const sel = window.getSelection();
      const caret = sel && sel.isCollapsed && sel.anchorNode && el.contains(sel.anchorNode) ? sel : null;
      lines.forEach((line, i) => {
        english.set(line.text, found[i].english);
        line.el.removeAttribute("spellcheck");
        if (!found[i].english) {
          line.el.setAttribute("spellcheck", "true");
          return;
        }
        if (!spelling) return;
        for (const w of found[i].misspelled) {
          const range = line.at(w.from, w.to);
          if (!range) continue;
          // The word the caret is ending is not marked until the caret leaves it.
          if (caret && caret.anchorNode === range.endContainer && caret.anchorOffset === range.endOffset) continue;
          add({ range, kind: "spelling", word: w.word });
        }
      });
      paintGrammar(lines);
      if (!grammar) return;
      if (!opened) {
        // The note opened: every line is checked, a few at a time.
        opened = true;
        lastTexts = lines.map((l) => l.text).join("\n");
        askGrammar(lines, false);
        return;
      }
      // After a pause in typing, the lines not answered yet.
      const texts = lines.map((l) => l.text).join("\n");
      const typed = texts !== lastTexts;
      lastTexts = texts;
      if (!typed && grammarTimer) return;
      if (!lines.some((l) => !cachedIssues(l.text))) return;
      if (grammarTimer) clearTimeout(grammarTimer);
      grammarTimer = setTimeout(() => {
        grammarTimer = null;
        if (!disposed) askGrammar(linesOf(el), true);
      }, GRAMMAR_PAUSE_MS);
    };

    const schedule = () => {
      if (paintTimer) clearTimeout(paintTimer);
      paintTimer = setTimeout(() => {
        paintTimer = null;
        void paint();
      }, PAINT_PAUSE_MS);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    const onSelection = () => {
      // The caret left a word it was ending: draw it now.
      if (el.contains(document.activeElement)) schedule();
    };
    document.addEventListener("selectionchange", onSelection);
    const stopGrammar = subscribeGrammar(() => paintGrammar(linesOf(el)));
    const stopPrefs = subscribeTypingPrefs(schedule);
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      document.removeEventListener("selectionchange", onSelection);
      stopGrammar();
      stopPrefs();
      if (paintTimer) clearTimeout(paintTimer);
      if (grammarTimer) clearTimeout(grammarTimer);
      clear();
      if (browserCheck === null) el.removeAttribute("spellcheck");
      else el.setAttribute("spellcheck", browserCheck);
    };
  }, [target, spelling, grammar]);

  // A click on a squiggle opens its card.
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed || !sel.anchorNode || !el.contains(sel.anchorNode)) return setOpen(null);
        const { anchorNode, anchorOffset } = sel;
        const hits = marks.current.filter((m) => m.range.startContainer.isConnected && inRange(m.range, anchorNode, anchorOffset));
        const mark = hits.find((m) => m.kind === "grammar") ?? hits[0];
        if (!mark) return setOpen(null);
        setOpen({ mark, suggestions: null });
        if (mark.kind === "spelling") {
          void spellingSuggestions(mark.word).then((suggestions) => setOpen((o) => (o && o.mark === mark ? { ...o, suggestions } : o)));
        }
      }, 0);
    };
    el.addEventListener("mouseup", onUp);
    return () => el.removeEventListener("mouseup", onUp);
  }, [target]);

  // The card follows its words, and closes when they are gone.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", rerender, true);
    window.addEventListener("resize", rerender);
    const el = target.current;
    const observer = el ? new MutationObserver(() => setOpen(null)) : null;
    if (el) observer?.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      window.removeEventListener("scroll", rerender, true);
      window.removeEventListener("resize", rerender);
      observer?.disconnect();
    };
  }, [open, target]);

  if (!open) return null;
  const { mark } = open;
  const rect = mark.range.getBoundingClientRect();
  if (!mark.range.startContainer.isConnected || (rect.width === 0 && rect.height === 0)) return null;
  const expected = mark.kind === "grammar" ? mark.issue.wrong : mark.word;
  const content: CardContent = mark.kind === "grammar" ? { kind: "grammar", issue: mark.issue } : { kind: "spelling", word: mark.word, suggestions: open.suggestions };
  const close = () => setOpen(null);
  return (
    <ProofingCard
      box={{ left: rect.left - 8, top: rect.bottom + 6 }}
      content={content}
      onClose={close}
      onAccept={(replacement) => {
        close();
        const el = target.current;
        const sel = window.getSelection();
        if (!el || !sel || mark.range.toString() !== expected) return;
        // The note editor takes it as typed: one edit, its own undo step.
        el.focus({ preventScroll: true });
        sel.removeAllRanges();
        sel.addRange(mark.range);
        if (replacement) document.execCommand("insertText", false, replacement);
        else document.execCommand("delete");
      }}
      onIgnore={() => {
        close();
        if (mark.kind === "grammar") ignoreIssue(mark.text, mark.issue);
        else ignoreAll(NOTES_KEY, mark.word);
      }}
      onAddToDictionary={
        mark.kind === "spelling"
          ? () => {
              close();
              addToDictionary(mark.word);
            }
          : undefined
      }
    />
  );
}
