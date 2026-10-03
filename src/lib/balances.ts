import { z } from "zod";
import { db } from "@/lib/db";
import { gatewayConfigured, providerKey } from "@/lib/gateway";
import { gatewayAdminConfigured, gatewayErrorMessage, gatewayKeyInfo } from "@/lib/gateway-admin";
import { kimiApiKey, kimiConfigured, moonshotApiUrl } from "@/lib/kimi";
import { outboundFetch } from "@/lib/outbound-fetch";
import { GATEWAY_PROVIDERS, providerOf } from "@/lib/usage";

// Balances (SPEC.md §7): what each provider's prepaid credit has left, and
// a warning on the admin usage page when one runs low. A balance is the last
// reading minus the spend the app measured since (UsageEvent, at list
// prices), so it stays current between readings. A reading is live where
// the provider says its balance — Moonshot, Deepgram, DeepL's character
// limit, and the gateway's budget for the app key, read each time the usage
// page opens — and the admin's elsewhere: the figure on the provider's
// billing page, typed into the page. The runway is the balance over the
// last 7 days' spend per day.
//
// Stored as operator settings (lib/settings.ts): "balance:<key>" holds the
// last reading as JSON, "balance-warn:<key>" the warn level in USD. No row
// = no reading, and the default warn level.

export const BALANCE_PROVIDERS = [
  "zai",
  "moonshot",
  "anthropic",
  "google",
  "groq",
  "openai",
  "deepgram",
  "deepl",
  "typesafe",
] as const;
export type BalanceProvider = (typeof BALANCE_PROVIDERS)[number];
/** A provider's prepaid credit, or the gateway's budget for the app key. */
export type BalanceKey = BalanceProvider | "gateway";
export const BALANCE_KEYS: readonly BalanceKey[] = [...BALANCE_PROVIDERS, "gateway"];

/** The provider and what the app calls on it: names, never translated. The
    gateway's row is labeled by the page. */
export const BALANCE_LABELS: Record<BalanceProvider, string> = {
  zai: "Z.ai · GLM",
  moonshot: "Moonshot AI · Kimi",
  anthropic: "Anthropic · Claude",
  google: "Google · Gemini",
  groq: "Groq · Whisper",
  openai: "OpenAI · Whisper, voice",
  deepgram: "Deepgram · Nova-3",
  deepl: "DeepL",
  typesafe: "TypeSafe · Jev",
};

// Recharge now under 3 days of runway, Low under 14 or under the warn
// level; a character limit is Low from 80% used.
export const DAYS_RECHARGE = 3;
export const DAYS_LOW = 14;
export const DEFAULT_WARN_USD = 10;
const QUOTA_LOW = 0.8;
// The window the spend per day is averaged over.
const BURN_DAYS = 7;
// A provider shows with no reading when it has spend in this window.
const SHOW_DAYS = 30;
const LIVE_TIMEOUT_MS = 8_000;
// DeepL Pro without a cost limit answers a limit this large: no limit.
const NO_LIMIT_CHARS = 1e12;

const readingSchema = z.discriminatedUnion("kind", [
  // USD left at the time; resetsAt when the budget refills on its own.
  z.object({
    kind: z.literal("usd"),
    usd: z.number(),
    at: z.string(),
    source: z.enum(["live", "manual"]),
    resetsAt: z.string().nullable().optional(),
  }),
  // A character limit (DeepL): used of limit at the time.
  z.object({ kind: z.literal("chars"), used: z.number(), limit: z.number(), at: z.string(), source: z.literal("live") }),
  // Read live, and the provider has no limit to run out of.
  z.object({ kind: z.literal("none"), at: z.string(), source: z.literal("live") }),
]);
export type BalanceReading = z.infer<typeof readingSchema>;

const readingKey = (key: BalanceKey) => `balance:${key}`;
const warnKey = (key: BalanceKey) => `balance-warn:${key}`;

async function writeReading(key: BalanceKey, reading: BalanceReading): Promise<void> {
  const value = JSON.stringify(reading);
  await db.appSetting.upsert({ where: { key: readingKey(key) }, create: { key: readingKey(key), value }, update: { value } });
}

