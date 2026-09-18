import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/billing/format";
import { billingView } from "@/lib/billing/switch";
import { db } from "@/lib/db";
import { currentLang, serverT } from "@/lib/i18n/server";
import { TierChip } from "@/components/tier-mark";

export const dynamic = "force-dynamic";

// Receipts (SPEC.md §24): one row per payment of the signed-in account,
// newest first. Each opens its receipt page.
export default async function ReceiptsPage() {
  await billingView();
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
    <>
      <header className="mb-6">
        <h1 className="font-display text-[34px]">{t("billing.receipts")}</h1>
      </header>
      {purchases.length === 0 ? (
        <p className="text-sm text-sand-600">{t("billing.receiptsEmpty")}</p>
      ) : (
        <ul className="space-y-2">
          {purchases.map((p) => (
            <li key={p.id}>
              <Link
                href={`/billing/receipts/${p.id}`}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm shadow-soft hover:bg-clay-100"
              >
                <span className="text-sand-800">{formatDate(p.paidAt, lang)}</span>
                <TierChip state={p.tier === "ULTRA" ? "ultra" : "premium"} trialEndsAt={null} />
                <span className="ml-auto font-semibold text-sand-800">
                  {formatMoney(p.amount, p.currency, lang)}
                </span>
                <span className="text-xs text-sand-600">
                  {t(p.status === "REFUNDED" ? "billing.statusRefunded" : "billing.statusPaid")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
