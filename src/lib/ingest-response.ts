import { serverT } from "@/lib/i18n/server";
import { ndjsonWriter } from "@/lib/ndjson";
import type { OnIngestProgress } from "@/lib/parse/ingest";

// Once validation passes, ingest is real work worth showing progress for (parse, save).
// The HTTP status is committed to 200 the moment this stream opens, so failures from here
// on are reported in-band as a final {error} line instead of a status code — same tradeoff
// the /api/derive text stream already makes.
export function progressResponse(
  run: (onProgress: OnIngestProgress) => Promise<{ id: string; title: string; deduped: boolean }>,
) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      try {
        const result = await run((stage, detail) => send({ stage, detail }));
        send(result);
      } catch (err) {
        const t = await serverT();
        send({ error: err instanceof Error ? err.message : t("common.requestFailed") });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
