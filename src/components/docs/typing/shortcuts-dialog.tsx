"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { SearchIcon } from "@/components/docs/icons";
import { isMac, keys } from "@/components/docs/keys";
import { ToolbarDialog } from "@/components/docs/toolbar/dialog";
import type { TKey } from "@/lib/i18n/dictionaries";

// Ctrl+/: the keyboard shortcuts the page editor answers (SPEC.md §29,
// typing), grouped the way Google Docs groups them, with a search field.

type Row = { label: TKey; pc: string[]; mac?: string[] };

const SECTIONS: { title: TKey; rows: Row[] }[] = [
  {
    title: "docsTyping.scCommon",
    rows: [
      { label: "docsTyping.scCopy", pc: ["Mod+C"] },
      { label: "docsTyping.scCut", pc: ["Mod+X"] },
      { label: "docsTyping.scPaste", pc: ["Mod+V"] },
      { label: "docsTyping.scPastePlain", pc: ["Mod+Shift+V"] },
      { label: "docsTyping.scUndo", pc: ["Mod+Z"] },
      { label: "docsTyping.scRedo", pc: ["Mod+Shift+Z", "Mod+Y"] },
      { label: "docsTyping.scLink", pc: ["Mod+K"] },
      { label: "docsTyping.scOpenLink", pc: ["Alt+Enter"] },
      { label: "docsTyping.scShortcuts", pc: ["Mod+/"] },
      { label: "docsTyping.scFind", pc: ["Mod+F"] },
      { label: "docsTyping.scFindReplace", pc: ["Mod+H"], mac: ["Mod+Shift+H"] },
      { label: "docsTyping.scFindNext", pc: ["Mod+G", "F3"] },
      { label: "docsTyping.scFindPrevious", pc: ["Mod+Shift+G", "Shift+F3"] },
      { label: "docsTyping.scPageBreak", pc: ["Mod+Enter"] },
      { label: "docsTyping.scHideTitle", pc: ["Mod+Shift+F"] },
    ],
  },
  {
    title: "docsTyping.scText",
    rows: [
      { label: "docsTyping.scBold", pc: ["Mod+B"] },
      { label: "docsTyping.scItalic", pc: ["Mod+I"] },
      { label: "docsTyping.scUnderline", pc: ["Mod+U"] },
      { label: "docsTyping.scStrike", pc: ["Alt+Shift+5"], mac: ["Mod+Shift+X"] },
      { label: "docsTyping.scSuperscript", pc: ["Mod+."] },
      { label: "docsTyping.scSubscript", pc: ["Mod+,"] },
      { label: "docsTyping.scClearFormatting", pc: ["Mod+\\", "Ctrl+Space"], mac: ["Mod+\\"] },
      { label: "docsTyping.scBigger", pc: ["Mod+Shift+."] },
      { label: "docsTyping.scSmaller", pc: ["Mod+Shift+,"] },
      { label: "docsTyping.scSmallCaps", pc: ["Ctrl+Shift+K"], mac: ["Alt+Shift+K"] },
      { label: "docsTyping.scCopyFormatting", pc: ["Mod+Alt+C"] },
      { label: "docsTyping.scPasteFormatting", pc: ["Mod+Alt+V"] },
    ],
  },
  {
    title: "docsTyping.scParagraph",
    rows: [
      { label: "docsTyping.scIndentMore", pc: ["Mod+]"] },
      { label: "docsTyping.scIndentLess", pc: ["Mod+["] },
      { label: "docsTyping.scNormalText", pc: ["Mod+Alt+0"] },
      { label: "docsTyping.scHeading", pc: ["Mod+Alt+[1-6]"] },
      { label: "docsTyping.scAlignLeft", pc: ["Mod+Shift+L"] },
      { label: "docsTyping.scAlignCenter", pc: ["Mod+Shift+E"] },
      { label: "docsTyping.scAlignRight", pc: ["Mod+Shift+R"] },
      { label: "docsTyping.scJustify", pc: ["Mod+Shift+J"] },
      { label: "docsTyping.scNumbered", pc: ["Mod+Shift+7"] },
      { label: "docsTyping.scBulleted", pc: ["Mod+Shift+8"] },
      { label: "docsTyping.scChecklist", pc: ["Mod+Shift+9"] },
      { label: "docsTyping.scMoveUp", pc: ["Ctrl+Shift+↑", "Alt+Shift+↑"], mac: ["Ctrl+Shift+↑"] },
      { label: "docsTyping.scMoveDown", pc: ["Ctrl+Shift+↓", "Alt+Shift+↓"], mac: ["Ctrl+Shift+↓"] },
    ],
  },
  {
    title: "docsTyping.scEditing",
    rows: [
      { label: "docsTyping.scLineBreak", pc: ["Shift+Enter"] },
      { label: "docsTyping.scDeleteWord", pc: ["Ctrl+Backspace"], mac: ["Alt+Backspace"] },
      { label: "docsTyping.scSelectAll", pc: ["Mod+A"] },
    ],
  },
  {
    title: "docsTyping.scTools",
    rows: [
      { label: "docsTyping.scWordCount", pc: ["Mod+Shift+C"] },
      { label: "docsTyping.scComment", pc: ["Mod+Alt+M"] },
      { label: "docsTyping.scFootnote", pc: ["Mod+Alt+F"] },
      { label: "docsTyping.spellingCheck", pc: ["Mod+Alt+X", "F7"] },
      { label: "docsTyping.scVoice", pc: ["Mod+Shift+S"] },
      { label: "docsTyping.scToggleCheckbox", pc: ["Mod+Alt+Enter"] },
      { label: "docsTyping.scNonPrinting", pc: ["Mod+Shift+P"] },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const mac = isMac();
  const q = query.trim().toLowerCase();
  const sections = SECTIONS.map((s) => ({
    title: s.title,
    rows: s.rows.filter((r) => !q || t(r.label).toLowerCase().includes(q)),
  })).filter((s) => s.rows.length > 0);
  return (
    <ToolbarDialog title={t("docsTyping.keyboardShortcuts")} onClose={onClose} className="docs-shortcuts">
      <label className="docs-shortcuts-search">
        <SearchIcon size={20} />
        <input
          value={query}
          placeholder={t("docsTyping.searchShortcuts")}
          aria-label={t("docsTyping.searchShortcuts")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="docs-shortcuts-body">
        {sections.length === 0 && <p className="docs-shortcuts-empty">{t("docsTyping.noShortcuts")}</p>}
        {sections.map((s) => (
          <section key={s.title}>
            <h3>{t(s.title)}</h3>
            <table>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.label}>
                    <td>{t(r.label)}</td>
                    <td>
                      {(mac && r.mac ? r.mac : r.pc).map((combo, i) => (
                        <span key={combo}>
                          {i > 0 && " / "}
                          <kbd>{keys(combo)}</kbd>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </ToolbarDialog>
  );
}
