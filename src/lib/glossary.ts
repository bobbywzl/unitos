import { anthropic } from "@ai-sdk/anthropic";
import type { ModelMessage } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { documentPrefix } from "@/lib/derive/context";
import { callForJson } from "@/lib/derive/json-call";
import type { UsageMeta } from "@/lib/usage";

// On-ingest glossary extraction: terms, acronyms, symbols (SPEC.md §8 Phase 7).
// Stored as Document.glossary: [{term, definition, blockIds[]}].
const GLOSSARY_MODEL = "claude-opus-5";

const glossarySchema = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().min(1).max(80),
        definition: z.string().min(1).max(500),
        blockIds: z.array(z.string()).max(50),
      }),
    )
    .max(200),
});

export type GlossaryTerm = z.infer<typeof glossarySchema>["terms"][number];

function glossaryPrompt(): string {
  return [
    "Build a glossary for this document: technical terms, acronyms, and symbols a reader",
    "may need defined.",
    "1. Only include terms the document actually uses. 5 to 60 terms for a typical document.",
    "2. definition: 1-2 sentences, grounded in how the document uses the term.",
    "3. blockIds: blocks where the term is defined or used centrally. Use ids exactly as",
    "   they appear in [block <id>] markers.",
    "",
    'Return ONLY JSON: {"terms": [{"term": "<term>", "definition": "<sentences>", "blockIds": ["<id>"]}]}',
  ].join("\n");
}

export async function buildGlossary(documentId: string, userId: string | null = null): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;
  const document = await db.document.findUnique({
    where: { id: documentId },
    include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true, startTime: true, endTime: true } } },
  });
  if (!document || document.blocks.length === 0) return 0;

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: documentPrefix(document.title, document.blocks, document.references),
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    },
    { role: "user", content: glossaryPrompt() },
  ];
  const result = await callForJson({
    model: anthropic(GLOSSARY_MODEL),
    messages,
    maxOutputTokens: 8192,
    schema: glossarySchema,
    label: "GLOSSARY",
    usage: { userId, feature: "glossary", model: GLOSSARY_MODEL } satisfies UsageMeta,
  });
  if (!result.ok) throw new Error(result.error);

  const validBlockIds = new Set(document.blocks.map((b) => b.id));
  const terms = result.data.terms.map((t) => ({
    ...t,
    blockIds: t.blockIds.filter((id) => validBlockIds.has(id)),
  }));
  await db.document.update({ where: { id: documentId }, data: { glossary: terms } });
  return terms.length;
}
