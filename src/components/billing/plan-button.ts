import type { Tier } from "@prisma/client";

// The main button on a plan card, on the order page, and on the
// confirmation page (SPEC.md §24): clay for Unitos Premium, gold for Unitos
// Ultra. A plain function, so server pages and client components share it.
export function planButton(tier: Tier): string {
  return `inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-40 ${
    tier === "ULTRA" ? "billing-btn-gold" : "billing-btn-clay"
  }`;
}
