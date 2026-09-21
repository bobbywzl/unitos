import { generateText, type ModelMessage, type ToolSet } from "ai";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import { claude, CLAUDE_REFUSAL_FALLBACK, isClaudeModel } from "@/lib/claude";
import { extractJson, parseJson } from "@/lib/derive/json";
import { gatewayConfigured, gatewayHeaders } from "@/lib/gateway";
import { serverT } from "@/lib/i18n/server";
import { computeCostUsd, recordUsage, sdkTokens, type UsageMeta } from "@/lib/usage";

type JsonCallResult<T> = { ok: true; data: T } | { ok: false; error: string };

// One model call's answer: its text and why it stopped.
type Attempt = { text: string; finishReason: string };

// The request's language, or English outside a request (background jobs).
async function outputBudgetSpent(): Promise<string> {
  return (await serverT())("api.outputBudgetSpent");
}

// The AI SDK's provider options, as generateText takes them.
type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

/** A model-call failure as a readable message. The route returns it to the
    client, so the toast shows the real reason, never a bare 500. */
// The reason shown on the reader's card. A message from the HTTP layer can
// quote the request's Authorization header, key included (an invalid header
// value, a failed fetch); the key never reaches the screen or the log line
// that quotes this text.
const BEARER_RX = /Bearer\s+[^\s"']+/g;
const KEY_RX = /\bsk-[A-Za-z0-9_-]{8,}/g;

export function modelErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const message = raw.replace(BEARER_RX, "Bearer [redacted]").replace(KEY_RX, "[redacted]");
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
  // The options of the model's client: kimiOptions(effort) for Kimi K3,
  // claudeOptions() for Claude Fable 5.1 (lib/derive/config.ts).
  providerOptions: ProviderOptions;
  // Tools the model may call before it answers (the web search, SPEC.md §7),
  // with the step cap; the JSON is the last step's text. toolCallUsd is what
  // each call costs on top of the tokens, for the usage record.
  tools?: ToolSet;
  stopWhen?: Parameters<typeof generateText>[0]["stopWhen"];
  toolCallUsd?: number;
}): Promise<JsonCallResult<z.infer<S>>> {
  const run = async (model: LanguageModel, messages: ModelMessage[], usage: UsageMeta | undefined) => {
    const result = await generateText({
      model,
      maxOutputTokens: params.maxOutputTokens,
      providerOptions: params.providerOptions,
      // The gateway's spend logs carry the same account and function as the
      // usage record (lib/gateway.ts); nothing without the gateway.
      headers: usage ? gatewayHeaders(usage) : undefined,
      allowSystemInMessages: true,
      messages,
      abortSignal: params.abortSignal,
      ...(params.tools ? { tools: params.tools, stopWhen: params.stopWhen } : {}),
    });
    const toolCalls = params.tools ? result.steps.reduce((n, step) => n + step.toolCalls.length, 0) : 0;
    console.log(
      `[derive] ${params.label} cacheRead=${result.usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
        `cacheWrite=${result.usage.inputTokenDetails.cacheWriteTokens ?? 0} ` +
        `output=${result.usage.outputTokens ?? 0}${params.tools ? ` toolCalls=${toolCalls}` : ""}`,
    );
    if (usage) {
      const tokens = sdkTokens(result.usage);
      recordUsage(
        usage,
        tokens,
        params.toolCallUsd && toolCalls > 0 ? computeCostUsd(usage.model, tokens) + toolCalls * params.toolCallUsd : undefined,
      );
    }
    return { text: result.text, finishReason: result.finishReason };
  };
  // A Claude call the safety classifiers declined runs once more on the
  // fallback model. Direct to Anthropic, the request's own `fallbacks`
  // field has the API do this in the same call; the gateway strips that
  // field (lib/claude.ts), so under the gateway the app does it here, and
  // the usage record names the model that answered.
  const attempt = async (messages: ModelMessage[]) => {
    const first = await run(params.model, messages, params.usage);
    if (first.finishReason !== "content-filter" || !gatewayConfigured() || !isClaudeModel(params.model)) {
      return first;
    }
    console.warn(`[derive] ${params.label} refused; rerunning on ${CLAUDE_REFUSAL_FALLBACK}`);
    return run(
      await claude(CLAUDE_REFUSAL_FALLBACK),
      messages,
      params.usage ? { ...params.usage, model: CLAUDE_REFUSAL_FALLBACK } : undefined,
    );
  };

  let first: Attempt;
  try {
    first = await attempt(params.messages);
  } catch (err) {
    console.error(`[derive] ${params.label} model call failed:`, err);
    return { ok: false, error: modelErrorMessage(err) };
  }
  // Kimi K3 counts its reasoning against maxOutputTokens: a budget spent
  // before the JSON ends reports as the budget, not as cut-off JSON. What the
  // model did write before the cut is still worth keeping — extractJson
  // closes a truncated object back into valid JSON — so the budget is a
  // failure only when nothing usable came back. Retrying is pointless here:
  // the same budget cuts the second answer in the same place.
  if (first.finishReason === "length") {
    const salvaged = parseJson(params.schema, first.text);
    if (salvaged !== null) return { ok: true, data: salvaged };
    return { ok: false, error: await outputBudgetSpent() };
  }
  const firstJson = extractJson(first.text);
  const firstParsed = params.schema.safeParse(firstJson);
  if (firstParsed.success) return { ok: true, data: firstParsed.data };

  const error =
    firstJson === null
      ? "Output was not valid JSON."
      : `Validation failed: ${JSON.stringify(firstParsed.error.issues.slice(0, 5))}`;
  const retryMessages: ModelMessage[] = [
    ...params.messages,
    { role: "assistant", content: first.text },
    {
      role: "user",
      content: `${error}\nReturn ONLY the corrected JSON. No other text.`,
    },
  ];
  let second: Attempt;
  try {
    second = await attempt(retryMessages);
  } catch (err) {
    console.error(`[derive] ${params.label} model call failed on retry:`, err);
    return { ok: false, error: modelErrorMessage(err) };
  }
  if (second.finishReason === "length") {
    const salvaged = parseJson(params.schema, second.text);
    if (salvaged !== null) return { ok: true, data: salvaged };
    return { ok: false, error: await outputBudgetSpent() };
  }
  const secondJson = extractJson(second.text);
  const secondParsed = params.schema.safeParse(secondJson);
  if (secondParsed.success) return { ok: true, data: secondParsed.data };
  // Neither answer parsed whole. What the second one did write still counts.
  const salvaged = parseJson(params.schema, second.text);
  if (salvaged !== null) return { ok: true, data: salvaged };
  return { ok: false, error };
}
