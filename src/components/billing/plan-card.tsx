"use client";

import type { Tier } from "@prisma/client";
import { useLang, useT } from "@/components/lang-provider";
import { TierMark } from "@/components/tier-mark";
import { priceLine, type PlanPrice } from "@/lib/billing/format";
import type { TKey } from "@/lib/i18n/dictionaries";

// One tier on the plan page, the order page, and the confirmation page
// (SPEC.md §24): the tier mark, the tier's name, the price line, what the
// tier holds (TIERS.md), then the action the page passes as children. The
// card is the tier's own material, the same as the plan card in Settings.

const FEATURES: Record<Tier, TKey[]> = {
  PREMIUM: [
    "billing.premiumFeature1",
    "billing.premiumFeature2",
    "billing.premiumFeature3",
    "billing.premiumFeature4",
    "billing.premiumFeature5",
    "billing.premiumFeature6",
  ],
  ULTRA: ["billing.ultraFeature1", "billing.ultraFeature2", "billing.ultraFeature3"],
};

export function PlanCard({
  tier,
  price,
  children,
}: {
  tier: Tier;
  price: PlanPrice;
  children?: React.ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const look = tier === "ULTRA" ? "ultra" : "premium";
  return (
    <section className={`flex flex-col gap-4 rounded-2xl p-6 tier-card-${look}`}>
      <div className="flex items-center gap-3">
        <TierMark state={look} size={36} />
        <h2 className="tier-card-title font-display text-[22px]">
          {t(tier === "ULTRA" ? "common.tierUltra" : "common.tierPremium")}
        </h2>
      </div>
      <p className="tier-card-title text-[17px] font-semibold">{priceLine(t, lang, price)}</p>
      <ul className="space-y-1.5">
        {FEATURES[tier].map((key) => (
          <li key={key} className="tier-card-muted flex gap-2 text-[13px] leading-relaxed">
            <span aria-hidden className="mt-[8px] size-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      {children && <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">{children}</div>}
    </section>
  );
}

// The main button on a plan card and on the order page.
export const planButton =
  "rounded-full bg-clay px-5 py-2 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40";
