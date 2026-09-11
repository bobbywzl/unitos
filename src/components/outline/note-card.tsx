"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SourceChip } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { ChevronDownIcon, ChevronRightIcon, CommentIcon, LocateIcon, PencilIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { markdownPreview } from "@/lib/markdown-preview";
import { useGist } from "@/lib/gist-client";
import { DragHandle, useMergeTarget, type HandleProps } from "@/components/sortable";
import { useImageDrop } from "@/components/use-image-drop";
import { imageMarkdown } from "@/lib/images";
import { setTaskChecked } from "@/lib/note-markup";
import { startCardDrag } from "@/lib/card-drag";
import { ThinkingIndicator } from "@/components/thinking";
import { NoteEditor } from "@/components/outline/note-editor";
import { NoteHistory } from "@/components/outline/note-history";
import { NoteId } from "@/components/outline/note-id";
import { SaveStateLabel } from "@/components/outline/save-state";
import { landingLeft } from "@/components/outline/floating-note-editor";
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

// Drag out of the tray: a hold on the card's header (or the editor's grip row)
// and a sideways move of this many pixels, farther sideways than up or down,
// floats the note over the article. A shorter move stays a click; a move that
// is mostly vertical is a scroll or a reorder and is ignored. 24px keeps a
// steady hand from floating a note by accident without asking for a long pull.
const DRAG_OUT_PX = 24;
// From the grip the pull is shorter: the grip is for dragging, so 12px sideways
// floats the note, and 6px up or down hands it to the reorder instead — the
// same numbers the reorder sensor uses (sortable.tsx, axis "y").
const GRIP_OUT_PX = 12;
const GRIP_STAY_PX = 6;

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

// A drag that never gets a clean pointerup — the browser takes the pointer, or
// the window loses focus with the button still down — left the swallow below
// on the window, and every click in the app died until a reload (reader
// report). pointercancel and blur are both a release too, and the timer is the
// last resort: the swallow is for one click after a release, never for the
// rest of the session. Longer than any drag, so it never ends a live one.
const SWALLOW_MAX_MS = 30_000;

