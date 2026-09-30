"use client";

import { useState, useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";
import { CloseIcon } from "@/components/docs/icons";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { serverTypingPrefs, subscribeTypingPrefs, typingPrefs } from "@/components/docs/typing/prefs";
import { addToDictionary, removeFromDictionary } from "@/components/docs/typing/spelling";
import "./dictionary.css";

// Tools > Spelling and grammar > Personal dictionary, Google Docs' dialog
// (SPEC.md §29, typing): the words the spelling check takes as spelled
// right in every document in this browser, A to Z, each with its remove
// button, and a field that adds one. A change holds at once.

/** One word: no spaces, as Add to dictionary takes it from the page. */
const oneWord = (text: string) => {
  const word = text.trim();
  return word && word.length <= 100 && !/\s/.test(word) ? word : null;
};

export function DictionaryDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const prefs = useSyncExternalStore(subscribeTypingPrefs, typingPrefs, serverTypingPrefs);
  const [draft, setDraft] = useState("");
  const words = [...prefs.dictionary].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const word = oneWord(draft);
  const add = () => {
    if (!word) return;
    addToDictionary(word);
    setDraft("");
  };

  return (
    <ToolbarDialog
      title={t("docsTyping.personalDictionary")}
      onClose={onClose}
      className="docs-dictionary"
      actions={
        <DialogButton primary onClick={onClose}>
          {t("docs.ok")}
        </DialogButton>
      }
    >
      <p className="docs-dictionary-hint">{t("docsTyping.dictionaryHint")}</p>
      <div className="docs-dictionary-entry">
        <input
          value={draft}
          placeholder={t("docsTyping.dictionaryWord")}
          aria-label={t("docsTyping.dictionaryWord")}
          data-track="docs:dictionary:word"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
          className="docs-tb-field"
          autoFocus
        />
        <button type="button" className="docs-tb-button" data-track="docs:dictionary:add" disabled={!word} onClick={add}>
          {t("common.add")}
        </button>
      </div>
      <ul className="docs-dictionary-list">
        {words.length === 0 && <li className="docs-dictionary-empty">{t("docsTyping.dictionaryEmpty")}</li>}
        {words.map((w) => (
          <li key={w} className="docs-dictionary-row">
            <span>{w}</span>
            <button
              type="button"
              className="docs-icon-btn"
              data-track="docs:dictionary:remove"
              aria-label={`${t("common.remove")}: ${w}`}
              data-tip={t("common.remove")}
              onClick={() => removeFromDictionary(w)}
            >
              <CloseIcon size={18} />
            </button>
          </li>
        ))}
      </ul>
    </ToolbarDialog>
  );
}
