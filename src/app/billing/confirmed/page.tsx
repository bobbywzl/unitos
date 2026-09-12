import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { stripeConfigured, tierOfPriceId } from "@/lib/billing/config";
import { applyCheckoutSession } from "@/lib/billing/events";
import { planOf } from "@/lib/billing/plans";
import { stripe, type Stripe } from "@/lib/billing/stripe";
import { billingView } from "@/lib/billing/switch";
import { serverT } from "@/lib/i18n/server";
import { PlanCard, planButton } from "@/components/billing/plan-card";

export const dynamic = "force-dynamic";

// The confirmation page (SPEC.md §24): Stripe returns here with the checkout
// session id. The session must belong to the signed-in account. Paid, the
// purchase is recorded here at once (the same idempotent path as the
// webhook), so the tier is on before the webhook lands; the receipt link
// goes to the row. Not yet paid (a bank transfer settling), the page says so.
export default async function ConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  await billingView();
  if (!authEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { session: sessionId } = await searchParams;
  if (!sessionId) redirect("/billing");
  if (!stripeConfigured()) notFound();
  const t = await serverT();

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
  const tier =
    named === "ULTRA" || named === "PREMIUM"
      ? named
      : tierOfPriceId(typeof linePrice === "string" ? linePrice : (linePrice?.id ?? ""));
  if (!tier) notFound();
  const label = t(tier === "ULTRA" ? "common.tierUltra" : "common.tierPremium");
  const paid = session.payment_status === "paid";
  const { purchaseId } = paid ? await applyCheckoutSession(session) : { purchaseId: null };
  const plan = await planOf(tier);

  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-[34px]">
          {paid ? t("billing.confirmedTitle") : t("billing.confirmedProcessing")}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-sand-800">
          {paid ? t("billing.confirmedBody", { tier: label }) : t("billing.confirmedProcessingBody")}
        </p>
      </header>
      <div className="grid gap-5 sm:grid-cols-2">
        <PlanCard tier={tier} price={plan}>
          <Link href="/" className={planButton}>
            {t("billing.confirmedOpenApp")}
          </Link>
          <Link
            href={purchaseId ? `/billing/receipts/${purchaseId}` : "/billing/receipts"}
            className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold text-sand-700 shadow-soft hover:text-clay-800"
          >
            {t("billing.confirmedReceipt")}
          </Link>
        </PlanCard>
      </div>
    </>
  );
}
