import { db } from "@/lib/db";
import type { CorpusMatch } from "@/lib/assistant/embeddings";
import { documentReferences } from "@/lib/parse/types";

// The corpus documents never blow the context window: past the budget, the
// rest of a document is cut with a declared marker, never silently.
const CORPUS_DOCUMENT_BUDGET = 480_000; // characters across all documents

// Corpus scope: every attached document in full — block-tagged so answers can
// cite the exact place — plus all accepted notes and the section skeleton
// (SPEC.md §7). One prompt, cached until the corpus changes.
export async function notebookContext(notebookId: string): Promise<string> {
  const [sections, attachments] = await Promise.all([
    db.section.findMany({
      where: { notebookId },
      orderBy: { order: "asc" },
      include: {
        parent: { select: { title: true } },
        notes: {
          where: { status: "ACCEPTED" },
          orderBy: { order: "asc" },
          include: { sources: { include: { document: { select: { title: true } } } } },
        },
      },
    }),
    db.notebookDocument.findMany({
      where: { notebookId },
      include: {
        document: { include: { blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, text: true } } } },
      },
    }),
  ]);

  // Documents, in full, under one budget. Cut content is declared.
  let budget = CORPUS_DOCUMENT_BUDGET;
  const documents: string[] = [];
  const skipped: string[] = [];
  for (const { document } of attachments) {
    if (budget <= 0) {
      skipped.push(document.title);
      continue;
    }
    const lines: string[] = [`## Document: ${document.title}`];
    let cut = 0;
    for (const b of document.blocks) {
      const rendered = `[block ${b.id}] (${b.type})\n${b.text}`;
      if (budget - rendered.length <= 0) {
        cut++;
        continue;
      }
      budget -= rendered.length;
      lines.push(rendered);
    }
    if (cut > 0) lines.push(`[${cut} more blocks of this document were cut for length]`);
    const references = documentReferences(document.references);
    if (references.length > 0 && budget > 0) {
      const list = references.map((r) => `[${r.label}] ${r.text}${r.url ? ` — ${r.url}` : ""}`);
      lines.push("References:", ...list);
      budget -= list.join("\n").length;
    }
    documents.push(lines.join("\n\n"));
  }

  const skeleton = sections
    .filter((s) => !s.hidden)
    .map((s) => `- ${s.parent ? `${s.parent.title} / ` : ""}${s.title}`)
    .join("\n");

  const notes = sections
    .flatMap((s) =>
      s.notes.map((n) => {
        const sources =
          n.sources.length > 0
            ? n.sources.map((src) => `"${src.quotedText.slice(0, 80)}" (${src.document.title})`).join("; ")
            : "none";
        const label = s.hidden ? "Annotations" : s.title;
        return `[note ${n.id}] (section: ${label})\n${n.content}\nsources: ${sources}`;
      }),
    )
    .join("\n\n");

  return [
    "You assist a reader working through their corpus: the documents below and their notes on them.",
    "Every document block starts with its id in the form [block <id>]; every note with [note <id>].",
    "When you answer from a document, cite the block tag exactly as written ([block <id>]) and quote the exact words — precise recall over paraphrase.",
    "",
    "Documents:",
    documents.length > 0 ? documents.join("\n\n---\n\n") : "(no documents attached)",
    ...(skipped.length > 0 ? ["", `[documents cut for length: ${skipped.join("; ")}]`] : []),
    "",
    "Section skeleton:",
    skeleton || "(no sections)",
    "",
    "Notes:",
    notes || "(no accepted notes)",
  ].join("\n");
}

export function corpusContext(query: string, matches: CorpusMatch[]): string {
  const rendered = matches
    .map(
      (m) =>
        `[note ${m.id}] (corpus: ${m.notebookTitle}, section: ${m.sectionTitle}, similarity: ${m.similarity.toFixed(2)})\n${m.content}`,
    )
    .join("\n\n");
  return [
    "You assist a reader searching across all their corpora.",
    `Matches across all corpora for the query "${query}" follow, most similar first.`,
    "Each note starts with its id in the form [note <id>].",
    "",
    rendered || "(no matches)",
  ].join("\n");
}
