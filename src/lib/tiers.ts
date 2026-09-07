import type { Tier } from "@prisma/client";

// The tiers (TIERS.md): every account is Unitos Premium or Unitos Ultra.
// There is no free tier. A new account gets Unitos Premium free for
// TRIAL_MONTHS (User.trialEndsAt); the operator grants a tier for good by
// clearing trialEndsAt or setting ULTRA. No billing yet. This file has no
// server imports: client components read the same rules.

export const TRIAL_MONTHS = 2;

/** The account's tier fields, as the checks read them. */
export type TierFields = { tier: Tier; trialEndsAt: Date | null };

/** When a trial that starts at `from` ends. */
export function trialEnd(from: Date): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + TRIAL_MONTHS);
  return end;
}

/** The account's state, for Settings and the admin page.
    trial: Premium, on the free trial. premium: Premium, granted.
    ultra: Ultra. expired: the trial ended and nothing was granted. */
export type TierState = "trial" | "premium" | "ultra" | "expired";

export function tierState(user: TierFields, now = new Date()): TierState {
  if (user.tier === "ULTRA") return "ultra";
  if (user.trialEndsAt === null) return "premium";
  return user.trialEndsAt > now ? "trial" : "expired";
}

/** Unitos Premium features are on: Ultra, granted Premium, or a running trial. */
export function premiumActive(user: TierFields, now = new Date()): boolean {
  return tierState(user, now) !== "expired";
}

/** Unitos Ultra features are on. Ultra does not expire: the operator sets it. */
export function ultraActive(user: TierFields): boolean {
  return user.tier === "ULTRA";
}
