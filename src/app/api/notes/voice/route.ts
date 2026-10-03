import type { ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { thinkingSchema } from "@/lib/assistant/thinking";
import { bumpNotebook, sectionAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { MAX_OUTPUT_TOKENS, VOICE_EFFORT } from "@/lib/derive/config";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { documentPrefix, loadProfile, pageNames, sectionSkeleton } from "@/lib/derive/context";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { currentLang, serverT } from "@/lib/i18n/server";
import { ndjsonHeartbeat, ndjsonWriter } from "@/lib/ndjson";
import { notesPlanSchema, writePlannedNotes } from "@/lib/notes/write-planned";
import { voicePrompt } from "@/lib/prompts/voice";
import { geminiConfigured } from "@/lib/video/gemini";
import { transcribe, whisperConfigured } from "@/lib/video/transcribe";

export const maxDuration = 180;

// The voice command (SPEC.md §6): the reader speaks in a section of the
// notes tray; the recording takes the upload transcription ladder (Groq
// Whisper → OpenAI Whisper → Gemini); the transcript is a command over the
// open document and the section's notes; the model (VOICE_MODEL, Claude
// Sonnet 5) answers with the notes the command asks for, each quote a
// verbatim span of one block; every quote resolves against the real block
// text and becomes a source; every note lands PENDING in the section — the
// reader reads it over and accepts it, so nothing enters notes unread. The
// body is the recording's bytes; the query names the section, the open
// document, and the thinking. The response streams the stages as NDJSON,
// then the result. A request body past about 4.5 MB is refused by the host,
// so the client records at a low bitrate and stops at five minutes.
const MAX_BYTES = 4 * 1024 * 1024;
// Segments further apart than this start a new paragraph of the command.
const PARAGRAPH_GAP_SECONDS = 2;

const querySchema = z.object({
  sectionId: z.string().min(1),
  documentId: z.string().min(1).optional(),
  thinking: thinkingSchema.optional(),
});

const planSchema = notesPlanSchema;

export type VoiceStage = "transcribe" | "plan" | "write";
export type VoiceEvent = { stage: VoiceStage } | { notes: number; warnings: string[] } | { error: string };

export async function POST(req: Request) {
  const t = await serverT();
  const query = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  if (!query.success) {
    return NextResponse.json({ error: t("api.validationFailed") }, { status: 400 });
  }
  const { sectionId, documentId, thinking } = query.data;
  const section = await db.section.findUnique({ where: { id: sectionId } });
  if (!section) return NextResponse.json({ error: t("api.sectionNotFound") }, { status: 404 });
  const access = await sectionAccess(sectionId, "editor");
  if (access instanceof NextResponse) return access;
  if (!whisperConfigured() && !geminiConfigured()) {
    return NextResponse.json({ error: t("api.voiceNoteNeedsKey") }, { status: 503 });
  }
  if (!(await featureConfigured("voice"))) {
    return NextResponse.json({ error: t("api.voiceCommandNeedsKey") }, { status: 503 });
  }

  const mimeType = (req.headers.get("content-type") ?? "audio/webm").split(";")[0].trim();
  if (!mimeType.startsWith("audio/") && !mimeType.startsWith("video/")) {
    return NextResponse.json({ error: t("api.voiceNoteNotAudio") }, { status: 400 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: t("api.voiceNoteEmpty") }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: t("api.voiceNoteTooLarge") }, { status: 413 });
  }

  // The open document, when it is one of the project's: the command quotes
  // it. On the notes full page none is open and nothing is quoted.
  const document = documentId
    ? await db.document.findFirst({
        where: { id: documentId, notebooks: { some: { notebookId: section.notebookId } } },
        include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, cell: true, page: true } } },
      })
    : null;

  // The status commits to 200 when the stream opens; a failure from here on
  // is the terminal {error} line, the tradeoff every progress stream makes
  // (lib/ingest-response.ts).
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ndjsonWriter(controller);
      const stopHeartbeat = ndjsonHeartbeat(controller);
      try {
        send({ stage: "transcribe" } satisfies VoiceEvent);
        const command = await transcribeCommand(bytes, mimeType, access.user.id);
        if (!command) throw new Error(t("api.voiceNoteNoSpeech"));

        send({ stage: "plan" } satisfies VoiceEvent);
        const [profile, sections, sectionNotes, notes, lang] = await Promise.all([
          loadProfile(section.notebookId),
          sectionSkeleton(section.notebookId),
          db.note.findMany({
            where: { sectionId, status: "ACCEPTED" },
            orderBy: { order: "asc" },
            take: 40,
            select: { id: true, content: true },
          }),
          db.note.findMany({
            where: { section: { notebookId: section.notebookId, hidden: false }, status: "ACCEPTED" },
            orderBy: { createdAt: "asc" },
            take: 80,
            select: { content: true, section: { select: { title: true } } },
          }),
          currentLang(),
        ]);
        const userPrompt = voicePrompt({
          profile,
          lang,
          hasDocument: document !== null,
          sections,
          section: { id: section.id, title: section.title },
          sectionNotes,
          notes: notes.map((n) => ({ sectionTitle: n.section.title, content: n.content })),
          command,
        });
        // The document is the cached system prefix: a second command on the
        // same document reads it from the cache.
        const messages: ModelMessage[] = [
          ...(document
            ? [
                {
                  role: "system" as const,
                  content: documentPrefix(document.title, document.blocks, document.references, pageNames(document)),
                  providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
                },
              ]
            : []),
          { role: "user", content: userPrompt },
        ];
        const voiceCall = await featureCall("voice", VOICE_EFFORT[thinking ?? "deep"]);
        const result = await callForJson({
          model: voiceCall.model,
          messages,
          maxOutputTokens: MAX_OUTPUT_TOKENS.VOICE,
          providerOptions: voiceCall.providerOptions,
          schema: planSchema,
          label: "VOICE",
          usage: { userId: access.user.id, feature: "voice", model: voiceCall.modelId },
          abortSignal: req.signal,
        });
        if (!result.ok) throw new Error(t("api.voiceCommandPlanFailed", { reason: result.error }));

        send({ stage: "write" } satisfies VoiceEvent);
        const writtenIds = await writePlannedNotes(result.data, {
          section,
          document,
          sections,
          userId: access.user.id,
          derivationType: "VOICE",
          t,
        });
        const written = writtenIds.length;
        const warnings = result.data.warnings ?? [];
        if (written === 0) {
          throw new Error(t("api.voiceCommandNoNotes", { reason: warnings[0] ?? "" }).trim());
        }
        await bumpNotebook(section.notebookId);
        console.log(`[voice] ${bytes.length} bytes → ${command.length} chars → ${written} notes`);
        send({ notes: written, warnings } satisfies VoiceEvent);
      } catch (err) {
        console.error("[voice] failed:", err);
        send({ error: t("api.voiceNoteFailed", { reason: modelErrorMessage(err) }) } satisfies VoiceEvent);
      } finally {
        stopHeartbeat();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

// The transcript as the command's text: the segments' words, a paragraph
// break at a pause. The model reads the speech as it was said; the tidy pass
// a transcript gets is not needed for a command.
async function transcribeCommand(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string,
  userId: string,
): Promise<string> {
  const { segments } = await transcribe(
    { kind: "upload", bytes, mimeType },
    { deadline: Date.now() + 100_000, userId },
  );
  const paragraphs: string[] = [];
  let open = "";
  let lastEnd = -Infinity;
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    if (open && segment.start - lastEnd > PARAGRAPH_GAP_SECONDS) {
      paragraphs.push(open);
      open = "";
    }
    open = open ? `${open} ${text}` : text;
    lastEnd = segment.end;
  }
  if (open) paragraphs.push(open);
  return paragraphs.join("\n\n").trim();
}
