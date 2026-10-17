import type { User } from "@prisma/client";
import { resolveAnchor } from "@/lib/anchors/resolve";
import { authEnabled } from "@/lib/auth";
import { roleOf } from "@/lib/collab";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { RichNode } from "@/lib/docs/schema";
import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { noteTitle } from "@/lib/note-title";

// Re-parse → Replace the edits on an edited import (SPEC.md §29) puts the
// import's words back. A quote on words added since the import has no words
// to stand on after it, and loses its place. The ask names those notes and
// annotations before the reader agrees. Read only: nothing here writes.

export type ReparseLoss = { id: string; name: string; annotation: boolean };

const NAME_MAX = 60;

/** The notes and annotations, in projects the account can read, whose
    quotes on this import are not in the import's own words (the version
    kept at Document.importRev). Null when the import is not edited or its
    imported text is not kept: nothing to say. */
export async function reparseLosses(documentId: string, user: User): Promise<ReparseLoss[] | null> {
  const document = await db.document.findUnique({
    where: { id: documentId },
    select: { importRev: true, richTextRev: true },
  });
  if (!document || document.importRev === null || document.richTextRev <= document.importRev) return null;
  const imported = await db.documentVersion.findUnique({
    where: { documentId_rev: { documentId, rev: document.importRev } },
    select: { richText: true },
  });
  if (!imported) return null;
  const blocks = deriveBlocks(imported.richText as unknown as RichNode).filter((b) => b.type !== "FIGURE");
  const sources = await db.source.findMany({
    where: { documentId, orphaned: false, startTime: null, layer: null },
    select: {
      blockId: true,
      startOffset: true,
      endOffset: true,
      quotedText: true,
      anchoredText: true,
      prefix: true,
      suffix: true,
      region: true,
      note: {
        select: {
          id: true,
          content: true,
          gist: true,
          createdAt: true,
          section: {
            select: {
              hidden: true,
              title: true,
              notebook: { select: { id: true, userId: true, collaborators: { select: { email: true, role: true } } } },
            },
          },
        },
      },
    },
  });
  const losing = new Map<string, ReparseLoss & { at: number }>();
  for (const s of sources) {
    // A page anchor or a drawn shape has no words to lose.
    if (s.region !== null) continue;
    const { note } = s;
    if (losing.has(note.id)) continue;
    if (authEnabled() && roleOf(note.section.notebook, user) === null) continue;
    const quote = s.anchoredText ?? s.quotedText;
    const found = resolveAnchor(blocks, {
      blockId: s.blockId,
      startOffset: s.startOffset,
      endOffset: s.endOffset,
      quotedText: quote,
      prefix: s.prefix,
      suffix: s.suffix,
    });
    if (found) continue;
    const annotation = note.section.hidden && note.section.title === ANNOTATIONS_SECTION_TITLE;
    const name =
      noteTitle(note.content) ||
      note.gist ||
      clipWords(markdownPreview(note.content), NAME_MAX) ||
      `“${clipWords(quote, NAME_MAX)}”`;
    losing.set(note.id, { id: note.id, name, annotation, at: note.createdAt.getTime() });
  }
  return [...losing.values()].sort((a, b) => a.at - b.at).map(({ id, name, annotation }) => ({ id, name, annotation }));
}
