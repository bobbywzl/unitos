import { z } from "zod";
import type { TFunc } from "@/lib/i18n/dictionaries";
import type { AssistantAction, AssistantAnchor } from "@/lib/types";

// The assistant's actions (SPEC.md §7): what the model proposes, validated
// and enriched against the real document before the reader sees it. The
// selection chat (/api/assistant/act) and the sidebar assistant
// (/api/assistant, This page scope) share this one code path; the reader
// approves the plan in the plan card before anything runs.

const quote = z.string().min(1).max(2000);
const description = z.string().min(1).max(300);

export const actionSchema = z.discriminatedUnion("type", [
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

export type RawAction = z.infer<typeof actionSchema>;

// The most actions one plan carries.
export const ACTIONS_MAX = 20;
export const actionsSchema = z.array(actionSchema).max(ACTIONS_MAX);

// The action types as the prompt lists them: one line per type, the same
// lines for the selection chat and the sidebar assistant.
export const ACTION_TYPE_LINES = [
  "- edit_block {blockId, newText, description} — replace a block's text.",
  "- insert_paragraph {afterBlockId, text, description} — add a paragraph after a block.",
  "- remove_block {blockId, description} — delete a block.",
  '- highlight {blockId, quote, color: "clay"|"sage"|"gold"|"plum", comment?, description} — highlight exact text.',
  "- comment {blockId, quote, comment, description} — annotate exact text with a note.",
  "- add_note {content, sectionId? or sectionTitle?, blockId?, quote?, description} — a note in the notebook. Cite the passage via blockId + quote when the note comes from the text. A new sectionTitle creates the section.",
  "- add_section {title, description} — an empty section.",
  "- link {blockId, quote, toDocumentId, description} — hyperlink exact text to another attached document.",
  '- format_block {blockId, kind: "paragraph"|"h1"|"h2"|"h3", description} — change a block\'s heading level.',
  '- style {blockId, quote, style: "bold"|"italic", description} — bold or italicize exact text.',
];

export const TEXT_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST", "CODE", "EQUATION"]);

export function buildAnchor(blockText: string, quoteText: string, blockId: string): AssistantAnchor | null {
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

export type PlanContext = {
  documentId: string;
  blocks: { id: string; type: string; text: string }[];
  // Every document attached to the project, the open one included.
  attachedIds: Set<string>;
  sectionIds: Set<string>;
  t: TFunc;
};

/** Validate and enrich every action against the real document, so the client
    executes ready-made requests. Invalid actions become warnings, never writes. */
export function enrichActions(
  raw: RawAction[],
  ctx: PlanContext,
): { actions: AssistantAction[]; warnings: string[] } {
  const { t } = ctx;
  const blockById = new Map(ctx.blocks.map((b) => [b.id, b]));
  const actions: AssistantAction[] = [];
  const warnings: string[] = [];

  for (const action of raw) {
    if (action.type === "add_section") {
      actions.push(action);
      continue;
    }
    if (action.type === "add_note") {
      const sectionId = action.sectionId && ctx.sectionIds.has(action.sectionId) ? action.sectionId : undefined;
      let source: (AssistantAnchor & { documentId: string }) | undefined;
      if (action.blockId && action.quote) {
        const block = blockById.get(action.blockId);
        const anchor = block ? buildAnchor(block.text, action.quote, block.id) : null;
        if (anchor) source = { documentId: ctx.documentId, ...anchor };
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
      if (!ctx.attachedIds.has(action.toDocumentId) || action.toDocumentId === ctx.documentId) {
        warnings.push(t("api.warnLinkTargetNotAttached", { description: action.description }));
        continue;
      }
      actions.push({ type: "link", anchor, toDocumentId: action.toDocumentId, description: action.description });
    }
  }
  return { actions, warnings };
}

// The sidebar assistant's answer ends with its actions in a fenced block
// (SPEC.md §7): the answer streams to the reader, the block is held back on
// the server, read here, and sent after the answer as the plan.
export const ACTIONS_FENCE = "```actions";

/** Split an answer into the text before the actions fence and the fence's
    content; content is null when the answer carries no fence. */
export function splitActionsFence(text: string): { text: string; content: string | null } {
  const at = text.indexOf(ACTIONS_FENCE);
  if (at === -1) return { text, content: null };
  const rest = text.slice(at + ACTIONS_FENCE.length);
  const close = rest.indexOf("```");
  return {
    text: text.slice(0, at).trimEnd(),
    content: (close === -1 ? rest : rest.slice(0, close)).trim(),
  };
}

/** The fence's content as actions: a JSON array, or an object holding one
    under `actions`. null when it is not readable. */
export function parseActionsFence(content: string): RawAction[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { actions?: unknown }).actions)
      ? (parsed as { actions: unknown[] }).actions
      : null;
  if (!list) return null;
  const result = actionsSchema.safeParse(list.slice(0, ACTIONS_MAX));
  return result.success ? result.data : null;
}
