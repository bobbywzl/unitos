import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { billingConfigured } from "@/lib/billing/config";
import { plansReady } from "@/lib/billing/plans";
import { billingOn, setBillingOn } from "@/lib/billing/switch";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Admin: the billing switch (SPEC.md §24). On needs sign-in on, every
// STRIPE_* value set, and both prices read from Stripe; the refusal names
// what is missing. Off always works: the pages 404 and the links go on the
// next page load. Subscriptions Stripe already holds keep renewing either way.
const switchSchema = z.object({ on: z.boolean() });

export async function POST(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, switchSchema);
  if (error) return error;
  if (data.on) {
    if (!authEnabled()) return NextResponse.json({ error: t("admin.billingNeedsSignIn") }, { status: 409 });
    if (!billingConfigured()) {
      return NextResponse.json({ error: t("admin.billingNeedsEnv") }, { status: 409 });
    }
    if (!(await plansReady())) {
      return NextResponse.json({ error: t("admin.billingNeedsPrices") }, { status: 409 });
    }
  }
  await setBillingOn(data.on);
  return NextResponse.json({ ok: true, on: await billingOn() });
}
