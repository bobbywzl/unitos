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

/** The kind color's CSS variable (globals.css): one color per kind of
    annotation, the same everywhere. A highlight carries its own hue. */
export const ANNOTATION_KIND_VAR: Record<Exclude<AnnotationItem["kind"], "highlight">, string> = {
  comment: "var(--kind-comment)",
  explain: "var(--kind-explain)",
  simplify: "var(--kind-simplify)",
  analyze: "var(--kind-analyze)",
  visualize: "var(--kind-visualize)",
  assistant: "var(--kind-assistant)",
};

/** A link's color, beside the kinds: the chain in slate. */
export const LINK_KIND_VAR = "var(--kind-link)";

const HUE_VAR: Record<string, string> = {
  clay: "var(--clay-400)",
  sage: "var(--sage-500)",
  gold: "#d9a54a",
  plum: "#a78bfa",
};

/** The color an annotation carries (SPEC.md §6): its kind's, or, for a
    highlight, its hue's. As a CSS color value, for a style. */
export function annotationKindColor(kind: AnnotationItem["kind"], color: string | null): string {
  if (kind === "highlight") return HUE_VAR[color ?? "clay"] ?? HUE_VAR.clay;
  return ANNOTATION_KIND_VAR[kind];
}
