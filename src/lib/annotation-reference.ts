import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import type { AnnotationItem } from "@/lib/types";
import type { ChatTurn } from "@/lib/conversation";

// An annotation reference (SPEC.md §6): a line in a note that points to an
// annotation — an explanation, a simplification, an analysis, a
// visualization, the assistant's conversation, a comment, a highlight. An
// annotation dragged onto a note lands as one. The reference is a markdown
// link to the reader, so every renderer keeps it: the note's own markdown
// draws it as a row (components/markdown.tsx), a click opens the reader on
// the annotation, and on the notes full page the annotation opens beside the
// note (components/outline/annotation-side.tsx). The annotation stays where
// it is, still painted in the article.

export type AnnotationReference = {
  /** The annotation's note id: annotations are notes of the hidden Annotations section. */
  annotationId: string;
  documentId: string;
  /** The annotation's anchor in that document; null for an annotation with no anchor there. */
  sourceId: string | null;
  /** The row's text: the annotation's gist, or its first words. */
  label: string;
};

/** The query parameter that names the annotation the reader opens on arrival. */
export const ANNOTATION_PARAM = "annotation";

const LABEL_MAX = 60;

/** The reference's label from an annotation's text: its first words, with
    nothing that would break a markdown link's text. */
export function referenceLabel(text: string, fallback: string): string {
  const words = clipWords(markdownPreview(text), LABEL_MAX)
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return words || fallback;
}

/** The reader's address for the annotation: the document, its anchor, and the annotation. */
export function annotationReferenceHref(notebookId: string, ref: AnnotationReference): string {
  const src = ref.sourceId ? `&src=${encodeURIComponent(ref.sourceId)}` : "";
  return `/n/${notebookId}?doc=${encodeURIComponent(ref.documentId)}${src}&${ANNOTATION_PARAM}=${encodeURIComponent(ref.annotationId)}`;
}

/** The reference as note markdown: a link on a line of its own. */
export function annotationReferenceMarkdown(notebookId: string, ref: AnnotationReference): string {
  return `[${ref.label}](${annotationReferenceHref(notebookId, ref)})`;
}

export type ParsedAnnotationReference = {
  notebookId: string;
  documentId: string;
  sourceId: string | null;
  annotationId: string;
};

/** The reference a note link carries, or null for any other link. */
export function parseAnnotationReference(href: string | undefined): ParsedAnnotationReference | null {
  if (!href) return null;
  const m = /^\/n\/([^/?#]+)\?([^#]*)$/.exec(href);
  if (!m) return null;
  const params = new URLSearchParams(m[2]);
  const annotationId = params.get(ANNOTATION_PARAM);
  const documentId = params.get("doc");
  if (!annotationId || !documentId) return null;
  return { notebookId: m[1], documentId, sourceId: params.get("src"), annotationId };
}

/** The annotation a reference points to, as GET /api/annotations/[noteId]
    answers it: what the notes full page shows beside the note. */
export type ReferencedAnnotation = {
  id: string;
  kind: AnnotationItem["kind"];
  content: string;
  gist: string | null;
  color: string | null;
  sourceId: string | null;
  quotedText: string | null;
  orphaned: boolean;
  documentId: string | null;
  documentTitle: string | null;
  conversation: ChatTurn[];
};
