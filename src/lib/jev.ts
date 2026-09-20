import { z } from "zod";
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
// `TYPESAFE_API_KEY` turns it on; unset, jevEnabled() is false and every
// caller runs as it did without it. `TYPESAFE_BASE_URL` overrides the
// endpoint (the QA mock, scripts/qa/mock-jev.mjs); `TYPESAFE_MODEL` the
// model. Every call records its tokens under the caller's usage row.

export const JEV_MODEL = process.env.TYPESAFE_MODEL || "jev-latest";
const BASE_URL = (process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai/v1").replace(/\/+$/, "");
const TIMEOUT_MS = 12_000;
const RETRIES = 2; // on 429, 529, 5xx, and a dropped connection
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

export function jevEnabled(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
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
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
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
  const key = process.env.TYPESAFE_API_KEY;
  const label = input.label ?? "jev";
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
      const res = await fetch(`${BASE_URL}/systemone`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        lastError = `${label}: HTTP ${res.status}`;
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
        recordUsage(input.usage, {
          inputTokens: parsed.data.usage?.input_tokens ?? 0,
          outputTokens: parsed.data.usage?.output_tokens ?? 0,
        });
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
