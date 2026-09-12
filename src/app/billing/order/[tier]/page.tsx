import { Fragment } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { tierFromSlug, tierSlug } from "@/lib/billing/config";
import { formatMoney, priceLine, renewsLine } from "@/lib/billing/format";
import { planOf } from "@/lib/billing/plans";
import { billingView } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { PlanCard } from "@/components/billing/plan-card";
import { PayButton } from "@/components/billing/pay-button";
import { PortalButton } from "@/components/billing/portal-button";
import { TierChip } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// The order page (SPEC.md §24): the tier chosen, its price, the account it
// goes to, what is charged now and how it renews, then Pay, which opens
// Stripe Checkout. Cancel on Stripe returns here with ?canceled=1.
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ tier: string }>;
  searchParams: Promise<{ canceled?: string }>;
}) {
  await billingView();
  const { tier: slug } = await params;
  const tier = tierFromSlug(slug);
  if (!tier) notFound();
  if (!authEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { canceled } = await searchParams;
  const t = await serverT();
  const lang = await currentLang();
  const plan = await planOf(tier);

  // The legal line, with the two documents as links: the placeholders come
  // back as the words "terms" and "privacy" between spaces.
  const legal = t("billing.orderLegal", { terms: " terms ", privacy: " privacy " })
    .split(" ")
    .map((part, i) =>
      part === "terms" || part === "privacy" ? (
        <Link key={i} href={`/${part}`} className="underline hover:text-clay-800">
          {t(part === "terms" ? "legal.termsTitle" : "legal.privacyTitle")}
        </Link>
      ) : (
        <Fragment key={i}>{part} </Fragment>
      ),
    );

  const row = "flex items-baseline justify-between gap-4 border-t border-line py-2.5 text-sm";
  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-[34px]">{t("billing.orderTitle")}</h1>
      </header>
      {canceled === "1" && (
        <p className="mb-6 rounded-2xl bg-sand-100 px-4 py-3 text-xs text-sand-700">
          {t("billing.orderCanceled")}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <PlanCard tier={tier} price={plan} />
        <div className="rounded-2xl bg-card p-5 shadow-soft">
          <div className={`${row} border-t-0`}>
            <span className="text-sand-600">{t("billing.orderAccount")}</span>
            <span className="truncate text-sand-800">{user.email}</span>
          </div>
          <div className={row}>
            <span className="text-sand-600">{t("billing.orderTier")}</span>
            <TierChip state={tier === "ULTRA" ? "ultra" : "premium"} trialEndsAt={null} />
          </div>
          <div className={row}>
            <span className="text-sand-600">{t("billing.orderPrice")}</span>
            <span className="text-sand-800">{priceLine(t, lang, plan)}</span>
          </div>
          <div className={row}>
            <span className="text-sand-600">{t("billing.orderChargedNow")}</span>
            <span className="font-semibold text-sand-800">
              {plan.amount === null ? t("billing.priceUnset") : formatMoney(plan.amount, plan.currency, lang)}
            </span>
          </div>
          <p className="border-t border-line pt-3 text-xs text-sand-600">{renewsLine(t, plan)}</p>
          <div className="mt-4">
            {user.subscriptionId ? (
              <div className="space-y-3">
                <p className="text-sm text-sand-800">
                  {t("billing.orderAlready", {
                    tier: t(user.subscriptionTier === "ULTRA" ? "common.tierUltra" : "common.tierPremium"),
                  })}
                </p>
                <PortalButton />
              </div>
            ) : (
              <PayButton tier={tierSlug(tier)} />
            )}
          </div>
          <p className="mt-4 text-[11px] text-sand-500">{legal}</p>
        </div>
      </div>
    </>
  );
}
