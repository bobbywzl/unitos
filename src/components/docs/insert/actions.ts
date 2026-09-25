import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Person } from "@/lib/person";
import type { Lang } from "@/lib/i18n/config";
import { dateLabel, type DateFormat } from "@/components/docs/insert/dates";
import { newDropdownId, optionColor, writeOptions, type DropdownOption } from "@/components/docs/insert/dropdowns";
import { insertFootnote } from "@/components/docs/insert/footnotes";

// What the "@" menu, the right-click menus, and the commands insert
// (SPEC.md §29). Each takes the range to replace — the "@query" the menu
// opened with, or the selection — and puts the object there, caret after.

export type Range = { from: number; to: number };

function selectionRange(editor: Editor): Range {
  const { from, to } = editor.state.selection;
  return { from, to };
}

/** Put inline content in place of `range` and leave the caret after it. */
export function insertInline(editor: Editor, content: JSONContent | JSONContent[], range = selectionRange(editor)): boolean {
  return editor.chain().focus().insertContentAt(range, content).run();
}

export function insertDateChip(
  editor: Editor,
  iso: string,
  lang: Lang,
  opts: { range?: Range; format?: DateFormat; time?: string | null } = {},
): boolean {
  const format = opts.format ?? "mdy";
  const time = opts.time ?? null;
  return insertInline(
    editor,
    [{ type: "dateChip", attrs: { date: iso, format, time, label: dateLabel(iso, format, time, lang) } }, { type: "text", text: " " }],
    opts.range,
  );
}

export function insertPersonChip(editor: Editor, person: Person, range?: Range): boolean {
  return insertInline(
    editor,
    [
      { type: "personChip", attrs: { personId: person.id, label: person.name, color: person.color, symbol: person.symbol } },
      { type: "text", text: " " },
    ],
    range,
  );
}

export function projectDocHref(notebookId: string, documentId: string): string {
  return `/n/${notebookId}?doc=${documentId}`;
}

export function insertFileChip(
  editor: Editor,
  doc: { id: string; title: string },
  notebookId: string,
  range?: Range,
): boolean {
  return insertInline(
    editor,
    [
      { type: "fileChip", attrs: { documentId: doc.id, href: projectDocHref(notebookId, doc.id), label: doc.title } },
      { type: "text", text: " " },
    ],
    range,
  );
}

/** A dropdown chip showing its first option. */
export function insertDropdownChip(
  editor: Editor,
  dropdown: { id?: string | null; name: string; options: DropdownOption[] },
  range?: Range,
): boolean {
  const first = dropdown.options[0];
  if (!first) return false;
  return insertInline(
    editor,
    [
      {
        type: "dropdownChip",
        attrs: {
          dropdownId: dropdown.id ?? newDropdownId(),
          name: dropdown.name,
          dropdownOptions: writeOptions(dropdown.options),
          label: first.label,
          backgroundColor: optionColor(first.color),
        },
      },
      { type: "text", text: " " },
    ],
    range,
  );
}

export function newBookmarkId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `id.${Array.from(bytes, (b) => b.toString(36)).join("").slice(0, 12)}`;
}

export function insertBookmark(editor: Editor, range?: Range): boolean {
  return insertInline(editor, { type: "bookmark", attrs: { bookmarkId: newBookmarkId() } }, range);
}

/** Delete the "@query" first, then run `then` at the caret. */
export function replaceQuery(editor: Editor, range: Range | null, then: () => void): void {
  if (range && range.to > range.from) editor.chain().focus().deleteRange(range).run();
  else editor.commands.focus();
  then();
}

export function insertFootnoteAt(editor: Editor, range: Range | null): void {
  replaceQuery(editor, range, () => insertFootnote(editor));
}

/** An equation: on an empty line it is its own block (an EQUATION row), in
    a line of words it sits in the line. Returns the node's position. */
export function insertEquation(editor: Editor, range: Range | null): number | null {
  let at: number | null = null;
  replaceQuery(editor, range, () => {
    const { state } = editor;
    const $from = state.selection.$from;
    const emptyLine = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && $from.depth === 1;
    if (emptyLine && state.schema.nodes.blockMath) {
      const pos = $from.before();
      const tr = state.tr.replaceWith(pos, pos + $from.parent.nodeSize, state.schema.nodes.blockMath.create({ latex: "" }));
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      editor.view.dispatch(tr);
      at = pos;
      return;
    }
    const type = state.schema.nodes.inlineMath;
    if (!type) return;
    const pos = state.selection.from;
    const tr = state.tr.replaceSelectionWith(type.create({ latex: "" }), false);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    editor.view.dispatch(tr);
    at = pos;
  });
  return at;
}

/** A horizontal line; on an empty line it takes the line's place and the
    caret goes to a new empty line under it. */
export function insertHorizontalLine(editor: Editor, range: Range | null): void {
  replaceQuery(editor, range, () => {
    const { state } = editor;
    const $from = state.selection.$from;
    const para = $from.parent;
    const hr = state.schema.nodes.horizontalRule;
    if (hr && para.type.name === "paragraph" && para.content.size === 0 && $from.depth >= 1) {
      const pos = $from.before();
      const tr = state.tr.replaceWith(pos, pos + para.nodeSize, [hr.create(), state.schema.nodes.paragraph.create()]);
      tr.setSelection(TextSelection.create(tr.doc, pos + 2));
      editor.view.dispatch(tr.scrollIntoView());
      return;
    }
    editor.chain().focus().setHorizontalRule().run();
  });
}

export function insertTableOfContents(editor: Editor, style: "plain" | "dotted" | "links", range: Range | null): void {
  replaceQuery(editor, range, () => {
    editor
      .chain()
      .focus()
      .insertContent([{ type: "tableOfContents", attrs: { tocStyle: style } }, { type: "paragraph" }])
      .run();
  });
}

export function insertCodeBlock(editor: Editor, language: string | null, range: Range | null): void {
  replaceQuery(editor, range, () => {
    editor.chain().focus().setCodeBlock(language ? { language } : undefined).run();
  });
}

/** Put the caret right after the node at `pos`. */
export function caretAfter(editor: Editor, pos: number): void {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const after = Math.min(pos + node.nodeSize, editor.state.doc.content.size);
  const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(after)));
  editor.view.dispatch(tr);
  editor.view.focus();
}
