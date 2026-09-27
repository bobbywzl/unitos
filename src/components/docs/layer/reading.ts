import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type StateField, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorProps, type EditorView } from "@tiptap/pm/view";
import { annotationMarksKey, type MarksMeta } from "@/components/docs/annotation-marks";
import { FIGURE, aroundPageStarts, findBlock, posInBlock } from "@/components/docs/layer/anchor";
import { TERM_MARK, termTip, type Highlight } from "@/components/reader/block-view";
import { inlineText } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";

// The reading layer over the page editor (SPEC.md §19, §8 Phase 7): the
// glossary's key terms underlined, and each paragraph's translation under
// it. Both read the paragraph index — the rows' ids, and offsets as the
// index counts them — and both are decorations: the rich text never changes.
// They show while the page is read (Viewing, or a reader who may not edit),
// as the block reader shows them in its reading mode only.

/** The page is read, not written: no caret, so a press is the reader's. */
const reading = (view: EditorView | null) => view !== null && !view.editable;

/** A plugin whose decorations show while the page is read. */
function readingPlugin<T>(
  key: PluginKey<T>,
  state: StateField<T>,
  decorations: (value: T) => DecorationSet,
  props: EditorProps = {},
): Plugin<T> {
  let view: EditorView | null = null;
  return new Plugin<T>({
    key,
    state,
    view(editorView) {
      view = editorView;
      return {
        destroy() {
          view = null;
        },
      };
    },
    props: {
      ...props,
      decorations: (s) => {
        const value = key.getState(s);
        return reading(view) && value !== undefined ? decorations(value) : null;
      },
    },
  });
}

// ── Key terms ───────────────────────────────────────────────────────────────

const termsKey = new PluginKey<DecorationSet>("docsKeyTerms");

/** The kinds the marks layer paints (annotation-marks.tsx): words under one
    of them show that mark, not the term, as block-view.tsx draws them. */
const MARKED = new Set<Highlight["kind"]>(["anchor", "pending-link", "salience", "simplify", "extract", "link"]);

/** A term's words that no mark covers, as offsets. */
function unmarked(term: Highlight, marks: Highlight[]): [number, number][] {
  let pieces: [number, number][] = [[term.start, term.end]];
  for (const m of marks) {
    pieces = pieces.flatMap(([a, b]): [number, number][] =>
      m.end <= a || m.start >= b
        ? [[a, b]]
        : [...(m.start > a ? [[a, m.start] as [number, number]] : []), ...(m.end < b ? [[m.end, b] as [number, number]] : [])],
    );
  }
  return pieces;
}

/** from..to less the words the text's own links and citations hold: those
    win over a term, as they do in the block reader. */
function beyondLinks(doc: PMNode, from: number, to: number): [number, number][] {
  const pieces: [number, number][] = [];
  let start = from;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    if (node.marks.some((m) => m.type.name === "link" || m.type.name === "citation")) {
      if (pos > start) pieces.push([start, pos]);
      start = Math.max(start, pos + node.nodeSize);
    }
    return false;
  });
  if (to > start) pieces.push([start, to]);
  return pieces;
}

/** Each key term of the highlights (kind "term", from the glossary's rows)
    as the block reader draws it: the dotted underline, the definition on
    hover. data-term holds its words' offsets for a press. */
function termDecorations(doc: PMNode, highlights: Record<string, Highlight[]>, t: MarksMeta["t"]): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const id = node.attrs.blockId as string | null;
    const list = id ? (highlights[id] ?? []) : [];
    // Where two terms meet, the first one listed draws, as in the block reader.
    const covered = list.filter((h) => MARKED.has(h.kind) && h.end > h.start);
    for (const term of list) {
      if (term.kind !== "term" || term.end <= term.start) continue;
      const attrs = {
        class: TERM_MARK,
        "data-term": `${term.start}:${term.end}`,
        "data-tip": termTip(term.definition, t),
        // Print leaves the Unitos layer out (css/page.css).
        "data-unitos-mark": "",
      };
      for (const [start, end] of unmarked(term, covered)) {
        const from = posInBlock(node, pos, start);
        const to = posInBlock(node, pos, end, true);
        for (const [a, b] of aroundPageStarts(doc, from, to)) {
          for (const [c, d] of beyondLinks(doc, a, b)) decorations.push(Decoration.inline(c, d, attrs));
        }
      }
      covered.push(term);
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** A click on a key term selects its words and opens the selection toolbar
    on them, marked as a key term (reader-interactions.tsx, dissect:term-tools),
    as a press on a term does in the block reader. A drag that starts on a
    term selects as any drag does. */
function clickTerm(view: EditorView, event: MouseEvent): boolean {
  if (!reading(view) || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!(window.getSelection()?.isCollapsed ?? true)) return false;
  const el = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-term]") : null;
  const blockId = el?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
  const block = el && blockId ? findBlock(view.state.doc, blockId) : null;
  if (!el || !block) return false;
  const [start, end] = (el.dataset.term ?? "").split(":").map(Number);
  const from = posInBlock(block.node, block.pos, start);
  const to = posInBlock(block.node, block.pos, end, true);
  if (!(to > from)) return false;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  const a = view.domAtPos(from, 1);
  const b = view.domAtPos(to, -1);
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  window.dispatchEvent(new CustomEvent("dissect:term-tools", { detail: { start, end, origin: el } }));
  return true;
}

/** The terms come with the marks layer's repaint (docs-editor.tsx), so they
    take its timing: painted from the stored copy's offsets, moved with the
    words in between. */
