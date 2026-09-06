import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripeClient, stripeConfigured, webhookConfigured } from "@/lib/billing/stripe";
import { handleEvent } from "@/lib/billing/sync";
import { db } from "@/lib/db";

// Stripe webhook (SPEC.md §20). Stripe signs the raw body; the signature is
// checked before anything is read. An event already in StripeEvent is a
// redelivery: 200, nothing done. A handler that throws answers 500 so Stripe
// retries — the event is recorded only after its handler finishes.
export async function POST(req: Request) {
  if (!stripeConfigured() || !webhookConfigured()) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const seen = await db.stripeEvent.findUnique({ where: { id: event.id }, select: { id: true } });
  if (seen) return NextResponse.json({ ok: true, skipped: true });

  try {
    const handled = await handleEvent(event);
    await db.stripeEvent
      .create({ data: { id: event.id, type: event.type } })
      .catch(() => {}); // a concurrent delivery recorded it first; the upserts landed the same
    return NextResponse.json({ ok: true, handled });
  } catch (err) {
    console.error(`[billing] ${event.type} ${event.id} failed`, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
