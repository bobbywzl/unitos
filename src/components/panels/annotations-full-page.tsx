"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnnotationItem, SectionView } from "@/lib/types";
import { api } from "@/lib/api";
import { TOOL_KINDS, type ToolKind } from "@/lib/conversation";
import { stripSimplifyMarkers } from "@/lib/sentences";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { FilmIcon, PageIcon, SparkleIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { AnnotationMenu } from "@/components/panels/annotation-menu";
import {
  ANNOTATIONS_VIEW_STORE,
  AnnotationActions,
  AnnotationBody,
  AnnotationCard,
  annotationSummary,
  CONVERSATION_TITLE,
  hasConversation,
} from "@/components/panels/annotation-card";
import { ToolSymbol } from "@/components/reader/block-view";
import { ConversationView } from "@/components/reader/conversation-view";
import { useCollapsedView } from "@/components/use-collapsed-view";

// The annotations full page (SPEC.md §6): every annotation of the project,
// grouped by the document it is anchored in — an article, a video, an audio
// document — in attach order, then Project for the sidebar assistant's
// conversations, anchored nowhere. Within a document the cards stand in
// reading order. The cards are the Annotations tab's (annotation-card.tsx):
// the kind named in the header with its symbol, the kind color on the
// border, the same three-dots menu, Expand all and Collapse all shared with
// the tab. A document's title opens it in the reader.

export type AnnotationGroup = {
  /** The document the annotations are anchored in; null for the project's
      group: the sidebar assistant's conversations. */
  documentId: string | null;
  title: string;
  /** A video or audio document: its annotations are anchored in time. */
  media: boolean;
  items: AnnotationItem[];
};

export function AnnotationsFullPage({
  notebookId,
  groups,
  sections,
}: {
  notebookId: string;
  groups: AnnotationGroup[];
  /** The project's sections with their notes: where an annotation can go (annotation-menu.tsx). */
  sections: SectionView[];
}) {
  const router = useRouter();
  const t = useT();
  const view = useCollapsedView(`${ANNOTATIONS_VIEW_STORE}:${notebookId}`);
  const [errorText, setErrorText] = useState<string | null>(null);
  // The annotation read as a full conversation over the page (SPEC.md §21).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const all = groups.flatMap((g) => g.items);

  async function deleteAnnotation(id: string) {
    setErrorText(null);
    try {
      await api(`/api/notes/${id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  const expanded = all.find((a) => a.id === expandedId && hasConversation(a)) ?? null;
  const expandedTool =
    expanded && (TOOL_KINDS as readonly string[]).includes(expanded.kind) ? (expanded.kind as ToolKind) : null;

  return (
    <div className="flex flex-col">
      {expanded && (
        <div className="fixed inset-0 z-50">
          <ConversationView
            title={t(CONVERSATION_TITLE[expanded.kind] ?? "panels.conversation")}
            icon={expandedTool ? <ToolSymbol tool={expandedTool} plus size={12} /> : <SparkleIcon size={12} />}
            output={
              expandedTool
                ? expandedTool === "simplify"
                  ? stripSimplifyMarkers(expanded.content)
                  : expanded.content
                : null
            }
            messages={expanded.conversation}
            onClose={() => setExpandedId(null)}
          />
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-baseline gap-3.5">
        <h1 className="text-[38px]">{t("panels.annotationsPageTitle")}</h1>
        <span className="text-[13px] text-sand-600">{all.length || ""}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        {all.length > 0 && <CollapsedViewToggle view={view.view} onChange={view.setView} track="annotations-view" />}
      </div>
      {errorText && <p className="mt-3 text-[13px] text-red-600">{errorText}</p>}

      <div className="flex flex-col gap-[30px] pt-[22px]">
        {groups.map((group) => (
          <section key={group.documentId ?? "project"} className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2.5">
              <span className="self-center text-sand-500">
                {group.documentId === null ? <SparkleIcon size={15} /> : group.media ? <FilmIcon size={15} /> : <PageIcon size={15} />}
              </span>
              {group.documentId ? (
                <Link
                  href={`/n/${notebookId}?doc=${group.documentId}`}
                  data-track="annotations-open-document"
                  data-tip={t("panels.openDocumentTitle")}
                  className="font-display text-[22px] hover:text-clay-800"
                >
                  {group.title}
                </Link>
              ) : (
                <span className="font-display text-[22px]" data-tip={t("panels.projectGroupHint")}>
                  {group.title}
                </span>
              )}
              <span className="text-[13px] text-sand-600">{group.items.length}</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {group.items.map((a) => (
                <AnnotationCard
                  key={a.id}
                  annotation={a}
                  documentId={group.documentId}
                  view={view}
                  summary={annotationSummary(a)}
                  showKind
                  menu={
                    <AnnotationMenu
                      annotation={a}
                      notebookId={notebookId}
                      documentId={group.documentId}
                      sections={sections}
                      onDelete={deleteAnnotation}
                    />
                  }
                >
                  <AnnotationBody annotation={a} />
                  <AnnotationActions
                    annotation={a}
                    notebookId={notebookId}
                    documentId={group.documentId}
                    onDelete={deleteAnnotation}
                    onExpand={setExpandedId}
                  />
                </AnnotationCard>
              ))}
            </div>
          </section>
        ))}
        {all.length === 0 && <p className="text-sm text-sand-600">{t("panels.annotationsPageEmpty")}</p>}
      </div>
    </div>
  );
}
