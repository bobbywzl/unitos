import type { AnyExtension } from "@tiptap/core";
import { AnnotationMarks } from "@/components/docs/annotation-marks";
import { ReadingLayer } from "@/components/docs/layer/reading";

// The page editor's layer extensions (SPEC.md §29): the Unitos layer's
// marks, and the reading layer's key terms and translations, painted as
// decorations over the text.
export const layerExtensions: AnyExtension[] = [AnnotationMarks, ReadingLayer];
