"use client";

import { useCallback, useLayoutEffect, useState } from "react";

// The collapsed view of a list of cards — notes in the tray and on the notes
// full page, annotations in the Annotations tab. "collapsed", the default,
// folds every card to its one-line header: the id and a summary of the
// content. "expanded" shows every card whole, nothing clipped, nothing to
// scroll inside. One button switches the view (collapsed-view-toggle.tsx); a
// card's own chevron makes it the exception until the view switches again.
// Per browser, keyed by the caller (one key per project and per list), so the
// tray and the notes full page show the same.

export type CollapsedView = "collapsed" | "expanded";

type CollapsedState = { view: CollapsedView; exceptions: ReadonlySet<string> };

const DEFAULT_STATE: CollapsedState = { view: "collapsed", exceptions: new Set() };

function readState(key: string): CollapsedState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_STATE;
    const stored = JSON.parse(raw) as { view?: unknown; exceptions?: unknown };
    const view: CollapsedView = stored.view === "expanded" ? "expanded" : "collapsed";
    const exceptions = new Set(
      Array.isArray(stored.exceptions)
        ? stored.exceptions.filter((id): id is string => typeof id === "string")
        : [],
    );
    return { view, exceptions };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeState(key: string, state: CollapsedState) {
  try {
    localStorage.setItem(key, JSON.stringify({ view: state.view, exceptions: [...state.exceptions] }));
  } catch {
    // storage unavailable: the view lasts until the page reloads
  }
}

export type CollapsedViewModel = {
  view: CollapsedView;
  /** True when the card with this id shows as its one-line header. */
  isCollapsed: (id: string) => boolean;
  /** Fold or open one card, against the view. */
  toggle: (id: string) => void;
  /** Switch the view; every card follows. */
  setView: (view: CollapsedView) => void;
};

export function useCollapsedView(key: string): CollapsedViewModel {
  const [state, setState] = useState<CollapsedState>(DEFAULT_STATE);
  // Restored before the first paint, so a card never flashes from one state
  // to the other on load.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readState(key));
  }, [key]);
  const update = useCallback(
    (fn: (prev: CollapsedState) => CollapsedState) => {
      setState((prev) => {
        const next = fn(prev);
        writeState(key, next);
        return next;
      });
    },
    [key],
  );
  return {
    view: state.view,
    isCollapsed: (id) => (state.view === "collapsed") !== state.exceptions.has(id),
    toggle: (id) =>
      update((prev) => {
        const exceptions = new Set(prev.exceptions);
        if (exceptions.has(id)) exceptions.delete(id);
        else exceptions.add(id);
        return { ...prev, exceptions };
      }),
    setView: (view) => update(() => ({ view, exceptions: new Set() })),
  };
}
