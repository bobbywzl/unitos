"use client";

import type { Tier } from "@prisma/client";
import { useLang, useT } from "@/components/lang-provider";
import { TierMark } from "@/components/tier-mark";
import type { Interval } from "@/lib/billing/config";
import { formatMoney, perMonth, savingsPercent, type PlanPrice } from "@/lib/billing/format";
import type { TKey } from "@/lib/i18n/dictionaries";

// One tier on the plan page and the order page (SPEC.md §24): the tier
// mark, the tier's name, the monthly rate at the chosen interval with the
// other interval's rate under it, the gold trial line when the checkout
// starts free, what the tier holds (TIERS.md), then the action the page
// passes as children. Unitos Premium is pearl with the white crystal
// floating at its corner; Unitos Ultra is obsidian under stars with the
// black diamond.

const FEATURES: Record<Tier, { full: TKey[]; short: TKey[] }> = {
  PREMIUM: {
    full: [
      "billing.premiumFeature1",
      "billing.premiumFeature2",
      "billing.premiumFeature3",
      "billing.premiumFeature4",
      "billing.premiumFeature5",
      "billing.premiumFeature6",
    ],
    short: ["billing.premiumFeature1", "billing.premiumFeature2", "billing.premiumFeature3", "billing.premiumFeature4"],
  },
  ULTRA: {
    full: [
      "billing.ultraFeature1",
      "billing.ultraFeature2",
      "billing.ultraFeature3",
      "billing.ultraFeature4",
      "billing.ultraFeature5",
      "billing.ultraFeature6",
    ],
    short: ["billing.ultraFeature1", "billing.ultraShort2", "billing.ultraShort3"],
  },
};

export function PlanCard({
  tier,
  interval,
  monthly,
  yearly,
  short = false,
  // The gold line: "{n} Months Free Now". The plan page shows it while the
  // account's trial runs (or before sign-in: a new account gets one), the
  // order page while the checkout starts free.
  freeMonths,
  // Under the gold line: when the first payment lands.
  startLine,
  watermark = false,
  children,
}: {
  tier: Tier;
  interval: Interval;
  monthly: PlanPrice;
  yearly: PlanPrice;
  short?: boolean;
  freeMonths?: number | null;
  startLine?: React.ReactNode;
  watermark?: boolean;
  children?: React.ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const ultra = tier === "ULTRA";
  const look = ultra ? "ultra" : "premium";
  const chosen = interval === "year" ? yearly : monthly;
  const rate = perMonth(chosen);
  const saving = savingsPercent(monthly, yearly);
  const otherRate = perMonth(yearly);
  // The line under the price: the yearly rate per month while Monthly is
  // chosen, the yearly total while Yearly is, each with the saving.
  const alt =
    interval === "year"
      ? yearly.amount !== null
        ? t("billing.altYearly", { price: formatMoney(yearly.amount, yearly.currency, lang) })
        : ""
      : otherRate !== null
        ? t("billing.altMonthly", { price: formatMoney(otherRate, yearly.currency, lang) })
        : "";
  const altLine = [alt, saving !== null ? t("billing.altSave", { n: saving }) : ""].filter(Boolean).join(" · ");
  const features = FEATURES[tier][short ? "short" : "full"];

  return (
    <section
      className={`relative flex flex-col gap-4 overflow-hidden rounded-2xl p-[26px] tier-card-${look} billing-card-${look}`}
    >
      {ultra && (
        <>
          <div aria-hidden className="billing-stars-card-a pointer-events-none absolute inset-0 opacity-80" />
          <div aria-hidden className="billing-stars-card-b pointer-events-none absolute inset-0 opacity-60" />
        </>
      )}
      {watermark && (
        <div
          aria-hidden
          className={`billing-float pointer-events-none absolute -top-[48px] -right-[40px] size-[220px] ${
            ultra ? "opacity-50" : "opacity-35"
          }`}
        >
          <TierMark state={look} size={220} />
        </div>
      )}
      <div className="relative flex items-center gap-3">
        <TierMark state={look} size={short ? 40 : 36} />
        <h2 className={`tier-card-title font-display ${short ? "text-[24px]" : "text-[22px]"}`}>
          {t(ultra ? "common.tierUltra" : "common.tierPremium")}
        </h2>
      </div>
      <div className="relative flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <p className={`tier-card-title font-bold whitespace-nowrap ${short ? "text-[30px]" : "text-[28px]"}`}>
          {rate === null ? (
            t("billing.priceUnset")
          ) : (
            <>
              {formatMoney(rate, chosen.currency, lang)}
              <span className="tier-card-muted text-sm font-semibold"> {t("billing.perMonth")}</span>
            </>
          )}
        </p>
        {altLine && !short && <p className="tier-card-muted basis-full text-[13px] font-semibold">{altLine}</p>}
      </div>
      {freeMonths != null && freeMonths > 0 && (
        <div className="relative">
          <span className="billing-gold block font-display text-[clamp(30px,3.6vw,40px)] leading-[1.05] whitespace-nowrap">
            {t("billing.freeNow", { n: freeMonths })}
          </span>
          {startLine && <p className="tier-card-muted mt-1 text-[13px] leading-relaxed text-pretty">{startLine}</p>}
        </div>
      )}
      <ul className="relative space-y-1.5">
        {features.map((key) => (
          <li key={key} className="tier-card-muted flex gap-2 text-[13px] leading-relaxed">
            <span aria-hidden className="mt-[8px] size-1.5 shrink-0 rounded-full bg-current opacity-60" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      {children && <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-2">{children}</div>}
    </section>
  );
}
