import { isStepCount, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { thinkingSchema } from "@/lib/assistant/thinking";
import { noteAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { NOTE_ASSISTANT_EFFORT, NOTE_ASSISTANT_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { documentPrefix, loadProfile, pageNames } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { groundingOf, ungrounded } from "@/lib/docs/grounding";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { currentLang, serverT } from "@/lib/i18n/server";
import { WEB_SEARCH_MAX_USES, WEB_SEARCH_TOOL, webSearchTool, webSearchUsd } from "@/lib/kimi";
import { checkNoteQuotes } from "@/lib/notes/assistant-check";
import { noteAssistantPrompt } from "@/lib/prompts/note-assistant";
import { parseBody } from "@/lib/validate";

export const maxDuration = 180;

// The note's assistant (SPEC.md §6): the panel docked at the bottom of an
// open note. A message about the note is answered by one model call that
// reads the note as the editor holds it, its sources, the document it
// belongs to whole, and the reader's other notes, with the web when the
// Web toggle is on. The answer is the reply and, when the message asks for a
// change, the note as it should read. The route changes nothing: the panel
// shows the change, and Apply puts it into the editor's draft, which saves
// as any edit does and which Cancel takes back.
const MAX_HISTORY = 20;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(8000),
  // The note as the open editor holds it: the reader may have typed since
  // the last save.
  draft: z.string().max(50_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(60_000) }))
    .max(60)
    .default([]),
  // The document open in the reader, when it is the project's: the note's
  // own document wins.
  documentId: z.string().min(1).optional(),
  thinking: thinkingSchema.optional(),
  web: z.boolean().optional(),
});

const answerSchema = z.object({
  reply: z.string().max(60_000),
  content: z.string().max(50_000).nullable().optional(),
});

export type NoteAssistantAnswer = {
  reply: string;
  // The note as it should read; null when the message asked no change.
  content: string | null;
  // What the checks took out of the change, or found in it.
  warnings: string[];
};

export async function POST(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const t = await serverT();
  const { noteId } = await ctx.params;
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  const access = await noteAccess(noteId, "editor");
  if (access instanceof NextResponse) return access;
  if (!(await featureConfigured("note-assistant"))) {
    return NextResponse.json({ error: t("api.noteAssistantNeedsKey") }, { status: 503 });
  }

  const note = await db.note.findUnique({
    where: { id: noteId },
    include: {
      section: { select: { notebookId: true, title: true, hidden: true } },
      sources: { select: { quotedText: true, documentId: true, document: { select: { title: true } } } },
    },
  });
  if (!note) return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
  const notebookId = note.section.notebookId;

  // The document the note is about: its own, else its first source's, else
  // the one open in the reader — when it is attached to this project.
  const candidate = note.documentId ?? note.sources.find((s) => s.documentId)?.documentId ?? data.documentId ?? null;
  const document = candidate
    ? await db.document.findFirst({
        where: { id: candidate, notebooks: { some: { notebookId } } },
        include: {
          blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, cell: true, page: true } },
        },
      })
    : null;

  const [profile, others, lang] = await Promise.all([
    loadProfile(notebookId),
    db.note.findMany({
      where: { id: { not: noteId }, section: { notebookId, hidden: false }, status: "ACCEPTED" },
      orderBy: { createdAt: "asc" },
      take: 400,
      select: { content: true, section: { select: { title: true } } },
    }),
    currentLang(),
  ]);

  const history = data.history.slice(-MAX_HISTORY).filter((turn) => turn.content.trim());
  // With the web on, the web feature's model answers, with its provider's
  // search (SPEC.md §7); else the note's assistant's own.
  const web = data.web ?? true;
  const call = await featureCall(web ? "web" : "note-assistant", NOTE_ASSISTANT_EFFORT[data.thinking ?? "deep"]);
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
    ...history.map((turn) => ({ role: turn.role, content: turn.content }) as ModelMessage),
    {
      role: "user",
      content: noteAssistantPrompt({
        profile,
        lang,
        note: data.draft,
        section: note.section.title,
        sources: note.sources.map((s) => ({
          documentTitle: s.document?.title ?? "",
          quotedText: s.quotedText.slice(0, 600),
        })),
        documentTitle: document?.title ?? null,
        otherNotes: others.map((n) => ({ sectionTitle: n.section.title, content: n.content })),
        message: data.message,
        continued: history.length > 0,
        web,
      }),
    },
  ];
  const result = await callForJson({
    model: call.model,
    messages,
    maxOutputTokens: NOTE_ASSISTANT_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: answerSchema,
    label: "note-assistant",
    usage: { userId: access.user.id, feature: "note-assistant", model: call.modelId },
    abortSignal: req.signal,
    ...(web
      ? {
          tools: { [WEB_SEARCH_TOOL]: webSearchTool(call.modelId) },
          stopWhen: isStepCount(WEB_SEARCH_MAX_USES + 1),
          toolCallUsd: webSearchUsd(call.modelId),
        }
      : {}),
  });
  if (!result.ok) {
    return NextResponse.json({ error: t("api.noteAssistantFailed", { reason: result.error }) }, { status: 422 });
  }

  // The checks (SPEC.md §6): a quote line of the change must be words the
  // note, its sources, or the document already hold — one that is not is
  // taken out, named in a warning. A number or a quotation in the change
  // that nothing the model read holds is named too (the plan's grounding,
  // lib/docs/grounding.ts); with the web on, the pages it read are not kept,
  // so numbers go unchecked.
  const warnings: string[] = [];
  let content = result.data.content?.trim() || null;
  if (content !== null && content === data.draft.trim()) content = null;
  if (content !== null) {
    const material = [
      data.draft,
      ...note.sources.map((s) => s.quotedText),
      ...(document?.blocks.map((b) => b.text) ?? []),
    ];
    const quotes = checkNoteQuotes(content, material);
    content = quotes.content;
    for (const quote of quotes.removed) warnings.push(t("api.noteAssistantQuoteRemoved", { quote }));
    if (!web) {
      const grounding = groundingOf([
        ...material,
        data.message,
        ...history.map((turn) => turn.content),
        ...others.map((n) => n.content),
      ]);
      const fact = ungrounded(content, grounding);
      if (fact) warnings.push(t("api.noteAssistantUngrounded", { fact }));
    }
  }
  return NextResponse.json({ reply: result.data.reply.trim(), content, warnings } satisfies NoteAssistantAnswer);
}
