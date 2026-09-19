import type { Tier } from "@prisma/client";

// The tiers (TIERS.md): every account is Unitos Premium or Unitos Ultra.
// There is no free tier. A new account gets Unitos Premium free for
// TRIAL_MONTHS (User.trialEndsAt); the operator grants a tier for good by
// clearing trialEndsAt or setting ULTRA; billing (SPEC.md §24) writes the
// same two columns. During the beta (betaOn) every account has Ultra in the
// app, whatever its record says. This file has no server imports: client
// components read the same rules.

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

/** The beta (TIERS.md): while BETA is "on", every account has Unitos Ultra
    in the app — every gate opens and every tier mark is the black diamond —
    whatever its record says. Billing (SPEC.md §24) keeps reading the record
    (tierState): a purchase is recorded now and takes effect when BETA is
    unset. Read on the server; the client reads the state the server
    computed (CollabState, the plan prop), never this. */
export function betaOn(): boolean {
  return process.env.BETA === "on";
}

/** Unitos Premium features are on: Ultra, granted Premium, a running trial,
    or the beta. */
export function premiumActive(user: TierFields, now = new Date()): boolean {
  return accountTier(user, true, now) !== "expired";
}

/** Unitos Ultra features are on: the operator set Ultra, or the beta. Ultra
    does not expire. */
export function ultraActive(user: TierFields, now = new Date()): boolean {
  return accountTier(user, true, now) === "ultra";
}

/** The account's state as the app reads it — every gate, every tier mark,
    the reader, the notes page, the dashboard, Settings — so no surface can
    disagree with another: the record (tierState), or Ultra during the beta
    (betaOn) and with sign-in off (the local reader: there is no account to
    gate). The billing pages and the admin's Tier control read the record
    itself. */
export function accountTier(user: TierFields, authOn: boolean, now = new Date()): TierState {
  return authOn && !betaOn() ? tierState(user, now) : "ultra";
}

/** The tier a state belongs to: trial and expired are Unitos Premium states. */
export function tierOf(state: TierState): Tier {
  return state === "ultra" ? "ULTRA" : "PREMIUM";
}

/** Storage per tier (TIERS.md): the bytes an account's documents, images,
    and videos may take, per account. Not set yet: null. Settings shows what
    is used either way, and the bar fills against the limit once one is set
    here. Nothing gates on it yet. */
export const STORAGE_LIMIT_BYTES: Record<Tier, number | null> = {
  PREMIUM: null,
  ULTRA: null,
};

/** The storage limit the account's state carries; null while unset. */
export function storageLimit(state: TierState): number | null {
  return STORAGE_LIMIT_BYTES[tierOf(state)];
}
