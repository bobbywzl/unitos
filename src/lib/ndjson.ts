// Reads a newline-delimited JSON response body, yielding one parsed object per line.
// Used by long-running POST routes that stream progress before a terminal result.
export async function* readNdjson<T = unknown>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as T;
}

// Writes one JSON value per line to a stream controller. Pair with readNdjson on the client.
export function ndjsonWriter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder();
  return (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
}
