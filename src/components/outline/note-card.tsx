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
import { ChevronDownIcon, ChevronRightIcon, LocateIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown, markdownPreview } from "@/components/markdown";
import { DragHandle, useCombineTarget, type HandleProps } from "@/components/sortable";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteId } from "@/components/outline/note-id";
import type { OutlineActions } from "@/components/outline/use-outline";

// Opening the editor on a quote note (only "> " lines) adds a fresh line, so
// the caret starts underneath the quote and additions land there.
function editDraft(content: string): string {
  const lines = content.split("\n");
  const quoteOnly = lines.length > 0 && lines.every((l) => l.trim() === "" || l.startsWith(">"));
  return quoteOnly ? `${content}\n\n` : content;
}

/** Where the card renders: the 352px tray drawer (design 1a), the 760px notes
    full page column (design 2b), or one pane of the compare view, which draws
    the surface around the card itself. */
type Variant = "tray" | "page" | "pane";

// One padding per variant, the same in every state — open, collapsed, editing —
// so the note keeps its shape when the editor opens and when Done closes it.
const PADDING: Record<Variant, string> = {
  tray: "p-3.5",
  page: "px-[18px] py-4",
  pane: "px-5 py-4",
};

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
            data-track="note-source"
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

// One note. Every state shares one structure: the header row — handle, collapse
// chevron, id at the left; pin and select at the right — then the body, then the
// actions. Collapsed, the header row is the whole card: the id and one line
// summarizing the content. Editing, the body is the editor at the same size.
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
  const pane = variant === "pane";
  // The ticker: accepted notes can be selected for bulk delete, merge, pin, and compare.
  const selectable = note.status === "ACCEPTED" && canEdit && !pane;
  const isSelected = actions.selected.has(note.id);
  const isCombineTarget = combineTarget === note.id && note.status === "ACCEPTED";
  // Accepted notes collapse to one line; pending notes are read before they are
  // accepted, and a compare pane exists to show the note whole.
  const foldable = note.status === "ACCEPTED" && !pane;
  const collapsed = foldable && actions.isCollapsed(note.id);
  // The source the card jumps to: the reader opens on the document and
  // flashes the quote — the exact position the note came from.
  const jumpSource = note.sources.find((s) => !s.orphaned) ?? null;

  // A jump to this note (an issue card, the workspace's show-note choreography)
  // opens a collapsed note, so the jump lands on the note whole.
  useEffect(() => {
    if (!collapsed) return;
    const onOpen = (e: Event) => {
      if ((e as CustomEvent<{ noteId: string }>).detail.noteId === note.id) actions.toggleCollapsed(note.id);
    };
    window.addEventListener("dissect:open-note", onOpen);
    return () => window.removeEventListener("dissect:open-note", onOpen);
  }, [collapsed, note.id, actions]);

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

  // Done closes the editor; the content is already saved by then.
  async function done() {
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

  function openEditor() {
    setDraft(editDraft(note.content));
    setEditing(true);
  }

  const collapseLabel = collapsed ? t("outline.expandNote") : t("outline.collapseNote");

  // Jump to the source: the reader opens on the document and flashes the
  // quote — the link between note and quote works both ways.
  function jumpTo(source: SourceChip) {
    window.getSelection()?.removeAllRanges();
    router.push(`/n/${actions.notebookId}?doc=${source.documentId}&src=${source.id}`);
    // Already on that document with ?src set: the push changes nothing, so
    // flash the mark directly.
    window.dispatchEvent(
      new CustomEvent("dissect:flash-source", { detail: { sourceId: source.id } }),
    );
  }

  // The header row, the same in every state: handle, collapse chevron, id at
  // the left; pin and select at the right. Collapsed, the summary line and the
  // source count sit between them.
  const header = (
    <div className="flex min-h-[18px] items-center gap-1.5">
      {handle && !editing && (
        <div className="-ml-1 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
          <DragHandle handle={handle} label={t("outline.reorderNote")} />
        </div>
      )}
      {foldable && !editing && (
        <button
          onClick={() => actions.toggleCollapsed(note.id)}
          data-track="note-collapse"
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          title={collapseLabel}
          className="-ml-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-sand-400 hover:bg-clay-100 hover:text-clay-800"
        >
          {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
        </button>
      )}
      <NoteId id={note.id} />
      {collapsed && (
        <button
          onClick={() => actions.toggleCollapsed(note.id)}
          data-track="note-collapse"
          title={t("outline.expandNote")}
          className="min-w-0 flex-1 truncate text-left text-[13px] leading-[18px] text-sand-800 hover:text-clay-800"
        >
          {markdownPreview(note.content)}
        </button>
      )}
      {collapsed && note.sources.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500"
          title={note.sources.map((s) => s.documentTitle).join(", ")}
        >
          <AnchorIcon />
          {note.sources.length}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {jumpSource && !editing && (
          <button
            onClick={() => jumpTo(jumpSource)}
            data-track="note-jump"
            aria-label={t("panels.jumpToAnchor")}
            title={t("panels.jumpToAnchor")}
            className="flex size-[18px] items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            <LocateIcon size={11} />
          </button>
        )}
        {note.pinned && (
          <button
            onClick={() => canEdit && void actions.setPinned(note.id, false)}
            data-track="note-unpin"
            title={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
            aria-label={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
            className="text-clay hover:text-clay-600"
          >
            <PinIcon />
          </button>
        )}
        {selectable && !editing && (
          <button
            onClick={() => actions.toggleSelect(note.id)}
            data-track="note-select"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={t("outline.selectNote")}
            title={t("outline.selectNote")}
            className={`flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors ${
              isSelected
                ? "border-clay bg-clay text-clay-fg opacity-100"
                : "border-sand-400 bg-card text-transparent opacity-50 hover:border-clay-500 hover:opacity-100"
            }`}
          >
            <TickIcon />
          </button>
        )}
      </span>
    </div>
  );

  if (editing) {
    return (
      <div
        data-note-id={note.id}
        className={`${pane ? "outline-2 -outline-offset-2 outline-clay-400" : "rounded-2xl bg-card shadow-soft outline-2 outline-clay-400"} ${PADDING[variant]}`}
      >
        {header}
        <div className="mt-1">
          <NoteEditor
            value={draft}
            onChange={setDraft}
            onKeyDown={(e) => {
              if (isImeKey(e)) return;
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void done();
              if (e.key === "Escape") cancel();
            }}
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => void done()}
            data-track="note-save"
            className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          >
            {t("common.done")}
          </button>
          <button
            onClick={cancel}
            data-track="note-cancel"
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
    "group/note relative",
    pane ? "" : "rounded-2xl bg-card shadow-soft",
    PADDING[variant],
    focused ? "outline-2 outline-clay-400" : "",
    pending && !focused ? (tray ? "opacity-82" : "opacity-85") : "",
    isCombineTarget ? "outline-2 outline-sage-500" : isSelected ? "outline-2 outline-clay-300" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Double-click the card jumps to the source too. Clicks on controls and text
  // selection inside fields stay theirs.
  function jumpToSource(e: React.MouseEvent) {
    if ((e.target as Element).closest("button, a, textarea, input, select")) return;
    if (jumpSource) jumpTo(jumpSource);
  }

  return (
    <div
      ref={cardRef}
      data-note-id={note.id}
      onDoubleClick={jumpToSource}
      className={surface}
      title={isCombineTarget ? t("outline.dropToMerge") : undefined}
    >
      {header}

      {!collapsed && (
        <div className="note-body mt-1">
          <Markdown breaks>{note.content}</Markdown>
          {note.sources.length > 0 && (tray || !pending) && (
            <div className="mt-2.5">
              <SourceChips sources={note.sources} notebookId={actions.notebookId} />
            </div>
          )}
          <AuthorLine createdById={note.createdById} />
          <ReplyThread target={{ noteId: note.id }} replies={note.replies} />
        </div>
      )}

      {collapsed || (pending && !canEdit) ? null : pending ? (
        // Tray: chips above, buttons on their own row (design 1a). Page: chips and
        // buttons share one row, Accept pushed right (design 2b).
        <div className={`${tray ? "mt-3" : "mt-2.5"} flex flex-wrap items-center gap-2`}>
          {!tray && <SourceChips sources={note.sources} notebookId={actions.notebookId} />}
          <button
            onClick={() => void actions.acceptNote(note.id)}
            data-track="note-accept"
            className={`rounded-full bg-sage-600 px-3.5 py-1.5 text-xs font-semibold text-sage-fg hover:bg-sage-700 ${tray ? "" : "ml-auto"}`}
            title={t("outline.acceptTitle")}
          >
            {t("common.accept")}
          </button>
          <button
            onClick={() => void actions.rejectNote(note.id)}
            data-track="note-reject"
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            title={t("outline.rejectTitle")}
          >
            {t("common.reject")}
          </button>
          <button
            onClick={openEditor}
            data-track="note-edit"
            className={`text-xs text-sand-600 hover:text-clay-700 ${tray ? "ml-auto" : ""}`}
            title={t("outline.editTitle")}
          >
            {t("outline.editLower")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
          {canEdit && (
            <button
              onClick={openEditor}
              data-track="note-edit"
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
            data-track="note-copy"
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
              data-track="note-delete"
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
