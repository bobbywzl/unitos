"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The nudges after the welcome splash: one small floating caption at a time,
// pointed at the next thing to try — start a project, add an article, the ?
// guide, the sidebar. Each nudge ends when its target is pressed or its ✕ is
// pressed; the next shows when its target is on screen. localStorage keeps
// the position, so the sequence survives the navigation between the
// dashboard and a project. Only the welcome splash starts it (startNudges);
// accounts that saw the old welcome never see nudges.

const NUDGE_KEY = "unitos-nudge-step";

// Targets carry data-nudge="<id>". Order: the dashboard first, then the project.
const STEPS: { id: string; textKey: TKey }[] = [
  { id: "project", textKey: "works.nudgeProject" },
  { id: "document", textKey: "works.nudgeDocument" },
  { id: "guide", textKey: "works.nudgeGuide" },
  { id: "rail", textKey: "works.nudgeRail" },
];

export function startNudges() {
  try {
    localStorage.setItem(NUDGE_KEY, "0");
  } catch {
    // storage unavailable: no nudges
  }
}

function readStep(): number | null {
  try {
    const value = localStorage.getItem(NUDGE_KEY);
    if (value === null || value === "done") return null;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : null;
  } catch {
    return null;
  }
}

function writeStep(n: number) {
  try {
    localStorage.setItem(NUDGE_KEY, n >= STEPS.length ? "done" : String(n));
  } catch {
    // storage unavailable: the nudge returns next visit
  }
}

function targetOf(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-nudge="${STEPS[index].id}"]`);
}

type Shown = { index: number; rect: DOMRect };

export function Nudges() {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    // The current step, or the first later step whose target is on screen —
    // opening an existing project skips the dashboard's nudge.
    const measure = () => {
      const step = readStep();
      if (step === null) {
        shownRef.current = null;
        setShown(null);
        return;
      }
      for (let i = step; i < STEPS.length; i++) {
        const el = targetOf(i);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // hidden at this width
        if (i !== step) writeStep(i);
        const prev = shownRef.current;
        if (
          prev &&
          prev.index === i &&
          prev.rect.top === rect.top &&
          prev.rect.left === rect.left &&
          prev.rect.width === rect.width &&
          prev.rect.height === rect.height
        ) {
          return;
        }
        shownRef.current = { index: i, rect };
        setShown(shownRef.current);
        return;
      }
      shownRef.current = null;
      setShown(null);
    };
    measureRef.current = measure;
    // Targets appear and move with client-side navigation, so measure on a
    // timer as well as on resize and scroll.
    const interval = setInterval(measure, 600);
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    // Pressing the target takes the nudge: the next one is due.
    const onClick = (e: MouseEvent) => {
      const current = shownRef.current;
      if (!current) return;
      const el = targetOf(current.index);
      if (el && e.target instanceof Node && el.contains(e.target)) {
        writeStep(current.index + 1);
        shownRef.current = null;
        setShown(null);
      }
    };
    document.addEventListener("click", onClick, true);
    measure();
    return () => {
      clearInterval(interval);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  if (!shown) return null;
  const r = shown.rect;
  const vw = window.innerWidth;
  // Below the target, centered; the sidebar rail (a column on the right) gets
  // the bubble to its left, and the mobile bottom bar gets it above.
  const side: "below" | "left" | "above" =
    STEPS[shown.index].id !== "rail" ? "below" : r.width > r.height ? "above" : "left";
  const centerX = Math.max(150, Math.min(r.left + r.width / 2, vw - 150));
  const style =
    side === "below"
      ? { top: r.bottom + 14, left: centerX, transform: "translateX(-50%)" }
      : side === "above"
        ? { top: r.top - 14, left: centerX, transform: "translate(-50%, -100%)" }
        : { top: r.top + 20, left: r.left - 14, transform: "translateX(-100%)" };
  const tip =
    side === "below"
      ? "-top-1.5 left-1/2 -translate-x-1/2"
      : side === "above"
        ? "-bottom-1.5 left-1/2 -translate-x-1/2"
        : "top-5 -right-1.5";

  function dismiss() {
    if (!shownRef.current) return;
    writeStep(shownRef.current.index + 1);
    shownRef.current = null;
    setShown(null);
    measureRef.current();
  }

  return (
    <div
      key={shown.index}
      role="status"
      style={style}
      className="pop-in fixed z-[60] flex w-[280px] max-w-[calc(100vw-24px)] items-start gap-2 rounded-2xl bg-card px-4 py-3 text-[12.5px] leading-relaxed text-sand-800 shadow-float print:hidden"
    >
      <span aria-hidden className={`absolute size-3 rotate-45 bg-card ${tip}`} />
      <span className="relative flex-1">{t(STEPS[shown.index].textKey)}</span>
      <button
        onClick={dismiss}
        aria-label={t("works.nudgeDone")}
        title={t("works.nudgeDone")}
        className="relative -mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
      >
        ✕
      </button>
    </div>
  );
}
