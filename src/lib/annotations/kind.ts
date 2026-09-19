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
