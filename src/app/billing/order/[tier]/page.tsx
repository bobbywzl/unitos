import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { intervalFromParam, tierFromSlug, tierSlug } from "@/lib/billing/config";
import { everyInterval, formatDate, formatMoney, perMonth, priceLine } from "@/lib/billing/format";
import { planOf } from "@/lib/billing/plans";
import { billingView } from "@/lib/billing/switch";
import { checkoutTrialEnd, nextRenewal } from "@/lib/billing/trial";
import { currentLang, serverT } from "@/lib/i18n/server";
import { TRIAL_MONTHS } from "@/lib/tiers";
import { BillingFrame, TierWatermark } from "@/components/billing/frame";
import { PlanCard } from "@/components/billing/plan-card";
import { PayButton } from "@/components/billing/pay-button";
import { PortalButton } from "@/components/billing/portal-button";
import { TierChip } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// The order page (SPEC.md §24): the tier chosen at the interval carried
// from the plan page (?interval=, monthly if absent) beside the order
// sheet: the account, the tier, the price, what is charged now, and how it
// renews. On the trial nothing is charged now and the sheet says when the
// first charge lands. Then Pay with Stripe, which opens Stripe Checkout.
// Cancel on Stripe returns here with ?canceled=1. A link switches the
// interval without leaving the order. Unitos Ultra's order is a night page.
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ tier: string }>;
  searchParams: Promise<{ canceled?: string; interval?: string }>;
}) {
  const view = await billingView();
  const { tier: slug } = await params;
  const tier = tierFromSlug(slug);
  if (!tier) notFound();
  if (!authEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { canceled, interval: intervalParam } = await searchParams;
  const interval = intervalFromParam(intervalParam);
  const otherInterval = interval === "year" ? "month" : "year";
  const t = await serverT();
  const lang = await currentLang();
  const [monthly, yearly] = await Promise.all([planOf(tier, "month"), planOf(tier, "year")]);
  const plan = interval === "year" ? yearly : monthly;
  const ultra = tier === "ULTRA";
  const label = t(ultra ? "common.tierUltra" : "common.tierPremium");
  const money = (amount: number) => formatMoney(amount, plan.currency, lang);

  // The trial: a checkout today starts free until it ends, and the first
  // charge lands then. Otherwise the price is charged now and the
  // subscription renews one interval out.
  const now = new Date();
  const trialEnd = checkoutTrialEnd(user, now);
  const renewsAt = nextRenewal(trialEnd ?? now, interval, plan.intervalCount);
  const rate = perMonth(plan);
  const price =
    plan.amount === null
      ? t("billing.priceUnset")
      : interval === "year" && rate !== null
        ? t("billing.priceYearLine", { year: money(plan.amount), month: money(rate) })
        : priceLine(t, lang, plan);
  const renews =
    plan.amount === null
      ? ""
      : trialEnd
        ? t("billing.orderFreeUntil", {
            date: formatDate(trialEnd, lang),
            price: money(plan.amount),
            interval: everyInterval(t, plan),
          })
        : t("billing.orderRenewsOn", { interval: everyInterval(t, plan), date: formatDate(renewsAt, lang) });

  // The legal line, with the two documents as links: the placeholders come
  // back as the words "terms" and "privacy" between spaces.
  const legal = t("billing.orderLegal", { terms: " terms ", privacy: " privacy " })
    .split(" ")
    .map((part, i) =>
      part === "terms" || part === "privacy" ? (
        <Link key={i} href={`/${part}`} className="underline hover:text-(--bl-link)">
          {t(part === "terms" ? "legal.termsTitle" : "legal.privacyTitle")}
        </Link>
      ) : (
        <Fragment key={i}>{part} </Fragment>
      ),
    );

  const row = "flex items-baseline justify-between gap-4 border-t border-(--bl-line) py-3 text-sm";
  return (
    <BillingFrame night={ultra} back="plans" preview={view.preview}>
      <section className="billing-rise relative">
        <TierWatermark tier={ultra ? "ultra" : "premium"} size={ultra ? 440 : 420} />
        <h1 className="relative mb-1.5 font-display text-[clamp(36px,5vw,56px)] tracking-[-0.02em] text-(--bl-title)">
          {t("billing.orderTitle")}
        </h1>
        <p className="relative mb-7 text-[15px] text-(--bl-muted)">
          {t("billing.orderSub", {
            tier: label,
            billed: t(interval === "year" ? "billing.billedYearly" : "billing.billedMonthly"),
          })}
        </p>
        {canceled === "1" && (
          <p className="relative mb-6 rounded-2xl bg-(--bl-track) px-4 py-3 text-xs text-(--bl-muted)">
            {t("billing.orderCanceled")}
          </p>
        )}
        <div className="relative grid items-start gap-5 sm:grid-cols-2">
          <PlanCard
            tier={tier}
            interval={interval}
            monthly={monthly}
            yearly={yearly}
            short
            freeMonths={!ultra && trialEnd ? TRIAL_MONTHS : null}
          />
          <section className={`flex flex-col rounded-2xl p-[26px] ${ultra ? "billing-sheet-night" : "billing-sheet-light"}`}>
            <div className={`${row} border-t-0 pt-0`}>
              <span className="text-(--bl-muted)">{t("billing.orderAccount")}</span>
              <span className="truncate font-semibold text-(--bl-title)">{user.email}</span>
            </div>
            <div className={`${row} items-center`}>
              <span className="text-(--bl-muted)">{t("billing.orderTier")}</span>
              <TierChip state={ultra ? "ultra" : "premium"} trialEndsAt={null} />
            </div>
            <div className={row}>
              <span className="text-(--bl-muted)">{t("billing.orderPrice")}</span>
              <span className="text-right text-(--bl-title)">{price}</span>
            </div>
            <div className={row}>
              <span className="text-(--bl-muted)">{t("billing.orderChargedNow")}</span>
              <span className="text-lg font-bold text-(--bl-title)">
                {plan.amount === null ? t("billing.priceUnset") : money(trialEnd ? 0 : plan.amount)}
              </span>
            </div>
            {trialEnd && plan.amount !== null && (
              <div className={row}>
                <span className="shrink-0 text-(--bl-muted)">{t("billing.orderFirstCharge")}</span>
                <span className="text-right font-semibold text-(--bl-title)">
                  {t("billing.orderFirstChargeValue", { price: money(plan.amount), date: formatDate(trialEnd, lang) })}
                </span>
              </div>
            )}
            <p className="border-t border-(--bl-line) pt-3 text-xs leading-relaxed text-(--bl-muted)">{renews}</p>
            <p className="mt-1 text-[13px] font-bold text-(--bl-title)">{t("billing.cancelAnyTime")}</p>
            {!user.subscriptionId && (
              <p className="mt-1.5 text-xs">
                <Link
                  href={`/billing/order/${tierSlug(tier)}?interval=${otherInterval}`}
                  className="font-semibold text-(--bl-link) underline"
                >
                  {t(otherInterval === "year" ? "billing.switchToYearly" : "billing.switchToMonthly")}
                </Link>
              </p>
            )}
            <div className="mt-[18px]">
              {user.subscriptionId ? (
                <div className="space-y-3">
                  <p className="text-sm text-(--bl-title)">
                    {t("billing.orderAlready", {
                      tier: t(user.subscriptionTier === "ULTRA" ? "common.tierUltra" : "common.tierPremium"),
                    })}
                  </p>
                  <PortalButton />
                </div>
              ) : (
                <PayButton tier={tier} interval={interval} />
              )}
            </div>
            <p className="mt-3.5 text-[11px] leading-relaxed text-(--bl-faint)">
              {legal}
              {t("billing.orderLegalAfter")}
            </p>
          </section>
        </div>
      </section>
    </BillingFrame>
  );
}
