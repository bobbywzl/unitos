"use client";

import type { Editor } from "@tiptap/react";
import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { FONT_SIZES, stepSelectionFontSize } from "@/components/docs/extensions";
import { AddIcon, RemoveIcon } from "@/components/docs/icons";
import { withKeys } from "@/components/docs/keys";
import { DropdownPanel, highlight, MenuItem } from "@/components/docs/menu";
import { Btn } from "@/components/docs/toolbar/controls";

// The size (SPEC.md §29): Decrease font size, the size box, Increase font
// size. − and + move every run one point (Ctrl+Shift+, and .); the box
// takes a typed size — floored to half a point, clamped to 1–400 — and
// opens Google Docs' list of sizes. A selection that mixes sizes leaves
// the box blank.

/** A typed size: a positive number, floored to 0.5 and clamped to 1–400;
    null restores the previous value. */
export function parseSize(text: string): number | null {
  const n = parseFloat(text.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(400, Math.floor(n * 2) / 2));
}

/** The box shows at most one decimal, floored: 11.5 → "11.5", 11 → "11". */
export function formatSize(size: number | null): string {
  if (size === null) return "";
  const floored = Math.floor(size * 10) / 10;
  return Number.isInteger(floored) ? String(floored) : floored.toFixed(1);
}

export function FontSizeControl({ editor, size, disabled }: { editor: Editor; size: number | null; disabled: boolean }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = draft ?? formatSize(size);
  const filter = draft?.trim() ?? "";
  const visible = filter ? FONT_SIZES.filter((s) => String(s).startsWith(filter)) : [...FONT_SIZES];

  const apply = (n: number | null) => {
    setDraft(null);
    setOpen(false);
    setMoved(false);
    inputRef.current?.blur();
    if (n === null) {
      editor.commands.focus();
      return;
    }
    editor.chain().focus().setFontSize(`${n}pt`).run();
  };
  const panel = () => document.querySelector<HTMLElement>(".docs-menu-sizes");

  return (
    <div className="docs-size">
      <Btn
        label={t("docs.decreaseFontSize")}
        tip={withKeys(t("docs.decreaseFontSize"), "Mod+Shift+,")}
        track="font-size-down"
        disabled={disabled}
        className="docs-size-down"
        onClick={() => {
          stepSelectionFontSize(editor, -1);
          editor.commands.focus();
        }}
      >
        <RemoveIcon size={20} />
      </Btn>
      <span
        ref={boxRef}
        className="docs-size-box"
        data-open={open ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
        data-tip={open ? undefined : t("docs.fontSize")}
        data-tb-item
        onMouseDown={(e) => {
          if (e.target === inputRef.current || disabled) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          value={shown}
          disabled={disabled}
          tabIndex={-1}
          aria-label={t("docs.fontSizeValue", { n: formatSize(size) })}
          role="combobox"
          aria-expanded={open}
          inputMode="decimal"
          data-track="docs:font-size"
          onFocus={(e) => {
            e.currentTarget.select();
            setOpen(true);
          }}
          onBlur={() => {
            setDraft(null);
            setOpen(false);
            setMoved(false);
          }}
          onChange={(e) => {
            setDraft(e.target.value.slice(0, 6));
            setMoved(false);
            setOpen(true);
            // The first size that starts with the text is highlighted.
            requestAnimationFrame(() => {
              const list = panel();
              if (list) highlight(list, list.querySelector<HTMLElement>("[data-menu-item]"));
            });
          }}
          onKeyDown={(e) => {
            const list = panel();
            const active = list?.querySelector<HTMLElement>("[data-menu-item][data-active]");
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!list) return;
              const all = [...list.querySelectorAll<HTMLElement>("[data-menu-item]")];
              const i = active ? all.indexOf(active) : -1;
              const next = e.key === "ArrowDown" ? all[Math.min(all.length - 1, i + 1)] : all[Math.max(0, i - 1)];
              highlight(list, next ?? null);
              setMoved(true);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (moved && active) active.click();
              else if (draft === null) apply(null);
              else apply(parseSize(draft));
            } else if (e.key === "Escape") {
              e.preventDefault();
              apply(null);
            }
          }}
        />
      </span>
      <DropdownPanel
        open={open && !disabled}
        anchorRef={boxRef}
        onClose={() => setOpen(false)}
        className="docs-menu-plain docs-menu-sizes"
        label={t("docs.fontSize")}
        keys={false}
      >
        {visible.map((s) => (
          <MenuItem key={s} onSelect={() => apply(s)} track={`docs:font-size:${s}`}>
            {s}
          </MenuItem>
        ))}
      </DropdownPanel>
      <Btn
        label={t("docs.increaseFontSize")}
        tip={withKeys(t("docs.increaseFontSize"), "Mod+Shift+.")}
        track="font-size-up"
        disabled={disabled}
        className="docs-size-up"
        onClick={() => {
          stepSelectionFontSize(editor, 1);
          editor.commands.focus();
        }}
      >
        <AddIcon size={20} />
      </Btn>
    </div>
  );
}
