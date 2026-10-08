"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { menuRowClass } from "@/components/reader/note-picker";
import { isImeKey } from "@/lib/ime";

export type CardMoreItem = {
  label: string;
  tip: string;
  track: string;
  icon: ReactNode;
  danger?: boolean;
  onSelect: () => void;
};

// A tool card's rare actions (SPEC.md §6): Regenerate and Delete in one ⋯ at
// the end of the card's foot row, so the head holds Expand and ✕ alone and a
// slip from ✕ deletes nothing. The menu opens above the ⋯; a row, Escape, or
// a press outside closes it.
export function CardMore({ items, className }: { items: CardMoreItem[]; className: string }) {
  const t = useT();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isImeKey(e)) return;
      // Escape folds the menu before the card under it reacts.
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  if (items.length === 0) return null;
  return (
    <span ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-track="tool-card-more"
        data-no-drag
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("panes.more")}
        data-tip={items.map((item) => item.label).join(" · ")}
        className={className}
      >
        <MoreIcon size={13} />
      </button>
      {open && (
        <span
          role="menu"
          className="menu-in absolute right-0 bottom-full z-30 mb-1 flex w-44 flex-col rounded-2xl border border-line bg-card p-1.5 shadow-float"
        >
          {items.map((item) => (
            <button
              key={item.track}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              data-track={item.track}
              data-tip={item.tip}
              className={`${menuRowClass} pointer-coarse:py-2.5${item.danger ? " text-red-600 hover:text-red-700" : ""}`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
