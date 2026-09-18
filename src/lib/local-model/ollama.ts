import { clientLang } from "@/lib/api";
import { translate } from "@/lib/i18n/dictionaries";
import type { LocalModel } from "@/lib/local-model/settings";

// The browser's calls to the local model (SPEC.md §27): Ollama's
// OpenAI-compatible chat endpoint at the URL Settings holds. Every call is
// from the browser to the reader's machine. Ollama answers a browser only
// when the page's origin is in its OLLAMA_ORIGINS; a refused or unreachable
// call surfaces as the one message that says what to set.

export type LocalMessage = { role: "system" | "user" | "assistant"; content: string };

// The prompt Test sends. The answer is shown as it came, so the reader sees
// the model answer.
const TEST_PROMPT = "Reply with one short sentence: which model are you?";

/** The line the reader sets before starting Ollama: this page's origin. */
export function ollamaOriginsLine(): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `OLLAMA_ORIGINS=${origin}`;
}

// A thinking model may write its reasoning inline between <think> tags; the
// rewrite is what follows. An unclosed block is reasoning still going.
export function stripThinking(text: string): string {
  const closed = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  const open = closed.indexOf("<think>");
  return (open === -1 ? closed : closed.slice(0, open)).replace(/^\s+/, "");
}

// A failed fetch — Ollama not running, or the origin not in OLLAMA_ORIGINS —
// throws before any response; the browser says no more than "Failed to
// fetch". The message names both causes and the line to set.
function unreachable(local: LocalModel): Error {
  return new Error(
    translate(clientLang(), "settings.localModelUnreachable", {
      url: local.url,
      line: ollamaOriginsLine(),
    }),
  );
}

// Ollama's error body: {"error": {"message": "..."}} on the OpenAI-compatible
// endpoint, {"error": "..."} on its own.
async function failed(res: Response): Promise<Error> {
  let reason = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    if (typeof body.error === "string") reason = body.error;
    else if (body.error?.message) reason = body.error.message;
  } catch {
    // no body, or not JSON: the status is the reason
  }
  return new Error(translate(clientLang(), "settings.localModelFailed", { reason }));
}

async function post(
  local: LocalModel,
  body: unknown,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${local.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw unreachable(local);
  }
  if (!res.ok) throw await failed(res);
  return res;
}

/** One answer from the local model, streamed: onText gets the text so far
    after every chunk. Resolves to the whole text, thinking stripped. */
export async function streamLocalModel(
  local: LocalModel,
  messages: LocalMessage[],
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await post(local, { model: local.model, messages, stream: true }, signal);
  if (!res.body) throw unreachable(local);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  const take = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        raw += delta;
        onText(stripThinking(raw));
      }
    } catch {
      // a partial or foreign line: nothing to read
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) take(line.trim());
  }
  if (buffer.trim()) take(buffer.trim());
  return stripThinking(raw).trim();
}

/** Test in Settings: one short question to the model; resolves to its answer. */
export async function testLocalModel(local: LocalModel, signal?: AbortSignal): Promise<string> {
  const res = await post(
    local,
    { model: local.model, messages: [{ role: "user", content: TEST_PROMPT }], stream: false },
    signal,
  );
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const answer = stripThinking(body.choices?.[0]?.message?.content ?? "").trim();
  if (!answer) {
    throw new Error(translate(clientLang(), "settings.localModelFailed", { reason: translate(clientLang(), "reader.emptyResponse") }));
  }
  return answer.length > 300 ? `${answer.slice(0, 300)}…` : answer;
}
