import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ClaudeEffort, KimiEffort } from "@/lib/derive/config";
import { resolveModelId } from "@/lib/models";
import { geminiApiKey, geminiBaseUrl, geminiConfigured } from "@/lib/video/gemini";

// The Gemini chat client (SPEC.md §2): any feature whose model id is a
// gemini- id (lib/model-call.ts) goes through here — the assistant runs on
// Gemini 3.8 Flash. The video calls keep their own client (lib/video/gemini.ts)
// and share its key and root: GEMINI_API_KEY, or under the gateway
// (lib/gateway.ts) its Gemini pass-through with the app key, so the request
// reaches Google as written.

export { geminiConfigured };

let provider: GoogleGenerativeAIProvider | null = null;

/** The model to call. The provider is built once per process, on first use.
    A role's default id resolves to the role's current id (lib/models.ts);
    any other id is called as written. */
export async function gemini(modelId: string): Promise<LanguageModel> {
  provider ??= createGoogleGenerativeAI({ apiKey: geminiApiKey(), baseURL: `${geminiBaseUrl()}/v1beta` });
  return provider(await resolveModelId(modelId));
}

/** Gemini's thinking level for an effort. Gemini 3 takes low, medium, and
    high: Fast Thinking ("low") is low, Deep Thinking ("high") is high, and
    anything above high is high. */
export function geminiThinkingLevel(effort: KimiEffort | ClaudeEffort): "low" | "medium" | "high" {
  return effort === "low" || effort === "medium" ? effort : "high";
}

/** Provider options for one call: the thinking level. */
export function geminiOptions(effort: KimiEffort | ClaudeEffort) {
  return { google: { thinkingConfig: { thinkingLevel: geminiThinkingLevel(effort) } } };
}
