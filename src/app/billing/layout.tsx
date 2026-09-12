import Link from "next/link";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";
import { billingView } from "@/lib/billing/switch";
import { serverT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

// Billing (SPEC.md §24) lives under /billing, outside the app's own pages:
// the plan page, the order page, the confirmation page, and the receipts
// share this frame. The gate is here: while the switch is off the whole
// tree answers 404, except to the admin, who sees it as a preview.
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  const view = await billingView();
  const t = await serverT();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-3 print:hidden">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <Logo size={16} />
          {t("billing.backToApp")}
        </Link>
        <LangSwitcher />
      </div>
      {view.preview && (
        <p className="mb-6 rounded-2xl bg-sand-100 px-4 py-3 text-xs text-sand-700 print:hidden">
          {t("billing.preview")}
        </p>
      )}
      {children}
    </main>
  );
}
