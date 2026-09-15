import { z } from "zod";
import { db } from "@/lib/db";
import { MULTI_TITLE_EFFORT, MULTI_TITLE_MODEL } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { serverT } from "@/lib/i18n/server";
import { kimi, kimiConfigured, kimiOptions } from "@/lib/kimi";
import { clipWords } from "@/lib/markdown-preview";
import { MULTI_TITLE_MAX_CHARS, multiTitlePrompt } from "@/lib/prompts/multi-title";
import type { UsageMeta } from "@/lib/usage";
import { resolveModelId } from "@/lib/models";

// The title of a multi upload (SPEC.md §22): AI writes one short phrase for
// what the members are about together, from their titles and openings. With
// no model, or when the call fails or runs long, the title is the project's
// next number: "Multi upload 3". The reader renames it on the page or in
// the document list.
const OPENING_CHARS = 600;
const TITLE_TIMEOUT_MS = 20_000;

const titleSchema = z.object({ title: z.string().min(1).max(MULTI_TITLE_MAX_CHARS * 3) });

export async function multiUploadTitle(input: {
  notebookId: string;
  documentIds: string[];
  userId: string | null;
}): Promise<string> {
  const written = await writeTitle(input);
  if (written) return written;
  const t = await serverT();
  const count = await db.multiUpload.count({ where: { notebookId: input.notebookId } });
  return t("api.multiUploadN", { n: count + 1 });
}

async function writeTitle(input: {
  documentIds: string[];
  userId: string | null;
}): Promise<string | null> {
  if (!kimiConfigured()) return null;
  const documents = await db.document.findMany({
    where: { id: { in: input.documentIds } },
    select: {
      id: true,
      title: true,
      blocks: { orderBy: { order: "asc" }, take: 6, select: { text: true } },
    },
  });
  const byId = new Map(documents.map((d) => [d.id, d]));
  const members = input.documentIds
    .map((id) => byId.get(id))
    .filter((d): d is NonNullable<typeof d> => d !== undefined)
    .map((d) => ({
      title: d.title,
      opening: d.blocks
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, OPENING_CHARS),
    }));
  if (members.length < 2) return null;
  const result = await callForJson({
    model: await kimi(MULTI_TITLE_MODEL),
    messages: [{ role: "user", content: multiTitlePrompt({ members }) }],
    maxOutputTokens: 16384,
    providerOptions: kimiOptions(MULTI_TITLE_EFFORT),
    schema: titleSchema,
    label: "MULTI_TITLE",
    usage: { userId: input.userId, feature: "multi-title", model: await resolveModelId(MULTI_TITLE_MODEL) } satisfies UsageMeta,
    abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
  });
  if (!result.ok) {
    console.error(`[multi title] ${result.error}`);
    return null;
  }
  const text = clipWords(
    result.data.title.replace(/^["'“”‘’]+|["'“”‘’.。]+$/g, "").trim(),
    MULTI_TITLE_MAX_CHARS,
  );
  return text || null;
}
