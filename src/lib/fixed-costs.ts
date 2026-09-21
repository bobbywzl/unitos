// The fixed costs (SPEC.md §7): what running Unitos costs each month
// whatever its use — the subscriptions the operator pays outside the AI
// providers. The admin usage page adds them to the AI cost for the
// spending estimate per month and per year. Edit the list here; there is
// no page for it.

export type FixedCost = { label: string; usdPerMonth: number };

export const FIXED_COSTS: FixedCost[] = [
  { label: "Claude Max", usdPerMonth: 200 },
  { label: "Google Workspace", usdPerMonth: 7 },
];

export const MONTHS_PER_YEAR = 12;

export function fixedCostsPerMonth(): number {
  return FIXED_COSTS.reduce((sum, c) => sum + c.usdPerMonth, 0);
}
