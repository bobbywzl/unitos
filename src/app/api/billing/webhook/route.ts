import { NextResponse } from "next/server";
import { applyStripeEvent } from "@/lib/billing/events";
import { stripe } from "@/lib/billing/stripe";

// Billing (SPEC.md §24): the endpoint Stripe posts events to. Register it in
// Stripe as <origin>/api/billing/webhook with the events lib/billing/events.ts
// handles; STRIPE_WEBHOOK_SECRET is its signing secret. The middleware lets
// it through without a session: Stripe has none. It runs whatever the
// switch says — a payment that happened is recorded.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const raw = await req.text();
  let event;
  try {
    event = await stripe().webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    console.error("[billing] webhook signature failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    await applyStripeEvent(event);
  } catch (err) {
    // 500 makes Stripe retry the event.
    console.error(`[billing] webhook ${event.type} failed`, err);
    return NextResponse.json({ error: "Event failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
