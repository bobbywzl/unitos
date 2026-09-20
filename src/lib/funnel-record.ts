import { cookies } from "next/headers";
import { VISITOR_COOKIE } from "@/lib/constants";
import { db } from "@/lib/db";
import type { FunnelStep } from "@/lib/funnel";

// Record one funnel step (lib/funnel.ts) from the server: the API route for
// the page steps, and the places account, checkout, and subscribed happen.
// The visitor id is the request's cookie when there is a request with one;
// a webhook has none, and the row then carries the account alone. Never
// throws: the funnel is telemetry, and a failed row must not fail a sign-in
// or a payment.
export async function recordFunnelStep(step: FunnelStep, userId: string | null): Promise<void> {
  let visitorId: string | null = null;
  try {
    visitorId = (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
  } catch {
    // no request scope: a background job
  }
  if (visitorId && !/^[a-f0-9-]{1,64}$/.test(visitorId)) visitorId = null;
  try {
    await db.funnelEvent.create({ data: { step, visitorId, userId } });
  } catch (err) {
    console.error(`[funnel] ${step} not recorded`, err);
  }
}
