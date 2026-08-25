import type { DerivationType } from "@prisma/client";
import { distillPrompt } from "@/lib/prompts/distill";
import { explainPrompt } from "@/lib/prompts/explain";
import { findPrompt } from "@/lib/prompts/find";
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
  DISTILL: distillPrompt,
  SUMMARIZE: summarizePrompt,
  FIND: findPrompt,
};
