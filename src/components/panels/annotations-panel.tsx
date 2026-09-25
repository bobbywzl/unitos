"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AnnotationItem, LinkIn, LinkOut, SectionView } from "@/lib/types";
import { api } from "@/lib/api";
import { LINK_KIND_VAR } from "@/lib/annotations/kind";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { LinkIcon, MaximizeIcon, SparkleIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { NEW_GLOW_CLASS, NewPill, useNewFeature } from "@/components/new-feature";
import type { TKey } from "@/lib/i18n/dictionaries";
import { TOOL_KINDS, type ToolKind } from "@/lib/conversation";
import { ToolSymbol } from "@/components/reader/block-view";
import { ConversationView } from "@/components/reader/conversation-view";
import { AnnotationMenu } from "@/components/panels/annotation-menu";
import {
  ANNOTATIONS_VIEW_STORE,
  AnnotationActions,
  AnnotationBody,
  AnnotationCard,
  AnnotationKindIcon,
  annotationSummary,
  CONVERSATION_TITLE,
  GroupLabel,
  hasConversation,
} from "@/components/panels/annotation-card";
import { useCollapsedView } from "@/components/use-collapsed-view";
import { inLayer, LayerSwitch, useAnnotationLayer } from "@/components/panels/layer-switch";
import { stripSimplifyMarkers } from "@/lib/sentences";

// A link's card carries the link kind color (lib/annotations/kind.ts).
const card = "rounded-2xl border bg-card p-3.5 shadow-soft";
const chip =
  "rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-200";

// What a link is about, under its quotes: the stored text with Edit, or a
// Describe button that opens the box. Save stores it on the link.
function LinkAbout({
  linkId,
  reason,
  busy,
  onSave,
}: {
  linkId: string;
  reason: string | null;
  busy: boolean;
  onSave: (id: string, reason: string) => Promise<void>;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(reason ?? "");
  // The stored text changed under the box (a refresh): the box follows.
  const [prevReason, setPrevReason] = useState(reason);
  if (prevReason !== reason) {
    setPrevReason(reason);
    setDraft(reason ?? "");
    setEditing(false);
  }

  async function save() {
    await onSave(linkId, draft.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={t("panels.linkAboutPlaceholder")}
          rows={2}
          className="field-sizing-content w-full resize-none rounded-xl bg-sand-100 px-2.5 py-2 text-[13px] outline-none placeholder:text-sand-500"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setEditing(false)}
            data-track="link-about-cancel"
            className="rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void save()}
            data-track="link-about-save"
            disabled={busy || draft.trim() === (reason ?? "")}
            className="rounded-full bg-clay px-3 py-1 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    );
  }
  if (reason) {
    return (
      <p className="mt-2 flex items-start gap-2 text-[13px] text-sand-800">
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{reason}</span>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            data-track="link-about-edit"
            data-tip={t("panels.editLinkAboutTitle")}
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.edit")}
          </button>
        )}
      </p>
    );
  }
  if (!canEdit) return null;
  return (
    <button
      onClick={() => setEditing(true)}
      data-track="link-about-describe"
      data-tip={t("panels.describeLinkTitle")}
      className="mt-2 rounded-full px-2 py-0.5 text-[11px] font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
    >
      {t("panels.describeLink")}
    </button>
  );
}

