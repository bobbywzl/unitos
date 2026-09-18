"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { dropCardOn } from "@/lib/card-drag";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronDownIcon, ChevronRightIcon, MaximizeIcon, PlusIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { SortableBoard, SortableGroup, SortableItem } from "@/components/sortable";
import { dropIndex, notesList, parseListId } from "@/components/outline/board-lists";
import { landingLeft } from "@/components/outline/floating-note-editor";
import { MergeUndoBar } from "@/components/outline/merge-undo";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer } from "@/components/outline/note-composer";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { Collapse } from "@/components/presence";
import { SelectionBar } from "@/components/outline/selection-bar";
import {
  filterSections,
  findSection,
  flattenNotes,
  noteMatches,
  type OutlineActions,
} from "@/components/outline/use-outline";

// The tray is for triage first: pending notes hoist to the top as one queue,
// accepted notes sit under their section label (design 1a), collapsed to one
// line each, and move by a hold anywhere on the card — as on the notes full
// page. A search shows the notes it found whole, with the words it found lit
// up. Renaming sections and composing at length live on the notes full page.
export function NotesTray({
  tree,
  pending,
  actions,
}: {
  tree: SectionView[];
  pending: NoteView[];
  actions: OutlineActions;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [query, setQuery] = useState("");
  const label = "text-[11px] font-bold tracking-[0.08em] uppercase";
  const shown = filterSections(tree, query);
  const needle = query.trim();
  const shownPending = pending.filter((n) => noteMatches(n, query));

  // Every note by id: the drag asks per card on every pointer move whether the
  // two can merge, and the overlay draws the card under the pointer.
  const notesById = useMemo(() => new Map(flattenNotes(tree).map((n) => [n.id, n])), [tree]);

  // A drop lands the note where the line stood in the whole section, pending
  // notes included — the index reorderNote and the server count with. The
  // tray's lists show the accepted notes only, and a search fewer still, so
  // the place is counted in the section's own list (board-lists.ts).
  function onDrop(fromListId: string, toListId: string, itemId: string, beforeId: string | null) {
    const from = parseListId(fromListId);
    const to = parseListId(toListId);
    if (from.kind !== "notes" || to.kind !== "notes" || !from.parentId || !to.parentId) return;
    const target = findSection(tree, to.parentId);
    if (!target) return;
    const index = dropIndex(target.notes, itemId, beforeId, from.parentId === to.parentId);
    if (index === null) return;
    if (from.parentId === to.parentId) actions.reorderNote(from.parentId, itemId, index);
    else void actions.moveNoteToSection(itemId, to.parentId, index);
  }

  // A note let go over the article floats there (SPEC.md §6): the floating
  // card lands where the card was seen, in its draggable mode.
  function onDropOutside(itemId: string, at: { x: number; y: number; grab: { dx: number; dy: number } }) {
    const note = notesById.get(itemId);
    if (!note || !canEdit) return;
    actions.floatNote({
      id: note.id,
      draft: note.content,
      original: note.content,
      left: landingLeft(at.x - at.grab.dx),
      top: Math.max(8, at.y - at.grab.dy),
    });
  }

  // The ring closed: the held note joins the note it covers. The floating
  // card takes its drop itself, so its own words are saved first.
  function onMerge(id: string, intoId: string) {
    const note = notesById.get(id);
    if (!note) return;
    if (actions.floating?.id === intoId) {
      dropCardOn(intoId, { kind: "note", ids: [id], label: "" });
      return;
    }
    void actions.mergeNotes(intoId, [id], "join");
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && !isImeKey(e) && setQuery("")}
          placeholder={t("outline.searchNotes")}
          aria-label={t("outline.searchNotes")}
          type="search"
          className="min-w-0 flex-1 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
        />
        <CollapsedViewToggle view={actions.notesView} onChange={actions.setNotesView} track="notes-view" />
        {/* The notes full page, one press away (SPEC.md §6): the four arrows
            say the notes open out to fill the screen. */}
        <Link
          href={`/n/${actions.notebookId}/notes`}
          data-track="notes-full-page"
          data-nudge="fullPage"
          aria-label={t("panes.notesFullPage")}
          data-tip={t("panes.notesFullPageTitle")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-card text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <MaximizeIcon size={15} />
        </Link>
      </div>

      {shownPending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className={`${label} text-clay-800`}>
              {t("outline.pendingHeader", { n: shownPending.length })}
            </span>
            <span className="ml-auto text-[11px] text-sand-500">{t("outline.trayKeyHint")}</span>
          </div>
          {shownPending.map((note) => (
            <NoteCard key={note.id} note={note} actions={actions} variant="tray" search={query} />
          ))}
        </div>
      )}

      {/* One drag across the tray (SPEC.md §6): a hold anywhere on a note
          picks it up; a note dropped in another section moves there, a note
          held over another until the ring closes joins it, and a note let go
          over the article floats there. */}
      <SortableBoard
        id="tray-board"
        onDrop={onDrop}
        onDropOutside={canEdit ? onDropOutside : undefined}
        onMerge={canEdit ? onMerge : undefined}
        canMerge={(id, intoId) =>
          notesById.get(id)?.status === "ACCEPTED" && notesById.get(intoId)?.status === "ACCEPTED"
        }
        overlay={(itemId) => {
          const note = notesById.get(itemId);
          return note ? <NoteCard note={note} actions={actions} variant="tray" search={query} /> : null;
        }}
      >
        <div className="flex flex-col gap-3.5">
          {shown.map((section, i) => (
            <TraySection
              key={section.id}
              section={section}
              actions={actions}
              labelClass={label}
              search={query}
              nudgeFirst={i === 0}
            />
          ))}
        </div>
      </SortableBoard>

      {needle && shown.length === 0 && shownPending.length === 0 && (
        <p className="text-[13px] text-sand-600">
          {t("outline.noNotesMatch", { query: needle })}
        </p>
      )}

      {tree.length === 0 && (
        <p className="text-[13px] text-sand-600">
          {t("outline.emptyTrayPrefix")}
          <Link href={`/n/${actions.notebookId}/notes`} data-track="notes-full-page" className="text-clay hover:text-clay-600">
            {t("outline.notesFullPage")}
          </Link>
          {t("outline.emptyTraySuffix")}
        </p>
      )}

      <SelectionBar tree={tree} actions={actions} />
      <MergeUndoBar actions={actions} />
    </div>
  );
}

