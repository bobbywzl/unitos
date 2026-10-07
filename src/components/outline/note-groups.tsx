"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isImeKey } from "@/lib/ime";
import type { Lang } from "@/lib/i18n/config";
import { noteTitle } from "@/lib/note-title";
import type { NoteView, SectionView } from "@/lib/types";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { NEW_GLOW_CLASS, NewPill } from "@/components/new-feature";
import { menuRowClass } from "@/components/reader/note-picker";
import { useCollab } from "@/components/collab/collab-context";
import { useLang, useT } from "@/components/lang-provider";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer } from "@/components/outline/note-composer";
import { SECTION_ACTION, SECTION_ADD_NOTE } from "@/components/outline/section-action";
import { SortableBoard, SortableGroup, SortableItem } from "@/components/sortable";
import { VoiceNoteButton } from "@/components/outline/voice-note";
import { useNoteCompose } from "@/components/outline/use-note-compose";
import { flattenNotes, noteMatches, type OutlineActions } from "@/components/outline/use-outline";

// How the notes are grouped (SPEC.md §6), on the tray and on the notes full
// page: last edited, newest first, in one list (the default); by section
// (the reader's own categories, where notes drag and drop); by document; by
// the week or the month a note was made; or by title, A to Z. Every grouping
// but section is a view: it moves no note, and a note still edits,
// collapses, and opens its source in it. One choice per browser, the same
// on both surfaces.
export type NoteGrouping = "edited" | "section" | "document" | "week" | "month" | "title";
export const NOTE_GROUPINGS: NoteGrouping[] = ["edited", "section", "document", "week", "month", "title"];

// What the tray shows: the open document's notes, or every note of the
// project. One choice per browser.
export type NoteScope = "document" | "project";

const GROUPING_STORE = "unitos-notes-grouping";
const SCOPE_STORE = "unitos-notes-scope";
const CHANGE_EVENT = "unitos:notes-organize";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts this page alone.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useNoteGrouping(): [NoteGrouping, (g: NoteGrouping) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(GROUPING_STORE), () => null);
  const grouping = NOTE_GROUPINGS.includes(stored as NoteGrouping) ? (stored as NoteGrouping) : "edited";
  return [grouping, useCallback((g: NoteGrouping) => write(GROUPING_STORE, g), [])];
}

/** The tray's scope. The project's every note unless the reader picked the
    open document's alone: a note written outside the document (on the
    notes full page, or before notes kept their document) shows too. */
export function useNoteScope(): [NoteScope, (s: NoteScope) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(SCOPE_STORE), () => null);
  const scope: NoteScope = stored === "document" ? "document" : "project";
  return [scope, useCallback((s: NoteScope) => write(SCOPE_STORE, s), [])];
}

export type NoteGroup = { key: string; title: string; notes: NoteView[] };

/** The document a note belongs to: the one it was written in, else the
    first it quotes. null = the project as a whole. */
function noteDocument(note: NoteView): string | null {
  return note.documentId ?? note.sources.find((s) => s.documentId)?.documentId ?? null;
}

const createdMs = (note: NoteView): number => {
  const ms = note.createdAt ? Date.parse(note.createdAt) : NaN;
  return Number.isNaN(ms) ? Date.now() : ms;
};

