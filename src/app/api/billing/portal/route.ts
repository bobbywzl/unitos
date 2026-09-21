import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, authEnabled, currentUser } from "@/lib/auth";
import { portalUrl } from "@/lib/billing/checkout";
import { stripeConfigured } from "@/lib/billing/config";
import { billingUsable } from "@/lib/billing/switch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const Body = z.object({
  // Which page of the portal opens: its home, or one flow (PortalFlow).
  flow: z.enum(["update", "payment", "cancel"]).optional(),
  // Where Stripe returns to: the plan page, or the subscription panel.
  back: z.enum(["billing", "settings"]).default("billing"),
});

// Billing (SPEC.md §24): Manage subscription, Change plan, Update card, and
// Cancel subscription. Opens the Stripe billing portal for the account's
// customer, at the flow asked for, and answers its URL.
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
  const { data, error } = await parseBody(req, Body);
  if (error) return error;
  try {
    const url = await portalUrl(user, appOrigin(req), await currentLang(), {
      flow: data.flow,
      returnPath: data.back === "settings" ? "/settings" : "/billing",
    });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] portal failed", err);
    return NextResponse.json({ error: t("api.billingPortalFailed") }, { status: 502 });
  }
}
