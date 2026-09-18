import type { ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { matchInText } from "@/lib/anchors/match";
import { thinkingEffort, thinkingSchema } from "@/lib/assistant/thinking";
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
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
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
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { actPrompt, textSelectionBlock } from "@/lib/prompts/act";
import { parseBody } from "@/lib/validate";
import { ultraActive } from "@/lib/tiers";
import { formatTimeRange, regionSchema } from "@/lib/video/types";
import type { AssistantAction, AssistantAnchor, AssistantPlan } from "@/lib/types";
import { resolveModelId } from "@/lib/models";

export const maxDuration = 120;

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
});

const quote = z.string().min(1).max(2000);
const description = z.string().min(1).max(300);

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("edit_block"),
    blockId: z.string().min(1),
    newText: z.string().min(1).max(50_000),
    description,
  }),
  z.object({
    type: z.literal("insert_paragraph"),
    afterBlockId: z.string().min(1),
    text: z.string().min(1).max(50_000),
    description,
  }),
  z.object({ type: z.literal("remove_block"), blockId: z.string().min(1), description }),
  z.object({
    type: z.literal("highlight"),
    blockId: z.string().min(1),
    quote,
    color: z.enum(["clay", "sage", "gold", "plum"]),
    comment: z.string().max(10_000).optional(),
    description,
  }),
  z.object({
    type: z.literal("comment"),
    blockId: z.string().min(1),
    quote,
    comment: z.string().min(1).max(10_000),
    description,
  }),
  z.object({
    type: z.literal("add_note"),
    content: z.string().min(1).max(50_000),
    sectionId: z.string().optional(),
    sectionTitle: z.string().max(200).optional(),
    blockId: z.string().optional(),
    quote: quote.optional(),
    description,
  }),
  z.object({ type: z.literal("add_section"), title: z.string().min(1).max(200), description }),
  z.object({
    type: z.literal("link"),
    blockId: z.string().min(1),
    quote,
    toDocumentId: z.string().min(1),
    description,
  }),
  z.object({
    type: z.literal("format_block"),
    blockId: z.string().min(1),
    kind: z.enum(["paragraph", "h1", "h2", "h3"]),
    description,
  }),
  z.object({
    type: z.literal("style"),
    blockId: z.string().min(1),
    quote,
    style: z.enum(["bold", "italic"]),
    description,
  }),
]);

// The matches (SPEC.md §7): the passages across the document that deal
// with the selection's topic, the work the old Match-it tool did. Each is a
// verbatim quote of one block; the server resolves every quote against the
// real block text before it reaches the reader.
const matchSchema = z.object({
  blockId: z.string().min(1),
  quote: z.string().min(1).max(600),
  why: z.string().min(1).max(300),
});

const planSchema = z.object({
  reply: z.string().max(8000).nullable(),
  actions: z.array(actionSchema).max(20),
  matches: z.array(matchSchema).max(12).optional(),
});

// The most matches a reply lists, and the longest a listed quote gets.
const MATCHES_MAX = 8;
const MATCH_QUOTE_MAX = 220;

const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);

