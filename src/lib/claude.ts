import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { PARSE_EFFORT, type ClaudeEffort } from "@/lib/derive/config";

// The Claude client (SPEC.md §2): the import's model calls go through here —
// the upload assistant's review and instruction check, the URL core and
// structure passes, Import PDF's judgment, and conversion. Every other model
// call goes through lib/kimi.ts. The key is ANTHROPIC_API_KEY.
// ANTHROPIC_BASE_URL points a local run at a stand-in server (scripts/qa).

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";

// Whitespace stripped: a key pasted into the host's settings with a line
// break inside it is refused as a header value, and the request never leaves.
export function claudeApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.replace(/\s+/g, "") || undefined;
}

/** A key is set, so the import's AI passes are on. Every import call checks this first. */
export function claudeConfigured(): boolean {
  return Boolean(claudeApiKey());
}

export function claudeBaseUrl(): string {
  return (process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

let provider: AnthropicProvider | null = null;

/** The model to call. The provider is built once per process, on first use. */
export function claude(modelId: string): LanguageModel {
  provider ??= createAnthropic({ apiKey: claudeApiKey(), baseURL: claudeBaseUrl() });
  return provider(modelId);
}

/** Provider options for one call: the reasoning effort (lib/derive/config.ts)
    and the server-side fallback. Claude Fable 5.1 always reasons, so no
    thinking setting is sent; the effort sets how long it reasons. When its
    safety classifiers decline a request, the fallback has the API rerun the
    same request on another Claude model in the same call, so the import
    finishes instead of failing; usage then records the call under
    PARSE_MODEL. Claude Fable 5.1 fixes temperature and top_p, so nothing
    else is set. */
export function claudeOptions(effort: ClaudeEffort = PARSE_EFFORT) {
  return { anthropic: { effort, fallbacks: "default" as const } };
}
