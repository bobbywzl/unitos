"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { CheckIcon, EditIcon, SuggestIcon, ViewIcon } from "@/components/docs/icons";
import { keys } from "@/components/docs/keys";
import { DropdownPanel, keepFocus, MenuItem } from "@/components/docs/menu";
import type { TKey } from "@/lib/i18n/dictionaries";

// The mode switcher (SPEC.md §29): the pill at the toolbar's right end and
// Google Docs' menu of modes. toolbar.tsx binds the modes' keys.

export type DocsMode = "editing" | "suggesting" | "viewing";

/** Why Editing and Suggesting are off for the open document, or null: an
    import another account's project holds too (SPEC.md §29). The menu
    shows the two modes off and says why. */
export const ModeLock = createContext<TKey | null>(null);

type ModeItem = {
  mode: DocsMode;
  icon: ReactNode;
  label: TKey;
  hint: TKey;
  tip: TKey;
  combo: string;
};

const MODES: ModeItem[] = [
  {
    mode: "editing",
    icon: <EditIcon size={20} />,
    label: "docs.modeEditing",
    hint: "docs.modeEditingHint",
    tip: "docs.editingMode",
    combo: "Mod+Alt+Shift+Z",
  },
  {
    mode: "suggesting",
    icon: <SuggestIcon size={20} />,
    label: "docs.modeSuggesting",
    hint: "docs.modeSuggestingHint",
    tip: "docsSuggest.suggestingMode",
    combo: "Mod+Alt+Shift+X",
  },
  {
    mode: "viewing",
    icon: <ViewIcon size={20} />,
    label: "docs.modeViewing",
    hint: "docs.modeViewingHint",
    tip: "docs.viewingMode",
    combo: "Mod+Alt+Shift+C",
  },
];

export function ModeSwitcher({ mode, onMode }: { mode: DocsMode; onMode: (mode: DocsMode) => void }) {
  const t = useT();
  const lock = useContext(ModeLock);
  const [open, setOpen] = useState(false);
  const [fromKeys, setFromKeys] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = MODES.find((m) => m.mode === mode) ?? MODES[0];
  const tip = t(current.tip);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={tip}
        data-tip={open ? undefined : tip}
        aria-haspopup="menu"
        aria-expanded={open}
        data-track="docs:mode"
        data-mode={mode}
        data-tb-item
        onMouseDown={keepFocus}
        onClick={() => {
          setFromKeys(false);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setFromKeys(true);
            setOpen(true);
          }
        }}
        className="docs-mode-pill"
      >
        {current.icon}
        <span className="docs-mode-caption">
          <span className="docs-mode-caption-text">{t(current.label)}</span>
          <span className="docs-mode-triangle" aria-hidden />
        </span>
      </button>
      <DropdownPanel
        open={open}
        anchorRef={ref}
        onClose={() => setOpen(false)}
        placement="below-right"
        className="docs-menu-modes"
        label={tip}
        highlightFirst={fromKeys}
      >
        {MODES.map((m) => (
          <MenuItem
            key={m.mode}
            checked={m.mode === mode}
            disabled={lock !== null && m.mode !== "viewing"}
            label={t(m.label)}
            tip={keys(m.combo)}
            onSelect={() => {
              setOpen(false);
              onMode(m.mode);
            }}
            track={`docs:mode:${m.mode}`}
          >
            <span className="docs-mode-icon" aria-hidden>
              {m.icon}
            </span>
            <span className="docs-mode-label">{t(m.label)}</span>
            <span className="docs-mode-hint">{t(m.hint)}</span>
            {m.mode === mode && <CheckIcon size={24} className="docs-mode-current" />}
          </MenuItem>
        ))}
        {lock && (
          <p role="presentation" className="max-w-[268px] pt-1.5 pr-4 pb-1 pl-9 text-[12px] leading-[1.45] text-sand-600">
            {t(lock)}
          </p>
        )}
      </DropdownPanel>
    </>
  );
}
