"use client";

import { useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { CheckIcon, EditIcon, SuggestIcon, ViewIcon } from "@/components/docs/icons";
import { keys } from "@/components/docs/keys";
import { DropdownPanel, keepFocus, MenuItem } from "@/components/docs/menu";
import type { TKey } from "@/lib/i18n/dictionaries";

// The mode switcher (SPEC.md §29): a pill with the mode's symbol and name
// at the toolbar's right end, and Google Docs' menu of modes — Editing,
// Suggesting, Viewing — each with its line. Suggesting is not built yet: it
// shows, greyed, as coming later. Ctrl+Alt+Shift+Z switches to Editing,
// Ctrl+Alt+Shift+C and D to Viewing (toolbar.tsx binds them).

export type DocsMode = "editing" | "viewing";

type ModeItem = {
  mode: DocsMode | "suggesting";
  icon: ReactNode;
  label: TKey;
  hint: TKey;
  combo: string;
};

const MODES: ModeItem[] = [
  { mode: "editing", icon: <EditIcon size={20} />, label: "docs.modeEditing", hint: "docs.modeEditingHint", combo: "Mod+Alt+Shift+Z" },
  {
    mode: "suggesting",
    icon: <SuggestIcon size={20} />,
    label: "docs.modeSuggesting",
    hint: "docs.modeSuggestingHint",
    combo: "Mod+Alt+Shift+X",
  },
  { mode: "viewing", icon: <ViewIcon size={20} />, label: "docs.modeViewing", hint: "docs.modeViewingHint", combo: "Mod+Alt+Shift+C" },
];

export function ModeSwitcher({
  mode,
  onMode,
  folded,
}: {
  mode: DocsMode;
  onMode: (mode: DocsMode) => void;
  /** The bar runs short: only the symbol and the triangle show. */
  folded: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [fromKeys, setFromKeys] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = MODES.find((m) => m.mode === mode) ?? MODES[0];
  const tip = t(mode === "editing" ? "docs.editingMode" : "docs.viewingMode");
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={tip}
        data-tip={open ? undefined : tip}
        aria-haspopup="menu"
        aria-expanded={open}
        data-folded={folded ? "" : undefined}
        data-track="docs:mode"
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
            role="menuitemradio"
            checked={m.mode === mode}
            disabled={m.mode === "suggesting"}
            label={t(m.label)}
            tip={keys(m.combo)}
            onSelect={() => {
              if (m.mode === "suggesting") return;
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
      </DropdownPanel>
    </>
  );
}
