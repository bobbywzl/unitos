import { z } from "zod";
import type { BlockKind } from "@/lib/block-kind";
import { blockTakes, isWebAddress, skippedWarning, type DocumentShape } from "@/lib/block-takes";
import type { TFunc } from "@/lib/i18n/dictionaries";
import type { TranscriptContext } from "@/lib/assistant/transcript";
import { REPLICA_REFUSAL, replicaEdit } from "@/lib/replica";
import { joinRefusal, splitRefusal } from "@/lib/transcript-lines";
import type { AssistantAction, AssistantAnchor } from "@/lib/types";

// The assistant's actions (SPEC.md §7): what the model proposes, validated
// and enriched against the real document before the reader sees it. The
// selection chat (/api/assistant/act) and the sidebar assistant
// (/api/assistant, This page scope) share this one code path; the reader
// approves the plan in the plan card before anything runs.

const DESCRIPTION_MAX = 300;
// A text block's format (lib/block-kind.ts).
const BLOCK_KINDS = ["paragraph", "h1", "h2", "h3", "list", "numbered"] as const satisfies readonly BlockKind[];
// The suggest route's own caps (app/api/documents/[documentId]/suggest).
const INSTRUCTION_MAX = 4000;
const BLOCK_IDS_MAX = 200;

const quote = z.string().min(1).max(2000);
const description = z.string().min(1).max(DESCRIPTION_MAX);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("edit_block"),
    blockId: z.string().min(1),
    newText: z.string().min(1).max(50_000),
    description,
  }),
  z.object({
    type: z.literal("insert_paragraph"),
    // null: the document's start.
    afterBlockId: z.string().min(1).nullable(),
    text: z.string().min(1).max(50_000),
    kind: z.enum(BLOCK_KINDS).optional(),
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
    // Another attached document, or a web address: one of the two.
    toDocumentId: z.string().min(1).optional(),
    href: z.string().min(1).max(2_000).optional(),
    description,
  }),
  z.object({
    type: z.literal("format_block"),
    blockId: z.string().min(1),
    kind: z.enum(BLOCK_KINDS),
    description,
  }),
  z.object({
    type: z.literal("style"),
    blockId: z.string().min(1),
    quote,
    style: z.enum(["bold", "italic", "underline"]),
    description,
  }),
  z.object({
    type: z.literal("move_block"),
    blockId: z.string().min(1),
    afterBlockId: z.string().min(1).nullable(),
    description,
  }),
  z.object({
    type: z.literal("suggest"),
    instruction: z.string().min(1).max(INSTRUCTION_MAX),
    blockIds: z.array(z.string().min(1).max(64)).min(1).max(BLOCK_IDS_MAX).optional(),
    description,
  }),
  // A video's or an audio's transcript lines (SPEC.md §11): two lines
  // joined, a line split at the words its second line starts with, a line
  // given to another voice, a voice renamed on every line.
  z.object({ type: z.literal("join_lines"), blockId: z.string().min(1), nextBlockId: z.string().min(1), description }),
  z.object({ type: z.literal("split_line"), blockId: z.string().min(1), quote, description }),
  z.object({ type: z.literal("set_speaker"), blockId: z.string().min(1), speakerId: z.string().min(1).max(64), description }),
  z.object({ type: z.literal("rename_speaker"), speakerId: z.string().min(1).max(64), name: z.string().trim().min(1).max(60), description }),
  // A document without rich text: the edits of many blocks, found part by
  // part (lib/assistant/revise.ts), for the plan card.
  z.object({
    type: z.literal("revise"),
    instruction: z.string().min(1).max(INSTRUCTION_MAX),
    blockIds: z.array(z.string().min(1).max(64)).min(1).max(BLOCK_IDS_MAX).optional(),
    description,
  }),
]);

export type RawAction = z.infer<typeof actionSchema>;

// The most actions one plan carries.
export const ACTIONS_MAX = 20;

/** The actions a model wrote, each read on its own: the ones that read, and
    for each one that does not, its type and its description or type. */
export type ReadActions = { actions: RawAction[]; unreadable: { type: string; label: string }[] };

