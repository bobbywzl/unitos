"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { AnnotationItem } from "@/lib/types";
import { referenceContent } from "@/lib/annotation-reference";
import { ANNOTATION_KIND_KEY, annotationKindColor } from "@/lib/annotations/kind";
import type { TKey } from "@/lib/i18n/dictionaries";
import { markdownPreview } from "@/lib/markdown-preview";
import { useGist } from "@/lib/gist-client";
import { stripSimplifyMarkers } from "@/lib/sentences";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { ChevronDownIcon, ChevronRightIcon, ExpandIcon, LocateIcon } from "@/components/icons";
import { AnnotationKindIcon } from "@/components/annotation-kind-icon";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { AnnotationGrip } from "@/components/outline/annotation-grip";
import { NoteId } from "@/components/outline/note-id";
import { useCardDropOpen } from "@/components/outline/use-card-drop";
import type { CollapsedViewModel } from "@/components/use-collapsed-view";

// One annotation card (SPEC.md §6), the same in the Annotations tab and on
// the annotations full page: the note card's structure — a header row with
// the collapse chevron, the highlight's color, the id, and the kind when
// asked for; then the body; then the actions. The card's border is the
// annotation's kind color (lib/annotations/kind.ts): a comment's blue, an
// explanation's red, a simplified rewrite's green, an analysis's teal, a
// visualization's magenta, the assistant's violet, a highlight's own hue —
// the color its mark carries in the text and its card carries over the
// article. Collapsed, the header row is the whole card: the id and the gist.
// A jump to the annotation from its mark in the text
// (dissect:open-annotation) opens a collapsed card first.

const label = "text-[11px] font-bold tracking-[0.08em] uppercase text-sand-600";
const card = "rounded-2xl border bg-card p-3.5 shadow-soft";

// The annotations view persists per browser and per project, like the notes
// view; the tab and the annotations full page share it.
export const ANNOTATIONS_VIEW_STORE = "unitos-annotations-view";

export function ColorDot({ color }: { color: string | null }) {
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

export { AnnotationKindIcon };

// The conversation continued from a tool's output (SPEC.md §21), under the
// output: the reader's messages as chat bubbles, the assistant's as markdown
// — the same shapes as the card beside the article. Nothing scrolls inside.
export function ToolConversation({ turns }: { turns: AnnotationItem["conversation"] }) {
  const t = useT();
  if (turns.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
      <span className={label}>{t("panels.conversation")}</span>
      {turns.map((message, i) =>
        message.role === "user" ? (
          <p key={i} className="ml-6 self-end rounded-2xl bg-clay-100 px-3 py-1.5 text-[12.5px] text-clay-800">
            {message.content}
          </p>
        ) : (
          <div key={i} className="text-[13px]">
            <Markdown>{message.content}</Markdown>
          </div>
        ),
      )}
    </div>
  );
}

// The title the full conversation view carries, one per kind (SPEC.md §21).
export const CONVERSATION_TITLE: Record<string, TKey> = {
  assistant: "panels.assistant",
  explain: "reader.explainPlus",
  simplify: "reader.simplifyPlus",
  analyze: "reader.analyzePlus",
  visualize: "reader.visualizePlus",
};
// An annotation the reader can read as a conversation: the assistant's own,
// or a tool's output continued into one.
export function hasConversation(a: AnnotationItem) {
  return a.kind === "assistant" || a.conversation.length > 0;
}

// A group's label carries the symbol of the tool that made its cards — the
// glyph on the toolbar button and on the mark in the text — so a reader finds
// a comment or a link by the symbol they used. Highlights carry their color.
export function GroupLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className={`${label} flex items-center gap-1.5`}>
      {icon}
      {children}
    </span>
  );
}

/** The line a collapsed card shows until its gist arrives: the annotation's
    first words. */
