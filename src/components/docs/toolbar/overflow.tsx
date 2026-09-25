"use client";

import { Fragment, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreVertIcon } from "@/components/docs/icons";
import { DropdownPanel, keepFocus } from "@/components/docs/menu";
import { OPEN_MENU_EVENT, Sep, ToolbarEditor } from "@/components/docs/toolbar/controls";

// The toolbar's row (SPEC.md §29). When the controls do not fit, the right
// end's captions fold first — Extract to its symbol, then the mode's name —
// then whole groups move, right to left, into More (⋮). The row is one Tab
// stop: Left and Right move between controls, Escape goes back to the page.

export type ToolbarGroup = {
  key: string;
  /** A separator is drawn before the group (not before the first shown). */
  sep: boolean;
  content: ReactNode;
  /** The ids of the menus inside, for Search the menus. */
  menus?: string[];
};

/** The mode's name box, open and folded, and Extract folded (css/toolbar.css). */
const CAPTION_OPEN = 122;
const CAPTION_FOLDED = 26;
const UNITOS_FOLDED = 30;
/** More (⋮) with its margins. */
const MORE = 32;

function focusTarget(item: HTMLElement): HTMLElement | null {
  if (item.matches("button, input")) return item;
  return item.querySelector<HTMLElement>("input, button");
}

export function ToolbarRow({
  groups,
  right,
  label,
  moreLabel,
  onEscape,
}: {
  groups: ToolbarGroup[];
  /** The right end: the Unitos tools (in .docs-tb-unitos), the mode, and Hide the menus. */
  right: ReactNode;
  label: string;
  moreLabel: string;
  /** Escape on a control: the page takes the focus back. */
  onEscape: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const groupRefs = useRef(new Map<string, HTMLDivElement>());
  const widths = useRef(new Map<string, number>());
  const unitosOpen = useRef(0);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(groups.length);
  const [folded, setFolded] = useState<"extract" | "mode" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const count = groups.length;
  // The groups that just came back from the bubble fade in.
  const [lastShown, setLastShown] = useState(shown);
  const [enteredFrom, setEnteredFrom] = useState(shown);
  if (lastShown !== shown) {
    setLastShown(shown);
    setEnteredFrom(lastShown);
  }

  const fit = useCallback(() => {
    const bar = barRef.current;
    const rightEl = rightRef.current;
    if (!bar || !rightEl) return;
    for (const [key, el] of groupRefs.current) widths.current.set(key, el.offsetWidth);
    const style = getComputedStyle(bar);
    const inner = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
    // The right end without the boxes that fold (the name's width animates),
    // then with them open and folded.
    const caption = rightEl.querySelector<HTMLElement>(".docs-mode-caption");
    const unitos = rightEl.querySelector<HTMLElement>(".docs-tb-unitos");
    if (unitos && !rightEl.hasAttribute("data-folded")) unitosOpen.current = unitos.offsetWidth;
    const base = rightEl.offsetWidth + 4 - (caption?.offsetWidth ?? 0) - (unitos?.offsetWidth ?? 0);
    const rightOpen = base + (caption ? CAPTION_OPEN : 0) + (unitos ? unitosOpen.current : 0);
    const rightExtract = base + (caption ? CAPTION_OPEN : 0) + (unitos ? UNITOS_FOLDED : 0);
    const rightFolded = base + (caption ? CAPTION_FOLDED : 0) + (unitos ? UNITOS_FOLDED : 0);
    const list = groups.map((g) => widths.current.get(g.key) ?? 0);
    const total = list.reduce((a, b) => a + b, 0);
    const nextFolded = total <= inner - rightOpen ? null : total <= inner - rightExtract ? "extract" : "mode";
    let nextShown = count;
    const room = inner - rightFolded;
    if (total > room) {
      let used = 0;
      nextShown = 0;
      for (let i = 0; i < count; i++) {
        if (used + list[i] + MORE > room) break;
        used += list[i];
        nextShown = i + 1;
      }
    }
    setShown((s) => (s === nextShown ? s : nextShown));
    setFolded((f) => (f === nextFolded ? f : nextFolded));
  }, [groups, count]);
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

  // Search the menus opens a menu that sits in the bubble: the bubble
  // opens first, then the menu.
  const editor = useContext(ToolbarEditor);
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ id: string; again?: boolean }>).detail?.id;
      if (!id || (e as CustomEvent<{ again?: boolean }>).detail?.again) return;
      const index = groups.findIndex((g) => g.menus?.includes(id));
      if (index >= shown && !moreOpen) {
        setMoreOpen(true);
        window.setTimeout(() => dom.dispatchEvent(new CustomEvent(OPEN_MENU_EVENT, { detail: { id, again: true } })), 60);
      }
    };
    dom.addEventListener(OPEN_MENU_EVENT, onOpen);
    return () => dom.removeEventListener(OPEN_MENU_EVENT, onOpen);
  }, [editor, groups, shown, moreOpen]);

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
    // A field keeps its arrows for its own caret, until the caret is at the
    // end it moves toward.
    if (target instanceof HTMLInputElement && !target.readOnly) {
      const { selectionStart: start, selectionEnd: end, value } = target;
      const atEdge = e.key === "ArrowLeft" ? start === 0 && end === 0 : start === value.length && end === value.length;
      const all = start === 0 && end === value.length;
      if (!atEdge && !all) return;
    }
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
  const bubbleOpen = moreOpen && hidden.length > 0;
  return (
    <div
      ref={barRef}
      className="docs-toolbar"
      role="toolbar"
      aria-label={label}
      data-edit-control
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
            className={`docs-tb-group${i >= enteredFrom ? " docs-tb-group-in" : ""}`}
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
              data-tip={bubbleOpen ? undefined : moreLabel}
              aria-haspopup="true"
              aria-expanded={bubbleOpen}
              data-track="docs:more"
              data-tb-item
              onMouseDown={keepFocus}
              onClick={() => setMoreOpen((o) => !o)}
              className="docs-tb-btn"
            >
              <MoreVertIcon />
            </button>
            <DropdownPanel
              open={bubbleOpen}
              anchorRef={moreRef}
              onClose={() => setMoreOpen(false)}
              placement="below-right"
              className="docs-tb-bubble"
              label={moreLabel}
              keys={false}
            >
              <div className="docs-tb-bubble-row" role="toolbar" aria-label={moreLabel}>
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
      <div ref={rightRef} className="docs-tb-right" data-folded={folded ?? undefined}>
        {right}
      </div>
    </div>
  );
}
