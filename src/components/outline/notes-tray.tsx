"use client";

import { TOUCH_HIT } from "@/components/outline/touch-hit";
import Link from "next/link";
import { useEditingNotes } from "@/components/outline/editing-notes";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { dropCardOn, type CardDragEndDetail } from "@/lib/card-drag";
import { isImeKey } from "@/lib/ime";
import { hasQuoteDrag, quoteMarkdown, readQuoteDrag, type QuoteDrag } from "@/lib/quote-drag";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronDownIcon, ChevronRightIcon, MaximizeIcon, PlusIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { CollapsedViewToggle } from "@/components/collapsed-view-toggle";
import { SortableBoard, SortableGroup, SortableItem, useDropHeader } from "@/components/sortable";
import { CardDropShown, shownStore, useCardDropTarget } from "@/components/outline/use-card-drop";
import { quoteLanded } from "@/components/use-note-drop";
import { referenceMarkdownForDrop } from "@/components/outline/reference-drop";
import { dropIndex, notesList, parseListId } from "@/components/outline/board-lists";
import { landingLeft } from "@/components/outline/floating-note-editor";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer, focusComposer } from "@/components/outline/note-composer";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { Collapse } from "@/components/presence";
import { SelectionBar } from "@/components/outline/selection-bar";
import { NoteGroups, NotesViewMenu, useNoteGrouping, type NoteScope } from "@/components/outline/note-groups";
import { shownSectionTitle } from "@/lib/section-title";
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
// page. The tray holds every note of the project, or, when the reader picks
// This document, the open document's alone (SPEC.md §6): the notes written
// in it and the notes that quote it; then a line under the queue says how
// many pending notes wait elsewhere. Group by shows the notes by document,
// week, month, or title instead of by section. A search shows the notes it found whole, with the words it
// found lit up. Renaming sections and composing at length live on the notes
// full page.
export function NotesTray({
  tree,
  pending,
  pendingElsewhere = 0,
  actions,
  documents,
  scope,
  onScope,
  visible = true,
}: {
  tree: SectionView[];
  pending: NoteView[];
  /** Pending notes of other documents and of the project: on the notes full page. */
  pendingElsewhere?: number;
  actions: OutlineActions;
  /** The project's documents, in attach order: the groups of By document. */
  documents: { id: string; title: string }[];
  /** All notes of the project, or the open document's alone. */
  scope: NoteScope;
  onScope: (scope: NoteScope) => void;
  /** The reader sees the tray: false while another tab is on top, the tray
      is folded, or a phone's sheet is closed. Its cards take no card drop
      then, so no grip shows and no card head lifts (SPEC.md §6). */
  visible?: boolean;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  // Whether the tray is on screen, for its cards' drop count: a store the
  // cards read, so showing or hiding the tray draws no card again.
  const [onScreen] = useState(() => shownStore(visible));
  useEffect(() => onScreen.set(visible), [onScreen, visible]);
  // The field takes every key at once; the list follows a moment later
  // (useDeferredValue), so typing never waits for the list.
  const [typed, setQuery] = useState("");
  const query = useDeferredValue(typed);
  // An editor opening or closing redraws the search's list (noteMatches).
  useEditingNotes();
  const [grouping, setGrouping] = useNoteGrouping();
  const label = "text-[11px] font-bold tracking-[0.08em] uppercase";
  const shown = filterSections(tree, query);
  const needle = query.trim();
  const shownPending = pending.filter((n) => noteMatches(n, query));
  // The project holds no note yet: nothing to search, fold, or group.
  const noNotes = scope === "project" && pending.length === 0 && flattenNotes(tree).length === 0 && !query;

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

  // A note the reader asked to see (dissect:show-note: Add to notes, a pick
  // in Add to a note…, a quote dropped here): its section unfolds when it
  // holds it — now, or when the refresh brings it.
  const [reveal, setReveal] = useState<string | null>(null);
  useEffect(() => {
    const onShow = (e: Event) => setReveal((e as CustomEvent<{ noteId: string }>).detail.noteId);
    window.addEventListener("dissect:show-note", onShow);
    return () => window.removeEventListener("dissect:show-note", onShow);
  }, []);

  // A quote let go on the tray off every note (SPEC.md §6): a new note with
  // the quote, in the section under the pointer — at its top on the
  // section's title row, else at its end — or, below every section, at the
  // end of the last one. The section lights while the quote is over it.
  const lastSection = tree.length > 0 ? tree[tree.length - 1].id : null;
  const [quoteOver, setQuoteOver] = useState<{ sectionId: string; top: boolean } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  function quoteTarget(target: EventTarget | null): { sectionId: string; top: boolean } | null {
    const el = target instanceof Element ? target : null;
    // A note, a composer, or an open editor takes the quote itself.
    if (el?.closest("[data-note-id], [data-note-composer]")) return null;
    const section = el?.closest("[data-tray-lead]")
      ? lastSection
      : (el?.closest<HTMLElement>("[data-tray-section]")?.dataset.traySection ?? lastSection);
    if (!section) return null;
    return { sectionId: section, top: Boolean(el?.closest("[data-drop-header]")) };
  }
  async function dropQuote(at: { sectionId: string; top: boolean }, drag: QuoteDrag) {
    setDropError(null);
    quoteLanded();
    try {
      await actions.addDroppedNote(at.sectionId, quoteMarkdown(drag.text), { top: at.top, quote: drag });
    } catch (err) {
      setDropError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }
  const quoteDrop = canEdit
    ? {
        onDragOverCapture: (e: React.DragEvent) => {
          if (!hasQuoteDrag(e.dataTransfer)) return;
          const at = quoteTarget(e.target);
          setQuoteOver((prev) => (prev?.sectionId === at?.sectionId && prev?.top === at?.top ? prev : at));
        },
        onDragOver: (e: React.DragEvent) => {
          if (!hasQuoteDrag(e.dataTransfer) || !quoteTarget(e.target)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: (e: React.DragEvent) => {
          if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setQuoteOver(null);
        },
        onDrop: (e: React.DragEvent) => {
          setQuoteOver(null);
          if (!hasQuoteDrag(e.dataTransfer)) return;
          const at = quoteTarget(e.target);
          const drag = readQuoteDrag(e.dataTransfer);
          if (!at || !drag) return;
          e.preventDefault();
          void dropQuote(at, drag);
        },
      }
    : {};
  // The same for a highlight held in the reader's text (lib/card-drag.ts),
  // and an annotation: a new note with its annotation reference. Off every
  // section: the last section's end.
  async function takeCardDrop(sectionId: string, top: boolean, { drag }: CardDragEndDetail) {
    setDropError(null);
    try {
      if (drag.kind === "quote" && drag.quote) {
        quoteLanded();
        await actions.addDroppedNote(sectionId, quoteMarkdown(drag.quote.text), { top, quote: drag.quote });
      } else if (drag.kind === "annotation" && drag.reference) {
        const markdown = await referenceMarkdownForDrop(actions.notebookId, drag.reference, t);
        await actions.addDroppedNote(sectionId, markdown, {
          top,
          annotationId: drag.reference.quote ? drag.reference.annotationId : undefined,
        });
      }
    } catch (err) {
      setDropError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }
  const spaceDrop = useCardDropTarget(
    "tray-space",
    (end) => {
      if (lastSection) void takeCardDrop(lastSection, false, end);
    },
    false,
  );
  const cardOver = spaceDrop.over && (spaceDrop.drag?.kind === "quote" || spaceDrop.drag?.kind === "annotation");
  const quoteAt = quoteOver ?? (cardOver && lastSection ? { sectionId: lastSection, top: false } : null);

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

  // The pending queue and the line under it. They stand inside the list that
  // holds the Note and Command row — the first section, or the grouped list —
  // above that row, so the row can stick to the foot of a phone's notes sheet
  // (TOOL15-15): Note and Command stay in view while pending notes fill the
  // sheet. A quote or a card let go on the queue lands where it did before,
  // at the end of the last section.
  const leadInList = grouping !== "section" || shown.length > 0;
  const pendingLead =
    shownPending.length > 0 || (pendingElsewhere > 0 && !needle) ? (
      <div
        data-tray-lead=""
        data-note-drop-target={leadInList && canEdit && lastSection ? "tray-space" : undefined}
        className={`flex flex-col gap-3.5 ${leadInList ? "pb-1.5" : ""}`}
      >
        {shownPending.length > 0 && (
          <div data-pending-queue="" className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className={`${label} text-clay-800`}>
                {t("outline.pendingHeader", { n: shownPending.length })}
              </span>
              {/* Enter and Backspace still accept and reject the note the
                  reader is on; their tooltips say so. */}
              {canEdit && shownPending.length > 1 && (
                <button
                  onClick={() => {
                    for (const note of shownPending) void actions.acceptNote(note.id);
                  }}
                  data-track="notes-accept-all"
                  data-tip={t("outline.acceptAllTitle")}
                  className={`ml-auto text-[11.5px] font-semibold text-sage-700 hover:text-sage-800 ${TOUCH_HIT}`}
                >
                  {t("outline.acceptAll")}
                </button>
              )}
            </div>
            {shownPending.map((note) => (
              <NoteCard key={actions.noteKey(note.id)} note={note} actions={actions} variant="tray" search={query} />
            ))}
          </div>
        )}

        {pendingElsewhere > 0 && !needle && (
          <Link
            href={`/n/${actions.notebookId}/notes`}
            data-track="notes-pending-elsewhere"
            data-tip={t("outline.pendingElsewhereTitle")}
            className="text-[12px] text-sand-600 hover:text-clay-800"
          >
            {t("outline.pendingElsewhere", { n: pendingElsewhere })}
          </Link>
        )}
      </div>
    ) : null;

  return (
    <CardDropShown.Provider value={onScreen}>
    <div
      className="flex min-h-full flex-col gap-3.5"
      {...quoteDrop}
      data-note-drop-target={canEdit && lastSection ? "tray-space" : undefined}
    >
      {/* One row before the notes (SPEC.md §6): the search, Expand all, the
          view menu (which notes show, Group by), and the notes full page.
          A project with no note yet shows no row: every control in it acts
          on notes, and the empty state is its one line. */}
      {!noNotes && (
        <div className="flex items-center gap-1.5">
          <input
            value={typed}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && !isImeKey(e) && setQuery("")}
            placeholder={t("outline.searchNotes")}
            aria-label={t("outline.searchNotes")}
            type="search"
            className="min-w-0 flex-1 rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
          />
          <CollapsedViewToggle view={actions.notesView} onChange={actions.setNotesView} track="notes-view" />
          <NotesViewMenu grouping={grouping} onGrouping={setGrouping} scope={scope} onScope={onScope} />
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
      )}

      {!leadInList && pendingLead}

      {/* One drag across the tray (SPEC.md §6): a hold anywhere on a note
          picks it up; a note dropped in another section moves there, a note
          held over another until the ring closes joins it, and a note let go
          over the article floats there. */}
      {grouping !== "section" ? (
        <NoteGroups
          tree={tree}
          grouping={grouping}
          documents={documents}
          actions={actions}
          variant="tray"
          search={query}
          accepted
          onMerge={onMerge}
          onDropOutside={onDropOutside}
          lead={pendingLead}
        />
      ) : (
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
            {dropError && <p className="text-xs text-red-500">{dropError}</p>}
            {shown.map((section, i) => (
              <TraySection
                key={section.id}
                section={section}
                actions={actions}
                labelClass={label}
                search={query}
                nudgeFirst={i === 0}
                lead={i === 0 ? pendingLead : undefined}
                reveal={reveal}
                quoteAt={quoteAt}
                onCardDrop={(sectionId, top, end) => void takeCardDrop(sectionId, top, end)}
              />
            ))}
          </div>
        </SortableBoard>
      )}

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
    </div>
    </CardDropShown.Provider>
  );
}

/** Whether the section, or a section in it, holds the note. */
function holdsNote(section: SectionView, id: string): boolean {
  return section.notes.some((n) => n.id === id) || section.children.some((c) => holdsNote(c, id));
}

function TraySection({
  section,
  actions,
  labelClass,
  search,
  nudgeFirst,
  lead,
  nested,
  reveal,
  quoteAt,
  onCardDrop,
}: {
  section: SectionView;
  actions: OutlineActions;
  labelClass: string;
  /** The search the section's notes were found by. */
  search: string;
  /** The first section of the tray: its first note is the onboarding nudge's target. */
  nudgeFirst?: boolean;
  /** The pending queue, drawn above the first section's title row; the row
      then sticks to the foot of a phone's notes sheet while it is below. */
  lead?: React.ReactNode;
  nested?: boolean;
  /** A note the tray was asked to show: the section unfolds when it holds it. */
  reveal: string | null;
  /** The section a quote is over, off every note: that section lights, and
      on its title row the note lands at the top. */
  quoteAt: { sectionId: string; top: boolean } | null;
  /** A highlight or an annotation let go on a section (lib/card-drag.ts). */
  onCardDrop: (sectionId: string, top: boolean, end: CardDragEndDetail) => void;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [collapsed, setCollapsed] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // The composer auto-saves (use-note-compose.ts); the note it owns stays out of the list.
  const compose = useNoteCompose({ sectionId: section.id, notes: section.notes, actions, canEdit });
  const accepted = compose.visibleNotes.filter((n) => n.status !== "PENDING");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = notesList(section.id);
  // A note held over the title row lands at the top of the section, folded
  // or not (sortable.tsx data-drop-header).
  const headerLit = useDropHeader(listId);
  // A highlight or an annotation held over the title row, or the section's space.
  const takesCards = canEdit;
  const headerDrop = useCardDropTarget(`section-top:${section.id}`, (end) => onCardDrop(section.id, true, end), false);
  const spaceDrop = useCardDropTarget(`section:${section.id}`, (end) => onCardDrop(section.id, false, end), false);
  const quoteOver = quoteAt?.sectionId === section.id ? quoteAt : null;
  const cardKind = (headerDrop.drag ?? spaceDrop.drag)?.kind;
  const cardTakes = cardKind === "quote" || cardKind === "annotation";
  const lit = Boolean(quoteOver) || (cardTakes && (headerDrop.over || spaceDrop.over));
  const litTop = (quoteOver?.top ?? false) || (cardTakes && headerDrop.over);

  // The note the tray was asked to show is in here: the section unfolds.
  const [revealed, setRevealed] = useState<string | null>(null);
  if (reveal && reveal !== revealed && holdsNote(section, reveal)) {
    setRevealed(reveal);
    if (collapsed) setCollapsed(false);
  }

  return (
    <div
      ref={rootRef}
      data-tray-section={section.id}
      data-note-drop-target={takesCards ? `section:${section.id}` : undefined}
      className={`group/section flex flex-col gap-2 rounded-2xl transition-colors ${nested ? "pl-3" : ""} ${
        lit && !litTop ? "outline-2 outline-offset-4 outline-dashed outline-clay-400" : ""
      }`}
    >
      {lead}
      <div
        data-drop-header={listId}
        data-drop-first={accepted[0]?.id ?? ""}
        data-note-drop-target={takesCards ? `section-top:${section.id}` : undefined}
        className={`-mx-1.5 flex items-baseline gap-2 rounded-full px-1.5 transition-colors ${
          lead ? "max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-my-1 max-md:bg-sand-100 max-md:py-1" : ""
        } ${
          headerLit || litTop ? "bg-clay-100 ring-2 ring-clay-400" : ""
        }`}
      >
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
          {shownSectionTitle(section.title, t)}
        </button>
        {accepted.length > 0 && <span className="text-[11px] text-sand-500">{accepted.length}</span>}
        {/* A quote or an annotation over the title row: the row itself says
            where its note lands, so the notes under it stay where they are. */}
        {litTop && (
          <span aria-live="polite" className="ml-auto min-w-0 truncate text-[11.5px] font-semibold text-clay-700">
            {t("outline.dropQuoteSectionTop", { section: shownSectionTitle(section.title, t) })}
          </span>
        )}
        {/* The section's actions stay visible (SPEC.md §6): a pill each, the
            same on the notes full page. */}
        {!collapsed && canEdit && !litTop && (
          <button
            onClick={() => {
              // A second press while the composer is open puts the caret back in it.
              if (compose.composing) focusComposer(rootRef.current);
              else compose.open();
            }}
            data-track="section-add-note"
            data-tip={t("outline.addNoteTitle")}
            className={`ml-auto ${SECTION_ADD_NOTE}`}
          >
            <PlusIcon size={14} />
            {t("outline.addNoteBtn")}
          </button>
        )}
        {!collapsed && canEdit && !litTop && (
          <VoiceNoteButton sectionId={section.id} onError={setVoiceError} className={SECTION_ACTION} compact />
        )}
      </div>
      {voiceError && <p className="text-xs text-red-500">{voiceError}</p>}
      {/* A quote or an annotation over the section says where its note lands. */}
      {lit && !litTop && (
        <p aria-live="polite" className="order-last text-[11.5px] font-semibold text-clay-700">
          {t("outline.dropQuoteSectionEnd", { section: shownSectionTitle(section.title, t) })}
        </p>
      )}

      <Collapse open={!collapsed}>
      {!collapsed && (
        <div className="flex flex-col gap-2">
          {/* The composer sits above the notes: a new note lands at the top of
              the section (SPEC.md §6). */}
          {compose.composing && (
            <NoteComposer
              compose={compose}
              onRelease={() => actions.expectComposed(section.id)}
              padding="p-3"
            />
          )}

          <SortableGroup
            id={notesList(section.id)}
            ids={accepted.map((n) => n.id)}
            className="flex flex-col gap-2"
          >
            {accepted.map((note, i) => (
              <SortableItem key={actions.noteKey(note.id)} id={note.id}>
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
              reveal={reveal}
              quoteAt={quoteAt}
              onCardDrop={onCardDrop}
            />
          ))}
        </div>
      )}
      </Collapse>
    </div>
  );
}
