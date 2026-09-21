import { z } from "zod";
import { gatewayConfigured, gatewayHeaders, gatewayUrl, keyFor, providerKey } from "@/lib/gateway";
import { recordUsage, type UsageMeta } from "@/lib/usage";

// Jev (TypeSafe AI's System One model): typed decisions, never text. One
// call sends a state — a string, a JSON object, or an array — and named
// questions, and answers every question in one parallel pass, each with a
// calibrated probability: a noul is the probability a statement holds, a
// choice picks one option and gives a probability per option and a
// confidence, a score places the state on ordered levels. Text only, 64k
// tokens of state and questions per call, no rationale. It reads
// literally, counts badly, and loses accuracy as the state fills with
// text the question does not need — so a caller sends the smallest state
// that decides the question and keeps every threshold in code.
// Under the AI gateway (lib/gateway.ts) the call goes to the gateway's
// `/typesafe/systemone` pass-through with the app key, and TYPESAFE_API_KEY
// lives on the gateway host with the other provider keys; the pass-through's
// target in litellm/config.yaml is the API root that serves Jev — OpenRouter's
// `https://openrouter.ai/api/v1` (Jev at the same request and answer shape,
// `usage.cost` added) or TypeSafe's own. Without the gateway,
// `TYPESAFE_API_KEY` on the app's host turns Jev on and `TYPESAFE_BASE_URL`
// is that root (the default is TypeSafe's; the QA mock,
// scripts/qa/mock-jev.mjs, is another). Either way `TYPESAFE_MODEL` on the
// app's host is the model id the call names: `jev-latest` at TypeSafe,
// `~typesafe/jev-latest` or `typesafe/jev-1.13` at OpenRouter. With neither
// key, jevEnabled() is false and every caller runs as it did without Jev.
// A gateway that has no Jev route answers 401 or 404: the client then
// stands down for GATEWAY_RETRY_MS, so no caller waits on it twice.
// Every call records its tokens, and the cost when the gateway states it,
// under the caller's usage row.

export const JEV_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const BASE_URL = (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1").replace(/\/+$/, "");
const TIMEOUT_MS = 12_000;
const RETRIES = 2; // on 429, 529, 5xx, and a dropped connection
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);
const GATEWAY_RETRY_MS = 5 * 60_000; // after a 401 or 404 from the gateway: no Jev route there

// When the gateway last said it has no Jev route (401 or 404), or 0.
let gatewayRefusedAt = 0;

/** Jev is on: the app's own key, or the gateway (whose Jev route may still
    turn out missing — then the client stands down for a while). */
export function jevEnabled(): boolean {
  if (providerKey("typesafe")) return true;
  if (!gatewayConfigured()) return false;
  return Date.now() - gatewayRefusedAt > GATEWAY_RETRY_MS;
}

/** Where the call goes and what it sends: the gateway's pass-through with
    the app key, or the provider's root with the provider's key. */
function route(): { url: string; key: string | undefined; gateway: boolean } {
  if (gatewayConfigured() && !providerKey("typesafe")) {
    return { url: gatewayUrl("/typesafe/systemone"), key: keyFor("typesafe"), gateway: true };
  }
  return { url: `${BASE_URL}/systemone`, key: providerKey("typesafe"), gateway: false };
}

export type JevJson = string | number | boolean | null | JevJson[] | { [key: string]: JevJson };
export type JevState = string | JevJson[] | { [key: string]: JevJson };
export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: readonly [string, string, ...string[]] };

const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number()),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string(), z.number()),
  }),
]);
const resultSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), cost: z.number().optional() })
    .optional(),
});
export type JevAnswer = z.infer<typeof answerSchema>;
export type JevResult = { ok: true; answers: Record<string, JevAnswer> } | { ok: false; error: string };

/** One System One call. Every question gets an answer of its own type, or
    the call fails as a whole: a missing or mistyped answer is an error, never
    a guess. */
export async function systemOne(input: {
  state: JevState;
  questions: Record<string, JevQuestion>;
  usage?: UsageMeta;
  signal?: AbortSignal;
  label?: string;
}): Promise<JevResult> {
  const label = input.label ?? "jev";
  if (!jevEnabled()) return { ok: false, error: "Jev is not configured" };
  const { url, key, gateway } = route();
  if (!key) return { ok: false, error: "TYPESAFE_API_KEY is not set" };
  if (Object.keys(input.questions).length === 0) return { ok: true, answers: {} };
  const body = JSON.stringify({ model: JEV_MODEL, state: input.state, questions: input.questions });
  let lastError = "";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (input.signal?.aborted) return { ok: false, error: "aborted" };
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * 3 ** (attempt - 1)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(gateway && input.usage ? gatewayHeaders(input.usage) : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `${label}: HTTP ${res.status}`;
        if (gateway && (res.status === 401 || res.status === 404)) {
          gatewayRefusedAt = Date.now();
          return { ok: false, error: `${lastError} (the gateway has no Jev route)` };
        }
        if (RETRY_STATUSES.has(res.status)) continue;
        return { ok: false, error: lastError };
      }
      const parsed = resultSchema.safeParse(await res.json());
      if (!parsed.success) return { ok: false, error: `${label}: answer did not fit the schema` };
      for (const [name, q] of Object.entries(input.questions)) {
        const a = parsed.data.answers[name];
        if (!a || a.type !== q.type) return { ok: false, error: `${label}: no ${q.type} answer for ${name}` };
      }
      if (input.usage) {
        recordUsage(
          input.usage,
          {
            inputTokens: parsed.data.usage?.input_tokens ?? 0,
            outputTokens: parsed.data.usage?.output_tokens ?? 0,
          },
          parsed.data.usage?.cost,
        );
      }
      return { ok: true, answers: parsed.data.answers };
    } catch (err) {
      if (input.signal?.aborted) return { ok: false, error: "aborted" };
      lastError = `${label}: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
  return { ok: false, error: lastError || `${label}: failed` };
}

/** `fn` over every item, at most `limit` at a time, results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
