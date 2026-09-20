"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { TierMark } from "@/components/tier-mark";
import { formatDate } from "@/lib/billing/format";
import { TRIAL_MONTHS } from "@/lib/tiers";

// The billing ask (SPEC.md §24): after ASK_AFTER_SECONDS of active time
// (lib/active-time.ts), the app asks for a card to keep Unitos Premium after the
// trial. The card goes to Stripe on the order page: nothing is charged
// until the trial ends, and the subscription can be canceled any time
// before then. Add a card opens the Unitos Premium order page; Not now
// closes the ask, and it opens again after ASK_AGAIN_MS of the clock. The
// active time clock (components/active-time-clock.tsx) opens it when the
// route says so.
export function BillingAsk({
  open,
  trialEndsAt,
  onClose,
}: {
  open: boolean;
  // When the trial ends, ISO; the line says the first payment lands then.
  trialEndsAt: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const date = trialEndsAt ? formatDate(trialEndsAt, lang) : "";

  // Escape closes the dialog, like every dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <Presence show={open} exit="dialog">
      {open && (
      <div
        className="dialog-in fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
        onClick={onClose}
        role="dialog"
        aria-modal
        aria-labelledby="billing-ask-title"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-[440px] max-w-full rounded-[24px] p-6 shadow-float tier-card-premium"
        >
          <div className="flex items-center gap-3">
            <TierMark state="trial" size={34} />
            <h2 id="billing-ask-title" className="tier-card-title font-display text-[22px]">
              {t("billing.askTitle", { n: TRIAL_MONTHS })}
            </h2>
          </div>
          <p className="tier-card-muted mt-4 text-sm leading-relaxed">{t("billing.askBody", { date })}</p>
          <p className="tier-card-title mt-3 text-sm font-semibold">{t("billing.cancelAnyTime")}</p>
          <Link
            href="/billing/order/premium?interval=month"
            className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-clay text-sm font-semibold text-clay-fg hover:brightness-110 active:scale-[0.99]"
          >
            {t("billing.askAddCard")}
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="tier-card-muted mt-2 flex h-10 w-full items-center justify-center rounded-full text-xs font-semibold hover:text-clay-800"
          >
            {t("billing.askNotNow")}
          </button>
        </div>
      </div>
      )}
    </Presence>
  );
}
