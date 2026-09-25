"use client";

import type { Editor } from "@tiptap/core";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";
import { SUGGESTION_MARK_TYPES } from "@/lib/docs/schema";

// Paint format (SPEC.md §29): a press copies the formatting where the
// selection starts — its text formatting (every mark but a link) and its
// paragraph's (the named style, alignment, line spacing, space before and
// after, indents) — and the next selection made in the page takes it when
// the mouse is released; then the button turns off. A second press within
// 500 ms keeps it on for more selections until Escape or another press.
// List membership is not copied.

export type Formatting = {
  marks: readonly Mark[];
  block: { type: string; attrs: Record<string, unknown> } | null;
};

const PARAGRAPH_ATTRS = [
  "textAlign",
  "lineSpacing",
  "spaceBefore",
  "spaceAfter",
  "indentLeft",
  "indentRight",
  "indentFirstLine",
  "docStyle",
];

/** The formatting where the selection starts. */
export function captureFormatting(state: EditorState): Formatting {
  const { selection } = state;
  const $from = selection.$from;
  const marks = selection.empty
    ? (state.storedMarks ?? $from.marks())
    : (state.doc.nodeAt(selection.from)?.marks ?? $from.marks());
  const parent = $from.parent;
  const attrs: Record<string, unknown> = {};
  for (const name of PARAGRAPH_ATTRS) if (name in parent.attrs) attrs[name] = parent.attrs[name];
  if (parent.type.name === "heading") attrs.level = parent.attrs.level;
  return {
    marks: marks.filter((m) => m.type.name !== "link" && !SUGGESTION_MARK_TYPES.has(m.type.name)),
    block: parent.isTextblock && (parent.type.name === "paragraph" || parent.type.name === "heading") ? { type: parent.type.name, attrs } : null,
  };
}

/** The copied formatting on the selection: its text takes the marks (links
    stay), and each paragraph it touches takes the paragraph formatting. */
export function applyFormatting(editor: Editor, formatting: Formatting): void {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty) {
    tr.setStoredMarks(formatting.marks);
  } else {
    for (const type of Object.values(state.schema.marks)) {
      if (type.name !== "link" && !SUGGESTION_MARK_TYPES.has(type.name)) tr.removeMark(from, to, type);
    }
    for (const mark of formatting.marks) tr.addMark(from, to, mark);
  }
  const block = formatting.block;
  if (block) {
    const blocks: { node: PMNode; pos: number }[] = [];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        blocks.push({ node, pos });
        return false;
      }
      return true;
    });
    for (const { node, pos } of blocks) {
      const type = state.schema.nodes[block.type];
      if (!type) continue;
      const known = type.spec.attrs ?? {};
      const attrs: Record<string, unknown> = { ...node.attrs };
      for (const [name, value] of Object.entries(block.attrs)) if (name in known) attrs[name] = value;
      try {
        // A list line's first paragraph cannot become a heading; it keeps
        // its type and takes the rest.
        tr.setNodeMarkup(pos, type, attrs);
      } catch {
        const same: Record<string, unknown> = { ...node.attrs };
        for (const name of PARAGRAPH_ATTRS) if (name in same && name in block.attrs) same[name] = block.attrs[name];
        tr.setNodeMarkup(pos, undefined, same);
      }
    }
  }
  editor.view.dispatch(tr);
}

/** The toolbar's Paint format button. */
export function usePaintFormat(editor: Editor) {
  const [paint, setPaint] = useState<{ formatting: Formatting; locked: boolean } | null>(null);
  const lastPress = useRef(0);

  useEffect(() => {
    const dom = editor.view.dom;
    if (!paint) {
      dom.classList.remove("docs-painting");
      return;
    }
    dom.classList.add("docs-painting");
    const onUp = () => {
      window.setTimeout(() => {
        if (editor.isDestroyed || editor.state.selection.empty) return;
        applyFormatting(editor, paint.formatting);
        if (!paint.locked) setPaint(null);
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPaint(null);
    };
    dom.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      dom.classList.remove("docs-painting");
    };
  }, [editor, paint]);

  const press = () => {
    const now = performance.now();
    const quick = now - lastPress.current < 500;
    lastPress.current = now;
    if (paint && !paint.locked && quick) {
      setPaint({ ...paint, locked: true });
      return;
    }
    if (paint) {
      setPaint(null);
      return;
    }
    setPaint({ formatting: captureFormatting(editor.state), locked: false });
  };

  return { active: paint !== null, press };
}
