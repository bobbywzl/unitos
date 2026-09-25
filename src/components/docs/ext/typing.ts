import { Extension, type AnyExtension, type Editor } from "@tiptap/core";
import {
  HardBreakNode,
  InvisibleCharacter,
  InvisibleCharacters,
  ParagraphNode,
  SpaceCharacter,
} from "@tiptap/extension-invisible-characters";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, ReplaceStep } from "@tiptap/pm/transform";
import { isMac } from "@/components/docs/keys";
import { blockText, runAutocorrect } from "@/components/docs/typing/autocorrect";
import { wordAt } from "@/components/docs/typing/chars";
import { findPlugin } from "@/components/docs/typing/find";
import { TYPING_EVENT, fireTyping } from "@/components/docs/typing/events";
import {
  copyFormatting,
  openLinkAtCaret,
  pasteFormatting,
  toggleCheckbox,
  toggleSmallCaps,
} from "@/components/docs/typing/format";
import {
  backspace,
  closeEdit,
  deleteForward,
  enter,
  groupEdit,
  lineBreak,
  moveParagraphs,
  moveToParagraph,
  moveWord,
  tab,
} from "@/components/docs/typing/keys";
import { markStylePlugin, TYPING_RESTORE_META, validMarkStyle } from "@/components/docs/typing/mark-style";
import { armPlainPaste, imageFiles, insertImageFiles, notePaste, plainTextSlice } from "@/components/docs/typing/paste";
import { repeatLastAction, repeatPlugin } from "@/components/docs/typing/repeat";
import { tracePlugin } from "@/components/docs/typing/trace";

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
  /** The browser underlines misspelled words (Spelling and grammar check). */
  spellcheck: boolean;
};

/** Update the typing storage (the page area's pageless switch, the spelling switch). */
export function setTypingStorage(editor: Editor, patch: Partial<DocsTypingStorage>): void {
  Object.assign(editor.storage.docsTyping, patch);
}

const typingKey = new PluginKey("docsTyping");

const MARKDOWN_MARKS = new Set(["bold", "italic", "strike", "code"]);

/** A Tiptap paste rule turning **x** into bold: it deletes Markdown markers
    and adds bold, italic, strike, or code. Docs never autoformats a paste. */