function buildAnchor(blockText: string, quoteText: string, blockId: string) {
  const start = blockText.indexOf(quoteText);
  if (start === -1) return null;
  const end = start + quoteText.length;
  return {
    blockId,
    startOffset: start,
    endOffset: end,
    quotedText: quoteText,
    prefix: blockText.slice(Math.max(0, start - 32), start),
    suffix: blockText.slice(end, end + 32),
  };
}

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
  if (!kimiConfigured()) {
    return NextResponse.json({ error: t("api.assistantNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
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
    sources: { blockId: string; startOffset: number; endOffset: number; quotedText: string; prefix: string; suffix: string }[];
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
          select: { blockId: true, startOffset: true, endOffset: true, quotedText: true, prefix: true, suffix: true },
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
  // The anchor resolves through the ladder (SPEC.md §5): block id and offsets,
  // then the quote inside the block, then the quote across the document. A
  // re-parse gives every block a new id while an open reader still sends the
  // old ones; the quote carries the selection across.
  const anchorInput = toolNote ? toolNote.sources[0] : data.anchor;
  const segmentsInput = toolNote ? toolNote.sources : data.segments;
  const passage = anchorInput ? resolvePassage(document.blocks, anchorInput, segmentsInput) : [];
  const anchor = passage[0] ?? null;
  const anchored = anchor ? passageContext(document.blocks, passage) : null;
  if (anchorInput && (!anchor || !anchored)) {
    return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
  }
  if (anchor && anchored) {
    const anchoredBlock = await db.block.findUnique({
      where: { id: anchor.blockId },
      select: { type: true, html: true, text: true, page: true, region: true },
    });
    const figure = figureContent(anchoredBlock);
    if (figure && anchoredBlock) {
      const visual = await figureVisual(figure, anchoredBlock, document.id, document.sourceUrl);
      attachedImage = visual?.image ?? null;
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

  const userPrompt = actPrompt({
    profile,
    lang: await currentLang(),
    selectionBlock,
    toolBlock,
    hasSelection: Boolean(anchored),
    sections,
    otherDocuments: otherDocs,
    notes: notes
      .filter((n) => !n.section.hidden)
      .map((n) => ({ sectionTitle: n.section.title, content: n.content })),
    history,
    command: data.command,
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

  const result = await callForJson({
    model: await kimi(DERIVATION_MODEL.SYNTHESIS),
    messages,
    maxOutputTokens: MAX_OUTPUT_TOKENS.SYNTHESIS,
    providerOptions: kimiOptions(thinkingEffort(data.thinking)),
    schema: planSchema,
    label: "assistant:act",
    usage: { userId: user.id, feature: "act", model: await resolveModelId(DERIVATION_MODEL.SYNTHESIS) },
    // Stop aborts here too (SPEC.md §6): the client disconnecting stops the
    // model call, not just the response the client would have read.
    abortSignal: req.signal,
  });
  if (!result.ok) {
    return NextResponse.json({ error: t("api.planFailed", { reason: result.error }) }, { status: 422 });
  }

  // Validate and enrich every action against the real document, so the client
  // executes ready-made requests. Invalid actions become warnings, never writes.
  const blockById = new Map(document.blocks.map((b) => [b.id, b]));
  const attachedIds = new Set(attachedDocs.map((nd) => nd.documentId));
  const sectionIds = new Set(sections.map((s) => s.id));
  const actions: AssistantAction[] = [];
  const warnings: string[] = [];

  for (const action of result.data.actions) {
    if (action.type === "add_section") {
      actions.push(action);
      continue;
    }
    if (action.type === "add_note") {
      const sectionId = action.sectionId && sectionIds.has(action.sectionId) ? action.sectionId : undefined;
      let source: (AssistantAnchor & { documentId: string }) | undefined;
      if (action.blockId && action.quote) {
        const block = blockById.get(action.blockId);
        const anchor = block ? buildAnchor(block.text, action.quote, block.id) : null;
        if (anchor) source = { documentId: data.documentId, ...anchor };
        else warnings.push(t("api.warnSourceQuoteNotFound", { description: action.description }));
      }
      actions.push({
        type: "add_note",
        content: action.content,
        sectionId,
        sectionTitle: sectionId ? undefined : (action.sectionTitle ?? "Notes"),
        source,
        description: action.description,
      });
      continue;
    }
    if (action.type === "format_block") {
      const target = blockById.get(action.blockId);
      if (!target || !TEXT_TYPES.has(target.type)) {
        warnings.push(t("api.warnBlockNotFoundOrNotText", { description: action.description }));
        continue;
      }
      actions.push(action);
      continue;
    }
    if (action.type === "style") {
      const target = blockById.get(action.blockId);
      const anchor = target ? buildAnchor(target.text, action.quote, target.id) : null;
      if (!anchor) {
        warnings.push(t("api.warnQuoteNotFound", { description: action.description }));
        continue;
      }
      actions.push({ type: "style", anchor, style: action.style, description: action.description });
      continue;
    }
    const block = blockById.get(
      action.type === "insert_paragraph" ? action.afterBlockId : action.blockId,
    );
    if (!block) {
      warnings.push(t("api.warnBlockNotFound", { description: action.description }));
      continue;
    }
    if (
      (action.type === "edit_block" || action.type === "remove_block") &&
      !TEXT_TYPES.has(block.type)
    ) {
      warnings.push(t("api.warnOnlyTextEdited", { description: action.description }));
      continue;
    }
    if (action.type === "edit_block" || action.type === "remove_block" || action.type === "insert_paragraph") {
      actions.push(action);
      continue;
    }
    // highlight / comment / link carry exact quotes: resolve to offsets now.
    const anchor = buildAnchor(block.text, action.quote, block.id);
    if (!anchor) {
      warnings.push(t("api.warnQuoteNotFound", { description: action.description }));
      continue;
    }
    if (action.type === "highlight") {
      actions.push({ type: "highlight", anchor, color: action.color, comment: action.comment, description: action.description });
    } else if (action.type === "comment") {
      actions.push({ type: "comment", anchor, comment: action.comment, description: action.description });
    } else {
      if (!attachedIds.has(action.toDocumentId) || action.toDocumentId === data.documentId) {
        warnings.push(t("api.warnLinkTargetNotAttached", { description: action.description }));
        continue;
      }
      actions.push({ type: "link", anchor, toDocumentId: action.toDocumentId, description: action.description });
    }
  }

  // The matches (SPEC.md §7): every quote resolves in its named block — exact,
  // then the whitespace-tolerant match (SPEC.md §5) — else in any block; a
  // quote that resolves nowhere drops, and so does one overlapping the
  // selection or a match already kept. The list joins the reply as its
  // Passages section: one row per match, the quote, the why, and the block's
  // tag, which renders as the ¶ chip that jumps to the block. The reply is
  // what the client shows and what the conversation note stores, so the
  // passages ride with the answer everywhere it goes.
  const selectionSpans = passage.map((s) => ({
    blockId: s.blockId,
    start: s.startOffset,
    end: s.endOffset,
  }));
  const kept: { blockId: string; start: number; end: number; quote: string; why: string }[] = [];
  for (const match of result.data.matches ?? []) {
    const selector = { quotedText: match.quote.trim(), prefix: "", suffix: "" };
    if (!selector.quotedText) continue;
    let block = blockById.get(match.blockId);
    let hit = block ? matchInText(block.text, selector) : null;
    if (!hit) {
      block = undefined;
      for (const candidate of document.blocks) {
        const found = matchInText(candidate.text, selector);
        if (found) {
          block = candidate;
          hit = found;
          break;
        }
      }
    }
    if (!block || !hit) continue;
    const overlaps = (s: { blockId: string; start: number; end: number }) =>
      s.blockId === block!.id && hit!.start < s.end && hit!.end > s.start;
    if (selectionSpans.some(overlaps) || kept.some(overlaps)) continue;
    kept.push({
      blockId: block.id,
      start: hit.start,
      end: hit.end,
      quote: block.text.slice(hit.start, hit.end),
      why: match.why.trim(),
    });
    if (kept.length >= MATCHES_MAX) break;
  }
  const matchLines =
    kept.length > 0
      ? [
          "",
          `**${t("api.assistantMatches")}**`,
          ...kept.map((m) => {
            const quote = m.quote.length > MATCH_QUOTE_MAX ? `${m.quote.slice(0, MATCH_QUOTE_MAX - 1)}…` : m.quote;
            return `- “${quote.replace(/\s+/g, " ")}” — ${m.why} [block ${m.blockId}]`;
          }),
        ]
      : [];

  // An anchored conversation persists like the tools' output: one note in the
  // hidden Annotations section, anchored to the selection, updated per turn.
  // Clicking the mark reopens the conversation; the Annotations tab deletes it.
  let conversationNoteId: string | null = data.conversationNoteId ?? null;
  const answer =
    result.data.reply ??
    (actions.length > 0
      ? `Applied ${actions.length} action${actions.length === 1 ? "" : "s"}.`
      : "No actions proposed.");
  const replyText = [answer, ...matchLines].join("\n");
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
            sources: { create: passageSources(data.documentId, passage) },
          },
        });
        conversationNoteId = note.id;
        await bumpNotebook(data.notebookId);
      }
    }
  }

  const plan: AssistantPlan = {
    reply: result.data.reply === null && kept.length === 0 ? null : replyText,
    actions,
    warnings,
    conversationNoteId,
  };
  return NextResponse.json(plan);
}
