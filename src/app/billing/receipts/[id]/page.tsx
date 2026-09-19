import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { billingView } from "@/lib/billing/switch";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { Logo } from "@/components/logo";
import { BillingFrame } from "@/components/billing/frame";
import { PrintButton } from "@/components/billing/print-button";
import { TierChip } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// The receipt page (SPEC.md §24): one payment — number, date, account, tier,
// period, amount, status — with Stripe's PDF and invoice page, and Print.
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const view = await billingView();
  if (!authEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { id } = await params;
  const purchase = await db.purchase.findFirst({ where: { id, userId: user.id } });
  if (!purchase) notFound();
  const t = await serverT();
  const lang = await currentLang();

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t("billing.receiptNumber"), value: purchase.number || purchase.stripeInvoiceId },
    { label: t("billing.receiptDate"), value: formatDate(purchase.paidAt, lang) },
    { label: t("billing.receiptAccount"), value: user.email },
    {
      label: t("billing.receiptTier"),
      value: <TierChip state={purchase.tier === "ULTRA" ? "ultra" : "premium"} trialEndsAt={null} />,
    },
    {
      label: t("billing.receiptPeriod"),
      value: t("billing.receiptPeriodRange", {
        from: formatDate(purchase.periodStart, lang),
        to: formatDate(purchase.periodEnd, lang),
      }),
    },
    {
      label: t("billing.receiptAmount"),
      value: <span className="font-semibold">{formatMoney(purchase.amount, purchase.currency, lang)}</span>,
    },
    {
      label: t("billing.receiptStatus"),
      value: t(purchase.status === "REFUNDED" ? "billing.statusRefunded" : "billing.statusPaid"),
    },
  ];
  const link =
    "rounded-full bg-(--bl-pill) px-4 py-1.5 text-xs font-semibold text-(--bl-muted) shadow-(--bl-pill-shadow) hover:text-(--bl-link)";

  return (
    <BillingFrame back="plans" preview={view.preview}>
      <header className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <h1 className="font-display text-[34px] text-(--bl-title)">{t("billing.receiptTitle")}</h1>
        <Link href="/billing/receipts" className={link}>
          {t("billing.receipts")}
        </Link>
      </header>
      <section className="billing-sheet-light rounded-2xl p-6 print:shadow-none">
        <div className="mb-4 flex items-center gap-2">
          <Logo size={22} className="text-clay" />
          <span className="font-display text-[19px] text-(--bl-title)">{t("common.appName")}</span>
          <span className="ml-auto text-xs text-(--bl-faint)">{t("billing.receiptTitle")}</span>
        </div>
        <dl>
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between gap-4 border-t border-(--bl-line) py-2.5 text-sm"
            >
              <dt className="text-(--bl-muted)">{r.label}</dt>
              <dd className="text-right text-(--bl-title)">{r.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[11px] text-(--bl-faint)">{t("billing.receiptIssuer")}</p>
      </section>
      <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
        {purchase.invoicePdfUrl && (
          <a href={purchase.invoicePdfUrl} className={link} target="_blank" rel="noopener noreferrer">
            {t("billing.receiptPdf")}
          </a>
        )}
        {purchase.hostedInvoiceUrl && (
          <a href={purchase.hostedInvoiceUrl} className={link} target="_blank" rel="noopener noreferrer">
            {t("billing.receiptStripe")}
          </a>
        )}
        <PrintButton />
      </div>
    </BillingFrame>
  );
}
