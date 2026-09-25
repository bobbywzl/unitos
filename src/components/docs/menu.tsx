"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckIcon, SubmenuArrowIcon } from "@/components/docs/icons";

// The page editor's menus (SPEC.md §29), in a portal so the toolbar never
// clips them. The keys are read before the page gets them, so the document
// keeps its focus and its selection while a menu is open.

/** Keep the editor's selection: a press on a toolbar control never focuses it. */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** Where a panel opens: under its control (left edges aligned, or right
    edges with "below-right"), or beside a menu item (a submenu). */
type Placement = "below" | "below-right" | "right";

type PanelEntry = { panel: React.RefObject<HTMLDivElement | null> };
/** The open panels, innermost last: only the innermost reads the keys. */
const openPanels: PanelEntry[] = [];
/** The last menu move came from the keyboard: a submenu it opens starts
    with its first item highlighted. */
let byKeyboard = false;

const ITEM = '[data-menu-item]:not([aria-disabled="true"])';

function items(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(ITEM)];
}

export function highlighted(panel: HTMLElement): HTMLElement | null {
  return panel.querySelector<HTMLElement>("[data-menu-item][data-active]");
}

/** Move the highlight to `el` (null clears it). */
export function highlight(panel: HTMLElement, el: HTMLElement | null): void {
  for (const other of panel.querySelectorAll("[data-menu-item][data-active]")) {
    if (other !== el) other.removeAttribute("data-active");
  }
  if (!el) return;
  el.setAttribute("data-active", "");
  el.scrollIntoView({ block: "nearest" });
}

/** Up, Down, Left, and Right inside a grid of swatches or presets
    (data-grid-cols on the grid) move by cell; elsewhere by item. */
function step(panel: HTMLElement, current: HTMLElement | null, key: string): HTMLElement | null {
  const list = items(panel);
  if (list.length === 0) return null;
  if (!current) return key === "ArrowUp" ? list[list.length - 1] : list[0];
  const grid = current.closest<HTMLElement>("[data-grid-cols]");
  if (grid && panel.contains(grid)) {
    const cells = [...grid.querySelectorAll<HTMLElement>(ITEM)];
    const cols = Number(grid.dataset.gridCols) || 1;
    const at = cells.indexOf(current);
    const move = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : key === "ArrowUp" ? -cols : cols;
    const next = at + move;
    if (next >= 0 && next < cells.length) return cells[next];
    if (key === "ArrowLeft" || key === "ArrowRight") return current;
    // Off the grid's top or bottom: the item before or after the grid.
    const edge = move < 0 ? cells[0] : cells[cells.length - 1];
    const i = list.indexOf(edge) + (move < 0 ? -1 : 1);
    return list[(i + list.length) % list.length];
  }
  if (key === "ArrowLeft" || key === "ArrowRight") return current;
  const i = list.indexOf(current) + (key === "ArrowUp" ? -1 : 1);
  return list[(i + list.length) % list.length];
}

/** Up or Down in a list whose field keeps the focus (Zoom, the size box). */
export function moveHighlight(panel: HTMLElement, key: string): void {
  highlight(panel, step(panel, highlighted(panel), key));
}

type MenuCtx = {
  /** The submenu open in this panel, by its item's id. */
  openSub: string | null;
  setOpenSub: (id: string | null) => void;
};
const MenuContext = createContext<MenuCtx | null>(null);

