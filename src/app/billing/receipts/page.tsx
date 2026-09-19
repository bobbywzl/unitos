import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { billingView } from "@/lib/billing/switch";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { BillingFrame } from "@/components/billing/frame";
import { TierChip } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// Receipts (SPEC.md §24): one row per payment of the signed-in account,
// newest first. Each opens its receipt page.
export default async function ReceiptsPage() {
  const view = await billingView();
  if (!authEnabled()) notFound();
  const user = await currentUser();
  if (!user) redirect("/signin");
  const t = await serverT();
  const lang = await currentLang();
  const purchases = await db.purchase.findMany({
    where: { userId: user.id },
    orderBy: { paidAt: "desc" },
  });

  return (
    <BillingFrame back="plans" preview={view.preview}>
      <header className="mb-6">
        <h1 className="font-display text-[34px] text-(--bl-title)">{t("billing.receipts")}</h1>
      </header>
      {purchases.length === 0 ? (
        <p className="text-sm text-(--bl-muted)">{t("billing.receiptsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {purchases.map((p) => (
            <li key={p.id}>
              <Link
                href={`/billing/receipts/${p.id}`}
                className="billing-sheet-light flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm hover:text-(--bl-link)"
              >
                <span className="text-(--bl-title)">{formatDate(p.paidAt, lang)}</span>
                <TierChip state={p.tier === "ULTRA" ? "ultra" : "premium"} trialEndsAt={null} />
                <span className="ml-auto font-semibold text-(--bl-title)">
                  {formatMoney(p.amount, p.currency, lang)}
                </span>
                <span className="text-xs text-(--bl-muted)">
                  {t(p.status === "REFUNDED" ? "billing.statusRefunded" : "billing.statusPaid")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BillingFrame>
  );
}
