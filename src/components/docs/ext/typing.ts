import { Extension, type AnyExtension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, ReplaceStep } from "@tiptap/pm/transform";
import { isMac } from "@/components/docs/keys";
import { blockText, runAutocorrect } from "@/components/docs/typing/autocorrect";
import { wordAt } from "@/components/docs/typing/chars";
import { findPlugin } from "@/components/docs/typing/find";
import { clearFormatting, openLinkAtCaret, toggleCheckbox, toggleSmallCaps } from "@/components/docs/typing/format";
import { backspace, deleteForward, enter, groupEdit, lineBreak, moveParagraphs, tab } from "@/components/docs/typing/keys";
import { armPlainPaste, imageFiles, insertImageFiles, notePaste, plainTextSlice } from "@/components/docs/typing/paste";

// The page editor's typing extensions (SPEC.md §29): Google Docs' keys, its
// autocorrect engine, paste, and find. extensions.ts spreads this list into
// the editor.
//
// The typing extension runs before every other one (priority 1001): its
// keys win over Tiptap's defaults, and it owns typed text, so Tiptap's own
// input rules (StarterKit's Markdown shortcuts and the like) never run —
// Google Docs autoformats through its own rules, with Markdown off by
// default. A "@" or ":" menu (any @tiptap/suggestion plugin) keeps its keys.

declare module "@tiptap/core" {
  interface Storage {
    docsTyping: DocsTypingStorage;
  }
}

export type DocsTypingStorage = {
  /** The document is pageless: no page breaks, no page count. */
  pageless: boolean;
};

const typingKey = new PluginKey("docsTyping");

const MARKDOWN_MARKS = new Set(["bold", "italic", "strike", "code"]);

/** A Tiptap paste rule turning **x** into bold: marker deletions and
    bold, italic, strike, or code marks. Docs never autoformats a paste. */
function isMarkdownPasteRule(tr: Transaction): boolean {
  let marks = 0;
  let deletes = 0;
  for (const step of tr.steps) {
    if (step instanceof AddMarkStep && MARKDOWN_MARKS.has(step.mark.type.name)) marks++;
    else if (step instanceof ReplaceStep && step.slice.size === 0) deletes++;
    else return false;
  }
  return marks > 0 && deletes > 0;
}

