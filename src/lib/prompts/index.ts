import type { DerivationType } from "@prisma/client";
import { analyzePrompt } from "@/lib/prompts/analyze";
import { askPrompt } from "@/lib/prompts/ask";
import { comparePrompt } from "@/lib/prompts/compare";
import { distillPrompt } from "@/lib/prompts/distill";
import { explainPrompt } from "@/lib/prompts/explain";
import { findPrompt } from "@/lib/prompts/find";
import { formalizePrompt } from "@/lib/prompts/formalize";
import { saliencePrompt } from "@/lib/prompts/salience";
import { simplifyPrompt } from "@/lib/prompts/simplify";
import { summarizePrompt } from "@/lib/prompts/summarize";
import { visualizePrompt } from "@/lib/prompts/visualize";
import type { PromptCtx } from "@/lib/prompts/types";

// One template per DerivationType. New derivation = new template + destination handler,
// same pipeline (CLAUDE.md). EXPLAIN serves Circle & ask on a handwritten page
// only (SPEC.md §16); EXTRACT (the old Match-it) has no template: the
// assistant does that work (SPEC.md §7).
export const promptTemplates: Partial<Record<DerivationType, (ctx: PromptCtx) => string>> = {
  EXPLAIN: explainPrompt,
  SIMPLIFY: simplifyPrompt,
  SALIENCE: saliencePrompt,
  DISTILL: distillPrompt,
  SUMMARIZE: summarizePrompt,
  FIND: findPrompt,
  FORMALIZE: formalizePrompt,
  ASK: askPrompt,
  COMPARE: comparePrompt,
  ANALYZE: analyzePrompt,
  VISUALIZE: visualizePrompt,
  // VOICE's template is lib/prompts/voice.ts: the voice command runs from
  // /api/notes/voice, not from /api/derive (SPEC.md §6).
};
