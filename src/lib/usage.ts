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

// Anthropic serves a cache hit at 0.1× the input price and charges 1.25× to
// write the cache. Claude Fable 5.1 serves a cache hit at $0.25 flat.
const anthropicPrice = (input: number, output: number, cacheRead = input * 0.1): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

/** Exact-match list prices, USD per 1M tokens. */
const MODEL_PRICING: Record<string, Price> = {
  "claude-fable-5-1": anthropicPrice(10, 50, 0.25),
  // Z.ai serves a cache hit at about 0.2× the input price (GLM 5.3: $0.26 on
  // $1.40; Flash: $0.03 on $0.15) and charges nothing to write the cache.
  "glm-5.3": { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 1.4 },
  "glm-5.3-flash": { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0.15 },
  "kimi-k3": price(3, 15),
  "gemini-3.7-flash": price(0.3, 2.5),
  "gemini-flash-latest": price(0.3, 2.5),
  // OpenAI: whisper-1 is per-minute — its callers pass costUsd directly.
  // gpt-4o-mini-tts: text in ($0.60/1M), audio out (≈$12/1M audio tokens).
  "whisper-1": price(0, 0),
  // Groq: per-hour transcription — its caller passes costUsd directly.
  "whisper-large-v3-turbo": price(0, 0),
  // Deepgram: per-second transcription — its caller passes costUsd directly
  // (lib/video/deepgram.ts). inputTokens on these rows is seconds of audio.
  "nova-3": price(0, 0),
  "gpt-4o-mini-tts": price(0.6, 12),
  // Microsoft Edge read-aloud voice: free, no key.
  "edge-tts": price(0, 0),
  "text-embedding-3-small": price(0.02, 0),
  "jev-latest": price(0.042, 0), // TypeSafe Jev: output free
  // DeepL bills per character: $25 per 1M characters on the Pro API, free
  // to 500k a month on the Free API. Callers pass the character count as
  // inputTokens.
  deepl: price(25, 0),
  // Not billed per token, and the price depends on a plan this app cannot
  // read, so these record the call and $0 rather than a made-up figure: the
  // page then says how much of each ran, and never a cost that is not real.
  // A file in Gemini's store is billed on the call that reads it, not on the
  // upload (lib/video/gemini-files.ts).
  "gemini-files": price(0, 0),
  // One page opened in the browser service (lib/browser.ts): the figure
  // render and the YouTube transcript panel.
  "browser-session": price(0, 0),
  // One email sent through Resend (lib/email.ts).
  "resend-email": price(0, 0),
};

/** Family fallbacks for ids not priced exactly; first match wins. */
const FAMILY_PRICING: [RegExp, Price][] = [
  [/^glm.*flash/, price(0.15, 0.5)],
  [/^glm/, price(1.4, 4.4)],
  [/^claude.*(fable|mythos)/, anthropicPrice(10, 50)],
  [/^claude.*opus/, anthropicPrice(5, 25)],
  [/^claude.*haiku/, anthropicPrice(1, 5)],
  [/^claude.*sonnet-5/, anthropicPrice(2, 10)],
  [/^claude/, anthropicPrice(3, 15)],
  [/^kimi/, price(3, 15)],
  [/^gemini.*flash/, price(0.3, 2.5)],
  [/^gemini/, price(1.25, 10)],
  [/^jev/, price(0.042, 0)],
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

/** Two token counts summed: the steps of one stopped generation. */
export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
    outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
  };
}

export type UsageMeta = {
  userId: string | null;
  feature: string; // explain | simplify | … | assistant | act | glossary | contents | skeleton | transcribe | describe | voice | gist | merge | stitch
  model: string;
};

// Who serves each model. Ordered; first match wins. A model no rule names
// is filed under "other", never guessed into a provider: a row under the
// wrong provider reads as that provider's spend and is worse than an
// unnamed one. Add the rule when a provider is added.
const PROVIDERS: [RegExp, string][] = [
  [/^glm/, "zai"],
  [/^claude/, "anthropic"],
  [/^(kimi|moonshot)/, "moonshot"],
  [/^(gemini|gemini-files)/, "google"],
  [/^(whisper-large|distil-whisper)/, "groq"],
  [/^nova-/, "deepgram"],
  [/^(whisper-1|gpt-|text-embedding-|o[0-9])/, "openai"],
  [/^edge-tts$/, "microsoft"],
  [/^deepl$/, "deepl"],
  [/^browser-session$/, "browser"],
  [/^resend-email$/, "resend"],
  [/^jev/, "typesafe"],
];

export function providerOf(model: string): string {
  for (const [rx, provider] of PROVIDERS) if (rx.test(model)) return provider;
  return "other";
}

/** Record one call. costUsd defaults to list price × tokens; a caller billed
    on something other than tokens (whisper per minute, Deepgram per second,
    DeepL per character) passes its own. A caller that passes costUsd — `0`
    included — always gets a row, so a free or flat-rate service still shows
    its calls; a call that says nothing at all (no tokens, no cost) writes
    nothing. */
export function recordUsage(meta: UsageMeta, tokens: TokenCounts, costUsd?: number): void {
  const total =
    (tokens.inputTokens ?? 0) +
    (tokens.outputTokens ?? 0) +
    (tokens.cacheReadTokens ?? 0) +
    (tokens.cacheWriteTokens ?? 0);
  if (total === 0 && costUsd === undefined) return;
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
