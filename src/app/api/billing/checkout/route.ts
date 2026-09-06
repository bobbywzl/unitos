import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, authEnabled, currentUser } from "@/lib/auth";
import { priceIdFor, stripeClient, stripeConfigured } from "@/lib/billing/stripe";
import { ensureCustomer } from "@/lib/billing/sync";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// Start a Stripe Checkout for a tier (SPEC.md §20): answers the hosted page's
// URL. The subscription carries userId and tier in its metadata, so the
// webhook lands it on the account even if the price id is later rotated.
// Nothing in the reader's UI calls this yet.

const schema = z.object({
  tier: z.enum(["PREMIUM", "ULTRA"]),
  interval: z.enum(["month", "year"]),
});

export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  if (!authEnabled()) return NextResponse.json({ error: t("api.billingNeedsSignIn") }, { status: 400 });
  if (!stripeConfigured()) return NextResponse.json({ error: t("api.billingOff") }, { status: 503 });
  const { data, error } = await parseBody(req, schema);
  if (error) return error;

  const price = priceIdFor(data.tier, data.interval);
  if (!price) return NextResponse.json({ error: t("api.billingPriceMissing") }, { status: 400 });

  const customer = await ensureCustomer(user);
  const origin = appOrigin(req);
  const session = await stripeClient().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: user.id,
    line_items: [{ price, quantity: 1 }],
    success_url: `${origin}/settings?billing=done`,
    cancel_url: `${origin}/settings`,
    allow_promotion_codes: true,
    metadata: { userId: user.id, tier: data.tier },
    subscription_data: { metadata: { userId: user.id, tier: data.tier } },
  });
  return NextResponse.json({ url: session.url });
}
