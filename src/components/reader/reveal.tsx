"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { readingPositionKey } from "@/lib/reading-position";

// The first open of a freshly added document reveals the article as the
// reader scrolls, as if it were laid out in sequence (SPEC.md §6): a text
// block appears line by line, a figure, a table, or a page rises in. Whoever
// opens a document right after adding it sets the reveal flag
// (document-bar.tsx); the reader takes the flag on mount and reveals once.
// Reading mode only — not edit mode, not the transcript variant — and never
// over a reading position restore, a ?src, ?block, or ?link jump, or
// reduced motion. A revealed block stays revealed: the wrapper keeps no
// class and no style once its turn is over, so nothing animates again.

const REVEAL_STORE = "unitos-reveal";
// Between the starts of blocks visible together, in document order.
const STAGGER_MS = 110;
// A text block appears one line at a time: this long per line, this long at most.
const LINE_MS = 70;
const TEXT_MAX_MS = 1400;
// A figure, a table, or a page fades in and rises over this long.
const RISE_MS = 320;
// A block starts its turn this far below the pane's bottom edge.
const ROOT_MARGIN = "0px 0px 48px 0px";
// A block mounted this long after the reveal began (a re-parse, an inserted
// paragraph) shows at once.
const LATE_MS = 10_000;
// When a block's line height cannot be read, one line is this tall.
const FALLBACK_LINE_HEIGHT = 28;

export type RevealKind = "text" | "object";

type Item = {
  el: HTMLElement;
  id: string;
  order: number;
  kind: RevealKind;
  timer: number;
  onEnd: ((e: AnimationEvent) => void) | null;
};

export type RevealContext = {
  // Decided at mount, for the life of the mount.
  active: boolean;
  revealed: Set<string>;
  // Observe a block's wrapper until its turn; returns the cleanup.
  register: (el: HTMLElement, id: string, order: number, kind: RevealKind) => () => void;
  late: () => boolean;
  dispose: () => void;
};

function revealKey(documentId: string): string {
  return `${REVEAL_STORE}:${documentId}`;
}

/** Set the reveal flag: the next open of the document reveals it. */
export function setRevealFlag(documentId: string): void {
  try {
    sessionStorage.setItem(revealKey(documentId), "1");
  } catch {
    // storage unavailable: the document opens plainly
  }
}

function clearRevealFlag(documentId: string): void {
  try {
    sessionStorage.removeItem(revealKey(documentId));
  } catch {
    // storage unavailable: nothing to clear
  }
}

// The flag is set, motion is welcome, no jump is in the URL, and no reading
// position is about to restore (reader-interactions.tsx restores a stored
// one on mount: the reader is coming back, not opening).
function shouldReveal(documentId: string): boolean {
  try {
    if (sessionStorage.getItem(revealKey(documentId)) !== "1") return false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    const query = new URLSearchParams(window.location.search);
    if (query.get("src") || query.get("block") || query.get("link")) return false;
    if (sessionStorage.getItem(readingPositionKey(documentId))) return false;
    return true;
  } catch {
    return false;
  }
}

// No reveal: every block renders bare. Edit mode and the transcript use it.
export const inactiveReveal: RevealContext = {
  active: false,
  revealed: new Set(),
  register: () => () => {},
  late: () => true,
  dispose: () => {},
};

