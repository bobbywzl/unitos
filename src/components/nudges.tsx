"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";
import { readAccountCookie } from "@/lib/tab-account";

// The nudges after the welcome splash — the onboarding feature look: the next
// thing to try glows (a pulsing clay ring, globals.css .nudge-glow) and one
// small translucent caption beside it says in a few words what it does. One
// nudge at a time. Each ends when its target is pressed (or its own end
// condition holds) or its ✕ is pressed; the next shows when its target is on
// screen. localStorage keeps the position, so the sequence survives the
// navigation between the dashboard and a project. Only the welcome splash
// starts it (startNudges), for the account it welcomed: the position is
// stored with that account's id, and a nudge shows only while the signed-in
// account (the account cookie) is that one — another account on the same
// browser, or an account that never had the welcome, sees none. A position
// stored without an account, from before this rule, counts as none.
//
// The order: New project on the dashboard → + after the first document →
// select a passage → the side panel → Extract → hold a note over
// the note below it until the ring closes, and the two join (a ghost card
// slides onto the next note, the ring draws, and the ghost falls in) → hold
// the first note and drag it onto the article (a ghost card slides out to
// show the move) → the four arrows that open the notes full page → a
// section's title, which opens its board → More, where Settings live → Link
// Google Drive on the settings page. A target carries data-nudge="<id>", or
// several ids with spaces between when two steps share it.

const NUDGE_KEY = "unitos-nudge-step";
// The account the sequence belongs to: the one the welcome splash started
// it for.
const NUDGE_ACCOUNT_KEY = "unitos-nudge-account";
// The steps Jev found the reader has already done (/api/jev/nudges, SPEC.md
// §6), kept for the tab: those steps skip.
const KNOWN_KEY = "unitos-nudge-known";

type Step = {
  id: string;
  textKey: TKey;
  // Set: a later step may show while this step's target is absent — opening
  // an existing project skips the dashboard's step; a transcript has no
  // article to select in and no Extract. Unset: the sequence waits for the
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
  // A ghost card plays the gesture: "float" slides out of the target's card
  // toward the article; "merge" slides onto the note below the target, the
  // ring draws around that note, and the ghost falls in.
  ghost?: "float" | "merge";
  // Set: the step also needs this of its target, else the target counts as
  // absent — the merge step needs a note below the target to merge into.
  present?: (el: HTMLElement) => boolean;
};

/** The note card below a note card in its list, or null: the merge ghost's
    landing. The cards sit in the board's item wrappers (sortable.tsx). */
function nextNoteCard(el: HTMLElement): HTMLElement | null {
  const wrapper = el.closest("[data-sortable-id]");
  return wrapper?.nextElementSibling?.querySelector<HTMLElement>("[data-note-id]") ?? null;
}

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
    // The first note of the tray is the target; the ghost slides onto the
    // note below it. One note alone has nothing to merge into, so this skips.
    id: "merge",
    textKey: "works.nudgeMerge",
    skip: true,
    glow: "target",
    side: "below",
    ghost: "merge",
    present: (el) => nextNoteCard(el) !== null,
    // Done when a hold ring draws or a merge lands: the hold is the merge,
    // and the note blooms as it takes the other in (SPEC.md §6).
    doneWhen: () =>
      document.querySelector(".merge-ring, .merge-fall, .note-absorb, .note-merging") !== null,
  },
  {
    id: "float",
    textKey: "works.nudgeFloat",
    glow: "target",
    side: "below",
    ghost: "float",
    doneWhen: () => document.querySelector("[data-note-floating]") !== null,
  },
  // The notes full page (SPEC.md §6): the four arrows in the tray open it,
  // and there a section's title opens its board. Both skip: a reader who
  // stays in the tray is not held here.
  { id: "fullPage", textKey: "works.nudgeFullPage", skip: true, glow: "target", side: "below" },
  { id: "board", textKey: "works.nudgeBoard", skip: true, glow: "target", side: "below" },
  // Google Drive (SPEC.md §14): More carries Settings, and the settings page
  // carries Link Google Drive. Both skip — a reader who never opens Settings
  // is not held there.
  { id: "settings", textKey: "works.nudgeSettings", skip: true, glow: "target", side: "rail" },
  { id: "drive", textKey: "works.nudgeDrive", skip: true, glow: "target", side: "below" },
];

