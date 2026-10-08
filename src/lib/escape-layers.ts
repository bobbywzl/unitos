"use client";

import { useEffect, useRef } from "react";
import { isImeKey } from "@/lib/ime";

// One Escape closes one layer, the newest first (SPEC.md §6), across the
// whole page: the reader's toolbar and cards, the document list, History,
// and Contents. Each layer takes a number when it opens; Escape closes the
// open layer with the highest number and nothing else.
//
// A menu registers while it is open (useEscapeLayer). The reader keeps its
// own stack of layers and offers its newest one (addEscapeSource), numbered
// from the same counter, so a menu opened after a card closes first and a
// card opened after a menu closes first.
//
// A dialog (the guide, the add dialog) takes Escape in the capture phase and
// stops it there, so no layer under the dialog closes with it.
//
// Focus: a layer remembers the control that opened it. When the layer closes
// after a key (Escape, Enter on a row) and the focus fell to the page, the
// focus goes back to that control, so the next Tab goes on from there. A
// pointer close leaves the focus where the pointer put it.
//
// One focus trap for every dialog with aria-modal (installModalTrap, mounted
// once with the tooltip): Tab and Shift+Tab cycle inside the newest one that
// shows, and a focus that is outside it comes in on the first Tab. A dialog
// that wants the focus on open uses useModalFocus.

export type EscapeLayer = { seq: number; close: () => void };

let counter = 0;
/** The next layer's number: higher is newer. */
export function nextLayerSeq(): number {
  return ++counter;
}

const layers = new Set<EscapeLayer>();
const sources = new Set<() => EscapeLayer | null>();

// The last input: a key or a press. And the control it acted on, which is
// the opener of any layer that opens from it.
let lastInput: "key" | "pointer" = "pointer";
let acted: HTMLElement | null = null;
const FOCUSABLE =
  "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=''], [contenteditable='true']";

function noteKey() {
  lastInput = "key";
  const a = document.activeElement;
  acted = a instanceof HTMLElement && a !== document.body ? a : null;
}
function notePointer(e: PointerEvent) {
  lastInput = "pointer";
  const t = e.target instanceof Element ? e.target.closest<HTMLElement>(FOCUSABLE) : null;
  acted = t;
}
let tracking = false;
function track() {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  window.addEventListener("keydown", noteKey, true);
  window.addEventListener("pointerdown", notePointer, true);
}

/** The control that opened what is opening now: the one the last key or
    press acted on, else the focused one. */
export function captureOpener(): HTMLElement | null {
  track();
  if (acted?.isConnected) return acted;
  const a = document.activeElement;
  return a instanceof HTMLElement && a !== document.body ? a : null;
}

/** A layer closed: after a key, when the focus falls to the page (the
    focused row went with the layer), the focus goes back to the opener.
    A layer that folds away keeps its rows a moment, so this watches for
    RETURN_FRAMES frames; a focus the reader moves on in that time stays. */
const RETURN_FRAMES = 40;
export function returnFocus(opener: HTMLElement | null): void {
  if (!opener || lastInput !== "key") return;
  const was = document.activeElement;
  let frames = 0;
  const check = () => {
    const a = document.activeElement;
    const lost = !a || a === document.body || !a.isConnected;
    if (lost) {
      if (opener.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
      return;
    }
    if (a === was && ++frames < RETURN_FRAMES) requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || isImeKey(e)) return;
  let top: EscapeLayer | null = null;
  for (const layer of layers) if (!top || layer.seq > top.seq) top = layer;
  for (const source of sources) {
    const layer = source();
    if (layer && (!top || layer.seq > top.seq)) top = layer;
  }
  top?.close();
}

function listen() {
  window.addEventListener("keydown", onKeyDown);
}

/** Whether Escape has a layer to close now: a menu, a card, a toolbox. */
export function escapeLayerOpen(): boolean {
  if (layers.size > 0) return true;
  for (const source of sources) if (source()) return true;
  return false;
}
function unlisten() {
  if (layers.size + sources.size === 0) window.removeEventListener("keydown", onKeyDown);
}

/** Offer a stack's newest layer to Escape; null when it has none open. */
export function addEscapeSource(source: () => EscapeLayer | null): () => void {
  sources.add(source);
  listen();
  return () => {
    sources.delete(source);
    unlisten();
  };
}

/** A menu that Escape closes while it is open, as one layer. When it
    closes after a key, the focus goes back to the control that opened it. */
export function useEscapeLayer(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const opener = captureOpener();
    const layer: EscapeLayer = { seq: nextLayerSeq(), close: () => closeRef.current() };
    layers.add(layer);
    listen();
    return () => {
      layers.delete(layer);
      unlisten();
      returnFocus(opener);
    };
  }, [open]);
}