/** The admin's reading: the balance the provider's billing page shows now. */
export async function setManualBalance(key: BalanceKey, usd: number): Promise<void> {
  await writeReading(key, { kind: "usd", usd, at: new Date().toISOString(), source: "manual" });
}

export async function setWarnLevel(key: BalanceKey, usd: number): Promise<void> {
  const value = String(usd);
  await db.appSetting.upsert({ where: { key: warnKey(key) }, create: { key: warnKey(key), value }, update: { value } });
}

// ── Live readings ──────────────────────────────────────────────────────────

class BalanceError extends Error {}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await outboundFetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const body = json as { error?: { message?: string } | string; message?: string; err_msg?: string } | null;
    const reason =
      (typeof body?.error === "string" ? body.error : body?.error?.message) ??
      body?.message ??
      body?.err_msg ??
      `request failed (${res.status})`;
    throw new BalanceError(reason);
  }
  return json;
}

const moonshotSchema = z.object({ data: z.object({ available_balance: z.number() }).loose() }).loose();

// Moonshot's balance, in USD on the international platform. An account on
// the China platform (MOONSHOT_BASE_URL at moonshot.cn) is billed in CNY,
// which this page cannot convert, so it is set by hand.
async function liveMoonshot(): Promise<BalanceReading | null> {
  if (!kimiConfigured()) return null;
  const root = moonshotApiUrl();
  if (/moonshot\.cn/.test(root)) return null;
  const body = moonshotSchema.parse(
    await getJson(`${root}/users/me/balance`, { Authorization: `Bearer ${kimiApiKey() ?? ""}` }),
  );
  return { kind: "usd", usd: body.data.available_balance, at: new Date().toISOString(), source: "live" };
}

const deepgramProjectsSchema = z.object({ projects: z.array(z.object({ project_id: z.string() }).loose()) }).loose();
const deepgramBalancesSchema = z
  .object({ balances: z.array(z.object({ amount: z.number(), units: z.string() }).loose()) })
  .loose();

// Deepgram's balance: every project's USD balances, summed. DEEPGRAM_API_URL
// (a local stand-in) moves the API root with it.
async function liveDeepgram(): Promise<BalanceReading | null> {
  const key = providerKey("deepgram");
  if (!key) return null;
  const root = `${process.env.DEEPGRAM_API_URL ? new URL(process.env.DEEPGRAM_API_URL).origin : "https://api.deepgram.com"}/v1`;
  const headers = { Authorization: `Token ${key}` };
  const { projects } = deepgramProjectsSchema.parse(await getJson(`${root}/projects`, headers));
  if (projects.length === 0) throw new BalanceError("the key sees no project");
  let usd = 0;
  for (const p of projects) {
    const { balances } = deepgramBalancesSchema.parse(await getJson(`${root}/projects/${p.project_id}/balances`, headers));
    usd += balances.filter((b) => b.units.toLowerCase() === "usd").reduce((sum, b) => sum + b.amount, 0);
  }
  return { kind: "usd", usd, at: new Date().toISOString(), source: "live" };
}

const deeplUsageSchema = z.object({ character_count: z.number(), character_limit: z.number() }).loose();

