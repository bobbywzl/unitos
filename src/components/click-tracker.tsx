"use client";

import { useEffect } from "react";
import {
  CLICK_BATCH_MAX,
  CLICK_CONTROL_PATTERN,
  isClickSurface,
  type ClickRecord,
} from "@/lib/clicks";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { isOffline } from "@/lib/offline/queue";
import { tabAccount } from "@/lib/tab-account";

// Click telemetry (SPEC.md §7). One capture-phase click listener on the
// document while the workspace is mounted: a click on an element with
// data-track, inside a region with data-track-surface, records one click.
// Clicks batch in memory and post a few seconds later, and when the page
// hides; a failed post drops its batch. Offline, the batch waits for the next
// flush. Nothing here ever throws into the reader.

const FLUSH_MS = 4000;
const PENDING_MAX = 500;

let pending: ClickRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function post(records: ClickRecord[], keepalive: boolean): void {
  const account = tabAccount();
  void fetch("/api/clicks", {
    method: "POST",
    keepalive,
    headers: {
      "Content-Type": "application/json",
      ...(account ? { [ACCOUNT_HEADER]: account } : {}),
    },
    body: JSON.stringify({ clicks: records }),
  }).catch(() => {
    // telemetry is best-effort — never surface to the reader
  });
}

// Send everything pending. keepalive lets the request outlive the page.
export function flushClicks(keepalive = false): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.length === 0 || isOffline()) return;
  const batch = pending;
  pending = [];
  for (let i = 0; i < batch.length; i += CLICK_BATCH_MAX) {
    post(batch.slice(i, i + CLICK_BATCH_MAX), keepalive);
  }
}

export function trackClick(record: ClickRecord): void {
  if (!CLICK_CONTROL_PATTERN.test(record.control)) return;
  pending.push(record);
  if (pending.length > PENDING_MAX) pending = pending.slice(-PENDING_MAX);
  if (pending.length >= CLICK_BATCH_MAX) flushClicks();
  else if (!timer) timer = setTimeout(() => flushClicks(), FLUSH_MS);
}

// The control under a click: the nearest ancestor with data-track, and the
// surface it lives on: the nearest ancestor with data-track-surface.
function recordFor(target: EventTarget | null, notebookId: string): ClickRecord | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest<HTMLElement>("[data-track]");
  const name = control?.dataset.track;
  if (!control || !name) return null;
  const surface = control.closest<HTMLElement>("[data-track-surface]")?.dataset.trackSurface;
  if (!isClickSurface(surface)) return null;
  return { surface, control: name, notebookId };
}

export function ClickTracker({ notebookId }: { notebookId: string }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const record = recordFor(e.target, notebookId);
      if (record) trackClick(record);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushClicks(true);
    };
    const onPageHide = () => flushClicks(true);
    const onOnline = () => flushClicks();
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
      flushClicks(true);
    };
  }, [notebookId]);
  return null;
}
