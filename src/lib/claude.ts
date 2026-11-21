import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import type { LanguageModel, ModelMessage } from "ai";
import { HANDWRITTEN_EFFORT, type ClaudeEffort } from "@/lib/derive/config";
import { gatewayConfigured, gatewayUrl, keyFor, providerConfigured } from "@/lib/gateway";
import { resolveModelId } from "@/lib/models";

// The Claude client (SPEC.md §2): the parse passes, the handwritten passes
// — Import PDF's judgment and conversion — Visualize, the voice command,
// and any feature whose model id is a claude- id (lib/model-call.ts) go
// through here. Every other model call goes through lib/kimi.ts. The key
// is ANTHROPIC_API_KEY.
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

/** Claude's web search (Anthropic's server tool; lib/web-search.ts): the
    search runs on Anthropic's side inside the call, and the pages it read
    come back as the stream's url sources. The tool with dynamic filtering
    where the model takes it; Claude Haiku 5.5 takes the basic one. */
export function claudeWebSearch(modelId: string, maxUses: number) {
  provider ??= createAnthropic({ apiKey: claudeApiKey(), baseURL: claudeBaseUrl() });
  return /haiku/i.test(modelId)
    ? provider.tools.webSearch_20250305({ maxUses })
    : provider.tools.webSearch_20260209({ maxUses });
}

/** What one Claude web search costs: $10 per 1,000 searches. */
export const CLAUDE_WEB_SEARCH_USD = 0.01;

/** Provider options for one call: the reasoning effort (lib/derive/config.ts)
    and the server-side fallback. These models always reason, so no thinking
    setting is sent; the effort sets how long it reasons. When the safety
    classifiers decline a request, the fallback has the API rerun the same
    request on another Claude model in the same call, so the import finishes
    instead of failing; usage then records the call under the model asked
    for. Temperature and top_p are fixed by the model, so nothing else is
    set. */
export function claudeOptions(effort: ClaudeEffort = HANDWRITTEN_EFFORT, modelId?: string) {
  // Claude Haiku 5.5 has no server-side fallback: the field is left off.
  if (modelId && /haiku/i.test(modelId)) return { anthropic: { effort } };
  return { anthropic: { effort, fallbacks: "default" as const } };
}

// A steady request (SPEC.md §2, the context layers). Anthropic's cache
// matches a request's prefix, and the effort a request names at its top is
// part of what it matches: a message at low effort and the next at high
// each write the document again. So a call that marks a cache layer
// (lib/assistant/context.ts) names the model's default effort at its top,
// which is the same as naming none, and carries the turn's own effort in a
// message of its own after the last one (Anthropic's per-message effort,
// beta mid-conversation-output-config-2026-07-01). Every effort then reads
// the same cached layers.

/** The effort a Claude model runs at when a request names none: medium on
    Claude Opus 5.5 and Claude Haiku 5.5, high on every other. */
export function claudeDefaultEffort(modelId: string): ClaudeEffort {
  return /^claude-(opus-5-5|haiku-5-5)/.test(modelId) ? "medium" : "high";
}

/** The models that take a turn's effort in a message of its own. */
const TURN_EFFORT_RX = /^claude-(fable-5-[12]|mythos-5-[12]|opus-5-5|opus-5(?![-.\d])|sonnet-5-5|haiku-5-5)/;

/** The documented beta of the per-message effort; the provider adds the
    older name it knows. */
const TURN_EFFORT_BETA = "mid-conversation-output-config-2026-07-01";

// The API refused a per-message effort once in this process (a gateway that
// drops the beta header, an account without the beta): later calls name
// their effort at the top, as before, and the cache splits by effort.
let turnEffortRefused = false;

const marksCache = (options: unknown): boolean => {
  if (!options || typeof options !== "object") return false;
  const anthropic = (options as { anthropic?: unknown }).anthropic;
  return Boolean(anthropic && typeof anthropic === "object" && "cacheControl" in anthropic);
};

/** A message, or a part of one, marks a cache layer. */
export function marksCacheLayer(messages: ModelMessage[]): boolean {
  return messages.some(
    (m) =>
      marksCache(m.providerOptions) ||
      (Array.isArray(m.content) && m.content.some((part) => marksCache((part as { providerOptions?: unknown }).providerOptions))),
  );
}

export type SteadyRequest<P> = {
  providerOptions: P;
  messages: ModelMessage[];
  headers: Record<string, string>;
  /** The turn's effort rides in a message: a 400 on this call is rerun plain (turnEffortFailed). */
  steady: boolean;
};

/** The request as it is sent. A Claude call that marks a cache layer, on a
    model that takes a turn's effort in a message, at another effort than
    the model's default: the top names the default, and the turn's effort
    follows the last message. Every other call is sent as it was built. */
export function steadyRequest<P>(modelId: string, providerOptions: P, messages: ModelMessage[]): SteadyRequest<P> {
  const plain = { providerOptions, messages, headers: {}, steady: false };
  if (turnEffortRefused || !TURN_EFFORT_RX.test(modelId) || !marksCacheLayer(messages)) return plain;
  const anthropic = (providerOptions as { anthropic?: Record<string, unknown> } | undefined)?.anthropic;
  const effort = anthropic?.effort;
  const standing = claudeDefaultEffort(modelId);
  if (typeof effort !== "string" || effort === standing || anthropic?.thinking !== undefined) return plain;
  return {
    providerOptions: { ...providerOptions, anthropic: { ...anthropic, effort: standing } } as P,
    messages: [...messages, { role: "system", content: "", providerOptions: { anthropic: { effort } } }],
    headers: { "anthropic-beta": TURN_EFFORT_BETA },
    steady: true,
  };
}

/** A steady call failed with HTTP 400: the per-message effort is off for
    the rest of this process, and the caller runs the call again as it was
    built. False for any other failure. */
export function turnEffortFailed(status: number | null | undefined, label: string): boolean {
  if (status !== 400) return false;
  if (!turnEffortRefused) {
    console.error(`[claude] ${label}: the API refused a per-message effort (HTTP 400); effort rides at the top of each request from here on, and the cache splits by effort.`);
  }
  turnEffortRefused = true;
  return true;
}