function isMarkdownPasteRule(tr: Transaction): boolean {
  let deletes = 0;
  for (let i = 0; i < tr.steps.length; i++) {
    const step = tr.steps[i];
    if (step instanceof AddMarkStep && MARKDOWN_MARKS.has(step.mark.type.name)) continue;
    if (!(step instanceof ReplaceStep) || step.slice.size !== 0) return false;
    const removed = tr.docs[i].textBetween(step.from, step.to, "\n", "\n");
    if (!/^[\s*_~`]+$/.test(removed)) return false;
    deletes++;
  }
  return deletes > 0;
}

const PT_PER_UNIT: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 72 / 2.54, mm: 72 / 25.4 };

function toPoints(value: string): number | null {
  const m = /^(-?[\d.]+)(pt|px|in|cm|mm)$/.exec(value.trim());
  if (!m) return null;
  const n = parseFloat(m[1]) * PT_PER_UNIT[m[2]];
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Pasted HTML keeps its paragraphs' indents and spacing: the CSS becomes
    the data attributes the page editor's paragraphs read. */
function keepParagraphFormat(html: string): string {
  if (typeof DOMParser === "undefined" || !/margin|text-indent|padding/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll<HTMLElement>("p, h1, h2, h3, h4, h5, h6").forEach((el) => {
    const set = (attr: string, value: string) => {
      const pt = value ? toPoints(value) : null;
      if (pt && !el.hasAttribute(attr)) el.setAttribute(attr, String(pt));
    };
    set("data-indent-left", el.style.marginLeft);
    set("data-indent-first-line", el.style.textIndent);
    set("data-space-before", el.style.marginTop || el.style.paddingTop);
    set("data-space-after", el.style.marginBottom || el.style.paddingBottom);
  });
  return doc.body.innerHTML;
}

const DocsTyping = Extension.create<Record<string, never>, DocsTypingStorage>({
  name: "docsTyping",
  priority: 1001,

  addStorage() {
    return { pageless: false, spellcheck: true };
  },

  addGlobalAttributes() {
    return [
      {
        // A list's preset, as the Google Docs API names it (typing/lists.ts),
        // on the outermost list. The toolbar area draws each preset's glyphs.
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
        // The paragraph mark's style (typing/mark-style.ts), as JSON.
        types: ["paragraph", "heading"],
        attributes: {
          markStyle: {
            default: null,
            parseHTML: (el) => validMarkStyle(el.getAttribute("data-mark-style")),
            renderHTML: (attrs) => (attrs.markStyle ? { "data-mark-style": attrs.markStyle } : {}),
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
      // Clear formatting: the toolbar's command, the same as its button.
      "Mod-\\": () => e.commands.clearFormatting(),
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
      // Redo; with nothing to redo, repeat the last formatting.
      "Mod-y": () => {
        if (e.can().redo()) e.commands.redo();
        else repeatLastAction(e.view);
        return true;
      },
      // View > Show non-printing characters.
      "Mod-Shift-p": () => e.commands.toggleInvisibleCharacters(),
      "Mod-Alt-c": () => copyFormatting(e),
      "Mod-Alt-v": () => pasteFormatting(e),
      // Voice typing; Tiptap's strikethrough takes these keys otherwise.
      "Mod-Shift-s": () => {
        fireTyping(TYPING_EVENT.voice);
        return true;
      },
      // Keys Tiptap binds and Docs does not: inline code, a quote.
      "Mod-e": () => true,
      "Mod-Shift-b": () => true,
      // Center, bound again here: with Caps Lock on, Ctrl+Shift+E reads as
      // Ctrl+E, which the line above would take.
      "Mod-Shift-e": () => e.commands.setTextAlign("center"),
    };
    if (mac) {
      Object.assign(shortcuts, {
        "Alt-Backspace": () => backspace(e, "word"),
        "Mod-Backspace": () => backspace(e, "line"),
        "Alt-Delete": () => deleteForward(e, true, mac),
        "Mod-Shift-x": () => e.chain().toggleStrike().run(),
        "Alt-Shift-k": () => toggleSmallCaps(e),
        // Word and paragraph moves by Docs' classes; Shift extends.
        "Alt-ArrowLeft": () => moveWord(e, -1, false, mac),
        "Alt-ArrowRight": () => moveWord(e, 1, false, mac),
        "Alt-Shift-ArrowLeft": () => moveWord(e, -1, true, mac),
        "Alt-Shift-ArrowRight": () => moveWord(e, 1, true, mac),
        "Alt-ArrowUp": () => moveToParagraph(e, -1, false),
        "Alt-ArrowDown": () => moveToParagraph(e, 1, false),
        "Alt-Shift-ArrowUp": () => moveToParagraph(e, -1, true),
        "Alt-Shift-ArrowDown": () => moveToParagraph(e, 1, true),
      });
    } else {
      Object.assign(shortcuts, {
        "Ctrl-Backspace": () => backspace(e, "word"),
        "Ctrl-Delete": () => deleteForward(e, true, mac),
        "Alt-Shift-5": () => e.chain().toggleStrike().run(),
        "Ctrl-Shift-k": () => toggleSmallCaps(e),
        "Alt-Shift-k": () => toggleSmallCaps(e),
        "Ctrl-Space": () => e.commands.clearFormatting(),
        "Alt-Shift-ArrowUp": move(-1),
        "Alt-Shift-ArrowDown": move(1),
        // Word and paragraph moves by Docs' classes; Shift extends a word move.
        "Ctrl-ArrowLeft": () => moveWord(e, -1, false, mac),
        "Ctrl-ArrowRight": () => moveWord(e, 1, false, mac),
        "Ctrl-Shift-ArrowLeft": () => moveWord(e, -1, true, mac),
        "Ctrl-Shift-ArrowRight": () => moveWord(e, 1, true, mac),
        "Ctrl-ArrowUp": () => moveToParagraph(e, -1, false),
        "Ctrl-ArrowDown": () => moveToParagraph(e, 1, false),
      });
    }
    return shortcuts;
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    let pasting = false;
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
        transformPastedHTML: keepParagraphFormat,
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
          // A paste, a cut, or a drop is its own undo step.
          paste(view) {
            closeEdit(view);
            return false;
          },
          cut(view) {
            closeEdit(view);
            return false;
          },
          drop(view) {
            closeEdit(view);
            return false;
          },
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
          (tr) => (!tr.docChanged || tr.getMeta("addToHistory") === false) && !tr.selectionSet && !tr.storedMarksSet,
        );
        if (!bookkeeping || !oldState.selection.eq(newState.selection)) return null;
        return newState.tr
          .setStoredMarks(oldState.storedMarks)
          .setMeta("addToHistory", false)
          .setMeta(TYPING_RESTORE_META, true);
      },
      // Tiptap's own input rules never change the text (the typing area's
      // rules are Docs' rules), and a paste keeps its Markdown markers.
      filterTransaction(tr, state) {
        for (const p of state.plugins) {
          if ((p.spec as { isInputRules?: boolean }).isInputRules && tr.getMeta(p)) return false;
        }
        // The transactions a paste appends are filtered while the paste
        // applies, in the same task.
        const origin = tr.getMeta("uiEvent") as string | undefined;
        if (origin === "paste" || origin === "drop") {
          pasting = true;
          queueMicrotask(() => {
            pasting = false;
          });
          return true;
        }
        return !(pasting && isMarkdownPasteRule(tr));
      },
    });
    return [plugin, findPlugin(), tracePlugin(), repeatPlugin(), markStylePlugin()];
  },
});

/** Non-printing characters (Ctrl+Shift+P): ¶ at a paragraph's end, ↵ at a
    line break, → for a tab, · for a space. Hidden until asked for. */
const NonPrinting = InvisibleCharacters.configure({
  visible: false,
  injectCSS: false,
  builders: [
    new SpaceCharacter(),
    new InvisibleCharacter({ type: "tab", predicate: (ch) => ch === "\t" }),
    new ParagraphNode(),
    new HardBreakNode(),
  ],
});

export const typingExtensions: AnyExtension[] = [DocsTyping, NonPrinting];
