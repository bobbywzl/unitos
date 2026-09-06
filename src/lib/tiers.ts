// The tiers (TIERS.md): Unitos Free, Unitos Premium, Unitos Ultra. This file
// has no server imports, so client components read it too. The value matches
// the Prisma enum Tier on User.tier.

export type Tier = "FREE" | "PREMIUM" | "ULTRA";
export type PaidTier = Exclude<Tier, "FREE">;

export const TIER_RANK: Record<Tier, number> = { FREE: 0, PREMIUM: 1, ULTRA: 2 };

// The product names. Not translated (zh glossary: Unitos Premium 不翻译).
export const TIER_LABEL: Record<Tier, string> = {
  FREE: "Unitos Free",
  PREMIUM: "Unitos Premium",
  ULTRA: "Unitos Ultra",
};

export function isTier(value: unknown): value is Tier {
  return value === "FREE" || value === "PREMIUM" || value === "ULTRA";
}

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

// Every Premium gate in the app asks this: Ultra holds everything Premium holds.
export function hasPremium(tier: Tier): boolean {
  return tierAtLeast(tier, "PREMIUM");
}