export function DropdownPanel({
  open,
  anchorRef,
  onClose,
  children,
  placement = "below",
  className = "",
  label,
  id,
  highlightFirst = false,
  keys: readKeys = true,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  placement?: Placement;
  className?: string;
  /** The menu's accessible name. */
  label?: string;
  /** The element id (a combobox's aria-controls). */
  id?: string;
  /** Highlight the checked item, else the first, when the panel opens (a
      menu opened from the keyboard). */
  highlightFirst?: boolean;
  /** False: the panel's own field reads the keys (a combobox's list). */
  keys?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  // A closed panel forgets where it was and which submenu it had open.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setPos(null);
      setOpenSub(null);
    }
  }
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const r = anchor.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.scrollHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    let maxHeight: number;
    if (placement === "right") {
      // Beside the item, its first row level with the item; to the left
      // when the right has no room.
      left = r.right + 2;
      if (left + width > vw - 8) left = Math.max(8, r.left - width - 2);
      maxHeight = vh - 16;
      top = r.top - 6;
      if (top + Math.min(height, maxHeight) > vh - 8) top = Math.max(8, vh - 8 - Math.min(height, maxHeight));
    } else {
      left = placement === "below-right" ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, vw - width - 8));
      top = r.bottom + 2;
      maxHeight = Math.max(120, vh - top - 8);
      // A tall menu with little room below opens above its control.
      if (height > maxHeight && r.top - 10 > maxHeight) {
        maxHeight = r.top - 10;
        top = Math.max(8, r.top - 2 - Math.min(height, maxHeight));
      }
    }
    setPos((p) => (p && p.top === top && p.left === left && p.maxHeight === maxHeight ? p : { top, left, maxHeight }));
  }, [anchorRef, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const panel = panelRef.current;
    // A panel whose content changes size (a filtered list) is placed again.
    const observer = panel ? new ResizeObserver(() => place()) : null;
    if (panel && observer) observer.observe(panel);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel || !(highlightFirst || (placement === "right" && byKeyboard))) return;
    const checked = panel.querySelector<HTMLElement>(`${ITEM}[aria-checked="true"]`);
    highlight(panel, checked ?? items(panel)[0] ?? null);
  }, [open, highlightFirst, placement]);

  useEffect(() => {
    if (!open) return;
    const entry: PanelEntry = { panel: panelRef };
    openPanels.push(entry);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // A menu opened from inside this one (a submenu, the More bubble's
      // dropdowns) keeps this one open; a press in the menu that opened
      // this one closes only this one.
      if (target instanceof Element && target.closest("[data-docs-menu]")) {
        const index = openPanels.indexOf(entry);
        if (openPanels.slice(index + 1).some((p) => p.panel.current?.contains(target))) return;
        if (openPanels.slice(0, index).some((p) => p.panel.current?.contains(target))) closeRef.current();
        return;
      }
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (openPanels[openPanels.length - 1] !== entry) return;
      const panel = panelRef.current;
      if (!panel) return;
      if (e.key === "Escape") {
        // A combobox's field (Zoom, the size box) closes its own list and
        // gives the page the focus back.
        if (!readKeys && e.target instanceof HTMLInputElement && anchorRef.current?.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        const anchor = anchorRef.current;
        const hadFocus = panel.contains(document.activeElement) || Boolean(anchor?.contains(document.activeElement));
        closeRef.current();
        if (hadFocus && anchor && !anchor.closest("[data-docs-menu]")) anchor.focus();
        return;
      }
      if (!readKeys || e.ctrlKey || e.metaKey || e.altKey) return;
      const field = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (field && panel.contains(field) && !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
      if (e.key === "Tab") {
        closeRef.current();
        return;
      }
      const current = highlighted(panel);
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
        byKeyboard = true;
      };
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
        swallow();
        if (e.key === "ArrowRight" && current?.hasAttribute("data-has-submenu")) {
          current.dispatchEvent(new CustomEvent("docs-menu-open-sub"));
          return;
        }
        if (e.key === "ArrowLeft" && placement === "right" && !current?.closest("[data-grid-cols]")) {
          closeRef.current();
          return;
        }
        const list = items(panel);
        const next =
          e.key === "Home" ? list[0] : e.key === "End" ? list[list.length - 1] : step(panel, current, e.key);
        highlight(panel, next ?? null);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        swallow();
        current?.click();
        return;
      }
      // Nothing the reader types while a menu is open reaches the page.
      if (e.key === "Backspace" || e.key === "Delete") {
        swallow();
        return;
      }
      if (e.key.length === 1) {
        swallow();
        const list = items(panel);
        const start = current ? list.indexOf(current) + 1 : 0;
        const letter = e.key.toLowerCase();
        for (let i = 0; i < list.length; i++) {
          const el = list[(start + i) % list.length];
          const text = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().toLowerCase();
          if (text.startsWith(letter)) {
            highlight(panel, el);
            return;
          }
        }
      }
    };
    const onMove = () => {
      byKeyboard = false;
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      const index = openPanels.indexOf(entry);
      if (index >= 0) openPanels.splice(index, 1);
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousemove", onMove);
    };
  }, [open, anchorRef, readKeys, placement]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <MenuContext.Provider value={{ openSub, setOpenSub }}>
      <div
        ref={panelRef}
        id={id}
        role="menu"
        aria-label={label}
        data-docs-menu
        data-edit-control
        onMouseDown={(e) => {
          // A press on the panel keeps the page's selection, except in a field.
          const el = e.target as HTMLElement;
          if (!el.closest("input, textarea, select")) e.preventDefault();
        }}
        onMouseMove={(e) => {
          const panel = panelRef.current;
          const item = (e.target as HTMLElement).closest<HTMLElement>("[data-menu-item]");
          if (!panel || !item || !panel.contains(item) || item.hasAttribute("data-active")) return;
          highlight(panel, item.getAttribute("aria-disabled") === "true" ? null : item);
        }}
        className={`docs-menu ${className}`}
        style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { visibility: "hidden", top: 0, left: 0 }}
      >
        {children}
      </div>
    </MenuContext.Provider>,
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
  submenu,
  submenuClassName,
  label,
  role,
  className = "",
  tip,
}: {
  /** Runs on a click or Enter; an item with a submenu and no onSelect opens it. */
  onSelect?: () => void;
  checked?: boolean;
  disabled?: boolean;
  shortcut?: string;
  icon?: ReactNode;
  children: ReactNode;
  track?: string;
  /** The submenu's items; it opens on hover and on Right. */
  submenu?: ReactNode;
  submenuClassName?: string;
  /** The accessible name when the item's children are not plain text. */
  label?: string;
  role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  className?: string;
  tip?: string;
}) {
  const ctx = useContext(MenuContext);
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const subOpen = Boolean(submenu) && ctx?.openSub === id;
  const setOpenSub = ctx?.setOpenSub;
  const hasOpenSub = Boolean(ctx?.openSub);

  useEffect(() => {
    const el = ref.current;
    if (!el || !submenu || !setOpenSub) return;
    const open = () => setOpenSub(id);
    el.addEventListener("docs-menu-open-sub", open);
    return () => el.removeEventListener("docs-menu-open-sub", open);
  }, [submenu, setOpenSub, id]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  // Resting on an item opens its submenu and closes a sibling's, after a
  // beat, so a pointer crossing the menu does not flicker them.
  const hover = () => {
    if (!setOpenSub) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (submenu) setOpenSub(id);
      else if (hasOpenSub) setOpenSub(null);
    }, 180);
  };
  const leave = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const itemRole = role ?? (checked === undefined ? "menuitem" : "menuitemradio");
  return (
    <>
      <button
        ref={ref}
        type="button"
        role={itemRole}
        aria-checked={itemRole === "menuitem" ? undefined : Boolean(checked)}
        aria-disabled={disabled || undefined}
        aria-haspopup={submenu ? "menu" : undefined}
        aria-expanded={submenu ? subOpen : undefined}
        aria-label={label}
        data-menu-item
        data-has-submenu={submenu ? "" : undefined}
        data-sub-open={subOpen ? "" : undefined}
        data-tip={tip}
        tabIndex={-1}
        onMouseDown={keepFocus}
        onMouseEnter={hover}
        onMouseLeave={leave}
        onClick={() => {
          if (disabled) return;
          if (onSelect) onSelect();
          else if (submenu) setOpenSub?.(id);
        }}
        data-track={track}
        className={`docs-menu-item ${className}`}
      >
        <span className="docs-menu-check" aria-hidden>
          {checked ? <CheckIcon size={18} /> : (icon ?? null)}
        </span>
        <span className="docs-menu-label">{children}</span>
        {shortcut && <span className="docs-menu-shortcut">{shortcut}</span>}
        {submenu && <SubmenuArrowIcon size={20} className="docs-menu-arrow" />}
      </button>
      {submenu && (
        <DropdownPanel
          open={subOpen}
          anchorRef={ref}
          onClose={() => setOpenSub?.(null)}
          placement="right"
          className={submenuClassName}
        >
          {submenu}
        </DropdownPanel>
      )}
    </>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="docs-menu-sep" />;
}

/** A section's name in a menu: RECENT, CUSTOM. */
export function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="docs-menu-header">
      {children}
    </div>
  );
}
