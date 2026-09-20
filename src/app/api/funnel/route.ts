import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { FUNNEL_PAGE_STEPS } from "@/lib/funnel";
import { recordFunnelStep } from "@/lib/funnel-record";
import { parseBody } from "@/lib/validate";

// The onboarding funnel (lib/funnel.ts): the browser posts the page step it
// opened; the row carries the visitor cookie and the signed-in account. The
// steps the server records itself (account, checkout, subscribed) are
// refused here, so a browser cannot claim them. Public in the middleware:
// the sign-in page posts signed out. Best-effort: the client drops a post
// this route refuses.
const funnelSchema = z.object({ step: z.enum(FUNNEL_PAGE_STEPS) });

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, funnelSchema);
  if (error) return error;
  const user = await currentUser();
  await recordFunnelStep(data.step, user?.id ?? null);
  return NextResponse.json({ ok: true }, { status: 201 });
}
