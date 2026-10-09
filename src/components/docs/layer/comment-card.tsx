"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAuthor, useCollab } from "@/components/collab/collab-context";
import { TrashIcon } from "@/components/icons";
import { PersonBadge } from "@/components/collab/person-badge";
import { ReplyThread, replyTime } from "@/components/collab/reply-thread";
import { CheckIcon, MoreHorizIcon } from "@/components/docs/icons";
import { toast } from "@/components/docs/insert/context";
import { pageEditorIn } from "@/components/docs/layer/anchor";
import { DropdownPanel, MenuItem } from "@/components/docs/menu";
import { DialogButton } from "@/components/docs/toolbar/dialog";
import { useLang, useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { annotationKindColor } from "@/lib/annotations/kind";
import { resolveCommentWithUndo } from "@/lib/annotations/resolve";
import { isImeKey } from "@/lib/ime";
import { markdownStyleKey } from "@/lib/markdown-style";
import type { ReplyView } from "@/lib/types";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

// A comment's card in the page editor's margin, as Google Docs draws it
// (SPEC.md §29): the author's badge, name, and time, the comment, Resolve,
// Delete, More options (Edit, Get link to this comment), and the replies
// under it (SPEC.md §12). The head is the reader's comment card's: Resolve,
// then Delete, as icons. A click on the comment's words edits them. A comment is an annotation: Resolve hides it, its
// mark and its card, until Reopen in the Annotations tab. On the focused
// card, Google's keys: R reply, J the next comment, K the previous one, E
// resolve, U back to the text. A press anywhere else closes the card.

/** Each comment's author, time, and replies as last loaded: a card opened
    again draws them at once, and the routes refresh them after. */
const threads = new Map<string, { written: { at: string; by: string | null } | null; replies: ReplyView[] }>();

export function CommentCard({
  noteId,
  sourceId,
  link,
  draft,
  saved,
  busy,
  className,
  style,
  onPointerDown,
  onDraft,
  onSave,
  onDelete,
  onClose,
}: {
  noteId: string;
  sourceId: string | null;
  /** The comment's address in the reader (SPEC.md §6). */
  link: string;
  draft: string;
  saved: string;
  busy: boolean;
  className: string;
  style: CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
  onDraft: (draft: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { canEdit } = useCollab();
  const authorOf = useAuthor();
  const cardRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [written, setWritten] = useState<{ at: string; by: string | null } | null>(() => threads.get(noteId)?.written ?? null);
  const [replies, setReplies] = useState<ReplyView[]>(() => threads.get(noteId)?.replies ?? []);
  const [loads, setLoads] = useState(0);
  // A saved edit leaves the field.
  const [shownSaved, setShownSaved] = useState(saved);
  if (shownSaved !== saved) {
    setShownSaved(saved);
    setEditing(false);
  }

  // Who wrote the comment and when, and its replies: the note's own routes.
  useEffect(() => {
    let cancelled = false;
    const read = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : null));
    void Promise.all([
      read<{ createdAt: string; createdById: string | null }>(`/api/notes/${noteId}/edits`),
      read<{ replies: ReplyView[] }>(`/api/replies?noteId=${encodeURIComponent(noteId)}`),
    ])
      .then(([edits, thread]) => {
        if (cancelled) return;
        const kept = threads.get(noteId);
        const next = {
          written: edits ? { at: edits.createdAt, by: edits.createdById } : (kept?.written ?? null),
          replies: thread ? thread.replies : (kept?.replies ?? []),
        };
        threads.set(noteId, next);
        setWritten(next.written);
        setReplies(next.replies);
      })
      .catch(() => {
        // Offline: the card shows the comment alone.
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, loads]);

  // Opened by J or K, the card takes the focus the card before it had.
  useEffect(() => {
    if (document.activeElement === document.body) cardRef.current?.focus({ preventScroll: true });
  }, []);

  // A press on a mark opens what it opens; one on the pane's scrollbar
  // (the pane itself) keeps the card.
  const unsaved = draft.trim() !== saved.trim();
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target || cardRef.current?.contains(target) || target.matches("[data-reader-root]")) return;
      if (target.closest("[data-docs-menu], [data-docs-open]")) return;
      if (!busy && !unsaved) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [busy, unsaved, onClose]);

  const person = written?.by ? authorOf(written.by) : undefined;

  /** A toast in this card's pane. */
  const say = (text: string) => {
    const editor = pageEditorIn(cardRef.current?.closest("[data-reader-root]") ?? null);
    if (editor) toast(text, editor);
  };

  // The card goes with the mark, and the text takes the keys again; the
  // pill's Undo reopens the comment, and a failed request paints the mark
  // again.
  async function resolve() {
    if (!canEdit) return;
    exit();
    try {
      await resolveCommentWithUndo(noteId, t("docsLayer.commentResolved"), () => router.refresh());
      router.refresh();
    } catch (err) {
      say(err instanceof Error ? err.message : t("common.notSaved"));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(link, window.location.origin).href);
      say(t("docs.linkCopied"));
    } catch {
      say(t("reader.copyFailed"));
    }
  }

  // J and K: the comment after or before this one in the text, by its icon.
  function step(direction: 1 | -1) {
    const pane = cardRef.current?.closest("[data-reader-root]");
    const ids = [...(pane?.querySelectorAll<HTMLElement>(".docs-prose .mark-chip-comment") ?? [])].map(
      (chip) => chip.dataset.sourceId,
    );
    const next = ids[ids.indexOf(sourceId ?? "") + direction];
    if (!next) return;
    pane?.querySelector(`[data-source-id="${next}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: next } }));
  }

  function exit() {
    const editor = pageEditorIn(cardRef.current?.closest("[data-reader-root]") ?? null);
    onClose();
    editor?.commands.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // In a field, Escape leaves the field and the card stays.
    if (e.target instanceof Element && e.target.closest("textarea, input")) {
      if (e.key === "Escape") e.stopPropagation();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "r") cardRef.current?.querySelector<HTMLElement>('[data-track="reply"]')?.click();
    else if (key === "j" || key === "k") step(key === "j" ? 1 : -1);
    else if (key === "e") void resolve();
    else if (key === "u") exit();
    else return;
    e.preventDefault();
  }

  const cancelEdit = () => {
    onDraft(saved);
    setEditing(false);
  };
  const choose = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };

  return (
    <div
      ref={cardRef}
      data-selection-popover
      data-side-card="comment"
      data-comment-card={sourceId ?? undefined}
      tabIndex={-1}
      role="group"
      aria-label={t("reader.comment")}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      // A press on the card keeps the caret in the page: typing goes there,
      // never to the card's keys. Its buttons and fields take the focus.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("button, a, textarea, input")) e.preventDefault();
      }}
      className={`docs-comment ${className}`}
      style={style}
    >
      {/* A hold on the head row lifts the comment onto a note (onPointerDown). */}
      <div className="docs-comment-head" data-hold-head>
        {person && <PersonBadge person={person} size={32} />}
        <div className="docs-comment-who">
          {person && <div className="docs-comment-name">{person.name}</div>}
          {written && <div className="docs-comment-time">{replyTime(written.at, lang)}</div>}
        </div>
        <div className="docs-comment-buttons">
          {canEdit && (
            <button
              type="button"
              onClick={() => void resolve()}
              data-track="comment-resolve"
              aria-label={t("common.resolve")}
              data-tip={t("docsLayer.resolveTitle")}
              className="docs-comment-button docs-comment-resolve"
            >
              <CheckIcon size={20} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              data-track="comment-delete"
              aria-label={t("common.delete")}
              data-tip={t("reader.deleteCommentTitle")}
              className="docs-comment-button docs-comment-delete"
            >
              <TrashIcon size={16} />
            </button>
          )}
          <button
            ref={moreRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            data-track="comment-more"
            aria-label={t("docsLayer.moreOptions")}
            aria-expanded={menuOpen}
            data-tip={t("docsLayer.moreOptions")}
            className="docs-comment-button"
          >
            <MoreHorizIcon size={20} />
          </button>
        </div>
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              const styled = markdownStyleKey(e);
              if (styled !== null) onDraft(styled);
              else if (e.key === "Escape") cancelEdit();
              else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && unsaved && draft.trim()) onSave();
            }}
            rows={2}
            className="docs-comment-field"
          />
          <div className="docs-comment-actions">
            <VoiceTypingButton track="docs-comment-voice-typing" className="mr-auto size-8" size={16} />
            <DialogButton onClick={cancelEdit}>{t("common.cancel")}</DialogButton>
            <DialogButton primary disabled={busy || !unsaved || !draft.trim()} onClick={onSave}>
              {t("common.save")}
            </DialogButton>
          </div>
        </>
      ) : (
        <div
          className="docs-comment-text"
          data-editable={canEdit || undefined}
          // A click on the words edits them, as in the block reader's card;
          // a link in them, or words being selected, keeps its own press.
          onClick={(e) => {
            if (!canEdit || (e.target as Element).closest("a") || !window.getSelection()?.isCollapsed) return;
            setEditing(true);
          }}
        >
          <Markdown breaks>{saved}</Markdown>
        </div>
      )}
      <ReplyThread target={{ noteId }} replies={replies} onChange={() => setLoads((n) => n + 1)} />
      <DropdownPanel
        open={menuOpen}
        anchorRef={moreRef}
        onClose={() => setMenuOpen(false)}
        placement="below-right"
        label={t("docsLayer.moreOptions")}
      >
        {canEdit && (
          <MenuItem track="comment-edit" onSelect={choose(() => setEditing(true))}>
            {t("common.edit")}
          </MenuItem>
        )}
        <MenuItem
          track="comment-link"
          onSelect={() => {
            setMenuOpen(false);
            void copyLink();
          }}
        >
          {t("docsLayer.getLink")}
        </MenuItem>
      </DropdownPanel>
    </div>
  );
}

export type ColumnComment = { sourceId: string; content: string; authorId: string | null };

/** The page editor's card column (SPEC.md §29): a layer over the pane from
    the toolbar's foot down, never over the notes tray beside the pane. Its
    inside scrolls with the pane, so every
    card in it — the toolbar, a tool's card, a comment's, a suggestion's —
    stands in the pane's coordinates. Every comment has its card here, one
    line each but the open one. The suggestion layer fits the column and
    places the cards (suggest/layer.tsx); the end stretches the pane to the
    lowest card. */
export function CardColumn({
  ref,
  split,
  comments,
}: {
  /** The column's inside, where the cards go. */
  ref: (el: HTMLDivElement | null) => void;
  split: boolean;
  comments: ColumnComment[];
}) {
  return (
    <>
      <div className="docs-column" data-docs-column data-split={split || undefined} onWheel={scrollPane}>
        <div ref={ref} className="docs-column-in">
          {comments.map((c) => (
            <CommentLine key={c.sourceId} comment={c} />
          ))}
        </div>
      </div>
      <div aria-hidden className="docs-column-end" data-docs-column-end />
    </>
  );
}

/** The column stands outside the pane's scroll: a wheel over a card scrolls
    the pane, as over the page, once the card's own scroll box has none left
    that way. */
function scrollPane(e: React.WheelEvent<HTMLElement>) {
  for (let el = e.target as Element | null; el && el !== e.currentTarget; el = el.parentElement) {
    const room = e.deltaY > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
    if (room > 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return;
  }
  e.currentTarget.closest("[data-reader-root]")?.scrollBy(0, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY);
}

/** A press on a card at rest opens it and leaves the caret in the page. It
    acts on the press, not the click: the press closes the open card, the
    cards move, and the release lands on another one. */
export function openLine(e: React.MouseEvent, open: () => void): void {
  e.preventDefault();
  if (e.button === 0) open();
}

/** A comment's card at rest: one line, the author and the comment's first
    words. */
function CommentLine({ comment }: { comment: ColumnComment }) {
  const t = useT();
  const person = useAuthor()(comment.authorId ?? "");
  return (
    <div
      data-selection-popover
      data-comment-card={comment.sourceId}
      role="button"
      tabIndex={-1}
      aria-label={t("panes.openComment")}
      onMouseDown={(e) =>
        openLine(e, () =>
          window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: comment.sourceId } })),
        )
      }
      className="docs-comment docs-card-line absolute z-30"
      style={{ borderColor: annotationKindColor("comment", null) }}
    >
      {person && <PersonBadge person={person} size={20} />}
      <span className="docs-card-line-text">
        {person && <b className="docs-comment-name">{person.name}</b>} {comment.content.replace(/\s+/g, " ")}
      </span>
    </div>
  );
}
