import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { STITCH_DEADLINE_MS, STREAM_ERROR_TOKEN } from "@/lib/derive/config";
import { modelErrorMessage } from "@/lib/derive/json-call";
import { stitch } from "@/lib/graph/stitch";
import { currentLang, serverT } from "@/lib/i18n/server";
import { kimiConfigured } from "@/lib/kimi";
import { parseBody } from "@/lib/validate";

export const maxDuration = 300;

// Stitch (SPEC.md §22): one command over the project's documents, from the
// graph — the documents named by documentIds (the nodes selected in the
// graph), or every attached document when none are named. Answers over the
// heartbeat stream (the DISTILL pattern): spaces while the model works, then
// the result JSON or the in-band error token. Stop aborts the request; a
// stopped run stores nothing more. The model passes get STITCH_DEADLINE_MS
// together: past it the run is cut and the reader is told so in-band, never
// left with a stream that ended empty.
const requestSchema = z.object({
  command: z.string().trim().min(1).max(4_000),
  documentIds: z.array(z.string().min(1)).max(200).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .max(20)
    .default([]),
});

class StitchFailure extends Error {}

export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.assistantNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  // The documents to read: the selected ones, distinct and attached to this
  // project; or every attached document. Fewer than two cannot be stitched.
  const selected = data.documentIds ? [...new Set(data.documentIds)] : null;
  const attached = await db.notebookDocument.count({
    where: { notebookId, ...(selected ? { documentId: { in: selected } } : {}) },
  });
  if (attached < 2) {
    return NextResponse.json({ error: t("api.stitchNeedsTwo") }, { status: 400 });
  }
  const lang = await currentLang();

  const encoder = new TextEncoder();
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!cancelled) controller.enqueue(encoder.encode(text));
      };
      heartbeat = setInterval(() => send(" "), 5_000);
      const deadline = AbortSignal.timeout(STITCH_DEADLINE_MS);
      try {
        const result = await stitch({
          notebookId,
          documentIds: selected,
          userId: access.user.id,
          lang,
          command: data.command,
          history: data.history,
          signal: AbortSignal.any([req.signal, deadline]),
          onFailure: (reason) => new StitchFailure(reason),
        });
        if (cancelled || req.signal.aborted) return;
        send(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        if (!cancelled && !req.signal.aborted) {
          console.error("[stitch] failed:", err);
          if (deadline.aborted) {
            send(`${STREAM_ERROR_TOKEN}${t("api.stitchTimedOut")}`);
          } else {
            const reason = err instanceof StitchFailure ? err.message : modelErrorMessage(err);
            send(`${STREAM_ERROR_TOKEN}${t("api.stitchFailed", { reason })}`);
          }
        }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
