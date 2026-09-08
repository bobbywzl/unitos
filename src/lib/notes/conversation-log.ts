import { z } from "zod";
import { type ConversationLog, loggedTurns, parseStoredLog } from "@/lib/conversation";
import { db } from "@/lib/db";
import { GIST_EFFORT, GIST_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { conversationLogPrompt, LOG_LINE_MAX_CHARS } from "@/lib/prompts/conversation-log";
import type { UsageMeta } from "@/lib/usage";

// The condensed log of a conversation (SPEC.md §21): one line per message,
// written by AI the first time the reader hovers the conversation's mark and
// stored on Note.log. A conversation that grew since the log was written is
// logged again on the next hover; a stored log that matches stands.
const LOG_BATCH = 40;

const logSchema = z.object({
  lines: z
    .array(
      z.object({
        message: z.number().int().min(1),
        text: z.string().min(1).max(LOG_LINE_MAX_CHARS * 3),
      }),
    )
    .max(LOG_BATCH),
});

/** The log of the note's conversation: the stored one when it is current,
    else a new one written now. null = no conversation, or the model call
    failed and nothing is stored. */
export async function ensureConversationLog(
  noteId: string,
  userId: string | null,
): Promise<ConversationLog | null> {
  const note = await db.note.findUnique({
    where: { id: noteId },
    select: { derivationType: true, content: true, conversation: true, log: true },
  });
  if (!note) return null;
  const turns = loggedTurns(note).slice(0, LOG_BATCH);
  if (turns.length === 0) return null;
  const stored = parseStoredLog(note.log);
  if (stored && stored.turns === turns.length) return stored;
  if (!kimiConfigured()) return stored;

  const listed = turns.map((m) => ({ role: m.role, content: markdownPreview(m.content) || m.content }));
  const result = await callForJson({
    model: await kimi(GIST_MODEL),
    messages: [{ role: "user", content: conversationLogPrompt({ turns: listed }) }],
    maxOutputTokens: 16384,
    providerOptions: kimiOptions(GIST_EFFORT),
    schema: logSchema,
    label: "LOG",
    usage: { userId, feature: "log", model: GIST_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.error(`[log] ${result.error}`);
    return stored;
  }
  // One line per message, in message order; a message the model skipped shows
  // its first words instead, so the log never has a gap.
  const byMessage = new Map<number, string>();
  for (const { message, text } of result.data.lines) {
    const line = clipWords(text.replace(/^["'“”‘’]+|["'“”‘’.。]+$/g, ""), LOG_LINE_MAX_CHARS);
    if (line !== "" && !byMessage.has(message)) byMessage.set(message, line);
  }
  const log: ConversationLog = {
    turns: turns.length,
    lines: listed.map((m, i) => ({
      role: m.role,
      text: byMessage.get(i + 1) ?? clipWords(m.content, LOG_LINE_MAX_CHARS),
    })),
  };
  await db.note.update({ where: { id: noteId }, data: { log } });
  return log;
}