function TraySection({
  section,
  actions,
  labelClass,
  search,
  nudgeFirst,
  nested,
}: {
  section: SectionView;
  actions: OutlineActions;
  labelClass: string;
  /** The search the section's notes were found by. */
  search: string;
  /** The first section of the tray: its first note is the onboarding nudge's target. */
  nudgeFirst?: boolean;
  nested?: boolean;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [collapsed, setCollapsed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // The composer auto-saves (use-note-compose.ts); the note it owns stays out of the list.
  const compose = useNoteCompose({ sectionId: section.id, notes: section.notes, actions, canEdit });
  const accepted = compose.visibleNotes.filter((n) => n.status !== "PENDING");

  return (
    <div className={`group/section flex flex-col gap-2 ${nested ? "pl-3" : ""}`}>
      <div className="flex items-baseline gap-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          data-track="section-collapse"
          aria-expanded={!collapsed}
          data-tip={t("outline.collapseSectionTitle")}
          className={`flex items-center gap-1 ${labelClass} text-sand-600 hover:text-clay-700`}
        >
          <span className="self-center text-sand-400">
            {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
          </span>
          {section.title}
        </button>
        {accepted.length > 0 && <span className="text-[11px] text-sand-500">{accepted.length}</span>}
        {/* The section's actions stay visible (SPEC.md §6): a pill each, the
            same on the notes full page. */}
        {!collapsed && canEdit && (
          <button
            onClick={compose.open}
            data-track="section-add-note"
            data-tip={t("outline.addNoteTitle")}
            className={`ml-auto ${SECTION_ADD_NOTE}`}
          >
            <PlusIcon size={14} />
            {t("outline.addNoteBtn")}
          </button>
        )}
        {!collapsed && canEdit && (
          <VoiceNoteButton sectionId={section.id} onError={setVoiceError} className={SECTION_ACTION} />
        )}
      </div>
      {voiceError && <p className="text-xs text-red-500">{voiceError}</p>}

      <Collapse open={!collapsed}>
      {!collapsed && (
        <div className="flex flex-col gap-2">
          {/* The composer sits above the notes: a new note lands at the top of
              the section (SPEC.md §6). */}
          {compose.composing && (
            <NoteComposer
              compose={compose}
              full={false}
              moreHref={`/n/${actions.notebookId}/notes`}
              padding="p-3"
            />
          )}

          <SortableGroup
            id={notesList(section.id)}
            ids={accepted.map((n) => n.id)}
            className="flex flex-col gap-2"
          >
            {accepted.map((note, i) => (
              <SortableItem key={note.id} id={note.id}>
                {(handle) => (
                  <NoteCard
                    note={note}
                    actions={actions}
                    handle={canEdit ? handle : undefined}
                    variant="tray"
                    search={search}
                    nudge={nudgeFirst && i === 0}
                  />
                )}
              </SortableItem>
            ))}
          </SortableGroup>

          {section.children.map((child) => (
            <TraySection
              key={child.id}
              section={child}
              actions={actions}
              labelClass={labelClass}
              search={search}
              nested
            />
          ))}
        </div>
      )}
      </Collapse>
    </div>
  );
}
