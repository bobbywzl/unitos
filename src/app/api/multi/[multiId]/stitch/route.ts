import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { STREAM_ERROR_TOKEN } from "@/lib/derive/config";
import { modelErrorMessage } from "@/lib/derive/json-call";
import { currentLang, serverT } from "@/lib/i18n/server";
import { kimiConfigured } from "@/lib/kimi";
import { stitch } from "@/lib/multi/stitch";
import { parseBody } from "@/lib/validate";

export const maxDuration = 300;

// Stitch (SPEC.md §22): one command over a multi upload's members. Answers
// over the heartbeat stream (the DISTILL pattern): spaces while the model
// works, then the result JSON or the in-band error token. Stop aborts the
// request; a stopped run stores nothing more.
const requestSchema = z.object({
  command: z.string().trim().min(1).max(4_000),
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

export async function POST(req: Request, ctx: { params: Promise<{ multiId: string }> }) {
  const t = await serverT();
  const { multiId } = await ctx.params;
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.assistantNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const multi = await db.multiUpload.findUnique({
    where: { id: multiId },
    select: { id: true, notebookId: true, _count: { select: { members: true } } },
  });
  if (!multi) return NextResponse.json({ error: t("api.multiNotFound") }, { status: 404 });
  const access = await notebookAccess(multi.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  if (multi._count.members < 2) {
    return NextResponse.json({ error: t("api.multiNeedsTwo") }, { status: 400 });
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
      try {
        const result = await stitch({
          multiUploadId: multi.id,
          notebookId: multi.notebookId,
          userId: access.user.id,
          lang,
          command: data.command,
          history: data.history,
          signal: req.signal,
          onFailure: (reason) => new StitchFailure(reason),
        });
        if (cancelled || req.signal.aborted) return;
        send(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        if (!cancelled && !req.signal.aborted) {
          console.error("[stitch] failed:", err);
          const reason = err instanceof StitchFailure ? err.message : modelErrorMessage(err);
          send(`${STREAM_ERROR_TOKEN}${t("api.stitchFailed", { reason })}`);
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
