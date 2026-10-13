import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { STREAM_ERROR_TOKEN, STRUCTURE_DEADLINE_MS } from "@/lib/derive/config";
import { modelErrorMessage } from "@/lib/derive/json-call";
import { featureConfigured } from "@/lib/feature-models";
import { currentLang, serverT } from "@/lib/i18n/server";
import { structureTurn } from "@/lib/structure-assist";
import { parseBody } from "@/lib/validate";

export const maxDuration = 300;

// The structure assistant (SPEC.md §32): one turn over the document's
// structure. Answers over the heartbeat stream (the Stitch pattern): spaces
// while the model works, then the result JSON — the reply and the proposal,
// if any — or the in-band error token. Stop aborts the request; nothing is
// stored by a turn: the reader applies a proposal with a PUT of the
// structure route.
const requestSchema = z.object({
  message: z.string().trim().min(1).max(4_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8_000) }))
    .max(20)
    .default([]),
});

class StructureFailure extends Error {}

export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string; documentId: string }> }) {
  const t = await serverT();
  const { notebookId, documentId } = await ctx.params;
  if (!(await featureConfigured("structure"))) {
    return NextResponse.json({ error: t("api.structureNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
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
      const deadline = AbortSignal.timeout(STRUCTURE_DEADLINE_MS);
      try {
        const result = await structureTurn({
          notebookId,
          documentId,
          userId: access.user.id,
          lang,
          message: data.message,
          history: data.history,
          signal: AbortSignal.any([req.signal, deadline]),
          onFailure: (reason) => new StructureFailure(reason),
        });
        if (cancelled || req.signal.aborted) return;
        send(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        if (!cancelled && !req.signal.aborted) {
          console.error("[structure] failed:", err);
          if (deadline.aborted) {
            send(`${STREAM_ERROR_TOKEN}${t("api.structureTimedOut")}`);
          } else {
            const reason = err instanceof StructureFailure ? err.message : modelErrorMessage(err);
            send(`${STREAM_ERROR_TOKEN}${t("api.structureFailed", { reason })}`);
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
