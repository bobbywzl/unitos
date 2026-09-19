import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { intervalOfPriceId, stripeConfigured, tierOfPriceId } from "@/lib/billing/config";
import { applyCheckoutSession } from "@/lib/billing/events";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { planOf } from "@/lib/billing/plans";
import { stripe, type Stripe } from "@/lib/billing/stripe";
import { billingView } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { BillingFrame, emphasize } from "@/components/billing/frame";
import { planButton } from "@/components/billing/plan-button";
import { TierMark } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// The confirmation page (SPEC.md §24): Stripe returns here with the checkout
// session id. The session must belong to the signed-in account. Paid, or
// started free on the trial, the purchase is recorded here at once (the
// same idempotent path as the webhook), so the tier is on before the
// webhook lands. The page says what was charged and when the next payment
// lands, then Go to dashboard. Not yet paid (a bank transfer settling), the
// page says so. Unitos Ultra's confirmation is a night page. Without a
// session id — a stray visit, or an ads tool checking the URL — the page
// says there is no order to confirm and points at the plans page; that
// state is public, like the plan page: nothing on it is the account's.
export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const view = await billingView();
  const t = await serverT();
  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    return (
      <BillingFrame back="plans" preview={view.preview}>
        <section className="billing-rise pt-[4vh] text-center">
          <h1 className="mb-3.5 font-display text-[clamp(38px,5.5vw,64px)] tracking-[-0.02em] text-(--bl-title) text-balance">
            {t("billing.confirmedNoneTitle")}
          </h1>
          <p className="mx-auto mb-6 max-w-[46ch] text-base leading-relaxed text-(--bl-muted) text-pretty">
            {t("billing.confirmedNoneBody")}
          </p>
          <Link href="/plans" className={`${planButton("PREMIUM")} px-9 py-4 text-base`}>
            {t("billing.plans")}
          </Link>
        </section>
      </BillingFrame>
    );
  }
  if (!authEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect("/signin");
  if (!stripeConfigured()) notFound();
  const lang = await currentLang();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId, {
      expand: ["invoice", "subscription", "line_items"],
    });
  } catch {
    notFound();
  }
  if (session.metadata?.userId !== user.id) notFound();
  const named = session.metadata?.tier;
  const linePrice = session.line_items?.data[0]?.price;
  const priceId = typeof linePrice === "string" ? linePrice : (linePrice?.id ?? "");
  const tier = named === "ULTRA" || named === "PREMIUM" ? named : tierOfPriceId(priceId);
  if (!tier) notFound();
  const ultra = tier === "ULTRA";
  const interval = intervalOfPriceId(priceId) ?? "month";
  const label = t(ultra ? "common.tierUltra" : "common.tierPremium");
  // On the trial the session owes nothing today: Stripe reports
  // no_payment_required and the subscription is trialing.
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  const { purchaseId } = paid ? await applyCheckoutSession(session) : { purchaseId: null };
  const plan = await planOf(tier, interval);
  const sub = typeof session.subscription === "string" ? null : session.subscription;
  const trialEnd = sub?.status === "trialing" && sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const periodEnd = sub ? new Date(Math.max(0, ...sub.items.data.map((i) => i.current_period_end)) * 1000) : null;
  const price = plan.amount === null ? "" : formatMoney(plan.amount, plan.currency, lang);
  const note = !price
    ? ""
    : trialEnd
      ? t("billing.confirmedNoteTrial", { price, date: formatDate(trialEnd, lang) })
      : periodEnd
        ? t("billing.confirmedNoteCharged", { price, date: formatDate(periodEnd, lang) })
        : "";

  const spark = ultra
    ? "billing-spark absolute rounded-full bg-[#fff7e0] shadow-[0_0_12px_3px_#f3e6c4]"
    : "billing-spark absolute rounded-full bg-white shadow-[0_0_10px_2px_#fff]";
  return (
    <BillingFrame night={ultra} back="plans" preview={view.preview}>
      <section className="billing-rise relative pt-[4vh] text-center">
        <div className={`billing-pop relative mb-2 inline-block ${ultra ? "size-[160px]" : "size-[150px]"}`}>
          <div
            className="billing-float"
            style={{
              filter: ultra
                ? "drop-shadow(0 18px 34px rgba(214,178,106,0.25))"
                : "drop-shadow(0 18px 30px rgba(120,90,50,0.25))",
            }}
          >
            <TierMark state={ultra ? "ultra" : "premium"} size={ultra ? 160 : 150} />
          </div>
          <span aria-hidden className={`${spark} top-6 left-1.5 size-2.5`} />
          <span aria-hidden className={`${spark} top-[60px] right-2.5 size-[7px] [animation-delay:0.8s]`} />
          <span aria-hidden className={`${spark} bottom-1.5 left-11 size-1.5 [animation-delay:1.5s]`} />
        </div>
        <h1 className="billing-gold-big mb-3.5 font-display text-[clamp(54px,10vw,128px)] leading-none tracking-[-0.03em] text-balance">
          {paid ? t("billing.confirmedTitle") : t("billing.confirmedProcessing")}
        </h1>
        <p className="mx-auto mb-1.5 max-w-[48ch] font-display text-[clamp(20px,2.4vw,28px)] leading-tight text-(--bl-title) text-pretty">
          {paid ? t("billing.confirmedThanks") : t("billing.confirmedProcessingBody")}
        </p>
        {paid && (
          <p className="mx-auto mb-2 max-w-[46ch] text-base leading-relaxed text-(--bl-muted) text-pretty">
            {emphasize(t("billing.confirmedBody", { tier: label }), label, "font-bold text-(--bl-title)")}
          </p>
        )}
        {paid && note && <p className="mx-auto mb-[30px] max-w-[46ch] text-[13px] leading-relaxed text-(--bl-faint)">{note}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link href="/" className={`${planButton(tier)} px-9 py-4 text-base`}>
            {t("billing.confirmedDashboard")}
          </Link>
        </div>
        <p className="mt-10 flex flex-wrap justify-center gap-4 text-xs text-(--bl-faint)">
          {purchaseId && (
            <Link href={`/billing/receipts/${purchaseId}`} className="underline hover:text-(--bl-link)">
              {t("billing.confirmedReceipt")}
            </Link>
          )}
          <Link href="/billing" className="underline hover:text-(--bl-link)">
            {t("billing.plans")}
          </Link>
        </p>
      </section>
    </BillingFrame>
  );
}
