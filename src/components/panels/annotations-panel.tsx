"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnnotationItem, LinkIn, LinkOut } from "@/lib/types";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { LocateIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { stripSimplifyMarkers } from "@/lib/sentences";

const label = "text-[11px] font-bold tracking-[0.08em] uppercase text-sand-600";
const card = "rounded-2xl bg-card p-3.5 shadow-soft";
const chip =
  "rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-200";

function ColorDot({ color }: { color: string | null }) {
  if (color === "gold" || color === "plum") {
    return (
      <span
        className="mt-1.5 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color === "gold" ? "#d9a54a" : "#a78bfa" }}
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
  const router = useRouter();
  const t = useT();
  const { canEdit } = useCollab();
  const canJump = Boolean(annotation.sourceId) && !annotation.orphaned && documentId !== null;

  function jump() {
    router.push(`/n/${notebookId}?doc=${documentId}&src=${annotation.sourceId}`);
    // The ?src effect only re-runs when the param changes; the event covers a
    // second jump to the same annotation.
    window.dispatchEvent(
      new CustomEvent("dissect:flash-source", { detail: { sourceId: annotation.sourceId } }),
    );
  }

  return (
    <>
    <div className="mt-2 flex items-center gap-2">
      {canJump && (
        <button
          onClick={jump}
          aria-label={t("panels.jumpToAnchor")}
          title={t("panels.jumpToAnchor")}
          className="inline-flex items-center gap-1.5 rounded-full bg-clay-100 px-2.5 py-1 text-[11px] font-semibold text-clay-800 hover:bg-clay-200"
        >
          <LocateIcon size={11} />
          {annotation.figureLabel ?? ""}
        </button>
      )}
      {!canJump && annotation.figureLabel && (
        <span className="rounded-full bg-sand-200 px-2.5 py-1 text-[11px] font-semibold text-sand-600">
          {annotation.figureLabel}
        </span>
      )}
      {annotation.orphaned && (
        <span className="text-[11px] font-semibold text-red-500">
          {t("panels.anchorUnresolved")}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        <AuthorChip createdById={annotation.createdById} nameless />
        {canEdit && (
          <button
            onClick={() => void onDelete(annotation.id)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            {t("common.delete")}
          </button>
        )}
      </span>
    </div>
    <ReplyThread target={{ noteId: annotation.id }} replies={annotation.replies} />
    </>
  );
}

// Annotations tab of the reader side panel. Highlights, comments, explanations,
// simplified rewrites, then links — each annotation card jumps to its anchor and deletes in place.
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
  const t = useT();
  const { canEdit } = useCollab();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const highlights = annotations.filter((a) => a.kind === "highlight");
  const comments = annotations.filter((a) => a.kind === "comment");
  const explanations = annotations.filter((a) => a.kind === "explain");
  const conversations = annotations.filter((a) => a.kind === "assistant");
  const simplifications = annotations.filter((a) => a.kind === "simplify");

  async function mutate(id: string, run: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(id);
    setErrorText(null);
    try {
      await run();
      router.refresh();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAnnotation(id: string) {
    await mutate(id, () => api(`/api/notes/${id}`, "DELETE"));
  }

  async function removeLink(id: string) {
    await mutate(id, () => api(`/api/links/${id}`, "DELETE"));
  }

  if (annotations.length === 0 && linksOut.length === 0 && linksIn.length === 0) {
    return <p className="text-[13px] text-sand-600">{t("panels.annotationsEmpty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      {errorText && <p className="text-[13px] text-red-600">{errorText}</p>}
      {highlights.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t("panels.highlights")}</span>
          {highlights.map((a) => (
            <div key={a.id} data-annotation-source-id={a.sourceId ?? undefined} className={card}>
              <div className="flex items-start gap-2">
                <ColorDot color={a.color} />
                <p className="line-clamp-3 text-[13px]">{a.content}</p>
              </div>
              {a.orphaned && a.quotedText && a.quotedText !== a.content && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
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

      {comments.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t("panels.comments")}</span>
          {comments.map((a) => (
            <div key={a.id} data-annotation-source-id={a.sourceId ?? undefined} className={card}>
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
          <span className={label}>{t("panels.explanations")}</span>
          {explanations.map((a) => (
            <div key={a.id} data-annotation-source-id={a.sourceId ?? undefined} className={card}>
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.orphaned && a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
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

      {conversations.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t("panels.assistant")}</span>
          {conversations.map((a) => (
            <div key={a.id} data-annotation-source-id={a.sourceId ?? undefined} className={card}>
              <div className="max-h-56 overflow-y-auto text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.orphaned && a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
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

      {simplifications.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t("panels.simplified")}</span>
          {simplifications.map((a) => (
            <div key={a.id} data-annotation-source-id={a.sourceId ?? undefined} className={card}>
              <div className="text-[13px]">
                <Markdown>{stripSimplifyMarkers(a.content)}</Markdown>
              </div>
              {a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-sage-300 pl-2 text-xs text-sand-500">
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

      {(linksOut.length > 0 || linksIn.length > 0) && (
        <div className="flex flex-col gap-2">
          <span className={label}>{t("panels.links")}</span>
          {linksOut.map((l) => (
            <div key={l.id} className={card}>
              <p className="line-clamp-2 text-[13px]">{l.quotedText}</p>
              {l.targetQuotedText && (
                <p className="mt-1.5 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {l.targetQuotedText}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {l.detached ? (
                  <span className="rounded-full bg-sand-200 px-2.5 py-0.5 text-[11px] font-semibold text-sand-600">
                    ⇄ {l.toTitle} · {t("panels.notAttached")}
                  </span>
                ) : (
                  <Link
                    href={`/n/${notebookId}?doc=${l.toDocumentId}${l.targetQuotedText ? `&link=${l.id}` : ""}`}
                    className={chip}
                  >
                    ⇄ {l.toTitle}
                  </Link>
                )}
                {l.orphaned && (
                  <span className="text-[11px] font-semibold text-red-500">
                    {t("panels.anchorUnresolved")}
                  </span>
                )}
                {l.targetOrphaned && (
                  <span className="text-[11px] font-semibold text-red-500">
                    {t("panels.otherEndUnresolved")}
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => void removeLink(l.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
            </div>
          ))}
          {linksIn.map((l) => (
            <div key={l.id} className={card}>
              <p className="line-clamp-2 text-[13px]">{l.hereQuotedText ?? l.quotedText}</p>
              {l.hereQuotedText && (
                <p className="mt-1.5 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {l.quotedText}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Link href={`/n/${notebookId}?doc=${l.fromDocumentId}&link=${l.id}`} className={chip}>
                  ⇄ {l.fromTitle}
                </Link>
                {l.orphaned && (
                  <span className="text-[11px] font-semibold text-red-500">
                    {t("panels.anchorUnresolved")}
                  </span>
                )}
                {l.fromOrphaned && (
                  <span className="text-[11px] font-semibold text-red-500">
                    {t("panels.otherEndUnresolved")}
                  </span>
                )}
                {canEdit && (
                  <button
                    onClick={() => void removeLink(l.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
