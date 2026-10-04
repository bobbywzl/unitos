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

export type EscapeLayer = { seq: number; close: () => void };

let counter = 0;
/** The next layer's number: higher is newer. */
export function nextLayerSeq(): number {
  return ++counter;
}

const layers = new Set<EscapeLayer>();
const sources = new Set<() => EscapeLayer | null>();

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

/** A menu that Escape closes while it is open, as one layer. */
export function useEscapeLayer(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const layer: EscapeLayer = { seq: nextLayerSeq(), close: () => closeRef.current() };
    layers.add(layer);
    listen();
    return () => {
      layers.delete(layer);
      unlisten();
    };
  }, [open]);
}
