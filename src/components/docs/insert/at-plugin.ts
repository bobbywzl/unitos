import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { insertContext, insertLayerOn } from "@/components/docs/insert/context";

// The "@" menu's trigger (SPEC.md §29), as Google Docs opens it: typing "@"
// at the start of a line or after a space, a tab, "(" or "[" opens the menu
// under it; the "@" and the words typed after it stay in the text as the
// query, with a gray "Search menu" in place of the query until the first
// letter. ":" and letters open the same menu with only emoji. The empty
// line's "Type @ to insert" opens it with nothing typed. The menu itself is
// the InsertLayer's (at-menu.tsx); this plugin tracks the query's range,
// hands the keys to the menu while it is open, and draws the hints.

export type AtTrigger = "@" | ":" | "";

/** The menu's state. `range` is the "@query" text; `char` "" = opened from
    the empty line's hint, nothing typed before the query. The typing area
    reads `active`, `range`, and `query` to leave the keys to the menu. */
export type AtState = { active: boolean; char: AtTrigger; range: { from: number; to: number }; query: string };

const INACTIVE: AtState = { active: false, char: "@", range: { from: 0, to: 0 }, query: "" };

export const atMenuKey = new PluginKey<AtState>("docsAtMenu");

type Meta = { open: { from: number; char: AtTrigger } } | { close: true };

const PREFIXES = new Set([" ", "\t", "(", "[", " ", "\n"]);

/** The menu's key handler for one editor view, set by the open menu. */
const keyHandlers = new WeakMap<EditorView, (event: KeyboardEvent) => boolean>();

export function setAtKeyHandler(view: EditorView, handler: ((event: KeyboardEvent) => boolean) | null): void {
  if (handler) keyHandlers.set(view, handler);
  else keyHandlers.delete(view);
}

/** The colon opens emoji unless the reader turned it off (Tools >
    Preferences > "Insert emojis using the colon character"). */
export const COLON_PREF = "unitos.docs.colonEmoji";

function colonOn(): boolean {
  try {
    return window.localStorage.getItem(COLON_PREF) !== "off";
  } catch {
    return true;
  }
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
    let pending: { from: number; char: AtTrigger } | null = null;
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
            } else if (pending && tr.docChanged) {
              // The "@" or ":" just typed: open when it landed where it was typed.
              const { from, char } = pending;
              pending = null;
              if (next.doc.content.size > from && next.doc.textBetween(from, from + 1, "\n", "￼") === char) {
                s = { active: true, char, range: { from, to: from + 1 }, query: "" };
              }
            } else if (prev.active && tr.docChanged) {
              s = { ...prev, range: { from: tr.mapping.map(prev.range.from, -1), to: tr.mapping.map(prev.range.to) } };
            }
            return s.active ? validate(s, next) : s;
          },
        },
        props: {
          handleTextInput(view, from, _to, text) {
            if (text !== "@" && text !== ":") return false;
            if (!insertLayerOn(editor) || !editor.isEditable) return false;
            if (atMenuKey.getState(view.state)?.active) return false;
            if (text === ":" && !colonOn()) return false;
            if (!prefixOk(view.state, from)) return false;
            pending = { from, char: text };
            return false;
          },
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
            const t = insertContext(editor)?.t;
            if (!t) return null;
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
