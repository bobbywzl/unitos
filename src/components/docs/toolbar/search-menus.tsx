"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { useT } from "@/components/lang-provider";
import { SearchIcon } from "@/components/docs/icons";
import { keys, withKeys } from "@/components/docs/keys";
import { keepFocus } from "@/components/docs/menu";

// Search the menus (SPEC.md §29): the way to everything Google Docs keeps
// in its menu bar. It finds every registered command (commands.ts) and
// every toolbar action by name, and values too ("font size 14", "zoom 150").

export type SearchAction = {
  id: string;
  label: string;
  /** The Google Docs menu it lives in. */
  where: string;
  keywords?: string[];
  /** The shortcut as printed ("Ctrl+B"). */
  shortcut?: string;
  icon?: ReactNode;
  run: () => void;
  enabled?: boolean;
};

/** Search the menus opens on this window event (Alt+/). */
export const SEARCH_MENUS_EVENT = "docs:search-menus";

function score(action: SearchAction, query: string): number {
  const label = action.label.toLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (label.includes(query)) return 60;
  const keywords = (action.keywords ?? []).map((k) => k.toLowerCase());
  if (keywords.some((k) => k.startsWith(query))) return 50;
  if (keywords.some((k) => k.includes(query))) return 40;
  const words = query.split(/\s+/).filter(Boolean);
  const hay = [label, ...keywords, action.where.toLowerCase()].join(" ").split(/[^\p{L}\p{N}]+/u);
  if (words.length > 0 && words.every((w) => hay.some((h) => h.startsWith(w)))) return 20;
  return 0;
}

/** The actions that match, best first. */
function searchActions(actions: SearchAction[], query: string): SearchAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return actions
    .map((a, i) => ({ a, i, s: score(a, q) }))
    .filter((r) => r.s > 0)
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .slice(0, 40)
    .map((r) => r.a);
}

export function SearchMenus({
  actions,
  valueActions,
  onDone,
}: {
  /** Every action, built when the search opens. */
  actions: () => SearchAction[];
  /** The actions a typed value asks for ("font size 14"). */
  valueActions: (query: string) => SearchAction[];
  /** The page takes the focus back. */
  onDone: () => void;
}) {
  const t = useT();
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState<SearchAction[]>([]);

  // A white field above 1600 px of window, a symbol button at and below.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1601px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  // The field takes the focus in the same task as the key that opened it,
  // so nothing typed right after Alt+/ reaches the page; and again in the
  // next frame, after a focus the page asked for before the key (the editor
  // focuses in the next frame), which the field lets pass meanwhile.
  const opening = useRef(false);
  const show = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    flushSync(() => {
      setAll(actionsRef.current());
      setRect({ left: Math.max(8, Math.min(r.left, window.innerWidth - 358)), top: r.top + (r.height - 28) / 2 });
      setQuery("");
      setActive(0);
      setOpen(true);
    });
    inputRef.current?.focus();
    opening.current = true;
    requestAnimationFrame(() => {
      opening.current = false;
      inputRef.current?.focus();
    });
  };
  const hide = (backToPage: boolean) => {
    if (!backToPage) {
      setOpen(false);
      setQuery("");
      return;
    }
    // The field leaves the page first; then the page takes the focus.
    flushSync(() => {
      setOpen(false);
      setQuery("");
    });
    onDone();
  };

  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(SEARCH_MENUS_EVENT, onOpen);
    return () => window.removeEventListener(SEARCH_MENUS_EVENT, onOpen);
  }, []);

  const results = open && query.trim() ? [...valueActions(query), ...searchActions(all, query)] : [];
  const run = (action: SearchAction | undefined) => {
    if (!action || action.enabled === false) return;
    hide(true);
    // The page has the focus back before the action runs, so a command
    // acts on the selection the reader left.
    window.setTimeout(() => action.run(), 0);
  };

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const field = (
    <input
      ref={inputRef}
      value={query}
      placeholder={t("docs.searchMenusFocused", { keys: keys("Alt+/") })}
      aria-label={t("docs.searchMenus")}
      role="combobox"
      aria-expanded={results.length > 0}
      aria-controls="docs-search-results"
      aria-activedescendant={results.length > 0 ? `docs-search-${active}` : undefined}
      className="docs-search-input"
      onChange={(e) => {
        setQuery(e.target.value);
        setActive(0);
      }}
      onBlur={() => !opening.current && hide(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => Math.min(results.length - 1, i + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          run(results[active]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          hide(true);
        }
      }}
    />
  );

  return (
    <>
      {wide ? (
        <div
          ref={anchorRef}
          className="docs-search"
          data-tip={withKeys(t("docs.searchMenus"), "Alt+/")}
          data-tb-item
          style={open ? { visibility: "hidden" } : undefined}
          onMouseDown={(e) => {
            e.preventDefault();
            show();
          }}
        >
          <SearchIcon size={20} />
          <input
            readOnly
            tabIndex={-1}
            aria-label={t("docs.searchMenus")}
            placeholder={t("docs.searchMenusPlaceholder")}
            className="docs-search-input"
            onFocus={() => show()}
          />
        </div>
      ) : (
        <div ref={anchorRef} className="docs-search-anchor">
          <button
            type="button"
            aria-label={t("docs.searchMenus")}
            data-tip={withKeys(t("docs.searchMenus"), "Alt+/")}
            data-track="docs:search-menus"
            data-tb-item
            onMouseDown={keepFocus}
            onClick={show}
            className="docs-tb-btn docs-search-btn"
          >
            <SearchIcon />
          </button>
        </div>
      )}
      {open &&
        rect &&
        createPortal(
          <div data-edit-control data-docs-menu>
            <div className="docs-search-open" data-results={query.trim() ? "" : undefined} style={{ left: rect.left, top: rect.top }}>
              <SearchIcon size={20} />
              {field}
            </div>
            {query.trim() && (
              <div
                ref={listRef}
                id="docs-search-results"
                role="listbox"
                className="docs-search-results"
                style={{ left: rect.left, top: rect.top + 28 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {results.length === 0 && <div className="docs-search-empty">{t("docs.noResults")}</div>}
                {results.map((a, i) => (
                  <button
                    key={`${a.id}-${i}`}
                    id={`docs-search-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={a.enabled === false || undefined}
                    data-index={i}
                    data-active={i === active ? "" : undefined}
                    tabIndex={-1}
                    className="docs-search-row"
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(a)}
                  >
                    {a.icon}
                    <span className="docs-search-label">{a.label}</span>
                    <span className="docs-search-where">{a.where}</span>
                    {a.shortcut && <span className="docs-search-keys">{a.shortcut}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
