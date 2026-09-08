import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { tierState } from "@/lib/tiers";
import { parseBody } from "@/lib/validate";

// Admin: set one account's tier (TIERS.md). The three plans the operator can
// grant: Unitos Ultra (never expires), Unitos Premium for good (no trial
// end), or Unitos Premium on a trial until a date — a past date ends the
// trial now. Every gate reads User.tier and User.trialEndsAt on each request,
// so the server side takes effect at once; the account's open pages read
// the tier on their next load.
const tierSchema = z.discriminatedUnion("plan", [
  z.object({ userId: z.string().min(1).max(100), plan: z.literal("ultra") }),
  z.object({ userId: z.string().min(1).max(100), plan: z.literal("premium") }),
  z.object({
    userId: z.string().min(1).max(100),
    plan: z.literal("trial"),
    trialEndsAt: z.iso.datetime(),
  }),
]);

export async function POST(req: Request) {
  const t = await serverT();
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, tierSchema);
  if (error) return error;

  const fields =
    data.plan === "ultra"
      ? { tier: "ULTRA" as const, trialEndsAt: null }
      : data.plan === "premium"
        ? { tier: "PREMIUM" as const, trialEndsAt: null }
        : { tier: "PREMIUM" as const, trialEndsAt: new Date(data.trialEndsAt) };
  const user = await db.user
    .update({ where: { id: data.userId }, data: fields, select: { tier: true, trialEndsAt: true } })
    .catch(() => null);
  if (!user) return NextResponse.json({ error: t("api.accountNotFound") }, { status: 404 });
  return NextResponse.json({ ok: true, state: tierState(user) });
}
