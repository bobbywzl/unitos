import { REPLAY_HEADER, REPLAY_SKEW_MS } from "@/lib/constants";

// A write the offline queue replays carries REPLAY_HEADER: the time the
// record was queued, a whole number of ms (lib/offline/queue.ts). Every
// route that treats a replay otherwise than an online write reads the mark
// here, so one rule says what counts as a replay: a header that is not a
// whole number is no replay (REV7-02, REV9-07), and an online write with a
// made-up header gets the online answer.

/** The time a replayed record was queued, from REPLAY_HEADER: null unless
    it is a whole number of ms. A duplicate lookup starts there, or a minute
    before now when the queuing clock ran ahead (REPLAY_SKEW_MS). */
export function replayTime(header: string | null): Date | null {
  if (!header || !/^\d{1,15}$/.test(header)) return null;
  return new Date(Math.min(Number(header), Date.now() - REPLAY_SKEW_MS));
}

/** The request's replay mark: null when it is not a replay. */
export function replayedAt(req: Request): Date | null {
  return replayTime(req.headers.get(REPLAY_HEADER));
}
