import { NextResponse } from "next/server";
import { appOrigin, authEnabled, currentUser } from "@/lib/auth";
import { stripeClient, stripeConfigured } from "@/lib/billing/stripe";
import { serverT } from "@/lib/i18n/server";

// Open the Stripe customer portal (SPEC.md §20): change the card, switch the
// interval, cancel. Answers the portal's URL. Only an account that has
// checked out once has a customer. Nothing in the reader's UI calls this yet.
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  if (!authEnabled()) return NextResponse.json({ error: t("api.billingNeedsSignIn") }, { status: 400 });
  if (!stripeConfigured()) return NextResponse.json({ error: t("api.billingOff") }, { status: 503 });
  if (!user.stripeCustomerId) {
    return NextResponse.json({ error: t("api.billingNoCustomer") }, { status: 400 });
  }
  const session = await stripeClient().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${appOrigin(req)}/settings`,
  });
  return NextResponse.json({ url: session.url });
}
