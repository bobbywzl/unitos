import { createMoonshotAI, type MoonshotAIProvider } from "@ai-sdk/moonshotai";
import { tool, type LanguageModel } from "ai";
import { z } from "zod";
import { DEFAULT_EFFORT, type KimiEffort } from "@/lib/derive/config";
import {
  gatewayConfigured,
  gatewayModelId,
  gatewayUrl,
  keyFor,
  providerConfigured,
} from "@/lib/gateway";
import { isGlmModel, resolveModelId } from "@/lib/models";
import { outboundFetch } from "@/lib/outbound-fetch";

// The OpenAI-compatible client (SPEC.md §2): every model call but Claude's
// and Gemini's goes through here (lib/claude.ts, lib/video/gemini.ts).
// Moonshot AI's API is OpenAI-compatible; the AI SDK's Moonshot provider
// speaks it. The key is MOONSHOT_API_KEY. MOONSHOT_BASE_URL points a local
// run at a stand-in server (scripts/qa) or at the China platform
// (https://api.moonshot.cn/v1). Under the gateway (lib/gateway.ts) the chat
// calls go to its OpenAI-compatible route as moonshot/<id> or zai/<id> —
// GLM 5.3 and GLM 5.3 Flash are reached through the gateway alone — the
// formula and model-list calls to its Moonshot pass-through, and Z.ai's web
// search to its Z.ai pass-through; the key is the app key.

const DEFAULT_BASE_URL = "https://api.moonshot.ai/v1";

/** The key a Kimi call sends: the app key under the gateway, else MOONSHOT_API_KEY. */
export function kimiApiKey(): string | undefined {
  return keyFor("moonshot");
}

/** The gateway or a key is set, so the AI features are on. Every route checks this first. */
export function kimiConfigured(): boolean {
  return providerConfigured("moonshot");
}

/** The chat completions root. */
export function kimiBaseUrl(): string {
  if (gatewayConfigured()) return gatewayUrl("/v1");
  return (process.env.MOONSHOT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Moonshot's API root for what is not a chat completion — the web-search
    formula, the model list: the gateway's Moonshot pass-through, or the
    same root as the chat calls. */
export function moonshotApiUrl(): string {
  if (gatewayConfigured()) return gatewayUrl("/moonshot");
  return kimiBaseUrl();
}

let provider: MoonshotAIProvider | null = null;

/** The model to call. The provider is built once per process, on first use.
    A role's default id (KIMI_K3, GLM_5_3) resolves to the role's current id
    — the newest version the bimonthly model update found (lib/models.ts),
    and Kimi's when a GLM id is asked for without the gateway; the returned
    model's modelId is the id called. */
export async function kimi(modelId: string): Promise<LanguageModel> {
  provider ??= createMoonshotAI({ apiKey: kimiApiKey(), baseURL: kimiBaseUrl() });
  const id = await resolveModelId(modelId);
  return provider(gatewayModelId(isGlmModel(id) ? "zai" : "moonshot", id));
}

/** Provider options for one call: the reasoning effort (lib/derive/config.ts),
    the same three levels on Kimi K3 and GLM 5.3. Both fix temperature and
    top_p, so nothing else is set. */
export function kimiOptions(effort: KimiEffort = DEFAULT_EFFORT) {
  return { moonshotai: { reasoningEffort: effort } };
}

// The assistant's web access (SPEC.md §7): the model asks for a search as a
// standard function call, and the search follows the model that answers.
// Under GLM 5.3 it is Z.ai's Web Search API (the gateway's /zai pass-through;
// GLM is reached through the gateway alone): the results come back as plain
// text — title, site, date, link, summary — and the model cites the links.
// Under Kimi K3 — what a GLM id resolves to without the gateway — it is
// Moonshot's web-search formula, whose result comes back encrypted, readable
// by Kimi alone. Either way the links the model writes are the sources the
// reader sees. Z.ai bills a search $0.01, Moonshot $0.005, on top of the tokens.
export const ZAI_WEB_SEARCH_USD = 0.01;
export const MOONSHOT_WEB_SEARCH_USD = 0.005;
export const WEB_SEARCH_TOOL = "web_search";
// At most this many searches per answer, one step each, then the answer.
export const WEB_SEARCH_MAX_USES = 5;
const WEB_SEARCH_FORMULA = "moonshot/web-search:latest";
const ZAI_WEB_SEARCH_ENGINE = "search-prime";
const ZAI_WEB_SEARCH_COUNT = 10;

/** What one search costs under this model: the resolved id the call names. */
export function webSearchUsd(modelId: string): number {
  return isGlmModel(modelId) ? ZAI_WEB_SEARCH_USD : MOONSHOT_WEB_SEARCH_USD;
}

type FiberResponse = {
  status?: string;
  context?: { output?: string; encrypted_output?: string };
  error?: { message?: string };
};

type ZaiSearchResponse = {
  search_result?: { title?: string; content?: string; link?: string; media?: string; publish_date?: string }[];
  error?: { message?: string };
};

async function searchMoonshot(query: string, abortSignal: AbortSignal | undefined): Promise<string> {
  const res = await outboundFetch(`${moonshotApiUrl()}/formulas/${WEB_SEARCH_FORMULA}/fibers`, {
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
}

async function searchZai(query: string, abortSignal: AbortSignal | undefined): Promise<string> {
  const res = await outboundFetch(`${gatewayUrl("/zai")}/web_search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${keyFor("zai") ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ search_engine: ZAI_WEB_SEARCH_ENGINE, search_query: query, count: ZAI_WEB_SEARCH_COUNT }),
    signal: abortSignal,
  });
  const body = (await res.json().catch(() => null)) as ZaiSearchResponse | null;
  if (!res.ok || !Array.isArray(body?.search_result)) {
    throw new Error(body?.error?.message ?? `request failed (${res.status})`);
  }
  const results = body.search_result.filter((r) => r.link && r.title);
  if (results.length === 0) return "No results.";
  return results
    .map((r, i) => {
      const head = [r.title, r.media, r.publish_date].filter(Boolean).join(" — ");
      return `${i + 1}. ${head}\n${r.link}\n${(r.content ?? "").trim()}`;
    })
    .join("\n\n");
}

/** The web-search tool for the model that answers: `modelId` is the resolved
    id the call names (resolveModelId). */
export function webSearchTool(modelId: string) {
  const search = isGlmModel(modelId) ? searchZai : searchMoonshot;
  return tool({
    description: "Search the web for information",
    inputSchema: z.object({ query: z.string().describe("What to search for") }),
    execute: async ({ query }, { abortSignal }) => {
      try {
        return await search(query, abortSignal);
      } catch (err) {
        // The model reads the failure and answers from the material alone.
        console.warn("[assistant] web search failed:", err);
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    // The result reaches the model as the string it is, never re-encoded as JSON.
    toModelOutput: ({ output }) => ({ type: "text", value: output }),
  });
}
