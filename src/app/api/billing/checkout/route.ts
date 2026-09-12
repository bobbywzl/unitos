import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, authEnabled, currentUser } from "@/lib/auth";
import { createCheckout } from "@/lib/billing/checkout";
import { stripeConfigured, tierFromSlug } from "@/lib/billing/config";
import { planOf } from "@/lib/billing/plans";
import { billingUsable } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Billing (SPEC.md §24): Pay on the review page. Opens a Stripe Checkout
// session for the tier and answers its URL; the browser goes there. Off
// (the switch), 404 — except for the admin's preview.
const checkoutSchema = z.object({ tier: z.enum(["premium", "ultra"]) });

export async function POST(req: Request) {
  const t = await serverT();
  if (!(await billingUsable())) return NextResponse.json({ error: t("api.billingNotFound") }, { status: 404 });
  if (!authEnabled() || !stripeConfigured()) {
    return NextResponse.json({ error: t("api.billingNotConfigured") }, { status: 503 });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
  const { data, error } = await parseBody(req, checkoutSchema);
  if (error) return error;
  const tier = tierFromSlug(data.tier);
  if (!tier) return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  if (user.subscriptionId) {
    return NextResponse.json({ error: t("api.billingAlreadySubscribed") }, { status: 409 });
  }
  const plan = await planOf(tier);
  if (plan.error || plan.amount === null) {
    return NextResponse.json({ error: t("api.billingNotConfigured") }, { status: 503 });
  }
  try {
    const url = await createCheckout(user, tier, appOrigin(req), await currentLang());
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] checkout failed", err);
    return NextResponse.json({ error: t("api.billingCheckoutFailed") }, { status: 502 });
  }
}
