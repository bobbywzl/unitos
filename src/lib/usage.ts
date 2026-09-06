import { db } from "@/lib/db";

// AI usage telemetry (Scalae admin pattern): one recordUsage per model call.
// costUsd is computed at write time from the list prices below, so the figure
// is locked to the price at call time. Writes are fire-and-forget and fully
// guarded — telemetry never breaks or slows a user-facing response.

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Moonshot serves a cache hit at 0.1× the input price and charges nothing to
// write the cache, so a cache write counts as plain input; close enough for
// Gemini's cached tier too (estimates either way).
const price = (input: number, output: number): Price => ({
  input,
  output,
  cacheRead: input * 0.1,
  cacheWrite: input,
});

/** Exact-match list prices, USD per 1M tokens. */
const MODEL_PRICING: Record<string, Price> = {
  "kimi-k3": price(3, 15),
  "gemini-3.7-flash": price(0.3, 2.5),
  "gemini-flash-latest": price(0.3, 2.5),
  // OpenAI: whisper-1 is per-minute — its callers pass costUsd directly.
  // gpt-4o-mini-tts: text in ($0.60/1M), audio out (≈$12/1M audio tokens).
  "whisper-1": price(0, 0),
  // Groq: per-hour transcription — its caller passes costUsd directly.
  "whisper-large-v3-turbo": price(0, 0),
  "gpt-4o-mini-tts": price(0.6, 12),
  // Microsoft Edge read-aloud voice: free, no key.
  "edge-tts": price(0, 0),
  "text-embedding-3-small": price(0.02, 0),
  // DeepL bills per character: $25 per 1M characters on the Pro API, free
  // to 500k a month on the Free API. Callers pass the character count as
  // inputTokens.
  deepl: price(25, 0),
};

/** Family fallbacks for ids not priced exactly; first match wins. */
const FAMILY_PRICING: [RegExp, Price][] = [
  [/^kimi/, price(3, 15)],
  [/^gemini.*flash/, price(0.3, 2.5)],
  [/^gemini/, price(1.25, 10)],
];

export function priceFor(model: string): Price {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  for (const [rx, p] of FAMILY_PRICING) if (rx.test(model)) return p;
  return price(3, 15); // unknown model — count it at a mid tier, never $0
}

export type TokenCounts = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function computeCostUsd(model: string, t: TokenCounts): number {
  const p = priceFor(model);
  return (
    ((t.inputTokens ?? 0) / 1_000_000) * p.input +
    ((t.outputTokens ?? 0) / 1_000_000) * p.output +
    ((t.cacheReadTokens ?? 0) / 1_000_000) * p.cacheRead +
    ((t.cacheWriteTokens ?? 0) / 1_000_000) * p.cacheWrite
  );
}

/** The AI SDK's usage shape → plain token counts. */
export function sdkTokens(usage: {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number | null; cacheWriteTokens?: number | null };
}): TokenCounts {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
}

export type UsageMeta = {
  userId: string | null;
  feature: string; // explain | simplify | … | assistant | act | glossary | transcribe | describe | voice
  model: string;
};

function providerOf(model: string): string {
  if (model.startsWith("kimi") || model.startsWith("moonshot")) return "moonshot";
  if (model.startsWith("gemini")) return "google";
  if (model.startsWith("whisper-large") || model.startsWith("distil-whisper")) return "groq";
  if (model === "edge-tts") return "microsoft";
  if (model === "deepl") return "deepl";
  return "openai";
}

/** Record one model call. costUsd defaults to list price × tokens; per-minute
    callers (whisper) pass their own. Nothing meaningful → no row. */
export function recordUsage(meta: UsageMeta, tokens: TokenCounts, costUsd?: number): void {
  const total =
    (tokens.inputTokens ?? 0) +
    (tokens.outputTokens ?? 0) +
    (tokens.cacheReadTokens ?? 0) +
    (tokens.cacheWriteTokens ?? 0);
  if (total === 0 && !costUsd) return;
  void db.usageEvent
    .create({
      data: {
        userId: meta.userId,
        provider: providerOf(meta.model),
        model: meta.model,
        feature: meta.feature,
        inputTokens: tokens.inputTokens ?? 0,
        outputTokens: tokens.outputTokens ?? 0,
        cacheReadTokens: tokens.cacheReadTokens ?? 0,
        cacheWriteTokens: tokens.cacheWriteTokens ?? 0,
        costUsd: costUsd ?? computeCostUsd(meta.model, tokens),
      },
    })
    .catch(() => {
      /* telemetry is best-effort — never surface to the caller */
    });
}
