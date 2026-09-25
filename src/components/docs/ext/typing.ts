import { Extension, type AnyExtension } from "@tiptap/core";
import {
  HardBreakNode,
  InvisibleCharacter,
  InvisibleCharacters,
  ParagraphNode,
  SpaceCharacter,
} from "@tiptap/extension-invisible-characters";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { insertContext } from "@/components/docs/insert/context";
import { isMac } from "@/components/docs/keys";
import { blockText, runAutocorrect } from "@/components/docs/typing/autocorrect";
import { wordAt } from "@/components/docs/typing/chars";
import { findPlugin } from "@/components/docs/typing/find";
import { TYPING_EVENT, fireTyping } from "@/components/docs/typing/events";
import { copyFormatting, pasteFormatting, toggleCheckbox, toggleSmallCaps } from "@/components/docs/typing/format";
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
import { replaceWithChip, urlChipPlugin } from "@/components/docs/typing/url-chip";

// The page editor's typing (SPEC.md §29): Google Docs' keys, autocorrect,
// paste, and find. It runs first (priority 1001), so its keys win over
// Tiptap's. The editor runs no Tiptap input rule and only Link's paste rule
// (docs-editor.tsx): Docs' own autocorrect formats what is typed.

const typingKey = new PluginKey("docsTyping");

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

const DocsTyping = Extension.create({
  name: "docsTyping",
  priority: 1001,

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
      Tab: () => replaceWithChip(e) || tab(e, false),
      "Shift-Tab": () => tab(e, true),
      // Normal text: Tiptap's paragraph binds the same keys first otherwise.
      "Mod-Alt-0": () => e.commands.setDocStyle("normal"),
      // Clear formatting: the toolbar's command, the same as its button.
      "Mod-\\": () => e.commands.clearFormatting(),
      "Ctrl-Shift-ArrowUp": move(-1),
      "Ctrl-Shift-ArrowDown": move(1),
      "Mod-Alt-Enter": () => toggleCheckbox(e),
      // Pageless documents have no page breaks.
      "Mod-Enter": () => Boolean(insertContext(e)?.pageSetup.pageless),
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
      // With Caps Lock on, Ctrl+Shift+E reads as Ctrl+E.
      "Mod-Shift-e": () => e.commands.setTextAlign("center"),
    };
    if (mac) {
      Object.assign(shortcuts, {
        "Alt-Backspace": () => backspace(e, "word"),
        "Mod-Backspace": () => backspace(e, "line"),
        "Alt-Delete": () => deleteForward(e, true, mac),
        "Mod-Shift-x": () => e.chain().toggleStrike().run(),
        "Alt-Shift-k": () => toggleSmallCaps(e),
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
    const plugin = new Plugin({
      key: typingKey,
      props: {
        // Typed text goes in as one undo step with the typing around it;
        // then the autocorrect rules for the character run, each its own step.
        handleTextInput(view, _from, _to, text, deflt) {
          if (view.composing) return false;
          view.dispatch(groupEdit(view, deflt(), "insert"));
          if ([...text].length === 1) runAutocorrect(view, text);
          return true;
        },
        transformPastedHTML: keepParagraphFormat,
        clipboardTextParser(text, $context, _plain, view) {
          return plainTextSlice(view.state.schema, text, $context, view.state.storedMarks ?? $context.marks());
        },
        handlePaste(view, event) {
          notePaste();
          // An image alone on the clipboard uploads; words copied with a
          // picture of them paste as words.
          const images = imageFiles(event.clipboardData?.files);
          const html = event.clipboardData?.getData("text/html") ?? "";
          if (!images.length || html.replace(/<[^>]*>|&nbsp;/g, "").trim() || !view.editable) return false;
          void insertImageFiles(editor, images);
          return true;
        },
        handleDrop(view, event, _slice, moved) {
          const images = imageFiles(event.dataTransfer?.files);
          if (moved || !images.length || !view.editable) return false;
          event.preventDefault();
          void insertImageFiles(editor, images, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
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
      // The pending style survives the bookkeeping other plugins append
      // (a new paragraph's block id).
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
    });
    return [plugin, findPlugin(), tracePlugin(), repeatPlugin(), markStylePlugin(), urlChipPlugin(editor)];
  },
});

/** Non-printing characters (Ctrl+Shift+P): ¶ at a paragraph's end, ↵ at a
    line break, → for a tab, · for a space. Hidden until asked for. */
const NonPrinting = InvisibleCharacters.configure({
  visible: false,
  builders: [
    new SpaceCharacter(),
    new InvisibleCharacter({ type: "tab", predicate: (ch) => ch === "\t" }),
    new ParagraphNode(),
    new HardBreakNode(),
  ],
});

export const typingExtensions: AnyExtension[] = [DocsTyping, NonPrinting];
