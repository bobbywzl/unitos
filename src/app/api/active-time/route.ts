import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled, currentUser } from "@/lib/auth";
import { billingLinks } from "@/lib/billing/switch";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { betaOn } from "@/lib/tiers";
import { askDue, MAX_TICK_SECONDS } from "@/lib/active-time";
import { parseBody } from "@/lib/validate";

const Body = z.object({
  // One tick of active time, in seconds. Zero is the clock's first post on
  // a page open: nothing to add, but the ask may be due already.
  seconds: z.number().int().min(0).max(MAX_TICK_SECONDS),
});

export type ActiveTimeAnswer = {
  // The billing ask opens now: the account passed ASK_AFTER_SECONDS.
  ask: boolean;
  // When the trial ends, for the ask's words. ISO; null when no ask.
  trialEndsAt: string | null;
};

// One tick of the active time clock (lib/active-time.ts): add it to the account's
// active time, then say whether the billing ask opens. The ask opens while
// billing is on (billingLinks) and outside the beta (every account has
// Ultra then), once per ASK_AGAIN_MS: billingAskedAt is stamped here, so a
// tab closed on the ask does not open it again on the next page. The local
// reader (sign-in off) has no row: nothing to add, never an ask.
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("common.signInToContinue") }, { status: 401 });
  const none: ActiveTimeAnswer = { ask: false, trialEndsAt: null };
  if (!authEnabled()) return NextResponse.json(none);

  const { data, error } = await parseBody(req, Body);
  if (error) return error;

  // A zero tick reads the row as it is: nothing to write.
  const updated =
    data.seconds > 0
      ? await db.user.update({ where: { id: user.id }, data: { activeSeconds: { increment: data.seconds } } })
      : user;
  if (betaOn() || !(await billingLinks()) || !askDue(updated)) return NextResponse.json(none);

  await db.user.update({ where: { id: user.id }, data: { billingAskedAt: new Date() } });
  const answer: ActiveTimeAnswer = { ask: true, trialEndsAt: updated.trialEndsAt?.toISOString() ?? null };
  return NextResponse.json(answer);
}
