import type { DerivationType } from "@prisma/client";
import { explainPrompt } from "@/lib/prompts/explain";
import { extractPrompt } from "@/lib/prompts/extract";
import { saliencePrompt } from "@/lib/prompts/salience";
import { simplifyPrompt } from "@/lib/prompts/simplify";
import type { PromptCtx } from "@/lib/prompts/types";
import { visualizePrompt } from "@/lib/prompts/visualize";

// One template per DerivationType. New derivation = new template + destination handler,
// same pipeline (CLAUDE.md).
export const promptTemplates: Partial<
  Record<
    DerivationType,
    (ctx: PromptCtx & { targetSectionId?: string | null; focus?: string }) => string
  >
> = {
  EXPLAIN: explainPrompt,
  SIMPLIFY: simplifyPrompt,
  SALIENCE: saliencePrompt,
  EXTRACT: extractPrompt,
  VISUALIZE: visualizePrompt,
};
