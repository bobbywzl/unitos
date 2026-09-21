"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import { TierMark } from "@/components/tier-mark";
import type { TKey } from "@/lib/i18n/dictionaries";

// The upgrade panel (SPEC.md §24): what Unitos Ultra adds to Unitos
// Premium, in the Ultra material, over the dashboard. The tier button
// (tier-button.tsx) opens it when a Unitos Premium account presses the
// tier chip. The list is the plan page's own (billing.ultraFeature*), so
// the two cannot disagree. Get Unitos Ultra opens the Ultra order page;
// See plans opens the plans page; Escape or a click outside closes.

const ADDS: TKey[] = [
  "billing.ultraFeature2",
  "billing.ultraFeature3",
  "billing.ultraFeature4",
  "billing.ultraFeature5",
  "billing.ultraFeature6",
];

export function UltraUpgrade({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();

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
          aria-labelledby="ultra-upgrade-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-[460px] max-w-full rounded-[24px] p-6 shadow-float tier-card-ultra"
          >
            <div className="flex items-center gap-3">
              <TierMark state="ultra" size={34} />
              <h2 id="ultra-upgrade-title" className="tier-card-title font-display text-[22px]">
                {t("common.tierUltra")}
              </h2>
            </div>
            <p className="tier-card-muted mt-4 text-sm leading-relaxed">{t("billing.upgradeIntro")}</p>
            <ul className="mt-3 space-y-2">
              {ADDS.map((key) => (
                <li key={key} className="flex gap-2.5 text-sm leading-relaxed">
                  <TierMark state="ultra" size={14} className="mt-[3px]" />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/billing/order/ultra?interval=month"
              className="mt-5 flex h-11 w-full items-center justify-center rounded-full bg-[#d6b26a] text-sm font-semibold text-[#1a1713] hover:brightness-110 active:scale-[0.99]"
            >
              {t("billing.getTier", { tier: t("common.tierUltra") })}
            </Link>
            <Link
              href="/plans"
              className="tier-card-muted mt-2 flex h-10 w-full items-center justify-center rounded-full text-xs font-semibold hover:text-[#f7ecd4]"
            >
              {t("billing.seePlans")}
            </Link>
          </div>
        </div>
      )}
    </Presence>
  );
}