/** Words cut to `max` characters at a word, with an ellipsis. */
function clip(text: string, max: number): string {
  const words = text.trim();
  if (words.length <= max) return words;
  const cut = words.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

/** One action as a model writes it, read the way the schema takes it: a
    field written null is left out; blockIds that is no list, an empty list,
    or past BLOCK_IDS_MAX ids means the whole document; a description or an
    instruction past its length is cut to it; a suggest action with no
    description takes its instruction's words. */
function lenient(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(item).filter(([key, value]) => value !== null || key === "afterBlockId"));
  const ids = Array.isArray(fields.blockIds) ? [...new Set(fields.blockIds.filter((id) => typeof id === "string" && id))] : [];
  if (ids.length > 0 && ids.length <= BLOCK_IDS_MAX) fields.blockIds = ids;
  else delete fields.blockIds;
  if (typeof fields.instruction === "string") fields.instruction = clip(fields.instruction, INSTRUCTION_MAX);
  if (typeof fields.description === "string") fields.description = clip(fields.description, DESCRIPTION_MAX);
  if ((fields.type === "suggest" || fields.type === "revise") && !fields.description && typeof fields.instruction === "string") {
    fields.description = clip(fields.instruction, DESCRIPTION_MAX);
  }
  return fields;
}

/** Actions as a model writes them: a list, an object holding one under
    `actions`, or one action alone. Each is read on its own (lenient, then
    the schema): one that does not read is named in `unreadable`, and the
    others stand. At most ACTIONS_MAX. */
export function readActions(value: unknown): ReadActions {
  const holder = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const list = Array.isArray(value) ? value : Array.isArray(holder?.actions) ? holder.actions : holder && "type" in holder ? [holder] : [];
  const read: ReadActions = { actions: [], unreadable: [] };
  for (const item of list.slice(0, ACTIONS_MAX)) {
    const parsed = actionSchema.safeParse(lenient(item));
    if (parsed.success) {
      read.actions.push(parsed.data);
      continue;
    }
    const fields = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const type = typeof fields.type === "string" ? fields.type : "";
    const label = typeof fields.description === "string" && fields.description.trim() ? fields.description : type;
    read.unreadable.push({ type, label: clip(label || "?", DESCRIPTION_MAX) });
  }
  return read;
}

/** The selection chat's actions field: read as readActions reads a fence. */
export const actionsSchema = z.unknown().transform(readActions);

// The action types as the prompts list them: one line per type, the same
// lines for the selection chat and the sidebar assistant.
const ACTION_LINES: Record<RawAction["type"], string> = {
  edit_block:
    "- edit_block {blockId, newText, description} — replace a block's text. A LIST block's text is its lines, each with its marker (- or 1.) and two spaces per level of nesting: a line nests or unnests by its spaces.",
  insert_paragraph: '- insert_paragraph {afterBlockId, text, kind?: "paragraph"|"h1"|"h2"|"h3"|"list"|"numbered", description} — add a block after a block; afterBlockId null adds it at the document\'s start; a paragraph when kind is left out.',
  remove_block: "- remove_block {blockId, description} — delete a block.",
  highlight: '- highlight {blockId, quote, color: "clay"|"sage"|"gold"|"plum", comment?, description} — highlight exact text.',
  comment: "- comment {blockId, quote, comment, description} — annotate exact text with a note.",
  add_note:
    "- add_note {content, sectionId? or sectionTitle?, blockId?, quote?, description} — a note in the notebook. Cite the passage via blockId + quote when the note comes from the text. A new sectionTitle creates the section.",
  add_section: "- add_section {title, description} — an empty section.",
  link: "- link {blockId, quote, toDocumentId? or href?, description} — hyperlink exact text to another attached document (toDocumentId) or to a web address (href).",
  format_block: '- format_block {blockId, kind: "paragraph"|"h1"|"h2"|"h3"|"list"|"numbered", description} — change a block\'s format: a paragraph, a heading level, or a list.',
  style: '- style {blockId, quote, style: "bold"|"italic"|"underline", description} — bold, italicize, or underline exact text.',
  move_block: "- move_block {blockId, afterBlockId, description} — move a block after another block; afterBlockId null moves it to the document's start.",
  suggest:
    "- suggest {instruction, blockIds?, description} — change the document's words or styles. The changes land in the document as suggestions the reader accepts or rejects. instruction: every change to make and where, in plain words, under 150 words; the suggestions write the new words, so never copy the changed text into it. blockIds: the blocks to change, only when the change concerns some blocks and not the selection or the whole document; a heading stands for its section. Leave blockIds out for the whole document.",
  join_lines:
    "- join_lines {blockId, nextBlockId, description} — two transcript lines of one voice, the second right after the first, become one line: its time runs from the first line's start to the second line's end.",
  split_line:
    "- split_line {blockId, quote, description} — one transcript line becomes two: quote is the exact words the second line starts with; the time divides where the words divide.",
  set_speaker: "- set_speaker {blockId, speakerId, description} — give one transcript line to another voice of the recording: an id from Speakers.",
  rename_speaker: "- rename_speaker {speakerId, name, description} — rename a voice on every line it says.",
  revise:
    "- revise {instruction, blockIds?, description} — a change to many blocks at once: the spelling or grammar across the document, its register, a section rewritten. The document is read part by part, and the edit of each block comes to the plan card. instruction: every change to make and where, in plain words, under 150 words; never the changed text itself. blockIds: the blocks to change, only when the change concerns some blocks; a heading stands for its section. Leave blockIds out for the whole document.",
};