const DocsTyping = Extension.create<Record<string, never>, DocsTypingStorage>({
  name: "docsTyping",
  priority: 1001,

  addStorage() {
    return { pageless: false };
  },

  addGlobalAttributes() {
    return [
      {
        // A list's preset, as the Google Docs API names it (typing/lists.ts).
        // The toolbar area defines the same attribute; either one serves.
        types: ["bulletList", "orderedList", "taskList"],
        attributes: {
          listStyle: {
            default: null,
            parseHTML: (el) => el.getAttribute("data-list-style"),
            renderHTML: (attrs) => (attrs.listStyle ? { "data-list-style": attrs.listStyle } : {}),
          },
        },
      },
      {
        // Small caps (Ctrl+Shift+K).
        types: ["textStyle"],
        attributes: {
          fontVariant: {
            default: null,
            parseHTML: (el) => (el.style.fontVariant === "small-caps" ? "small-caps" : null),
            renderHTML: (attrs) => (attrs.fontVariant ? { style: `font-variant: ${attrs.fontVariant}` } : {}),
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const e = this.editor;
    const mac = isMac();
    const move = (dir: -1 | 1) => () => moveParagraphs(e, dir);
    const shortcuts: Record<string, () => boolean> = {
      Enter: () => enter(e),
      "Shift-Enter": () => lineBreak(e),
      Backspace: () => backspace(e, "char"),
      "Shift-Backspace": () => backspace(e, "char"),
      Delete: () => deleteForward(e, false, mac),
      Tab: () => tab(e, false),
      "Shift-Tab": () => tab(e, true),
      // Normal text: Tiptap's paragraph binds the same keys first otherwise.
      "Mod-Alt-0": () => e.commands.setDocStyle("normal"),
      "Mod-\\": () => clearFormatting(e),
      "Ctrl-Shift-ArrowUp": move(-1),
      "Ctrl-Shift-ArrowDown": move(1),
      "Alt-Enter": () => openLinkAtCaret(e),
      "Mod-Alt-Enter": () => toggleCheckbox(e),
      // Pageless documents have no page breaks.
      "Mod-Enter": () => e.storage.docsTyping.pageless,
      "Mod-Shift-v": () => {
        armPlainPaste(e.view);
        return false;
      },
      "Mod-y": () => {
        e.commands.redo();
        return true;
      },
    };
    if (mac) {
      Object.assign(shortcuts, {
        "Alt-Backspace": () => backspace(e, "word"),
        "Mod-Backspace": () => backspace(e, "line"),
        "Alt-Delete": () => deleteForward(e, true, mac),
        "Mod-Shift-x": () => e.chain().toggleStrike().run(),
        "Alt-Shift-k": () => toggleSmallCaps(e),
      });
    } else {
      Object.assign(shortcuts, {
        "Ctrl-Backspace": () => backspace(e, "word"),
        "Ctrl-Delete": () => deleteForward(e, true, mac),
        "Alt-Shift-5": () => e.chain().toggleStrike().run(),
        "Ctrl-Shift-k": () => toggleSmallCaps(e),
        "Alt-Shift-k": () => toggleSmallCaps(e),
        "Ctrl-Space": () => clearFormatting(e),
        "Alt-Shift-ArrowUp": move(-1),
        "Alt-Shift-ArrowDown": move(1),
      });
    }
    return shortcuts;
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const plugin: Plugin = new Plugin({
      key: typingKey,
      props: {
        // Typed text goes in as one undo step with the typing around it;
        // then the autocorrect rules for the character run, each its own step.
        handleTextInput(view, from, to, text, deflt) {
          if (view.composing) return false;
          const plugins = view.state.plugins;
          for (let i = plugins.indexOf(plugin) + 1; i < plugins.length; i++) {
            const other = plugins[i];
            if ((other.spec as { isInputRules?: boolean }).isInputRules) continue;
            const handler = other.props.handleTextInput;
            if (handler && handler.call(other, view, from, to, text, deflt)) return true;
          }
          const tr = deflt();
          view.dispatch(groupEdit(view, tr, "insert"));
          if ([...text].length === 1) runAutocorrect(view, text);
          return true;
        },
        clipboardTextParser(text, $context, _plain, view) {
          return plainTextSlice(view.state.schema, text, $context, view.state.storedMarks ?? $context.marks());
        },
        handlePaste(view, event) {
          notePaste();
          const images = imageFiles(event.clipboardData?.files);
          const html = event.clipboardData?.getData("text/html") ?? "";
          if (images.length && !html.trim() && view.editable) {
            void insertImageFiles(editor, images);
            return true;
          }
          return false;
        },
        handleDrop(view, event, _slice, moved) {
          const images = imageFiles(event.dataTransfer?.files);
          if (moved || !images.length || !view.editable) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          event.preventDefault();
          void insertImageFiles(editor, images, at?.pos);
          return true;
        },
        handleDOMEvents: {
          // A double-click selects the word the Docs way: the word only, no
          // trailing space; don't and well-known are one word.
          dblclick(view) {
            window.setTimeout(() => {
              const sel = view.state.selection;
              if (!(sel instanceof TextSelection) || sel.empty || !sel.$from.sameParent(sel.$to)) return;
              const block = sel.$from.parent;
              if (!block.isTextblock) return;
              const word = wordAt(blockText(block), sel.$from.parentOffset);
              if (!word) return;
              const start = sel.$from.start();
              if (start + word.from === sel.from && start + word.to === sel.to) return;
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + word.from, start + word.to)));
            }, 0);
            return false;
          },
        },
      },
      // The pending style (Bold pressed with no selection) survives the
      // bookkeeping transactions other plugins append — a new paragraph's
      // block id — which ProseMirror would let clear it.
      appendTransaction(transactions, oldState, newState) {
        if (!oldState.storedMarks || newState.storedMarks || !newState.selection.empty) return null;
        const bookkeeping = transactions.every(
          (tr) => tr.getMeta("addToHistory") === false && !tr.selectionSet && !tr.storedMarksSet,
        );
        if (!bookkeeping || !oldState.selection.eq(newState.selection)) return null;
        return newState.tr.setStoredMarks(oldState.storedMarks).setMeta("addToHistory", false);
      },
      // Tiptap's own input rules never change the text (the typing area's
      // rules are Docs' rules), and a paste keeps its Markdown markers.
      filterTransaction(tr, state) {
        for (const p of state.plugins) {
          if ((p.spec as { isInputRules?: boolean }).isInputRules && tr.getMeta(p)) return false;
        }
        const root = tr.getMeta("appendedTransaction") as Transaction | undefined;
        const origin = root?.getMeta("uiEvent") as string | undefined;
        if ((origin === "paste" || origin === "drop") && isMarkdownPasteRule(tr)) return false;
        return true;
      },
    });
    return [plugin, findPlugin()];
  },
});

export const typingExtensions: AnyExtension[] = [DocsTyping];
