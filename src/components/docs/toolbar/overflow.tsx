"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertIcon } from "@/components/docs/icons";
import { DropdownPanel, keepFocus } from "@/components/docs/menu";
import { OPEN_MENU_EVENT, Sep } from "@/components/docs/toolbar/controls";

// The toolbar's row (SPEC.md §29) and how it folds, as Google Docs folds
// it. When the controls do not fit, the mode switcher's name folds away
// first; then whole groups — the controls between two separators — move,
// right to left, into More (⋮), which opens them in a row under it. When
// the row widens they come back in the reverse order, the name last.
//
// The row is one Tab stop (role="toolbar"): Left and Right move between
// the controls, Escape goes back to the page.

export type ToolbarGroup = {
  key: string;
  /** A separator is drawn before the group (not before the first shown). */
  sep: boolean;
  content: ReactNode;
  /** The ids of the menus inside, for Search the menus. */
  menus?: string[];
};

/** The mode switcher's name box, open and folded, with its 2 px padding. */
const CAPTION_OPEN = 122;
const CAPTION_FOLDED = 26;
/** More (⋮) with its margins. */
const MORE = 32;

function focusTarget(item: HTMLElement): HTMLElement | null {
  if (item.matches("button, input")) return item;
  return item.querySelector<HTMLElement>("input, button");
}

export function ToolbarRow({
  groups,
  right,
  foldable,
  label,
  moreLabel,
  pageless,
  onEscape,
}: {
  groups: ToolbarGroup[];
  /** The right end: the mode switcher (folded or not) and Hide the menus. */
  right: (folded: boolean) => ReactNode;
  foldable: boolean;
  label: string;
  moreLabel: string;
  pageless: boolean;
  /** Escape on a control: the page takes the focus back. */
  onEscape: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const widths = useRef(new Map<string, number>());
  const moreRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(groups.length);
  const [folded, setFolded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const entered = useRef(groups.length);
  const count = groups.length;

  const fit = useCallback(() => {
    const bar = barRef.current;
    const rightEl = rightRef.current;
    if (!bar || !rightEl) return;
    for (const [key, el] of groupRefs.current) widths.current.set(key, el.offsetWidth);
    const style = getComputedStyle(bar);
    const inner = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
    // The name box's width animates; the rest of the right end does not.
    const caption = rightEl.querySelector<HTMLElement>(".docs-mode-caption");
    const base = rightEl.offsetWidth + 4 - (caption ? caption.offsetWidth + 2 : 0);
    const rightOpen = base + (caption ? CAPTION_OPEN : 0);
    const rightFolded = base + (caption ? CAPTION_FOLDED : 0);
    const list = groups.map((g, i) => (widths.current.get(g.key) ?? 0) + (i > 0 && g.sep && !widths.current.has(g.key) ? 7 : 0));
    const total = list.reduce((a, b) => a + b, 0);
    let nextShown = count;
    let nextFolded = false;
    if (total > inner - rightOpen) {
      nextFolded = foldable;
      const room = inner - (foldable ? rightFolded : rightOpen);
      if (total > room) {
        let used = 0;
        nextShown = 0;
        for (let i = 0; i < count; i++) {
          if (used + list[i] + MORE > room) break;
          used += list[i];
          nextShown = i + 1;
        }
      }
    }
    setShown((s) => (s === nextShown ? s : nextShown));
    setFolded((f) => (f === nextFolded ? f : nextFolded));
  }, [groups, count, foldable]);
  const fitRef = useRef(fit);

  useLayoutEffect(() => {
    fitRef.current = fit;
    fit();
  });

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const observer = new ResizeObserver(() => fitRef.current());
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    entered.current = shown;
  }, [shown]);

  useEffect(() => {
    if (shown >= count) setMoreOpen(false);
  }, [shown, count]);

  // Search the menus opens a menu that sits in the bubble: the bubble
  // opens first, then the menu.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id: string; again?: boolean }>).detail?.id;
      if (!id || (e as CustomEvent<{ again?: boolean }>).detail?.again) return;
      const index = groups.findIndex((g) => g.menus?.includes(id));
      if (index >= shown && !moreOpen) {
        setMoreOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT, { detail: { id, again: true } })), 60);
      }
    };
    window.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, [groups, shown, moreOpen]);

  // One Tab stop: the control last used keeps tabindex 0.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const items = [...bar.querySelectorAll<HTMLElement>("[data-tb-item]")]
      .map(focusTarget)
      .filter((el): el is HTMLElement => el !== null);
    const current = items.find((el) => el.getAttribute("tabindex") === "0" && !(el as HTMLButtonElement).disabled);
    items.forEach((el, i) => el.setAttribute("tabindex", el === current || (!current && i === 0) ? "0" : "-1"));
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const bar = barRef.current;
    if (!bar) return;
    const target = e.target as HTMLElement;
    if (e.key === "Escape" && !target.closest("[data-docs-menu]")) {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // A field keeps its arrows for its own caret.
    if (target.matches("input") && !target.hasAttribute("readonly")) return;
    const items = [...bar.querySelectorAll<HTMLElement>("[data-tb-item]")]
      .map(focusTarget)
      .filter((el): el is HTMLElement => el !== null && !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
    const at = items.findIndex((el) => el === target || el.contains(target));
    if (at < 0) return;
    e.preventDefault();
    const next = items[(at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length];
    for (const el of items) el.setAttribute("tabindex", "-1");
    next.setAttribute("tabindex", "0");
    next.focus();
  };

  const hidden = groups.slice(shown);
  return (
    <div
      ref={barRef}
      className="docs-toolbar"
      role="toolbar"
      aria-label={label}
      data-edit-control
      data-pageless={pageless ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="docs-tb-left">
        {groups.slice(0, shown).map((g, i) => (
          <div
            key={g.key}
            ref={(el) => {
              if (el) groupRefs.current.set(g.key, el);
              else groupRefs.current.delete(g.key);
            }}
            className={`docs-tb-group${i >= entered.current ? " docs-tb-group-in" : ""}`}
          >
            {i > 0 && g.sep && <Sep />}
            {g.content}
          </div>
        ))}
        {hidden.length > 0 && (
          <>
            <button
              ref={moreRef}
              type="button"
              aria-label={moreLabel}
              data-tip={moreOpen ? undefined : moreLabel}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              data-track="docs:more"
              data-tb-item
              onMouseDown={keepFocus}
              onClick={() => setMoreOpen((o) => !o)}
              className="docs-tb-btn"
            >
              <MoreVertIcon />
            </button>
            <DropdownPanel
              open={moreOpen}
              anchorRef={moreRef}
              onClose={() => setMoreOpen(false)}
              placement="below-right"
              className="docs-tb-bubble"
              label={moreLabel}
              keys={false}
            >
              <div className="docs-tb-bubble-row" data-pageless={pageless ? "" : undefined} role="toolbar" aria-label={moreLabel}>
                {hidden.map((g, i) => (
                  <Fragment key={g.key}>
                    {i > 0 && g.sep && <Sep />}
                    <div className="docs-tb-group">{g.content}</div>
                  </Fragment>
                ))}
              </div>
            </DropdownPanel>
          </>
        )}
      </div>
      <div ref={rightRef} className="docs-tb-right">
        {right(folded)}
      </div>
    </div>
  );
}
