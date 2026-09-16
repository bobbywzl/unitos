import type { LanguageModel } from "ai";
import { claude, claudeConfigured, claudeOptions } from "@/lib/claude";
import { PARSE_EFFORT, PARSE_MODEL, type ClaudeEffort, type KimiEffort } from "@/lib/derive/config";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { resolveModelId } from "@/lib/models";

// The parse passes' model (SPEC.md §2): the core, structure, and layout
// passes call whichever client their model id belongs to — a claude- id
// goes through lib/claude.ts, every other id through lib/kimi.ts — so the
// passes and their prompts are the same under any model, and a switch is
// one constant (PARSE_MODEL, PARSE_EFFORT in lib/derive/config.ts). The
// comparison script (scripts/parse-compare.ts) passes a choice of its own
// to run the same page under two models.

export type ParseModel = { id: string; effort: KimiEffort | ClaudeEffort };

export const DEFAULT_PARSE_MODEL: ParseModel = { id: PARSE_MODEL, effort: PARSE_EFFORT };

function isClaude(id: string): boolean {
  return id.startsWith("claude-");
}

// Kimi K3 has three efforts; a Claude effort between them rounds to high.
function kimiEffort(effort: KimiEffort | ClaudeEffort): KimiEffort {
  return effort === "low" || effort === "max" ? effort : "high";
}

/** The key for the choice's client is set, so the passes run. */
export function parseConfigured(choice: ParseModel = DEFAULT_PARSE_MODEL): boolean {
  return isClaude(choice.id) ? claudeConfigured() : kimiConfigured();
}

/** A parse pass's model, its provider options, and the id called (for the
    usage record). */
export async function parseCall(choice: ParseModel = DEFAULT_PARSE_MODEL): Promise<{
  model: LanguageModel;
  providerOptions: ReturnType<typeof kimiOptions> | ReturnType<typeof claudeOptions>;
  modelId: string;
}> {
  const modelId = await resolveModelId(choice.id);
  if (isClaude(choice.id)) {
    return { model: await claude(choice.id), providerOptions: claudeOptions(choice.effort as ClaudeEffort), modelId };
  }
  return { model: await kimi(choice.id), providerOptions: kimiOptions(kimiEffort(choice.effort)), modelId };
}
