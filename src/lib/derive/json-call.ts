import { generateText, type ModelMessage } from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { extractJson } from "@/lib/derive/json";

type JsonCallResult<T> = { ok: true; data: T } | { ok: false; error: string };

// JSON-output derivations: validate strictly; on failure retry once with the error
// appended; then surface failure (SPEC.md §4).
export async function callForJson<S extends z.ZodType>(params: {
  model: LanguageModel;
  messages: ModelMessage[];
  maxOutputTokens: number;
  schema: S;
  label: string;
}): Promise<JsonCallResult<z.infer<S>>> {
  const attempt = async (messages: ModelMessage[]) => {
    const result = await generateText({
      model: params.model,
      maxOutputTokens: params.maxOutputTokens,
      allowSystemInMessages: true,
      messages,
    });
    console.log(
      `[derive] ${params.label} cacheRead=${result.usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
        `cacheWrite=${result.usage.inputTokenDetails.cacheWriteTokens ?? 0} ` +
        `output=${result.usage.outputTokens ?? 0}`,
    );
    return result.text;
  };

  const first = await attempt(params.messages);
  const firstJson = extractJson(first);
  const firstParsed = params.schema.safeParse(firstJson);
  if (firstParsed.success) return { ok: true, data: firstParsed.data };

  const error =
    firstJson === null
      ? "Output was not valid JSON."
      : `Validation failed: ${JSON.stringify(firstParsed.error.issues.slice(0, 5))}`;
  const retryMessages: ModelMessage[] = [
    ...params.messages,
    { role: "assistant", content: first },
    {
      role: "user",
      content: `${error}\nReturn ONLY the corrected JSON. No other text.`,
    },
  ];
  const second = await attempt(retryMessages);
  const secondJson = extractJson(second);
  const secondParsed = params.schema.safeParse(secondJson);
  if (secondParsed.success) return { ok: true, data: secondParsed.data };
  return { ok: false, error };
}
