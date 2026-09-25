import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { emptyRichText, newBlockId } from "@/lib/docs/schema";
import { serverT } from "@/lib/i18n/server";
import { attachDocument } from "@/lib/parse/attach";
import { PARSER_VERSION } from "@/lib/parse/types";
import { parseBody } from "@/lib/validate";

const createSchema = z.object({
  notebookId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

// A blank document (SPEC.md §15, §29): one the reader writes here. No file,
// no source, no parse: the document is rich text holding one empty
// paragraph, and its one Block row is that paragraph's index row. It opens in
// the page editor. Nothing to finish, so the response is the plain id and
// title, not an ingest stream.
export async function POST(req: Request) {
  const t = await serverT();
  const { data, error } = await parseBody(req, createSchema);
  if (error) return error;
  const notebook = await db.notebook.findUnique({ where: { id: data.notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const access = await notebookAccess(data.notebookId, "editor");
  if (access instanceof NextResponse) return access;

  const blockId = newBlockId();
  const document = await db.document.create({
    data: {
      title: data.title,
      parserVersion: PARSER_VERSION,
      richText: emptyRichText(blockId) as unknown as Prisma.InputJsonValue,
      blocks: {
        create: [{ id: blockId, order: 0, type: "PARAGRAPH", text: "", originalText: "" }],
      },
    },
    select: { id: true, title: true },
  });
  await attachDocument(data.notebookId, document.id);
  await bumpNotebook(data.notebookId);
  return NextResponse.json({ id: document.id, title: document.title });
}
