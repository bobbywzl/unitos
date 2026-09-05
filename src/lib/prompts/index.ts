import type { DerivationType } from "@prisma/client";
import { analyzePrompt } from "@/lib/prompts/analyze";
import { askPrompt } from "@/lib/prompts/ask";
import { comparePrompt } from "@/lib/prompts/compare";
import { distillPrompt } from "@/lib/prompts/distill";
import { explainPrompt } from "@/lib/prompts/explain";
import { extractPrompt } from "@/lib/prompts/extract";
import { findPrompt } from "@/lib/prompts/find";
import { formalizePrompt } from "@/lib/prompts/formalize";
import { saliencePrompt } from "@/lib/prompts/salience";
import { simplifyPrompt } from "@/lib/prompts/simplify";
import { summarizePrompt } from "@/lib/prompts/summarize";
import type { PromptCtx } from "@/lib/prompts/types";

// One template per DerivationType. New derivation = new template + destination handler,
// same pipeline (CLAUDE.md).
export const promptTemplates: Partial<Record<DerivationType, (ctx: PromptCtx) => string>> = {
  EXPLAIN: explainPrompt,
  SIMPLIFY: simplifyPrompt,
  SALIENCE: saliencePrompt,
  EXTRACT: extractPrompt,
  DISTILL: distillPrompt,
  SUMMARIZE: summarizePrompt,
  FIND: findPrompt,
  FORMALIZE: formalizePrompt,
  ASK: askPrompt,
  COMPARE: comparePrompt,
  ANALYZE: analyzePrompt,
  // VOICE has no template: the transcription ladder does the work (SPEC.md §6).
};
