import type { DerivationType } from "@prisma/client";
import { explainPrompt } from "@/lib/prompts/explain";
import type { PromptCtx } from "@/lib/prompts/types";

// One template per DerivationType. New derivation = new template + destination handler,
// same pipeline (CLAUDE.md).
export const promptTemplates: Partial<Record<DerivationType, (ctx: PromptCtx) => string>> = {
  EXPLAIN: explainPrompt,
};