// The click that follows a release lands on whatever control the drag began
// on. Swallow that one click — and only that one: the listener leaves with the
// release, whether or not a click came.
function swallowNextClick() {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    window.removeEventListener("pointerup", release);
    window.removeEventListener("pointercancel", release);
    window.removeEventListener("blur", release);
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("blur", release);
  const timer = setTimeout(release, SWALLOW_MAX_MS);
}

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
            data-tip={t("outline.anchorUnresolvedTitle", { quote: source.quotedText })}
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
            data-tip={source.quotedText}
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
  const { canEdit, premium, shared, people } = useCollab();
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  // The note's own history, open under the note (note-history.tsx).
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [handledEdit, setHandledEdit] = useState<{ id: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const mergeTarget = useMergeTarget();
  const pending = note.status === "PENDING";
  const focused = pending && actions.focusedPendingId === note.id;
  const tray = variant === "tray";
  const pane = variant === "pane";
  // This note's editor is out in the floating card (floating-note-editor.tsx).
  const floating = actions.floating?.id === note.id;
  // The ticker: accepted notes can be selected for bulk delete, merge, pin, and compare.
  const selectable = note.status === "ACCEPTED" && canEdit && !pane;
  const isSelected = actions.selected.has(note.id);
  // The dragged card covers this one: the ring says a hold here merges them.
  const isMergeTarget = mergeTarget === note.id && note.status === "ACCEPTED";
  // The AI is writing the note that takes this one and the merged notes'
  // place. The card blooms as the merge starts and settles as the text lands
  // (SPEC.md §6, globals.css .note-absorb / .note-merging / .note-merged).
  const merging = actions.merging.has(note.id);
  const [wasMerging, setWasMerging] = useState(false);
  const [merged, setMerged] = useState(false);
  if (merging !== wasMerging) {
    setWasMerging(merging);
    setMerged(!merging);
  }
  useEffect(() => {
    if (!merged) return;
    const timer = setTimeout(() => setMerged(false), 500);
    return () => clearTimeout(timer);
  }, [merged]);
  // Accepted notes collapse to one line; pending notes are read before they are
  // accepted, and a compare pane exists to show the note whole.
  const foldable = note.status === "ACCEPTED" && !pane;
  const collapsed = foldable && actions.isCollapsed(note.id);
  // The collapsed row's line (SPEC.md §6): the note's gist, its first words
  // until the gist arrives. The floating placeholder shows the same line.
  const gist = useGist(note.id, note.gist, markdownPreview(note.content), collapsed || floating);
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

  // Auto-save while the editor is open (SPEC.md §6); Cancel restores the
  // content from before this edit.
  const { draft, setDraft, cancel: cancelDraft, markSaved, confirmSaved, saveState, getOriginal } = useNoteDraft({
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

  // Done closes the editor; the content is already saved by then.
  async function done() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === getOriginal()) {
      cancel();
      return;
    }
    markSaved(trimmed);
    setEditing(false);
    await actions.saveNote(note.id, trimmed);
    confirmSaved(trimmed);
  }

  function openEditor() {
    setDraft(editDraft(note.content));
    setEditing(true);
  }

  // An image dropped on the note goes into the note (SPEC.md §16): into the
  // draft while the editor is open, else appended and saved.
  const imageDrop = useImageDrop({
    premium,
    enabled: canEdit && !floating,
    t,
    onError: setDropError,
    onImages: async (images) => {
      setDropError(null);
      const added = images.map((i) => imageMarkdown(i.id, i.name)).join("\n\n");
      if (editing) {
        setDraft(`${draft.replace(/\s+$/, "")}\n\n${added}\n`);
        return;
      }
      await actions.saveNote(note.id, `${note.content.replace(/\s+$/, "")}\n\n${added}`);
    },
  });
  const dropRing = imageDrop.over ? " outline-2 outline-dashed outline-clay-400" : "";
  const dropTip = imageDrop.over ? t("panes.dropImageIntoNote") : undefined;

  const collapseLabel = collapsed ? t("outline.expandNote") : t("outline.collapseNote");
  // Who wrote the note, on a shared project (SPEC.md §12): every note says
  // it, one's own included, so a collaborator reads the author at a glance.
  const author = shared && note.createdById ? people[note.createdById] : undefined;

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

  // Float the note over the article: the floating card takes the draft — the
  // editor's draft while editing, else the note's content — and this card's
  // editor closes (its flush saves the draft). The card lands under the pointer.
  function popOut(place: { left: number; top: number; grab: { dx: number; dy: number } }) {
    const current = editing ? draft : editDraft(note.content);
    const original = editing ? getOriginal() : note.content;
    setEditing(false);
    actions.floatNote({ id: note.id, draft: current, original, ...place });
  }

  // A hold on the header (or the editor's grip row) and a sideways move of
  // DRAG_OUT_PX floats the note. Until then the press is an ordinary press:
  // the control under it still gets its click. Once the drag begins, the click
  // that would follow the release is swallowed, so a chevron or the id chip
  // under the pointer does not fire too.
  const dragOutEnabled = tray && canEdit && !floating;
  // Another note's card floats over the article right now.
  const floatingElsewhere = Boolean(actions.floating && actions.floating.id !== note.id);
  // Where the pointer was when a card drag ended: the release is the card
  // drag's, so the note floats there when it landed on no target.
  const pointerNow = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const track = (e: PointerEvent) => {
      pointerNow.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", track);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", track);
    };
  }, []);
  function startDragOut(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("[data-no-drag-out], [contenteditable], textarea, input, select")) return;
    const card = editCardRef.current ?? cardRef.current;
    if (!card) return;
    // The grip (the six dots) reorders on a vertical move and drags out on a
    // sideways move. Its reorder sensor starts at 6px down or up and lets go
    // past 12px sideways (sortable.tsx, axis "y"), so the same thresholds
    // decide here: whichever comes first wins, and the two never both run.
    const grip = Boolean((e.target as Element).closest("[data-drag-handle]"));
    const outPx = grip ? GRIP_OUT_PX : DRAG_OUT_PX;
    const stayPx = grip ? GRIP_STAY_PX : DRAG_OUT_PX;
    const fromX = e.clientX;
    const fromY = e.clientY;
    const rect = card.getBoundingClientRect();
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - fromX;
      const dy = ev.clientY - fromY;
      // Mostly vertical: a scroll or a reorder, never a drag out.
      if (Math.abs(dy) >= stayPx && Math.abs(dy) > Math.abs(dx)) {
        stop();
        return;
      }
      if (Math.abs(dx) < outPx || Math.abs(dx) <= Math.abs(dy)) return;
      stop();
      swallowNextClick();
      window.getSelection()?.removeAllRanges();
      // The pointer keeps its spot on the card; the floating card is narrower
      // than a wide tray, so the spot is capped inside it. A card that would
      // hang off the window's edge (a pull by the grip at the card's left,
      // near the tray's right edge) shifts in whole, and the grab point moves
      // with it, so the card stays under the pointer as the drag goes on.
      const grab = { dx: Math.min(fromX - rect.left, 200), dy: fromY - rect.top };
      const float = (x: number, y: number) => {
        const left = landingLeft(x - grab.dx);
        popOut({ left, top: y - grab.dy, grab: { dx: x - left, dy: grab.dy } });
      };
      // A card already floats over the article: this note is dragged toward
      // it. Dropped on it the two merge (SPEC.md §6); dropped anywhere else
      // this note floats there instead, and the other card docks.
      if (floatingElsewhere) {
        // One of the selected notes carries the whole selection, the dragged
        // note first: several notes land in the floating card in one drop.
        const withIt = [...actions.selected].filter((id) => id !== note.id);
        const ids = actions.selected.has(note.id) ? [note.id, ...withIt] : [note.id];
        startCardDrag(
          { clientX: ev.clientX, clientY: ev.clientY },
          {
            kind: "note",
            ids,
            label: ids.length > 1 ? t("outline.selectedCount", { n: ids.length }) : gist,
          },
          (end) => {
            if (end.targetId === null) float(pointerNow.current.x, pointerNow.current.y);
          },
        );
        return;
      }
      float(ev.clientX, ev.clientY);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  // The header row, the same in every state: handle, collapse chevron, id at
  // the left; pin and select at the right. Collapsed, the summary line and the
  // source count sit between them.
  const header = (
    <div
      onPointerDown={dragOutEnabled ? startDragOut : undefined}
      style={dragOutEnabled ? { touchAction: "pan-y" } : undefined}
      data-tip={dragOutEnabled ? t("outline.dragOut") : undefined}
      // The onboarding nudge on the first note: a ghost card slides out of
      // the tray (components/nudges.tsx).
      data-nudge={dragOutEnabled ? "float" : undefined}
      className={`flex min-h-[18px] items-center gap-1.5 ${dragOutEnabled ? "select-none" : ""}`}
    >
      {/* The grip stays visible: it is how a note reorders, and in the tray how
          it drags out over the article (SPEC.md §6). */}
      {handle && !editing && !merging && (
        <div className="-ml-1 opacity-70 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
          <DragHandle handle={handle} label={t(tray ? "outline.gripTitle" : "outline.reorderNote")} />
        </div>
      )}
      {foldable && !editing && !merging && (
        <button
          onClick={() => actions.toggleCollapsed(note.id)}
          data-track="note-collapse"
          aria-expanded={!collapsed}
          aria-label={collapseLabel}
          data-tip={collapseLabel}
          className="-ml-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-sand-400 hover:bg-clay-100 hover:text-clay-800"
        >
          {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
        </button>
      )}
      <NoteId id={note.id} />
      {/* The AI is writing the note that takes this one and the merged notes'
          place (SPEC.md §6). It takes the row: the gist is about to be
          rewritten, and every control here acts on a note still being
          written. */}
      {merging && (
        <ThinkingIndicator label={t("outline.merging")} className="min-w-0 flex-1 text-[11px]" />
      )}
      {collapsed && !merging && (
        <button
          onClick={() => actions.toggleCollapsed(note.id)}
          data-track="note-collapse"
          data-tip={t("outline.expandNote")}
          className="note-merging-under min-w-0 flex-1 overflow-hidden text-left text-[13px] leading-[18px] whitespace-nowrap text-sand-800 hover:text-clay-800"
        >
          {gist}
        </button>
      )}
      {collapsed && note.sources.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500"
          data-tip={note.sources.map((s) => s.documentTitle).join(", ")}
        >
          <AnchorIcon />
          {note.sources.length}
        </span>
      )}
      {collapsed && note.replies.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] text-sand-500"
          data-tip={t("outline.repliesTitle", { n: note.replies.length })}
        >
          <CommentIcon size={11} />
          {note.replies.length}
        </span>
      )}
      {collapsed && author && <PersonBadge person={author} size={14} />}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* The save state, while editing (SPEC.md §6). */}
        {editing && <SaveStateLabel state={saveState} />}
        {canEdit && !editing && !merging && (
          <button
            onClick={openEditor}
            data-track="note-edit"
            aria-label={t("outline.editTitle")}
            data-tip={t("outline.editTitle")}
            // The pencil is the note's main action, so it is the big one in
            // the row: a filled 28px button with a 16px pencil (SPEC.md §6).
            className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-clay-800 hover:bg-clay-200"
          >
            <PencilIcon size={16} />
          </button>
        )}
        {jumpSource && !editing && !merging && (
          <button
            onClick={() => jumpTo(jumpSource)}
            data-track="note-jump"
            aria-label={t("panels.jumpToAnchor")}
            data-tip={t("panels.jumpToAnchor")}
            className="flex size-[18px] items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
          >
            <LocateIcon size={11} />
          </button>
        )}
        {note.pinned && !merging && (
          <button
            onClick={() => canEdit && void actions.setPinned(note.id, false)}
            data-track="note-unpin"
            data-tip={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
            aria-label={canEdit ? t("outline.unpin") : t("outline.pinnedLabel")}
            className="text-clay hover:text-clay-600"
          >
            <PinIcon />
          </button>
        )}
        {selectable && !editing && !merging && (
          <button
            onClick={() => actions.toggleSelect(note.id)}
            data-track="note-select"
            role="checkbox"
            aria-checked={isSelected}
            aria-label={t("outline.selectNote")}
            data-tip={t(tray ? "outline.selectNoteTitle" : "outline.selectNoteTitleCompare")}
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
            data-tip={t("outline.dockBackTitle")}
            className="ml-auto shrink-0 text-xs text-sand-600 hover:text-clay-700"
          >
            {t("outline.dockBack")}
          </button>
        </div>
        <p className="mt-1 overflow-hidden whitespace-nowrap text-sand-500">{gist}</p>
      </div>
    );
  }

  if (editing) {
    return (
      <div
        ref={editCardRef}
        data-note-id={note.id}
        style={limit !== null ? { maxHeight: limit } : undefined}
        {...imageDrop.handlers}
        data-tip={dropTip}
        className={`flex flex-col ${pane ? "outline-2 -outline-offset-2 outline-clay-400" : "rounded-2xl bg-card shadow-soft outline-2 outline-clay-400"} ${PADDING[variant]}${dropRing}`}
      >
        {header}
        {dropError && <p className="mt-1 text-[11px] text-red-500">{dropError}</p>}
        <NoteEditor
          className="mt-1 min-h-0 flex-1"
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (isImeKey(e)) return;
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void done();
            if (e.key === "Escape") cancel();
          }}
          handle={
            tray
              ? { onPointerDown: startDragOut, title: t("outline.dragOut"), label: t("outline.floatingTitle") }
              : undefined
          }
          full={!tray}
          moreHref={tray ? `/n/${actions.notebookId}/notes` : undefined}
        />
        <div className="mt-2 flex shrink-0 items-center gap-2">
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
    isMergeTarget ? "outline-2 outline-sage-500" : isSelected ? "outline-2 outline-clay-300" : "",
    merging ? "note-merging note-absorb" : "",
    merged ? "note-merged" : "",
    imageDrop.over ? "outline-2 outline-dashed outline-clay-400" : "",
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
      {...imageDrop.handlers}
      className={surface}
      data-tip={dropTip ?? (isMergeTarget ? t("outline.holdToMerge") : undefined)}
    >
      {header}
      {dropError && <p className="mt-1 text-[11px] text-red-500">{dropError}</p>}

      {!collapsed && (
        <div className="note-body mt-1">
          {/* A checklist item's box ticks without opening the editor. */}
          <Markdown
            breaks
            onToggleTask={
              canEdit
                ? (line, checked) => void actions.saveNote(note.id, setTaskChecked(note.content, line, checked))
                : undefined
            }
          >
            {note.content}
          </Markdown>
          {note.sources.length > 0 && (tray || !pending) && (
            <div className="mt-2.5">
              <SourceChips sources={note.sources} notebookId={actions.notebookId} />
            </div>
          )}
          {author && (
            <div className="mt-1.5">
              <span className="inline-flex max-w-40 items-center gap-1 text-[11px] text-sand-600" data-tip={author.name}>
                <PersonBadge person={author} size={15} />
                <span className="truncate">{author.name}</span>
              </span>
            </div>
          )}
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
            data-tip={t("outline.acceptTitle")}
          >
            {t("common.accept")}
          </button>
          <button
            onClick={() => void actions.rejectNote(note.id)}
            data-track="note-reject"
            className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            data-tip={t("outline.rejectTitle")}
          >
            {t("common.reject")}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(note.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            data-track="note-copy"
            className="text-xs text-sand-600 hover:text-clay-700"
            data-tip={t("outline.copyTitle")}
          >
            {copied ? t("outline.copied") : t("outline.copy")}
          </button>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            data-track="note-history"
            aria-expanded={historyOpen}
            data-tip={t("outline.historyTitle")}
            className={`text-xs hover:text-clay-700 ${historyOpen ? "text-clay-700" : "text-sand-600"}`}
          >
            {t("outline.history")}
          </button>
          {canEdit && (
            <button
              onClick={() => {
                if (confirm(t("outline.confirmDeleteNote"))) void actions.deleteNote(note.id);
              }}
              data-track="note-delete"
              data-tip={t("outline.deleteNoteTitle")}
              className="text-xs text-red-500 hover:text-red-700"
            >
              {t("common.delete")}
            </button>
          )}
        </div>
      )}
      {historyOpen && !collapsed && note.status === "ACCEPTED" && (
        <NoteHistory
          noteId={note.id}
          content={note.content}
          updatedAt={note.updatedAt}
          onRestore={canEdit ? (content) => actions.saveNote(note.id, content) : undefined}
        />
      )}
    </div>
  );
}
