import { PARSE_EFFORT, PARSE_MODEL, type ClaudeEffort, type KimiEffort } from "@/lib/derive/config";
import { featureModelId } from "@/lib/feature-models";
import { modelCall, modelConfigured, type ModelCall } from "@/lib/model-call";

// The parse passes' model (SPEC.md §2): the core, structure, and layout
// passes call whichever client their model id belongs to — a claude- id
// goes through lib/claude.ts, every other id through lib/kimi.ts
// (lib/model-call.ts) — so the passes and their prompts are the same under
// any model. The default choice is the parse feature's model: the constant
// (PARSE_MODEL, PARSE_EFFORT in lib/derive/config.ts), or the id the admin
// set for parse (lib/feature-models.ts). The comparison script
// (scripts/parse-compare.ts) passes a choice of its own to run the same page
// under two models.

export type ParseModel = { id: string; effort: KimiEffort | ClaudeEffort };

/** The default choice: the parse feature's model at the parse effort. Its id
    is the constant's, and the call reads the feature (parseCall). */
export const DEFAULT_PARSE_MODEL: ParseModel = { id: PARSE_MODEL, effort: PARSE_EFFORT };

// The default choice stands for the parse feature: the id the admin set, or
// the constant. A choice of its own is called as it is.
async function chosenId(choice: ParseModel): Promise<string> {
  return choice === DEFAULT_PARSE_MODEL ? featureModelId("parse") : choice.id;
}

/** The key for the choice's client is set, so the passes run. */
export async function parseConfigured(choice: ParseModel = DEFAULT_PARSE_MODEL): Promise<boolean> {
  return modelConfigured(await chosenId(choice));
}

/** A parse pass's model, its provider options, and the id called (for the
    usage record). */
export async function parseCall(choice: ParseModel = DEFAULT_PARSE_MODEL): Promise<ModelCall> {
  return modelCall(await chosenId(choice), choice.effort);
}
