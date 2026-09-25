import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { insertLayerOn, insertT } from "@/components/docs/insert/context";
import { typingPrefs } from "@/components/docs/typing/prefs";

// The "@" menu's trigger (SPEC.md §29): "@" at a line start or after a
// space, a tab, "(" or "[" opens the menu, and the words typed after it are
// the query; ":" and letters open it with emoji only. The empty line's
// "Type @ to insert" opens it with nothing typed. The menu is at-menu.tsx;
// this plugin tracks the query, hands the menu the keys, and draws the hints.

type AtTrigger = "@" | ":" | "";

/** The menu's state. `range` is the "@query" text; `char` "" = opened from
    the empty line's hint, nothing typed before the query. The typing area
    reads `active` (atMenuState) to leave the keys to the menu. */
export type AtState = { active: boolean; char: AtTrigger; range: { from: number; to: number }; query: string };

const INACTIVE: AtState = { active: false, char: "@", range: { from: 0, to: 0 }, query: "" };

const atMenuKey = new PluginKey<AtState>("docsAtMenu");

type Meta = { open: { from: number; char: AtTrigger } } | { close: true };

const PREFIXES = new Set([" ", "\t", "(", "[", " ", "\n"]);

/** The menu's key handler for one editor view, set by the open menu. */
const keyHandlers = new WeakMap<EditorView, (event: KeyboardEvent) => boolean>();

export function setAtKeyHandler(view: EditorView, handler: ((event: KeyboardEvent) => boolean) | null): void {
  if (handler) keyHandlers.set(view, handler);
  else keyHandlers.delete(view);
}

function prefixOk(state: EditorState, from: number): boolean {
  const $from = state.doc.resolve(from);
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return false;
  if ($from.parentOffset === 0) return true;
  const before = state.doc.textBetween(from - 1, from, "\n", "￼");
  return PREFIXES.has(before);
}

function validate(s: AtState, state: EditorState): AtState {
  const sel = state.selection;
  if (!sel.empty) return INACTIVE;
  const start = s.range.from + s.char.length;
  const head = sel.head;
  if (head < start || start > state.doc.content.size) return INACTIVE;
  const $from = state.doc.resolve(s.range.from);
  if (sel.$head.start() !== $from.start() || !$from.parent.isTextblock) return INACTIVE;
  if (s.char && state.doc.textBetween(s.range.from, start, "\n", "￼") !== s.char) return INACTIVE;
  const query = state.doc.textBetween(start, head, "\n", "￼");
  if (query.includes("￼") || query.includes("\n")) return INACTIVE;
  if (query.length > 60 || /\s\s/.test(query)) return INACTIVE;
  if (s.char === ":" && /[^\p{L}\p{N}_+-]/u.test(query)) return INACTIVE;
  return { ...s, range: { from: s.range.from, to: head }, query };
}

/** Open the menu at the caret with nothing typed (the empty line's hint). */
export function openAtMenuHere(view: EditorView): void {
  const { selection } = view.state;
  if (!selection.empty) return;
  view.dispatch(view.state.tr.setMeta(atMenuKey, { open: { from: selection.from, char: "" } } satisfies Meta));
  view.focus();
}

export function closeAtMenu(view: EditorView): void {
  if (!atMenuKey.getState(view.state)?.active) return;
  view.dispatch(view.state.tr.setMeta(atMenuKey, { close: true } satisfies Meta));
}

export function atMenuState(state: EditorState): AtState {
  return atMenuKey.getState(state) ?? INACTIVE;
}

/** The "@" or ":" a transaction typed where the menu opens: a small text
    insertion (typing, one key or a burst of keys) with the caret right after
    it, the character at a line start or after a space, a tab, "(" or "[".
    Paste, drop, undo, and redo never open the menu. */
