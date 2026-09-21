import Link from "next/link";
import "./plans.css";
import { billingView } from "@/lib/billing/switch";
import { serverT } from "@/lib/i18n/server";
import { PlansStory } from "@/app/plans/plans-story";
import { FunnelStepMark } from "@/components/funnel-step";
import { LangSwitcher } from "@/components/lang-switcher";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

// The plans page (SPEC.md §24): the long scroll that sells the two tiers —
// the plans story (plans-story.tsx) under a fixed nav with Back to Unitos
// and the language switcher. Public, and gated by the billing switch like
// every billing page: off, 404, except to the admin.
export default async function PlansPage() {
  const view = await billingView();
  const t = await serverT();

  return (
    <div className="plans-root">
      {/* The onboarding funnel (lib/funnel.ts): the plans step. */}
      <FunnelStepMark step="plans" />
      <div aria-hidden className="tier-band tier-band-premium" />
      <nav className="plans-nav print:hidden">
        <Link href="/" className="plans-back">
          <Logo size={16} />
          {t("billing.backToApp")}
        </Link>
        <LangSwitcher />
      </nav>
      <PlansStory preview={view.preview} />
    </div>
  );
}
