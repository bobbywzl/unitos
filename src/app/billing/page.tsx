import type { Tier } from "@prisma/client";
import Link from "next/link";
import { authEnabled, currentUser } from "@/lib/auth";
import { intervalFromParam, TIERS, type Interval } from "@/lib/billing/config";
import { plans, yearlySavingsPercent } from "@/lib/billing/plans";
import { billingView } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { BillingFrame } from "@/components/billing/frame";
import { PlanCard } from "@/components/billing/plan-card";
import { planChoice } from "@/components/billing/plan-choice";
import { PortalButton } from "@/components/billing/portal-button";

export const dynamic = "force-dynamic";

// The plan page (SPEC.md §24): the two tiers side by side, each with its
// price from Stripe and what it holds. A Monthly/Yearly toggle (?interval=)
// sits over the cards; Yearly carries the largest saving among the tiers as
// a badge, and each card shows its own saving under its price. Beside the
// toggle, the account's state and, with a subscription, Manage subscription
// and Receipts. On the trial the Unitos Premium card says the checkout
// starts free and when the first payment lands. Public: a signed-out
// visitor sees the plans and signs in to choose. The plans page (/plans)
// tells the whole story and ends on the same cards.
export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ interval?: string }>;
}) {
  const view = await billingView();
  const t = await serverT();
  const lang = await currentLang();
  const user = authEnabled() ? await currentUser() : null;
  const { interval: intervalParam } = await searchParams;
  const interval = intervalFromParam(intervalParam);
  const all = await plans();
  const priceOf = (tier: Tier, at: Interval) =>
    all.find((p) => p.tier === tier && p.interval === at) ?? {
      amount: null,
      currency: "usd",
      interval: at,
      intervalCount: 1,
    };
  const savings = await Promise.all(TIERS.map((tier) => yearlySavingsPercent(tier)));
  const maxSavings = Math.max(0, ...savings.map((n) => n ?? 0));
  const choice = planChoice(user, t, lang);

  const toggleTab = (value: Interval, key: "billing.intervalToggleMonthly" | "billing.intervalToggleYearly") => (
    <Link
      href={`/billing?interval=${value}`}
      aria-pressed={interval === value}
      className={`inline-flex items-center gap-2 rounded-full px-[18px] py-2 text-[13px] whitespace-nowrap ${
        interval === value
          ? "bg-(--bl-pill) font-bold text-(--bl-title) shadow-(--bl-pill-shadow)"
          : "font-semibold text-(--bl-muted) hover:text-(--bl-link)"
      }`}
    >
      {t(key)}
      {value === "year" && maxSavings > 0 && (
        <span className="rounded-full bg-[#fbe3d3] px-2 py-0.5 text-[11px] font-bold text-[#8c491a]">
          {t("billing.saveUpTo", { n: maxSavings })}
        </span>
      )}
    </Link>
  );

  return (
    <BillingFrame back="app" preview={view.preview}>
      <section className="billing-rise">
        <h1 className="mb-2.5 font-display text-[clamp(38px,5.5vw,64px)] tracking-[-0.02em] text-(--bl-title)">
          {t("billing.plans")}
        </h1>
        <p className="mb-1 max-w-[56ch] text-base leading-relaxed text-(--bl-muted) text-pretty">{t("billing.intro")}</p>
        <p className="mb-[26px] text-[17px] leading-relaxed font-bold text-(--bl-title)">{t("billing.cancelAnyTime")}</p>

        <div className="mb-[22px] flex flex-wrap items-center justify-between gap-3.5">
          <div className="inline-flex gap-1 rounded-full bg-(--bl-track) p-1">
            {toggleTab("month", "billing.intervalToggleMonthly")}
            {toggleTab("year", "billing.intervalToggleYearly")}
          </div>
          {choice.line && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-(--bl-muted)">{choice.line}</p>
              {choice.subscribed && (
                <span className="flex items-center gap-2">
                  <PortalButton />
                  <Link
                    href="/billing/receipts"
                    className="rounded-full bg-(--bl-pill) px-4 py-1.5 text-xs font-semibold text-(--bl-muted) shadow-(--bl-pill-shadow) hover:text-(--bl-link)"
                  >
                    {t("billing.receipts")}
                  </Link>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {TIERS.map((tier) => (
            <PlanCard
              key={tier}
              tier={tier}
              interval={interval}
              monthly={priceOf(tier, "month")}
              yearly={priceOf(tier, "year")}
              freeMonths={tier === "PREMIUM" ? choice.freeMonths : null}
              startLine={tier === "PREMIUM" ? choice.startLine : null}
              watermark
            >
              {choice.action(tier, interval)}
            </PlanCard>
          ))}
        </div>
      </section>
    </BillingFrame>
  );
}
