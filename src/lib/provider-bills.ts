import { db } from "@/lib/db";
import { providerKey } from "@/lib/gateway";
import { kimiApiKey, moonshotApiUrl } from "@/lib/kimi";
import { outboundFetch } from "@/lib/outbound-fetch";

// The providers' own bills (SPEC.md §7), beside the app's own count on the
// admin usage page. The app's count is every call this app made, priced at
// list; a provider's bill is every use of the key, in this app and outside
// it, at what the provider charged. The two differ by what runs outside
// the app on the same key (a loop on a dev machine, a script, the
// provider's own console), by discounts and prepaid bundles, and by a
// list price here that is wrong. The page shows both and the gap.
//
// Anthropic: the Admin API's cost report (ANTHROPIC_ADMIN_KEY, an Admin
// API key; the Admin API needs an Organization on the Console). Moonshot:
// no spend API, a balance API; the balance is read and kept
// (ProviderBalance), and the spend is its falls between readings. Z.ai
// and Google: no API; the console has the bill.

export type DaySpend = { day: string; costUsd: number };
export type SpendRow = { label: string; costUsd: number };
export type ProviderBill = { totalUsd: number; days: DaySpend[]; byModel: SpendRow[] };

const DAY_MS = 86_400_000;
const dayOf = (at: Date | string) => new Date(at).toISOString().slice(0, 10);

// ── Anthropic ───────────────────────────────────────────────────────────────

const ANTHROPIC_API = "https://api.anthropic.com";

export function anthropicAdminKey(): string | undefined {
  const key = process.env.ANTHROPIC_ADMIN_KEY?.replace(/\s+/g, "");
  return key || undefined;
}

export function anthropicAdminConfigured(): boolean {
  return Boolean(anthropicAdminKey());
}

type CostBucket = {
  starting_at: string;
  results: { amount: string; model: string | null; cost_type: string | null; description: string | null }[];
};

/** Anthropic's bill for the last days, by day and by model, from the
    cost report: amounts come as cents in a decimal string. Throws when
    the key is missing or the API refuses. */
export async function anthropicBill(days: number): Promise<ProviderBill> {
  const key = anthropicAdminKey();
  if (!key) throw new Error("ANTHROPIC_ADMIN_KEY is not set");
  const now = Date.now();
  const startingAt = new Date(Math.floor((now - days * DAY_MS) / DAY_MS) * DAY_MS).toISOString();
  const byDay = new Map<string, number>();
  const byModel = new Map<string, number>();
  let page: string | null = null;
  for (let n = 0; n < 10; n++) {
    const params = new URLSearchParams({ starting_at: startingAt, bucket_width: "1d", limit: "31" });
    params.append("group_by[]", "description");
    if (page) params.set("page", page);
    const res = await outboundFetch(`${ANTHROPIC_API}/v1/organizations/cost_report?${params}`, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Anthropic cost report failed (HTTP ${res.status})`);
    const body = (await res.json()) as { data: CostBucket[]; has_more: boolean; next_page: string | null };
    for (const bucket of body.data) {
      const day = dayOf(bucket.starting_at);
      for (const r of bucket.results) {
        const usd = Number(r.amount) / 100;
        if (!Number.isFinite(usd)) continue;
        const label = r.model ?? (r.cost_type && r.cost_type !== "tokens" ? r.cost_type.replace(/_/g, " ") : (r.description ?? "other"));
        byDay.set(day, (byDay.get(day) ?? 0) + usd);
        byModel.set(label, (byModel.get(label) ?? 0) + usd);
      }
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return bill(byDay, byModel);
}

function bill(byDay: Map<string, number>, byModel: Map<string, number>): ProviderBill {
  const days = [...byDay].map(([day, costUsd]) => ({ day, costUsd })).sort((a, b) => a.day.localeCompare(b.day));
  const models = [...byModel].map(([label, costUsd]) => ({ label, costUsd })).sort((a, b) => b.costUsd - a.costUsd);
  return { totalUsd: days.reduce((sum, d) => sum + d.costUsd, 0), days, byModel: models };
}

// ── Moonshot ────────────────────────────────────────────────────────────────

export type MoonshotBalance = { availableUsd: number; voucherUsd: number; cashUsd: number };

// Moonshot refuses every call at this balance or under (exceeded_current_quota_error).
export const BALANCE_OUT_USD = 0;
// Under this the page says so before the calls stop.
export const BALANCE_LOW_USD = 5;

/** Moonshot's balance now, or null when no key reads it. Read with the
    provider's own key where the app has one, else through the gateway's
    Moonshot pass-through. */
export async function moonshotBalance(): Promise<MoonshotBalance | null> {
  const direct = providerKey("moonshot");
  const key = direct ?? kimiApiKey();
  if (!key) return null;
  const url = direct ? "https://api.moonshot.ai/v1/users/me/balance" : `${moonshotApiUrl()}/users/me/balance`;
  try {
    const res = await outboundFetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { available_balance?: number; voucher_balance?: number; cash_balance?: number } };
    const d = body.data;
    if (!d || typeof d.available_balance !== "number") return null;
    return { availableUsd: d.available_balance, voucherUsd: d.voucher_balance ?? 0, cashUsd: d.cash_balance ?? 0 };
  } catch (err) {
    console.warn("[provider-bills] Moonshot balance not read:", err instanceof Error ? err.message : err);
    return null;
  }
}

const SNAPSHOT_EVERY_MS = 60 * 60 * 1000;

/** Keep the balance when the last row is an hour old or older. The admin
    usage page and the daily cleanup call it; never throws. */
export async function snapshotBalances(): Promise<void> {
  try {
    const last = await db.providerBalance.findFirst({ where: { provider: "moonshot" }, orderBy: { at: "desc" }, select: { at: true } });
    if (last && Date.now() - last.at.getTime() < SNAPSHOT_EVERY_MS) return;
    const balance = await moonshotBalance();
    if (!balance) return;
    await db.providerBalance.create({ data: { provider: "moonshot", ...balance } });
  } catch (err) {
    console.warn("[provider-bills] balance not kept:", err instanceof Error ? err.message : err);
  }
}

/** Moonshot's spend over the last days as the balance's falls between
    the rows kept: a rise is a recharge and counts as nothing. One row or
    none: no spend to read, and the bill says so. */
export async function moonshotSpend(days: number): Promise<ProviderBill | null> {
  const since = new Date(Date.now() - (days + 1) * DAY_MS);
  const rows = await db.providerBalance.findMany({
    where: { provider: "moonshot", at: { gte: since } },
    orderBy: { at: "asc" },
    select: { availableUsd: true, at: true },
  });
  if (rows.length < 2) return null;
  const byDay = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const fall = rows[i - 1].availableUsd - rows[i].availableUsd;
    if (fall <= 0) continue;
    const day = dayOf(rows[i].at);
    byDay.set(day, (byDay.get(day) ?? 0) + fall);
  }
  return bill(byDay, new Map());
}