function typedTrigger(tr: Transaction, next: EditorState): { from: number; char: AtTrigger } | null {
  if (!tr.docChanged || tr.getMeta("paste") || tr.getMeta("uiEvent") || tr.getMeta("history$")) return null;
  const step = tr.steps[tr.steps.length - 1];
  if (!(step instanceof ReplaceStep) || step.from !== step.to) return null;
  const content = step.slice.content;
  if (step.slice.openStart !== 0 || content.childCount !== 1 || !content.firstChild?.isText) return null;
  const text = content.firstChild.text ?? "";
  if (text.length === 0 || text.length > 12) return null;
  // The step's position in the document the transaction ends with.
  const later = tr.mapping.slice(tr.steps.length).map(step.from);
  if (next.selection.head !== later + text.length || !next.selection.empty) return null;
  const $at = next.doc.resolve(later);
  if (!$at.parent.isTextblock || $at.parent.type.spec.code) return null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "@" && ch !== ":") continue;
    if (ch === ":" && !typingPrefs().colonEmoji) continue;
    const ok = i === 0 ? prefixOk(next, later) : PREFIXES.has(text[i - 1]);
    if (ok) return { from: later + i, char: ch };
  }
  return null;
}

function hintWidget(editor: Editor, label: string) {
  return () => {
    const span = document.createElement("span");
    span.className = "docs-at-hint";
    span.contentEditable = "false";
    span.setAttribute("data-anchor-skip", "");
    span.setAttribute("aria-hidden", "true");
    span.textContent = label;
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!editor.isEditable) return;
      openAtMenuHere(editor.view);
    });
    return span;
  };
}

function placeholderWidget(label: string) {
  return () => {
    const span = document.createElement("span");
    span.className = "docs-at-placeholder";
    span.setAttribute("data-anchor-skip", "");
    span.setAttribute("aria-hidden", "true");
    span.textContent = label;
    return span;
  };
}

/** An empty line where the hint may show: a paragraph or a heading with the
    caret, outside a table cell, a footnote, and code. */
function hintAt(state: EditorState): number | null {
  const sel = state.selection;
  if (!sel.empty) return null;
  const $pos = sel.$head;
  const parent = $pos.parent;
  if (!parent.isTextblock || parent.content.size > 0 || parent.type.spec.code) return null;
  for (let d = $pos.depth - 1; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader" || name === "footnote") return null;
  }
  return $pos.pos;
}

export const AtMenu = Extension.create({
  name: "docsAtMenu",
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<AtState>({
        key: atMenuKey,
        state: {
          init: () => INACTIVE,
          apply(tr: Transaction, prev: AtState, _old: EditorState, next: EditorState): AtState {
            const meta = tr.getMeta(atMenuKey) as Meta | undefined;
            if (meta && "close" in meta) return INACTIVE;
            let s = prev;
            if (meta && "open" in meta) {
              s = { active: true, char: meta.open.char, range: { from: meta.open.from, to: meta.open.from }, query: "" };
            } else if (!prev.active) {
              const typed = editor.isEditable && insertLayerOn(editor) ? typedTrigger(tr, next) : null;
              if (typed) s = { active: true, char: typed.char, range: { from: typed.from, to: typed.from + 1 }, query: "" };
            } else if (tr.docChanged) {
              s = { ...prev, range: { from: tr.mapping.map(prev.range.from, -1), to: tr.mapping.map(prev.range.to) } };
            }
            return s.active ? validate(s, next) : s;
          },
        },
        props: {
          handleKeyDown(view, event) {
            const s = atMenuKey.getState(view.state);
            if (!s?.active) return false;
            const handler = keyHandlers.get(view);
            if (handler && handler(event)) {
              event.preventDefault();
              return true;
            }
            if (event.key === "Escape") {
              closeAtMenu(view);
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            blur(view) {
              // Leaving the page closes the menu, unless the focus went into
              // the menu's own field (a picker's search, the date's time).
              window.setTimeout(() => {
                if (view.isDestroyed || view.hasFocus()) return;
                if (document.activeElement?.closest("[data-docs-insert-popover]")) return;
                closeAtMenu(view);
              }, 0);
              return false;
            },
          },
          decorations(state) {
            const s = atMenuKey.getState(state);
            const t = insertT(editor);
            if (s?.active) {
              if (s.query || s.char === ":") return null;
              return DecorationSet.create(state.doc, [
                Decoration.widget(s.range.to, placeholderWidget(t("docsInsert.searchMenu")), { side: 1, key: "at-placeholder" }),
              ]);
            }
            if (!editor.isEditable || !insertLayerOn(editor)) return null;
            const at = hintAt(state);
            if (at === null) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(at, hintWidget(editor, t("docs.typeAtToInsert")), { side: 1, key: "at-hint", ignoreSelection: true }),
            ]);
          },
        },
      }),
    ];
  },
});