export function annotationSummary(a: AnnotationItem): string {
  if (a.kind === "highlight") return a.content;
  if (a.kind === "simplify") return markdownPreview(stripSimplifyMarkers(a.content));
  return markdownPreview(a.content);
}

export function AnnotationCard({
  annotation,
  documentId,
  view,
  summary,
  menu,
  showKind = false,
  children,
}: {
  annotation: AnnotationItem;
  /** The document the annotation is anchored in; null: no reference can point to it. */
  documentId: string | null;
  view: CollapsedViewModel;
  summary: string;
  /** The three-dots menu at the right of the header (annotation-menu.tsx). */
  menu?: React.ReactNode;
  /** The kind's symbol and name in the header row: the annotations full
      page, where the cards are grouped by document, not by kind. */
  showKind?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  // Somewhere to drop: a note of the tray, or the floating card over the
  // article (SPEC.md §6). The grip shows only then — with no note to drop on,
  // the gesture goes nowhere.
  const droppable = useCardDropOpen();
  const collapsed = view.isCollapsed(annotation.id);
  const gist = useGist(annotation.id, annotation.gist, summary, collapsed);
  const collapseLabel = collapsed ? t("outline.expandNote") : t("outline.collapseNote");
  const { sourceId } = annotation;
  const toggle = view.toggle;
  const color = annotationKindColor(annotation.kind, annotation.color);
  useEffect(() => {
    if (!collapsed || !sourceId) return;
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ sourceId: string }>).detail.sourceId === sourceId) toggle(annotation.id);
    };
    window.addEventListener("dissect:open-annotation", onOpen);
    return () => window.removeEventListener("dissect:open-annotation", onOpen);
  }, [collapsed, sourceId, annotation.id, toggle]);

  return (
    <div
      data-annotation-source-id={sourceId ?? undefined}
      data-annotation-kind={annotation.kind}
      className={`group/annotation ${card}`}
      style={{ borderColor: color }}
    >
      <div className="flex min-h-[18px] items-center gap-1.5">
        {droppable && documentId && (
          <div className="-ml-1 opacity-70 transition-opacity group-hover/annotation:opacity-100 focus-within:opacity-100">
            <AnnotationGrip
              reference={{
                annotationId: annotation.id,
                documentId,
                sourceId,
                kind: annotation.kind,
                label: t(ANNOTATION_KIND_KEY[annotation.kind]),
                words: gist,
                // The quote lands above the row; the text, the picture, or
                // the conversation's log under it (lib/annotation-reference.ts).
                ...(annotation.quotedText ? { quote: annotation.quotedText } : {}),
                ...referenceContent(annotation.kind, annotation.content, annotation.quotedText, annotation.conversation.length),
              }}
            />
          </div>
        )}
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
        {showKind && annotation.kind !== "highlight" && (
          <span className={`${label} flex shrink-0 items-center gap-1`} style={{ color }}>
            <AnnotationKindIcon kind={annotation.kind} size={11} />
            {t(ANNOTATION_KIND_KEY[annotation.kind])}
          </span>
        )}
        <NoteId id={annotation.id} />
        {collapsed && (
          <button
            onClick={() => toggle(annotation.id)}
            data-track="annotation-collapse"
            title={t("outline.expandNote")}
            className="min-w-0 flex-1 overflow-hidden text-left text-[13px] leading-[18px] whitespace-nowrap text-sand-800 hover:text-clay-800"
          >
            {gist}
          </button>
        )}
        {collapsed && annotation.figureLabel && (
          <span
            className="shrink-0 rounded-full bg-sand-200 px-2 text-[10.5px] font-semibold text-sand-600"
            data-tip={t("panels.figureLabelTitle", { label: annotation.figureLabel })}
          >
            {annotation.figureLabel}
          </span>
        )}
        {menu && <span className="ml-auto flex shrink-0 items-center">{menu}</span>}
      </div>
      {!collapsed && <div className="mt-1">{children}</div>}
    </div>
  );
}

