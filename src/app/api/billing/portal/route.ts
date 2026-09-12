import { NextResponse } from "next/server";
import { appOrigin, authEnabled, currentUser } from "@/lib/auth";
import { portalUrl } from "@/lib/billing/checkout";
import { stripeConfigured } from "@/lib/billing/config";
import { billingUsable } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";

// Billing (SPEC.md §24): Manage subscription. Opens the Stripe billing
// portal for the account's customer and answers its URL.
export async function POST(req: Request) {
  const t = await serverT();
  if (!(await billingUsable())) return NextResponse.json({ error: t("api.billingNotFound") }, { status: 404 });
  if (!authEnabled() || !stripeConfigured()) {
    return NextResponse.json({ error: t("api.billingNotConfigured") }, { status: 503 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
  if (!user.stripeCustomerId) {
    return NextResponse.json({ error: t("api.billingNoSubscription") }, { status: 404 });
  }
  try {
    const url = await portalUrl(user, appOrigin(req), await currentLang());
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] portal failed", err);
    return NextResponse.json({ error: t("api.billingPortalFailed") }, { status: 502 });
  }
}
