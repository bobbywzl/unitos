import type { Tier, User } from "@prisma/client";
import Link from "next/link";
import { tierSlug, type Interval } from "@/lib/billing/config";
import { formatDate } from "@/lib/billing/format";
import { checkoutTrialEnd } from "@/lib/billing/trial";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { tierOf, tierState, TRIAL_MONTHS } from "@/lib/tiers";
import { emphasize } from "@/components/billing/frame";
import { planButton } from "@/components/billing/plan-button";
import { PortalButton } from "@/components/billing/portal-button";

// The account's side of the plan choice (SPEC.md §24), shared by the plan
// page (/billing) and the plans page (/plans): the state line, the trial,
// and what each card offers. One reading of the account, so the two pages
// cannot disagree.
export type PlanChoice = {
  // The account's state, the date in bold; null before sign-in.
  line: React.ReactNode | null;
  // The account holds a subscription: Manage subscription and Receipts show.
  subscribed: boolean;
  // A checkout today starts free until the trial ends (lib/billing/trial.ts).
  trialEnd: Date | null;
  // The gold line on the Unitos Premium card: the trial's length. Before
  // sign-in too — a new account gets the trial.
  freeMonths: number | null;
  // Under the gold line: when the first payment lands.
  startLine: React.ReactNode | null;
  // The card's button: Start Free or Get the tier, Your plan, Manage
  // subscription, Sign in, or nothing (a tier below the one the account
  // holds). The button carries the interval to the order page.
  action: (tier: Tier, interval: Interval) => React.ReactNode;
};

export function planChoice(user: User | null, t: TFunc, lang: Lang): PlanChoice {
  const label = (tier: Tier) => t(tier === "ULTRA" ? "common.tierUltra" : "common.tierPremium");
  const date = (value: Date | null) => (value ? formatDate(value, lang) : "");
  const state = user ? tierState(user) : null;
  // The tier the account holds: the subscription's, or the one the
  // operator granted.
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
      ? t("billing.currentSubscribed", { tier: label(user.subscriptionTier), date: date(user.subscriptionEndsAt) })
      : state === "ultra" || state === "premium"
        ? t("billing.currentGranted", { tier: label(tierOf(state)) })
        : t(state === "trial" ? "billing.currentTrial" : "billing.currentExpired", { date: date(user.trialEndsAt) });
  const currentDate = !user ? "" : user.subscriptionId ? date(user.subscriptionEndsAt) : date(user.trialEndsAt);
  const trialEnd = user ? checkoutTrialEnd(user) : null;
  return {
    line: current ? emphasize(current, currentDate) : null,
    subscribed: Boolean(user?.subscriptionId),
    trialEnd,
    freeMonths: !user || trialEnd ? TRIAL_MONTHS : null,
    // The date in the card's own ink: the card is pearl on the night ground too.
    startLine: trialEnd
      ? emphasize(t("billing.startFreeLine", { date: date(trialEnd) }), date(trialEnd), "tier-card-title font-bold")
      : null,
    action: (tier, interval) => {
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
    },
  };
}
