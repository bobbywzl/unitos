import { z } from "zod";
import { db } from "@/lib/db";
import { GIST_EFFORT } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { HABIT_MAX, HABIT_MIN_READ, type Habit } from "@/lib/assistant/habits";
import { HABIT_MAX_CHARS, habitsPrompt } from "@/lib/prompts/habits";
import type { UsageMeta } from "@/lib/usage";

// The asks under "You often ask" (SPEC.md §7), written by the assistant from
// how the reader asks: one small model call, the model the gists use. Null
// when no model is set, the reader has asked too little to read a habit
// from, or the call fails — the caller then falls back to the kinds
// (lib/assistant/habits.ts).

const habitsSchema = z.object({
  habits: z
    .array(z.object({ kind: z.string().min(1).max(60), ask: z.string().min(1).max(HABIT_MAX_CHARS * 4) }))
    .max(8),
});

// A project with many documents names its first few in the prompt.
const TITLES_MAX = 12;

export async function writeHabits(input: {
  notebookId: string;
  documentId: string | null;
  here: string[];
  elsewhere: string[];
  language: string;
  userId: string;
}): Promise<Habit[] | null> {
  if (input.here.length + input.elsewhere.length < HABIT_MIN_READ) return null;
  if (!(await featureConfigured("gist"))) return null;
  const notebook = await db.notebook.findUnique({
    where: { id: input.notebookId },
    select: {
      title: true,
      documents: { select: { document: { select: { id: true, title: true } } }, take: 60 },
    },
  });
  if (!notebook) return null;
  const titles = notebook.documents.map((d) => d.document);
  const open = titles.find((d) => d.id === input.documentId)?.title ?? null;
  const call = await featureCall("gist", GIST_EFFORT);
  const result = await callForJson({
    model: call.model,
    messages: [
      {
        role: "user",
        content: habitsPrompt({
          project: notebook.title,
          document: open,
          documents: titles
            .filter((d) => d.id !== input.documentId)
            .map((d) => d.title)
            .slice(0, TITLES_MAX),
          asksHere: input.here,
          asksElsewhere: input.elsewhere,
          language: input.language,
        }),
      },
    ],
    maxOutputTokens: 4096,
    providerOptions: call.providerOptions,
    schema: habitsSchema,
    label: "HABITS",
    usage: { userId: input.userId, feature: "habits", model: call.modelId } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.error(`[habits] ${result.error}`);
    return null;
  }
  const habits: Habit[] = [];
  const seen = new Set<string>();
  for (const { kind, ask } of result.data.habits) {
    const text = ask
      .replace(/\s+/g, " ")
      .replace(/^["'“”‘’]+|["'“”‘’.。]+$/g, "")
      .trim();
    const key = text.toLowerCase();
    // A line too long for its row is cut by the row; one far past the limit
    // is no button.
    if (!text || text.length > HABIT_MAX_CHARS * 2 || seen.has(key)) continue;
    seen.add(key);
    habits.push({ kind: kind.trim().toLowerCase(), text, count: 0 });
    if (habits.length === HABIT_MAX) break;
  }
  return habits;
}
