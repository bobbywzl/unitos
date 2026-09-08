import { z } from "zod";
import { type ConversationLog, loggedTurns, parseStoredLog } from "@/lib/conversation";
import { db } from "@/lib/db";
import { GIST_EFFORT, GIST_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { markdownPreview } from "@/lib/markdown-preview";
import {
  conversationLogPrompt,
  LOG_LINE_MAX_CHARS,
  LOG_LINE_MAX_CHARS_ZH,
  LOG_VERSION,
} from "@/lib/prompts/conversation-log";
import type { UsageMeta } from "@/lib/usage";

// The condensed log of a conversation (SPEC.md §21): one line per message,
// written by AI the first time the reader hovers the conversation's mark and
// stored on Note.log. A conversation that grew since the log was written is
// logged again on the next hover; a stored log that matches stands.
const LOG_BATCH = 40;

// The end of a statement, and the end of a clause inside one.
const SENTENCE_END = /[.!?。！？]/;
const CLAUSE_END = /[,;:，；：、—–]/;
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g;

/** The cap for this line: Chinese characters carry more than Latin ones, so a
    Chinese line reads at a glance at a smaller count. */
function capFor(line: string): number {
  const cjk = line.match(CJK)?.length ?? 0;
  return cjk > line.length / 3 ? LOG_LINE_MAX_CHARS_ZH : LOG_LINE_MAX_CHARS;
}

/** The last index in head where mark stands, or -1. A period between digits is
    a number, not an end. */
function lastBreak(head: string, mark: RegExp): number {
  let at = -1;
  for (let i = 1; i < head.length; i++) {
    if (!mark.test(head[i])) continue;
    if (head[i] === "." && /\d/.test(head[i - 1]) && /\d/.test(head[i + 1] ?? "")) continue;
    at = i;
  }
  return at;
}

/** One log line at the cap. The model is asked for a line that finishes its
    point, so this is the safety net: cut at the last sentence end that fits,
    else at the last clause break, so the line never stops mid-thought. A line
    that lost its ending says so with an ellipsis — the full message is one
    click away. */
function logLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const max = capFor(line);
  if (line.length <= max) return line;
  const head = line.slice(0, max + 1);
  // A break this early throws away more than half the room: cut later instead.
  const floor = max / 2;
  const sentence = lastBreak(head, SENTENCE_END);
  // The period itself comes off: a log line carries no trailing period.
  if (sentence > floor) return head.slice(0, sentence).trim();
  const clause = lastBreak(head, CLAUSE_END);
  if (clause > floor) return `${head.slice(0, clause).trim()}…`;
  const space = head.lastIndexOf(" ");
  const cut = space > floor ? head.slice(0, space) : line.slice(0, max);
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}

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
  if (stored && stored.turns === turns.length && stored.v === LOG_VERSION) return stored;
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
    const line = logLine(text.replace(/^["'“”‘’]+|["'“”‘’.。]+$/g, ""));
    if (line !== "" && !byMessage.has(message)) byMessage.set(message, line);
  }
  const log: ConversationLog = {
    turns: turns.length,
    v: LOG_VERSION,
    lines: listed.map((m, i) => ({
      role: m.role,
      text: byMessage.get(i + 1) ?? logLine(m.content),
    })),
  };
  await db.note.update({ where: { id: noteId }, data: { log } });
  return log;
}