/** Monday of the note's week, at midnight, local time. */
function weekStart(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const editedMs = (note: NoteView): number => {
  const ms = Date.parse(note.updatedAt);
  return Number.isNaN(ms) ? createdMs(note) : ms;
};

/** The notes in groups for every grouping but section. Last edited is one
    group, newest edit first. Weeks and months run newest first, and the
    notes in them newest first; documents run in attach order, then the
    project; titles run A to Z. */
export function groupNotes(
  notes: NoteView[],
  grouping: Exclude<NoteGrouping, "section">,
  documents: { id: string; title: string }[],
  lang: Lang,
  labels: { project: string; untitled: string; weekOf: (date: string) => string },
): NoteGroup[] {
  const locale = lang === "zh" ? "zh-CN" : "en-US";
  if (grouping === "edited") {
    const sorted = [...notes].sort((a, b) => editedMs(b) - editedMs(a));
    return sorted.length > 0 ? [{ key: "edited", title: "", notes: sorted }] : [];
  }
  if (grouping === "document") {
    const known = new Set(documents.map((d) => d.id));
    const byDoc = new Map<string, NoteView[]>();
    for (const note of notes) {
      const doc = noteDocument(note);
      const key = doc && known.has(doc) ? doc : "";
      byDoc.set(key, [...(byDoc.get(key) ?? []), note]);
    }
    return [
      ...documents.filter((d) => byDoc.has(d.id)).map((d) => ({ key: d.id, title: d.title, notes: byDoc.get(d.id)! })),
      ...(byDoc.has("") ? [{ key: "project", title: labels.project, notes: byDoc.get("")! }] : []),
    ];
  }
  if (grouping === "title") {
    const titled = notes.map((note) => ({ note, title: noteTitle(note.content).trim() || (note.gist ?? "").trim() }));
    titled.sort((a, b) => (a.title || "￿").localeCompare(b.title || "￿", locale, { sensitivity: "base" }));
    const groups: NoteGroup[] = [];
    for (const { note, title } of titled) {
      const first = title ? title[0].toLocaleUpperCase(locale) : "";
      const key = /[\p{L}\p{N}]/u.test(first) ? first : "#";
      const label = title ? key : labels.untitled;
      const last = groups[groups.length - 1];
      if (last && last.key === (title ? key : "untitled")) last.notes.push(note);
      else groups.push({ key: title ? key : "untitled", title: label, notes: [note] });
    }
    return groups;
  }
  const sorted = [...notes].sort((a, b) => createdMs(b) - createdMs(a));
  const groups: NoteGroup[] = [];
  for (const note of sorted) {
    const ms = createdMs(note);
    let key: string;
    let title: string;
    if (grouping === "week") {
      const start = weekStart(ms);
      key = start.toISOString();
      title = labels.weekOf(start.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }));
    } else {
      const d = new Date(ms);
      key = `${d.getFullYear()}-${d.getMonth()}`;
      title = d.toLocaleDateString(locale, { year: "numeric", month: "long" });
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.notes.push(note);
    else groups.push({ key, title, notes: [note] });
  }
  return groups;
}

const GROUPING_KEY: Record<
  NoteGrouping,
  "groupByEdited" | "groupBySection" | "groupByDocument" | "groupByWeek" | "groupByMonth" | "groupByTitle"
> = {
  edited: "groupByEdited",
  section: "groupBySection",
  document: "groupByDocument",
  week: "groupByWeek",
  month: "groupByMonth",
  title: "groupByTitle",
};

/** The notes' view menu, beside the search (SPEC.md §6): on the tray the
    scope (All notes or This document) and Group by; on the notes full page
    Group by and Document columns. One icon in place of the scope's two
    pills and the Group by select; the button reads pressed while the tray
    shows This document alone, so a filtered tray says so at rest. */
