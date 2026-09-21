"use client";

import { useEffect, useRef, useState, type UIEvent } from "react";
import { CollaborationFrame } from "./deck/collaboration";
import { GraphFrame } from "./deck/graph";
import { NotesFullPageFrame } from "./deck/notes-full-page";
import { NotesInReaderFrame } from "./deck/notes-in-reader";
import { ReaderFrame } from "./deck/reader";

// The reader deck (signin/page.tsx): five screens of the app, each a drawn
// mock of the real UI with a looping CSS demo (deck/*.tsx), in a strip that
// snaps one screen at a time. Tabs above pick a screen, the caption under
// the strip changes with it, and the round buttons step through. A tab or
// a button animates scrollLeft itself: scrollTo with smooth behavior is
// unreliable on a snap container. A swipe or a wheel scroll updates the
// active tab from the strip's scroll position.

const GAP = 14; // px between frames, the strip's gap
const TRAVEL_MS = 420;
const FRAMES = [ReaderFrame, NotesFullPageFrame, NotesInReaderFrame, GraphFrame, CollaborationFrame];

// Ease the strip's scrollLeft to a target over TRAVEL_MS; answers the
// function that stops it, so a new call can cancel the one under way.
function animateScroll(el: HTMLDivElement, to: number, onDone: () => void): () => void {
  const from = el.scrollLeft;
  const t0 = performance.now();
  let handle = 0;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / TRAVEL_MS);
    const eased = 1 - Math.pow(1 - k, 3);
    el.scrollLeft = from + (to - from) * eased;
    if (k < 1) handle = requestAnimationFrame(step);
    else onDone();
  };
  handle = requestAnimationFrame(step);
  return () => cancelAnimationFrame(handle);
}

export function ReaderDeck({
  tabs,
  captions,
  prevLabel,
  nextLabel,
}: {
  tabs: string[];
  captions: string[];
  prevLabel: string;
  nextLabel: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Stops the scroll under way, if one is.
  const stop = useRef<(() => void) | null>(null);
  // While a tab or a button drives the scroll, onScroll leaves the tab alone.
  const driving = useRef(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => () => stop.current?.(), []);

  // A resize changes the frame width: put the strip back on its screen.
  useEffect(() => {
    const onResize = () => {
      const el = strip.current;
      if (el) el.scrollLeft = slide * (el.clientWidth + GAP);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [slide]);

  const go = (i: number) => {
    const el = strip.current;
    if (!el) return;
    const n = Math.max(0, Math.min(FRAMES.length - 1, i));
    setSlide(n);
    const to = n * (el.clientWidth + GAP);
    stop.current?.();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.scrollLeft = to;
      return;
    }
    driving.current = true;
    stop.current = animateScroll(el, to, () => {
      driving.current = false;
      stop.current = null;
    });
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    if (driving.current) return;
    const el = e.currentTarget;
    const n = Math.round(el.scrollLeft / (el.clientWidth + GAP));
    if (n !== slide) setSlide(n);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {tabs.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={i === slide}
            onClick={() => go(i)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
              i === slide ? "bg-clay/[0.18] text-[#f3c9a8] ring-1 ring-clay/50" : "text-sand-600 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rounded-3xl bg-gradient-to-b from-clay/35 via-white/10 to-transparent p-px shadow-[0_0_80px_-30px_rgba(217,138,82,0.45)]">
        <div className="rounded-[23px] bg-[rgba(28,23,18,0.9)] p-3.5 backdrop-blur-xl">
          <div
            ref={strip}
            onScroll={onScroll}
            className="si-deck-strip flex overflow-x-auto rounded-[14px]"
            style={{ gap: GAP }}
          >
            {FRAMES.map((Frame, i) => (
              <Frame key={i} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <p className="min-w-0 flex-1 text-xs leading-normal text-sand-600 text-pretty">{captions[slide]}</p>
            <button
              type="button"
              onClick={() => go(slide - 1)}
              aria-label={prevLabel}
              className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-ink hover:bg-white/[0.18]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go((slide + 1) % FRAMES.length)}
              aria-label={nextLabel}
              className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-clay text-[#1d1610] hover:brightness-110"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
