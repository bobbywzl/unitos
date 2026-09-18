import { api } from "@/lib/api";
import { streamLocalModel, type LocalMessage } from "@/lib/local-model/ollama";
import type { LocalModel } from "@/lib/local-model/settings";

// The browser-side prompt runner (SPEC.md §27): the one derivation pipeline
// with the model call moved to the reader's machine. The server builds the
// prompt as it does for the cloud models (the prompt stage of /api/derive:
// same context, same template), the browser streams the answer from the
// local model, and the server stores it as it stores the cloud answer (the
// store stage: same validation, same destination handler). The server never
// sees the local model; it sees the text the client writes.

export type DeriveInput = Record<string, unknown> & { type: string };

export async function runLocalDerivation(params: {
  local: LocalModel;
  input: DeriveInput;
  // The text so far, after every chunk.
  onText: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; noteId: string | null }> {
  const { messages } = await api<{ messages: LocalMessage[] }>(
    "/api/derive",
    "POST",
    { ...params.input, stage: "prompt" },
    { signal: params.signal },
  );
  const text = await streamLocalModel(params.local, messages, params.onText, params.signal);
  // Nothing to store: the card says the model returned an empty response.
  if (!text) return { text, noteId: null };
  const stored = await api<{ noteId: string | null }>(
    "/api/derive",
    "POST",
    { ...params.input, stage: "store", output: text },
    { signal: params.signal },
  );
  return { text, noteId: stored.noteId };
}
