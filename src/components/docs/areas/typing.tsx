"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands, type DocsCommand } from "@/components/docs/commands";
import { toast } from "@/components/docs/insert/context";
import { execClipboard, pasteFromClipboard } from "@/components/docs/insert/context-menu";
import { isMac } from "@/components/docs/keys";
import { AutocorrectBubble } from "@/components/docs/typing/autocorrect-bubble";
import { TYPING_EVENT, fireDocs } from "@/components/docs/typing/events";
import { findState, searchFrom, setFind, stepResult } from "@/components/docs/typing/find";
import { DOCKED_FIND_HEIGHT_PX, DOCKED_FIND_PX, FindBar, FindReplaceDialog, type FindMode } from "@/components/docs/typing/find-ui";
import { setCase, toggleSmallCaps, type TextCase } from "@/components/docs/typing/format";
import { listenNavigation, lookUpWord } from "@/components/docs/typing/navigate";
import { listenImageDrop, type DropState } from "@/components/docs/typing/drop";
import { copyMarkdown, pasteMarkdown, setImagePremium } from "@/components/docs/typing/paste";
import { DictionaryDialog } from "@/components/docs/typing/dictionary-dialog";
import { setTypingPrefs, subscribeTypingPrefs, typingPrefs } from "@/components/docs/typing/prefs";
import { PreferencesDialog } from "@/components/docs/typing/preferences-dialog";
import { setProofing } from "@/components/docs/typing/proofing";
import { ProofingLayer } from "@/components/docs/typing/proofing-layer";
import { acceptedWords, setAcceptedWords } from "@/components/docs/typing/spelling";
import { ShortcutsDialog } from "@/components/docs/typing/shortcuts-dialog";
import { VoiceTyping } from "@/components/docs/typing/voice-typing";
import type { TKey } from "@/lib/i18n/dictionaries";

// The typing area (SPEC.md §29): find and find and replace, Tools >
// Preferences, the keyboard shortcuts, voice typing, the spelling and
// grammar switches and their squiggles (typing/proofing.ts), the personal
// dictionary and the words ignored in the document (typing/spelling.ts),
// and images dropped anywhere on the page
// (typing/drop.ts); in Search the
// menus also Format > Text, View > Show non-printing characters, and Edit's
// clipboard items. Their keys answer when the page
// editor has the focus, or when nothing else does — never in the notes
// tray or any other text box. The word count (word-count.tsx) mounts
// beside this layer.

type Run = (editor: Editor) => void;
const editable = (editor: Editor) => editor.isEditable;
const selected = (editor: Editor) => !editor.state.selection.empty;

/** Format > Text: the selection's text formatting. */
const text = (id: string, label: TKey, keywords: string[], run: Run, shortcut?: string): DocsCommand => ({
  id: `typing:${id}`,
  label,
  menu: "format",
  keywords,
  shortcut,
  run,
  enabled: editable,
});

const capitalization = (mode: TextCase, label: TKey, keywords: string[]): DocsCommand => ({
  ...text(`case-${mode}`, label, keywords, (editor) => setCase(editor, mode)),
  enabled: (editor) => editable(editor) && selected(editor),
});

/** Edit: the right-click menu's clipboard items. */
const edit = (id: string, label: TKey, shortcut: string | undefined, run: Run, enabled?: (editor: Editor) => boolean): DocsCommand => ({
  id: `typing:${id}`,
  label,
  menu: "edit",
  shortcut,
  run,
  enabled,
});