function createReveal(): RevealContext {
  const startedAt = performance.now();
  const revealed = new Set<string>();
  const items = new Map<Element, Item>();
  let observer: IntersectionObserver | null = null;
  // When the last scheduled block starts: the next one starts a stagger later.
  let chainAt = -Infinity;

  const finish = (item: Item) => {
    if (revealed.has(item.id)) return;
    revealed.add(item.id);
    clearTimeout(item.timer);
    if (item.onEnd) item.el.removeEventListener("animationend", item.onEnd);
    item.onEnd = null;
    item.el.classList.remove("reveal-wait", "reveal-lines", "reveal-rise");
    item.el.style.removeProperty("animation-duration");
    item.el.style.removeProperty("animation-delay");
    item.el.style.removeProperty("animation-timing-function");
  };

  // One line per step: the text appears line after line. The block's own
  // line height counts the lines (a heading's is tighter than a paragraph's).
  const start = (item: Item, delay: number) => {
    const { el, kind } = item;
    let duration = RISE_MS;
    if (kind === "text") {
      const block = el.firstElementChild;
      const style = block ? getComputedStyle(block) : null;
      let lineHeight = style ? parseFloat(style.lineHeight) : NaN;
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        const fontSize = style ? parseFloat(style.fontSize) : NaN;
        lineHeight = Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.5 : FALLBACK_LINE_HEIGHT;
      }
      const lines = Math.max(1, Math.round(el.getBoundingClientRect().height / lineHeight));
      duration = Math.min(LINE_MS * lines, TEXT_MAX_MS);
      el.style.animationTimingFunction = `steps(${lines}, end)`;
    }
    el.style.animationDuration = `${duration}ms`;
    el.style.animationDelay = `${delay}ms`;
    el.classList.add(kind === "text" ? "reveal-lines" : "reveal-rise");
    item.onEnd = (e: AnimationEvent) => {
      if (e.target === el) finish(item);
    };
    el.addEventListener("animationend", item.onEnd);
    // A missed animationend (the tab hidden, the element restyled) still ends the turn.
    item.timer = window.setTimeout(() => finish(item), delay + duration + 120);
  };

  // Blocks in view together take their turns in document order, one stagger
  // apart; a block scrolled into view later takes its turn at once.
  const onIntersect = (entries: IntersectionObserverEntry[]) => {
    const due: Item[] = [];
    for (const entry of entries) {
      const item = items.get(entry.target);
      if (!item || !entry.isIntersecting || revealed.has(item.id)) continue;
      observer?.unobserve(item.el);
      items.delete(item.el);
      due.push(item);
    }
    due.sort((a, b) => a.order - b.order);
    const now = performance.now();
    for (const item of due) {
      const at = Math.max(now, chainAt + STAGGER_MS);
      chainAt = at;
      start(item, at - now);
    }
  };

  return {
    active: true,
    revealed,
    late: () => performance.now() - startedAt > LATE_MS,
    register(el, id, order, kind) {
      const item: Item = { el, id, order, kind, timer: 0, onEnd: null };
      items.set(el, item);
      // The pane's scroll box is the root; the observer waits for the first block to find it.
      observer ??= new IntersectionObserver(onIntersect, {
        root: el.closest("[data-reader-root]"),
        rootMargin: ROOT_MARGIN,
      });
      observer.observe(el);
      return () => {
        items.delete(el);
        observer?.unobserve(el);
        clearTimeout(item.timer);
        if (item.onEnd) el.removeEventListener("animationend", item.onEnd);
      };
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      for (const item of items.values()) clearTimeout(item.timer);
      items.clear();
    },
  };
}

const subscribeNothing = () => () => {};

/** Whether this mount reveals, decided once. The flag clears either way. */
export function useReveal(documentId: string | undefined, enabled: boolean): RevealContext {
  // False while hydrating a full page load: the article is already painted,
  // so hiding it would flash. A client-side open renders fresh and starts
  // hidden from its first paint.
  const client = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const [reveal] = useState<RevealContext>(() =>
    client && enabled && documentId && shouldReveal(documentId) ? createReveal() : inactiveReveal,
  );
  useEffect(() => {
    if (documentId) clearRevealFlag(documentId);
  }, [documentId]);
  useEffect(() => () => reveal.dispose(), [reveal]);
  return reveal;
}

// One block's wrapper: a plain div with no padding, border, or overflow, so
// the block's margins collapse through it and the layout stays exactly the
// reading layout. It carries the waiting class until its turn, then the
// running animation, then nothing.
export function Reveal({
  reveal,
  id,
  order,
  kind,
  children,
}: {
  reveal: RevealContext;
  id: string;
  order: number;
  kind: RevealKind;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wait = reveal.active && !reveal.revealed.has(id) && !reveal.late();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !wait) return;
    return reveal.register(el, id, order, kind);
  }, [reveal, id, order, kind, wait]);
  if (!reveal.active) return <>{children}</>;
  return (
    <div ref={ref} className={wait ? "reveal-wait" : undefined}>
      {children}
    </div>
  );
}
