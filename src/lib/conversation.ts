import { z } from "zod";
import { stripSimplifyMarkers } from "@/lib/sentences";

// Conversations anchored to a selection (SPEC.md §21). Two forms, one shape:
// an assistant conversation (a SYNTHESIS note) keeps its transcript in the
// note's content; a tool conversation — Explain+, Simplify+, Analyze+,
// Visualize+ — keeps its turns on Note.conversation, after the tool's output
// in the note's content. No database here: the reader imports this file.

export type ChatTurn = { role: "user" | "assistant"; content: string };

// The tools whose card continues into a conversation.
export const TOOL_KINDS = ["explain", "simplify", "analyze", "visualize"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_DERIVATIONS = ["EXPLAIN", "SIMPLIFY", "ANALYZE", "VISUALIZE"] as const;
export type ToolDerivation = (typeof TOOL_DERIVATIONS)[number];

export function toolKindOf(derivationType: string | null): ToolKind | null {
  switch (derivationType) {
    case "EXPLAIN":
      return "explain";
    case "SIMPLIFY":
      return "simplify";
    case "ANALYZE":
      return "analyze";
    case "VISUALIZE":
      return "visualize";
    default:
      return null;
  }
}

// The tool's name and what its output is called in prompts, one name each.
export const TOOL_NAME: Record<ToolKind, string> = {
  explain: "Explain",
  simplify: "Simplify",
  analyze: "Analyze",
  visualize: "Visualize",
};
export const TOOL_OUTPUT_NAME: Record<ToolKind, string> = {
  explain: "explanation",
  simplify: "simplified rewrite",
  analyze: "analysis",
  visualize: "visualization",
};

export const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

export const conversationSchema = z.array(chatTurnSchema).max(60);

/** The stored turns of a tool conversation; [] when there are none or the
    stored value is not a conversation. */
export function parseStoredConversation(value: unknown): ChatTurn[] {
  const parsed = conversationSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

// Transcript format written by /api/assistant/act for an assistant
// conversation: "**Reader:** …" and "**Assistant:** …" turns separated by
// blank lines.
export function parseTranscript(content: string): ChatTurn[] {
  const chunks = content.split(/\n\n(?=\*\*(?:Reader|Assistant):\*\* )/);
  const messages: ChatTurn[] = [];
  for (const chunk of chunks) {
    const m = /^\*\*(Reader|Assistant):\*\* ([\s\S]*)$/.exec(chunk.trim());
    if (m) messages.push({ role: m[1] === "Reader" ? "user" : "assistant", content: m[2] });
  }
  return messages.length > 0 ? messages : [{ role: "assistant", content }];
}

export function renderTranscript(turns: ChatTurn[]): string {
  return turns
    .map((m) => `**${m.role === "user" ? "Reader" : "Assistant"}:** ${m.content}`)
    .join("\n\n");
}

/** The turns a note's conversation has, whichever form it takes: the
    transcript of an assistant conversation, the stored turns of a tool
    conversation, [] for every other note. */
export function conversationTurns(note: {
  derivationType: string | null;
  content: string;
  conversation: unknown;
}): ChatTurn[] {
  if (note.derivationType === "SYNTHESIS") return parseTranscript(note.content);
  if (toolKindOf(note.derivationType)) return parseStoredConversation(note.conversation);
  return [];
}

/** The messages the log condenses (SPEC.md §21): for a tool conversation the
    tool's output first, as the assistant's opening message, then the turns;
    for an assistant conversation the turns alone. [] = nothing to log. */
export function loggedTurns(note: {
  derivationType: string | null;
  content: string;
  conversation: unknown;
}): ChatTurn[] {
  const turns = conversationTurns(note);
  const tool = toolKindOf(note.derivationType);
  if (!tool || turns.length === 0) return turns;
  const output = tool === "simplify" ? stripSimplifyMarkers(note.content) : note.content;
  return [{ role: "assistant", content: output }, ...turns];
}

// The condensed log: one line per message, in message order. turns = the
// number of messages it was written from; another count means the log is
// stale and the next hover writes it again.
// v = the line rules the log was written under (LOG_VERSION in
// lib/prompts/conversation-log.ts). A log stored under older rules is written
// again on the next hover, so a change to the rules reaches logs already
// stored. A log from before the field carries no v.
export type ConversationLog = {
  turns: number;
  v?: number;
  lines: { role: ChatTurn["role"]; text: string }[];
};

export const conversationLogSchema = z.object({
  turns: z.number().int().min(0),
  v: z.number().int().optional(),
  lines: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).max(80),
});

export function parseStoredLog(value: unknown): ConversationLog | null {
  const parsed = conversationLogSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