const GLOW_CLASS = "nudge-glow";

/** Start the sequence for the account the welcome splash showed to. */
export function startNudges(accountId: string) {
  try {
    localStorage.setItem(NUDGE_ACCOUNT_KEY, accountId);
    localStorage.setItem(NUDGE_KEY, "0");
  } catch {
    // storage unavailable: no nudges
  }
}

function readStep(): number | null {
  try {
    // The sequence is the welcomed account's alone.
    const owner = localStorage.getItem(NUDGE_ACCOUNT_KEY);
    if (!owner) return null;
    const current = readAccountCookie();
    if (current && current !== owner) return null;
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
  return document.querySelector<HTMLElement>(`[data-nudge~="${STEPS[index].id}"]`);
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

/** The step on screen: its target's box, and for the merge ghost the box of
    the note it lands on. */
type Shown = { index: number; rect: DOMRect; to: DOMRect | null };

export function Nudges() {
  const t = useT();
  const [shown, setShown] = useState<Shown | null>(null);
  const shownRef = useRef<Shown | null>(null);
  const glowRef = useRef<HTMLElement | null>(null);
  const measureRef = useRef<() => void>(() => {});
  // The step ids the reader has already earned, from Jev; empty until the
  // answer lands, and empty for good without a key.
  const knownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (readStep() === null) return;
    try {
      const cached = sessionStorage.getItem(KNOWN_KEY);
      if (cached) {
        knownRef.current = new Set(JSON.parse(cached) as string[]);
        measureRef.current();
        return;
      }
    } catch {
      // storage unavailable: ask every time
    }
    const controller = new AbortController();
    fetch("/api/jev/nudges", { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<{ done?: unknown }>) : null))
      .then((data) => {
        if (controller.signal.aborted || !data) return;
        const done = Array.isArray(data.done) ? data.done.filter((id): id is string => typeof id === "string") : [];
        knownRef.current = new Set(done);
        try {
          sessionStorage.setItem(KNOWN_KEY, JSON.stringify(done));
        } catch {
          // storage unavailable
        }
        measureRef.current();
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

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
      const stored = readStep();
      if (stored === null || document.querySelector("[data-nudge-pause]")) {
        hide();
        return;
      }
      // A step the reader has already done (knownRef) is passed over.
      const known = knownRef.current;
      let step = stored;
      while (step < STEPS.length && known.has(STEPS[step].id)) step++;
      if (step !== stored) writeStep(step);
      for (let i = step; i < STEPS.length; i++) {
        const def = STEPS[i];
        if (known.has(def.id)) continue;
        if (def.doneWhen?.()) {
          writeStep(i + 1);
          hide();
          measure();
          return;
        }
        const el = targetOf(i);
        const frame = el ? frameOf(i, el) : null;
        const rect = frame?.getBoundingClientRect() ?? null;
        if (
          !el ||
          !frame ||
          !rect ||
          (rect.width === 0 && rect.height === 0) ||
          (def.present && !def.present(el))
        ) {
          // Absent, or hidden at this width.
          if (def.skip) continue;
          hide();
          return;
        }
        if (i !== step) writeStep(i);
        glow(def.glow === "target" ? frame : null);
        const to = def.ghost === "merge" ? (nextNoteCard(el)?.getBoundingClientRect() ?? null) : null;
        const prev = shownRef.current;
        if (
          prev &&
          prev.index === i &&
          sameRect(prev.rect, rect) &&
          (prev.to === null) === (to === null) &&
          (!prev.to || !to || sameRect(prev.to, to))
        ) {
          return;
        }
        shownRef.current = { index: i, rect, to };
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
  // Beside a target near the foot of the window — the rail's More button — the
  // caption would run off the bottom. It rides up to stay whole on screen, and
  // its tip stays on the target's row.
  const besideTop = Math.max(12, Math.min(r.top + 20, window.innerHeight - 130));
  const style =
    side === "below"
      ? { top: r.bottom + 14, left: centerX, transform: "translateX(-50%)" }
      : side === "above"
        ? { top: r.top - 14, left: centerX, transform: "translate(-50%, -100%)" }
        : side === "pane"
          ? { top: r.bottom - 24, left: centerX, transform: "translate(-50%, -100%)" }
          : { top: besideTop, left: r.left - 14, transform: "translateX(-100%)" };
  const tip =
    side === "below"
      ? "-top-1.5 left-1/2 -translate-x-1/2"
      : side === "above"
        ? "-bottom-1.5 left-1/2 -translate-x-1/2"
        : side === "left"
          ? "-right-1.5"
          : null;
  // The left tip sits on the target's middle, inside the caption's own box.
  const tipStyle =
    side === "left"
      ? { top: Math.max(14, Math.min(r.top + r.height / 2 - besideTop, 96)) }
      : undefined;

  function dismiss() {
    if (!shownRef.current) return;
    writeStep(shownRef.current.index + 1);
    shownRef.current = null;
    setShown(null);
    measureRef.current();
  }

  return (
    <>
      {def.ghost === "float" && (
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
      {def.ghost === "merge" && shown.to && (
        // The merge ghost: a copy of the note card's shape lifts, slides onto
        // the note below, draws back while the ring draws around that note,
        // and falls in — the hold it stands for (globals.css .nudge-ghost-merge,
        // .nudge-ring), on a loop.
        <>
          <div
            aria-hidden
            key={`ghost-${shown.index}`}
            style={
              {
                top: r.top,
                left: r.left,
                width: r.width,
                height: Math.max(64, Math.min(r.height, 120)),
                "--ghost-dx": `${Math.round(shown.to.left - r.left)}px`,
                "--ghost-dy": `${Math.round(shown.to.top - r.top)}px`,
              } as React.CSSProperties
            }
            className="nudge-ghost-merge pointer-events-none fixed z-[59] flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-clay bg-card/80 p-3.5 shadow-float backdrop-blur-sm print:hidden"
          >
            <span className="h-2 w-1/3 rounded-full bg-clay-300" />
            <span className="h-2 w-5/6 rounded-full bg-sand-300" />
            <span className="h-2 w-2/3 rounded-full bg-sand-300" />
          </div>
          <svg
            aria-hidden
            key={`ring-${shown.index}`}
            className="nudge-ring pointer-events-none fixed z-[58] print:hidden"
            style={{
              left: Math.round(shown.to.left) - 3,
              top: Math.round(shown.to.top) - 3,
              width: Math.round(shown.to.width) + 6,
              height: Math.round(shown.to.height) + 6,
            }}
          >
            <rect
              x="1.5"
              y="1.5"
              width={Math.round(shown.to.width) + 3}
              height={Math.round(shown.to.height) + 3}
              rx="17"
              pathLength={1}
            />
          </svg>
        </>
      )}
      <div key={shown.index} style={style} className="fixed z-[60] print:hidden">
        <div
          role="status"
          className={`pop-in relative flex w-[280px] max-w-[calc(100vw-24px)] items-start gap-2 rounded-2xl border border-line bg-card/85 px-4 py-3 text-[12.5px] leading-relaxed text-sand-800 shadow-float backdrop-blur-md ${
            def.glow === "caption" ? GLOW_CLASS : ""
          }`}
        >
          {tip && (
            <span aria-hidden style={tipStyle} className={`absolute size-3 rotate-45 bg-card/85 ${tip}`} />
          )}
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
