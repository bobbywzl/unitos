import type { Tier } from "@prisma/client";
import Link from "next/link";
import { authEnabled, currentUser } from "@/lib/auth";
import { intervalFromParam, TIERS, tierSlug, type Interval } from "@/lib/billing/config";
import { formatDate } from "@/lib/billing/format";
import { plans, yearlySavingsPercent } from "@/lib/billing/plans";
import { billingView } from "@/lib/billing/switch";
import { checkoutTrialEnd } from "@/lib/billing/trial";
import { currentLang, serverT } from "@/lib/i18n/server";
import { tierOf, tierState, TRIAL_MONTHS } from "@/lib/tiers";
import { BillingFrame, emphasize } from "@/components/billing/frame";
import { PlanCard } from "@/components/billing/plan-card";
import { planButton } from "@/components/billing/plan-button";
import { PortalButton } from "@/components/billing/portal-button";

export const dynamic = "force-dynamic";

// The plan page (SPEC.md §24): the two tiers side by side, each with its
// price from Stripe and what it holds. A Monthly/Yearly toggle (?interval=)
// sits over the cards; Yearly carries the largest saving among the tiers as
// a badge, and each card shows its own saving under its price. Beside the
// toggle, the account's state and, with a subscription, Manage subscription
// and Receipts. On the trial the Unitos Premium card says the checkout
// starts free and when the first payment lands. Public: a signed-out
// visitor sees the plans and signs in to choose.
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
  const label = (tier: Tier) => t(tier === "ULTRA" ? "common.tierUltra" : "common.tierPremium");

  // The account's state, and the tier it holds: the subscription's, or the
  // one the operator granted.
  const state = user ? tierState(user) : null;
  const held: Tier | null =
    user && user.subscriptionId
      ? user.subscriptionTier
      : state === "ultra" || state === "premium"
        ? tierOf(state)
        : null;
  const rank = (tier: Tier) => (tier === "ULTRA" ? 2 : 1);
  const date = (value: Date | null) => (value ? formatDate(value, lang) : "");
  const current = !user
    ? null
    : user.subscriptionId && user.subscriptionTier
      ? t("billing.currentSubscribed", { tier: label(user.subscriptionTier), date: date(user.subscriptionEndsAt) })
      : state === "ultra" || state === "premium"
        ? t("billing.currentGranted", { tier: label(tierOf(state)) })
        : t(state === "trial" ? "billing.currentTrial" : "billing.currentExpired", { date: date(user.trialEndsAt) });
  const currentDate = user && !user.subscriptionId ? date(user.trialEndsAt) : date(user?.subscriptionEndsAt ?? null);

  // The trial: a checkout today starts free until it ends. Before sign-in
  // the card says so too — a new account gets the trial.
  const trialEnd = user ? checkoutTrialEnd(user) : null;
  const freeMonths = !user || trialEnd ? TRIAL_MONTHS : null;
  const startLine = trialEnd ? emphasize(t("billing.startFreeLine", { date: date(trialEnd) }), date(trialEnd)) : null;

  // What a card offers: Start Free or Get the tier, Your plan, Manage
  // subscription, or nothing (a tier below the one the account holds). The
  // button carries the chosen interval to the order page.
  const action = (tier: Tier) => {
    if (!user) {
      return (
        <Link href="/signin" className={planButton(tier)}>
          {t("billing.signInToChoose")}
        </Link>
      );
    }
    if (held === tier) {
      return <span className="tier-card-title text-sm font-semibold">{t("billing.yourPlan")}</span>;
    }
    if (user.subscriptionId) return <PortalButton className={planButton(tier)} />;
    if (held && rank(tier) < rank(held)) return null;
    return (
      <Link href={`/billing/order/${tierSlug(tier)}?interval=${interval}`} className={planButton(tier)}>
        {tier === "PREMIUM" && trialEnd ? t("billing.startFree") : t("billing.getTier", { tier: label(tier) })}
      </Link>
    );
  };

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
          {current && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-(--bl-muted)">{emphasize(current, currentDate)}</p>
              {user?.subscriptionId && (
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
              freeMonths={tier === "PREMIUM" ? freeMonths : null}
              startLine={tier === "PREMIUM" ? startLine : null}
              watermark
            >
              {action(tier)}
            </PlanCard>
          ))}
        </div>
      </section>
    </BillingFrame>
  );
}
