import { isStepCount, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { thinkingEffort, thinkingSchema } from "@/lib/assistant/thinking";
import { coreBlocks, layerSchema } from "@/lib/anchors/layer";
import { passageSources, resolvePassage, segmentsSchema } from "@/lib/anchors/passage";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import {
  type ChatTurn,
  parseStoredConversation,
  renderTranscript,
  TOOL_NAME,
  TOOL_OUTPUT_NAME,
  type ToolKind,
  toolKindOf,
} from "@/lib/conversation";
import { stripSimplifyMarkers } from "@/lib/sentences";
import { db } from "@/lib/db";
import { MAX_OUTPUT_TOKENS, SUGGEST_MAX_NEW_CHARS } from "@/lib/derive/config";
import { runSuggest, suggestDocument } from "@/lib/derive/suggest";
import { svgChartCall } from "@/lib/derive/svg-chart";
import type { SuggestResult } from "@/lib/docs/assistant-suggestions";
import { importShared } from "@/lib/docs/server";
import { scopeOf, takesSuggestions, windowsOf, wordsScope, type SuggestScope } from "@/lib/docs/suggest-ops";
import { keepVersionBeforeSuggestions } from "@/lib/docs/versions";
import {
  annotationsSection,
  documentPrefix,
  loadProfile,
  passageContext,
  sectionSkeleton,
} from "@/lib/derive/context";
import { figureContent, figureVisual, type FigureImage } from "@/lib/derive/figure";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { currentLang, serverT } from "@/lib/i18n/server";
import { WEB_SEARCH_MAX_USES, WEB_SEARCH_TOOL, webSearchTool, webSearchUsd } from "@/lib/kimi";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { actionsSchema, enrichActions, type RawAction } from "@/lib/assistant/plan";
import { actPrompt, textSelectionBlock } from "@/lib/prompts/act";
import { SUGGEST_COMMANDS, type SuggestCommand } from "@/lib/prompts/suggest";
import { parseBody } from "@/lib/validate";
import { ultraActive } from "@/lib/tiers";
import { formatTimeRange, regionSchema } from "@/lib/video/types";
import type { AssistantAction, AssistantPlan } from "@/lib/types";
import { featureCall, featureConfigured } from "@/lib/feature-models";

export const maxDuration = 180;

// The assistant as an actor: a command (typed or spoken) becomes a plan of
// actions over the app's own tools. The plan is returned, never executed here —
// the client executes through the normal API routes after user approval (or
// immediately when the user has toggled auto).
const requestSchema = z.object({
  notebookId: z.string().min(1),
  documentId: z.string().min(1),
  command: z.string().min(1).max(4000),
  anchor: z
    .object({
      blockId: z.string().min(1),
      startOffset: z.number().int().min(0),
      endOffset: z.number().int().min(0),
      // The quote selectors (SPEC.md §5): when the block id or the offsets no
      // longer match — a re-parse gave the blocks new ids, an edit moved the
      // words — the quote re-finds the selection in the document.
      quotedText: z.string().max(10_000).optional(),
      prefix: z.string().max(64).optional(),
      suffix: z.string().max(64).optional(),
      // "core": the words are a block's core in the collapsed view (SPEC.md §28).
      layer: layerSchema,
    })
    .optional(),
  // A selection over several blocks (lib/anchors/passage.ts): one anchor per
  // block, the first being `anchor`; every segment becomes a source of the
  // conversation note.
  segments: segmentsSchema,
  // A circled spot of a video document (SPEC.md §11): the time range, the
  // drawn region, and the paused frame as a JPEG data URL when the client
  // could capture it — the same shape EXPLAIN takes.
  video: z
    .object({
      startTime: z.number().min(0),
      endTime: z.number().min(0),
      region: regionSchema.optional(),
      frame: z
        .string()
        .startsWith("data:image/jpeg;base64,")
        .max(2_000_000)
        .optional(),
    })
    .optional(),
  // How hard the model thinks about this command (SPEC.md §7): Fast Thinking
  // or Deep Thinking. Absent = Deep, the effort every answer used before the
  // choice existed.
  thinking: thinkingSchema.optional(),
  // The reader's Web toggle (SPEC.md §7): the model can search the web.
  web: z.boolean().optional(),
  // The assistant chat sends the turns so far; the command continues them.
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .optional(),
  // The persisted conversation note; later turns update it in place.
  conversationNoteId: z.string().optional(),
  // A side chat (SPEC.md §7): the conversation it was started from, and the
  // words it was started on. Its turns persist on a conversation note of its
  // own — no sources, so the side chat marks nothing in the article — and it
  // opens from its own chat box alone, never from assistant history.
  sideChatOf: z.string().min(1).optional(),
  sideChatQuote: z.string().min(1).max(2000).optional(),
  // A tool conversation (SPEC.md §21): the reader continues from an AI tool's
  // output — Explain+, Simplify+, Analyze+, Visualize+. The note is the
  // tool's annotation; the selection is its sources; the turns persist on
  // Note.conversation, never as a conversation note of their own.
  toolNoteId: z.string().optional(),
  // A command chip on selected words (SPEC.md §29): the assistant's
  // suggestions run with the chip's command and no chat model; `command` is
  // the chip's label, stored as the reader's message.
  suggestCommand: z.enum(Object.keys(SUGGEST_COMMANDS) as [SuggestCommand, ...SuggestCommand[]]).optional(),
});

// The matches (SPEC.md §7): the passages across the document that deal
// with the selection's topic, found before the reply is written so the reply
// answers from them and cites them. They are the model's working: the reply
// carries no list of them.
const matchSchema = z.object({
  blockId: z.string().min(1),
  quote: z.string().min(1).max(600),
  why: z.string().min(1).max(300),
});

const planSchema = z.object({
  reply: z.string().max(8000).nullable(),
  actions: actionsSchema,
  matches: z.array(matchSchema).max(12).optional(),
});

// Any unexpected throw still answers with the reason, never a bare 500 —
// the client toast shows this message.
export async function POST(req: Request) {
  const t = await serverT();
  try {
    return await handle(req, t);
  } catch (err) {
    console.error("[assistant:act] failed:", err);
    return NextResponse.json(
      { error: t("api.assistantFailed", { reason: modelErrorMessage(err) }) },
      { status: 500 },
    );
  }
}

async function handle(req: Request, t: TFunc) {
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const chip = data.suggestCommand;
  if (!(await featureConfigured(chip ? "suggest" : "act"))) {
    return NextResponse.json({ error: t(chip ? "api.suggestNeedsKey" : "api.assistantNeedsKey") }, { status: 503 });
  }
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const user = access.user;
  // Continuing an AI tool's output into a conversation (SPEC.md §21) is
  // Unitos Ultra (TIERS.md): the toolbar offers it to every account, and a
  // non-Ultra turn answers with the plain Ultra message, like VISUALIZE.
  if (data.toolNoteId && !ultraActive(user)) {
    return NextResponse.json({ error: t("api.continueNeedsUltra") }, { status: 403 });
  }

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  }
  const document = await db.document.findUnique({
    where: { id: data.documentId },
    include: {
      blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, startTime: true, endTime: true } },
    },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });

  const [profile, sections, attachedDocs, notes] = await Promise.all([
    loadProfile(data.notebookId),
    sectionSkeleton(data.notebookId),
    db.notebookDocument.findMany({
      where: { notebookId: data.notebookId },
      include: { document: { select: { id: true, title: true } } },
    }),
    // Full notebook context: the accepted notes, so commands can reference the
    // reader's own thinking, not just this document.
    db.note.findMany({
      where: { section: { notebookId: data.notebookId }, status: "ACCEPTED" },
      orderBy: { createdAt: "asc" },
      take: 80,
      include: { section: { select: { title: true, hidden: true } } },
    }),
  ]);

  // A tool conversation continues from the tool's stored annotation: its
  // sources are the selection, its content the output the turns build on.
  let toolNote: {
    id: string;
    kind: ToolKind;
    content: string;
    turns: ChatTurn[];
    sources: { blockId: string; startOffset: number; endOffset: number; quotedText: string; prefix: string; suffix: string; layer: string | null }[];
  } | null = null;
  if (data.toolNoteId) {
    const note = await db.note.findUnique({
      where: { id: data.toolNoteId },
      select: {
        id: true,
        content: true,
        derivationType: true,
        conversation: true,
        section: { select: { notebookId: true } },
        sources: {
          where: { documentId: data.documentId },
          select: { blockId: true, startOffset: true, endOffset: true, quotedText: true, prefix: true, suffix: true, layer: true },
        },
      },
    });
    const kind = note ? toolKindOf(note.derivationType) : null;
    if (!note || !kind || note.section.notebookId !== data.notebookId || note.sources.length === 0) {
      return NextResponse.json({ error: t("api.noteNotFound") }, { status: 404 });
    }
    toolNote = {
      id: note.id,
      kind,
      content: note.content,
      turns: parseStoredConversation(note.conversation),
      sources: note.sources,
    };
  }

  // A selection on a FIGURE block carries the figure itself: image bytes when
  // they can be produced (fetched, decoded, or the PDF page rendered), SVG
  // source for charts — same treatment as EXPLAIN (SPEC.md §4: one pipeline).
  let selectionBlock = "";
  let attachedImage: FigureImage | null = null;
  let svgSource: string | null = null;
  // The anchor resolves through the ladder (SPEC.md §5): block id and offsets,
  // then the quote inside the block, then the quote across the document. A
  // re-parse gives every block a new id while an open reader still sends the
  // old ones; the quote carries the selection across.
  const anchorInput = toolNote ? toolNote.sources[0] : data.anchor;
  const segmentsInput = toolNote ? toolNote.sources : data.segments;
  // A core anchor (SPEC.md §28) resolves against the cores, its context the
  // cores around it.
  const layer = (toolNote ? toolNote.sources[0]?.layer : data.anchor?.layer) === "core" ? ("core" as const) : null;
  const anchorBlocks = layer === "core" ? coreBlocks(document.collapse, document.blocks) : document.blocks;
  const passage = anchorInput ? resolvePassage(anchorBlocks, anchorInput, segmentsInput) : [];
  const anchor = passage[0] ?? null;
  const anchored = anchor ? passageContext(anchorBlocks, passage) : null;
  if (anchorInput && (!anchor || !anchored)) {
    return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
  }
  // The assistant's suggestions (SPEC.md §29) change a document with rich
  // text; a chip changes the selected words. An import another account's
  // project holds takes no edits.
  const shared = takesSuggestions(document) && (await importShared(document.id));
  const richText = takesSuggestions(document) && !shared;
  if (chip && shared) return NextResponse.json({ error: t("api.importShared") }, { status: 403 });
  if (chip && !richText) return NextResponse.json({ error: t("api.suggestNeedsRichText") }, { status: 400 });
  if (chip && passage.length === 0) return NextResponse.json({ error: t("api.anchorMissing") }, { status: 400 });
  if (anchor && anchored && layer === "core") {
    selectionBlock = textSelectionBlock(anchor.blockId, anchored.anchoredText, true);
  } else if (anchor && anchored) {
    const anchoredBlock = await db.block.findUnique({
      where: { id: anchor.blockId },
      select: { type: true, html: true, text: true, page: true, region: true },
    });
    const figure = figureContent(anchoredBlock);
    if (figure && anchoredBlock) {
      const visual = await figureVisual(figure, anchoredBlock, document.id, document.sourceUrl);
      attachedImage = visual?.image ?? null;
      svgSource = figure.svgSource ?? null;
      selectionBlock = [
        `The reader has selected the figure in block ${anchor.blockId}. Its caption: "${figure.caption.slice(0, 500) || "(no caption)"}".`,
        ...(visual
          ? [
              visual.page
                ? "The PDF page the figure sits on is attached. Find the figure on it by its caption; read only that figure."
                : "The figure's image is attached.",
            ]
          : []),
        ...(figure.svgSource ? ["The figure is this SVG chart:", figure.svgSource] : []),
        ...(figure.kind === "video"
          ? ["The figure is a video you cannot watch. Work from the caption and the document."]
          : []),
        "The command applies to this figure unless it says otherwise.",
      ].join("\n");
    } else {
      selectionBlock = textSelectionBlock(anchor.blockId, anchored.anchoredText);
    }
  } else if (data.video) {
    // A circled spot of a video document: the frame is attached when the
    // client could capture it; the transcript for the range grounds the words.
    if (data.video.frame) {
      const bytes = new Uint8Array(
        Buffer.from(data.video.frame.slice("data:image/jpeg;base64,".length), "base64"),
      );
      if (bytes.length > 0) attachedImage = { bytes, mediaType: "image/jpeg" };
    }
    const excerpt = document.blocks
      .filter(
        (b) =>
          b.type === "TRANSCRIPT" &&
          b.startTime !== null &&
          b.endTime !== null &&
          b.startTime < data.video!.endTime &&
          b.endTime > data.video!.startTime,
      )
      .map((b) => b.text)
      .join(" ");
    selectionBlock = [
      `The reader has circled a spot of the video at ${formatTimeRange(data.video.startTime, data.video.endTime)}.`,
      ...(attachedImage
        ? [
            data.video.region
              ? "The attached image IS the video frame at this moment, cropped to the shape they drew."
              : "The attached image IS the video frame at this moment.",
          ]
        : ["No frame could be captured; work from the transcript and the document."]),
      ...(excerpt
        ? [`The transcript over this range: "${excerpt.length > 1500 ? `${excerpt.slice(0, 1499)}…` : excerpt}"`]
        : []),
      "The command applies to this spot unless it says otherwise.",
    ].join("\n");
  }

  const otherDocs = attachedDocs
    .map((nd) => nd.document)
    .filter((d) => d.id !== data.documentId);

  // The tool's output, for a tool conversation: the turns go deeper on it.
  const toolBlock = toolNote
    ? [
        `The reader ran ${TOOL_NAME[toolNote.kind]} on this selection. The ${TOOL_OUTPUT_NAME[toolNote.kind]} it got:`,
        toolNote.kind === "simplify" ? stripSimplifyMarkers(toolNote.content) : toolNote.content,
        "",
        `The reader's messages continue from this ${TOOL_OUTPUT_NAME[toolNote.kind]}: they want to expand it, go deeper, and understand the selection better. Answer from the ${TOOL_OUTPUT_NAME[toolNote.kind]}, the selection, and the document. Keep the ${TOOL_OUTPUT_NAME[toolNote.kind]}'s terms. Never repeat what it already says; add to it.`,
      ].join("\n")
    : "";
  // A tool conversation continues its stored turns; an assistant conversation
  // the turns the client sends. The prompt reads the last 20.
  const priorTurns: ChatTurn[] = toolNote ? toolNote.turns : (data.history ?? []);
  const history = priorTurns.slice(-20);

  // Web access (SPEC.md §7): the same tool and rules as the sidebar's. A
  // frame or an SVG chart goes to the model that reads it, without the web.
  const svgChart = svgSource ? await svgChartCall() : null;
  const web = data.web === true && !attachedImage && !svgChart;
  const lang = await currentLang();
  const userPrompt = actPrompt({
    profile,
    lang,
    selectionBlock,
    toolBlock,
    web,
    hasSelection: Boolean(anchored),
    sections,
    otherDocuments: otherDocs,
    notes: notes
      .filter((n) => !n.section.hidden)
      .map((n) => ({ sectionTitle: n.section.title, content: n.content })),
    history,
    command: data.command,
    richText,
  });

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks, document.references),
    },
    attachedImage
      ? {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "file", data: attachedImage.bytes, mediaType: attachedImage.mediaType },
          ],
        }
      : { role: "user", content: userPrompt },
  ];

  // A video frame goes to the model that reads images (SPEC.md §2); an SVG
  // chart to Claude Opus 5.5, which reads the source whole (lib/derive/svg-chart.ts);
  // a turn with the web on to WEB_SEARCH_MODEL, with its provider's search.
  const chatCall = await featureCall(web ? "web" : attachedImage ? "vision" : "act", thinkingEffort(data.thinking));
  const chat = svgChart ?? chatCall;
  // A chip asks the chat model nothing: its command is fixed.
  const result = chip
    ? { ok: true as const, data: { reply: null, actions: [] as RawAction[] } }
    : await callForJson({
        model: chat.model,
        messages,
        maxOutputTokens: MAX_OUTPUT_TOKENS.SYNTHESIS,
        providerOptions: chat.providerOptions,
        schema: planSchema,
        label: "assistant:act",
        usage: { userId: user.id, feature: "act", model: chat.modelId },
        // Stop aborts here too (SPEC.md §6): the client disconnecting stops the
        // model call, not just the response the client would have read.
        abortSignal: req.signal,
        ...(web
          ? {
              tools: { [WEB_SEARCH_TOOL]: webSearchTool(chatCall.modelId) },
              stopWhen: isStepCount(WEB_SEARCH_MAX_USES + 1),
              toolCallUsd: webSearchUsd(chatCall.modelId),
            }
          : {}),
      });
  if (!result.ok) {
    return NextResponse.json({ error: t("api.planFailed", { reason: result.error }) }, { status: 422 });
  }

  // Validate and enrich every action against the real document
  // (lib/assistant/plan.ts): the sidebar assistant's plan takes the same path.
  const { actions, warnings } = enrichActions(result.data.actions, {
    documentId: data.documentId,
    richText,
    blocks: document.blocks,
    attachedIds: new Set(attachedDocs.map((nd) => nd.documentId)),
    sectionIds: new Set(sections.map((s) => s.id)),
    t,
  });

  // The assistant's suggestions (SPEC.md §29): a chip, or the plan's suggest
  // action, runs here once and the page lands its ops; the other actions
  // wait for the plan card. The scope is the selected words; named blocks,
  // or the whole document with no selection, take their first window here.
  const suggest = actions.find((a): a is Extract<AssistantAction, { type: "suggest" }> => a.type === "suggest");
  let suggestions: SuggestResult | undefined;
  if (suggest && !(await featureConfigured("suggest"))) warnings.push(t("api.suggestNeedsKey"));
  else if (chip || suggest) {
    const doc = suggestDocument(document);
    let scope: SuggestScope;
    let window: { n: number; of: number; whole: boolean } | null = null;
    const cut: string[] = [];
    if (!suggest?.blockIds && passage.length > 0) scope = wordsScope(document.blocks, passage);
    else {
      const whole = !suggest?.blockIds;
      const windows = windowsOf(doc.rows, doc.places, whole ? doc.rows.map((r) => r.id) : scopeOf(doc.rows, doc.places, suggest!.blockIds!));
      if (whole || windows.length > 1) await keepVersionBeforeSuggestions(document.id, t("api.suggestVersionName"));
      if (windows.length > 1) cut.push(t("api.suggestTooLong"));
      scope = { kind: "blocks", blockIds: windows[0] ?? [] };
      window = { n: 1, of: windows.length, whole };
    }
    try {
      const run = await runSuggest({
        userId: user.id,
        document: doc,
        profile,
        lang,
        t,
        command: chip ? SUGGEST_COMMANDS[chip] : data.command,
        instruction: suggest?.instruction ?? null,
        material: null,
        history,
        scope,
        window,
        caretBlockId: null,
        thinking: data.thinking ?? "deep",
        budget: { chars: SUGGEST_MAX_NEW_CHARS },
        signal: req.signal,
      });
      suggestions = { ...run, warnings: [...run.warnings, ...cut] };
    } catch (err) {
      return NextResponse.json({ error: modelErrorMessage(err) }, { status: 422 });
    }
  }

  // An anchored conversation persists like the tools' output: one note in the
  // hidden Annotations section, anchored to the selection, updated per turn.
  // Clicking the mark reopens the conversation; the Annotations tab deletes it.
  let conversationNoteId: string | null = data.conversationNoteId ?? null;
  // With suggestions, the reply shown and stored is their summary.
  const answer =
    result.data.reply ??
    (suggestions
      ? suggestions.summary || t(suggestions.ops.length > 0 ? "api.suggestMade" : "api.suggestNoChange")
      : actions.length > 0
        ? `Applied ${actions.length} action${actions.length === 1 ? "" : "s"}.`
        : "No actions proposed.");
  const replyText = answer;
  const turns: ChatTurn[] = [
    ...priorTurns,
    { role: "user", content: data.command },
    { role: "assistant", content: replyText },
  ];
  if (data.sideChatOf) {
    // A side chat persists like the conversation it came from, on a note that
    // knows its parent. The parent's mark still opens the parent.
    const transcript = renderTranscript(turns);
    if (conversationNoteId) {
      try {
        await db.note.update({ where: { id: conversationNoteId }, data: { content: transcript } });
        await bumpNotebook(data.notebookId);
      } catch {
        conversationNoteId = null; // the note was deleted; a new one starts below
      }
    }
    if (!conversationNoteId) {
      const section = await annotationsSection(data.notebookId);
      const count = await db.note.count({ where: { sectionId: section.id } });
      const note = await db.note.create({
        data: {
          sectionId: section.id,
          content: transcript,
          status: "ACCEPTED",
          derivationType: "SYNTHESIS",
          createdById: user.id,
          order: count,
          sideChatOfId: data.sideChatOf,
          sideChatQuote: data.sideChatQuote ?? "",
        },
      });
      conversationNoteId = note.id;
      await bumpNotebook(data.notebookId);
    }
  } else if (toolNote) {
    // A tool conversation (SPEC.md §21) persists on the tool's own annotation:
    // the turns after the output, the mark gaining its plus. The log is stale
    // by its turn count; the next hover writes it again.
    await db.note.update({
      where: { id: toolNote.id },
      data: { conversation: turns.slice(-60) },
    });
    await bumpNotebook(data.notebookId);
    conversationNoteId = toolNote.id;
  } else if (anchor) {
    const transcript = renderTranscript(turns);
    if (conversationNoteId) {
      try {
        await db.note.update({ where: { id: conversationNoteId }, data: { content: transcript } });
        await bumpNotebook(data.notebookId);
      } catch {
        conversationNoteId = null; // the note was deleted; a new one starts below
      }
    }
    if (!conversationNoteId) {
      const block = document.blocks.find((b) => b.id === anchor.blockId);
      if (block) {
        const section = await annotationsSection(data.notebookId);
        const count = await db.note.count({ where: { sectionId: section.id } });
        const note = await db.note.create({
          data: {
            sectionId: section.id,
            content: transcript,
            status: "ACCEPTED",
            derivationType: "SYNTHESIS",
            createdById: user.id,
            order: count,
            // One source per segment: the marks cover the whole passage.
            sources: { create: passageSources(data.documentId, passage, layer) },
          },
        });
        conversationNoteId = note.id;
        await bumpNotebook(data.notebookId);
      }
    }
  }

  const plan: AssistantPlan = {
    reply: result.data.reply === null && !suggestions ? null : replyText,
    actions: actions.filter((a) => a.type !== "suggest"),
    warnings,
    conversationNoteId,
    suggestions,
  };
  return NextResponse.json(plan);
}
