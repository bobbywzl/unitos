import type { Mark, Node as PMNode, Schema } from "@tiptap/pm/model";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, Mapping, RemoveMarkStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { z } from "zod";

// The paragraph mark's style (SPEC.md §29, typing). A Google Docs paragraph
// ends in a mark with a text style of its own: a style set with the caret at
// a paragraph's end, or on a selection that reaches the end, styles the mark
// too; an empty paragraph types in its mark's style; a list item's bullet or
// number is drawn in it. ProseMirror has no such mark, so the paragraph
// keeps its style in the `markStyle` attribute: its marks as JSON.

/** The meta on the transactions this plugin appends. */
const MARK_STYLE_META = "docsMarkStyle";
/** The meta on the typing plugin's own restore of the pending style. */
export const TYPING_RESTORE_META = "docsTypingRestore";

/** The marks a paragraph mark keeps: text style, not links or comments. */
const STYLE_MARKS = new Set(["bold", "italic", "underline", "strike", "textStyle", "subscript", "superscript"]);

const MarksJson = z
  .array(z.object({ type: z.string().max(40), attrs: z.record(z.string(), z.unknown()).optional() }))
  .max(12);

/** The attribute as stored, or null when it is not a list of marks. */
export function validMarkStyle(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2000) return null;
  try {
    return MarksJson.safeParse(JSON.parse(value)).success ? value : null;
  } catch {
    return null;
  }
}

/** The paragraph mark's style as marks of `schema`, in the schema's order. */
function readMarkStyle(schema: Schema, value: unknown): Mark[] {
  if (typeof value !== "string" || !value) return [];
  let parsed: z.infer<typeof MarksJson>;
  try {
    parsed = MarksJson.parse(JSON.parse(value));
  } catch {
    return [];
  }
  let set: readonly Mark[] = [];
  for (const m of parsed) {
    const type = schema.marks[m.type];
    if (type && STYLE_MARKS.has(m.type)) set = type.create(m.attrs ?? null).addToSet(set);
  }
  return [...set];
}

/** Marks as the attribute stores them: the text style ones, null when none. */
function writeMarkStyle(marks: readonly Mark[]): string | null {
  const style = marks.filter((m) => STYLE_MARKS.has(m.type.name));
  if (!style.length) return null;
  return JSON.stringify(
    style.map((m) => {
      const attrs = Object.fromEntries(Object.entries(m.attrs).filter(([, v]) => v !== null && v !== undefined));
      return Object.keys(attrs).length ? { type: m.type.name, attrs } : { type: m.type.name };
    }),
  );
}

// ── Keeping the attribute ───────────────────────────────────────────────

/** The text blocks whose end lies in [from, to], with their positions. */
function blocksEndingIn(doc: PMNode, from: number, to: number): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  doc.nodesBetween(Math.max(0, from - 1), Math.min(doc.content.size, to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    const end = pos + 1 + node.content.size;
    if (from <= end && end <= to && "markStyle" in node.attrs) out.push({ node, pos });
    return false;
  });
  return out;
}

/** The mark steps of `transactions` that change text style, each with its
    range in the final document. */
function styleSteps(transactions: readonly Transaction[]): { step: AddMarkStep | RemoveMarkStep; from: number; to: number }[] {
  const out: { step: AddMarkStep | RemoveMarkStep; from: number; to: number }[] = [];
  transactions.forEach((tr, t) => {
    tr.steps.forEach((step, i) => {
      if (!(step instanceof AddMarkStep || step instanceof RemoveMarkStep)) return;
      if (!STYLE_MARKS.has(step.mark.type.name)) return;
      const rest = new Mapping(tr.mapping.maps.slice(i + 1));
      for (let u = t + 1; u < transactions.length; u++) rest.appendMapping(transactions[u].mapping);
      const from = rest.map(step.from, 1);
      const to = rest.map(step.to, -1);
      if (from < to) out.push({ step, from, to });
    });
  });
  return out;
}

