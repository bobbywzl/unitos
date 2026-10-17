import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAssistantDocument } from "@/lib/assistant/document";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { modelErrorMessage } from "@/lib/derive/json-call";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// A new document of the project written by the assistant (SPEC.md §7, the
// create_document action): the plan card's Apply sends the action here once
// the reader approved it. The quotes were resolved against the open document
// by the plan (lib/assistant/plan.ts); the route checks they are its blocks.
const quoteSchema = z.object({
  documentId: z.string().min(1),
  blockId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  quotedText: z.string().min(1).max(10_000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
  line: z.number().int().min(0),
});

const schema = z.object({
  notebookId: z.string().min(1),
  fromDocumentId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  markdown: z.string().min(1).max(60_000),
  quotes: z.array(quoteSchema).max(300).optional(),
  // The reader's message, kept as the document's command (Document.generatedCommand).
  command: z.string().max(4_000).optional(),
});

export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, schema);
  if (error) return error;
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const attached = await db.notebookDocument.findUnique({
    where: { notebookId_documentId: { notebookId: data.notebookId, documentId: data.fromDocumentId } },
    select: { documentId: true },
  });
  if (!attached) return NextResponse.json({ error: t("api.documentNotAttachedToCorpus") }, { status: 404 });
  // A quote links back only to a block of the document it was written from.
  const quotes = data.quotes ?? [];
  const blocks = quotes.length
    ? await db.block.findMany({ where: { id: { in: quotes.map((q) => q.blockId) }, documentId: data.fromDocumentId }, select: { id: true, text: true } })
    : [];
  const known = new Map(blocks.map((b) => [b.id, b.text]));
  const sound = quotes.filter((q) => {
    const text = known.get(q.blockId);
    return text !== undefined && q.documentId === data.fromDocumentId && q.endOffset <= text.length && q.startOffset < q.endOffset && text.slice(q.startOffset, q.endOffset) === q.quotedText;
  });
  try {
    const made = await writeAssistantDocument({
      notebookId: data.notebookId,
      userId: access.user.id,
      fromDocumentId: data.fromDocumentId,
      command: data.command ?? "",
      title: data.title,
      markdown: data.markdown,
      quotes: sound,
    });
    return NextResponse.json(made);
  } catch (err) {
    return NextResponse.json({ error: modelErrorMessage(err) }, { status: 422 });
  }
}
