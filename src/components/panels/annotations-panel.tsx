"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AnnotationItem, LinkIn, LinkOut } from "@/lib/types";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import {
  ChartIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommentIcon,
  LinkIcon,
  LocateIcon,
  QuestionIcon,
  SparkleIcon,
  SummaryIcon,
} from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { markdownPreview } from "@/lib/markdown-preview";
import { NoteId } from "@/components/outline/note-id";
import { useCollapsedView, type CollapsedViewModel } from "@/components/use-collapsed-view";
import { stripSimplifyMarkers } from "@/lib/sentences";

const label = "text-[11px] font-bold tracking-[0.08em] uppercase text-sand-600";
const card = "rounded-2xl bg-card p-3.5 shadow-soft";
const chip =
  "rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-200";

// The annotations view persists per browser and per project, like the notes view.
const ANNOTATIONS_VIEW_STORE = "unitos-annotations-view";

function ColorDot({ color }: { color: string | null }) {
  if (color === "gold" || color === "plum") {
    return (
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: color === "gold" ? "#d9a54a" : "#a78bfa" }}
      />
    );
  }
  const bg = color === "sage" ? "bg-sage-500" : "bg-clay";
  return <span className={`size-2 shrink-0 rounded-full ${bg}`} />;
}

// A group's label carries the symbol of the tool that made its cards — the
// glyph on the toolbar button and on the mark in the text — so a reader finds
// a comment or a link by the symbol they used. Highlights carry their color.
function GroupLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={`${label} flex items-center gap-1.5`}>
      {icon}
      {children}
    </span>
  );
}

