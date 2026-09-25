"use client";

import type { Editor } from "@tiptap/react";
import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { FONT_SIZES } from "@/components/docs/extensions";
import { DropdownPanel, highlight, highlighted, MenuItem, moveHighlight } from "@/components/docs/menu";

// The size box (SPEC.md §29), between Decrease and Increase font size: it
// takes a typed size — floored to half a point, clamped to 1–400 — and
// opens Google Docs' list of sizes. A selection that mixes sizes leaves it
// blank.

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

export function FontSizeBox({ editor, size }: { editor: Editor; size: number | null }) {
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
    if (n === null) editor.commands.focus();
    else editor.chain().focus().setFontSize(`${n}pt`).run();
  };
  const panel = () => document.querySelector<HTMLElement>(".docs-menu-sizes");

  return (
    <>
      <span
        ref={boxRef}
        className="docs-size-box"
        data-open={open ? "" : undefined}
        data-tip={open ? undefined : t("docs.fontSize")}
        data-tb-item
        onMouseDown={(e) => {
          if (e.target === inputRef.current) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          value={shown}
          tabIndex={-1}
          aria-label={t("docs.fontSizeValue", { n: formatSize(size) })}
          role="combobox"
          aria-expanded={open}
          aria-controls="docs-size-list"
          aria-haspopup="menu"
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
            const active = list && highlighted(list);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!list) return;
              moveHighlight(list, e.key);
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
        open={open}
        anchorRef={boxRef}
        onClose={() => setOpen(false)}
        className="docs-menu-plain docs-menu-sizes"
        id="docs-size-list"
        label={t("docs.fontSize")}
        keys={false}
      >
        {visible.map((s) => (
          <MenuItem key={s} onSelect={() => apply(s)} track={`docs:font-size:${s}`}>
            {s}
          </MenuItem>
        ))}
      </DropdownPanel>
    </>
  );
}
