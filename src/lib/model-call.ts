import type { LanguageModel } from "ai";
import { claude, claudeConfigured, claudeOptions } from "@/lib/claude";
import type { ClaudeEffort, KimiEffort } from "@/lib/derive/config";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { resolveModelId } from "@/lib/models";

// One call on any chat model by its id (SPEC.md §2): a claude- id goes
// through lib/claude.ts, every other id through lib/kimi.ts — GLM and Kimi
// — with the effort translated to the client's levels. The features
// (lib/feature-models.ts) and the parse passes (lib/parse/model.ts) build
// their calls here, so a feature's model is one id, whichever provider it
// belongs to.

export type Effort = KimiEffort | ClaudeEffort;

export type ModelCall = {
  model: LanguageModel;
  providerOptions: ReturnType<typeof kimiOptions> | ReturnType<typeof claudeOptions>;
  // The id called, for the usage record.
  modelId: string;
};

/** A Claude id: called through lib/claude.ts. */
export function isClaudeId(id: string): boolean {
  return id.startsWith("claude-");
}

/** The id's client has its key, so a call on it can run. A GLM id needs
    what Kimi needs: without the gateway it resolves to Kimi K3. */
export function modelConfigured(id: string): boolean {
  return isClaudeId(id) ? claudeConfigured() : kimiConfigured();
}

/** Kimi K3 and GLM 5.3 take three efforts; a Claude effort between them
    rounds to high. */
export function kimiEffort(effort: Effort): KimiEffort {
  return effort === "low" || effort === "max" ? effort : "high";
}

/** The model, its provider options at this effort, and the id called. */
export async function modelCall(id: string, effort: Effort): Promise<ModelCall> {
  const modelId = await resolveModelId(id);
  if (isClaudeId(id)) {
    return { model: await claude(id), providerOptions: claudeOptions(effort), modelId };
  }
  return { model: await kimi(id), providerOptions: kimiOptions(kimiEffort(effort)), modelId };
}
