"use client";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, ExpandLessIcon, ExpandMoreIcon } from "@/components/docs/icons";
import { formatLength, lengthUnitFor, parseLength } from "@/components/docs/page/geometry";
import { useLang, useT } from "@/components/lang-provider";

// The insert area's shared pieces (SPEC.md §29): a box that floats at a
// place in the text, and Google Docs' side panel with its folding sections
// and its fields. A press inside either keeps the page's selection, except
// in a field.

/** Re-render on every change of the editor's state. */
export function useEditorTick(editor: Editor): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.on("transaction", bump);
    editor.on("focus", bump);
    editor.on("blur", bump);
    return () => {
      editor.off("transaction", bump);
      editor.off("focus", bump);
      editor.off("blur", bump);
    };
  }, [editor]);
  return tick;
}

/** A document position in state, mapped through every edit. */
export function useDocPos(editor: Editor): [number | null, (pos: number | null) => void] {
  const [pos, setPos] = useState<number | null>(null);
  useEffect(() => {
    const onTr = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) setPos((p) => (p === null ? p : transaction.mapping.map(p)));
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
  }, [editor]);
  return [pos, setPos];
}

/** Re-render when the window scrolls or resizes, so a box follows its text. */
export function useViewportTick(active: boolean): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const on = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(bump);
    };
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
    };
  }, [active]);
  return tick;
}

/** A press on the box keeps the page's selection, except in a field. */
export function keepSelection(e: React.MouseEvent) {
  const el = e.target as HTMLElement;
  if (!el.closest("input, textarea, select, [contenteditable='true']")) e.preventDefault();
}

export type Anchor = { left: number; top: number; bottom: number };

/** What a box opens: menus, the insert area's boxes, and dialogs. */
const OWN = "[data-docs-insert-popover], [data-docs-menu], .docs-tb-backdrop";

/** A box under (or, without room, over) an anchor in the window. */
export function FloatingBox({
  anchor,
  children,
  className = "",
  gap = 6,
  onDismiss,
  label,
  role = "dialog",
  onMouseEnter,
  onMouseLeave,
}: {
  anchor: Anchor;
  children: ReactNode;
  className?: string;
  gap?: number;
  /** A press outside the box or Escape. */
  onDismiss?: () => void;
  label?: string;
  role?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const { left: aLeft, top: aTop, bottom: aBottom } = anchor;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(8, Math.min(aLeft, window.innerWidth - w - 8));
      let top = aBottom + gap;
      if (top + h > window.innerHeight - 8 && aTop - gap - h >= 8) top = aTop - gap - h;
      else if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    // The box's own size changes with what it shows: place it again.
    const observer = new ResizeObserver(place);
    observer.observe(el);
    return () => observer.disconnect();
  }, [aLeft, aTop, aBottom, gap]);
  useEffect(() => {
    if (!onDismiss) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (ref.current?.contains(target)) return;
      // Its own menus and dialogs are not outside.
      if (target?.closest(OWN)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape closes an open menu or dialog first.
      if (e.key !== "Escape" || document.querySelector("[data-docs-menu], .docs-tb-backdrop")) return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onDismiss]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className={`docs-insert-pop ${className}`}
      data-docs-insert-popover
      data-edit-control
      data-selection-popover
      onMouseDown={keepSelection}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Google Docs' side panel: a title, a close button, folding sections. */
export function SidePanel({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  // A field applies on blur: blur it before the panel goes.
  const close = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur();
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <aside
      ref={ref}
      className="docs-side-panel"
      aria-label={title}
      data-docs-insert-popover
      data-edit-control
      data-selection-popover
      onMouseDown={keepSelection}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
      }}
    >
      <header className="docs-side-head">
        {icon}
        <h2>{title}</h2>
        <button type="button" className="docs-icon-btn" aria-label={t("docs.close")} data-tip={t("docs.close")} onClick={close}>
          <CloseIcon />
        </button>
      </header>
      <div className="docs-side-body">{children}</div>
    </aside>,
    document.body,
  );
}

export function PanelSection({ title, open: initial = true, children }: { title: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="docs-side-section">
      <button type="button" className="docs-side-section-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      </button>
      {open && <div className="docs-side-section-body">{children}</div>}
    </section>
  );
}

/** One of a few choices, as a row of joined buttons. */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="docs-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** A length in the page's unit (in, or cm in Chinese), applied on Enter or
    blur; `pt` is its value in points. `bare` leaves the label to a
    checkbox beside it. */
export function LengthField({ label, pt, onChange, bare }: { label: string; pt: number; onChange: (pt: number) => void; bare?: boolean }) {
  const t = useT();
  const unit = lengthUnitFor(useLang());
  const shown = formatLength(pt, unit);
  const apply = (input: HTMLInputElement) => {
    const next = parseLength(input.value, unit);
    if (next !== null && input.value !== shown) onChange(next);
    else input.value = shown;
  };
  return (
    <label className="docs-side-field">
      {!bare && <span className="docs-side-label">{label}</span>}
      <span className="docs-side-length">
        <input
          key={pt}
          className="docs-field"
          inputMode="decimal"
          aria-label={label}
          defaultValue={shown}
          onBlur={(e) => apply(e.currentTarget)}
          onKeyDown={(e) => e.key === "Enter" && apply(e.currentTarget)}
        />
        {t(unit === "in" ? "docsInsert.unitIn" : "docsInsert.unitCm")}
      </span>
    </label>
  );
}

/** Focus a field after the editor's own focus, which Tiptap applies a
    frame later, has landed. */
export function focusSoon(el: HTMLElement | null | undefined) {
  requestAnimationFrame(() => requestAnimationFrame(() => el?.focus()));
}

/** The editor's coordinates of a document position, as an anchor. */
export function anchorAt(editor: Editor, pos: number): Anchor | null {
  try {
    const c = editor.view.coordsAtPos(Math.max(0, Math.min(pos, editor.state.doc.content.size)));
    return { left: c.left, top: c.top, bottom: c.bottom };
  } catch {
    return null;
  }
}