/** The card's body by kind: the text, the conversation continued from a
    tool's output, the anchored words, and, once the anchor is gone, what the
    annotation was anchored to. */
export function AnnotationBody({ annotation: a }: { annotation: AnnotationItem }) {
  const t = useT();
  const lost =
    a.orphaned && a.quotedText && a.quotedText !== a.content ? (
      <p className="mt-2 line-clamp-2 border-l-2 border-red-300 pl-2 text-xs text-sand-500">
        {t("panels.wasAnchoredTo", { text: a.quotedText })}
      </p>
    ) : null;
  switch (a.kind) {
    case "highlight":
      return (
        <>
          <p className="text-[13px]">{a.content}</p>
          {lost}
        </>
      );
    case "comment":
      return (
        <>
          <div className="text-[13px]">
            <Markdown>{a.content}</Markdown>
          </div>
          {a.quotedText && (
            <p className="mt-2 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">{a.quotedText}</p>
          )}
        </>
      );
    case "simplify":
      return (
        <>
          <div className="text-[13px]">
            <Markdown>{stripSimplifyMarkers(a.content)}</Markdown>
          </div>
          <ToolConversation turns={a.conversation} />
          {a.quotedText && (
            <p className="mt-2 line-clamp-2 border-l-2 border-sand-300 pl-2 text-xs text-sand-500">{a.quotedText}</p>
          )}
        </>
      );
    case "assistant":
      return (
        <>
          {/* The sidebar assistant's conversation is anchored nowhere: the badge says so, and there is no anchor to jump to. */}
          {a.sourceId === null && (
            <p className="mb-1 text-[11px] font-semibold text-sand-500">{t("assistant.historyOriginSidebar")}</p>
          )}
          {/* The whole conversation, nothing to scroll inside the card. */}
          <div className="text-[13px]">
            <Markdown>{a.content}</Markdown>
          </div>
          {lost}
        </>
      );
    default:
      return (
        <>
          <div className="text-[13px]">
            <Markdown>{a.content}</Markdown>
          </div>
          <ToolConversation turns={a.conversation} />
          {lost}
        </>
      );
  }
}

export function AnnotationActions({
  annotation,
  notebookId,
  documentId,
  onDelete,
  onExpand,
}: {
  annotation: AnnotationItem;
  notebookId: string;
  documentId: string | null;
  onDelete: (id: string) => Promise<void>;
  onExpand: (id: string) => void;
}) {
  const router = useRouter();
  const t = useT();
  const { canEdit } = useCollab();
  const canJump = Boolean(annotation.sourceId) && !annotation.orphaned && !annotation.resolved && documentId !== null;

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
          data-tip={
            annotation.figureLabel
              ? `${t("panels.jumpToAnchor")}\n${t("panels.figureLabelTitle", { label: annotation.figureLabel })}`
              : t("panels.jumpToAnchor")
          }
          className="inline-flex items-center gap-1.5 rounded-full bg-clay-100 px-2.5 py-1 text-[11px] font-semibold text-clay-800 hover:bg-clay-200"
        >
          <LocateIcon size={11} />
          {annotation.figureLabel ?? ""}
        </button>
      )}
      {!canJump && annotation.figureLabel && (
        <span
          className="rounded-full bg-sand-200 px-2.5 py-1 text-[11px] font-semibold text-sand-600"
          data-tip={t("panels.figureLabelTitle", { label: annotation.figureLabel })}
        >
          {annotation.figureLabel}
        </span>
      )}
      {annotation.orphaned && (
        <span className="text-[11px] font-semibold text-red-500">
          {t("panels.anchorUnresolved")}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {hasConversation(annotation) && (
          <button
            onClick={() => onExpand(annotation.id)}
            data-track="annotation-expand"
            aria-label={t("reader.expandConversation")}
            data-tip={t("reader.expandConversationTitle")}
            className="text-sand-500 hover:text-clay-800"
          >
            <ExpandIcon size={12} />
          </button>
        )}
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