function update(state: EditorState, transactions: readonly Transaction[]): Transaction | null {
  const { schema } = state;
  const next = new Map<number, string | null>();
  const sel = state.selection;
  // Undo and redo bring the attribute back themselves.
  const history = transactions.some((tr) => isHistoryTransaction(tr));

  // A style on a selection that reaches a paragraph's end styles its mark:
  // the mark takes the style of the paragraph's last character when the
  // selection holds it; otherwise (an empty paragraph, a selection that
  // starts at the end) the mark takes the style changes themselves.
  const steps = history ? [] : styleSteps(transactions);
  if (steps.length) {
    let from = Math.min(...steps.map((s) => s.from));
    let to = Math.max(...steps.map((s) => s.to));
    if (!sel.empty) {
      from = Math.min(from, sel.from);
      to = Math.max(to, sel.to);
    }
    for (const { node, pos } of blocksEndingIn(state.doc, from, to)) {
      const end = pos + 1 + node.content.size;
      let marks: readonly Mark[];
      if (node.lastChild && end - 1 >= from) marks = node.lastChild.marks;
      else {
        marks = readMarkStyle(schema, node.attrs.markStyle);
        for (const { step } of steps) {
          marks = step instanceof AddMarkStep ? step.mark.addToSet(marks) : step.mark.type.removeFromSet(marks);
        }
      }
      next.set(pos, writeMarkStyle(marks));
    }
  }

  // A style pressed with the caret at a paragraph's end styles its mark.
  const pressed =
    !history &&
    transactions.some(
      (tr) => tr.storedMarksSet && !tr.docChanged && !tr.getMeta(MARK_STYLE_META) && !tr.getMeta(TYPING_RESTORE_META),
    );
  if (pressed && sel.empty && state.storedMarks) {
    const $pos = sel.$from;
    if ($pos.parent.isTextblock && $pos.parentOffset === $pos.parent.content.size && "markStyle" in $pos.parent.attrs) {
      next.set($pos.before(), writeMarkStyle(state.storedMarks));
    }
  }

  const tr = state.tr;
  for (const [pos, value] of next) {
    const node = state.doc.nodeAt(pos);
    if (node && (node.attrs.markStyle ?? null) !== value) tr.setNodeAttribute(pos, "markStyle", value);
  }

  // An empty paragraph types in its mark's style.
  const moved = transactions.some((t) => (t.selectionSet || t.docChanged) && !t.getMeta(MARK_STYLE_META));
  const $caret = tr.selection.$from;
  if (moved && tr.selection.empty && !state.storedMarks && $caret.parent.isTextblock && $caret.parent.content.size === 0) {
    const marks = readMarkStyle(schema, $caret.parent.attrs.markStyle);
    if (marks.length) tr.setStoredMarks(marks);
  } else if (tr.docChanged && state.storedMarks) {
    // The attribute steps would drop the pending style.
    tr.setStoredMarks(state.storedMarks);
  }
  if (!tr.docChanged && !tr.storedMarksSet) return null;
  return tr.setMeta(MARK_STYLE_META, true);
}

// ── Drawing the list glyph in the mark's style ──────────────────────────

const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%a-z]+\)|[a-z]+)$/i;
const CSS_SIZE = /^\d+(\.\d+)?(pt|px|em|rem|%)$/;
const CSS_FONT = /^[\w\s"',.-]{1,200}$/;

/** A list item's attributes for its glyph: data-mark-* switches and the
    --docs-mark-* values typing.css reads. Null when the style changes nothing. */
function glyphAttrs(schema: Schema, value: unknown): Record<string, string> | null {
  const marks = readMarkStyle(schema, value);
  if (!marks.length) return null;
  const attrs: Record<string, string> = {};
  const style: string[] = [];
  for (const mark of marks) {
    const name = mark.type.name;
    if (name === "bold") attrs["data-mark-bold"] = "";
    else if (name === "italic") attrs["data-mark-italic"] = "";
    else if (name === "textStyle") {
      const { color, fontSize, fontFamily } = mark.attrs as Record<string, unknown>;
      if (typeof color === "string" && CSS_COLOR.test(color)) {
        attrs["data-mark-color"] = "";
        style.push(`--docs-mark-color: ${color}`);
      }
      if (typeof fontSize === "string" && CSS_SIZE.test(fontSize)) {
        attrs["data-mark-size"] = "";
        style.push(`--docs-mark-size: ${fontSize}`);
      }
      if (typeof fontFamily === "string" && CSS_FONT.test(fontFamily)) {
        attrs["data-mark-font"] = "";
        style.push(`--docs-mark-font: ${fontFamily}`);
      }
    }
  }
  if (style.length) attrs.style = style.join("; ");
  return Object.keys(attrs).length ? attrs : null;
}

function glyphDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    if (node.type.name === "listItem" && node.firstChild?.isTextblock) {
      const attrs = glyphAttrs(doc.type.schema, node.firstChild.attrs.markStyle);
      if (attrs) decorations.push(Decoration.node(pos, pos + node.nodeSize, attrs));
    }
    return true;
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

const markStyleKey = new PluginKey<DecorationSet>("docsMarkStyle");

/** Keeps each paragraph's mark style and draws list glyphs in it. */
export function markStylePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: markStyleKey,
    state: {
      init: (_config, state) => glyphDecorations(state.doc),
      apply: (tr, old, _oldState, newState) => (tr.docChanged ? glyphDecorations(newState.doc) : old),
    },
    props: {
      decorations: (state) => markStyleKey.getState(state),
    },
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.every((tr) => tr.getMeta(MARK_STYLE_META))) return null;
      if (!transactions.some((tr) => tr.docChanged || tr.selectionSet || tr.storedMarksSet)) return null;
      return update(newState, transactions);
    },
  });
}