// DeepL's character limit for the period. Only with the app's own key: the
// gateway's DeepL pass-through carries translations alone.
async function liveDeepl(): Promise<BalanceReading | null> {
  if (gatewayConfigured()) return null;
  const key = providerKey("deepl");
  if (!key) return null;
  const base = process.env.DEEPL_API_URL ?? (key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com");
  const body = deeplUsageSchema.parse(
    await getJson(`${base.replace(/\/$/, "")}/v2/usage`, { Authorization: `DeepL-Auth-Key ${key}` }),
  );
  const at = new Date().toISOString();
  if (body.character_limit <= 0 || body.character_limit >= NO_LIMIT_CHARS) return { kind: "none", at, source: "live" };
  return { kind: "chars", used: body.character_count, limit: body.character_limit, at, source: "live" };
}

// The gateway's budget for the app key: when its spend reaches the budget,
// the gateway refuses every AI call until the budget resets.
async function liveGateway(): Promise<BalanceReading | null> {
  if (!gatewayConfigured() || !gatewayAdminConfigured()) return null;
  const info = await gatewayKeyInfo();
  const at = new Date().toISOString();
  if (info.maxBudget === null) return { kind: "none", at, source: "live" };
  return { kind: "usd", usd: info.maxBudget - info.spend, at, source: "live", resetsAt: info.budgetResetAt };
}

const LIVE: Partial<Record<BalanceKey, () => Promise<BalanceReading | null>>> = {
  moonshot: liveMoonshot,
  deepgram: liveDeepgram,
  deepl: liveDeepl,
  gateway: liveGateway,
};

/** The failure of each live reading that failed, as a line for the page. */
export type LiveErrors = Partial<Record<BalanceKey, string>>;

/** Read every live balance now, in parallel, and store each reading. Runs
    when the usage page opens. A failure keeps the last stored reading. */
export async function refreshLiveBalances(): Promise<LiveErrors> {
  const errors: LiveErrors = {};
  await Promise.all(
    Object.entries(LIVE).map(async ([key, read]) => {
      try {
        const reading = await read!();
        if (reading) await writeReading(key as BalanceKey, reading);
      } catch (err) {
        errors[key as BalanceKey] = gatewayErrorMessage(err);
      }
    }),
  );
  return errors;
}

/** The keys whose balance is read live in this deploy. */
function liveKeys(): Set<BalanceKey> {
  const keys = new Set<BalanceKey>();
  if (kimiConfigured() && !/moonshot\.cn/.test(moonshotApiUrl())) keys.add("moonshot");
  if (providerKey("deepgram")) keys.add("deepgram");
  if (!gatewayConfigured() && providerKey("deepl")) keys.add("deepl");
  if (gatewayConfigured() && gatewayAdminConfigured()) keys.add("gateway");
  return keys;
}

// ── The balances ───────────────────────────────────────────────────────────

/** Recharge now, Low, OK, or Not set: a provider with spend and no reading. */
export type BalanceStatus = "recharge" | "low" | "ok" | "unset";

export type Balance = {
  key: BalanceKey;
  unit: "usd" | "chars";
  status: BalanceStatus;
  reading: BalanceReading | null;
  /** Read live in this deploy, so the admin sets only the warn level. */
  live: boolean;
  /** USD or characters measured since the reading. */
  spentSince: number;
  /** USD or characters left now; null with no reading. */
  left: number | null;
  /** The character limit; null for USD. */
  limit: number | null;
  /** USD or characters per day over the last 7 days. */
  perDay: number;
  /** Days until it runs out at that rate; null when nothing is spent. */
  daysLeft: number | null;
  warnUsd: number;
};

type Spend = { usd: number; chars: number };

/** Measured spend since a time, per provider: the app's records by model,
    each model's provider read from its name (lib/usage.ts). */
async function spendSince(since: Date): Promise<Map<string, Spend>> {
  const rows = await db.usageEvent.groupBy({
    by: ["model"],
    where: { createdAt: { gt: since } },
    _sum: { costUsd: true, inputTokens: true },
  });
  const out = new Map<string, Spend>();
  for (const r of rows) {
    const provider = providerOf(r.model);
    const row = out.get(provider) ?? { usd: 0, chars: 0 };
    row.usd += r._sum.costUsd ?? 0;
    // DeepL's rows count characters as inputTokens (lib/translate/deepl.ts).
    row.chars += r._sum.inputTokens ?? 0;
    out.set(provider, row);
  }
  return out;
}

/** What draws a balance down: the provider's own spend, or for the gateway's
    budget, every provider the gateway prices. */
function drawn(key: BalanceKey, spend: Map<string, Spend>): Spend {
  if (key !== "gateway") return spend.get(key) ?? { usd: 0, chars: 0 };
  let usd = 0;
  for (const [provider, s] of spend) if (GATEWAY_PROVIDERS.has(provider)) usd += s.usd;
  return { usd, chars: 0 };
}

function statusOf(b: Omit<Balance, "status">): BalanceStatus {
  if (b.left === null) return "unset";
  // A budget that resets before it would run out has runway enough.
  const resetsAt = b.reading?.kind === "usd" ? b.reading.resetsAt : null;
  const resetsFirst =
    resetsAt && b.daysLeft !== null && Date.parse(resetsAt) < Date.now() + b.daysLeft * 86_400_000;
  const days = resetsFirst ? null : b.daysLeft;
  if (b.left <= 0 || (days !== null && days < DAYS_RECHARGE)) return "recharge";
  const underLevel = b.unit === "chars" ? b.limit !== null && b.limit - b.left >= b.limit * QUOTA_LOW : b.left <= b.warnUsd;
  if (underLevel || (days !== null && days < DAYS_LOW)) return "low";
  return "ok";
}

/** Every balance worth a row: a provider with a reading, a live reading, or
    spend in the last 30 days. The stored readings only: the usage page
    calls refreshLiveBalances first. */
export async function balances(): Promise<Balance[]> {
  const now = Date.now();
  const settings = await db.appSetting.findMany({ where: { key: { startsWith: "balance" } } });
  const readings = new Map<string, BalanceReading>();
  const warns = new Map<string, number>();
  for (const s of settings) {
    if (s.key.startsWith("balance:")) {
      try {
        const parsed = readingSchema.safeParse(JSON.parse(s.value));
        if (parsed.success) readings.set(s.key.slice("balance:".length), parsed.data);
      } catch {
        /* a row that does not parse reads as no reading */
      }
    } else if (s.key.startsWith("balance-warn:")) {
      const n = Number(s.value);
      if (Number.isFinite(n) && n >= 0) warns.set(s.key.slice("balance-warn:".length), n);
    }
  }

  const first = await db.usageEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const burnDays = first ? Math.min(BURN_DAYS, Math.max(1, (now - first.createdAt.getTime()) / 86_400_000)) : BURN_DAYS;
  // One query per distinct reading time, plus the burn and show windows.
  const times = new Set<string>();
  for (const r of readings.values()) times.add(r.at);
  const [burn, recent, ...sinceRows] = await Promise.all([
    spendSince(new Date(now - BURN_DAYS * 86_400_000)),
    spendSince(new Date(now - SHOW_DAYS * 86_400_000)),
    ...[...times].map((at) => spendSince(new Date(at))),
  ]);
  const since = new Map([...times].map((at, i) => [at, sinceRows[i]]));

  const live = liveKeys();
  const out: Balance[] = [];
  for (const key of BALANCE_KEYS) {
    const reading = readings.get(key) ?? null;
    const recentSpend = drawn(key, recent);
    const shown = reading !== null || live.has(key) || recentSpend.usd > 0 || recentSpend.chars > 0;
    if (!shown || (key === "gateway" && !live.has(key))) continue;
    // A provider with no limit to run out of warns of nothing.
    if (reading?.kind === "none") continue;
    // DeepL counts characters against its limit; the rest count USD.
    const unit = reading?.kind === "chars" ? "chars" : "usd";
    const pick = (s: Spend) => (unit === "chars" ? s.chars : s.usd);
    const spentSince = reading ? pick(drawn(key, since.get(reading.at)!)) : 0;
    const perDay = pick(drawn(key, burn)) / burnDays;
    let left: number | null = null;
    let limit: number | null = null;
    if (reading?.kind === "usd") left = reading.usd - spentSince;
    if (reading?.kind === "chars") {
      limit = reading.limit;
      left = reading.limit - reading.used - spentSince;
    }
    const partial = {
      key,
      unit,
      reading,
      live: live.has(key),
      spentSince,
      left,
      limit,
      perDay,
      daysLeft: left !== null && perDay > 0 ? Math.max(0, left) / perDay : null,
      warnUsd: warns.get(key) ?? DEFAULT_WARN_USD,
    } satisfies Omit<Balance, "status">;
    out.push({ ...partial, status: statusOf(partial) });
  }
  // Recharge now first, then Low, Not set, OK.
  const rank: Record<BalanceStatus, number> = { recharge: 0, low: 1, unset: 2, ok: 3 };
  return out.sort((a, b) => rank[a.status] - rank[b.status]);
}

/** The balances that warn: Recharge now and Low. For the admin menu. Never
    throws: a failure reads as no warning. */
export async function balanceAlerts(): Promise<{ recharge: number; low: number }> {
  try {
    const all = await balances();
    return {
      recharge: all.filter((b) => b.status === "recharge").length,
      low: all.filter((b) => b.status === "low").length,
    };
  } catch {
    return { recharge: 0, low: 0 };
  }
}
