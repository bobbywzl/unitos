"use client";

import { useEffect, useSyncExternalStore } from "react";

// Who needs the provenance links of generated documents (COST3-03): the
// graph's data leaves them out (the edges count them) until the provenance
// switch is on ("switch") or a node card that lists them is open ("card").
// graph-data.tsx reads the union and fetches them then; the Documents list
// reads the switch alone, since it lists generated documents behind it.

type Channel = "switch" | "card";
const wants: Record<Channel, number> = { switch: 0, card: 0 };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function bump(channel: Channel, by: number) {
  wants[channel] += by;
  for (const l of listeners) l();
}

/** While mounted with want true, this channel asks for the provenance links. */
export function useWantProvenance(want: boolean, channel: Channel): void {
  useEffect(() => {
    if (!want) return;
    bump(channel, 1);
    return () => bump(channel, -1);
  }, [want, channel]);
}

/** Some part of the graph asks for the provenance links. */
export function useProvenanceWanted(): boolean {
  return useSyncExternalStore(subscribe, () => wants.switch + wants.card > 0, () => false);
}

/** The provenance switch is on. */
export function useProvenanceShown(): boolean {
  return useSyncExternalStore(subscribe, () => wants.switch > 0, () => false);
}
