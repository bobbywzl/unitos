"use client";

import { useEffect } from "react";
import type { FunnelPageStep } from "@/lib/funnel";

// The onboarding funnel (lib/funnel.ts): mounted by a page that is one
// step, it posts the step once when the page opens. A step posted in the
// last few seconds by this tab is not posted again (React mounts an effect
// twice in development). The post is fire-and-forget and never throws into
// the page.

const REPEAT_MS = 5000;
const lastPost = new Map<FunnelPageStep, number>();

export function FunnelStepMark({ step }: { step: FunnelPageStep }) {
  useEffect(() => {
    const now = Date.now();
    const last = lastPost.get(step) ?? 0;
    if (now - last < REPEAT_MS) return;
    lastPost.set(step, now);
    void fetch("/api/funnel", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step }),
    }).catch(() => {
      // telemetry is best-effort — never surface to the reader
    });
  }, [step]);
  return null;
}
