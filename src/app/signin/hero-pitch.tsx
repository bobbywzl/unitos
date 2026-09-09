"use client";

import { useEffect, useState } from "react";

// The hero's pitch (signin/page.tsx): what Unitos does, typed out on load —
// three rows, each landing a "Done" stamp the moment its last character
// types in, then a fourth line, the closer, larger and un-stamped, as the
// take-away. Every row starts empty, on the server and on the first client
// render alike, so there is no flash of the full text before typing starts;
// the effect below is what fills it in.
//
// Reduced motion: the effect skips straight to every row and stamp shown at
// once (read once on mount — a user's OS setting, not something that changes
// mid-visit), still through a state update, never as a second, different
// initial render. Screen readers get one still paragraph up front; the typed
// version is aria-hidden.

const CHAR_MS = 16; // one character per beat while a row types
const STAMP_DELAY_MS = 180; // pause after the row's last character before the stamp lands
const ROW_GAP_MS = 500; // pause after a row (its stamp, if any) before the next starts

export type PitchRow = { text: string; done: boolean };

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

  return (
    <>
      <p className="sr-only">
        {rows.map((r) => r.text + (r.done ? ` ${doneLabel}.` : "")).join(" ")}
      </p>
      <div aria-hidden className="mt-5 max-w-xl space-y-2.5">
        {rows.map((r, i) => {
          const text = r.text.slice(0, shown[i] ?? 0);
          if (!text) return null;
          const isClose = !r.done;
          return (
            <p
              key={i}
              className={
                isClose
                  ? "flex flex-wrap items-baseline gap-2 pt-1 text-xl leading-snug font-semibold text-ink sm:text-2xl"
                  : "flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base leading-relaxed font-medium text-sand-800 sm:text-lg"
              }
            >
              <span>
                {text}
                {typing === i && <span className="hero-caret" />}
              </span>
              {r.done && stamped[i] && (
                <span className="hero-stamp shrink-0 rounded-md border-2 border-sage-500/80 px-2 py-0.5 text-[11px] font-bold tracking-[0.14em] text-sage-500 uppercase sm:text-xs">
                  {doneLabel}
                </span>
              )}
            </p>
          );
        })}
      </div>
    </>
  );
}
