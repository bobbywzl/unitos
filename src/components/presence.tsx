"use client";

import { useEffect, useState, type ReactNode } from "react";

// Motion for things React mounts and unmounts. Entry animations are plain
// classes (pop-in, bubble-in, menu-in, dialog-in, content-in in globals.css);
// these two components cover the other half — leaving, and growing.
//
// Presence: wrap a conditional block. While `show` is true the children
// render as they are; when it flips false, the last children stay mounted for
// one exit animation (presence-exit-* in globals.css), inert, then leave. The
// wrapper is display: contents, so a child's absolute position and stacking
// never change. Reduced motion skips the wait.
//
// Collapse: a block that grows open and folds shut. Height animates through
// grid-template-rows (0fr ↔ 1fr), so nothing is measured and the content
// keeps its own size. Children mount on open (autoFocus fires) and unmount
// after the fold. The classes are folding-*: Tailwind owns `collapse`.

export type Exit = "fade" | "pop" | "bubble" | "menu" | "dialog" | "sheet";

const EXIT_MS: Record<Exit, number> = {
  fade: 180,
  pop: 140,
  bubble: 220,
  menu: 140,
  dialog: 200,
  sheet: 260,
};
const COLLAPSE_MS = 220;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Presence({
  show,
  exit = "fade",
  children,
}: {
  show: boolean;
  exit?: Exit;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(show);
  // The last shown children, kept for the leave: by then the caller renders
  // nothing. Adjust-during-render, same pattern as the flip below.
  const [kept, setKept] = useState<ReactNode>(children);
  if (show && kept !== children) setKept(children);
  // Adjust-during-render on the flip: mount at once; with reduced motion,
  // unmount at once too. The timer below handles the animated leave.
  const [prevShow, setPrevShow] = useState(show);
  if (prevShow !== show) {
    setPrevShow(show);
    if (show) setMounted(true);
    else if (reducedMotion()) setMounted(false);
  }
  useEffect(() => {
    if (show || !mounted) return;
    const timer = setTimeout(() => setMounted(false), EXIT_MS[exit]);
    return () => clearTimeout(timer);
  }, [show, mounted, exit]);
  if (!mounted) return null;
  const leaving = !show;
  return (
    <div
      className={`contents ${leaving ? `presence-exit presence-exit-${exit}` : ""}`}
      inert={leaving || undefined}
    >
      {leaving ? kept : children}
    </div>
  );
}

export function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [kept, setKept] = useState<ReactNode>(children);
  if (open && kept !== children) setKept(children);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setMounted(true);
    else setExpanded(false);
  }
  useEffect(() => {
    if (open && mounted && !expanded) {
      // The first frame renders closed; the next opens it, so the
      // transition has somewhere to go.
      const id = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(id);
    }
    if (!open && mounted) {
      const timer = setTimeout(() => setMounted(false), reducedMotion() ? 0 : COLLAPSE_MS);
      return () => clearTimeout(timer);
    }
  }, [open, mounted, expanded]);
  if (!mounted) return null;
  return (
    <div
      className={`folding ${expanded ? "folding-open" : ""} ${className ?? ""}`}
      inert={!open || undefined}
    >
      <div className="folding-inner">{open ? children : kept}</div>
    </div>
  );
}
