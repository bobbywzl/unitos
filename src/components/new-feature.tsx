"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";
import { NEW_GLOW_DAYS, releaseOfFeature } from "@/lib/releases";

// The New glow (SPEC.md §18): a control a release added glows — a pulsing
// sage ring (globals.css .new-glow) and a New pill — until the reader
// presses it, for NEW_GLOW_DAYS after the release shipped. This browser
// remembers what was pressed (localStorage); the server's render and the
// first client render show no glow, so nothing flashes at hydration.

const SEEN_KEY = "unitos-new-seen";
const SEEN_EVENT = "unitos:new-seen";

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(SEEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SEEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The control was pressed: its glow ends, in every tab of this browser. */
export function markFeatureSeen(feature: string) {
  try {
    const seen = new Set(readSeen().split(",").filter(Boolean));
    if (seen.has(feature)) return;
    seen.add(feature);
    localStorage.setItem(SEEN_KEY, [...seen].join(","));
  } catch {
    // A blocked store only glows again on the next open.
  }
  window.dispatchEvent(new Event(SEEN_EVENT));
}

const DAY_MS = 24 * 3600 * 1000;

/** Whether the control glows now: a release added it, the release is
 *  within NEW_GLOW_DAYS, and this browser has not pressed it. Read as the
 *  store's snapshot, so the clock and the store are read together. */
function featureGlows(feature: string): boolean {
  const release = releaseOfFeature(feature);
  if (release === null) return false;
  if (Date.now() - new Date(release.date).getTime() >= NEW_GLOW_DAYS * DAY_MS) return false;
  return !readSeen().split(",").includes(feature);
}

/** Whether the control still glows, and the call that ends the glow. */
export function useNewFeature(feature: string): { isNew: boolean; seen: () => void } {
  // A false snapshot on the server: no glow before hydration.
  const isNew = useSyncExternalStore(subscribe, () => featureGlows(feature), () => false);
  return { isNew, seen: () => markFeatureSeen(feature) };
}

/** The class a glowing control adds to its own. */
export const NEW_GLOW_CLASS = "new-glow";

/** The New pill beside a glowing control's label. */
export function NewPill() {
  const t = useT();
  return <span className="new-pill">{t("common.newFeature")}</span>;
}
