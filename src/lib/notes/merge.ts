import { z } from "zod";
import { db } from "@/lib/db";
import { MERGE_EFFORT, MERGE_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import type { Lang } from "@/lib/i18n/config";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { mergePrompt } from "@/lib/prompts/merge";
import type { UsageMeta } from "@/lib/usage";

// Merge with AI (SPEC.md §6): the notes rewritten as one note — every point
// kept, repetition written once, the reader's own words left alone. The plain
// merge joins the notes' text with blank lines; this writes the note that
// takes their place. A failed call returns null and the route joins instead:
// a merge never loses the reader's words.
const MERGE_CHARS = 20_000;
const MERGE_MAX_OUTPUT_TOKENS = 32768;

const mergeSchema = z.object({ note: z.string().min(1) });

export async function mergeNoteText(
  notes: { id: string; content: string }[],
  userId: string | null,
  lang: Lang,
): Promise<string | null> {
  if (!kimiConfigured()) return null;
  const listed = notes
    .map((n) => ({ id: n.id, text: n.content.trim().slice(0, MERGE_CHARS) }))
    .filter((n) => n.text !== "");
  if (listed.length < 2) return null;
  const result = await callForJson({
    model: await kimi(MERGE_MODEL),
    messages: [{ role: "user", content: mergePrompt({ lang, notes: listed }) }],
    maxOutputTokens: MERGE_MAX_OUTPUT_TOKENS,
    providerOptions: kimiOptions(MERGE_EFFORT),
    schema: mergeSchema,
    label: "MERGE",
    usage: { userId, feature: "merge", model: MERGE_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.error(`[merge] ${result.error}`);
    return null;
  }
  const text = result.data.note.trim();
  return text === "" ? null : text;
}

/** The note ids of a project's hidden Annotations section, from a set of ids.
    An annotation dropped on a note is copied into it, never consumed. */
export async function annotationIdsAmong(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.note.findMany({
    where: { id: { in: ids }, section: { hidden: true } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
