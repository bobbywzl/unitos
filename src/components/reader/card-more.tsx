"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
// slip from ✕ deletes nothing. The menu opens above the ⋯, its right edge at
// the ⋯'s, and moves sideways to stay 8 px inside the screen (a phone's card
// wraps its foot row, so the ⋯ can sit at the left); with no room above, it
// opens below. A row, Escape, or a press outside closes it.
export function CardMore({ items, className }: { items: CardMoreItem[]; className: string }) {
  const t = useT();
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ dx: number; below: boolean }>({ dx: 0, below: false });
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const root = rootRef.current;
    if (!open || !menu || !root) return;
    // Measured from the ⋯, not the menu: the menu's drop-in moves it.
    const button = root.getBoundingClientRect();
    const MARGIN = 8;
    const left = button.right - menu.offsetWidth;
    const dx = Math.max(MARGIN - left, Math.min(0, window.innerWidth - MARGIN - button.right));
    const below = button.top - 4 - menu.offsetHeight < MARGIN && window.innerHeight - button.bottom > button.top;
    setPlace((p) => (p.dx === dx && p.below === below ? p : { dx, below }));
  }, [open]);
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
          ref={menuRef}
          role="menu"
          className={`menu-in absolute z-30 flex w-44 flex-col rounded-2xl border border-line bg-card p-1.5 shadow-float ${
            place.below ? "top-full mt-1" : "bottom-full mb-1"
          }`}
          style={{ right: -place.dx }}
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
