import type { TKey } from "@/lib/i18n/dictionaries";
import type { AnnotationItem } from "@/lib/types";

/** What an annotation is, read from its note: the tool that wrote it, else
    a highlight when it carries a color, else a comment (SPEC.md §6). */
export function annotationKind(note: {
  derivationType: string | null;
  color: string | null;
}): AnnotationItem["kind"] {
  switch (note.derivationType) {
    case "EXPLAIN":
      return "explain";
    case "SIMPLIFY":
      return "simplify";
    case "ANALYZE":
      return "analyze";
    case "VISUALIZE":
      return "visualize";
    case "SYNTHESIS":
      return "assistant";
    default:
      return note.color ? "highlight" : "comment";
  }
}

/** The name of each kind of annotation: the card's title in the reader, the
    annotation beside a note on the notes full page, and the row an
    annotation lands as in a note (lib/annotation-reference.ts). */
export const ANNOTATION_KIND_KEY: Record<AnnotationItem["kind"], TKey> = {
  explain: "reader.explanation",
  simplify: "reader.simplified",
  analyze: "reader.analysis",
  visualize: "reader.visualization",
  assistant: "reader.assistant",
  highlight: "reader.highlight",
  comment: "reader.comment",
};