/** Focus the element the selector names once it is drawn: a fly-out or a
    panel takes a frame or two to show. Gives up after half a second. A list
    of selectors is tried in its order: the first one drawn takes the focus. */
export function focusWhenDrawn(selector: string | string[]): void {
  let frames = 30;
  const selectors = Array.isArray(selector) ? selector : [selector];
  const drawn = (s: string) => [...document.querySelectorAll<HTMLElement>(s)].find((e) => e.getClientRects().length > 0);
  const tryFocus = () => {
    let el: HTMLElement | undefined;
    for (const s of selectors) if (!el) el = drawn(s);
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    } else if (--frames > 0) requestAnimationFrame(tryFocus);
  };
  requestAnimationFrame(tryFocus);
}

// ── The modal focus trap ────────────────────────────────────────────────

const TABBABLE =
  "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=''], [contenteditable='true']";

function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !(el instanceof HTMLInputElement && el.type === "hidden") &&
      el.getClientRects().length > 0 &&
      el.closest("[inert], [aria-hidden='true']") === null,
  );
}

/** The newest dialog with aria-modal that shows: the last in the page. */
function topModal(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>("[aria-modal='true']");
  for (let i = all.length - 1; i >= 0; i--) if (all[i].getClientRects().length > 0) return all[i];
  return null;
}

function onTrapKey(e: KeyboardEvent) {
  if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
  const modal = topModal();
  if (!modal) return;
  const active = document.activeElement;
  // A menu or a list a control in the dialog opened, drawn outside it,
  // keeps its own Tab.
  if (active instanceof Element && !modal.contains(active) && active.closest("[role=menu], [role=listbox], [data-docs-menu]")) return;
  const items = tabbables(modal);
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) {
    e.preventDefault();
    if (modal.tabIndex < 0 && !modal.hasAttribute("tabindex")) modal.tabIndex = -1;
    modal.focus({ preventScroll: true });
    return;
  }
  const inside = active instanceof Node && modal.contains(active);
  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && (active === first || active === modal)) {
    e.preventDefault();
    last.focus();
  }
}

let trapping = false;
/** Tab stays inside the newest aria-modal dialog. Installed once per page. */
export function installModalTrap(): void {
  track();
  if (trapping || typeof window === "undefined") return;
  trapping = true;
  window.addEventListener("keydown", onTrapKey);
}

/** A dialog's focus: on open the focus moves into it ([data-autofocus],
    else its first control, else the dialog), unless it is in it already;
    on close it goes back to the control that opened it. A dialog that
    closes because it opened something (Blank document, Continue, a Library
    pick) sets `handedOff` first: the focus leaves the dialog for the page,
    and what opened takes it (a new blank document takes the caret). */
export function useModalFocus(
  ref: { current: HTMLElement | null },
  open: boolean,
  handedOff?: { current: boolean },
): void {
  useEffect(() => {
    if (!open) return;
    installModalTrap();
    const opener = captureOpener();
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      const target = box.querySelector<HTMLElement>("[data-autofocus]") ?? tabbables(box)[0] ?? box;
      if (target === box && !box.hasAttribute("tabindex")) box.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    return () => {
      if (handedOff?.current) {
        handedOff.current = false;
        const now = document.activeElement;
        if (now instanceof HTMLElement && box?.contains(now)) now.blur();
        return;
      }
      // A dialog's close otherwise gives the focus back, by key or by
      // press: its controls are gone with it.
      requestAnimationFrame(() => {
        const now = document.activeElement;
        // A dialog that fades out holds the focus until it is gone.
        const lost = !now || now === document.body || !now.isConnected || (box?.contains(now) ?? false);
        if (lost && opener?.isConnected && opener.getClientRects().length > 0) opener.focus({ preventScroll: true });
      });
    };
  }, [open, ref, handedOff]);
}
