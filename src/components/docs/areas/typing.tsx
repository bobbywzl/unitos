"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands, type DocsCommand } from "@/components/docs/commands";
import { toast } from "@/components/docs/insert/context";
import { execClipboard, pasteFromClipboard } from "@/components/docs/insert/context-menu";
import { isMac } from "@/components/docs/keys";
import { AutocorrectBubble } from "@/components/docs/typing/autocorrect-bubble";
import { TYPING_EVENT, fireTyping } from "@/components/docs/typing/events";
import { findState, searchFrom, setFind, stepResult } from "@/components/docs/typing/find";
import { FindBar, FindReplaceDialog, type FindMode } from "@/components/docs/typing/find-ui";
import { setCase, toggleSmallCaps, type TextCase } from "@/components/docs/typing/format";
import { listenNavigation, lookUpWord } from "@/components/docs/typing/navigate";
import { copyMarkdown, pasteMarkdown } from "@/components/docs/typing/paste";
import { typingPrefs } from "@/components/docs/typing/prefs";
import { PreferencesDialog } from "@/components/docs/typing/preferences-dialog";
import { ShortcutsDialog } from "@/components/docs/typing/shortcuts-dialog";
import { VoiceTyping } from "@/components/docs/typing/voice-typing";
import type { TKey } from "@/lib/i18n/dictionaries";

// The typing area (SPEC.md §29): find and find and replace, Tools >
// Preferences, the keyboard shortcuts, voice typing, and the spelling
// switch; in Search the menus also Format > Text, View > Show non-printing
// characters, and Edit's clipboard items. Their keys answer when the page
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
    run: () => fireTyping(TYPING_EVENT.findReplace),
  },
  {
    id: "typing:word-count",
    label: "docsTyping.wordCount",
    menu: "tools",
    keywords: ["count", "words", "characters", "show word count", "字数"],
    shortcut: "Mod+Shift+C",
    run: () => fireTyping(TYPING_EVENT.wordCount),
  },
  {
    id: "typing:preferences",
    label: "docsTyping.preferences",
    menu: "tools",
    keywords: ["settings", "options", "configurations", "autocorrect", "substitutions", "smart quotes", "markdown", "capitalize", "emoji", "偏好", "自动更正"],
    run: () => fireTyping(TYPING_EVENT.preferences),
  },
  {
    id: "typing:voice",
    label: "docsTyping.voiceTyping",
    menu: "tools",
    keywords: ["voice", "dictation", "speech", "speak", "start voice typing", "语音"],
    shortcut: "Mod+Shift+S",
    run: () => fireTyping(TYPING_EVENT.voice),
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
    id: "typing:shortcuts",
    label: "docsTyping.keyboardShortcuts",
    menu: "tools",
    keywords: ["keyboard", "shortcuts", "keys", "hotkeys", "快捷键"],
    shortcut: "Mod+/",
    run: () => fireTyping(TYPING_EVENT.shortcuts),
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

export function TypingLayer({ editor }: DocsAreaProps) {
  const t = useT();
  const [findMode, setFindMode] = useState<FindMode>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  // Google Docs' navigation keys: the chords, the misspellings, Dictionary.
  useEffect(() => listenNavigation(editor, () => docsActive(editor)), [editor]);

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
    // Spelling and grammar check: the browser's underlines on or off.
    const toggleSpelling = () => {
      view.dom.spellcheck = !view.dom.spellcheck;
      toast(t(view.dom.spellcheck ? "docsTyping.spellingOn" : "docsTyping.spellingOff"));
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
      else if (mod && e.shiftKey && !e.altKey && code === "KeyS") setVoiceOpen(true);
      else if ((mod && e.altKey && !e.shiftKey && code === "KeyX") || (e.key === "F7" && !mod && !e.altKey)) toggleSpelling();
      else if (mod && !e.altKey && !e.shiftKey && key === "s") {
        // Every change saves by itself; the browser's Save page never opens.
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onFindReplace = () => openFind("dialog");
    const onPrefs = () => setPrefsOpen(true);
    const onShortcuts = () => setShortcutsOpen(true);
    const onVoice = () => setVoiceOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(TYPING_EVENT.findReplace, onFindReplace);
    window.addEventListener(TYPING_EVENT.preferences, onPrefs);
    window.addEventListener(TYPING_EVENT.shortcuts, onShortcuts);
    window.addEventListener(TYPING_EVENT.voice, onVoice);
    window.addEventListener(TYPING_EVENT.spelling, toggleSpelling);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(TYPING_EVENT.findReplace, onFindReplace);
      window.removeEventListener(TYPING_EVENT.preferences, onPrefs);
      window.removeEventListener(TYPING_EVENT.shortcuts, onShortcuts);
      window.removeEventListener(TYPING_EVENT.voice, onVoice);
      window.removeEventListener(TYPING_EVENT.spelling, toggleSpelling);
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
        open={findMode === "bar"}
        focusToken={focusToken}
        onClose={closeFind}
        onMore={() => setFindMode("dialog")}
      />
      <FindReplaceDialog editor={editor} open={findMode === "dialog"} onClose={closeFind} />
      {prefsOpen && (
        <PreferencesDialog
          onClose={() => {
            setPrefsOpen(false);
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
    </>
  );
}
