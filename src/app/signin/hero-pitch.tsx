"use client";

import { useEffect, useState } from "react";

// The hero's pitch (signin/page.tsx): one line under the hero, big and bold,
// typed out on load, which underlines itself once it has typed in.
//
// The line reserves its full height before the first character types: the
// whole text renders at once, hidden, under the typed copy in the same grid
// cell. Typing then fills a box that never changes size, so the sign-in card
// below it never moves down the page.
//
// Reduced motion: the effect skips straight to the whole line shown (read
// once on mount — a user's OS setting, not something that changes
// mid-visit), still through a state update, never as a second, different
// initial render. Screen readers get the still line up front; the typed
// version is aria-hidden.

const CHAR_MS = 16; // one character per beat while the line types

export function HeroPitch({ text }: { text: string }) {
  // shown = characters of the text on screen.
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = window.setTimeout(() => {
        if (!cancelled) setShown(text.length);
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const typeChar = (c: number) => {
      if (cancelled) return;
      setShown(c);
      if (c < text.length) timer = window.setTimeout(() => typeChar(c + 1), CHAR_MS);
    };
    timer = window.setTimeout(() => typeChar(0), CHAR_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // text only actually changes across a fresh mount of the (server-rendered)
    // sign-in page, never from client-side state elsewhere on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const typed = shown === text.length;

  return (
    <>
      <p className="sr-only">{text}</p>
      <p
        aria-hidden
        className="mt-4 grid max-w-xl text-[length:clamp(1.15rem,4.4cqw,2rem)] leading-[1.15] font-bold text-balance text-ink"
      >
        {/* The sizer: the finished line, hidden. It holds the space the
            typed copy grows into, so nothing below moves. */}
        <span className="invisible col-start-1 row-start-1">
          {text}
          <span className="hero-caret" />
        </span>
        <span className="col-start-1 row-start-1">
          <span className={`hero-rule${typed ? " hero-rule-on" : ""}`}>{text.slice(0, shown)}</span>
          {!typed && <span className="hero-caret" />}
        </span>
      </p>
    </>
  );
}
