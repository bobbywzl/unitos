import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import "./borders.css";

// Borders and shading (SPEC.md §29), Google Docs' Format > Paragraph styles >
// Borders and shading: a paragraph's lines at its top, bottom, left, and
// right, the line between it and the next paragraph of its box, the room
// between the lines and the words (the padding), and its background (the
// shading). The sides are the attributes an import's Word borders already
// set (extensions.ts): "<width pt> <solid|dotted|dashed> #rrggbb <padding
// pt>"; the line between is the same, and the shading "#rrggbb <padding pt>".
// Paragraphs with the same borders and shading, one after another, draw one
// box, as Google Docs and Word draw them: the top line over the first, the
// bottom line under the last, the line between inside.

export type Dash = "solid" | "dotted" | "dashed";
export type BorderLine = { width: number; dash: Dash; color: string };
export type BorderPosition = "top" | "bottom" | "left" | "right" | "between";
export const POSITIONS: BorderPosition[] = ["top", "bottom", "left", "right", "between"];

const ATTR: Record<BorderPosition, string> = {
  top: "borderTop",
  bottom: "borderBottom",
  left: "borderLeft",
  right: "borderRight",
  between: "borderBetween",
};
const BOX_ATTRS = [...Object.values(ATTR), "shading"];

const SIDE = /^(\d{1,2}(?:\.\d{1,2})?) (solid|dotted|dashed) (#[0-9a-fA-F]{6})(?: (\d{1,2}(?:\.\d{1,2})?))?$/;
const SHADING = /^(#[0-9a-fA-F]{6})(?: (\d{1,2}(?:\.\d{1,2})?))?$/;

/** The largest padding, as the side's format holds it. */
export const MAX_PADDING = 99;

const num = (v: number) => String(Math.round(v * 100) / 100);

function readSide(value: unknown): { line: BorderLine; padding: number } | null {
  const m = typeof value === "string" ? SIDE.exec(value) : null;
  return m ? { line: { width: Number(m[1]), dash: m[2] as Dash, color: m[3].toLowerCase() }, padding: Number(m[4] ?? 0) } : null;
}

function readShading(value: unknown): { color: string; padding: number } | null {
  const m = typeof value === "string" ? SHADING.exec(value) : null;
  return m ? { color: m[1].toLowerCase(), padding: Number(m[2] ?? 0) } : null;
}

/** What a paragraph's box holds: its lines by position, the padding, and
    the shading. */
export type Box = { lines: Partial<Record<BorderPosition, BorderLine>>; padding: number; shading: string | null };

export function readBox(node: PMNode): Box {
  const lines: Box["lines"] = {};
  let padding: number | null = null;
  for (const position of POSITIONS) {
    const side = readSide(node.attrs[ATTR[position]]);
    if (!side) continue;
    lines[position] = side.line;
    padding ??= side.padding;
  }
  const shading = readShading(node.attrs.shading);
  return { lines, padding: padding ?? shading?.padding ?? 0, shading: shading?.color ?? null };
}

const isParagraph = (node: PMNode) => node.type.name === "paragraph" || node.type.name === "heading";

/** The paragraphs the selection touches, with their positions. */
function selectedParagraphs(editor: Editor): { node: PMNode; pos: number }[] {
  const { from, to } = editor.state.selection;
  const found: { node: PMNode; pos: number }[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!isParagraph(node)) return true;
    found.push({ node, pos });
    return false;
  });
  return found;
}

/** The box of the first paragraph the selection touches, and how many
    paragraphs it touches: where the dialog starts. */
export function selectionBox(editor: Editor): Box & { paragraphs: number } {
  const paragraphs = selectedParagraphs(editor);
  const first = paragraphs[0];
  return { ...(first ? readBox(first.node) : { lines: {}, padding: 0, shading: null }), paragraphs: paragraphs.length };
}

/** Apply: the positions that are on take `line` (a width of 0 takes them
    off), the others go, every line keeps `padding`, and the background is
    `shading` (null: none). On every paragraph the selection touches, one
    undo step; in Suggesting mode, one suggestion. */
