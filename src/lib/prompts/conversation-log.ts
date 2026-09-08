import type { ChatTurn } from "@/lib/conversation";

// LOG: the condensed log of a conversation (SPEC.md §21) — the lines the
// reader sees when hovering the conversation's mark, one per message, so the
// conversation's point is clear at a glance. Not a derivation — nothing lands
// in a note — so it is not in promptTemplates.
export type ConversationLogCtx = { turns: ChatTurn[] };

// One line has to read at a glance in a card beside the article, and it has
// to finish its point: a line cut off partway is worse than a longer line, so
// the cap is the room a complete statement needs, not the shortest line that
// fits.
export const LOG_LINE_MAX_CHARS = 150;
export const LOG_LINE_MAX_CHARS_ZH = 65;
export const LOG_LINE_MAX_WORDS = 25;
// Bumped when these rules change, so a log stored under the old rules is
// written again on the next hover instead of standing.
export const LOG_VERSION = 2;
// A long message is cut for the prompt: its line comes from its start.
const MESSAGE_CHARS = 2000;

export function conversationLogPrompt(ctx: ConversationLogCtx): string {
  const listed = ctx.turns
    .map(
      (m, i) =>
        `[message ${i + 1}] ${m.role === "user" ? "Reader" : "Assistant"}:\n${m.content.slice(0, MESSAGE_CHARS)}`,
    )
    .join("\n\n");
  return [
    "Below is a conversation between a reader and the assistant about a passage the reader selected while reading. Each message is listed under its number.",
    "",
    listed,
    "",
    "Write the log of this conversation: one line per message that says the core of the message, so the reader knows what the conversation covered from the lines alone.",
    '1. Every line is one complete statement that finishes its point. Never stop partway, never end on a dangling word like "and", "to", "optionally", "which". A line the reader has to finish in their head is a failed line.',
    `2. At most ${LOG_LINE_MAX_WORDS} words and ${LOG_LINE_MAX_CHARS} characters per line. In Chinese at most ${LOG_LINE_MAX_CHARS_ZH} characters. Use the room the point needs and stop there; a shorter complete line beats a longer cut one.`,
    "3. Write each line in the message's own language.",
    "4. A reader's line states what the reader asked or wanted. An assistant's line states the answer's core point, not its topic: \"Defaults are bought at issue, the floor is earned later\", not \"Explains defaults\".",
    "5. Keep the message's own key terms and numbers. No quotation marks, no trailing period, no markdown.",
    "6. One line per message number. Use the numbers exactly as listed.",
    "",
    'Return ONLY JSON: {"lines": [{"message": <number>, "text": "<line>"}]}',
  ].join("\n");
}
