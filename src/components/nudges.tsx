"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The nudges after the welcome splash — the onboarding feature look: the next
// thing to try glows (a pulsing clay ring, globals.css .nudge-glow) and one
// small translucent caption beside it says in a few words what it does. One
// nudge at a time. Each ends when its target is pressed (or its own end
// condition holds) or its ✕ is pressed; the next shows when its target is on
// screen. localStorage keeps the position, so the sequence survives the
// navigation between the dashboard and a project. Only the welcome splash
// starts it (startNudges); accounts that saw the old welcome never see nudges.
//
// The order: New project on the dashboard → + after the first document →
// select a passage → the side panel → Distill and Extract → drag the first
// note out of the tray (a ghost card slides out to show the move).

const NUDGE_KEY = "unitos-nudge-step";

type Step = {
  id: string;
  textKey: TKey;
  // Set: a later step may show while this step's target is absent — opening
  // an existing project skips the dashboard's step; a transcript has no
  // article to select in and no Distill. Unset: the sequence waits for the
  // target — the + waits for the first document, the note waits for a note.
  skip?: boolean;
  // Set: the step ends when this holds (checked on every measure). Unset:
  // the step ends when the target is pressed.
  doneWhen?: () => boolean;
  // Where the glow goes: on the target, or on the caption itself when the
  // target is the whole article.
  glow: "target" | "caption";
  // Where the caption sits. "pane": at the bottom of the target's pane,
  // centered — the article step, where a caption on the text would cover it.
  side: "below" | "pane" | "rail";
  // The float step: a ghost card slides out of the target's card.
  ghost?: boolean;
};

// Targets carry data-nudge="<id>". Order: the dashboard first, then the project.
const STEPS: Step[] = [
  { id: "project", textKey: "works.nudgeProject", skip: true, glow: "target", side: "below" },
  { id: "document", textKey: "works.nudgeDocument", glow: "target", side: "below" },
  {
    id: "select",
    textKey: "works.nudgeSelect",
    skip: true,
    glow: "caption",
    side: "pane",
    doneWhen: () => document.querySelector('[data-track-surface="ai-toolbar"]') !== null,
  },
  { id: "rail", textKey: "works.nudgeRail", glow: "target", side: "rail" },
  { id: "tools", textKey: "works.nudgeTools", skip: true, glow: "target", side: "below" },
  {
    id: "float",
    textKey: "works.nudgeFloat",
    glow: "target",
    side: "below",
    ghost: true,
    doneWhen: () => document.querySelector("[data-note-floating]") !== null,
  },
];

const GLOW_CLASS = "nudge-glow";

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

// The frame a step measures: the float step's whole note card, not its
// header row; the select step's reader pane, not the article inside it.
function frameOf(index: number, el: HTMLElement): HTMLElement {
  const def = STEPS[index];
  if (def.ghost) return el.closest<HTMLElement>("[data-note-id]") ?? el;
  if (def.side === "pane") return el.closest<HTMLElement>('[data-track-surface="reader"]') ?? el;
  return el;
}

function sameRect(a: DOMRect, b: DOMRect): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

type Shown = { index: number; rect: DOMRect };

