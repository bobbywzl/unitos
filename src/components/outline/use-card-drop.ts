"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CARD_DRAG_END,
  CARD_DRAG_OVER,
  CARD_DRAG_START,
  CARD_DROP_TARGET,
  type CardDrag,
  type CardDragEndDetail,
  type CardDragOverDetail,
} from "@/lib/card-drag";

/** A drop target for the card drag (lib/card-drag.ts). The element that
    renders `data-note-drop-target={id}` takes the drop; this says whether a
    card is being dragged at all (so the target can offer itself) and whether
    it is over this target, and runs onDrop when the card is released on it. */
export function useCardDropTarget(
  id: string,
  onDrop: (detail: CardDragEndDetail) => void,
): { drag: CardDrag | null; over: boolean } {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const [over, setOver] = useState(false);

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

/** True while a note card floats over the article: the surface a card can be
    dragged onto (lib/card-drag.ts). A panel shows its grips only then. The
    floating card says when it opens and when it goes; the state is kept here,
    so a panel that mounts later reads it without asking the DOM. */
let dropOpen = false;
const openListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener(CARD_DROP_TARGET, (e) => {
    dropOpen = (e as CustomEvent<{ open: boolean }>).detail.open;
    for (const listener of openListeners) listener();
  });
}

export function useCardDropOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      openListeners.add(onChange);
      return () => void openListeners.delete(onChange);
    },
    () => dropOpen,
    () => false,
  );
}
