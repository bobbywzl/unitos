import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled } from "@/lib/auth";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS, STREAM_ERROR_TOKEN } from "@/lib/derive/config";
import { loadProfile } from "@/lib/derive/context";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { ensureAllDigests, ensureDigest } from "@/lib/digest/ensure";
import { corporaSystem, corpusSystem } from "@/lib/digest/render";
import { currentLang, serverT } from "@/lib/i18n/server";
import { recordUsage, sdkTokens } from "@/lib/usage";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { synthesisAskPrompt, synthesisTaskPrompt } from "@/lib/prompts/synthesis";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// Assistant panel with two scopes, both reading the digest (SPEC.md §7).
// Scope ids stay as wire values: notebook = this corpus whole, corpus = every
// corpus whole. SYNTHESIS derivations; transient output.
const assistantSchema = z.object({
  notebookId: z.string().min(1),
  scope: z.enum(["notebook", "corpus"]),
  task: z.enum(["ask", "contradictions", "gaps", "unsourced"]),
  question: z.string().min(1).max(4000).optional(),
});

const issuesSchema = z.object({
  issues: z
    .array(
      z.object({
        noteIds: z.array(z.string()).max(10),
        issue: z.string().min(1).max(500),
        explanation: z.string().min(1).max(2000),
      }),
    )
    .max(30),
});

// Any unexpected throw still answers with the reason, never a bare 500.
export async function POST(req: Request) {
  const t = await serverT();
  try {
    return await handle(req, t);
  } catch (err) {
    console.error("[assistant] failed:", err);
    return NextResponse.json(
      { error: t("api.assistantFailed", { reason: modelErrorMessage(err) }) },
      { status: 500 },
    );
  }
}

async function handle(req: Request, t: TFunc) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: t("api.assistantNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, assistantSchema);
  if (error) return error;

  if (data.task !== "ask" && data.scope !== "notebook") {
    return NextResponse.json({ error: t("api.taskCorpusScope") }, { status: 400 });
  }
  if (data.task === "ask" && !data.question) {
    return NextResponse.json({ error: t("api.questionRequired") }, { status: 400 });
  }
  // The assistant reads the digest and can write through act: editor.
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const user = access.user;
  const usageMeta = {
    userId: user.id,
    feature: "assistant",
    model: DERIVATION_MODEL.SYNTHESIS,
  };

  const profile = await loadProfile(data.notebookId);
  const model = anthropic(DERIVATION_MODEL.SYNTHESIS);
  const maxOutputTokens = MAX_OUTPUT_TOKENS.SYNTHESIS;

  // The digest is the scope context: deterministic until the content changes,
  // so the prompt prefix caches across questions (SPEC.md §2).
  let system: string;
  let scopeLabel: string;
  if (data.scope === "notebook") {
    const digest = await ensureDigest(data.notebookId);
    if (!digest) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
    system = corpusSystem(digest.parts);
    scopeLabel =
      "this corpus: every document in full, and every note, annotation, distillation, extraction, and summary in it";
  } else {
    // Corpora scope: the signed-in reader's corpora (every corpus in
    // single-reader mode).
    const digests = await ensureAllDigests(authEnabled() ? user.id : undefined);
    system = corporaSystem(digests.map((d) => d.parts));
    scopeLabel =
      "all your corpora: every document, note, annotation, distillation, extraction, and summary across them";
  }

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: system,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    {
      role: "user",
      content:
        data.task === "ask"
          ? synthesisAskPrompt({
              profile,
              lang: await currentLang(),
              scopeLabel,
              question: data.question!,
            })
          : synthesisTaskPrompt({ profile, lang: await currentLang(), task: data.task }),
    },
  ];

  if (data.task === "ask") {
    const result = streamText({
      model,
      maxOutputTokens,
      allowSystemInMessages: true,
      messages,
      // Stop aborts here too (SPEC.md §6): the client disconnecting stops the
      // model call, not just the response the client would have read.
      abortSignal: req.signal,
      onEnd: ({ usage }) => {
        console.log(
          `[assistant] ask scope=${data.scope} chars=${system.length} cacheRead=${usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
            `cacheWrite=${usage.inputTokenDetails.cacheWriteTokens ?? 0} output=${usage.outputTokens ?? 0}`,
        );
        recordUsage(usageMeta, sdkTokens(usage));
      },
    });
    // A model failure must reach the reader: the stream ends with
    // STREAM_ERROR_TOKEN + the reason, never a silent empty 200 (the derive
    // route's pattern).
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          console.error("[assistant] stream error:", err);
          controller.enqueue(
            encoder.encode(
              `${STREAM_ERROR_TOKEN}${t("api.assistantFailed", { reason: modelErrorMessage(err) })}`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const result = await callForJson({
    model,
    messages,
    maxOutputTokens,
    schema: issuesSchema,
    label: `assistant:${data.task}`,
    usage: usageMeta,
  });
  if (!result.ok) {
    return NextResponse.json({ error: t("api.taskFailed", { reason: result.error }) }, { status: 422 });
  }
  // Keep only note ids that exist in this corpus.
  const validIds = new Set(
    (
      await db.note.findMany({
        where: { section: { notebookId: data.notebookId } },
        select: { id: true },
      })
    ).map((n) => n.id),
  );
  const issues = result.data.issues.map((issue) => ({
    ...issue,
    noteIds: issue.noteIds.filter((id) => validIds.has(id)),
  }));
  return NextResponse.json({ issues });
}