export function NotesViewMenu({
  grouping,
  onGrouping,
  scope,
  onScope,
  onColumns,
  columnsNew,
}: {
  grouping: NoteGrouping;
  onGrouping: (g: NoteGrouping) => void;
  scope?: NoteScope;
  onScope?: (s: NoteScope) => void;
  /** The notes full page: Document columns, one column per document. */
  onColumns?: () => void;
  /** Document columns is new (the New glow, SPEC.md §18). */
  columnsNew?: boolean;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const filtered = scope === "document";
  const now = [
    ...(scope ? [t(scope === "project" ? "outline.scopeProject" : "outline.scopeDocument")] : []),
    t(`outline.${GROUPING_KEY[grouping]}`),
  ].join(" · ");
  const head = "px-2.5 pt-1.5 pb-0.5 text-[10.5px] font-bold tracking-[0.08em] text-sand-500 uppercase";
  const row = (on: boolean) =>
    `${menuRowClass} justify-between ${on ? "font-semibold text-clay-800" : ""}`;
  const tick = (on: boolean) => (on ? <CheckIcon size={12} /> : null);
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-track="notes-view-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("outline.notesViewMenu")}
        data-tip={`${t("outline.notesViewMenu")}\n${now}`}
        className={`relative flex size-8 items-center justify-center rounded-full shadow-soft hover:bg-clay-100 hover:text-clay-800 ${
          filtered ? "bg-clay-100 text-clay-800" : "bg-card text-sand-700"
        }${columnsNew ? ` ${NEW_GLOW_CLASS}` : ""}`}
      >
        <svg aria-hidden width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        {filtered && <span aria-hidden className="absolute top-0.5 right-0.5 size-2 rounded-full bg-clay" />}
      </button>
      {open && (
        <div
          role="menu"
          className="menu-in absolute top-full right-0 z-30 mt-1 w-56 rounded-2xl border border-line bg-card p-1.5 shadow-float"
        >
          {scope && onScope && (
            <div role="group" aria-label={t("outline.notesScope")}>
              <p className={head}>{t("outline.notesScope")}</p>
              {(["project", "document"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="menuitemradio"
                  aria-checked={scope === s}
                  onClick={() => {
                    onScope(s);
                    setOpen(false);
                  }}
                  data-track={`notes-scope:${s}`}
                  data-tip={t(s === "project" ? "outline.scopeProjectTitle" : "outline.scopeDocumentTitle")}
                  className={row(scope === s)}
                >
                  {t(s === "project" ? "outline.scopeProject" : "outline.scopeDocument")}
                  {tick(scope === s)}
                </button>
              ))}
            </div>
          )}
          <div role="group" aria-label={t("outline.groupBy")}>
            <p className={head}>{t("outline.groupBy")}</p>
            {NOTE_GROUPINGS.map((g) => (
              <button
                key={g}
                type="button"
                role="menuitemradio"
                aria-checked={grouping === g}
                onClick={() => {
                  onGrouping(g);
                  setOpen(false);
                }}
                data-track={`notes-grouping:${g}`}
                className={row(grouping === g)}
              >
                {t(`outline.${GROUPING_KEY[g]}`)}
                {tick(grouping === g)}
              </button>
            ))}
            {onColumns && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onColumns();
                }}
                data-track="by-document"
                data-tip={t("outline.byDocumentTitle")}
                className={row(false)}
              >
                <span className="flex items-center gap-1.5">
                  {t("outline.documentColumns")}
                  {columnsNew && <NewPill />}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type NoteGroupsProps = {
  tree: SectionView[];
  grouping: Exclude<NoteGrouping, "section">;
  documents: { id: string; title: string }[];
  actions: OutlineActions;
  variant: "tray" | "page";
  search: string;
  /** The tray: accepted notes alone (pending notes wait in the queue above). */
  accepted?: boolean;
  /** The ring closed: the held note joins the note it covers. */
  onMerge?: (id: string, intoId: string) => void;
  /** The tray: a note let go over the article floats there. */
  onDropOutside?: (itemId: string, at: { x: number; y: number; grab: { dx: number; dy: number } }) => void;
};

/** The notes in every grouping but section: Last edited as one list, the
    others in groups. A grouping other than section moves no note, so no
    drop line draws; a hold still merges a note into the one it covers and,
    on the tray, floats it out over the article (SPEC.md §6). Note writes a
    new note in the first section, under every grouping. */
export function NoteGroups(props: NoteGroupsProps) {
  const { tree, actions, variant, search, accepted, onMerge, onDropOutside } = props;
  const { canEdit } = useCollab();
  const sections = allSections(tree);
  // The notes the composers own, by section: they stay out of the list while
  // a composer owns them, as in a section.
  const [owned, setOwned] = useState<ReadonlyMap<string, string>>(new Map());
  const onOwned = useCallback((sectionId: string, noteId: string | null) => {
    setOwned((prev) => {
      if ((prev.get(sectionId) ?? null) === noteId) return prev;
      const next = new Map(prev);
      if (noteId) next.set(sectionId, noteId);
      else next.delete(sectionId);
      return next;
    });
  }, []);
  const ownedIds = new Set(owned.values());
  const notes = flattenNotes(tree).filter(
    (n) => !ownedIds.has(n.id) && (!accepted || n.status !== "PENDING") && noteMatches(n, search),
  );
  const notesById = new Map(notes.map((n) => [n.id, n]));
  return (
    <div className="flex flex-col gap-2">
      {/* Each section's composer is mounted, so a draft left open in any
          section reopens here as it does under Section. */}
      {sections.map((section, i) => (
        <SectionComposer
          key={section.id}
          section={section}
          actions={actions}
          variant={variant}
          canEdit={canEdit}
          withAdd={i === 0}
          onOwned={onOwned}
        />
      ))}
      <SortableBoard
        id={`note-groups:${variant}`}
        onMerge={canEdit ? onMerge : undefined}
        onDropOutside={canEdit ? onDropOutside : undefined}
        canMerge={(id, intoId) =>
          notesById.get(id)?.status === "ACCEPTED" && notesById.get(intoId)?.status === "ACCEPTED"
        }
        overlay={(itemId) => {
          const note = notesById.get(itemId);
          return note ? <NoteCard note={note} actions={actions} variant={variant} search={search} /> : null;
        }}
      >
        {props.grouping === "edited" ? (
          <EditedNotes {...props} notes={notes} canEdit={canEdit} />
        ) : (
          <GroupedNotes {...props} notes={notes} canEdit={canEdit} />
        )}
      </SortableBoard>
    </div>
  );
}

const allSections = (sections: SectionView[]): SectionView[] =>
  sections.flatMap((section) => [section, ...allSections(section.children)]);

type ListProps = NoteGroupsProps & { notes: NoteView[]; canEdit: boolean };

/** One group's notes as cards a hold picks up. The page's two columns keep
    each card's own height: a one-line note never stretches to its
    neighbour's. */
function GroupList({ id, notes, actions, variant, search, canEdit }: ListProps & { id: string }) {
  return (
    <SortableGroup
      id={id}
      ids={notes.map((n) => n.id)}
      className={variant === "page" ? "grid grid-cols-1 items-start gap-2 lg:grid-cols-2" : "flex flex-col gap-2"}
    >
      {notes.map((note) => (
        <SortableItem key={actions.noteKey(note.id)} id={note.id}>
          {(handle) => (
            <NoteCard
              note={note}
              actions={actions}
              handle={canEdit ? handle : undefined}
              variant={variant}
              search={search}
            />
          )}
        </SortableItem>
      ))}
    </SortableGroup>
  );
}

/** Last edited: every note in one list, newest edit first. */
function EditedNotes(props: ListProps) {
  const t = useT();
  const lang = useLang();
  const sorted = groupNotes(props.notes, "edited", [], lang, { project: "", untitled: "", weekOf: () => "" })[0]?.notes ?? [];
  if (sorted.length === 0) return <p className="text-[13px] text-sand-600">{t("outline.byDocumentEmpty")}</p>;
  return <GroupList {...props} id="group:edited" notes={sorted} />;
}

/** The Note button and Command for the first section, and each section's
    composer while it is open, under the section's name. */
function SectionComposer({
  section,
  actions,
  variant,
  canEdit,
  withAdd,
  onOwned,
}: {
  section: SectionView;
  actions: OutlineActions;
  variant: "tray" | "page";
  canEdit: boolean;
  withAdd: boolean;
  onOwned: (sectionId: string, noteId: string | null) => void;
}) {
  const t = useT();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const compose = useNoteCompose({ sectionId: section.id, notes: section.notes, actions, canEdit });
  useEffect(() => {
    onOwned(section.id, compose.noteId);
  }, [onOwned, section.id, compose.noteId]);
  useEffect(() => () => onOwned(section.id, null), [onOwned, section.id]);
  if (!(withAdd && canEdit) && !compose.composing) return null;
  return (
    <div className="flex flex-col gap-2">
      {withAdd && canEdit && !compose.composing && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={compose.open}
            data-track="edited-add-note"
            data-tip={t("outline.addNoteInTitle", { section: section.title })}
            className={SECTION_ADD_NOTE}
          >
            <PlusIcon size={14} />
            {t("outline.addNoteBtn")}
          </button>
          <VoiceNoteButton
            sectionId={section.id}
            onError={setVoiceError}
            className={SECTION_ACTION}
            compact={variant === "tray"}
          />
        </div>
      )}
      {voiceError && <p className="text-xs text-red-500">{voiceError}</p>}
      {compose.composing && (
        <>
          <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{section.title}</span>
          {/* The note joins the list the moment the server has it, as in a
              section (use-outline.ts expectComposed). */}
          <NoteComposer
            compose={compose}
            onRelease={() => actions.expectComposed(section.id)}
            full={variant === "page"}
            padding={variant === "page" ? "p-4" : "p-3"}
          />
        </>
      )}
    </div>
  );
}

/** The notes in groups (groupNotes): a header per group that folds it, and
    the notes as cards. */
function GroupedNotes(props: ListProps) {
  const { notes, grouping, documents } = props;
  const t = useT();
  const lang = useLang();
  const groups = groupNotes(notes, grouping, documents, lang, {
    project: t("outline.groupProject"),
    untitled: t("outline.groupUntitled"),
    weekOf: (date) => t("outline.groupWeekOf", { date }),
  });
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (groups.length === 0) return <p className="text-[13px] text-sand-600">{t("outline.byDocumentEmpty")}</p>;
  return (
    <div className="flex flex-col gap-3.5">
      {groups.map((group) => {
        const closed = folded.has(group.key);
        // One count rule on every surface: the accepted notes.
        const count = group.notes.filter((n) => n.status !== "PENDING").length;
        return (
          <div key={group.key} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <button
                onClick={() => toggle(group.key)}
                data-track="note-group-collapse"
                aria-expanded={!closed}
                className="flex min-w-0 items-center gap-1 text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase hover:text-clay-700"
              >
                <span className="self-center text-sand-400">
                  {closed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
                </span>
                <span className="truncate">{group.title}</span>
              </button>
              {count > 0 && <span className="text-[11px] text-sand-500">{count}</span>}
            </div>
            {!closed && <GroupList {...props} id={`group:${group.key}`} notes={group.notes} />}
          </div>
        );
      })}
    </div>
  );
}
