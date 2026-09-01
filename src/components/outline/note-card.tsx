"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ACCOUNT_HEADER } from "@/lib/constants";
import { isImeKey } from "@/lib/ime";
import { tabAccount } from "@/lib/tab-account";
import type { NoteView, SourceChip } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { DragHandle, useCombineTarget, type HandleProps } from "@/components/sortable";
import { NoteEditor } from "@/components/outline/note-editor";
import type { OutlineActions } from "@/components/outline/use-outline";

// Opening the editor on a quote note (only "> " lines) adds a fresh line, so
// the caret starts underneath the quote and additions land there.
function editDraft(content: string): string {
  const lines = content.split("\n");
  const quoteOnly = lines.length > 0 && lines.every((l) => l.trim() === "" || l.startsWith(">"));
  return quoteOnly ? `${content}\n\n` : content;
}

/** Tray cards sit in the 352px drawer (design 1a); page cards in the 760px column (design 2b). */
type Variant = "tray" | "page";

function PinIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" fill="none" strokeWidth="2" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </svg>
  );
}

function TickIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

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
  const router = useRouter();
  const { canEdit } = useCollab();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);
  const [copied, setCopied] = useState(false);
  const [handledEdit, setHandledEdit] = useState<{ id: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const combineTarget = useCombineTarget();
  const pending = note.status === "PENDING";
  const focused = pending && actions.focusedPendingId === note.id;
  const tray = variant === "tray";
  // The ticker: accepted notes can be selected for bulk delete, merge, and pin.
  const selectable = note.status === "ACCEPTED" && canEdit;
  const isSelected = actions.selected.has(note.id);
  const isCombineTarget = combineTarget === note.id && note.status === "ACCEPTED";

  // Keyboard queue: `e` on the focused pending note opens the editor.
  // Adjust-during-render; each keypress creates a new request object.
  if (actions.editRequest && actions.editRequest.id === note.id && handledEdit !== actions.editRequest) {
    setHandledEdit(actions.editRequest);
    setDraft(editDraft(note.content));
    setEditing(true);
  }

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  // Auto-save: while the editor is open, every edit saves on its own — a
  // debounced PATCH after the last keystroke, and a keepalive flush when the
  // window closes or the editor unmounts — so nothing typed is lost. Cancel
  // still restores the content from before this edit: the flush sees the
  // reverted draft and writes it back over the auto-saved state.
  const draftRef = useRef(draft);
  const lastSavedRef = useRef(note.content);

  useEffect(() => {
    if (!editing) return;
    lastSavedRef.current = note.content;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  useEffect(() => {
    draftRef.current = draft;
    if (!editing || !canEdit) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      const before = lastSavedRef.current;
      lastSavedRef.current = trimmed;
      void api(`/api/notes/${note.id}`, "PATCH", { content: trimmed }).catch(() => {
        // Failed quiet save: the next keystroke or the flush retries.
        if (lastSavedRef.current === trimmed) lastSavedRef.current = before;
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [draft, editing, canEdit, note.id]);

  useEffect(() => {
    if (!editing || !canEdit) return;
    const flush = () => {
      const trimmed = draftRef.current.trim();
      if (!trimmed || trimmed === lastSavedRef.current) return;
      lastSavedRef.current = trimmed;
      const account = tabAccount();
      void fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
        body: JSON.stringify({ content: trimmed }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [editing, canEdit, note.id]);

  // Cancel and Esc restore the content from before this edit: the flush in
  // the cleanup above sees the reverted draft and writes it back over any
  // auto-saved state.
  function cancel() {
    draftRef.current = note.content;
    setDraft(note.content);
    setEditing(false);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === note.content) {
      cancel();
      return;
    }
    draftRef.current = draft;
    lastSavedRef.current = trimmed;
    setEditing(false);
    await actions.saveNote(note.id, trimmed);
  }

  if (editing) {
    return (
      <div className="rounded-2xl bg-card p-3 shadow-soft outline-2 outline-clay-400">
        <NoteEditor
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            if (e.key === "Escape") cancel();
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => void save()}
            className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          >
            {t("common.save")}
          </button>
          <button
            onClick={cancel}
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
    "group/note relative rounded-2xl bg-card shadow-soft",
    tray ? "p-3.5" : "px-[18px] py-4",
    focused ? "outline-2 outline-clay-400" : "",
    pending && !focused ? (tray ? "opacity-82" : "opacity-85") : "",
    isCombineTarget ? "outline-2 outline-sage-500" : isSelected ? "outline-2 outline-clay-300" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Double-click the card to jump to the source: the reader opens on the
  // document and flashes the quote — the link between note and quote works
  // both ways. Clicks on controls and text selection inside fields stay theirs.
  function jumpToSource(e: React.MouseEvent) {
    if ((e.target as Element).closest("button, a, textarea, input, select")) return;
    const source = note.sources.find((s) => !s.orphaned);
    if (!source) return;
    window.getSelection()?.removeAllRanges();
    router.push(`/n/${actions.notebookId}?doc=${source.documentId}&src=${source.id}`);
    // Already on that document with ?src set: the push changes nothing, so
    // flash the mark directly.
    window.dispatchEvent(
      new CustomEvent("dissect:flash-source", { detail: { sourceId: source.id } }),
    );
  }

  return (
    <div
      ref={cardRef}
      data-note-id={note.id}
      onDoubleClick={jumpToSource}
      className={surface}
      title={isCombineTarget ? t("outline.dropToMerge") : undefined}
    >
      {note.pinned && (
        <button
          onClick={() => canEdit && void actions.setPinned(note.id, false)}
          title={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
          aria-label={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
          className={`absolute top-2.5 z-10 text-clay hover:text-clay-600 ${selectable ? "right-9" : "right-2.5"}`}
        >
          <PinIcon />
        </button>
      )}
      {selectable && (
        <button
          onClick={() => actions.toggleSelect(note.id)}
          role="checkbox"
          aria-checked={isSelected}
          aria-label={t("outline.selectNote")}
          title={t("outline.selectNote")}
          className={`absolute top-2.5 right-2.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${
            isSelected
              ? "border-clay bg-clay text-clay-fg opacity-100"
              : "border-sand-400 bg-card text-transparent opacity-50 hover:border-clay-500 hover:opacity-100"
          }`}
        >
          <TickIcon />
        </button>
      )}
      <div className={`flex items-start gap-1.5 ${selectable || note.pinned ? "pr-6" : ""}`}>
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
              setDraft(editDraft(note.content));
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
                setDraft(editDraft(note.content));
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
  const { shared, people, myId } = useCollab();
  if (!shared || !createdById || createdById === myId || !people[createdById]) return null;
  return (
    <div className="mt-1.5">
      <AuthorChip createdById={createdById} />
    </div>
  );
}
