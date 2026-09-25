"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { ReplyThread, replyTime } from "@/components/collab/reply-thread";
import { CheckIcon, MoreVertIcon } from "@/components/docs/icons";
import { toast } from "@/components/docs/insert/context";
import { pageEditorIn } from "@/components/docs/layer/anchor";
import { DropdownPanel, MenuItem } from "@/components/docs/menu";
import { DialogButton } from "@/components/docs/toolbar/dialog";
import { useLang, useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import { markdownStyleKey } from "@/lib/markdown-style";
import type { ReplyView } from "@/lib/types";

// A comment's card in the page editor's margin, as Google Docs draws it
// (SPEC.md §29): the author's badge, name, and time, the comment, Resolve,
// More options (Edit, Delete, Get link to this comment), and the replies
// under it (SPEC.md §12). A comment is an annotation: Resolve closes its
// open replies. On the focused card, Google's keys: R reply, J the next
// comment, K the previous one, E resolve, U back to the text. A press
// anywhere else closes the card.

export function CommentCard({
  noteId,
  sourceId,
  link,
  draft,
  saved,
  busy,
  grip,
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
  /** The grip that drags the comment into a note. */
  grip: ReactNode;
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
  const { canEdit, people } = useCollab();
  const cardRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [written, setWritten] = useState<{ at: string; by: string | null } | null>(null);
  const [replies, setReplies] = useState<ReplyView[]>([]);
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
        if (edits) setWritten({ at: edits.createdAt, by: edits.createdById });
        if (thread) setReplies(thread.replies);
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

  const person = written?.by ? people[written.by] : undefined;
  const open = replies.filter((r) => r.resolvedById === null);
  const canResolve = canEdit && open.length > 0;

  async function resolve() {
    if (!canResolve) return;
    try {
      await Promise.all(open.map((r) => api(`/api/replies/${r.id}`, "PATCH", { resolved: true })));
      router.refresh();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(link, window.location.origin).href);
      toast(t("docs.linkCopied"));
    } catch {
      toast(t("reader.copyFailed"));
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
      tabIndex={-1}
      role="group"
      aria-label={t("reader.comment")}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      className={`docs-comment ${className}`}
      style={style}
    >
      <div className="docs-comment-head">
        {person && <PersonBadge person={person} size={32} />}
        <div className="docs-comment-who">
          {person && <div className="docs-comment-name">{person.name}</div>}
          {written && <div className="docs-comment-time">{replyTime(written.at, lang)}</div>}
        </div>
        <div className="docs-comment-buttons">
          {grip}
          {canResolve && (
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
            <MoreVertIcon size={20} />
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
            <DialogButton onClick={cancelEdit}>{t("common.cancel")}</DialogButton>
            <DialogButton primary disabled={busy || !unsaved || !draft.trim()} onClick={onSave}>
              {t("common.save")}
            </DialogButton>
          </div>
        </>
      ) : (
        <div className="docs-comment-text">
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
        {canEdit && (
          <MenuItem track="comment-delete" onSelect={choose(onDelete)}>
            {t("common.delete")}
          </MenuItem>
        )}
        <MenuItem track="comment-link" onSelect={choose(() => void copyLink())}>
          {t("docsLayer.getLink")}
        </MenuItem>
      </DropdownPanel>
    </div>
  );
}
