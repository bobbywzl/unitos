import { z } from "zod";
import { db } from "@/lib/db";
import { GIST_EFFORT, GIST_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { GIST_MAX_CHARS, gistPrompt } from "@/lib/prompts/gist";
import { stripSimplifyMarkers } from "@/lib/sentences";
import type { UsageMeta } from "@/lib/usage";

// The gist of a note: the phrase its collapsed row shows (SPEC.md §6). Written
// by AI for every note in the batch that has none, one model call per 25
// notes, and stored on Note.gist. A content edit clears the gist (the PATCH
// handler); the next collapsed render asks again.
const GIST_BATCH = 25;
// A long note is cut for the prompt: its gist comes from its start.
const NOTE_CHARS = 1200;

const gistSchema = z.object({
  gists: z
    .array(z.object({ id: z.string().min(1), gist: z.string().min(1).max(GIST_MAX_CHARS * 2) }))
    .max(GIST_BATCH),
});

export async function writeGists(
  noteIds: string[],
  userId: string | null,
): Promise<Record<string, string>> {
  const gists: Record<string, string> = {};
  if (!kimiConfigured()) return gists;
  const notes = await db.note.findMany({
    where: { id: { in: noteIds }, gist: null },
    select: { id: true, content: true, derivationType: true, updatedAt: true },
  });
  for (let i = 0; i < notes.length; i += GIST_BATCH) {
    const slice = notes.slice(i, i + GIST_BATCH);
    const batch = slice
      .map((n) => ({
        id: n.id,
        text: markdownPreview(
          n.derivationType === "SIMPLIFY" ? stripSimplifyMarkers(n.content) : n.content,
        ).slice(0, NOTE_CHARS),
      }))
      .filter((n) => n.text !== "");
    if (batch.length === 0) continue;
    const result = await callForJson({
      model: await kimi(GIST_MODEL),
      messages: [{ role: "user", content: gistPrompt({ notes: batch }) }],
      maxOutputTokens: 16384,
      providerOptions: kimiOptions(GIST_EFFORT),
      schema: gistSchema,
      label: "GIST",
      usage: { userId, feature: "gist", model: GIST_MODEL } satisfies UsageMeta,
    });
    if (!result.ok) {
      console.error(`[gist] ${result.error}`);
      continue;
    }
    const byId = new Map(slice.map((n) => [n.id, n]));
    for (const { id, gist } of result.data.gists) {
      const note = byId.get(id);
      const text = clipWords(gist.replace(/^["'“”‘’]+|["'“”‘’.。]+$/g, ""), GIST_MAX_CHARS);
      if (!note || text === "" || gists[id] !== undefined) continue;
      // Only a note unchanged since it was read takes the gist: an edit in
      // the meantime cleared it for a new one.
      const written = await db.note.updateMany({
        where: { id, updatedAt: note.updatedAt },
        data: { gist: text },
      });
      if (written.count > 0) gists[id] = text;
    }
  }
  return gists;
}
