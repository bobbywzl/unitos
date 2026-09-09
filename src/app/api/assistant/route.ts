import { isStepCount, streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attachedFileSchema,
  attachedImageSchema,
  conversationTurnSchema,
  MAX_FILES_PER_MESSAGE,
  MAX_HISTORY_TURNS,
  MAX_IMAGES_PER_CONVERSATION,
  MAX_IMAGES_PER_MESSAGE,
} from "@/lib/assistant/attachments";
import { authEnabled } from "@/lib/auth";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import {
  DERIVATION_EFFORT,
  DERIVATION_MODEL,
  MAX_OUTPUT_TOKENS,
  STREAM_ERROR_TOKEN,
} from "@/lib/derive/config";
import { loadProfile } from "@/lib/derive/context";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { streamTextTo } from "@/lib/derive/text-stream";
import { ensureAllDigests, ensureDigest } from "@/lib/digest/ensure";
import { corporaSystem, corpusSystem } from "@/lib/digest/render";
import { currentLang, serverT } from "@/lib/i18n/server";
import { kimi, kimiConfigured, kimiOptions, WEB_SEARCH_TOOL, WEB_SEARCH_USD, webSearchTool } from "@/lib/kimi";
import { resolveModelId } from "@/lib/models";
import { computeCostUsd, recordUsage, sdkTokens } from "@/lib/usage";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { synthesisAskPrompt, synthesisHistoryTurn, synthesisTaskPrompt } from "@/lib/prompts/synthesis";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// Assistant panel with two scopes, both reading the digest (SPEC.md §7).
// Scope ids stay as wire values: notebook = this corpus whole, corpus = every
// corpus whole. SYNTHESIS derivations; transient output.
const assistantSchema = z.object({
  notebookId: z.string().min(1),
  scope: z.enum(["notebook", "corpus"]),
  task: z.enum(["ask", "contradictions", "gaps", "unsourced"]),
  question: z.string().max(4000).optional(),
  // ask only: the assistant may search the web and cite outside sources
  // (SPEC.md §7).
  web: z.boolean().optional(),
  // ask only: the conversation so far, oldest first (SPEC.md §7). The
  // question continues it. The prompt reads the newest MAX_HISTORY_TURNS.
  history: z.array(conversationTurnSchema).max(200).optional(),
  // ask only: what the reader attached to this message. An image is stored
  // (POST /api/images) and rides as its id; a file rides as its text
  // (lib/assistant/attachments.ts).
  images: z.array(attachedImageSchema).max(MAX_IMAGES_PER_MESSAGE).optional(),
  files: z.array(attachedFileSchema).max(MAX_FILES_PER_MESSAGE).optional(),
});

