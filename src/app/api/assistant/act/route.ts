import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { anchorContext, documentPrefix, loadProfile, sectionSkeleton } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import { parseBody } from "@/lib/validate";
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
    })
    .optional(),
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

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. The assistant needs it." },
      { status: 503 },
    );
  }
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Document is not attached to this notebook" }, { status: 404 });
  }
  const document = await db.document.findUnique({
    where: { id: data.documentId },
    include: {
      blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } },
    },
  });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

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

  let selectionBlock = "";
  if (data.anchor) {
    const anchored = anchorContext(
      document.blocks,
      data.anchor.blockId,
      data.anchor.startOffset,
      data.anchor.endOffset,
    );
    if (!anchored) {
      return NextResponse.json({ error: "Anchor does not resolve" }, { status: 400 });
    }
    selectionBlock = `The reader has selected this text in block ${data.anchor.blockId}:\n"${anchored.anchoredText.slice(0, 2000)}"\nThe command applies to this selection unless it says otherwise.`;
  }

  const otherDocs = attachedDocs
    .map((nd) => nd.document)
    .filter((d) => d.id !== data.documentId);

  const userPrompt = [
    "Convert the reader's command into a plan of actions on this document and notebook. The reader approves the plan before anything runs.",
    "",
    profile
      ? `Reader profile: background: ${profile.background}. Purpose: ${profile.purpose}. Application: ${profile.application}.`
      : "Reader profile: not set.",
    "",
    selectionBlock || "The reader has no text selected. The command applies to the document.",
    "",
    `Sections in the notebook (id — title):\n${sections.length > 0 ? sections.map((s) => `${s.id} — ${s.parentTitle ? `${s.parentTitle} / ` : ""}${s.title}`).join("\n") : "none yet"}`,
    "",
    `Other attached documents (id — title):\n${otherDocs.length > 0 ? otherDocs.map((d) => `${d.id} — ${d.title}`).join("\n") : "none"}`,
    "",
    `The reader's notes across the notebook (section: note):\n${
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
    "",
    `Command: ${data.command}`,
    "",
    'Return ONLY JSON: {"reply": string or null, "actions": [...]}',
  ].join("\n");

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: userPrompt },
  ];

  const result = await callForJson({
    model: anthropic(DERIVATION_MODEL.SYNTHESIS),
    messages,
    maxOutputTokens: MAX_OUTPUT_TOKENS.SYNTHESIS,
    schema: planSchema,
    label: "assistant:act",
  });
  if (!result.ok) {
    return NextResponse.json({ error: `The assistant could not form a plan. ${result.error}` }, { status: 422 });
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
        else warnings.push(`Note source dropped: the quote was not found. (${action.description})`);
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
        warnings.push(`Skipped: block not found or not text. (${action.description})`);
        continue;
      }
      actions.push(action);
      continue;
    }
    if (action.type === "style") {
      const target = blockById.get(action.blockId);
      const anchor = target ? buildAnchor(target.text, action.quote, target.id) : null;
      if (!anchor) {
        warnings.push(`Skipped: the quote was not found in its block. (${action.description})`);
        continue;
      }
      actions.push({ type: "style", anchor, style: action.style, description: action.description });
      continue;
    }
    const block = blockById.get(
      action.type === "insert_paragraph" ? action.afterBlockId : action.blockId,
    );
    if (!block) {
      warnings.push(`Skipped: block not found. (${action.description})`);
      continue;
    }
    if (
      (action.type === "edit_block" || action.type === "remove_block") &&
      !TEXT_TYPES.has(block.type)
    ) {
      warnings.push(`Skipped: only text blocks can be edited. (${action.description})`);
      continue;
    }
    if (action.type === "edit_block" || action.type === "remove_block" || action.type === "insert_paragraph") {
      actions.push(action);
      continue;
    }
    // highlight / comment / link carry exact quotes: resolve to offsets now.
    const anchor = buildAnchor(block.text, action.quote, block.id);
    if (!anchor) {
      warnings.push(`Skipped: the quote was not found in its block. (${action.description})`);
      continue;
    }
    if (action.type === "highlight") {
      actions.push({ type: "highlight", anchor, color: action.color, comment: action.comment, description: action.description });
    } else if (action.type === "comment") {
      actions.push({ type: "comment", anchor, comment: action.comment, description: action.description });
    } else {
      if (!attachedIds.has(action.toDocumentId) || action.toDocumentId === data.documentId) {
        warnings.push(`Skipped: the link target is not another attached document. (${action.description})`);
        continue;
      }
      actions.push({ type: "link", anchor, toDocumentId: action.toDocumentId, description: action.description });
    }
  }

  const plan: AssistantPlan = { reply: result.data.reply, actions, warnings };
  return NextResponse.json(plan);
}
