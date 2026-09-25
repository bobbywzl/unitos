"use client";

import type { Editor } from "@tiptap/react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { DropDownIcon } from "@/components/docs/icons";
import { DropdownPanel, keepFocus } from "@/components/docs/menu";

// The toolbar's controls (SPEC.md §29): a button, a toggle, a menu button,
// and a split button, in Google Docs' sizes (css/toolbar.css). No control
// takes the page's focus on a press, so the selection it acts on stays.

/** The page editor whose text carries the toolbar's events. A control in
    the More bubble sits in a portal, outside the toolbar's DOM. */
export const ToolbarEditor = createContext<Editor | null>(null);

/** True turns the controls inside off: a header's toolbar has no lists,
    links, or styles. */
export const ControlsOff = createContext(false);

/** A toolbar button; `pressed` makes it a toggle. */
export function Btn({
  label,
  tip,
  onClick,
  pressed,
  disabled,
  children,
  track,
  className = "",
}: {
  /** The accessible name. */
  label: string;
  /** The tooltip: the label and its shortcut. */
  tip?: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
  track: string;
  className?: string;
}) {
  const off = useContext(ControlsOff);
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={tip ?? label}
      aria-pressed={pressed}
      disabled={disabled || off}
      onMouseDown={keepFocus}
      onClick={onClick}
      data-track={`docs:${track}`}
      data-tb-item
      className={`docs-tb-btn ${className}`}
    >
      {children}
    </button>
  );
}

export function Sep({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`docs-tb-sep ${className}`} />;
}

/** Raised on the editor's text, opens the toolbar menu with this id (Search
    the menus opens a palette this way). The toolbar's More bubble shows the
    control first. */
export const OPEN_MENU_EVENT = "docs:toolbar-open-menu";

/** A button whose press opens a menu under it. Down, Enter, or Space on
    the focused button opens it with the first item highlighted. */
export function DropBtn({
  id,
  label,
  face,
  track,
  children,
  className = "",
  menuClassName = "",
  arrow = true,
  onOpenChange,
}: {
  /** The id Search the menus opens it by. */
  id?: string;
  label: string;
  face: ReactNode;
  track: string;
  children: (close: () => void) => ReactNode;
  className?: string;
  menuClassName?: string;
  /** False hides the arrow (Insert image, Line & paragraph spacing). */
  arrow?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fromKeys, setFromKeys] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const editor = useContext(ToolbarEditor);
  const off = useContext(ControlsOff);
  const changeRef = useRef(onOpenChange);
  useEffect(() => {
    changeRef.current = onOpenChange;
  });
  const set = (next: boolean, byKeys = false) => {
    setFromKeys(byKeys);
    setOpen(next);
    onOpenChange?.(next);
  };
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!id || !dom) return;
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ id: string }>).detail?.id !== id) return;
      setFromKeys(true);
      setOpen(true);
      changeRef.current?.(true);
    };
    dom.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => dom.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, [id, editor]);
  const close = () => set(false);
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label={label}
        data-tip={open ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={off}
        onMouseDown={keepFocus}
        onClick={() => set(!open)}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            set(true, true);
          }
        }}
        data-track={`docs:${track}`}
        data-tb-item
        className={`docs-tb-btn ${className}`}
      >
        {face}
        {arrow && <DropDownIcon size={18} className="docs-tb-arrow" />}
      </button>
      <DropdownPanel
        open={open}
        anchorRef={anchorRef}
        onClose={close}
        className={menuClassName}
        label={label}
        highlightFirst={fromKeys}
      >
        {/* Built only while open: the font menu reads the whole document. */}
        {open && children(close)}
      </DropdownPanel>
    </>
  );
}

/** Checklist, Bulleted list, Numbered list: the left half toggles the list,
    the right half opens its presets. */
export function SplitButton({
  id,
  label,
  tip,
  menuLabel,
  pressed,
  onToggle,
  icon,
  track,
  children,
}: {
  id: string;
  label: string;
  tip: string;
  menuLabel: string;
  pressed: boolean;
  onToggle: () => void;
  icon: ReactNode;
  track: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <span className="docs-tb-split">
      <Btn label={label} tip={tip} pressed={pressed} onClick={onToggle} track={track} className="docs-tb-split-left">
        {icon}
      </Btn>
      <DropBtn
        id={id}
        label={menuLabel}
        face={null}
        track={`${track}-menu`}
        className="docs-tb-split-right"
        menuClassName="docs-menu-lists"
      >
        {children}
      </DropBtn>
    </span>
  );
}
