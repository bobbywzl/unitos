"use client";

import { useEffect, useState } from "react";

// The hero's pitch (signin/page.tsx): what Unitos does, typed out on load —
// a lead line, three rows that each land a "Done" stamp the moment their last
// character types in, then the closer, larger, which underlines itself as the
// take-away.
//
// The block reserves its full height before the first character types: every
// row renders its whole text at once, hidden, under the typed copy in the
// same grid cell. Typing then fills a box that never changes size, so the
// sign-in card below it never moves down the page.
//
// Reduced motion: the effect skips straight to every row and stamp shown at
// once (read once on mount — a user's OS setting, not something that changes
// mid-visit), still through a state update, never as a second, different
// initial render. Screen readers get one still paragraph up front; the typed
// version is aria-hidden.

const CHAR_MS = 16; // one character per beat while a row types
const STAMP_DELAY_MS = 180; // pause after the row's last character before the stamp lands
const ROW_GAP_MS = 500; // pause after a row (its stamp, if any) before the next starts

export type PitchRow = {
  text: string;
  /** The row lands a Done stamp, right after its last word. */
  done: boolean;
  /** The closing line: larger, and it underlines itself once it has typed in. */
  close?: boolean;
};

export function HeroPitch({ rows, doneLabel }: { rows: PitchRow[]; doneLabel: string }) {
  // shown[r] = characters of row r's text on screen; stamped[r] = its Done
  // stamp has landed. typing = the row currently being typed, for the caret;
  // -1 once the whole pitch is done.
  const [shown, setShown] = useState<number[]>(() => rows.map(() => 0));
  const [stamped, setStamped] = useState<boolean[]>(() => rows.map(() => false));
  const [typing, setTyping] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setShown(rows.map((r) => r.text.length));
        setStamped(rows.map((r) => r.done));
        setTyping(-1);
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    const typeChar = (r: number, c: number) => {
      if (cancelled) return;
      setTyping(r);
      setShown((prev) => prev.map((v, i) => (i === r ? c : v)));
      if (c < rows[r].text.length) {
        timer = window.setTimeout(() => typeChar(r, c + 1), CHAR_MS);
        return;
      }
      const advance = () => {
        if (cancelled) return;
        if (r + 1 < rows.length) typeChar(r + 1, 0);
        else setTyping(-1);
      };
      if (rows[r].done) {
        timer = window.setTimeout(() => {
          if (cancelled) return;
          setStamped((prev) => prev.map((v, i) => (i === r ? true : v)));
          timer = window.setTimeout(advance, ROW_GAP_MS);
        }, STAMP_DELAY_MS);
      } else {
        timer = window.setTimeout(advance, ROW_GAP_MS);
      }
    };
    timer = window.setTimeout(() => typeChar(0, 0), CHAR_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // rows only actually changes across a fresh mount of the (server-rendered)
    // sign-in page, never from client-side state elsewhere on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The stamp sits in the text's own flow, right after the last word, so it
  // keeps the line instead of dropping to one of its own.
  const stamp = (visible: boolean) => (
    <span
      className={`${visible ? "hero-stamp " : ""}ml-2.5 inline-block rounded-md border-2 border-sage-500/80 px-2 py-0.5 align-[0.12em] text-[10px] font-bold tracking-[0.14em] whitespace-nowrap text-sage-500 uppercase sm:text-[11px]`}
    >
      {doneLabel}
    </span>
  );

  return (
    <>
      <p className="sr-only">
        {rows.map((r) => r.text + (r.done ? ` ${doneLabel}.` : "")).join(" ")}
      </p>
      <div aria-hidden className="mt-4 max-w-xl space-y-2">
        {rows.map((r, i) => {
          const text = r.text.slice(0, shown[i] ?? 0);
          const typed = (shown[i] ?? 0) === r.text.length;
          return (
            <p
              key={i}
              className={
                r.close
                  ? "grid pt-1 text-lg leading-snug font-semibold text-ink sm:text-xl"
                  : "grid text-[13.5px] leading-relaxed font-medium text-sand-800 sm:text-[15px]"
              }
            >
              {/* The sizer: the finished row, hidden. It holds the space the
                  typed copy grows into, so nothing below moves. */}
              <span className="invisible col-start-1 row-start-1">
                {r.text}
                <span className="hero-caret" />
                {r.done && stamp(false)}
              </span>
              <span className="col-start-1 row-start-1">
                <span className={r.close ? `hero-rule${typed ? " hero-rule-on" : ""}` : undefined}>
                  {text}
                </span>
                {typing === i && <span className="hero-caret" />}
                {r.done && stamped[i] && stamp(true)}
              </span>
            </p>
          );
        })}
      </div>
    </>
  );
}
