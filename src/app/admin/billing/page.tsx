import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { billingConfigured, priceIdOf, stripeConfigured, webhookConfigured } from "@/lib/billing/config";
import { formatDate, formatMoney, priceLine } from "@/lib/billing/format";
import { plans } from "@/lib/billing/plans";
import { billingOn } from "@/lib/billing/switch";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { BillingSwitch } from "@/components/admin/billing-switch";
import { TierChip } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// Admin: billing (SPEC.md §24). The switch that turns the payment pipeline
// on, the Stripe values and whether each is set, the webhook URL to register,
// the two prices as Stripe reports them, and every receipt.
export default async function AdminBillingPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  const t = await serverT();
  const lang = await currentLang();
  const [on, all, purchases, subscribed] = await Promise.all([
    billingOn(),
    plans(),
    db.purchase.findMany({
      orderBy: { paidAt: "desc" },
      take: 100,
      include: { user: { select: { name: true, email: true } } },
    }),
    db.user.count({ where: { subscriptionId: { not: "" } } }),
  ]);
  const pricesReady = all.every((p) => p.error === "" && p.amount !== null);
  const ready = authEnabled() && billingConfigured() && pricesReady;
  const reason = !authEnabled()
    ? t("admin.billingNeedsSignIn")
    : !billingConfigured()
      ? t("admin.billingNeedsEnv")
      : !pricesReady
        ? t("admin.billingNeedsPrices")
        : "";

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const webhookUrl = `${proto}://${host}/api/billing/webhook`;

  const services: { label: string; description: string; set: boolean }[] = [
    { label: "STRIPE_SECRET_KEY", description: t("admin.svcStripe"), set: stripeConfigured() },
    { label: "STRIPE_WEBHOOK_SECRET", description: t("admin.svcStripeWebhook"), set: webhookConfigured() },
    { label: "STRIPE_PRICE_PREMIUM", description: t("admin.svcPricePremium"), set: priceIdOf("PREMIUM") !== "" },
    { label: "STRIPE_PRICE_ULTRA", description: t("admin.svcPriceUltra"), set: priceIdOf("ULTRA") !== "" },
  ];
  const heading = "mb-2 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase";

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <AdminNav active="billing" />
      <header className="mb-6">
        <h1 className="text-[28px]">{t("admin.billing")}</h1>
        <p className="text-sm text-sand-600">{t("admin.billingDesc")}</p>
      </header>

      <section className="mb-8">
        <h2 className={heading}>{t("admin.billingSwitch")}</h2>
        <div className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-soft">
          <BillingSwitch on={on} ready={ready} reason={reason} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-xs">
            <Link href="/billing" target="_blank" className="text-sand-600 underline hover:text-clay-700">
              {t("admin.billingPreview")}
            </Link>
            <span className="text-sand-500">{t("admin.billingSubscribed", { n: subscribed })}</span>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className={heading}>{t("admin.services")}</h2>
        <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
          {services.map((svc) => (
            <div key={svc.label} className="flex items-center justify-between gap-4 py-2">
              <div>
                <div className="font-mono text-sm">{svc.label}</div>
                <div className="text-xs text-sand-600">{svc.description}</div>
              </div>
              <span
                className={`rounded-full px-3 py-0.5 text-xs font-semibold ${
                  svc.set ? "bg-sage-200 text-sage-800" : "bg-sand-200 text-sand-600"
                }`}
              >
                {svc.set ? t("admin.svcSet") : t("admin.svcNotSet")}
              </span>
            </div>
          ))}
          <div className="border-t border-line py-2">
            <div className="text-xs font-semibold text-sand-800">{t("admin.billingWebhook")}</div>
            <div className="font-mono text-sm break-all">{webhookUrl}</div>
            <p className="text-xs text-sand-600">{t("admin.billingWebhookDesc")}</p>
          </div>
        </div>
      </section>

      <section className="mb-8">
        <h2 className={heading}>{t("admin.billingPrices")}</h2>
        <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
          {all.map((p) => (
            <div key={p.tier} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <TierChip state={p.tier === "ULTRA" ? "ultra" : "premium"} trialEndsAt={null} />
              <span className="font-mono text-xs text-sand-600">{p.priceId || "—"}</span>
              <span className={`ml-auto text-sm ${p.error ? "text-red-600" : "text-sand-800"}`}>
                {p.error ? t("admin.billingPriceError", { reason: p.error }) : priceLine(t, lang, p)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className={heading}>{t("admin.billingReceipts")}</h2>
        {purchases.length === 0 ? (
          <p className="text-sm text-sand-600">{t("admin.billingReceiptsEmpty")}</p>
        ) : (
          <div className="rounded-2xl bg-card px-4 py-2 shadow-soft">
            {purchases.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-3 border-t border-line py-2 text-sm first:border-t-0"
              >
                <span className="text-sand-800">{formatDate(p.paidAt, lang)}</span>
                <span className="truncate text-xs text-sand-600">{p.user.name || p.user.email}</span>
                <TierChip state={p.tier === "ULTRA" ? "ultra" : "premium"} trialEndsAt={null} />
                <span className="ml-auto font-semibold text-sand-800">
                  {formatMoney(p.amount, p.currency, lang)}
                </span>
                <span className="text-xs text-sand-600">
                  {t(p.status === "REFUNDED" ? "billing.statusRefunded" : "billing.statusPaid")}
                </span>
                <span className="font-mono text-[11px] text-sand-500">{p.number || p.stripeInvoiceId}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
