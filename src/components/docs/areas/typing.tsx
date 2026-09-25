"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands } from "@/components/docs/commands";
import { toast } from "@/components/docs/insert/context";
import { isMac } from "@/components/docs/keys";
import { AutocorrectBubble } from "@/components/docs/typing/autocorrect-bubble";
import { TYPING_EVENT, fireTyping } from "@/components/docs/typing/events";
import { findState, searchFrom, setFind, stepResult } from "@/components/docs/typing/find";
import { FindBar, FindReplaceDialog, type FindMode } from "@/components/docs/typing/find-ui";
import { copyMarkdown, pasteMarkdown } from "@/components/docs/typing/paste";
import { typingPrefs } from "@/components/docs/typing/prefs";
import { PreferencesDialog } from "@/components/docs/typing/preferences-dialog";
import { ShortcutsDialog } from "@/components/docs/typing/shortcuts-dialog";
import { VoiceTyping } from "@/components/docs/typing/voice-typing";

// The typing area (SPEC.md §29): find and find and replace, Tools >
// Preferences, the keyboard shortcuts, voice typing, and the spelling
// switch. Their keys answer when the page editor has the focus, or when
// nothing else does — never in the notes tray or any other text box. The
// word count (word-count.tsx) mounts beside this layer.

registerDocsCommands([
  {
    id: "typing:find-replace",
    label: "docsTyping.findAndReplace",
    menu: "edit",
    keywords: ["find", "search", "replace", "查找", "替换"],
    shortcut: isMac() ? "Mod+Shift+H" : "Mod+H",
    run: () => fireTyping(TYPING_EVENT.findReplace),
  },
  {
    id: "typing:word-count",
    label: "docsTyping.wordCount",
    menu: "tools",
    keywords: ["count", "words", "characters", "字数"],
    shortcut: "Mod+Shift+C",
    run: () => fireTyping(TYPING_EVENT.wordCount),
  },
  {
    id: "typing:preferences",
    label: "docsTyping.preferences",
    menu: "tools",
    keywords: ["autocorrect", "substitutions", "smart quotes", "markdown", "capitalize", "emoji", "偏好", "自动更正"],
    run: () => fireTyping(TYPING_EVENT.preferences),
  },
  {
    id: "typing:voice",
    label: "docsTyping.voiceTyping",
    menu: "tools",
    keywords: ["voice", "dictation", "microphone", "语音"],
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
    keywords: ["keyboard", "shortcuts", "keys", "快捷键"],
    shortcut: "Mod+/",
    run: () => fireTyping(TYPING_EVENT.shortcuts),
  },
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
