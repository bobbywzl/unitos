import { annotationReferenceMarkdown, type AnnotationReference } from "@/lib/annotation-reference";
import type { TFunc } from "@/lib/i18n/dictionaries";

// An annotation dropped on a note (SPEC.md §6): the reference's markdown.
// An annotation that holds a conversation — Explain+, Simplify+, Analyze+,
// Visualize+, the assistant's card — brings the conversation's log with it
// (SPEC.md §21, `POST /api/notes/[noteId]/log`: the stored log when it is
// current, else written now), one line per message under the row. A log
// that cannot be fetched lands the row alone.
export async function referenceMarkdownForDrop(notebookId: string, ref: AnnotationReference, t: TFunc): Promise<string> {
  const labels = { user: t("outline.referenceYou"), assistant: t("outline.referenceAssistant") };
  if (!ref.turns || ref.log) return annotationReferenceMarkdown(notebookId, ref, labels);
  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(ref.annotationId)}/log`, { method: "POST" });
    const json = (await res.json().catch(() => null)) as {
      log?: { lines?: { role: "user" | "assistant"; text: string }[] } | null;
    } | null;
    const lines = json?.log?.lines ?? [];
    return annotationReferenceMarkdown(notebookId, { ...ref, log: lines }, labels);
  } catch {
    return annotationReferenceMarkdown(notebookId, ref, labels);
  }
}
