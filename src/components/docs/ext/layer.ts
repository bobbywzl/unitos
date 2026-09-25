import type { AnyExtension } from "@tiptap/core";
import { AnnotationMarks } from "@/components/docs/annotation-marks";

// The page editor's layer extensions (SPEC.md §29): the Unitos layer's
// marks, painted as decorations over the text.
export const layerExtensions: AnyExtension[] = [AnnotationMarks];