/** How the assistant changes the open document: with the block actions (an
    article), with the assistant's suggestions (a document with rich text,
    SPEC.md §29), or not at all (an import a project of another account
    holds too, SPEC.md §30). */
export type DocumentEdits = "blocks" | "suggestions" | "none";

// The actions on a video's or an audio's transcript lines and voices.
const MEDIA_ACTIONS: ReadonlySet<RawAction["type"]> = new Set(["join_lines", "split_line", "set_speaker", "rename_speaker"]);
// The block actions change an article's blocks outright. In a document with
// rich text the assistant's changes are suggestions instead.
const BLOCK_ACTIONS: ReadonlySet<RawAction["type"]> = new Set(["edit_block", "insert_paragraph", "remove_block", "format_block", "style", "move_block", "revise", ...MEDIA_ACTIONS]);
const fitsDocument = (type: RawAction["type"], edits: DocumentEdits): boolean =>
  type === "suggest" ? edits === "suggestions" : !BLOCK_ACTIONS.has(type) || edits === "blocks";

/** The action types as the prompts list them, one line per type: on a
    document with rich text, suggest in place of the block actions; on a
    document that takes no edits, neither; the transcript's actions on a
    video's or an audio's document alone. */
export function actionLines(edits: DocumentEdits, media = false): string[] {
  return (Object.keys(ACTION_LINES) as RawAction["type"][])
    .filter((type) => fitsDocument(type, edits) && (media || !MEDIA_ACTIONS.has(type)))
    .map((type) => ACTION_LINES[type]);
}

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
  edits: DocumentEdits;
  // Document.format: "slides", "sheets", or null.
  format: string | null;
  // A slide's and a sheet's html is its replica, which the plan checks an
  // edit against; a transcript line's times and voice, which a join or a
  // split reads.
  blocks: { id: string; type: string; text: string; html: string | null; startTime?: number | null; endTime?: number | null; speaker?: string | null }[];
  // A video's or an audio's transcript (lib/assistant/transcript.ts): its
  // voices, the lines its chapters start on, each line's anchored words.
  transcript?: Pick<TranscriptContext, "speakers" | "chapterStarts" | "anchors"> | null;
  // Every document attached to the project, the open one included.
  attachedIds: Set<string>;
  sectionIds: Set<string>;
  t: TFunc;
};

type CommandAction = Extract<RawAction, { type: "suggest" | "revise" }>;

/** Several suggest (or revise) actions as the one a message runs (SPEC.md
    §29): their instructions in order, one per line, and the blocks of them
    all; one that names no blocks covers the whole document. */
function joinCommands(list: CommandAction[]): CommandAction {
  if (list.length === 1) return list[0];
  const blockIds = list.every((a) => a.blockIds) ? [...new Set(list.flatMap((a) => a.blockIds ?? []))] : [];
  return {
    type: list[0].type,
    instruction: clip(list.map((a) => a.instruction).join("\n"), INSTRUCTION_MAX),
    ...(blockIds.length > 0 && blockIds.length <= BLOCK_IDS_MAX ? { blockIds } : {}),
    description: clip(list.map((a) => a.description).join(" "), DESCRIPTION_MAX),
  };
}

/** Validate and enrich every action against the real document, so the client
    executes ready-made requests. Invalid actions become warnings, never
    writes; so does each action the model wrote that did not read. A change
    to the document's blocks goes through the rule the block routes read
    (lib/block-takes.ts). */
