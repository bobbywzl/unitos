import { z } from "zod";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { ndjsonHeartbeat, ndjsonWriter } from "@/lib/ndjson";
import type { OnIngestProgress } from "@/lib/parse/ingest";

// The title the reader chose in the queue before the add (SPEC.md §15):
// every add path takes it as `title`. Empty means the document's own title.
export const chosenTitleSchema = z.string().trim().max(300).optional();

/** A chosen title lands on the document the add made, never on a deduped
    one: a deduped document is one row other projects, and other accounts,
    may share, and its title is theirs too. */
async function applyChosenTitle<T extends Record<string, unknown>>(result: T, title: string | undefined): Promise<T> {
  if (!title || typeof result.id !== "string" || result.deduped === true) return result;
  await db.document.update({ where: { id: result.id }, data: { title } });
  const documents = Array.isArray(result.documents)
    ? (result.documents as { id: string; title: string }[]).map((d) => (d.id === result.id ? { ...d, title } : d))
    : undefined;
  return { ...result, title, ...(documents ? { documents } : {}) };
}

// Once validation passes, ingest is real work worth showing progress for (parse, save).
// The HTTP status is committed to 200 the moment this stream opens, so failures from here
// on are reported in-band as a final {error} line instead of a status code — same tradeoff
// the /api/derive text stream already makes. The terminal line is the run's result:
// {id, title, deduped} for ingest, {review} for the upload assistant's review.
// A heartbeat keeps the connection alive while a model pass reasons in
// silence (lib/ndjson.ts).
export function progressResponse<T extends Record<string, unknown>>(
  run: (onProgress: OnIngestProgress) => Promise<T>,
  // title: the reader's chosen title for the document the add makes.
  options: { title?: string } = {},
) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      const stopHeartbeat = ndjsonHeartbeat(controller);
      try {
        const result = await applyChosenTitle(await run((stage, detail) => send({ stage, detail })), options.title);
        send(result);
      } catch (err) {
        const t = await serverT();
        send({ error: err instanceof Error ? err.message : t("common.requestFailed") });
      } finally {
        stopHeartbeat();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
