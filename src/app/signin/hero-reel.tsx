"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/lang-provider";

// The hero's reel: "Got a ___?" — the blank rolls through the kinds of
// document Unitos takes, one every 2 seconds, up like a slot-machine reel.
// The column holds every item and then the first again; the reel travels one
// row per beat, and once the repeated first row is showing it jumps back to
// row 0 with no transition, so the loop never rolls backward. Server-rendered
// and pre-mount: row 0, still. Reduced motion: the rows still change every
// beat, but cut instead of roll (.hero-reel-col in globals.css). Screen
// readers get one still sentence that lists every item.

const STEP_MS = 2000; // one item per beat
const TRAVEL_MS = 550; // one row's roll (.hero-reel-col in globals.css)

export function HeroReel({
  before,
  items,
  after,
}: {
  before: string;
  items: string[];
  after: string;
}) {
  const lang = useLang();
  const [row, setRow] = useState(0); // 0..items.length; the last row repeats the first
  const [snap, setSnap] = useState(false); // the jump back to row 0: no transition

  useEffect(() => {
    const n = items.length;
    if (n < 2) return;
    let stepTimer = 0;
    let snapTimer = 0;
    const tick = (next: number) => {
      stepTimer = window.setTimeout(() => {
        setSnap(false);
        setRow(next);
        if (next === n) {
          // The repeated first row is showing: after its roll, jump to row 0.
          snapTimer = window.setTimeout(() => {
            setSnap(true);
            setRow(0);
          }, TRAVEL_MS + 80);
          tick(1);
        } else tick(next + 1);
      }, STEP_MS);
    };
    tick(1);
    return () => {
      clearTimeout(stepTimer);
      clearTimeout(snapTimer);
    };
  }, [items.length]);

  const rows = [...items, items[0] ?? ""];
  const list = new Intl.ListFormat(lang, { type: "disjunction" }).format(items);
  return (
    <>
      <span className="sr-only">
        {before}
        {list}
        {after}
      </span>
      <span aria-hidden>
        {before}
        <span className="hero-reel-window text-clay">
          <span
            className={`hero-reel-col${snap ? " hero-reel-snap" : ""}`}
            style={{ transform: `translateY(${(-row * 100) / rows.length}%)` }}
          >
            {rows.map((item, i) => (
              <span key={i} className="block whitespace-nowrap">
                {item}
                {after}
              </span>
            ))}
          </span>
        </span>
      </span>
    </>
  );
}
