"use client";

import { createContext, useEffect, useState, useSyncExternalStore } from "react";
import {
  CARD_DRAG_END,
  CARD_DRAG_OVER,
  CARD_DRAG_START,
  type CardDrag,
  type CardDragEndDetail,
  type CardDragOverDetail,
} from "@/lib/card-drag";

/** Whether a notes list is on screen: false while the reader cannot see it
    (the tray behind another tab, folded, or a phone's closed sheet). Its
    cards then count for nothing in useCardDropOpen, so no grip shows and no
    card head lifts while no note is on screen. A store, not a value: the
    list's cards read it when they count, and a switch of the rail's tabs
    draws no card again. */
export type ShownStore = { get: () => boolean; subscribe: (onChange: () => void) => () => void };

/** A store that says whether a notes list is on screen; `set` changes it. */
export function shownStore(initial: boolean): ShownStore & { set: (shown: boolean) => void } {
  let shown = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => shown,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => void listeners.delete(onChange);
    },
    set(next) {
      if (next === shown) return;
      shown = next;
      for (const listener of listeners) listener();
    },
  };
}

export const CardDropShown = createContext<ShownStore | null>(null);

/** A drop target for the card drag (lib/card-drag.ts). The element that
    renders `data-note-drop-target={id}` takes the drop; this says whether a
    card is being dragged at all (so the target can offer itself) and whether
    it is over this target, and runs onDrop when the card is released on it. */
export function useCardDropTarget(
  id: string,
  onDrop: (detail: CardDragEndDetail) => void,
  /** False while this card cannot take a drop — a viewer's card, a note that
      is not accepted yet. It then counts for nothing in useCardDropOpen. */
  enabled = true,
  /** Whether the card's list is on screen (CardDropShown); a card off
      screen counts for nothing either. */
  shown: ShownStore | null = null,
): { drag: CardDrag | null; over: boolean } {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const [over, setOver] = useState(false);

  // One more place an annotation can be dropped, for as long as this card is
  // on screen: the grips show while there is at least one.
  useEffect(() => {
    if (!enabled) return;
    let counted = false;
    const sync = () => {
      const now = shown ? shown.get() : true;
      if (now === counted) return;
      counted = now;
      openTargets += now ? 1 : -1;
      announceTargets();
    };
    sync();
    const off = shown?.subscribe(sync);
    return () => {
      off?.();
      if (!counted) return;
      openTargets -= 1;
      announceTargets();
    };
  }, [enabled, shown]);

  useEffect(() => {
    const onStart = (e: Event) => {
      setDrag((e as CustomEvent<{ drag: CardDrag }>).detail.drag);
      setOver(false);
    };
    const onOver = (e: Event) => {
      const detail = (e as CustomEvent<CardDragOverDetail>).detail;
      setOver(detail.targetId === id);
    };
    const onEnd = (e: Event) => {
      const detail = (e as CustomEvent<CardDragEndDetail>).detail;
      setDrag(null);
      setOver(false);
      if (detail.targetId === id) onDrop(detail);
    };
    window.addEventListener(CARD_DRAG_START, onStart);
    window.addEventListener(CARD_DRAG_OVER, onOver);
    window.addEventListener(CARD_DRAG_END, onEnd);
    return () => {
      window.removeEventListener(CARD_DRAG_START, onStart);
      window.removeEventListener(CARD_DRAG_OVER, onOver);
      window.removeEventListener(CARD_DRAG_END, onEnd);
    };
    // onDrop is read on the event; a fresh closure every render is fine.
  });

  return { drag, over };
}

/** How many cards can take a drop right now: every note card of the tray that
    is the reader's to edit, and the floating card while it is open
    (lib/card-drag.ts). A grip shows while there is at least one — with none
    there is nowhere to drop, and the grip would be a gesture that goes
    nowhere. The count is kept here, outside React, so a card that mounts
    later reads it without asking the DOM. */
let openTargets = 0;
const openListeners = new Set<() => void>();
function announceTargets() {
  for (const listener of openListeners) listener();
}

export function useCardDropOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      openListeners.add(onChange);
      return () => void openListeners.delete(onChange);
    },
    () => openTargets > 0,
    () => false,
  );
}