export function enrichActions(
  read: ReadActions,
  ctx: PlanContext,
): { actions: AssistantAction[]; warnings: string[] } {
  const { t } = ctx;
  const blockById = new Map(ctx.blocks.map((b) => [b.id, b]));
  const indexById = new Map(ctx.blocks.map((b, i) => [b.id, i]));
  const nextType = (id: string) => ctx.blocks[(indexById.get(id) ?? -2) + 1]?.type;
  const shape = planShape(ctx);
  const actions: AssistantAction[] = [];
  const warnings = read.unreadable.map((u) => t("api.warnActionUnreadable", { description: u.label }));
  // A message runs one command of suggestions, or one revision: the suggest
  // actions join, and the revise actions join.
  let raw: RawAction[] = read.actions;
  for (const type of ["suggest", "revise"] as const) {
    const commands = raw.filter((a): a is CommandAction => a.type === type && fitsDocument(a.type, ctx.edits));
    if (commands.length > 1) raw = [...raw.filter((a) => !commands.includes(a as CommandAction)), joinCommands(commands)];
  }
  const refuse = (description: string) => warnings.push(t("api.warnActionNotForDocument", { description }));
  // The lines this plan's joins take away, one after another.
  const joinedAway = new Set<string>();
  const missing = (description: string) => warnings.push(t("api.warnBlockNotFound", { description }));

  for (const action of raw) {
    if (!fitsDocument(action.type, ctx.edits)) {
      refuse(action.description);
      continue;
    }
    switch (action.type) {
      case "suggest":
      case "revise": {
        // Named blocks must be the document's.
        const blockIds = action.blockIds?.filter((id) => blockById.has(id));
        if (action.blockIds && !blockIds?.length) missing(action.description);
        else actions.push({ ...action, blockIds });
        continue;
      }
      case "add_section":
        actions.push(action);
        continue;
      case "add_note": {
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
      case "insert_paragraph": {
        // afterBlockId null: the document's start.
        const after = action.afterBlockId === null ? null : blockById.get(action.afterBlockId);
        if (after === undefined) missing(action.description);
        else if (after ? !blockTakes.after(after.type, nextType(after.id), shape) : !blockTakes.start(ctx.blocks[0]?.type, shape)) refuse(action.description);
        else actions.push(action);
        continue;
      }
      case "join_lines": {
        const first = blockById.get(action.blockId);
        const next = blockById.get(action.nextBlockId);
        if (!first || !next) missing(action.description);
        else if (!shape.media) refuse(action.description);
        else {
          // The line right after the first, past the ones this plan joined away.
          const after = ctx.blocks.slice((indexById.get(first.id) ?? 0) + 1).find((b) => !joinedAway.has(b.id));
          const why = joinRefusal(first, next, after?.id === next.id, ctx.transcript?.chapterStarts ?? new Set());
          if (why) warnings.push(skippedWarning(t, why, action.description));
          else {
            joinedAway.add(next.id);
            actions.push(action);
          }
        }
        continue;
      }
      case "split_line": {
        const line = blockById.get(action.blockId);
        const offset = line ? line.text.indexOf(action.quote) : -1;
        if (!line) missing(action.description);
        else if (!shape.media) refuse(action.description);
        else if (offset < 0 || line.text.indexOf(action.quote, offset + 1) >= 0) warnings.push(t("api.warnQuoteNotFound", { description: action.description }));
        else {
          const why = splitRefusal(line, offset, ctx.transcript?.anchors.get(line.id) ?? []);
          if (why) warnings.push(skippedWarning(t, why, action.description));
          else actions.push({ type: "split_line", blockId: line.id, offset, quote: action.quote, description: action.description });
        }
        continue;
      }
      case "set_speaker": {
        const line = blockById.get(action.blockId);
        if (!line) missing(action.description);
        else if (!shape.media || line.type !== "TRANSCRIPT") refuse(action.description);
        else if (!ctx.transcript?.speakers.some((s) => s.id === action.speakerId)) warnings.push(skippedWarning(t, "api.lineSpeakerUnknown", action.description));
        else if ((line.speaker ?? null) !== action.speakerId) actions.push({ ...action, previous: line.speaker ?? null });
        continue;
      }
      case "rename_speaker": {
        const speaker = ctx.transcript?.speakers.find((s) => s.id === action.speakerId);
        if (!shape.media) refuse(action.description);
        else if (!speaker) warnings.push(skippedWarning(t, "api.lineSpeakerUnknown", action.description));
        else if (speaker.name !== action.name) actions.push({ ...action, previousName: speaker.name });
        continue;
      }
      case "move_block": {
        const target = blockById.get(action.blockId);
        const after = action.afterBlockId === null ? null : blockById.get(action.afterBlockId);
        if (!target || after === undefined || action.afterBlockId === action.blockId) missing(action.description);
        else if (!blockTakes.move(target.type, shape)) refuse(action.description);
        else if (after ? !blockTakes.after(after.type, nextType(after.id), shape) : !blockTakes.start(ctx.blocks[0]?.type, shape)) refuse(action.description);
        else actions.push(action);
        continue;
      }
    }
    const block = blockById.get(action.blockId);
    if (!block) {
      warnings.push(t(action.type === "format_block" ? "api.warnBlockNotFoundOrNotText" : "api.warnBlockNotFound", { description: action.description }));
      continue;
    }
    if (action.type === "remove_block" && block.type === "PAGE") {
      // The plan's pages as its removals leave them: the last one stays.
      if (!blockTakes.removal(block.type, shape)) warnings.push(skippedWarning(t, "api.lastPageStays", action.description));
      else {
        shape.pages -= 1;
        actions.push(action);
      }
      continue;
    }
    if (action.type === "edit_block" || action.type === "remove_block") {
      if (!(action.type === "edit_block" ? blockTakes.words : blockTakes.removal)(block.type, shape)) {
        warnings.push(t("api.warnOnlyTextEdited", { description: action.description }));
      } else if (action.type === "edit_block" && (block.type === "SLIDE" || block.type === "SHEET")) {
        // A slide's or a sheet's replica: the route's own check, run first.
        const edited = replicaEdit(block.type, block.html ?? "", block.text, action.newText);
        if ("refused" in edited) warnings.push(skippedWarning(t, REPLICA_REFUSAL[edited.refused], action.description));
        else actions.push(action);
      } else actions.push(action);
      continue;
    }
    if (action.type === "format_block") {
      if (!blockTakes.kind(block.type, shape)) refuse(action.description);
      else actions.push(action);
      continue;
    }
    // highlight / comment / style / link carry exact quotes: resolve to offsets now.
    const anchor = buildAnchor(block.text, action.quote, block.id);
    if (!anchor) {
      warnings.push(t("api.warnQuoteNotFound", { description: action.description }));
      continue;
    }
    if (action.type === "highlight") {
      actions.push({ type: "highlight", anchor, color: action.color, comment: action.comment, description: action.description });
    } else if (action.type === "comment") {
      actions.push({ type: "comment", anchor, comment: action.comment, description: action.description });
    } else if (action.type === "style") {
      if (!blockTakes.style(block.type)) refuse(action.description);
      else actions.push({ type: "style", anchor, style: action.style, description: action.description });
    } else if (action.href !== undefined) {
      // A web address, on a document without rich text (a rich text takes
      // its links as the assistant's suggestions).
      if (ctx.edits !== "blocks" || !blockTakes.style(block.type)) refuse(action.description);
      else if (!isWebAddress(action.href)) warnings.push(t("api.warnLinkAddress", { description: action.description }));
      else actions.push({ type: "link", anchor, href: action.href.trim(), description: action.description });
    } else if (!action.toDocumentId || !ctx.attachedIds.has(action.toDocumentId) || action.toDocumentId === ctx.documentId) {
      warnings.push(t("api.warnLinkTargetNotAttached", { description: action.description }));
    } else {
      actions.push({ type: "link", anchor, toDocumentId: action.toDocumentId, description: action.description });
    }
  }
  return { actions, warnings };
}

/** The open document's shape, from what the plan reads of it. */
export const planShape = (ctx: Pick<PlanContext, "format" | "blocks">): DocumentShape => ({
  format: ctx.format,
  media: ctx.blocks.some((b) => b.type === "VIDEO" || b.type === "TRANSCRIPT"),
  pages: ctx.blocks.filter((b) => b.type === "PAGE").length,
});

// The sidebar assistant's answer ends with its actions in a fenced block
// (SPEC.md §7): the answer streams to the reader, the block is held back on
// the server, read here, and sent after the answer as the plan.
export const ACTIONS_FENCE = "```actions";

/** Split an answer into the text before the actions fence and the fence's
    content; content is null when the answer carries no fence. The fence
    closes at the first ``` outside a JSON string, so a code fence inside an
    instruction stays in it. */
export function splitActionsFence(text: string): { text: string; content: string | null } {
  const at = text.indexOf(ACTIONS_FENCE);
  if (at === -1) return { text, content: null };
  const rest = text.slice(at + ACTIONS_FENCE.length);
  let close = -1;
  let inString = false;
  for (let i = 0; i < rest.length && close === -1; i++) {
    const c = rest[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (rest.startsWith("```", i)) close = i;
  }
  // Quotes that never pair up: the last ``` closes.
  if (close === -1) close = rest.lastIndexOf("```");
  return {
    text: text.slice(0, at).trimEnd(),
    content: (close === -1 ? rest : rest.slice(0, close)).trim(),
  };
}

// What may follow a string's closing quote in JSON: the end, a closing
// bracket, a comma before a value or a bracket, or a colon before a value,
// with spaces and comments between. A quote followed by anything else is a
// quote inside the words.
const GAP = String.raw`(?:\s|//[^\n]*|/\*[\s\S]*?\*/)*`;
const CLOSES_STRING = new RegExp(String.raw`${GAP}(?:$|[}\]]|,${GAP}(?:["{[\]}\d-]|true|false|null)|:${GAP}(?:["{[\d-]|true|false|null))`, "y");

/** A character inside a JSON string, escaped when JSON wants it escaped. */
const inJsonString = (c: string): string =>
  c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : c < " " ? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c;

/** The first JSON value in `text`, read through the slips a model makes
    when it writes JSON by hand: a line break or a quote left raw inside a
    string, an escape JSON lacks, a trailing comma, a comment, and output
    cut off (the value closes at the last place a value ended). A bracket
    that starts no value (words before the JSON) is passed over. undefined
    when nothing reads. */
export function looseJson(text: string): unknown {
  for (let start = text.search(/[[{]/), tries = 0; start !== -1 && tries < 5; tries++) {
    const read = looseJsonAt(text, start);
    if (read !== undefined) return read;
    const next = text.slice(start + 1).search(/[[{]/);
    start = next === -1 ? -1 : start + 1 + next;
  }
  return undefined;
}

function looseJsonAt(text: string, start: number): unknown {
  let out = "";
  const closers: string[] = [];
  // The places the value could have ended: after a string or a bracket,
  // before a comma; each with the brackets open there.
  const cuts: { at: number; open: string }[] = [];
  const cut = () => cuts.push({ at: out.length, open: closers.join("") });
  let inString = false;
  let i = start;
  for (; i < text.length && !(closers.length === 0 && i > start); i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\" && i + 1 < text.length) {
        const next = text[++i];
        out += '"\\/bfnrtu'.includes(next) ? c + next : inJsonString(next);
      } else if (c === '"') {
        CLOSES_STRING.lastIndex = i + 1;
        if (CLOSES_STRING.test(text)) {
          inString = false;
          out += c;
          cut();
        } else out += '\\"';
      } else out += inJsonString(c);
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      const end = text[i + 1] === "/" ? text.indexOf("\n", i) : text.indexOf("*/", i + 2) + 1;
      i = end <= 0 ? text.length : end;
    } else if (c === "{" || c === "[") {
      closers.push(c === "{" ? "}" : "]");
      out += c;
    } else if (c === "}" || c === "]") {
      out = out.replace(/,\s*$/, "");
      closers.pop();
      out += c;
      cut();
    } else {
      if (c === ",") cut();
      out += c;
    }
  }
  const attempt = (json: string): unknown => {
    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  };
  if (!inString && closers.length === 0) {
    const whole = attempt(out);
    if (whole !== undefined) return whole;
  }
  // Cut off, or broken past repair: the longest reading that closes.
  for (const { at, open } of cuts.slice(-200).reverse()) {
    const read = attempt(out.slice(0, at).replace(/,\s*$/, "") + [...open].reverse().join(""));
    if (read !== undefined) return read;
  }
  return undefined;
}

/** The fence's content as actions (readActions). null when nothing in it
    reads as JSON. On a document that takes suggestions, a suggest action the
    fence names but that does not read runs with the answer as its
    instruction: the answer says what will change (the prompt's rule 7). */
export function parseActionsFence(content: string, answer = "", edits: DocumentEdits = "blocks"): ReadActions | null {
  const json = looseJson(content);
  const read = json === undefined ? null : readActions(json);
  const lost = read ? read.unreadable.some((u) => u.type === "suggest") : /"suggest"/.test(content);
  if (edits !== "suggestions" || !lost || !answer.trim() || read?.actions.some((a) => a.type === "suggest")) return read;
  return {
    actions: [
      ...(read?.actions ?? []),
      { type: "suggest", instruction: clip(answer, INSTRUCTION_MAX), description: clip(answer.split("\n")[0], DESCRIPTION_MAX) },
    ],
    unreadable: read?.unreadable.filter((u) => u.type !== "suggest") ?? [],
  };
}
