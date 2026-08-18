import { anthropic } from "@ai-sdk/anthropic";
import { streamText, type ModelMessage } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { corpusContext, notebookContext } from "@/lib/assistant/context";
import {
  corpusSearch,
  embeddingsConfigured,
  ensureNoteEmbeddings,
} from "@/lib/assistant/embeddings";
import { db } from "@/lib/db";
import { DERIVATION_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { anchorContext, documentPrefix, loadProfile } from "@/lib/derive/context";
import { callForJson, modelErrorMessage } from "@/lib/derive/json-call";
import { synthesisAskPrompt, synthesisTaskPrompt } from "@/lib/prompts/synthesis";
import { parseBody } from "@/lib/validate";

export const maxDuration = 120;

// Assistant panel with a scope control (SPEC.md §7). SYNTHESIS derivations; transient output.
const assistantSchema = z.object({
  notebookId: z.string().min(1),
  scope: z.enum(["selection", "document", "notebook", "corpus"]),
  task: z.enum(["ask", "contradictions", "gaps", "unsourced"]),
  question: z.string().min(1).max(4000).optional(),
  documentId: z.string().min(1).optional(),
  anchor: z
    .object({
      blockId: z.string().min(1),
      startOffset: z.number().int().min(0),
      endOffset: z.number().int().min(0),
    })
    .optional(),
});

const issuesSchema = z.object({
  issues: z
    .array(
      z.object({
        noteIds: z.array(z.string()).max(10),
        issue: z.string().min(1).max(500),
        explanation: z.string().min(1).max(2000),
      }),
    )
    .max(30),
});

// Any unexpected throw still answers with the reason, never a bare 500.
export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (err) {
    console.error("[assistant] failed:", err);
    return NextResponse.json(
      { error: `The assistant failed. ${modelErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

async function handle(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. The assistant needs it." },
      { status: 503 },
    );
  }
  const { data, error } = await parseBody(req, assistantSchema);
  if (error) return error;

  if (data.task !== "ask" && data.scope !== "notebook") {
    return NextResponse.json({ error: "This task runs at notebook scope" }, { status: 400 });
  }
  if (data.task === "ask" && !data.question) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
  const profile = await loadProfile(data.notebookId);

  const model = anthropic(DERIVATION_MODEL.SYNTHESIS);
  const maxOutputTokens = MAX_OUTPUT_TOKENS.SYNTHESIS;

  // Build the scope context as the (cached where stable) prompt prefix.
  let system: string;
  let cache = true;
  let scopeLabel: string;
  if (data.scope === "selection" || data.scope === "document") {
    if (!data.documentId) {
      return NextResponse.json({ error: "This scope needs an open document" }, { status: 400 });
    }
    const document = await db.document.findUnique({
      where: { id: data.documentId },
      include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } },
    });
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    system = documentPrefix(document.title, document.blocks, document.references);
    if (data.scope === "selection") {
      if (!data.anchor) {
        return NextResponse.json({ error: "Selection scope needs a selection" }, { status: 400 });
      }
      const anchored = anchorContext(
        document.blocks,
        data.anchor.blockId,
        data.anchor.startOffset,
        data.anchor.endOffset,
      );
      if (!anchored) {
        return NextResponse.json({ error: "Anchor does not resolve" }, { status: 400 });
      }
      scopeLabel = `the reader's selection: "${anchored.anchoredText.slice(0, 500)}" with the document for context`;
    } else {
      scopeLabel = `the document "${document.title}"`;
    }
  } else if (data.scope === "notebook") {
    system = await notebookContext(data.notebookId);
    scopeLabel = "the notebook's accepted notes";
  } else {
    // With VOYAGE_API_KEY set, corpus search is semantic (embeddings);
    // without it, it falls back to Postgres full-text search.
    if (embeddingsConfigured()) await ensureNoteEmbeddings();
    const matches = await corpusSearch(data.question ?? "");
    system = corpusContext(data.question ?? "", matches);
    scopeLabel = "corpus matches across all notebooks";
    cache = false; // query-dependent prefix
  }

  const messages: ModelMessage[] = [
    {
      role: "system",
      content: system,
      ...(cache ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } } : {}),
    },
    {
      role: "user",
      content:
        data.task === "ask"
          ? synthesisAskPrompt({ profile, scopeLabel, question: data.question! })
          : synthesisTaskPrompt({ profile, task: data.task }),
    },
  ];

  if (data.task === "ask") {
    const result = streamText({
      model,
      maxOutputTokens,
      allowSystemInMessages: true,
      messages,
      onEnd: ({ usage }) => {
        console.log(
          `[assistant] ask scope=${data.scope} cacheRead=${usage.inputTokenDetails.cacheReadTokens ?? 0} ` +
            `cacheWrite=${usage.inputTokenDetails.cacheWriteTokens ?? 0} output=${usage.outputTokens ?? 0}`,
        );
      },
      onError: (err) => console.error("[assistant] stream error:", err),
    });
    return result.toTextStreamResponse();
  }

  const result = await callForJson({
    model,
    messages,
    maxOutputTokens,
    schema: issuesSchema,
    label: `assistant:${data.task}`,
  });
  if (!result.ok) {
    return NextResponse.json({ error: `Task failed. ${result.error}` }, { status: 422 });
  }
  // Keep only note ids that exist in this notebook.
  const validIds = new Set(
    (
      await db.note.findMany({
        where: { section: { notebookId: data.notebookId } },
        select: { id: true },
      })
    ).map((n) => n.id),
  );
  const issues = result.data.issues.map((issue) => ({
    ...issue,
    noteIds: issue.noteIds.filter((id) => validIds.has(id)),
  }));
  return NextResponse.json({ issues });
}
