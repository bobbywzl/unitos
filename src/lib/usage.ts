import { db } from "@/lib/db";

// AI usage telemetry (Scalae admin pattern): one recordUsage per model call.
// costUsd is computed at write time from the list prices below, so the figure
// is locked to the price at call time. Writes are fire-and-forget and fully
// guarded — telemetry never breaks or slows a user-facing response.

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

// Anthropic publishes cache-read at 0.1× input and cache-write at 1.25×;
// close enough for Gemini's cached tier too (estimates either way).
const price = (input: number, output: number): Price => ({
  input,
  output,
  cacheRead: input * 0.1,
  cacheWrite: input * 1.25,
});

/** Exact-match list prices, USD per 1M tokens. */
const MODEL_PRICING: Record<string, Price> = {
  "claude-fable-5": price(10, 50),
  "claude-opus-5": price(5, 25),
  "claude-opus-4-8": price(5, 25),
  "claude-opus-4-7": price(5, 25),
  "claude-opus-4-6": price(5, 25),
  "claude-sonnet-5": price(2, 10),
  "claude-sonnet-4-6": price(3, 15),
  "claude-haiku-4-5": price(1, 5),
  "gemini-3.7-flash": price(0.3, 2.5),
  "gemini-flash-latest": price(0.3, 2.5),
  // OpenAI: whisper-1 is per-minute — its callers pass costUsd directly.
  // gpt-4o-mini-tts: text in ($0.60/1M), audio out (≈$12/1M audio tokens).
  "whisper-1": price(0, 0),
  "gpt-4o-mini-tts": price(0.6, 12),
};

/** Family fallbacks for ids not priced exactly; first match wins. */
const FAMILY_PRICING: [RegExp, Price][] = [
  [/^claude.*(fable|mythos)/, price(10, 50)],
  [/^claude.*opus/, price(5, 25)],
  [/^claude.*haiku/, price(1, 5)],
  [/^claude.*sonnet-5/, price(2, 10)],
  [/^claude/, price(3, 15)],
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
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "google";
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
