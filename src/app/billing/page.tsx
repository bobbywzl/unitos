import type { Tier } from "@prisma/client";
import Link from "next/link";
import { authEnabled, currentUser } from "@/lib/auth";
import { TIERS, tierSlug } from "@/lib/billing/config";
import { formatDate } from "@/lib/billing/format";
import { plans } from "@/lib/billing/plans";
import { billingView } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { tierOf, tierState } from "@/lib/tiers";
import { PlanCard, planButton } from "@/components/billing/plan-card";
import { PortalButton } from "@/components/billing/portal-button";

export const dynamic = "force-dynamic";

// The plan page (SPEC.md §24): the two tiers side by side, each with its
// price from Stripe and what it holds, and Choose on the ones the account
// can buy. Public: a signed-out visitor sees the plans and signs in to
// choose. Over the cards, the account's state and, with a subscription,
// Manage subscription and Receipts.
export default async function PlansPage() {
  await billingView();
  const t = await serverT();
  const lang = await currentLang();
  const user = authEnabled() ? await currentUser() : null;
  const all = await plans();
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
  const current = !user
    ? null
    : user.subscriptionId && user.subscriptionTier
      ? t("billing.currentSubscribed", {
          tier: label(user.subscriptionTier),
          date: user.subscriptionEndsAt ? formatDate(user.subscriptionEndsAt, lang) : "",
        })
      : state === "ultra" || state === "premium"
        ? t("billing.currentGranted", { tier: label(tierOf(state)) })
        : t(state === "trial" ? "billing.currentTrial" : "billing.currentExpired", {
            date: user.trialEndsAt ? formatDate(user.trialEndsAt, lang) : "",
          });

  // What a card offers: Choose, Your plan, Manage subscription, or nothing
  // (a tier below the one the account holds).
  const action = (tier: Tier) => {
    if (!user) {
      return (
        <Link href="/signin" className={planButton}>
          {t("billing.signInToChoose")}
        </Link>
      );
    }
    if (held === tier) {
      return <span className="tier-card-title text-sm font-semibold">{t("billing.yourPlan")}</span>;
    }
    if (user.subscriptionId) return <PortalButton className={planButton} />;
    if (held && rank(tier) < rank(held)) return null;
    return (
      <Link href={`/billing/order/${tierSlug(tier)}`} className={planButton}>
        {t("billing.choose", { tier: label(tier) })}
      </Link>
    );
  };

  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-[34px]">{t("billing.plans")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-sand-800">{t("billing.intro")}</p>
      </header>
      {current && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-soft">
          <p className="text-sm text-sand-800">{current}</p>
          <span className="ml-auto flex items-center gap-2">
            {user?.subscriptionId && <PortalButton />}
            <Link
              href="/billing/receipts"
              className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold text-sand-700 shadow-soft hover:text-clay-800"
            >
              {t("billing.receipts")}
            </Link>
          </span>
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {TIERS.map((tier) => {
          const plan = all.find((p) => p.tier === tier);
          return (
            <PlanCard
              key={tier}
              tier={tier}
              price={plan ?? { amount: null, currency: "usd", interval: "month", intervalCount: 1 }}
            >
              {action(tier)}
            </PlanCard>
          );
        })}
      </div>
    </>
  );
}
