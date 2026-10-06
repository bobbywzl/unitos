"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, type RefObject } from "react";
import { ANNOTATION_PARAM } from "@/lib/annotation-reference";

// A jump's address parameters (?src, ?block, ?link, ?annotation) say where
// the reader asked to land. Once the reader moves on from there — a wheel,
// a touch drag, a scrolling key — the address drops them, so a reload opens
// the document at the reading position, not back at the jump (SPEC.md §6).
// Past JUMP_HOLD_MS the jump has landed or given up, and they drop as well.

const JUMP_PARAMS = ["src", "block", "link", ANNOTATION_PARAM];
const JUMP_HOLD_MS = 30_000;
const SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "]);

/** `panes`: the reading panes; a wheel or a drag there is the reader moving on. */
export function useJumpParamCleanup(panes: RefObject<HTMLElement | null>): void {
  const searchParams = useSearchParams();
  const jumping = JUMP_PARAMS.some((k) => searchParams.has(k));
  useEffect(() => {
    if (!jumping) return;
    let done = false;
    const drop = () => {
      if (done) return;
      done = true;
      stop();
      const url = new URL(window.location.href);
      let changed = false;
      for (const k of JUMP_PARAMS) {
        if (url.searchParams.has(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      }
      if (changed) window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    };
    const onMove = (e: Event) => {
      if (panes.current?.contains(e.target as Node)) drop();
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (SCROLL_KEYS.has(e.key)) drop();
    };
    const timer = setTimeout(drop, JUMP_HOLD_MS);
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("wheel", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("keydown", onKey);
    };
    window.addEventListener("wheel", onMove, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("keydown", onKey);
    return stop;
  }, [jumping, searchParams, panes]);
}
