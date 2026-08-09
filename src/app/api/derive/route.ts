import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import {
  anchorContext,
  annotationsSection,
  documentPrefix,
  loadProfile,
  sectionSkeleton,
} from "@/lib/derive/context";
import { promptTemplates } from "@/lib/prompts";
import type { PromptCtx } from "@/lib/prompts/types";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// The one derivation pipeline (SPEC.md §4). Never fork per feature.
const deriveSchema = z.object({
  type: z.enum(["EXPLAIN", "SIMPLIFY", "SALIENCE", "EXTRACT"]),
  documentId: z.string().min(1),
  notebookId: z.string().min(1),
  anchor: z
    .object({
      blockId: z.string().min(1),
      startOffset: z.number().int().min(0),
      endOffset: z.number().int().min(0),
    })
    .optional(),
  targetSectionId: z.string().min(1).nullish(),
});

const ANCHOR_REQUIRED = new Set(["EXPLAIN", "SIMPLIFY", "EXTRACT"]);

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Derivations need it." },
      { status: 503 },
    );
  }

  const { data, error } = await parseBody(req, deriveSchema);
  if (error) return error;

  const template = promptTemplates[data.type];
  if (!template) {
    return NextResponse.json({ error: `${data.type} is not built yet` }, { status: 501 });
  }
  if (ANCHOR_REQUIRED.has(data.type) && !data.anchor) {
    return NextResponse.json({ error: `${data.type} requires an anchor` }, { status: 400 });
  }

  const attachment = await db.notebookDocument.findUnique({
    where: {
      notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId },
    },
  });
  if (!attachment) {
    return NextResponse.json({ error: "Document is not attached to this notebook" }, { status: 404 });
  }

  // 1. Load document blocks (the cached prompt prefix), profile, section skeleton.
  const document = await db.document.findUnique({
    where: { id: data.documentId },
    include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } },
  });
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let anchored: ReturnType<typeof anchorContext> = null;
  if (data.anchor) {
    anchored = anchorContext(
      document.blocks,
      data.anchor.blockId,
      data.anchor.startOffset,
      data.anchor.endOffset,
    );
    if (!anchored || !anchored.anchoredText.trim()) {
      return NextResponse.json({ error: "Anchor does not resolve in this document" }, { status: 400 });
    }
  }

  const [profile, skeleton] = await Promise.all([
    loadProfile(data.notebookId),
    sectionSkeleton(data.notebookId),
  ]);

  const ctx: PromptCtx = {
    profile,
    documentTitle: document.title,
    anchoredText: anchored?.anchoredText ?? "",
    contextBefore: anchored?.contextBefore ?? "",
    contextAfter: anchored?.contextAfter ?? "",
    sectionSkeleton: skeleton,
  };

  // 2. Template by type. 3. Stream.
  const result = streamText({
    model: anthropic(DERIVATION_MODEL[data.type]),
    maxOutputTokens: MAX_OUTPUT_TOKENS[data.type],
    // System message lives in `messages` so cache_control can ride on it.
    allowSystemInMessages: true,
    messages: [
      {
        role: "system",
        content: documentPrefix(document.title, document.blocks),
        // The document is the cached prefix, reused by every derivation on it (SPEC.md §2).
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      { role: "user", content: template(ctx) },
    ],
    onEnd: async ({ text, usage }) => {
      console.log(
        `[derive] ${data.type} model=${DERIVATION_MODEL[data.type]} ` +
          `cacheRead=${usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
          `cacheWrite=${usage.inputTokenDetails.cacheWriteTokens ?? 0} ` +
          `input=${usage.inputTokens ?? 0} output=${usage.outputTokens ?? 0}`,
      );
      // 4. Destination by type.
      if (data.type === "EXPLAIN" && data.anchor && text.trim()) {
        const block = document.blocks.find((b) => b.id === data.anchor!.blockId);
        if (!block) return;
        const section = await annotationsSection(data.notebookId);
        const count = await db.note.count({ where: { sectionId: section.id } });
        await db.note.create({
          data: {
            sectionId: section.id,
            content: text,
            status: "ACCEPTED",
            derivationType: "EXPLAIN",
            order: count,
            sources: {
              create: {
                documentId: data.documentId,
                blockId: data.anchor.blockId,
                startOffset: data.anchor.startOffset,
                endOffset: data.anchor.endOffset,
                quotedText: block.text.slice(data.anchor.startOffset, data.anchor.endOffset),
                prefix: block.text.slice(
                  Math.max(0, data.anchor.startOffset - 32),
                  data.anchor.startOffset,
                ),
                suffix: block.text.slice(data.anchor.endOffset, data.anchor.endOffset + 32),
              },
            },
          },
        });
      }
    },
    onError: (err) => {
      console.error("[derive] stream error:", err);
    },
  });

  return result.toTextStreamResponse();
}