registerDocsCommands([
  {
    id: "typing:find-replace",
    label: "docsTyping.findAndReplace",
    menu: "edit",
    keywords: ["find", "search", "locate", "replace", "查找", "替换"],
    shortcut: isMac() ? "Mod+Shift+H" : "Mod+H",
    run: (editor) => fireDocs(editor, TYPING_EVENT.findReplace),
  },
  {
    id: "typing:word-count",
    label: "docsTyping.wordCount",
    menu: "tools",
    keywords: ["count", "words", "characters", "show word count", "字数"],
    shortcut: "Mod+Shift+C",
    run: (editor) => fireDocs(editor, TYPING_EVENT.wordCount),
  },
  {
    id: "typing:preferences",
    label: "docsTyping.preferences",
    menu: "tools",
    keywords: ["settings", "options", "configurations", "autocorrect", "substitutions", "smart quotes", "markdown", "capitalize", "emoji", "偏好", "自动更正"],
    run: (editor) => fireDocs(editor, TYPING_EVENT.preferences),
  },
  {
    id: "typing:voice",
    label: "docsTyping.voiceTyping",
    menu: "tools",
    keywords: ["voice", "dictation", "speech", "speak", "start voice typing", "语音"],
    shortcut: "Mod+Shift+S",
    run: (editor) => fireDocs(editor, TYPING_EVENT.voice),
    enabled: editable,
  },
  {
    id: "typing:paste-markdown",
    label: "docsTyping.pasteFromMarkdown",
    menu: "edit",
    keywords: ["markdown", "paste"],
    run: (editor) => void pasteMarkdown(editor),
    enabled: (editor) => typingPrefs().markdown && editor.isEditable,
  },
  {
    id: "typing:copy-markdown",
    label: "docsTyping.copyAsMarkdown",
    menu: "edit",
    keywords: ["markdown", "copy"],
    run: (editor) => void copyMarkdown(editor),
    enabled: (editor) => typingPrefs().markdown && !editor.state.selection.empty,
  },
  {
    id: "typing:grammar",
    label: "docsTyping.showGrammar",
    menu: "tools",
    keywords: ["grammar", "spelling and grammar", "grammar check", "show grammar suggestions", "语法", "语法建议"],
    run: (editor) => fireDocs(editor, TYPING_EVENT.grammar),
  },
  {
    id: "typing:personal-dictionary",
    label: "docsTyping.personalDictionary",
    menu: "tools",
    keywords: ["personal dictionary", "add to dictionary", "spelling", "custom words", "个人词典", "拼写"],
    run: (editor) => fireDocs(editor, TYPING_EVENT.personalDictionary),
  },
  {
    id: "typing:shortcuts",
    label: "docsTyping.keyboardShortcuts",
    menu: "tools",
    keywords: ["keyboard", "shortcuts", "keys", "hotkeys", "快捷键"],
    shortcut: "Mod+/",
    run: (editor) => fireDocs(editor, TYPING_EVENT.shortcuts),
  },
  {
    id: "typing:dictionary",
    label: "docsTyping.dictionary",
    menu: "tools",
    keywords: ["define", "definition", "look up", "meaning", "词典", "释义"],
    shortcut: "Mod+Shift+Y",
    run: lookUpWord,
  },
  text("strikethrough", "docsTyping.scStrike", ["strike-through"], (editor) => editor.chain().focus().toggleStrike().run(), isMac() ? "Mod+Shift+X" : "Alt+Shift+5"),
  text("superscript", "docsTyping.scSuperscript", ["super script", "super-script", "exponent", "apply superscript"], (editor) => editor.chain().focus().toggleSuperscript().run(), "Mod+."),
  text("subscript", "docsTyping.scSubscript", ["sub script", "sub-script", "apply subscript"], (editor) => editor.chain().focus().toggleSubscript().run(), "Mod+,"),
  text("small-caps", "docsTyping.scSmallCaps", [], toggleSmallCaps, isMac() ? "Alt+Shift+K" : "Ctrl+Shift+K"),
  capitalization("lower", "docsTyping.caseLower", []),
  capitalization("upper", "docsTyping.caseUpper", ["all caps"]),
  capitalization("title", "docsTyping.caseTitle", ["capitalize"]),
  {
    id: "typing:non-printing",
    label: "docsTyping.scNonPrinting",
    menu: "view",
    keywords: ["show formatting marks", "display hidden characters", "toggle formatting markup", "hide invisible characters"],
    shortcut: "Mod+Shift+P",
    run: (editor) => editor.commands.toggleInvisibleCharacters(),
  },
  edit("cut", "docsInsert.cut", "Mod+X", (editor) => execClipboard(editor, "cut"), (editor) => editable(editor) && selected(editor)),
  edit("copy", "docsInsert.copy", "Mod+C", (editor) => execClipboard(editor, "copy"), selected),
  edit("paste", "docsInsert.paste", "Mod+V", (editor) => void pasteFromClipboard(editor, false), editable),
  edit("paste-plain", "docsInsert.pastePlain", "Mod+Shift+V", (editor) => void pasteFromClipboard(editor, true), editable),
  edit("select-all", "docsTyping.scSelectAll", "Mod+A", (editor) => editor.chain().focus().selectAll().run()),
  edit("delete", "common.delete", undefined, (editor) => editor.chain().focus().deleteSelection().run(), (editor) => editable(editor) && selected(editor)),
]);

