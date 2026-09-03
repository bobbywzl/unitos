"use client";

import { useEffect, useState } from "react";

// One callout: text, chip position, dotted connector, and the dot on the
// exact spot in the screenshot. Positions are percent of the image; the array
// order is the tour order.
export type TourCallout = {
  text: string;
  chip: { left: string; top: string };
  alignRight?: boolean;
  line: { x1: number; y1: number; x2: number; y2: number };
  dot: { x: number; y: number };
};

const TRAVEL_MS = 620; // cursor glide before the click
const STEP_MS = 2600; // one function per beat; the last beat holds all lit

// The reader in motion: a cursor glides dot to dot and uses each function —
// click ripple on arrival, that function's callout fades in, used ones dim.
// After the last function every callout holds lit, then the loop restarts.
// Server-rendered, pre-mount, and prefers-reduced-motion state: every callout
// visible, no cursor.
export function ReaderShowcase({
  src,
  alt,
  callouts,
}: {
  src: string;
  alt: string;
  callouts: TourCallout[];
}) {
  const [step, setStep] = useState(-1); // -1 static · 0..n-1 touring · n hold-all
  const [arrived, setArrived] = useState(false);

  // One self-rescheduling timer chain: each beat sets the step, then flags
  // arrival after the glide. Every setState runs inside a timer callback.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const beats = callouts.length + 1;
    let stepTimer = 0;
    let arriveTimer = 0;
    const tick = (next: number, delay: number) => {
      stepTimer = window.setTimeout(() => {
        const s = next % beats;
        setStep(s);
        setArrived(false);
        arriveTimer = window.setTimeout(() => setArrived(true), TRAVEL_MS);
        tick(s + 1, STEP_MS);
      }, delay);
    };
    tick(0, 400);
    return () => {
      clearTimeout(stepTimer);
      clearTimeout(arriveTimer);
    };
  }, [callouts.length]);

  const touring = step >= 0 && step < callouts.length;
  const opacityOf = (i: number) => {
    if (!touring) return 1; // static or hold-all
    if (i < step) return 0.4; // used
    if (i === step) return arrived ? 1 : 0; // fades in on the click
    return 0; // not yet
  };
  const target = callouts[touring ? step : callouts.length - 1];
  const fade = { transition: "opacity 0.45s ease" };

  return (
    // @container: the chips size in cqw, so they keep their place on the
    // image at every width (page.tsx lays them out for a 630px-wide image).
    <div className="relative @container">
      <div className="overflow-hidden rounded-xl border border-white/10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="block w-full" />
      </div>

      {/* Dotted connectors */}
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 hidden h-full w-full sm:block"
      >
        {callouts.map((c, i) => (
          <line
            key={c.text}
            x1={c.line.x1}
            y1={c.line.y1}
            x2={c.line.x2}
            y2={c.line.y2}
            className="stroke-clay"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            style={{ opacity: opacityOf(i), ...fade }}
          />
        ))}
      </svg>

      {/* Dots on the exact spots */}
      {callouts.map((c, i) => (
        <span
          key={`dot-${c.text}`}
          aria-hidden
          className="absolute hidden size-2.5 rounded-full bg-clay shadow-[0_0_10px_rgba(217,138,82,0.9)] ring-2 ring-black/40 sm:block"
          style={{
            left: `${c.dot.x}%`,
            top: `${c.dot.y}%`,
            opacity: opacityOf(i),
            transform: `translate(-50%,-50%) scale(${touring && i === step && arrived ? 1.35 : 1})`,
            transition: "opacity 0.45s ease, transform 0.3s ease",
          }}
        />
      ))}

      {/* Callout chips */}
      {callouts.map((c, i) => (
        <span
          key={c.text}
          aria-hidden
          className="absolute hidden items-center gap-1.5 rounded-full bg-black/80 px-[clamp(7px,1.6cqw,11px)] py-[clamp(3px,0.63cqw,4.5px)] text-[clamp(8px,1.75cqw,12px)] leading-[1.4] font-semibold whitespace-nowrap text-white shadow-float ring-1 ring-white/25 sm:inline-flex"
          style={{
            left: c.chip.left,
            top: c.chip.top,
            opacity: opacityOf(i),
            transform: `${c.alignRight ? "translateX(-100%) " : ""}translateY(${opacityOf(i) === 0 ? 6 : 0}px)`,
            transition: "opacity 0.45s ease, transform 0.45s ease",
          }}
        >
          {c.text}
        </span>
      ))}

      {/* Click ripple at the dot, once per arrival */}
      {touring && arrived && (
        <span
          key={`ripple-${step}`}
          aria-hidden
          className="tour-ripple absolute hidden size-9 rounded-full border-2 border-clay sm:block"
          style={{ left: `${target.dot.x}%`, top: `${target.dot.y}%` }}
        />
      )}

      {/* The cursor */}
      {step >= 0 && (
        <span
          aria-hidden
          className="tour-cursor absolute hidden sm:block"
          style={{
            left: `${target.dot.x}%`,
            top: `${target.dot.y}%`,
            opacity: touring ? 1 : 0,
          }}
        >
          <span key={`click-${step}`} className="tour-click block">
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M5.5 3.2v16.2l4.1-3.9 2.5 5.6 2.7-1.2-2.5-5.5 5.6-.6L5.5 3.2Z"
                fill="#1a1611"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>
      )}
    </div>
  );
}