// Web access (SPEC.md §7): at most this many searches per answer, one step
// each, then the answer.
const WEB_SEARCH_MAX_USES = 5;

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
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.assistantNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, assistantSchema);
  if (error) return error;

  if (data.task !== "ask" && data.scope !== "notebook") {
    return NextResponse.json({ error: t("api.taskCorpusScope") }, { status: 400 });
  }
  const question = data.question?.trim() ?? "";
  const images = data.images ?? [];
  const files = data.files ?? [];
  if (data.task === "ask" && !question && images.length === 0 && files.length === 0) {
    return NextResponse.json({ error: t("api.questionRequired") }, { status: 400 });
  }
  // The assistant reads the digest and can write through act: editor.
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const user = access.user;
  const usageMeta = {
    userId: user.id,
    feature: "assistant",
    model: await resolveModelId(DERIVATION_MODEL.SYNTHESIS),
  };

  const profile = await loadProfile(data.notebookId);
  const model = await kimi(DERIVATION_MODEL.SYNTHESIS);
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

  const lang = await currentLang();
  const messages: ModelMessage[] = [{ role: "system", content: system }];
  if (data.task === "ask") {
    // The conversation (SPEC.md §7): the turns so far go in as messages, the
    // reader's with the images they carried, then this message with the
    // rules. A turn with no text is skipped: a stopped answer left nothing.
    const history = (data.history ?? [])
      .filter((turn) => turn.role === "user" || turn.content.trim() !== "")
      .slice(-MAX_HISTORY_TURNS);
    // The newest MAX_IMAGES_PER_CONVERSATION images across the conversation
    // reach the model; older ones are named in their turn instead. Only the
    // reader's own stored images attach.
    const wantedIds: string[] = [];
    for (const turn of history) for (const img of turn.images ?? []) wantedIds.push(img.id);
    for (const img of images) wantedIds.push(img.id);
    const shownIds = new Set(wantedIds.slice(-MAX_IMAGES_PER_CONVERSATION));
    const stored =
      shownIds.size > 0
        ? await db.imageAsset.findMany({
            where: { id: { in: [...shownIds] }, userId: user.id },
            select: { id: true, mimeType: true, data: true },
          })
        : [];
    const bytesById = new Map(stored.map((img) => [img.id, img]));
    const imageParts = (ids: { id: string }[]) =>
      ids.flatMap((img) => {
        const found = bytesById.get(img.id);
        return found
          ? [{ type: "file" as const, data: new Uint8Array(found.data), mediaType: found.mimeType }]
          : [];
      });
    for (const turn of history) {
      if (turn.role === "assistant") {
        messages.push({ role: "assistant", content: turn.content });
        continue;
      }
      const parts = imageParts(turn.images ?? []);
      const text = synthesisHistoryTurn({
        content: turn.content,
        files: turn.files,
        images: (turn.images ?? []).map((img) => ({ name: img.name, shown: bytesById.has(img.id) })),
      });
      messages.push({
        role: "user",
        content: parts.length > 0 ? [{ type: "text", text }, ...parts] : text,
      });
    }
    const parts = imageParts(images);
    const text = synthesisAskPrompt({
      profile,
      lang,
      scopeLabel,
      question,
      web: data.web,
      continued: history.length > 0,
      files,
      imageCount: parts.length,
    });
    messages.push({
      role: "user",
      content: parts.length > 0 ? [{ type: "text", text }, ...parts] : text,
    });
  } else {
    messages.push({
      role: "user",
      content: synthesisTaskPrompt({ profile, lang, task: data.task }),
    });
  }

  if (data.task === "ask") {
    // Web access (SPEC.md §7): the model calls Moonshot's web-search tool
    // (lib/kimi.ts), reads the result, and answers with the pages it used as
    // links; the answer streams as before.
    const web = data.web === true;
    const turns = messages.length - 2;
    let searches = 0;
    const result = streamText({
      model,
      maxOutputTokens,
      providerOptions: kimiOptions(DERIVATION_EFFORT.SYNTHESIS),
      allowSystemInMessages: true,
      messages,
      ...(web
        ? {
            tools: { [WEB_SEARCH_TOOL]: webSearchTool },
            stopWhen: isStepCount(WEB_SEARCH_MAX_USES + 1),
          }
        : {}),
      // Stop aborts here too (SPEC.md §6): the client disconnecting stops the
      // model call, not just the response the client would have read.
      abortSignal: req.signal,
      onEnd: ({ usage }) => {
        console.log(
          `[assistant] ask scope=${data.scope} web=${web} turns=${turns} images=${images.length} files=${files.length} searches=${searches} chars=${system.length} cacheRead=${usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
            `cacheWrite=${usage.inputTokenDetails.cacheWriteTokens ?? 0} output=${usage.outputTokens ?? 0}`,
        );
        const tokens = sdkTokens(usage);
        recordUsage(usageMeta, tokens, computeCostUsd(usageMeta.model, tokens) + searches * WEB_SEARCH_USD);
      },
    });
    // A model failure must reach the reader: the stream ends with
    // STREAM_ERROR_TOKEN + the reason, never a silent empty 200
    // (lib/derive/text-stream.ts, the derive route's pattern: heartbeat spaces
    // while the model reasons or searches, the real reason on failure).
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        // A closed stream takes nothing more: the heartbeat runs on a timer,
        // and a throw there would take the process down.
        const send = (chunk: string) => {
          if (cancelled) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cancelled = true;
          }
        };
        try {
          await streamTextTo(result, send, {
            t,
            onPart: (part) => {
              if (part.type === "tool-call" && part.toolName === WEB_SEARCH_TOOL) searches++;
            },
          });
        } catch (err) {
          // Stopped by the reader: nobody is listening.
          if (req.signal.aborted) return;
          console.error("[assistant] stream error:", err);
          send(`${STREAM_ERROR_TOKEN}${t("api.assistantFailed", { reason: modelErrorMessage(err) })}`);
        } finally {
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const result = await callForJson({
    model,
    messages,
    maxOutputTokens,
    providerOptions: kimiOptions(DERIVATION_EFFORT.SYNTHESIS),
    schema: issuesSchema,
    label: `assistant:${data.task}`,
    usage: usageMeta,
    abortSignal: req.signal,
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
