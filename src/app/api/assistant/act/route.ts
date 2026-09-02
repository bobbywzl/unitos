import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAnchor } from "@/lib/anchors/resolve";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import {
  anchorContext,
  annotationsSection,
  documentPrefix,
  loadProfile,
  sectionSkeleton,
} from "@/lib/derive/context";
import { figureContent, figureVisual, type FigureImage } from "@/lib/derive/figure";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { currentLang, serverT } from "@/lib/i18n/server";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { languageName, profileLines } from "@/lib/prompts/types";
import { parseBody } from "@/lib/validate";
import { formatTimeRange, regionSchema } from "@/lib/video/types";
import type { AssistantAction, AssistantAnchor, AssistantPlan } from "@/lib/types";

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

const planSchema = z.object({
  reply: z.string().max(8000).nullable(),
  actions: z.array(actionSchema).max(20),
});

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
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: t("api.assistantNeedsKey") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const user = access.user;

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

  // A selection on a FIGURE block carries the figure itself: image bytes when
  // they can be produced (fetched, decoded, or the PDF page rendered), SVG
  // source for charts — same treatment as EXPLAIN (SPEC.md §4: one pipeline).
  let selectionBlock = "";
  let attachedImage: FigureImage | null = null;
  // The anchor resolves through the ladder (SPEC.md §5): block id and offsets,
  // then the quote inside the block, then the quote across the document. A
  // re-parse gives every block a new id while an open reader still sends the
  // old ones; the quote carries the selection across.
  const anchor = data.anchor ? resolveAnchor(document.blocks, data.anchor) : null;
  const anchored = anchor
    ? anchorContext(document.blocks, anchor.blockId, anchor.startOffset, anchor.endOffset)
    : null;
  if (data.anchor && (!anchor || !anchored)) {
    return NextResponse.json({ error: t("api.anchorNotResolvedInDocument") }, { status: 400 });
  }
  if (anchor && anchored) {
    const anchoredBlock = await db.block.findUnique({
      where: { id: anchor.blockId },
      select: { type: true, html: true, text: true, page: true },
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
      selectionBlock = `The reader has selected this text in block ${anchor.blockId}:\n"${anchored.anchoredText.slice(0, 2000)}"\nThe command applies to this selection unless it says otherwise.`;
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

  const userPrompt = [
    "Convert the reader's command into a plan of actions on this document and notebook. The reader approves the plan before anything runs.",
    "",
    profileLines(profile),
    "",
    selectionBlock || "The reader has no text selected. The command applies to the document.",
    "",
    `Sections in the corpus (id — title):\n${sections.length > 0 ? sections.map((s) => `${s.id} — ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`).join("\n") : "none yet"}`,
    "",
    `Other attached documents (id — title):\n${otherDocs.length > 0 ? otherDocs.map((d) => `${d.id} — ${d.title}`).join("\n") : "none"}`,
    "",
    `The reader's notes across the corpus (section: note):\n${
      notes.filter((n) => !n.section.hidden).length > 0
        ? notes
            .filter((n) => !n.section.hidden)
            .map((n) => `${n.section.title}: ${n.content.slice(0, 200)}`)
            .join("\n")
        : "none yet"
    }`,
    "",
    "Action types:",
    '- edit_block {blockId, newText, description} — replace a block\'s text.',
    '- insert_paragraph {afterBlockId, text, description} — add a paragraph after a block.',
    '- remove_block {blockId, description} — delete a block.',
    '- highlight {blockId, quote, color: "clay"|"sage"|"gold"|"plum", comment?, description} — highlight exact text.',
    '- comment {blockId, quote, comment, description} — annotate exact text with a note.',
    '- add_note {content, sectionId? or sectionTitle?, blockId?, quote?, description} — a note in the notebook. Cite the passage via blockId + quote when the note comes from the text. A new sectionTitle creates the section.',
    '- add_section {title, description} — an empty section.',
    '- link {blockId, quote, toDocumentId, description} — hyperlink exact text to another attached document.',
    '- format_block {blockId, kind: "paragraph"|"h1"|"h2"|"h3", description} — change a block\'s heading level.',
    '- style {blockId, quote, style: "bold"|"italic", description} — bold or italicize exact text.',
    "",
    "Rules:",
    "1. Use block ids exactly as given. Every quote must be an exact substring of the named block's text.",
    "2. A command that only asks for analysis, an answer, or a summary: put it in reply and return no actions.",
    "3. Use the smallest set of actions that fulfils the command. Never change text the command did not ask to change.",
    "4. description: one plain sentence of what the action does, for the reader's approval list.",
    "5. TABLE and FIGURE blocks cannot be edited or removed.",
    "6. In reply, cite blocks as [block <id>] when you point at specific parts of the document — the tags render as links the reader can click.",
    `7. Write reply and every description in ${languageName(await currentLang())}.`,
    "",
    ...(data.history && data.history.length > 0
      ? [
          "Conversation so far. The command continues it:",
          ...data.history.map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`),
          "",
        ]
      : []),
    `Command: ${data.command}`,
    "",
    'Return ONLY JSON: {"reply": string or null, "actions": [...]}',
  ].join("\n");

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks, document.references),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    attachedImage
      ? {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image", image: attachedImage.bytes, mediaType: attachedImage.mediaType },
          ],
        }
      : { role: "user", content: userPrompt },
  ];

  const result = await callForJson({
    model: anthropic(DERIVATION_MODEL.SYNTHESIS),
    messages,
    maxOutputTokens: MAX_OUTPUT_TOKENS.SYNTHESIS,
    schema: planSchema,
    label: "assistant:act",
    usage: { userId: user.id, feature: "act", model: DERIVATION_MODEL.SYNTHESIS },
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

  // An anchored conversation persists like EXPLAIN output: one note in the
  // hidden Annotations section, anchored to the selection, updated per turn.
  // Clicking the mark reopens the conversation; the Annotations tab deletes it.
  let conversationNoteId: string | null = data.conversationNoteId ?? null;
  if (anchor) {
    const replyText =
      result.data.reply ??
      (actions.length > 0
        ? `Applied ${actions.length} action${actions.length === 1 ? "" : "s"}.`
        : "No actions proposed.");
    const transcript = [
      ...(data.history ?? []),
      { role: "user" as const, content: data.command },
      { role: "assistant" as const, content: replyText },
    ]
      .map((m) => `**${m.role === "user" ? "Reader" : "Assistant"}:** ${m.content}`)
      .join("\n\n");
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
            sources: {
              create: {
                documentId: data.documentId,
                blockId: anchor.blockId,
                startOffset: anchor.startOffset,
                endOffset: anchor.endOffset,
                quotedText: anchor.quotedText,
                prefix: anchor.prefix,
                suffix: anchor.suffix,
              },
            },
          },
        });
        conversationNoteId = note.id;
        await bumpNotebook(data.notebookId);
      }
    }
  }

  const plan: AssistantPlan = { reply: result.data.reply, actions, warnings, conversationNoteId };
  return NextResponse.json(plan);
}
