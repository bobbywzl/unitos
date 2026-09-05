import { createMoonshotAI, type MoonshotAIProvider } from "@ai-sdk/moonshotai";
import { tool, type LanguageModel } from "ai";
import { z } from "zod";
import { DEFAULT_EFFORT, type KimiEffort } from "@/lib/derive/config";
import { outboundFetch } from "@/lib/outbound-fetch";

// The Kimi client (SPEC.md §2): every model call in the app goes through here.
// Moonshot AI's API is OpenAI-compatible; the AI SDK's Moonshot provider speaks
// it. The key is KIMI_API_KEY, or MOONSHOT_API_KEY, the provider's own name.
// KIMI_BASE_URL points a local run at a stand-in server (scripts/qa) or at the
// China platform (https://api.moonshot.cn/v1).

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

export function kimiApiKey(): string | undefined {
  return process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || undefined;
}

/** A key is set, so the AI features are on. Every route checks this first. */
export function kimiConfigured(): boolean {
  return Boolean(kimiApiKey());
}

export function kimiBaseUrl(): string {
  return (process.env.KIMI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

let provider: MoonshotAIProvider | null = null;

/** The model to call. The provider is built once per process, on first use. */
export function kimi(modelId: string): LanguageModel {
  provider ??= createMoonshotAI({ apiKey: kimiApiKey(), baseURL: kimiBaseUrl() });
  return provider(modelId);
}

/** Provider options for one call: the reasoning effort (lib/derive/config.ts).
    Kimi K3 fixes temperature and top_p, so nothing else is set. */
export function kimiOptions(effort: KimiEffort = DEFAULT_EFFORT) {
  return { moonshotai: { reasoningEffort: effort } };
}

// The assistant's web access (SPEC.md §7): Moonshot's official web-search
// tool. The model asks for a search as a standard function call; the search
// runs on Moonshot's Formula API and comes back encrypted, readable by the
// model alone, so the links the model writes are the sources the reader sees.
// Moonshot bills each search $0.005 on top of the tokens.
export const WEB_SEARCH_USD = 0.005;
export const WEB_SEARCH_TOOL = "web_search";
const WEB_SEARCH_FORMULA = "moonshot/web-search:latest";

type FiberResponse = {
  status?: string;
  context?: { output?: string; encrypted_output?: string };
  error?: { message?: string };
};

export const webSearchTool = tool({
  description: "Search the web for information",
  inputSchema: z.object({ query: z.string().describe("What to search for") }),
  execute: async ({ query }, { abortSignal }) => {
    try {
      const res = await outboundFetch(`${kimiBaseUrl()}/formulas/${WEB_SEARCH_FORMULA}/fibers`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${kimiApiKey() ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: WEB_SEARCH_TOOL, arguments: JSON.stringify({ query }) }),
        signal: abortSignal,
      });
      const body = (await res.json().catch(() => null)) as FiberResponse | null;
      const output = body?.context?.encrypted_output ?? body?.context?.output;
      if (!res.ok || body?.status !== "succeeded" || !output) {
        throw new Error(body?.error?.message ?? `request failed (${res.status})`);
      }
      return output;
    } catch (err) {
      // The model reads the failure and answers from the material alone.
      console.warn("[assistant] web search failed:", err);
      return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  // The result reaches the model as the string it is, never re-encoded as JSON.
  toModelOutput: ({ output }) => ({ type: "text", value: output }),
});
