import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled } from "@/lib/auth";
import { bumpNotebook, notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { ownTrace } from "@/lib/documents/orphans";
import { serverT } from "@/lib/i18n/server";
import { attachDocument } from "@/lib/parse/attach";
import { parseBody } from "@/lib/validate";

const attachSchema = z.object({
  documentId: z.string().min(1),
  // The folder of the project the new document lands in (SPEC.md §6).
  folderId: z.string().min(1).nullable().optional(),
});

// Attach an existing document. No re-parse. Every add is its own document
// (SPEC.md §15), so an attach takes only:
// - a document from the Library: in no project, with the caller's trace
//   (lib/documents/orphans.ts; sign-in off, any document in no project);
// - Add back: a document this project held before, by its DOCUMENT_DETACH
//   event (History, the missing-document notice).
// A document in another project answers 409: adding the file or the link
// again makes a separate document. Any other answers 403. A document this
// project holds already attaches as it is (nothing changes).
export async function POST(req: Request, ctx: { params: Promise<{ notebookId: string }> }) {
  const t = await serverT();
  const { notebookId } = await ctx.params;
  const access = await notebookAccess(notebookId, "editor");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, attachSchema);
  if (error) return error;

  const notebook = await db.notebook.findUnique({ where: { id: notebookId } });
  if (!notebook) return NextResponse.json({ error: t("api.corpusNotFound") }, { status: 404 });
  const document = await db.document.findUnique({
    where: { id: data.documentId },
    select: { id: true, notebooks: { select: { notebookId: true } } },
  });
  if (!document) return NextResponse.json({ error: t("api.documentNotFound") }, { status: 404 });
  const here = document.notebooks.some((n) => n.notebookId === notebookId);
  if (!here) {
    const [library, heldBefore] = await Promise.all([
      document.notebooks.length === 0
        ? db.document.count({
            where: { id: document.id, ...(authEnabled() ? ownTrace(access.user.id) : { notebooks: { none: {} } }) },
          })
        : 0,
      db.notebookEvent.count({
        where: { notebookId, kind: "DOCUMENT_DETACH", meta: { path: ["documentId"], equals: document.id } },
      }),
    ]);
    if (library === 0 && heldBefore === 0) {
      return NextResponse.json(
        { error: t("api.attachNotInLibrary") },
        { status: document.notebooks.length > 0 ? 409 : 403 },
      );
    }
  }

  await attachDocument(notebookId, data.documentId, data.folderId);
  await bumpNotebook(notebookId);
  return NextResponse.json({ ok: true }, { status: 201 });
}
