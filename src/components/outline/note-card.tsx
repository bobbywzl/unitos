"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SourceChip } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { ExpandIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown, markdownPreview } from "@/components/markdown";
import { DragHandle, useCombineTarget, type HandleProps } from "@/components/sortable";
import { NoteEditor } from "@/components/outline/note-editor";
import { useNoteDraft } from "@/components/outline/use-note-draft";
import type { OutlineActions } from "@/components/outline/use-outline";

// Opening the editor on a quote note (only "> " lines) adds a fresh line, so
// the caret starts underneath the quote and additions land there.
function editDraft(content: string): string {
  const lines = content.split("\n");
  const quoteOnly = lines.length > 0 && lines.every((l) => l.trim() === "" || l.startsWith(">"));
  return quoteOnly ? `${content}\n\n` : content;
}

/** The nearest ancestor that scrolls: the tray's panel. Null on the notes full page, where the window scrolls. */
function scrollPane(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
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
  const [copied, setCopied] = useState(false);
  const [handledEdit, setHandledEdit] = useState<{ id: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const combineTarget = useCombineTarget();
  const pending = note.status === "PENDING";
  const focused = pending && actions.focusedPendingId === note.id;
  const tray = variant === "tray";
  // This note's editor is out in the floating card (floating-note-editor.tsx).
  const floating = actions.floating?.id === note.id;
  // The ticker: accepted notes can be selected for bulk delete, merge, and pin.
  const selectable = note.status === "ACCEPTED" && canEdit;
  const isSelected = actions.selected.has(note.id);
  const isCombineTarget = combineTarget === note.id && note.status === "ACCEPTED";

  // Auto-save while the editor is open (SPEC.md §6); Cancel restores the
  // content from before this edit.
  const { draft, setDraft, cancel: cancelDraft, markSaved, getOriginal } = useNoteDraft({
    noteId: note.id,
    original: note.content,
    initial: note.content,
    active: editing,
    canEdit,
  });

  // Keyboard queue: `e` on the focused pending note opens the editor; the
  // floating card docking reopens it on the card's draft. Adjust-during-render;
  // each request is a new object.
  if (actions.editRequest && actions.editRequest.id === note.id && handledEdit !== actions.editRequest) {
    setHandledEdit(actions.editRequest);
    if (!floating) {
      setDraft(actions.editRequest.draft ?? editDraft(note.content));
      setEditing(true);
    }
  }

  useEffect(() => {
    if (focused) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  // The editor shows as much of the note as it can (SPEC.md §6): the card
  // grows with the text, capped at the height of the pane it scrolls in, and
  // past the cap the text scrolls inside the card while the bar and the
  // buttons stay. The pane is the tray's panel; on the notes full page it is
  // the window.
  const editCardRef = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!editing) return;
    const card = editCardRef.current;
    if (!card) return;
    const measure = () => {
      const pane = scrollPane(card);
      setLimit(pane ? pane.clientHeight - 8 : window.innerHeight - 48);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      setLimit(null);
    };
  }, [editing]);
  // Sized: the whole card comes into view.
  const sized = editing && limit !== null;
  useEffect(() => {
    if (sized) editCardRef.current?.scrollIntoView({ block: "nearest" });
  }, [sized]);

  function cancel() {
    cancelDraft();
    setEditing(false);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === getOriginal()) {
      cancel();
      return;
    }
    markSaved(trimmed);
    setEditing(false);
    await actions.saveNote(note.id, trimmed);
  }

  // Pop out: the floating card takes the draft and this card's editor closes
  // (its flush saves the draft). A drag on the bar does the same once the
  // pointer has moved, and the card lands under the pointer.
  function popOut(place?: { left: number; top: number; grab: { dx: number; dy: number } }) {
    const current = draft;
    setEditing(false);
    actions.floatNote({ id: note.id, draft: current, original: getOriginal(), ...place });
  }

  function startDragOut(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const card = editCardRef.current;
    if (!card) return;
    e.preventDefault();
    const fromX = e.clientX;
    const fromY = e.clientY;
    const rect = card.getBoundingClientRect();
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
    };
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - fromX) < 8 && Math.abs(ev.clientY - fromY) < 8) return;
      stop();
      // The pointer keeps its spot on the bar; the floating card is narrower
      // than a wide tray, so the spot is capped inside it.
      const grab = { dx: Math.min(fromX - rect.left, 200), dy: fromY - rect.top };
      popOut({ left: ev.clientX - grab.dx, top: ev.clientY - grab.dy, grab });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
  }

  if (floating) {
    return (
      <div
        data-note-id={note.id}
        className="rounded-2xl border border-dashed border-clay-300 bg-card/60 p-3.5 text-[13px]"
      >
        <div className="flex items-center gap-2">
          <span className="text-sand-600">{t("outline.floatingLabel")}</span>
          <button
            onClick={() => actions.dockNote(true)}
            data-track="note-dock"
            title={t("outline.dockBackTitle")}
            className="ml-auto shrink-0 text-xs text-sand-600 hover:text-clay-700"
          >
            {t("outline.dockBack")}
          </button>
        </div>
        <p className="mt-1 truncate text-sand-500">{markdownPreview(note.content)}</p>
      </div>
    );
  }

  if (editing) {
    return (
      <div
        ref={editCardRef}
        data-note-id={note.id}
        style={limit !== null ? { maxHeight: limit } : undefined}
        className="flex flex-col rounded-2xl bg-card p-3 shadow-soft outline-2 outline-clay-400"
      >
        <NoteEditor
          className="min-h-0 flex-1"
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
            if (e.key === "Escape") cancel();
          }}
          dragBar={tray ? { onPointerDown: startDragOut, title: t("outline.dragOut") } : undefined}
        />
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <button
            onClick={() => void save()}
            data-track="note-save"
            className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
          >
            {t("common.save")}
          </button>
          <button
            onClick={cancel}
            data-track="note-cancel"
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
          {tray && (
            <button
              onClick={() => popOut()}
              data-track="note-pop-out"
              title={t("outline.popOutTitle")}
              className="ml-auto flex items-center gap-1 text-xs text-sand-600 hover:text-clay-700"
            >
              <ExpandIcon size={12} />
              {t("outline.popOut")}
            </button>
          )}
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
          data-track="note-unpin"
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
          data-track="note-select"
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
            onClick={() => {
              setDraft(editDraft(note.content));
              setEditing(true);
            }}
            data-track="note-edit"
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
