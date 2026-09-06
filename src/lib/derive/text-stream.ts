import type { TextStreamPart, ToolSet } from "ai";
import type { TFunc } from "@/lib/i18n/dictionaries";

// A streamed text derivation, read for the client (SPEC.md §4): EXPLAIN,
// SIMPLIFY, ANALYZE, SUMMARIZE, ASK, and the assistant's answer.
//
// Kimi K3 reasons before it writes, and its reasoning sends no text: the
// connection carries no byte until the first text delta, and an idle
// connection dies at proxies (the DISTILL heartbeat's reason). So a heartbeat
// space goes out every HEARTBEAT_MS until the first text delta;
// splitStreamError drops the spaces on the client.
//
// The AI SDK's textStream drops error parts, so a failed call — a bad key, no
// balance, a rate limit, a rejected request — would end as an empty stream.
// This reads fullStream and throws with the reason. A stream that ends with no
// text throws too when the output budget ran out (the reasoning spent it) or
// the model declined. Resolves to the text the model wrote.

export const HEARTBEAT_MS = 5_000;

export async function streamTextTo<TOOLS extends ToolSet>(
  result: { fullStream: AsyncIterable<TextStreamPart<TOOLS>> },
  send: (chunk: string) => void,
  options: { t: TFunc; onPart?: (part: TextStreamPart<TOOLS>) => void },
): Promise<string> {
  let text = "";
  let started = false;
  let finishReason: string | null = null;
  const heartbeat = setInterval(() => send(" "), HEARTBEAT_MS);
  try {
    for await (const part of result.fullStream) {
      options.onPart?.(part);
      if (part.type === "text-delta") {
        if (!started) {
          started = true;
          clearInterval(heartbeat);
        }
        text += part.text;
        send(part.text);
      } else if (part.type === "error") {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      } else if (part.type === "abort") {
        // Stop (SPEC.md §6): the reader left, and the route persists nothing.
        throw new Error("The reader stopped the derivation.");
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
      }
    }
  } finally {
    clearInterval(heartbeat);
  }
  if (!text.trim()) {
    if (finishReason === "length") throw new Error(options.t("api.outputBudgetSpent"));
    if (finishReason === "content-filter") throw new Error(options.t("api.modelDeclined"));
  }
  return text;
}