const keyTerms = () =>
  readingPlugin<DecorationSet>(
    termsKey,
    {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const marks = tr.getMeta(annotationMarksKey) as MarksMeta | undefined;
        if (marks && !marks.add) return termDecorations(tr.doc, marks.highlights, marks.t);
        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
      },
    },
    (set) => set,
    // Before the reader's own mouseup (on the document), which the toolbar
    // this opens tells to stand aside.
    { handleDOMEvents: { mouseup: clickTerm } },
  );

// ── Translations ────────────────────────────────────────────────────────────

type Lines = {
  translations: Record<string, string> | null;
  /** The words each translation was made from, by block id. */
  sources: Map<string, string>;
  set: DecorationSet;
};

const linesKey = new PluginKey<Lines>("docsTranslationLines");

/** The words the paragraph index holds for an indexed node: a paragraph's,
    or a figure's caption. */
function wordsOf(node: PMNode): string {
  return node.type.name === FIGURE ? String(node.attrs.caption ?? "") : inlineText(node.toJSON() as RichNode);
}

/** Calls fn on every paragraph and figure between from and to that has a
    blockId. */
function eachIndexed(doc: PMNode, from: number, to: number, fn: (node: PMNode, pos: number, id: string) => void) {
  doc.nodesBetween(from, to, (node, pos) => {
    const id = node.attrs.blockId;
    if (typeof id === "string" && id && (node.isTextblock || node.type.name === FIGURE)) {
      fn(node, pos, id);
      return false;
    }
    return !node.isTextblock && !node.isAtom;
  });
}

/** A translation reads under its paragraph: drawn from data-translation by
    css/reading.css, never words of the page. */
function line(node: PMNode, pos: number, id: string, lines: Omit<Lines, "set">): Decoration | null {
  const text = lines.translations?.[id];
  const words = lines.sources.get(id);
  // A paragraph whose words changed since shows its words alone until its
  // translation is written again (the next Translate). A translation that
  // reads as its words (a number, a name, an address) adds nothing.
  if (!text || words === undefined || words !== wordsOf(node) || text.trim() === words.trim()) return null;
  return Decoration.node(pos, pos + node.nodeSize, { "data-translation": text }, { translation: true });
}

/** The words each set of translations came from, read once, when it first
    reaches a page editor: Hide translation then Show translation hands the
    same set back, and a paragraph edited in between keeps its words alone. */
const sourcesOf = new WeakMap<Record<string, string>, Map<string, string>>();

function sourcesFor(doc: PMNode, translations: Record<string, string>): Map<string, string> {
  let sources = sourcesOf.get(translations);
  if (!sources) {
    const read = new Map<string, string>();
    eachIndexed(doc, 0, doc.content.size, (node, _pos, id) => {
      if (Object.hasOwn(translations, id)) read.set(id, wordsOf(node));
    });
    sourcesOf.set(translations, read);
    sources = read;
  }
  return sources;
}

function allLines(doc: PMNode, lines: Omit<Lines, "set">): DecorationSet {
  if (!lines.translations) return DecorationSet.empty;
  const out: Decoration[] = [];
  eachIndexed(doc, 0, doc.content.size, (node, pos, id) => {
    const deco = line(node, pos, id, lines);
    if (deco) out.push(deco);
  });
  return DecorationSet.create(doc, out);
}

/** After a change of the text: the lines mapped, and the paragraphs in the
    changed stretch drawn again. */
function changedLines(tr: Transaction, lines: Lines): DecorationSet {
  let set = lines.set.map(tr.mapping, tr.doc);
  const start = tr.before.content.findDiffStart(tr.doc.content);
  const end = tr.before.content.findDiffEnd(tr.doc.content);
  if (start === null || !end) return set;
  const add: Decoration[] = [];
  eachIndexed(tr.doc, Math.min(start, end.b), Math.max(start, end.b), (node, pos, id) => {
    set = set.remove(set.find(pos, pos + node.nodeSize, (spec) => spec.translation === true).filter((d) => d.from === pos));
    const deco = line(node, pos, id, lines);
    if (deco) add.push(deco);
  });
  return add.length > 0 ? set.add(tr.doc, add) : set;
}

const translationLines = () =>
  readingPlugin<Lines>(
    linesKey,
    {
      init: () => ({ translations: null, sources: new Map(), set: DecorationSet.empty }),
      apply(tr, lines) {
        const translations = tr.getMeta(linesKey) as Record<string, string> | null | undefined;
        if (translations !== undefined) {
          const next = { translations, sources: translations ? sourcesFor(tr.doc, translations) : new Map<string, string>() };
          return { ...next, set: allLines(tr.doc, next) };
        }
        return tr.docChanged && lines.translations ? { ...lines, set: changedLines(tr, lines) } : lines;
      },
    },
    (lines) => lines.set,
  );

/** The document's translations (the Translate bar, SPEC.md §19), each under
    its paragraph; null takes them away. */
export function showTranslations(editor: Editor, translations: Record<string, string> | null): void {
  if (editor.isDestroyed || linesKey.getState(editor.state)?.translations === translations) return;
  editor.view.dispatch(editor.state.tr.setMeta(linesKey, translations).setMeta("addToHistory", false));
}

/** The reading layer: set its translations with showTranslations; its key
    terms come with the marks layer's highlights. */
export const ReadingLayer = Extension.create({
  name: "docsReading",
  addProseMirrorPlugins() {
    return [keyTerms(), translationLines()];
  },
});
