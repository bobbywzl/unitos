"use client";

import type { KeyboardEvent } from "react";
import { focusWhenDrawn } from "@/lib/escape-layers";

// One key shape for every ⋯ and menu button (SPEC.md §6): Enter or Space
// opens the menu and puts the focus on its first row; ↓ and ↑ move between
// its rows (round the ends), Home and End go to the first and the last;
// Escape closes it and gives the focus back to the button (useEscapeLayer).
// The keys stop at the menu, so a list around it (the document list's own
// ↓ ↑) never takes them while a menu is open.

const ROWS = 'button:not([disabled]), a[href], [role="option"], [role="menuitem"]';

const shown = (el: HTMLElement) => el.getClientRects().length > 0;

function rowsOf(menu: Element | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>(ROWS) ?? [])].filter(shown);
}

/** The menu's keydown: ↓ ↑ Home End move between its rows. */
export function menuKeys(e: KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
  const rows = rowsOf(e.currentTarget);
  if (rows.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const last = rows.length - 1;
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowDown" ? (at < 0 || at === last ? 0 : at + 1) : at <= 0 ? last : at - 1;
  rows[next].focus();
}

/** The menu button's keydown: with its menu open, ↓ goes to the menu's
    first row and ↑ to its last. `menu` is the menu's selector. */
export function menuButtonKeys(e: KeyboardEvent<HTMLElement>, open: boolean, menu: string): void {
  if (!open || e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  const rows = rowsOf(document.querySelector(menu));
  if (rows.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  (e.key === "ArrowDown" ? rows[0] : rows[rows.length - 1]).focus();
}

/** A menu a key opened (a click with detail 0: Enter or Space) takes the
    focus on its first row once drawn; a pointer's press leaves it. */
export function focusMenuIfKey(e: { detail: number }, menu: string): void {
  if (e.detail === 0) focusWhenDrawn(`${menu} :is(${ROWS})`);
}
