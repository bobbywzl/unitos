"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/components/lang-provider";
import { translatorFor } from "@/lib/i18n/dictionaries";
import { CloseIcon, SearchIcon } from "@/components/docs/icons";
import { onInsert } from "@/components/docs/insert/context";
import { CHAR_CATEGORIES, charName, codepoint, groupChars, searchChars } from "@/components/docs/insert/special-chars-data";
import { keepSelection } from "@/components/docs/insert/ui";

// Insert special characters (SPEC.md §29), Google Docs' dialog: two menus
// (a category, then its group), the group's characters ten a row, and a
// search by keyword or code point. A press inserts the character at the
// caret; the dialog stays open for the next one, and the page stays
// usable behind it.

export function SpecialCharsHost({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  useEffect(() => onInsert(editor, (e) => e.type === "special-characters" && setOpen(true)), [editor]);
  if (!open) return null;
  return (
    <SpecialCharsDialog
      editor={editor}
      onClose={() => {
        setOpen(false);
        editor.view.focus();
      }}
    />
  );
}

function SpecialCharsDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const [category, setCategory] = useState(CHAR_CATEGORIES[0]);
  const [group, setGroup] = useState(CHAR_CATEGORIES[0].groups[0]);
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const chars = useMemo(() => (query.trim() ? searchChars(query, (g) => translatorFor(lang)(g.name)) : groupChars(group)), [query, group, lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="docs-tb-dialog docs-chars-dialog"
      role="dialog"
      aria-label={t("docsInsert.insertSpecialCharacters")}
      data-docs-insert-popover
      data-edit-control
      data-selection-popover
      onMouseDown={keepSelection}
    >
      <div className="docs-tb-dialog-head">
        <h2>{t("docsInsert.insertSpecialCharacters")}</h2>
        <button type="button" className="docs-tb-dialog-close" aria-label={t("docs.close")} data-tip={t("docs.close")} onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <div className="docs-chars-body">
        <div>
          <div className="docs-chars-menus">
            <select
              className="docs-field"
              value={category.id}
              aria-label={t("docsInsert.charSymbol")}
              disabled={Boolean(query.trim())}
              onChange={(e) => {
                const next = CHAR_CATEGORIES.find((c) => c.id === e.target.value) ?? CHAR_CATEGORIES[0];
                setCategory(next);
                setGroup(next.groups[0]);
              }}
            >
              {CHAR_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(c.label)}
                </option>
              ))}
            </select>
            <select
              className="docs-field"
              value={group.id}
              aria-label={t(group.name)}
              disabled={Boolean(query.trim())}
              onChange={(e) => setGroup(category.groups.find((g) => g.id === e.target.value) ?? category.groups[0])}
            >
              {category.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {t(g.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="docs-chars-grid" role="grid" onMouseLeave={() => setHover(null)}>
            {chars.length === 0 && <div className="docs-chars-empty">{t("docsInsert.noCharacters")}</div>}
            {chars.map((ch) => (
              <button
                key={ch}
                type="button"
                aria-label={`${charName(ch) || ch} ${codepoint(ch)}`}
                onMouseEnter={() => setHover(ch)}
                onClick={() => editor.commands.insertContent(ch)}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
        <div className="docs-chars-right">
          <label className="docs-chars-search">
            <SearchIcon size={18} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("docsInsert.specialSearch")}
              aria-label={t("docsInsert.specialSearch")}
              autoFocus
            />
          </label>
          <div className="docs-chars-preview" aria-live="polite">
            {hover && (
              <>
                <span className="docs-chars-big">{hover}</span>
                <span>{charName(hover)}</span>
                <span className="docs-chars-code">{codepoint(hover)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
