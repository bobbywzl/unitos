import { db } from "@/lib/db";
import type { CorpusMatch } from "@/lib/assistant/embeddings";

// Notebook scope: all accepted notes (with ids) + section skeleton in one prompt (SPEC.md §7).
export async function notebookContext(notebookId: string): Promise<string> {
  const sections = await db.section.findMany({
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
  });

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
    "You assist a reader working through their notebook. Accepted notes follow.",
    "Each note starts with its id in the form [note <id>].",
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
        `[note ${m.id}] (notebook: ${m.notebookTitle}, section: ${m.sectionTitle}, similarity: ${m.similarity.toFixed(2)})\n${m.content}`,
    )
    .join("\n\n");
  return [
    "You assist a reader searching across all their notebooks.",
    `Corpus matches for the query "${query}" follow, most similar first.`,
    "Each note starts with its id in the form [note <id>].",
    "",
    rendered || "(no matches)",
  ].join("\n");
}
