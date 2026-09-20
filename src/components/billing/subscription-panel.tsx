"use client";

import Link from "next/link";
import { useLang, useT } from "@/components/lang-provider";
import { PortalButton } from "@/components/billing/portal-button";
import { TierChip } from "@/components/tier-mark";
import { formatDate } from "@/lib/billing/format";
import type { SubscriptionSummary } from "@/lib/billing/subscription";
import type { TierState } from "@/lib/tiers";

// The subscription panel (SPEC.md §24) under Subscription in Settings: the
// plan as the tier chip, its status — the trial and whether a card is on
// file, or the subscription's state from Stripe — the billing interval, the
// card, then the actions: Manage subscription, Change plan, Update card,
// Cancel subscription, and Receipts with a subscription; See plans and
// Receipts without one. Under the rows, what the tier holds. With billing
// off (billing null) the panel shows the plan and its state alone.

const pill =
  "rounded-full bg-sand-100 px-3 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";
const primary =
  "rounded-full bg-clay px-3 py-1 text-xs font-semibold text-clay-fg shadow-soft hover:brightness-110 disabled:opacity-40";

export function SubscriptionPanel({
  plan,
  billing,
  signedIn,
}: {
  // The account's tier (TIERS.md) and, on trial or expired, the trial's end.
  // record: during the beta (every account has Ultra in the app), the
  // record's own state — the status reads it, and the beta line says so.
  plan: { state: TierState; trialEndsAt: string | null; record: TierState | null };
  // Billing on: the account's subscription, or null without one. Billing
  // off: null.
  billing: { subscription: SubscriptionSummary | null } | null;
  signedIn: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const date = (iso: string | null) => (iso ? formatDate(iso, lang) : "");
  const sub = billing?.subscription ?? null;
  const trialDate = date(plan.trialEndsAt);
  const recordState = plan.record ?? plan.state;

  // The status line, and the line under it.
  let status: string | null = null;
  let hint: string | null = null;
  if (sub) {
    const end = date(sub.periodEnd);
    status =
      sub.status === "trialing"
        ? t("billing.panelSubTrial", { date: end })
        : sub.status === "canceling"
          ? t("billing.panelSubCanceling", { date: end })
          : sub.status === "past_due"
            ? t("billing.panelSubPastDue")
            : sub.status === "active"
              ? t("billing.panelSubRenews", { date: end })
              : t("billing.panelSubHeld");
  } else if (signedIn) {
    if (recordState === "trial") {
      status = t("billing.panelStatusTrial", { date: trialDate });
      if (billing) hint = t("billing.panelStatusTrialAsk");
    } else if (recordState === "expired") {
      status = t("billing.panelStatusExpired", { date: trialDate });
    } else {
      status = t("billing.panelStatusGranted");
    }
  }
  if (plan.record && status) status = `${t("billing.betaLine")} ${status}`;

  const holds =
    plan.state === "ultra"
      ? t("settings.planUltra")
      : plan.state === "expired"
        ? t("settings.planExpired")
        : t("settings.planPremium");

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[88px_1fr] items-baseline gap-3 text-sm">
      <span className="text-xs font-semibold text-sand-600">{label}</span>
      <span className="min-w-0 text-sand-800">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4 rounded-2xl bg-card p-5 shadow-soft">
      <div className="space-y-2.5">
        {row(
          t("billing.panelPlan"),
          <TierChip state={plan.state} trialEndsAt={plan.trialEndsAt} size="md" short />,
        )}
        {status && row(t("billing.panelStatus"), status)}
        {sub?.interval &&
          row(
            t("billing.panelBilling"),
            t(sub.interval === "year" ? "billing.intervalToggleYearly" : "billing.intervalToggleMonthly"),
          )}
        {sub &&
          sub.live &&
          row(
            t("billing.panelCard"),
            sub.card
              ? t("billing.panelCardValue", {
                  brand: sub.card.brand.charAt(0).toUpperCase() + sub.card.brand.slice(1),
                  last4: sub.card.last4,
                })
              : t("billing.panelCardNone"),
          )}
      </div>
      {hint && <p className="text-xs leading-relaxed text-sand-600">{hint}</p>}
      {billing && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {sub ? (
            <>
              <PortalButton className={primary} back="settings" />
              <PortalButton className={pill} back="settings" flow="update" label={t("billing.changePlan")} />
              <PortalButton className={pill} back="settings" flow="payment" label={t("billing.updateCard")} />
              {sub.status !== "canceling" && (
                <PortalButton
                  className={pill}
                  back="settings"
                  flow="cancel"
                  label={t("billing.cancelSubscription")}
                />
              )}
            </>
          ) : (
            <Link href="/plans" className={primary}>
              {t("billing.seePlans")}
            </Link>
          )}
          <Link href="/billing/receipts" className={pill}>
            {t("billing.receipts")}
          </Link>
        </div>
      )}
      {billing && sub && <p className="text-[11px] text-sand-500">{t("billing.panelStripe")}</p>}
      <div className="border-t border-line pt-4 text-xs leading-relaxed text-sand-600">
        <p>{holds}</p>
        {signedIn && <p className="mt-1.5 text-[11px] text-sand-500">{t("settings.planMark")}</p>}
      </div>
    </div>
  );
}
