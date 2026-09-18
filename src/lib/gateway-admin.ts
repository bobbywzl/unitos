import { z } from "zod";
import { gatewayAdminKey, gatewayBaseUrl, gatewayKey } from "@/lib/gateway";
import { outboundFetch } from "@/lib/outbound-fetch";

// The gateway's management API, for the admin console alone (SPEC.md §2):
// what the gateway page reads — readiness, the models and their limits and
// prices, the router's fallbacks, the app key's limits and spend, spend per
// day, model, provider, function, and account — and what it writes: the app
// key, and the app key's limits. Every call authenticates with the master
// key (LITELLM_ADMIN_KEY). Nothing here runs on a reader's request.

export function gatewayAdminConfigured(): boolean {
  return Boolean(gatewayBaseUrl() && gatewayAdminKey());
}

class GatewayError extends Error {}

async function call<S extends z.ZodType>(
  path: string,
  schema: S,
  init: { method?: "GET" | "POST"; body?: unknown; auth?: boolean; timeoutMs?: number } = {},
): Promise<z.infer<S>> {
  const base = gatewayBaseUrl();
  if (!base) throw new GatewayError("LITELLM_BASE_URL is not set");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.auth !== false) {
    const admin = gatewayAdminKey();
    if (!admin) throw new GatewayError("LITELLM_ADMIN_KEY is not set");
    headers.Authorization = `Bearer ${admin}`;
  }
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await outboundFetch(`${base}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (json as { detail?: unknown; error?: { message?: string } } | null) ?? null;
    const reason =
      typeof detail?.detail === "string"
        ? detail.detail
        : (detail?.error?.message ?? `request failed (${res.status})`);
    throw new GatewayError(reason);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new GatewayError(`unexpected answer from ${path}`);
  return parsed.data;
}

/** A failure as a readable line for the page: never a stack, never a key. */
export function gatewayErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

// ── Readiness (no key) ─────────────────────────────────────────────────────

const readinessSchema = z
  .object({
    status: z.string().optional(),
    db: z.string().optional(),
    litellm_version: z.string().optional(),
  })
  .loose();

export type GatewayReadiness = { status: string; db: string; version: string };

export async function gatewayReadiness(): Promise<GatewayReadiness> {
  const body = await call("/health/readiness", readinessSchema, { auth: false });
  // The public probe says status and db alone; the version is on the
  // authenticated details, read when the master key is set.
  let version = body.litellm_version ?? "";
  if (!version && gatewayAdminKey()) {
    try {
      version = (await call("/health/readiness/details", readinessSchema)).litellm_version ?? "";
    } catch {
      /* the tile shows a dash */
    }
  }
  return { status: body.status ?? "unknown", db: body.db ?? "unknown", version };
}

// ── Models, limits, prices, fallbacks ──────────────────────────────────────

const num = z.number().nullable().optional();

const modelInfoSchema = z.object({
  data: z.array(
    z
      .object({
        model_name: z.string(),
        litellm_params: z
          .object({ model: z.string().optional(), rpm: num, tpm: num })
          .loose()
          .optional(),
        model_info: z
          .object({
            input_cost_per_token: num,
            output_cost_per_token: num,
            cache_read_input_token_cost: num,
            mode: z.string().nullable().optional(),
            litellm_provider: z.string().nullable().optional(),
            rpm: num,
            tpm: num,
          })
          .loose()
          .optional(),
      })
      .loose(),
  ),
});

export type GatewayModel = {
  name: string;
  upstream: string;
  provider: string;
  mode: string;
  rpm: number | null;
  tpm: number | null;
  /** USD per 1M tokens; null when the gateway has no price for it. */
  inputPerM: number | null;
  outputPerM: number | null;
};

export async function gatewayModels(): Promise<GatewayModel[]> {
  const body = await call("/model/info", modelInfoSchema);
  const perM = (v: number | null | undefined) => (typeof v === "number" ? v * 1_000_000 : null);
  return body.data
    .map((m) => ({
      name: m.model_name,
      upstream: m.litellm_params?.model ?? "",
      provider: m.model_info?.litellm_provider ?? (m.litellm_params?.model ?? "").split("/")[0],
      mode: m.model_info?.mode ?? "",
      rpm: m.litellm_params?.rpm ?? m.model_info?.rpm ?? null,
      tpm: m.litellm_params?.tpm ?? m.model_info?.tpm ?? null,
      inputPerM: perM(m.model_info?.input_cost_per_token),
      outputPerM: perM(m.model_info?.output_cost_per_token),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const routerSettingsSchema = z.object({ current_values: z.record(z.string(), z.unknown()) }).loose();

export type GatewayFallback = { from: string; to: string[] };

export type GatewayRouter = {
  fallbacks: GatewayFallback[];
  retries: number | null;
  timeoutSeconds: number | null;
};

// The router's fallbacks come as a list of one-key objects:
// [{"moonshot/kimi-k3": ["anthropic/claude-opus-5"]}].
function readFallbacks(value: unknown): GatewayFallback[] {
  if (!Array.isArray(value)) return [];
  const out: GatewayFallback[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    for (const [from, to] of Object.entries(entry as Record<string, unknown>)) {
      if (Array.isArray(to)) out.push({ from, to: to.map(String) });
    }
  }
  return out;
}

export async function gatewayRouter(): Promise<GatewayRouter> {
  const body = await call("/router/settings", routerSettingsSchema);
  const v = body.current_values;
  const n = (x: unknown) => (typeof x === "number" ? x : null);
  return {
    fallbacks: readFallbacks(v.fallbacks),
    retries: n(v.num_retries),
    timeoutSeconds: n(v.timeout) ?? n(v.request_timeout),
  };
}

// ── The app key ────────────────────────────────────────────────────────────

const keyInfoSchema = z
  .object({
    info: z
      .object({
        key_alias: z.string().nullable().optional(),
        spend: num,
        max_budget: num,
        budget_duration: z.string().nullable().optional(),
        budget_reset_at: z.string().nullable().optional(),
        rpm_limit: num,
        tpm_limit: num,
        max_parallel_requests: num,
        models: z.array(z.string()).nullable().optional(),
        blocked: z.boolean().nullable().optional(),
        expires: z.string().nullable().optional(),
      })
      .loose(),
  })
  .loose();

export type GatewayKeyInfo = {
  alias: string;
  spend: number;
  maxBudget: number | null;
  budgetDuration: string | null;
  budgetResetAt: string | null;
  rpm: number | null;
  tpm: number | null;
  models: string[];
  blocked: boolean;
};

/** The app key's row: what LITELLM_API_KEY may spend and how fast. */
export async function gatewayKeyInfo(): Promise<GatewayKeyInfo> {
  const key = gatewayKey();
  if (!key) throw new GatewayError("LITELLM_API_KEY is not set");
  const body = await call(`/key/info?key=${encodeURIComponent(key)}`, keyInfoSchema);
  const i = body.info;
  return {
    alias: i.key_alias ?? "",
    spend: i.spend ?? 0,
    maxBudget: i.max_budget ?? null,
    budgetDuration: i.budget_duration ?? null,
    budgetResetAt: i.budget_reset_at ?? null,
    rpm: i.rpm_limit ?? null,
    tpm: i.tpm_limit ?? null,
    models: i.models ?? [],
    blocked: i.blocked ?? false,
  };
}

export type GatewayKeyLimits = {
  rpm: number | null;
  tpm: number | null;
  maxBudget: number | null;
  /** "30d", "1h", … ; null = the budget never resets. */
  budgetDuration: string | null;
};

const generatedKeySchema = z.object({ key: z.string() }).loose();

/** Issue the app key: what goes into LITELLM_API_KEY. The key is shown once. */
export async function gatewayGenerateKey(limits: GatewayKeyLimits): Promise<string> {
  const body = await call("/key/generate", generatedKeySchema, {
    method: "POST",
    body: {
      // The gateway wants every alias unique, so the minute is in it: a
      // second key on the same day (one made before the limits were set)
      // does not collide.
      key_alias: `unitos-app-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}`,
      rpm_limit: limits.rpm,
      tpm_limit: limits.tpm,
      max_budget: limits.maxBudget,
      budget_duration: limits.budgetDuration,
      metadata: { app: "unitos" },
    },
  });
  return body.key;
}

/** Change the app key's limits in place. */
export async function gatewayUpdateKey(limits: GatewayKeyLimits): Promise<void> {
  const key = gatewayKey();
  if (!key) throw new GatewayError("LITELLM_API_KEY is not set");
  await call("/key/update", z.unknown(), {
    method: "POST",
    body: {
      key,
      rpm_limit: limits.rpm,
      tpm_limit: limits.tpm,
      max_budget: limits.maxBudget,
      budget_duration: limits.budgetDuration,
    },
  });
}

// ── Spend ──────────────────────────────────────────────────────────────────

const metricsSchema = z
  .object({
    spend: z.number().optional(),
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    api_requests: z.number().optional(),
    successful_requests: z.number().optional(),
    failed_requests: z.number().optional(),
  })
  .loose();

const breakdownEntry = z.object({ metrics: metricsSchema }).loose();

const activitySchema = z
  .object({
    results: z.array(
      z
        .object({
          date: z.string(),
          metrics: metricsSchema,
          breakdown: z
            .object({
              models: z.record(z.string(), breakdownEntry).optional(),
              providers: z.record(z.string(), breakdownEntry).optional(),
              entities: z.record(z.string(), breakdownEntry).optional(),
            })
            .loose()
            .optional(),
        })
        .loose(),
    ),
    metadata: z
      .object({
        total_spend: z.number().optional(),
        total_api_requests: z.number().optional(),
        total_successful_requests: z.number().optional(),
        total_failed_requests: z.number().optional(),
        total_prompt_tokens: z.number().optional(),
        total_completion_tokens: z.number().optional(),
        total_cache_read_input_tokens: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type SpendRow = { label: string; costUsd: number; tokens: number; calls: number };

export type GatewaySpend = {
  totalUsd: number;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  days: { day: string; costUsd: number }[];
  byModel: SpendRow[];
  byProvider: SpendRow[];
};

function rows(map: Map<string, SpendRow>): SpendRow[] {
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function add(map: Map<string, SpendRow>, label: string, m: z.infer<typeof metricsSchema>): void {
  const row = map.get(label) ?? { label, costUsd: 0, tokens: 0, calls: 0 };
  row.costUsd += m.spend ?? 0;
  row.tokens += (m.prompt_tokens ?? 0) + (m.completion_tokens ?? 0);
  row.calls += m.api_requests ?? 0;
  map.set(label, row);
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Spend over the last `days` days, by day, model, and provider: every
    request through the gateway, whatever key or tag it carried. */
export async function gatewaySpend(days: number): Promise<GatewaySpend> {
  const now = Date.now();
  const start = day(new Date(now - (days - 1) * 86_400_000));
  const end = day(new Date(now));
  const body = await call(
    `/user/daily/activity?start_date=${start}&end_date=${end}&page_size=1000`,
    activitySchema,
  );
  const byModel = new Map<string, SpendRow>();
  const byProvider = new Map<string, SpendRow>();
  const costByDay = new Map<string, number>();
  let totalUsd = 0;
  let requests = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  for (const r of body.results) {
    costByDay.set(r.date.slice(0, 10), (costByDay.get(r.date.slice(0, 10)) ?? 0) + (r.metrics.spend ?? 0));
    totalUsd += r.metrics.spend ?? 0;
    requests += r.metrics.api_requests ?? 0;
    failed += r.metrics.failed_requests ?? 0;
    inputTokens += r.metrics.prompt_tokens ?? 0;
    outputTokens += r.metrics.completion_tokens ?? 0;
    cacheReadTokens += r.metrics.cache_read_input_tokens ?? 0;
    for (const [label, entry] of Object.entries(r.breakdown?.models ?? {})) add(byModel, label, entry.metrics);
    for (const [label, entry] of Object.entries(r.breakdown?.providers ?? {})) add(byProvider, label, entry.metrics);
  }
  const daysOut = Array.from({ length: days }, (_, i) => {
    const d = day(new Date(now - (days - 1 - i) * 86_400_000));
    return { day: d, costUsd: costByDay.get(d) ?? 0 };
  });
  return {
    totalUsd,
    requests,
    failed,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    days: daysOut,
    byModel: rows(byModel),
    byProvider: rows(byProvider),
  };
}

export type GatewayTagSpend = {
  /** feature:<name> tags, by the function's name. */
  byFeature: SpendRow[];
  /** user:<id> tags, by the account id. */
  byUser: SpendRow[];
};

/** Spend over the last `days` days by the tags the app sends on every call
    (lib/gateway.ts): one per function, one per account. */
export async function gatewayTagSpend(days: number): Promise<GatewayTagSpend> {
  const now = Date.now();
  const start = day(new Date(now - (days - 1) * 86_400_000));
  const end = day(new Date(now));
  const body = await call(
    `/tag/daily/activity?start_date=${start}&end_date=${end}&page_size=1000`,
    activitySchema,
  );
  const byFeature = new Map<string, SpendRow>();
  const byUser = new Map<string, SpendRow>();
  for (const r of body.results) {
    for (const [tag, entry] of Object.entries(r.breakdown?.entities ?? {})) {
      if (tag.startsWith("feature:")) add(byFeature, tag.slice("feature:".length), entry.metrics);
      else if (tag.startsWith("user:")) add(byUser, tag.slice("user:".length), entry.metrics);
    }
  }
  return { byFeature: rows(byFeature), byUser: rows(byUser) };
}

// ── Health: one probe per model ────────────────────────────────────────────

const healthSchema = z
  .object({
    healthy_endpoints: z.array(z.object({ model: z.string().optional() }).loose()).optional(),
    unhealthy_endpoints: z
      .array(z.object({ model: z.string().optional(), error: z.unknown().optional() }).loose())
      .optional(),
    healthy_count: z.number().optional(),
    unhealthy_count: z.number().optional(),
  })
  .loose();

export type GatewayHealth = {
  healthy: string[];
  unhealthy: { model: string; error: string }[];
};

/** Probe every model in the gateway's list. Each probe is a real call, so
    this runs from the page's button, never on load. */
export async function gatewayHealth(): Promise<GatewayHealth> {
  // One live call per model, and a reasoning model takes seconds to answer
  // even "OK": the route allows 120 s, so the probes get most of it.
  const body = await call("/health", healthSchema, { timeoutMs: 110_000 });
  return {
    healthy: (body.healthy_endpoints ?? []).map((e) => e.model ?? "?"),
    unhealthy: (body.unhealthy_endpoints ?? []).map((e) => ({
      model: e.model ?? "?",
      error: gatewayErrorMessage(typeof e.error === "string" ? e.error : JSON.stringify(e.error ?? "")),
    })),
  };
}
