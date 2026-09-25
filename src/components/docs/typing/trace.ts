import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { setTypingPrefs, typingPrefs } from "@/components/docs/typing/prefs";

// The trace a spelling correction leaves (SPEC.md §29, typing): the word
// Docs corrected gets a dashed gray underline, and with the caret on it the
// autocorrect bubble offers Undo. Undo, or deleting the word and typing it
// again as it was, stops that correction for good.

export type Trace = { from: number; to: number; original: string; fixed: string };

/** A spelling correction's meta: the corrected range and the word typed. */
export const SPELLING_META = "docsSpellingFix";

export const traceKey = new PluginKey<Trace[]>("docsAutocorrectTrace");

/** Words whose correction was just deleted: typed again, they stay. */
const deleted = new Map<string, number>();

/** Whether `word` was corrected, then deleted, a moment ago. */
export function correctionDeleted(word: string): boolean {
  const at = deleted.get(word.toLowerCase());
  return at !== undefined && Date.now() - at < 120_000;
}

/** Never correct `word` again. */
export function blockCorrection(word: string): void {
  const key = word.toLowerCase();
  const prefs = typingPrefs();
  if (!prefs.spellingBlocklist.includes(key)) setTypingPrefs({ spellingBlocklist: [...prefs.spellingBlocklist, key] });
  deleted.delete(key);
}

function mapTraces(traces: Trace[], tr: Transaction, state: EditorState): Trace[] {
  const out: Trace[] = [];
  for (const t of traces) {
    const from = tr.mapping.map(t.from, 1);
    const to = tr.mapping.map(t.to, -1);
    if (to > from && state.doc.textBetween(from, to) === t.fixed) out.push({ ...t, from, to });
    else if (tr.docChanged) deleted.set(t.original.toLowerCase(), Date.now());
  }
  return out;
}

export function tracePlugin(): Plugin<Trace[]> {
  return new Plugin<Trace[]>({
    key: traceKey,
    state: {
      init: () => [],
      apply(tr, traces, _old, state) {
        let next = tr.docChanged ? mapTraces(traces, tr, state) : traces;
        const fix = tr.getMeta(SPELLING_META) as { from: number; to: number; original: string } | undefined;
        if (fix) next = [...next, { ...fix, fixed: state.doc.textBetween(fix.from, fix.to) }];
        const drop = tr.getMeta(traceKey) as Trace | undefined;
        if (drop) next = next.filter((t) => t.from !== drop.from);
        return next;
      },
    },
    props: {
      decorations(state) {
        const traces = traceKey.getState(state);
        if (!traces?.length) return null;
        return DecorationSet.create(
          state.doc,
          traces.map((t) => Decoration.inline(t.from, t.to, { class: "docs-autocorrected" })),
        );
      },
    },
  });
}

/** The trace the caret stands in or next to, if any. */
export function traceAtCaret(state: EditorState): Trace | null {
  const { empty, from } = state.selection;
  if (!empty) return null;
  return traceKey.getState(state)?.find((t) => from >= t.from && from <= t.to) ?? null;
}

/** The bubble's Undo: the word goes back to what was typed and is never corrected again. */
export function undoCorrection(view: EditorView, trace: Trace): void {
  const { state } = view;
  const marks = state.doc.nodeAt(trace.from)?.marks ?? [];
  const tr = state.tr.replaceWith(trace.from, trace.to, state.schema.text(trace.original, marks));
  tr.setMeta(traceKey, trace);
  view.dispatch(tr);
  blockCorrection(trace.original);
}
