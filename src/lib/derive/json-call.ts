import { generateText, type ModelMessage } from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { extractJson } from "@/lib/derive/json";
import { recordUsage, sdkTokens, type UsageMeta } from "@/lib/usage";

type JsonCallResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** A model-call failure as a readable message. The route returns it to the
    client, so the toast shows the real reason, never a bare 500. */
export function modelErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 400 ? `${message.slice(0, 400)}…` : message;
}

// JSON-output derivations: validate strictly; on failure retry once with the error
// appended; then surface failure (SPEC.md §4). A thrown model call (API error,
// overload, oversized request) also surfaces as ok: false — never as an
// unhandled 500.
export async function callForJson<S extends z.ZodType>(params: {
  model: LanguageModel;
  messages: ModelMessage[];
  maxOutputTokens: number;
  schema: S;
  label: string;
  // Usage telemetry for the admin usage page; every call site passes it.
  usage?: UsageMeta;
  // Aborts the model call when the client disconnects (DISTILL passes the
  // request signal, so Cancel stops the generation, not just the response).
  abortSignal?: AbortSignal;
}): Promise<JsonCallResult<z.infer<S>>> {
  const attempt = async (messages: ModelMessage[]) => {
    const result = await generateText({
      model: params.model,
      maxOutputTokens: params.maxOutputTokens,
      allowSystemInMessages: true,
      messages,
      abortSignal: params.abortSignal,
    });
    console.log(
      `[derive] ${params.label} cacheRead=${result.usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
        `cacheWrite=${result.usage.inputTokenDetails.cacheWriteTokens ?? 0} ` +
        `output=${result.usage.outputTokens ?? 0}`,
    );
    if (params.usage) recordUsage(params.usage, sdkTokens(result.usage));
    return result.text;
  };

  let first: string;
  try {
    first = await attempt(params.messages);
  } catch (err) {
    console.error(`[derive] ${params.label} model call failed:`, err);
    return { ok: false, error: modelErrorMessage(err) };
  }
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
  let second: string;
  try {
    second = await attempt(retryMessages);
  } catch (err) {
    console.error(`[derive] ${params.label} model call failed on retry:`, err);
    return { ok: false, error: modelErrorMessage(err) };
  }
  const secondJson = extractJson(second);
  const secondParsed = params.schema.safeParse(secondJson);
  if (secondParsed.success) return { ok: true, data: secondParsed.data };
  return { ok: false, error };
}
