"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { DropDownIcon } from "@/components/docs/icons";
import { DropdownPanel, highlighted, MenuItem, MenuSeparator, moveHighlight } from "@/components/docs/menu";

// Zoom (SPEC.md §29): Google Docs' combobox. The menu is Fit, then 50% to
// 200%; a typed number is clamped to 50–200, "fit" means Fit, anything
// else keeps the zoom. A press on the field selects its text and opens the
// menu; typing filters the menu to the items that start with the text.

export const ZOOMS = [50, 75, 90, 100, 125, 150, 200] as const;
/** "fit" fits the page to the window's width. */
export type Zoom = number | "fit";

/** The zoom a typed text asks for, or null to keep the current one. */
function parseZoom(text: string): Zoom | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "fit") return "fit";
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(50, Math.min(200, n));
}

export function ZoomBox({
  zoom,
  onZoom,
  onDone,
}: {
  zoom: Zoom;
  onZoom: (zoom: Zoom) => void;
  /** The page takes the focus back. */
  onDone: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const caption = zoom === "fit" ? t("docs.zoomFit") : `${zoom}%`;
  const shown = draft ?? caption;
  const items: { value: Zoom; label: string }[] = [
    { value: "fit", label: t("docs.zoomFit") },
    ...ZOOMS.map((z) => ({ value: z, label: `${z}%` })),
  ];
  const filter = draft === null ? "" : draft.trim().toLowerCase();
  const visible = filter ? items.filter((i) => i.label.toLowerCase().startsWith(filter)) : items;

  const finish = (value: Zoom | null) => {
    if (value !== null) onZoom(value);
    setDraft(null);
    setOpen(false);
    inputRef.current?.blur();
    onDone();
  };
  const panel = () => document.querySelector<HTMLElement>(".docs-menu-zoom");

  return (
    <div
      ref={boxRef}
      className="docs-tb-combo"
      data-open={open ? "" : undefined}
      data-tb-item
      data-tip={open ? undefined : t("docs.zoom")}
      onMouseDown={(e) => {
        // A press in the list (a portal) reaches here through React: the list's own.
        if (!boxRef.current?.contains(e.target as Node)) return;
        if (e.target !== inputRef.current) {
          e.preventDefault();
          if (open) setOpen(false);
          else inputRef.current?.focus();
        }
        // The list opens even when the field kept the focus.
        if (!open) setOpen(true);
      }}
    >
      <input
        ref={inputRef}
        value={shown}
        aria-label={t("docs.zoom")}
        aria-expanded={open}
        aria-controls="docs-zoom-list"
        aria-haspopup="menu"
        role="combobox"
        tabIndex={-1}
        data-track="docs:zoom"
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onBlur={() => {
          setDraft(null);
          setOpen(false);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          const list = panel();
          const active = list && highlighted(list);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (list) moveHighlight(list, e.key);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (active && draft === null) active.click();
            else finish(draft === null ? null : parseZoom(draft));
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(null);
          }
        }}
      />
      <DropDownIcon size={18} className="docs-tb-arrow" />
      <DropdownPanel
        open={open}
        anchorRef={boxRef}
        onClose={() => setOpen(false)}
        className="docs-menu-plain docs-menu-zoom"
        id="docs-zoom-list"
        label={t("docs.zoom")}
        keys={false}
      >
        {visible.map((item, i) => (
          <div key={item.label}>
            <MenuItem onSelect={() => finish(item.value)} track={`docs:zoom:${item.value}`}>
              {item.label}
            </MenuItem>
            {item.value === "fit" && i === 0 && visible.length > 1 && <MenuSeparator />}
          </div>
        ))}
      </DropdownPanel>
    </div>
  );
}