// Annotations tab of the reader side panel. Highlights, comments, explanations,
// analyses, visualizations, simplified rewrites, then accepted links, each group under its tool's symbol
// — each annotation card jumps to its anchor and deletes in place. Recommended
// links list in the graph instead. The whole text and the collapsed view keep
// their own annotations (SPEC.md §28): the switch lists one or the other, and
// follows the article's view.
export function AnnotationsPanel({
  notebookId,
  documentId,
  annotations: every,
  linksOut,
  linksIn,
  sections,
}: {
  notebookId: string;
  documentId: string | null;
  annotations: AnnotationItem[];
  linksOut: LinkOut[];
  linksIn: LinkIn[];
  /** The project's sections with their notes: where an annotation can go (annotation-menu.tsx). */
  sections: SectionView[];
}) {
  const router = useRouter();
  const t = useT();
  const { canEdit } = useCollab();
  const view = useCollapsedView(`${ANNOTATIONS_VIEW_STORE}:${notebookId}`);
  // The New glow (SPEC.md §18) on the four arrows until they are pressed.
  const fullPageNew = useNewFeature("annotationsFullPage");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  // The annotation read as a full conversation over the page (SPEC.md §21).
  // The id, not the annotation: a refresh replaces the list.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [layer, setLayer] = useAnnotationLayer(documentId);
  const counts = {
    whole: every.filter((a) => inLayer(a, "whole")).length,
    core: every.filter((a) => inLayer(a, "core")).length,
  };
  const annotations = every.filter((a) => inLayer(a, layer));
  const highlights = annotations.filter((a) => a.kind === "highlight");
  // Recommended links list in the graph (SPEC.md §13); only accepted ones
  // here, with the whole text's annotations: a link joins the texts.
  const acceptedOut = layer === "whole" ? linksOut.filter((l) => !l.recommended) : [];
  const acceptedIn = layer === "whole" ? linksIn.filter((l) => !l.recommended) : [];
  const comments = annotations.filter((a) => a.kind === "comment" && !a.resolved);
  const resolved = annotations.filter((a) => a.resolved);
  const explanations = annotations.filter((a) => a.kind === "explain");
  const analyses = annotations.filter((a) => a.kind === "analyze");
  const visualizations = annotations.filter((a) => a.kind === "visualize");
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
    // The reader fades the annotation's mark at once (reader-interactions.tsx),
    // and puts it back if the delete fails.
    window.dispatchEvent(new CustomEvent("dissect:note-removed", { detail: { noteId: id } }));
    await mutate(id, async () => {
      try {
        await api(`/api/notes/${id}`, "DELETE");
      } catch (err) {
        window.dispatchEvent(new CustomEvent("dissect:note-restored", { detail: { noteId: id } }));
        throw err;
      }
    });
  }

  async function removeLink(id: string) {
    await mutate(id, () => api(`/api/links/${id}`, "DELETE"));
  }

  // What a link is about: typed after Close link, or here. Save stores it as
  // the link's reason; an empty box clears it.
  async function describeLink(id: string, reason: string) {
    await mutate(id, () => api(`/api/links/${id}`, "PATCH", { reason }));
  }

  const empty = annotations.length === 0 && acceptedOut.length === 0 && acceptedIn.length === 0;

  // The three-dots menu at the right of every card's header: New note, Add
  // to a note, Jump, Delete — in reach while the card is collapsed too.
  const menuFor = (a: AnnotationItem) => (
    <AnnotationMenu
      annotation={a}
      notebookId={notebookId}
      documentId={documentId}
      sections={sections}
      onDelete={deleteAnnotation}
    />
  );

  // The same actions under every annotation body.
  const actionsFor = (a: AnnotationItem) => (
    <AnnotationActions
      annotation={a}
      notebookId={notebookId}
      documentId={documentId}
      onDelete={deleteAnnotation}
      onExpand={setExpandedId}
    />
  );

  // Expand: the annotation's conversation read whole, over the page. A tool's
  // output is its first message; the assistant's own conversation is its turns.
  const expanded = annotations.find((a) => a.id === expandedId && hasConversation(a)) ?? null;
  const expandedTool =
    expanded && (TOOL_KINDS as readonly string[]).includes(expanded.kind)
      ? (expanded.kind as ToolKind)
      : null;
  const conversationOverlay = expanded && (
    <div className="fixed inset-0 z-50">
      <ConversationView
        title={t(CONVERSATION_TITLE[expanded.kind] ?? "panels.conversation")}
        icon={
          expandedTool ? (
            <ToolSymbol tool={expandedTool} plus size={12} />
          ) : (
            <SparkleIcon size={12} />
          )
        }
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
  );

  // The groups, one per kind, in the tab's order, each under its kind's
  // symbol; the resolved comments under Resolved (SPEC.md §29).
  const kindGroups: { kind: AnnotationItem["kind"]; labelKey: TKey; items: AnnotationItem[] }[] = [
    { kind: "highlight", labelKey: "panels.highlights", items: highlights },
    { kind: "comment", labelKey: "panels.comments", items: comments },
    { kind: "comment", labelKey: "panels.resolved", items: resolved },
    { kind: "explain", labelKey: "panels.explanations", items: explanations },
    { kind: "analyze", labelKey: "panels.analyses", items: analyses },
    { kind: "visualize", labelKey: "panels.visualizations", items: visualizations },
    { kind: "assistant", labelKey: "panels.assistant", items: conversations },
    { kind: "simplify", labelKey: "panels.simplified", items: simplifications },
  ];

  // The annotations full page, one press away (SPEC.md §6): every annotation
  // of the project, grouped by document.
  const fullPageLink = (
    <Link
      href={`/n/${notebookId}/annotations`}
      onClick={fullPageNew.seen}
      data-track="annotations-full-page"
      aria-label={t("panels.annotationsFullPage")}
      data-tip={t("panels.annotationsFullPageTitle")}
      className={`flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800${
        fullPageNew.isNew ? ` ${NEW_GLOW_CLASS}` : ""
      }`}
    >
      <MaximizeIcon size={15} />
    </Link>
  );

  return (
    <div className="flex flex-col gap-3.5">
      {conversationOverlay}
      {errorText && <p className="text-[13px] text-red-600">{errorText}</p>}
      <div className="flex items-center justify-end gap-1.5">
        {(counts.core > 0 || layer === "core") && (
          <div className="mr-auto">
            <LayerSwitch layer={layer} onChange={setLayer} counts={counts} />
          </div>
        )}
        {annotations.length > 0 && (
          <CollapsedViewToggle view={view.view} onChange={view.setView} track="annotations-view" />
        )}
        {fullPageNew.isNew && <NewPill />}
        {fullPageLink}
      </div>
      {empty && <p className="text-[13px] text-sand-600">{t("panels.annotationsEmpty")}</p>}
      {kindGroups.map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.labelKey} className="flex flex-col gap-2">
              <GroupLabel icon={<AnnotationKindIcon kind={group.kind} size={12} />}>{t(group.labelKey)}</GroupLabel>
              {group.items.map((a) => (
                <AnnotationCard
                  key={a.id}
                  documentId={documentId}
                  annotation={a}
                  view={view}
                  menu={menuFor(a)}
                  summary={annotationSummary(a)}
                >
                  <AnnotationBody annotation={a} />
                  {actionsFor(a)}
                </AnnotationCard>
              ))}
            </div>
          ),
      )}

      {(acceptedOut.length > 0 || acceptedIn.length > 0) && (
        <div className="flex flex-col gap-2">
          <GroupLabel icon={<LinkIcon size={12} />}>{t("panels.links")}</GroupLabel>
          {acceptedOut.map((l) => (
            <div key={l.id} className={card} style={{ borderColor: LINK_KIND_VAR }}>
              <p className="line-clamp-2 text-[13px]">{l.quotedText}</p>
              {l.targetQuotedText && (
                <p className="mt-1.5 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {l.targetQuotedText}
                </p>
              )}
              <LinkAbout linkId={l.id} reason={l.reason} busy={busyId === l.id} onSave={describeLink} />
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
            <div key={l.id} className={card} style={{ borderColor: LINK_KIND_VAR }}>
              <p className="line-clamp-2 text-[13px]">{l.hereQuotedText ?? l.quotedText}</p>
              {l.hereQuotedText && (
                <p className="mt-1.5 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">
                  {l.quotedText}
                </p>
              )}
              <LinkAbout linkId={l.id} reason={l.reason} busy={busyId === l.id} onSave={describeLink} />
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
