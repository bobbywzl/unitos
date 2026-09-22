import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { HANDWRITTEN_EFFORT, type ClaudeEffort } from "@/lib/derive/config";
import { gatewayConfigured, gatewayUrl, keyFor, providerConfigured } from "@/lib/gateway";
import { resolveModelId } from "@/lib/models";

// The Claude client (SPEC.md §2): the handwritten passes — Import PDF's
// judgment and conversion — and Visualize go through here, and a parse pass
// whose model id is a claude- id (lib/parse/model.ts). Every other model
// call goes through lib/kimi.ts. The key is ANTHROPIC_API_KEY.
// ANTHROPIC_BASE_URL points a local run at a stand-in server (scripts/qa).
// Under the gateway (lib/gateway.ts) the calls go to its Anthropic
// pass-through — the request reaches Anthropic as written, the effort
// included — and the key is the app key. The one field the gateway strips
// is `fallbacks`, a name it keeps for its own router, so under the gateway
// the server-side refusal fallback never runs; callForJson
// (lib/derive/json-call.ts) reruns a refused call on CLAUDE_REFUSAL_FALLBACK
// instead, the same work on the app's side.

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

/** The model a refused Claude call runs again on under the gateway. */
export const CLAUDE_REFUSAL_FALLBACK = "claude-opus-4-8";

/** A Claude model: the client that built it says so. */
export function isClaudeModel(model: LanguageModel): boolean {
  return typeof model !== "string" && model.provider.startsWith("anthropic");
}

/** The key a Claude call sends: the app key under the gateway, else ANTHROPIC_API_KEY. */
export function claudeApiKey(): string | undefined {
  return keyFor("anthropic");
}

/** The gateway or a key is set, so the import's AI passes are on. Every import call checks this first. */
export function claudeConfigured(): boolean {
  return providerConfigured("anthropic");
}

export function claudeBaseUrl(): string {
  if (gatewayConfigured()) return gatewayUrl("/anthropic/v1");
  return (process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

let provider: AnthropicProvider | null = null;

/** The model to call. The provider is built once per process, on first use.
    A role's default id (CLAUDE_OPUS_5_5, lib/models.ts) resolves to the
    role's current id
    — the newest version the bimonthly model update found (lib/models.ts);
    the returned model's modelId is the id called. */
export async function claude(modelId: string): Promise<LanguageModel> {
  provider ??= createAnthropic({ apiKey: claudeApiKey(), baseURL: claudeBaseUrl() });
  return provider(await resolveModelId(modelId));
}

/** Provider options for one call: the reasoning effort (lib/derive/config.ts)
    and the server-side fallback. These models always reason, so no thinking
    setting is sent; the effort sets how long it reasons. When the safety
    classifiers decline a request, the fallback has the API rerun the same
    request on another Claude model in the same call, so the import finishes
    instead of failing; usage then records the call under the model asked
    for. Temperature and top_p are fixed by the model, so nothing else is
    set. */
export function claudeOptions(effort: ClaudeEffort = HANDWRITTEN_EFFORT) {
  return { anthropic: { effort, fallbacks: "default" as const } };
}
