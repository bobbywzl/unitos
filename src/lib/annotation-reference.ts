import { clipWords, markdownPreview } from "@/lib/markdown-preview";
import { quoteMarkdown } from "@/lib/quote-drag";
import { stripSimplifyMarkers } from "@/lib/sentences";
import type { AnnotationItem } from "@/lib/types";
import type { ChatTurn } from "@/lib/conversation";

// An annotation reference (SPEC.md §6): what an annotation dragged onto a
// note lands as — an explanation, a simplification, an analysis, a
// visualization, the assistant's conversation, a comment, a highlight. The
// note gets the quote the annotation is anchored to, then a row that names
// the annotation and opens it, then the annotation's text: the comment, the
// tool's output, the picture, or the conversation's log. The row is a
// markdown link to the reader, so every renderer keeps it: the note's own
// markdown draws it as a row (components/markdown.tsx), a click opens the
// reader on the annotation, and on the notes full page the annotation opens
// beside the note (components/outline/annotation-side.tsx). The annotation
// stays where it is, still painted in the article.

export type AnnotationReference = {
  /** The annotation's note id: annotations are notes of the hidden Annotations section. */
  annotationId: string;
  documentId: string;
  /** The annotation's anchor in that document; null for an annotation with no anchor there. */
  sourceId: string | null;
  /** What the annotation is: the row names it by its kind. */
  kind: AnnotationItem["kind"];
  /** The row's text: the kind's name in the reader's language — Comment, Explanation, … */
  label: string;
  /** The annotation's first words: what the ghost shows while it drags. */
  words: string;
  /** The words the annotation is anchored to: they land above the row as a
      quote. Unset for an annotation anchored nowhere. */
  quote?: string;
  /** The annotation's text: the comment, the explanation, the analysis, the
      simplified rewrite without its markers, the note typed on a highlight.
      Unset for a highlight that carries only its quote, a visualization
      (`picture`), and a conversation (`log`). It lands under the row. */
  text?: string;
  /** A visualization: its own markdown — the picture and its caption
      (lib/derive/visualize.ts). It lands under the row, so the note shows
      the picture, not only the row that opens it. */
  picture?: string;
  /** The conversation the annotation holds (SPEC.md §21): how many turns.
      0 or absent: none. With turns, the drop fetches the conversation's
      log and lands it under the row (components/outline/reference-drop.ts). */
  turns?: number;
  /** The conversation's log, one line per message (lib/notes/conversation-log.ts),
      set at drop time: it lands under the row as a dash list. */
  log?: { role: "user" | "assistant"; text: string }[];
};

/** The log lines a reference lands: the last LOG_LINES_MAX of them. */
const LOG_LINES_MAX = 20;

/** The query parameter that names the annotation the reader opens on arrival. */
export const ANNOTATION_PARAM = "annotation";

const WORDS_MAX = 60;

/** The annotation's first words, for the ghost that follows the pointer. */
export function referenceWords(text: string, fallback: string): string {
  const words = clipWords(markdownPreview(text), WORDS_MAX)
    .replace(/\s+/g, " ")
    .trim();
  return words || fallback;
}

/** The row's text from the kind's name, with nothing that would break a markdown link's text. */
export function referenceLabel(name: string): string {
  return name.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
}

/** The reader's address for the annotation: the document, its anchor, and the annotation. */
export function annotationReferenceHref(
  notebookId: string,
  ref: Pick<AnnotationReference, "annotationId" | "documentId" | "sourceId"> & { kind?: AnnotationItem["kind"] },
): string {
  const src = ref.sourceId ? `&src=${encodeURIComponent(ref.sourceId)}` : "";
  // The kind rides along, so the row draws in the annotation's kind color
  // without a fetch (components/markdown.tsx).
  const kind = ref.kind ? `&kind=${ref.kind}` : "";
  return `/n/${notebookId}?doc=${encodeURIComponent(ref.documentId)}${src}&${ANNOTATION_PARAM}=${encodeURIComponent(ref.annotationId)}${kind}`;
}

/** The reference as note markdown, in this order: the quote the annotation
    is anchored to; the row, a link on a line of its own; then what the
    annotation holds — its text, or its picture, or its conversation's log
    as a dash list, one line per message, each opening with who said it
    (`labels`), so the note keeps the exchange and not only the door to it. */
export function annotationReferenceMarkdown(
  notebookId: string,
  ref: AnnotationReference,
  labels: { user: string; assistant: string } = { user: "You", assistant: "Assistant" },
): string {
  const parts: string[] = [];
  const quote = ref.quote?.trim();
  if (quote) parts.push(quoteMarkdown(quote));
  parts.push(`[${referenceLabel(ref.label)}](${annotationReferenceHref(notebookId, ref)})`);
  const text = ref.text?.trim();
  if (text) parts.push(text);
  const picture = ref.picture?.trim();
  if (picture) parts.push(picture);
  const lines = (ref.log ?? [])
    .slice(-LOG_LINES_MAX)
    .map((l) => `- ${l.role === "user" ? labels.user : labels.assistant}: ${l.text.replace(/\s+/g, " ").trim()}`);
  if (lines.length > 0) parts.push(lines.join("\n"));
  return parts.join("\n\n");
}

export type ParsedAnnotationReference = {
  notebookId: string;
  documentId: string;
  sourceId: string | null;
  annotationId: string;
  /** The annotation's kind, when the row carries it (a reference written since the kind colors). */
  kind: AnnotationItem["kind"] | null;
};

const KINDS = new Set<string>(["explain", "simplify", "analyze", "visualize", "highlight", "comment", "assistant"]);

/** The reference a note link carries, or null for any other link. */
export function parseAnnotationReference(href: string | undefined): ParsedAnnotationReference | null {
  if (!href) return null;
  const m = /^\/n\/([^/?#]+)\?([^#]*)$/.exec(href);
  if (!m) return null;
  const params = new URLSearchParams(m[2]);
  const annotationId = params.get(ANNOTATION_PARAM);
  const documentId = params.get("doc");
  if (!annotationId || !documentId) return null;
  const kind = params.get("kind");
  return {
    notebookId: m[1],
    documentId,
    sourceId: params.get("src"),
    annotationId,
    kind: kind && KINDS.has(kind) ? (kind as AnnotationItem["kind"]) : null,
  };
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

/** What the annotation holds, for the reference: its text, its picture, or
    the turns of its conversation. quotedText: the words it is anchored to —
    a highlight whose content is those words carries no text of its own. */
export function referenceContent(
  kind: AnnotationItem["kind"],
  content: string,
  quotedText: string | null,
  turns: number,
): Pick<AnnotationReference, "text" | "picture" | "turns"> {
  const conversation = turns > 0 ? { turns } : {};
  switch (kind) {
    case "visualize":
      return { picture: content, ...conversation };
    case "assistant":
      return conversation;
    case "simplify":
      return { text: stripSimplifyMarkers(content), ...conversation };
    case "highlight":
      return content.trim() && content.trim() !== (quotedText ?? "").trim() ? { text: content } : {};
    default:
      return { text: content, ...conversation };
  }
}
