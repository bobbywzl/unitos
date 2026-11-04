import type { TextStreamPart, ToolSet } from "ai";
import { GEMINI_3_8_FLASH } from "@/lib/derive/config";
import { fallbackCalls, featureCall, featureModelId } from "@/lib/feature-models";
import { resolveModelId } from "@/lib/models";
import { geminiConfigured, geminiGoogleSearch } from "@/lib/gemini";
import { WEB_SEARCH_TOOL, webSearchTool, webSearchUsd } from "@/lib/kimi";
import { modelCall, modelConfigured, type Effort, type ModelCall } from "@/lib/model-call";

// Web access for every assistant (SPEC.md §7): the sidebar assistant, the
// selection's tools and its assistant chat, the note assistant, and the
// assistant's commands. With the web on, the turn runs on Gemini with Google
// Search, the assistant's own model and key: Google runs the search inside
// the call, and the pages it read come back as url sources, which the route
// lists under the answer (webSourcesSection). Without a Gemini key the turn
// runs on the web feature's model with its provider's search (lib/kimi.ts:
// Z.ai under GLM, Moonshot under Kimi), as before.

export const GOOGLE_SEARCH_TOOL = "google_search";

export type WebCall = {
  call: ModelCall;
  tools: ToolSet;
  /** What one search costs, for the usage record. Google bills a grounded
      search on its own price list, which this app does not read: $0 here. */
  searchUsd: number;
};

/** The model and the search for a turn with the web on. */
export async function webCall(effort: Effort): Promise<WebCall> {
  if (geminiConfigured()) {
    const assistant = await featureModelId("assistant");
    const call = await modelCall(assistant.startsWith("gemini-") ? assistant : GEMINI_3_8_FLASH, effort);
    return { call, tools: { [GOOGLE_SEARCH_TOOL]: geminiGoogleSearch() }, searchUsd: 0 };
  }
  const call = await featureCall("web", effort);
  return { call, tools: { [WEB_SEARCH_TOOL]: webSearchTool(call.modelId) }, searchUsd: webSearchUsd(call.modelId) };
}

/** The last message of a turn that runs again without the web: its
    prompt still holds the web rules, and the model must not claim a search. */
export const NO_WEB_MESSAGE = {
  role: "user" as const,
  content: "The web search is not available for this answer. Answer from the material alone, and do not say you searched.",
};

/** One more try of a failed turn: a model, and its search or none. */
export type Retry = { call: ModelCall; tools: ToolSet | null };

/** The calls a turn runs again on when its model failed before any words
    came, in order, once each (a provider's outage, its balance spent, a
    search it refuses). After a web turn: the web feature's model with its
    provider's search (lib/kimi.ts) when it is another model with a key.
    Then every fallback model with a key, without the web (fallbackCalls),
    in order. */
export async function retryCalls(failedId: string, effort: Effort, web: boolean, picture: boolean): Promise<Retry[]> {
  const failed = await resolveModelId(failedId);
  const retries: Retry[] = [];
  if (web && !picture) {
    const id = await featureModelId("web");
    if ((await resolveModelId(id)) !== failed && modelConfigured(id)) {
      const call = await featureCall("web", effort);
      retries.push({ call, tools: { [WEB_SEARCH_TOOL]: webSearchTool(call.modelId) } });
    }
  }
  for (const call of await fallbackCalls(failedId, effort, picture)) retries.push({ call, tools: null });
  return retries;
}

/** A stream part that is one search: Google's, or the provider tool's. */
export function isSearchCall(part: { type: string; toolName?: string }): boolean {
  return part.type === "tool-call" && (part.toolName === WEB_SEARCH_TOOL || part.toolName === GOOGLE_SEARCH_TOOL);
}

/** The pages a turn read, in the order they came, once each: Google's url
    sources, and the links a provider search's results carry. */
export class WebSources {
  private pages = new Map<string, string>();

  read<TOOLS extends ToolSet>(part: TextStreamPart<TOOLS>): void {
    if (part.type === "source" && part.sourceType === "url") {
      if (!this.pages.has(part.url)) this.pages.set(part.url, part.title?.trim() || hostOf(part.url));
      return;
    }
    if (part.type === "tool-result" && part.toolName === WEB_SEARCH_TOOL && typeof part.output === "string") {
      for (const m of part.output.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) {
        if (!this.pages.has(m[0])) this.pages.set(m[0], hostOf(m[0]));
      }
    }
  }

  /** A whole call's pages (generateText): its url sources, and its steps'
      search results. */
  readResult(result: {
    sources: { sourceType: string; url?: string; title?: string }[];
    steps: { toolResults: { toolName: string; output: unknown }[] }[];
  }): void {
    for (const source of result.sources) {
      if (source.sourceType === "url" && source.url && !this.pages.has(source.url)) {
        this.pages.set(source.url, source.title?.trim() || hostOf(source.url));
      }
    }
    for (const step of result.steps) {
      for (const r of step.toolResults) {
        if (r.toolName !== WEB_SEARCH_TOOL || typeof r.output !== "string") continue;
        for (const m of r.output.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) {
          if (!this.pages.has(m[0])) this.pages.set(m[0], hostOf(m[0]));
        }
      }
    }
  }

  get size(): number {
    return this.pages.size;
  }

  /** The section under the answer: "Web sources", one markdown link per
      page. Empty when the turn read no page, or when the answer already
      ends with its own Web sources section (a provider search's answer
      writes it, its links taken from the results). */
  section(answer: string, heading: string): string {
    if (this.pages.size === 0) return "";
    if (/\n#*\s*\**\s*web sources\b/i.test(answer) || answer.includes(heading)) return "";
    const lines = [...this.pages].map(([url, title]) => `- [${title.replace(/[[\]]/g, "")}](${url})`);
    return `\n\n**${heading}**\n${lines.join("\n")}`;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