// One annotation card, the note card's structure (outline/note-card.tsx): a
// header row — collapse chevron, the highlight's color, the id at the left —
// then the body. Collapsed, the header row is the whole card: the id and one
// line summarizing the content. A jump to the annotation from its mark in the
// text (dissect:open-annotation) opens a collapsed card first.
function AnnotationCard({
  annotation,
  view,
  summary,
  children,
}: {
  annotation: AnnotationItem;
  view: CollapsedViewModel;
  summary: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const collapsed = view.isCollapsed(annotation.id);
  const collapseLabel = collapsed ? t("outline.expandNote") : t("outline.collapseNote");
  const { sourceId } = annotation;
  const toggle = view.toggle;
  useEffect(() => {
    if (!collapsed || !sourceId) return;
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ sourceId: string }>).detail.sourceId === sourceId) toggle(annotation.id);
    };
    window.addEventListener("dissect:open-annotation", onOpen);
    return () => window.removeEventListener("dissect:open-annotation", onOpen);
  }, [collapsed, sourceId, annotation.id, toggle]);

  return (
    <div data-annotation-source-id={sourceId ?? undefined} className={card}>
      <div className="flex min-h-[18px] items-center gap-1.5">
        <button
          onClick={() => toggle(annotation.id)}
          data-track="annotation-collapse"
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          title={collapseLabel}
          className="-ml-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-sand-400 hover:bg-clay-100 hover:text-clay-800"
        >
          {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
        </button>
        {annotation.kind === "highlight" && <ColorDot color={annotation.color} />}
        <NoteId id={annotation.id} />
        {collapsed && (
          <button
            onClick={() => toggle(annotation.id)}
            data-track="annotation-collapse"
            title={t("outline.expandNote")}
            className="min-w-0 flex-1 truncate text-left text-[13px] leading-[18px] text-sand-800 hover:text-clay-800"
          >
            {summary}
          </button>
        )}
        {collapsed && annotation.figureLabel && (
          <span className="shrink-0 rounded-full bg-sand-200 px-2 text-[10.5px] font-semibold text-sand-600">
            {annotation.figureLabel}
          </span>
        )}
      </div>
      {!collapsed && <div className="mt-1">{children}</div>}
    </div>
  );
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
          data-track="annotation-jump"
          aria-label={t("panels.jumpToAnchor")}
          data-tip={t("panels.jumpToAnchor")}
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
            data-track="annotation-delete"
            data-tip={t("panels.deleteAnnotationTitle")}
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
// analyses, simplified rewrites, then accepted links, each group under its tool's symbol
// — each annotation card jumps to its anchor and deletes in place. Recommended
// links list in the graph instead.
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
  const view = useCollapsedView(`${ANNOTATIONS_VIEW_STORE}:${notebookId}`);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const highlights = annotations.filter((a) => a.kind === "highlight");
  // Recommended links list in the graph (SPEC.md §13); only accepted ones here.
  const acceptedOut = linksOut.filter((l) => !l.recommended);
  const acceptedIn = linksIn.filter((l) => !l.recommended);
  const comments = annotations.filter((a) => a.kind === "comment");
  const explanations = annotations.filter((a) => a.kind === "explain");
  const analyses = annotations.filter((a) => a.kind === "analyze");
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

  if (annotations.length === 0 && acceptedOut.length === 0 && acceptedIn.length === 0) {
    return <p className="text-[13px] text-sand-600">{t("panels.annotationsEmpty")}</p>;
  }

  // The same actions under every annotation body.
  const actionsFor = (a: AnnotationItem) => (
    <AnnotationActions
      annotation={a}
      notebookId={notebookId}
      documentId={documentId}
      onDelete={deleteAnnotation}
    />
  );

  return (
    <div className="flex flex-col gap-3.5">
      {errorText && <p className="text-[13px] text-red-600">{errorText}</p>}
      {annotations.length > 0 && (
        <div className="flex justify-end">
          <CollapsedViewToggle view={view.view} onChange={view.setView} track="annotations-view" />
        </div>
      )}
      {highlights.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupLabel>{t("panels.highlights")}</GroupLabel>
          {highlights.map((a) => (
            <AnnotationCard key={a.id} annotation={a} view={view} summary={a.content}>
              <p className="text-[13px]">{a.content}</p>
              {a.orphaned && a.quotedText && a.quotedText !== a.content && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
                </p>
              )}
              {actionsFor(a)}
            </AnnotationCard>
          ))}
        </div>
      )}

      {comments.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<CommentIcon size={12} />}>{t("panels.comments")}</GroupLabel>
          {comments.map((a) => (
            <AnnotationCard key={a.id} annotation={a} view={view} summary={markdownPreview(a.content)}>
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {a.quotedText}
                </p>
              )}
              {actionsFor(a)}
            </AnnotationCard>
          ))}
        </div>
      )}

      {explanations.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<QuestionIcon size={12} />}>{t("panels.explanations")}</GroupLabel>
          {explanations.map((a) => (
            <AnnotationCard key={a.id} annotation={a} view={view} summary={markdownPreview(a.content)}>
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.orphaned && a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
                </p>
              )}
              {actionsFor(a)}
            </AnnotationCard>
          ))}
        </div>
      )}

      {analyses.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<ChartIcon size={12} />}>{t("panels.analyses")}</GroupLabel>
          {analyses.map((a) => (
            <AnnotationCard key={a.id} annotation={a} view={view} summary={markdownPreview(a.content)}>
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.orphaned && a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
                </p>
              )}
              {actionsFor(a)}
            </AnnotationCard>
          ))}
        </div>
      )}

      {conversations.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<SparkleIcon size={12} />}>{t("panels.assistant")}</GroupLabel>
          {conversations.map((a) => (
            <AnnotationCard key={a.id} annotation={a} view={view} summary={markdownPreview(a.content)}>
              {/* The whole conversation, nothing to scroll inside the card. */}
              <div className="text-[13px]">
                <Markdown>{a.content}</Markdown>
              </div>
              {a.orphaned && a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
                  {t("panels.wasAnchoredTo", { text: a.quotedText })}
                </p>
              )}
              {actionsFor(a)}
            </AnnotationCard>
          ))}
        </div>
      )}

      {simplifications.length > 0 && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<SummaryIcon size={12} />}>{t("panels.simplified")}</GroupLabel>
          {simplifications.map((a) => (
            <AnnotationCard
              key={a.id}
              annotation={a}
              view={view}
              summary={markdownPreview(stripSimplifyMarkers(a.content))}
            >
              <div className="text-[13px]">
                <Markdown>{stripSimplifyMarkers(a.content)}</Markdown>
              </div>
              {a.quotedText && (
                <p className="mt-2 line-clamp-2 border-l-2 border-sage-300 pl-2 text-xs text-sand-500">
                  {a.quotedText}
                </p>
              )}
              {actionsFor(a)}
            </AnnotationCard>
          ))}
        </div>
      )}

      {(acceptedOut.length > 0 || acceptedIn.length > 0) && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<LinkIcon size={12} />}>{t("panels.links")}</GroupLabel>
          {acceptedOut.map((l) => (
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
                <AuthorChip createdById={l.createdById} nameless />
                {canEdit && (
                  <button
                    onClick={() => void removeLink(l.id)}
                    data-track="link-remove"
                    data-tip={t("panels.removeLinkTitle")}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
              <ReplyThread target={{ docLinkId: l.id }} replies={l.replies} />
            </div>
          ))}
          {acceptedIn.map((l) => (
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
                <AuthorChip createdById={l.createdById} nameless />
                {canEdit && (
                  <button
                    onClick={() => void removeLink(l.id)}
                    data-track="link-remove"
                    data-tip={t("panels.removeLinkTitle")}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t("common.remove")}
                  </button>
                )}
              </div>
              <ReplyThread target={{ docLinkId: l.id }} replies={l.replies} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
