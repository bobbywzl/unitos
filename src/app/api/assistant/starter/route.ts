import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { STARTER_EFFORT, STARTER_MAX_OUTPUT_TOKENS } from "@/lib/derive/config";
import { callForJson } from "@/lib/derive/json-call";
import { featureCall, featureConfigured } from "@/lib/feature-models";
import { STARTER_MAX_CHARS, starterPrompt } from "@/lib/prompts/starter";
import type { UsageMeta } from "@/lib/usage";
import { parseBody } from "@/lib/validate";

// The starter of the assistant bar (SPEC.md §7): one short question about
// the words the bar opened on, from the cheapest model (the `starter`
// feature). The bar shows it in its empty box and Tab takes it. The route
// reads the selected words and the words around them, as the browser sends
// them, and the document's title; it writes nothing. With no key for the
// model, or an answer that does not fit, it answers no question and the box
// shows its own placeholder.
const QUOTE_CHARS = 1500;
const AROUND_CHARS = 300;

const requestSchema = z.object({
  notebookId: z.string().min(1),
  documentId: z.string().min(1),
  quote: z.string().min(1).max(20_000),
  before: z.string().max(2_000).optional(),
  after: z.string().max(2_000).optional(),
});

const answerSchema = z.object({ question: z.string().min(1).max(STARTER_MAX_CHARS * 3) });

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, requestSchema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  if (!(await featureConfigured("starter"))) return NextResponse.json({ question: null });
  const attachment = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: data.notebookId, documentId: data.documentId } },
    select: { document: { select: { title: true } } },
  });
  if (!attachment) return NextResponse.json({ question: null });
  const call = await featureCall("starter", STARTER_EFFORT);
  const result = await callForJson({
    model: call.model,
    messages: [
      {
        role: "user",
        content: starterPrompt({
          title: attachment.document.title,
          quote: data.quote.slice(0, QUOTE_CHARS),
          before: (data.before ?? "").slice(-AROUND_CHARS),
          after: (data.after ?? "").slice(0, AROUND_CHARS),
        }),
      },
    ],
    maxOutputTokens: STARTER_MAX_OUTPUT_TOKENS,
    providerOptions: call.providerOptions,
    schema: answerSchema,
    label: "STARTER",
    abortSignal: req.signal,
    usage: { userId: access.user.id || null, feature: "starter", model: call.modelId } satisfies UsageMeta,
  });
  if (!result.ok) {
    console.error(`[starter] ${result.error}`);
    return NextResponse.json({ question: null });
  }
  const question = result.data.question
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  // A question too long for the box is no starter: the box keeps its placeholder.
  return NextResponse.json({ question: question && question.length <= STARTER_MAX_CHARS ? question : null });
}
