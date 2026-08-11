"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AnnotationItem, LinkIn, LinkOut } from "@/lib/types";
import { api } from "@/lib/api";
import { Markdown } from "@/components/markdown";

const label = "text-[11px] font-bold tracking-[0.08em] uppercase text-sand-600";
const card = "rounded-2xl bg-card p-3.5 shadow-soft";
const chip =
  "rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-200";

function ColorDot({ color }: { color: string | null }) {
  if (color === "gold") {
    return (
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: "#d9a54a" }}
      />
    );
  }
  const bg = color === "sage" ? "bg-sage-500" : "bg-clay";
  return <span className={`mt-1.5 size-2 shrink-0 rounded-full ${bg}`} />;
}

function AnnotationActions({
  annotation,
  notebookId,
  documentId,
  onDelete,
}: {
  annotation: AnnotationItem;
  notebookId: string;
  documentId: string | null;
  onDelete: (id: string) => Promise<void>;
}) {
  const canJump = Boolean(annotation.sourceId) && !annotation.orphaned && documentId !== null;
  return (
    <div className="mt-2 flex items-center gap-3">
      {canJump && (
        <Link
          href={`/n/${notebookId}?doc=${documentId}&src=${annotation.sourceId}`}
          className="text-xs text-sand-600 hover:text-clay-700"
        >
          Jump
        </Link>
      )}
      {annotation.orphaned && (
        <span className="text-[11px] font-semibold text-red-500">Anchor unresolved</span>
      )}
      <button
        onClick={() => void onDelete(annotation.id)}
        className="text-xs text-red-500 hover:text-red-700"
      >
        Delete
      </button>
    </div>
  );
}

// Annotations tab of the reader side panel. Highlights, comments, explanations,
// then links — each annotation card jumps to its anchor and deletes in place.
export function AnnotationsPanel({
  notebookId,
  documentId,
  annotations,
  linksOut,
  linksIn,
}: {
  notebookId: string;
  documentId: string | null;
  annotations: AnnotationItem[];
  linksOut: LinkOut[];
  linksIn: LinkIn[];
}) {
  const router = useRouter();
  const highlights = annotations.filter((a) => a.kind === "highlight");
  const comments = annotations.filter((a) => a.kind === "comment");
  const explanations = annotations.filter((a) => a.kind === "explain");

  async function deleteAnnotation(id: string) {
    await api(`/api/notes/${id}`, "DELETE");
    router.refresh();
  }

  async function removeLink(id: string) {
    await api(`/api/links/${id}`, "DELETE");
    router.refresh();
  }

  if (annotations.length === 0 && linksOut.length === 0 && linksIn.length === 0) {
    return (
      <p className="text-[13px] text-sand-600">
        No annotations yet. Select text in the reader to highlight, comment, or link.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {highlights.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>Highlights</span>
          {highlights.map((a) => (
            <div key={a.id} className={card}>
              <div className="flex items-start gap-2">
                <ColorDot color={a.color} />
                <p className="line-clamp-3 text-[13px]">{a.content}</p>
              </div>
              <AnnotationActions
                annotation={a}
                notebookId={notebookId}
                documentId={documentId}
                onDelete={deleteAnnotation}
              />
            </div>
          ))}
        </div>
      )}

      {comments.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>Comments</span>
          {comments.map((a) => (
            <div key={a.id} className={card}>
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {a.quotedText}
                </p>
              )}
              <AnnotationActions
                annotation={a}
                notebookId={notebookId}
                documentId={documentId}
                onDelete={deleteAnnotation}
              />
            </div>
          ))}
        </div>
      )}

      {explanations.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>Explanations</span>
          {explanations.map((a) => (
            <div key={a.id} className={card}>
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              <AnnotationActions
                annotation={a}
                notebookId={notebookId}
                documentId={documentId}
                onDelete={deleteAnnotation}
              />
            </div>
          ))}
        </div>
      )}

      {(linksOut.length > 0 || linksIn.length > 0) && (
        <div className="flex flex-col gap-2">
          <span className={label}>Links</span>
          {linksOut.map((l) => (
            <div key={l.id} className={card}>
              <p className="line-clamp-2 text-[13px]">{l.quotedText}</p>
              <div className="mt-2 flex items-center gap-3">
                <Link href={`/n/${notebookId}?doc=${l.toDocumentId}`} className={chip}>
                  → {l.toTitle}
                </Link>
                <button
                  onClick={() => void removeLink(l.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {linksIn.map((l) => (
            <div key={l.id} className={card}>
              <p className="line-clamp-2 text-[13px]">{l.quotedText}</p>
              <div className="mt-2 flex items-center">
                <Link href={`/n/${notebookId}?doc=${l.fromDocumentId}`} className={chip}>
                  ← {l.fromTitle}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
