"use client";

import { useEffect, useRef, useState } from "react";
import { BillingAsk } from "@/components/billing/billing-ask";
import { IDLE_MS, TICK_SECONDS } from "@/lib/active-time";
import type { ActiveTimeAnswer } from "@/app/api/active-time/route";

// The active time clock (lib/active-time.ts): counts the account's active
// time — the tab visible and the reader acting in it (a pointer, a key, a
// scroll, a touch within IDLE_MS) — and posts it to /api/active-time, one tick per
// TICK_SECONDS of active time, the rest on pagehide. The first post on a
// page open is a zero tick: nothing to add, but the ask may be due. When
// the route answers that the billing ask opens, the ask opens here, over
// whatever page mounted the clock. Mounted by every account page beside
// the account guard; off with sign-in off (there is no row to count on).

// A post in the last few seconds by this tab is not repeated (React mounts
// an effect twice in development).
const REPEAT_MS = 5000;
let lastZeroPost = 0;

export function ActiveTimeClock({ enabled }: { enabled: boolean }) {
  // The ask: open, and the trial's end for its words. Closed keeps the
  // date, so the dialog leaves with its words in place.
  const [ask, setAsk] = useState<{ open: boolean; trialEndsAt: string | null }>({
    open: false,
    trialEndsAt: null,
  });
  const active = useRef(0); // seconds counted and not yet posted
  const lastInput = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const handle = (answer: ActiveTimeAnswer | null) => {
      if (answer?.ask) setAsk({ open: true, trialEndsAt: answer.trialEndsAt });
    };
    const post = async (seconds: number, keepalive = false) => {
      try {
        const res = await fetch("/api/active-time", {
          method: "POST",
          keepalive,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds }),
        });
        if (!res.ok) return;
        handle((await res.json().catch(() => null)) as ActiveTimeAnswer | null);
      } catch {
        // telemetry is best-effort — the next tick tries again
      }
    };

    const now = Date.now();
    if (now - lastZeroPost >= REPEAT_MS) {
      lastZeroPost = now;
      void post(0);
    }
    lastInput.current = now;

    const onInput = () => {
      lastInput.current = Date.now();
    };
    const inputs = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;
    for (const name of inputs) window.addEventListener(name, onInput, { passive: true });

    // One second at a time: counted when the tab is visible and an input
    // landed within IDLE_MS.
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastInput.current > IDLE_MS) return;
      active.current += 1;
      if (active.current >= TICK_SECONDS) {
        const seconds = active.current;
        active.current = 0;
        void post(seconds);
      }
    }, 1000);

    // The rest goes on pagehide, kept alive past the page.
    const onHide = () => {
      if (active.current === 0) return;
      const seconds = active.current;
      active.current = 0;
      void post(seconds, true);
    };
    window.addEventListener("pagehide", onHide);

    return () => {
      clearInterval(timer);
      for (const name of inputs) window.removeEventListener(name, onInput);
      window.removeEventListener("pagehide", onHide);
    };
  }, [enabled]);

  return (
    <BillingAsk
      open={ask.open}
      trialEndsAt={ask.trialEndsAt}
      onClose={() => setAsk((a) => ({ ...a, open: false }))}
    />
  );
}