export function Nudges() {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const glowRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const glow = (el: HTMLElement | null) => {
      if (glowRef.current === el) return;
      glowRef.current?.classList.remove(GLOW_CLASS);
      el?.classList.add(GLOW_CLASS);
      glowRef.current = el;
    };
    const hide = () => {
      glow(null);
      if (!shownRef.current) return;
      shownRef.current = null;
      setShown(null);
    };
    // The current step, or the first later step whose target is on screen
    // past steps marked skip. A modal (data-nudge-pause) hides the nudge
    // without advancing it.
    const measure = () => {
      const step = readStep();
      if (step === null || document.querySelector("[data-nudge-pause]")) {
        hide();
        return;
      }
      for (let i = step; i < STEPS.length; i++) {
        const def = STEPS[i];
        if (def.doneWhen?.()) {
          writeStep(i + 1);
          hide();
          measure();
          return;
        }
        const el = targetOf(i);
        const frame = el ? frameOf(i, el) : null;
        const rect = frame?.getBoundingClientRect() ?? null;
        if (!el || !frame || !rect || (rect.width === 0 && rect.height === 0)) {
          // Absent, or hidden at this width.
          if (def.skip) continue;
          hide();
          return;
        }
        if (i !== step) writeStep(i);
        glow(def.glow === "target" ? frame : null);
        const prev = shownRef.current;
        if (prev && prev.index === i && sameRect(prev.rect, rect)) return;
        shownRef.current = { index: i, rect };
        setShown(shownRef.current);
        return;
      }
      hide();
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
    // Pressing the target takes the nudge: the next one is due. A step with
    // its own end condition waits for that instead.
    const onClick = (e: MouseEvent) => {
      const current = shownRef.current;
      if (!current || STEPS[current.index].doneWhen) return;
      const el = targetOf(current.index);
      if (el && e.target instanceof Node && el.contains(e.target)) {
        writeStep(current.index + 1);
        hide();
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
      glow(null);
    };
  }, []);

  if (!shown) return null;
  const def = STEPS[shown.index];
  const r = shown.rect;
  const vw = window.innerWidth;
  // Below the target, centered; the side panel's rail (a column on the right)
  // gets the caption to its left, and the mobile bottom bar gets it above;
  // the article gets it at the bottom of its pane, centered. The placement
  // sits on an outer box: the caption's pop-in animation ends on
  // transform: none, so a transform on the caption itself would be undone.
  const side: "below" | "left" | "above" | "pane" =
    def.side === "below" ? "below" : def.side === "pane" ? "pane" : r.width > r.height ? "above" : "left";
  const centerX = Math.max(150, Math.min(r.left + r.width / 2, vw - 150));
  const style =
    side === "below"
      ? { top: r.bottom + 14, left: centerX, transform: "translateX(-50%)" }
      : side === "above"
        ? { top: r.top - 14, left: centerX, transform: "translate(-50%, -100%)" }
        : side === "pane"
          ? { top: r.bottom - 24, left: centerX, transform: "translate(-50%, -100%)" }
          : { top: r.top + 20, left: r.left - 14, transform: "translateX(-100%)" };
  const tip =
    side === "below"
      ? "-top-1.5 left-1/2 -translate-x-1/2"
      : side === "above"
        ? "-bottom-1.5 left-1/2 -translate-x-1/2"
        : side === "left"
          ? "top-5 -right-1.5"
          : null;

  function dismiss() {
    if (!shownRef.current) return;
    writeStep(shownRef.current.index + 1);
    shownRef.current = null;
    setShown(null);
    measureRef.current();
  }

  return (
    <>
      {def.ghost && (
        // The ghost: a translucent copy of the note card's shape that slides
        // out of the tray toward the article, on a loop (globals.css
        // .nudge-ghost). Decorative — the caption carries the words.
        <div
          aria-hidden
          key={`ghost-${shown.index}`}
          style={
            {
              top: r.top,
              left: r.left,
              width: r.width,
              height: Math.max(64, Math.min(r.height, 120)),
              "--ghost-dx": `${Math.round(r.width * 0.9 + 48)}px`,
            } as React.CSSProperties
          }
          className="nudge-ghost pointer-events-none fixed z-[59] flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-clay bg-card/70 p-3.5 shadow-float backdrop-blur-sm print:hidden"
        >
          <span className="h-2 w-1/3 rounded-full bg-clay-300" />
          <span className="h-2 w-5/6 rounded-full bg-sand-300" />
          <span className="h-2 w-2/3 rounded-full bg-sand-300" />
        </div>
      )}
      <div key={shown.index} style={style} className="fixed z-[60] print:hidden">
        <div
          role="status"
          className={`pop-in relative flex w-[280px] max-w-[calc(100vw-24px)] items-start gap-2 rounded-2xl border border-line bg-card/85 px-4 py-3 text-[12.5px] leading-relaxed text-sand-800 shadow-float backdrop-blur-md ${
            def.glow === "caption" ? GLOW_CLASS : ""
          }`}
        >
          {tip && <span aria-hidden className={`absolute size-3 rotate-45 bg-card/85 ${tip}`} />}
          <span className="relative flex-1">{t(def.textKey)}</span>
          <button
            onClick={dismiss}
            aria-label={t("works.nudgeDone")}
            data-tip={t("works.nudgeDone")}
            className="relative -mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>
      </div>
    </>
  );
}
