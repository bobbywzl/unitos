"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { registerDocsCommands } from "@/components/docs/commands";
import { CheckIcon, EditIcon, SuggestIcon, ViewIcon } from "@/components/docs/icons";
import { keys, matchesCombo } from "@/components/docs/keys";
import { DropdownPanel, keepFocus, MenuItem } from "@/components/docs/menu";
import type { TKey } from "@/lib/i18n/dictionaries";

// The mode switcher (SPEC.md §29): a pill with the mode's symbol and name
// at the toolbar's right end, and Google Docs' menu of modes — Editing,
// Suggesting, Viewing — each with its line. Ctrl+Alt+Shift+Z switches to
// Editing, Ctrl+Alt+Shift+C and D to Viewing (toolbar.tsx binds them), and
// Ctrl+Alt+Shift+X to Suggesting (bound here, with its command).

export type DocsMode = "editing" | "suggesting" | "viewing";

/** Raised on the page's text with a mode: the mode switcher switches to it. */
const MODE_EVENT = "docs:mode";

registerDocsCommands([
  {
    id: "mode:suggesting",
    label: "docsSuggest.suggestingMode",
    menu: "view",
    keywords: ["switch to suggesting", "suggest edits", "track changes", "建议"],
    shortcut: "Mod+Alt+Shift+X",
    run: (editor) => editor.view.dom.dispatchEvent(new CustomEvent<DocsMode>(MODE_EVENT, { bubbles: true, detail: "suggesting" })),
    // Only an editor has the mode switcher.
    enabled: (editor) => Boolean(editor.view.dom.closest("[data-docs-editor]")?.querySelector(".docs-mode-pill")),
  },
]);

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
  const [open, setOpen] = useState(false);
  const [fromKeys, setFromKeys] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = MODES.find((m) => m.mode === mode) ?? MODES[0];
  const tip = t(current.tip);

  useEffect(() => {
    const shell = ref.current?.closest("[data-docs-editor]");
    if (!shell) return;
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && active !== document.body && !shell.contains(active)) return;
      if (!matchesCombo(e, "Mod+Alt+Shift+X")) return;
      e.preventDefault();
      onMode("suggesting");
    };
    const onModeEvent = (e: Event) => onMode((e as CustomEvent<DocsMode>).detail);
    window.addEventListener("keydown", onKey, true);
    shell.addEventListener(MODE_EVENT, onModeEvent);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      shell.removeEventListener(MODE_EVENT, onModeEvent);
    };
  }, [onMode]);

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
      </DropdownPanel>
    </>
  );
}
