import type { AnnotationItem } from "@/lib/types";
import { ChartIcon, CommentIcon, QuestionIcon, SparkleIcon, SummaryIcon, VisualizeIcon } from "@/components/icons";

/** Each kind's symbol (SPEC.md §6): the glyph on the toolbar button, on the
    mark in the text, on the card's header, and on the annotation reference
    row in a note. A highlight has none: its color dot is its symbol. */
export function AnnotationKindIcon({ kind, size = 12 }: { kind: AnnotationItem["kind"]; size?: number }) {
  switch (kind) {
    case "comment":
      return <CommentIcon size={size} />;
    case "explain":
      return <QuestionIcon size={size} />;
    case "simplify":
      return <SummaryIcon size={size} />;
    case "analyze":
      return <ChartIcon size={size} />;
    case "visualize":
      return <VisualizeIcon size={size} />;
    case "assistant":
      return <SparkleIcon size={size} />;
    default:
      return null;
  }
}
