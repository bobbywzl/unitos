import type { Tier } from "@prisma/client";
import Link from "next/link";
import "./plans.css";
import { authEnabled, currentUser } from "@/lib/auth";
import { TIERS, type Interval } from "@/lib/billing/config";
import { formatMoney, perMonth } from "@/lib/billing/format";
import { plans } from "@/lib/billing/plans";
import { billingView } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { TRIAL_MONTHS } from "@/lib/tiers";
import { PlansActs, type PlansPrices } from "@/app/plans/acts";
import { PlanCard } from "@/components/billing/plan-card";
import { planChoice } from "@/components/billing/plan-choice";
import { PortalButton } from "@/components/billing/portal-button";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

// The plans page (SPEC.md §24): the long scroll that sells the two tiers.
// The acts (acts.tsx) tell the story from the cream hero to the night sky;
// the last act, here, is the choice: the same account line and plan cards
// as the plan page (/billing), on the night ground. Public, and gated by
// the billing switch like every billing page: off, 404, except to the admin.
export default async function PlansPage() {
  const view = await billingView();
  const t = await serverT();
  const lang = await currentLang();
  const user = authEnabled() ? await currentUser() : null;
  const all = await plans();
  const priceOf = (tier: Tier, at: Interval) =>
    all.find((p) => p.tier === tier && p.interval === at) ?? {
      amount: null,
      currency: "usd",
      interval: at,
      intervalCount: 1,
    };
  // The rates the acts show, per month: a yearly price as its twelfth.
  const rate = (tier: Tier, at: Interval) => {
    const price = priceOf(tier, at);
    const perMonthAmount = perMonth(price);
    return perMonthAmount === null ? null : formatMoney(perMonthAmount, price.currency, lang);
  };
  const monthLine = (tier: Tier) => {
    const price = rate(tier, "month");
    return price === null ? t("billing.priceUnset") : t("billing.priceInterval", { price, interval: t("billing.intervalMonth") });
  };
  const yearLine = (tier: Tier) => {
    const price = rate(tier, "year");
    return price === null ? "" : t("plans.rateYearly", { price });
  };
  const prices: PlansPrices = {
    premiumMonth: monthLine("PREMIUM"),
    premiumYearly: yearLine("PREMIUM"),
    ultraMonth: monthLine("ULTRA"),
    ultraYearly: yearLine("ULTRA"),
  };
  const choice = planChoice(user, t, lang);
  const nightPill =
    "rounded-full bg-[rgba(243,233,210,0.1)] px-4 py-[7px] text-xs font-semibold text-[#f3e9d2] hover:bg-[rgba(243,233,210,0.22)] hover:text-[#f3e9d2]";

  return (
    <div className="plans-root">
      <div aria-hidden className="tier-band tier-band-premium" />
      <nav className="plans-nav print:hidden">
        <Link href="/" className="plans-back">
          <Logo size={16} />
          {t("billing.backToApp")}
        </Link>
        <LangSwitcher />
      </nav>

      <PlansActs t={t} prices={prices} freeMonths={TRIAL_MONTHS} />

      {/* The choice: the cards, on the night ground the descent left. */}
      <section id="choose" data-act="choice" className="billing-night plans-choice">
        <div className="mx-auto w-full max-w-[980px]">
          <div className="plans-reveal pb-[clamp(40px,7vh,90px)] text-center">
            <p className="font-display text-[clamp(34px,5vw,76px)] leading-[1.1] tracking-[-0.02em] text-[#f7ecd4] text-pretty">
              {t("plans.onlyTheNecessary")}
            </p>
            <p className="mt-3.5 font-display text-[clamp(22px,2.8vw,40px)] leading-[1.2] text-[#d6b26a]">
              {t("plans.moreOnTheWay")}
            </p>
          </div>
          <h2 className="plans-reveal mb-2.5 font-display text-[clamp(34px,5vw,62px)] tracking-[-0.02em] text-[#f7ecd4]">
            {t("plans.chooseNow")}
          </h2>
          <p className="plans-reveal mb-1 max-w-[56ch] text-base leading-relaxed text-[rgba(243,233,210,0.75)]">
            {t("billing.intro")}
          </p>
          <p className="plans-reveal mb-7 text-[17px] font-bold text-[#f7ecd4]">{t("billing.cancelAnyTime")}</p>

          {choice.line && (
            <div className="plans-reveal mb-6 flex flex-wrap items-center gap-3 rounded-2xl bg-[rgba(243,233,210,0.07)] px-[18px] py-3.5 shadow-[inset_0_0_0_1px_rgba(214,178,106,0.28)]">
              <p className="text-sm text-[rgba(243,233,210,0.86)]">{choice.line}</p>
              <span className="ml-auto flex items-center gap-2">
                {choice.subscribed && <PortalButton className={nightPill} />}
                {user && (
                  <Link href="/billing/receipts" className={nightPill}>
                    {t("billing.receipts")}
                  </Link>
                )}
              </span>
            </div>
          )}

          <div className="plans-reveal grid gap-5 sm:grid-cols-2">
            {TIERS.map((tier) => (
              <PlanCard
                key={tier}
                tier={tier}
                interval="month"
                monthly={priceOf(tier, "month")}
                yearly={priceOf(tier, "year")}
                freeMonths={tier === "PREMIUM" ? choice.freeMonths : null}
                startLine={tier === "PREMIUM" ? choice.startLine : null}
              >
                {choice.action(tier, "month")}
              </PlanCard>
            ))}
          </div>

          {view.preview && (
            <p className="plans-reveal mt-[26px] text-xs text-[rgba(243,233,210,0.55)]">{t("billing.preview")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