function isTextEntry(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
}

/** Whether a key belongs to the page editor: its text has the focus, one of
    the typing windows does, a control of the page editor does, or nothing
    does. A text box anywhere else keeps its keys. */
function docsActive(editor: Editor): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return true;
  if (editor.view.dom.contains(active)) return true;
  if (active.closest("[data-docs-typing]")) return true;
  const shell = editor.view.dom.closest("[data-docs-editor]");
  if (shell?.contains(active)) return !isTextEntry(active);
  return false;
}

export function TypingLayer({ editor, documentId, canEdit, projectEditor, editing }: DocsAreaProps) {
  const t = useT();
  const { premium } = useCollab();
  const [findMode, setFindMode] = useState<FindMode>(null);
  // A phone, upright or sideways: Find and replace is the find bar docked
  // under the toolbar.
  const [phoneFind, setPhoneFind] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${DOCKED_FIND_PX - 1}px), (max-height: ${DOCKED_FIND_HEIGHT_PX - 1}px)`);
    const read = () => setPhoneFind(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  // Images dropped on the page, and the images' tier rule (typing/paste.ts).
  const dropState = useRef<DropState>({ canEdit, projectEditor, editing, t });
  useEffect(() => {
    dropState.current = { canEdit, projectEditor, editing, t };
    setImagePremium(editor, premium);
  });
  useEffect(() => listenImageDrop(editor, () => dropState.current), [editor]);
  const [focusToken, setFocusToken] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);

  // The reader's own words, the personal dictionary's and this document's
  // ignored ones: the page's spelling check passes them (typing/spelling.ts).
  useEffect(() => {
    const send = () => setAcceptedWords(editor, acceptedWords(documentId));
    send();
    return subscribeTypingPrefs(send);
  }, [editor, documentId]);

  // The squiggles: in Editing and Suggesting, as the preferences say; the
  // grammar check on Unitos Premium and Ultra.
  useEffect(() => {
    const send = () => {
      const prefs = typingPrefs();
      setProofing(editor, { spelling: editing && prefs.showSpelling, grammar: editing && premium && prefs.showGrammar });
    };
    send();
    return subscribeTypingPrefs(send);
  }, [editor, editing, premium]);

  // Google Docs' navigation keys: the chords, the misspellings, Dictionary.
  // A layout effect: the chords' listener is the window's first, so the key
  // after a chord's first key never reaches the modes' keys (toolbar.tsx) or
  // the zoom keys (areas/page.tsx).
  useLayoutEffect(() => listenNavigation(editor, () => docsActive(editor)), [editor]);

  useEffect(() => {
    const view = editor.view;
    /** Open the bar or the dialog with the selected words as the query, else the last one. */
    const openFind = (mode: "bar" | "dialog") => {
      const { state } = view;
      const { from, to, empty } = state.selection;
      const selected = empty ? "" : state.doc.textBetween(from, to, "\n").split("\n")[0].slice(0, 200);
      searchFrom(view, { open: true, query: selected || findState(state).query });
      setFindMode(mode);
      setFocusToken((n) => n + 1);
    };
    // Show spelling suggestions and Show grammar suggestions: the red and
    // the blue squiggles on or off, kept in this browser.
    const toggleSpelling = () => {
      const on = !typingPrefs().showSpelling;
      setTypingPrefs({ showSpelling: on });
      toast(t(on ? "docsTyping.spellingOn" : "docsTyping.spellingOff"), editor);
    };
    const toggleGrammar = () => {
      const on = !typingPrefs().showGrammar;
      setTypingPrefs({ showGrammar: on });
      toast(t(on ? "docsTyping.grammarOn" : "docsTyping.grammarOff"), editor);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !docsActive(editor)) return;
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const code = e.code;
      let handled = true;
      if (mod && !e.altKey && !e.shiftKey && key === "f") openFind("bar");
      else if (mod && !e.altKey && ((isMac() && e.shiftKey && key === "h") || (!isMac() && !e.shiftKey && key === "h"))) openFind("dialog");
      else if ((mod && !e.altKey && key === "g") || (e.key === "F3" && !mod && !e.altKey)) {
        if (!findState(view.state).open) openFind("bar");
        else stepResult(view, e.shiftKey ? -1 : 1);
      } else if (mod && !e.altKey && !e.shiftKey && (key === "/" || code === "Slash")) setShortcutsOpen(true);
      // The key and the toolbar's microphone both toggle: open and
      // listening, or closed (typing/voice-typing.tsx).
      else if (mod && e.shiftKey && !e.altKey && code === "KeyS") setVoiceOpen((o) => !o);
      // The word count in Viewing too, where the page takes no focus.
      else if (mod && e.shiftKey && !e.altKey && code === "KeyC") fireDocs(editor, TYPING_EVENT.wordCount);
      else if ((mod && e.altKey && !e.shiftKey && code === "KeyX") || (e.key === "F7" && !mod && !e.altKey)) toggleSpelling();
      else if (mod && !e.altKey && !e.shiftKey && key === "s") {
        // Every change saves by itself; the browser's Save page never opens.
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const events: [string, () => void][] = [
      [TYPING_EVENT.findReplace, () => openFind("dialog")],
      [TYPING_EVENT.preferences, () => setPrefsOpen(true)],
      [TYPING_EVENT.shortcuts, () => setShortcutsOpen(true)],
      [TYPING_EVENT.voice, () => setVoiceOpen((o) => !o)],
      [TYPING_EVENT.spelling, toggleSpelling],
      [TYPING_EVENT.grammar, toggleGrammar],
      [TYPING_EVENT.personalDictionary, () => setDictionaryOpen(true)],
    ];
    window.addEventListener("keydown", onKey);
    for (const [name, on] of events) view.dom.addEventListener(name, on);
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const [name, on] of events) view.dom.removeEventListener(name, on);
    };
  }, [editor, t]);

  const closeFind = () => {
    setFindMode(null);
    setFind(editor.view, { open: false });
    // The current result stays selected.
    editor.view.focus();
  };

  return (
    <>
      <FindBar
        editor={editor}
        open={findMode === "bar" || (phoneFind && findMode === "dialog")}
        focusToken={focusToken}
        onClose={closeFind}
        onMore={() => setFindMode("dialog")}
        docked={phoneFind}
        replacing={findMode === "dialog"}
      />
      <FindReplaceDialog editor={editor} open={!phoneFind && findMode === "dialog"} focusToken={focusToken} onClose={closeFind} />
      {prefsOpen && (
        <PreferencesDialog
          onClose={() => {
            setPrefsOpen(false);
            editor.commands.focus();
          }}
        />
      )}
      {dictionaryOpen && (
        <DictionaryDialog
          onClose={() => {
            setDictionaryOpen(false);
            editor.commands.focus();
          }}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsDialog
          onClose={() => {
            setShortcutsOpen(false);
            editor.commands.focus();
          }}
        />
      )}
      <VoiceTyping editor={editor} open={voiceOpen} onClose={() => setVoiceOpen(false)} />
      <AutocorrectBubble editor={editor} />
      <ProofingLayer editor={editor} documentId={documentId} />
    </>
  );
}
