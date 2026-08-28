"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NoteView, SourceChip } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { DragHandle, type HandleProps } from "@/components/sortable";
import type { OutlineActions } from "@/components/outline/use-outline";

/** Tray cards sit in the 352px drawer (design 1a); page cards in the 760px column (design 2b). */
type Variant = "tray" | "page";

function AnchorIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="3" />
      <path d="M12 22V8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

function SourceChips({ sources, notebookId }: { sources: SourceChip[]; notebookId: string }) {
  const t = useT();
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((source) =>
        source.orphaned ? (
          <span
            key={source.id}
            title={t("outline.anchorUnresolvedTitle", { quote: source.quotedText })}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed border-red-400 px-2.5 py-0.5 text-[11px] font-semibold text-red-500"
          >
            <AnchorIcon />
            <span className="shrink-0">
              {source.documentTitle} · {t("outline.unresolvedLabel")}
            </span>
            <span className="truncate font-normal text-sand-500">“{source.quotedText}”</span>
          </span>
        ) : (
          <Link
            key={source.id}
            href={`/n/${notebookId}?doc=${source.documentId}&src=${source.id}`}
            title={source.quotedText}
            className="inline-flex max-w-52 items-center gap-1.5 truncate rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800 hover:bg-clay-200"
          >
            <AnchorIcon />
            {source.documentTitle}
          </Link>
        ),
      )}
    </div>
  );
}

export function NoteCard({
  note,
  actions,
  handle,
  variant = "page",
}: {
  note: NoteView;
  actions: OutlineActions;
  handle?: HandleProps;
  variant?: Variant;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [copied, setCopied] = useState(false);
  const [handledEdit, setHandledEdit] = useState<{ id: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const pending = note.status === "PENDING";
  const focused = pending && actions.focusedPendingId === note.id;
  const tray = variant === "tray";

  // Keyboard queue: `e` on the focused pending note opens the editor.
  // Adjust-during-render; each keypress creates a new request object.
  if (actions.editRequest && actions.editRequest.id === note.id && handledEdit !== actions.editRequest) {
    setHandledEdit(actions.editRequest);
    setDraft(note.content);
    setEditing(true);
  }

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  async function save() {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === note.content) {
      setDraft(note.content);
      return;
    }
    await actions.saveNote(note.id, trimmed);
  }

  if (editing) {
    return (
      <div className="rounded-2xl bg-card p-3 shadow-soft outline-2 outline-clay-400">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            if (e.key === "Escape") {
              setDraft(note.content);
              setEditing(false);
            }
          }}
          rows={Math.min(12, Math.max(3, draft.split("\n").length + 1))}
          className="w-full resize-y bg-transparent text-sm outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => void save()}
            className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          >
            {t("common.save")}
          </button>
          <button
            onClick={() => {
              setDraft(note.content);
              setEditing(false);
            }}
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  // Pending notes are outlined when focused and dimmed when they are further down
  // the queue, so the one the keyboard acts on is unmistakable (design 1a).
  const surface = [
    "group/note rounded-2xl bg-card shadow-soft",
    tray ? "p-3.5" : "px-[18px] py-4",
    focused ? "outline-2 outline-clay-400" : "",
    pending && !focused ? (tray ? "opacity-82" : "opacity-85") : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={cardRef} data-note-id={note.id} className={surface}>
      <div className="flex items-start gap-1.5">
        {handle && (
          <div className="pt-0.5 opacity-0 transition-opacity group-hover/note:opacity-100">
            <DragHandle handle={handle} label={t("outline.reorderNote")} />
          </div>
        )}
        <div className={`min-w-0 flex-1 ${tray ? "text-[13.5px] leading-[1.6]" : "text-sm leading-[1.65]"}`}>
          <Markdown>{note.content}</Markdown>
          {note.sources.length > 0 && (tray || !pending) && (
            <div className="mt-2.5">
              <SourceChips sources={note.sources} notebookId={actions.notebookId} />
            </div>
          )}
          <AuthorLine createdById={note.createdById} />
          <ReplyThread target={{ noteId: note.id }} replies={note.replies} />
        </div>
      </div>

      {pending && !canEdit ? null : pending ? (
        // Tray: chips above, buttons on their own row (design 1a). Page: chips and
        // buttons share one row, Accept pushed right (design 2b).
        <div
          className={`${tray ? "mt-3" : "mt-2.5"} flex flex-wrap items-center gap-2 ${handle ? "pl-6" : ""}`}
        >
          {!tray && <SourceChips sources={note.sources} notebookId={actions.notebookId} />}
          <button
            onClick={() => void actions.acceptNote(note.id)}
            className={`rounded-full bg-sage-600 px-3.5 py-1.5 text-xs font-semibold text-sage-fg hover:bg-sage-700 ${tray ? "" : "ml-auto"}`}
            title={t("outline.acceptTitle")}
          >
            {t("common.accept")}
          </button>
          <button
            onClick={() => void actions.rejectNote(note.id)}
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            title={t("outline.rejectTitle")}
          >
            {t("common.reject")}
          </button>
          <button
            onClick={() => {
              setDraft(note.content);
              setEditing(true);
            }}
            className={`text-xs text-sand-600 hover:text-clay-700 ${tray ? "ml-auto" : ""}`}
            title={t("outline.editTitle")}
          >
            {t("outline.editLower")}
          </button>
        </div>
      ) : (
        <div
          className={`mt-2 flex items-center gap-3 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100 ${handle ? "pl-6" : ""}`}
        >
          {canEdit && (
            <button
              onClick={() => {
                setDraft(note.content);
                setEditing(true);
              }}
              className="text-xs text-sand-600 hover:text-clay-700"
            >
              {t("common.edit")}
            </button>
          )}
          <button
            onClick={() => {
              void navigator.clipboard.writeText(note.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="text-xs text-sand-600 hover:text-clay-700"
            title={t("outline.copyTitle")}
          >
            {copied ? t("outline.copied") : t("outline.copy")}
          </button>
          {canEdit && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) void actions.moveNoteToSection(note.id, e.target.value);
              }}
              className="rounded-full border-none bg-transparent text-xs text-sand-600 outline-none hover:text-clay-700"
              aria-label={t("outline.moveNoteAria")}
            >
              <option value="" disabled>
                {t("outline.moveTo")}
              </option>
              {actions.sectionChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          {canEdit && (
            <button
              onClick={() => {
                if (confirm(t("outline.confirmDeleteNote"))) void actions.deleteNote(note.id);
              }}
              className="text-xs text-red-500 hover:text-red-700"
            >
              {t("common.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The author label under a note's content, on shared corpora only.
function AuthorLine({ createdById }: { createdById: string | null }) {
  const { shared, people } = useCollab();
  if (!shared || !createdById || !people[createdById]) return null;
  return (
    <div className="mt-1.5">
      <AuthorChip createdById={createdById} />
    </div>
  );
}
