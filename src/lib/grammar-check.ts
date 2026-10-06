import { GRAMMAR_EFFORT, GRAMMAR_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall } from "@/lib/feature-models";
import { grammarAnswerSchema, keptIssues, type GrammarResponse } from "@/lib/grammar";
import { currentLang } from "@/lib/i18n/server";
import { grammarPrompt } from "@/lib/prompts/grammar";
import type { UsageMeta } from "@/lib/usage";

// The grammar check's model call (SPEC.md §29, typing; /api/grammar): one
// call for the paragraphs of a request, the answer Zod-checked
// (lib/grammar.ts), each issue kept only when its wrong words are in its
// paragraph exactly. A paragraph the model skipped answers no issue.
export async function checkGrammar(
  paragraphs: { id: string; text: string }[],
  userId: string | null,
  signal?: AbortSignal,
): Promise<GrammarResponse | null> {
  const call = await featureCall("grammar", GRAMMAR_EFFORT);
  const result = await callForJson({
    model: call.model,
    messages: [{ role: "user", content: grammarPrompt({ lang: await currentLang(), paragraphs }) }],
    maxOutputTokens: GRAMMAR_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: grammarAnswerSchema,
    label: "GRAMMAR",
    abortSignal: signal,
    usage: { userId, feature: "grammar", model: call.modelId } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.error(`[grammar] ${result.error}`);
    return null;
  }
  const byId = new Map(result.data.paragraphs.map((p) => [p.id, p.issues]));
  return { paragraphs: paragraphs.map((p) => ({ id: p.id, issues: keptIssues(p.text, byId.get(p.id) ?? []) })) };
}