export function applyBox(editor: Editor, box: { on: ReadonlySet<BorderPosition>; line: BorderLine; padding: number; shading: string | null }): boolean {
  const paragraphs = selectedParagraphs(editor);
  if (paragraphs.length === 0) return false;
  const padding = Math.min(MAX_PADDING, Math.max(0, box.padding));
  const side = box.line.width > 0 ? `${num(box.line.width)} ${box.line.dash} ${box.line.color} ${num(padding)}` : null;
  const attrs: Record<string, string | null> = {};
  for (const position of POSITIONS) attrs[ATTR[position]] = box.on.has(position) ? side : null;
  // A line between is between paragraphs: one paragraph has none.
  if (paragraphs.length === 1 && !paragraphs[0].node.attrs.borderBetween) attrs.borderBetween = null;
  attrs.shading = box.shading ? `${box.shading} ${num(padding)}` : null;
  const { tr } = editor.state;
  for (const { node, pos } of paragraphs) {
    const changed = BOX_ATTRS.some((name) => (node.attrs[name] ?? null) !== attrs[name]);
    if (changed) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

// ── One box for paragraphs with the same borders and shading ────────────

const boxKey = new PluginKey<DecorationSet>("docsParagraphBoxes");

/** A paragraph's box as a key: equal keys draw one box. A bar alone (a
    left or a right line, nothing else) joins its neighbors by the import's
    own rule (css/import.css). */
function boxSignature(node: PMNode): string | null {
  if (!isParagraph(node)) return null;
  const values = BOX_ATTRS.map((name) => (typeof node.attrs[name] === "string" ? (node.attrs[name] as string) : ""));
  if (values.every((v) => !v)) return null;
  const [top, bottom, , , between, shading] = values;
  if (!top && !bottom && !between && !shading) return null;
  return values.join("|");
}

function boxDecorations(doc: PMNode): DecorationSet {
  const found: Decoration[] = [];
  const walk = (parent: PMNode, start: number) => {
    let run: { from: number; to: number }[] = [];
    let key: string | null = null;
    const close = () => {
      if (run.length > 1) {
        run.forEach(({ from, to }, i) => {
          const place = i === 0 ? "first" : i === run.length - 1 ? "last" : "mid";
          found.push(Decoration.node(from, to, { class: `docs-box-${place}` }));
        });
      }
      run = [];
      key = null;
    };
    parent.forEach((child, offset) => {
      const pos = start + offset;
      const sig = boxSignature(child);
      if (sig === null || sig !== key) close();
      if (sig !== null) {
        key = sig;
        run.push({ from: pos, to: pos + child.nodeSize });
      }
      if (!child.isTextblock && !child.isAtom && child.childCount > 0) walk(child, pos + 1);
    });
    close();
  };
  walk(doc, 0);
  return found.length ? DecorationSet.create(doc, found) : DecorationSet.empty;
}

/** The boxes, drawn as the classes of their paragraphs (borders.css):
    first, middle, and last of each run of two or more. */
export const ParagraphBoxes = Extension.create({
  name: "docsParagraphBoxes",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: boxKey,
        state: {
          init: (_, { doc }) => boxDecorations(doc),
          apply: (tr, set, old, state) => {
            if (!tr.docChanged) return set;
            // Words typed in a paragraph change no box: the boxes move along.
            if (sameBlocks(old.doc, state.doc)) return set.map(tr.mapping, state.doc);
            return boxDecorations(state.doc);
          },
        },
        props: {
          decorations(state) {
            return boxKey.getState(state) ?? null;
          },
        },
      }),
    ];
  },
});

/** The same top-level blocks with the same boxes: only the words of its
    paragraphs changed (a list or a table that changed counts as changed). */
function sameBlocks(a: PMNode, b: PMNode): boolean {
  if (a.childCount !== b.childCount) return false;
  for (let i = 0; i < a.childCount; i++) {
    const x = a.child(i);
    const y = b.child(i);
    if (x.type !== y.type || boxSignature(x) !== boxSignature(y)) return false;
    if (!x.isTextblock && x !== y) return false;
  }
  return true;
}
