"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "@/components/docs/icons";

// The page editor's dropdowns (SPEC.md §29): a button that opens a panel
// under it, the way Google Docs' toolbar menus open. The panel lives in a
// portal with a fixed position, so the toolbar's own clipping never cuts it;
// a press outside, Escape, or picking an item closes it. Buttons never take
// focus from the page, so the selection they act on stays put.

/** Keep the editor's selection: a press on a toolbar control never focuses it. */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function DropdownPanel({
  open,
  anchorRef,
  onClose,
  children,
  align = "left",
  className = "",
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = panel?.offsetWidth ?? 200;
    const height = panel?.offsetHeight ?? 0;
    let left = align === "right" ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = r.bottom + 4;
    if (height && top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    setPos({ top, left });
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // A menu opened from inside this one (the More row's dropdowns) keeps
      // this one open.
      if (target instanceof Element && target.closest("[data-docs-menu]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      data-docs-menu
      data-edit-control
      onMouseDown={(e) => {
        // A press on the panel keeps the page's selection, except in a field.
        const el = e.target as HTMLElement;
        if (!el.closest("input, textarea, select")) e.preventDefault();
      }}
      className={`docs-menu ${className}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden", top: 0, left: 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  onSelect,
  checked,
  disabled,
  shortcut,
  icon,
  children,
  track,
}: {
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
  shortcut?: string;
  icon?: ReactNode;
  children: ReactNode;
  track?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onSelect}
      data-track={track}
      className="docs-menu-item"
    >
      <span className="docs-menu-check">{checked ? <CheckIcon size={18} /> : icon ?? null}</span>
      <span className="docs-menu-label">{children}</span>
      {shortcut && <span className="docs-menu-shortcut">{shortcut}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="docs-menu-sep" />;
}
