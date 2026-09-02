"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";
import { Presence } from "@/components/presence";

// The beta notice on /signin: Unitos is in beta, thanks to every beta user,
// and every beta account gets Unitos free and unlimited for now — the
// notebook and the AI tokens it uses — signed by the Unitos team. It opens
// once per tab (sessionStorage), so the check-your-email step and a mode
// switch do not show it again; Continue, Escape, or a click outside closes
// it. Revealed one frame after the page paints, so hydration renders nothing
// and matches the server.

const SEEN_KEY = "unitos-beta-notice";

function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false; // storage unavailable: the notice shows
  }
}

export function BetaNotice() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (seen()) return;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        // storage unavailable: showing again next load is the worst case
      }
      setOpen(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // Escape closes the dialog, like every dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Presence show={open} exit="dialog">
      {open && (
        <div
          className="dialog-in fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal
          aria-labelledby="beta-notice-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[440px] max-w-full rounded-[24px] bg-card p-6 shadow-float"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-clay/30 bg-clay/12">
                <Logo size={20} className="text-clay" />
              </span>
              <h2 id="beta-notice-title" className="font-display text-[20px] text-ink">
                {t("signin.betaTitle")}
              </h2>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-sand-800">{t("signin.betaThanks")}</p>
            <p className="mt-3 text-sm leading-relaxed text-sand-800">{t("signin.betaFree")}</p>
            <p className="mt-4 text-sm font-semibold text-clay-800">{t("signin.betaSigned")}</p>
            <button
              onClick={() => setOpen(false)}
              className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-clay text-sm font-semibold text-clay-fg hover:brightness-110 active:scale-[0.99]"
            >
              {t("signin.betaContinue")}
            </button>
          </div>
        </div>
      )}
    </Presence>
  );
}
