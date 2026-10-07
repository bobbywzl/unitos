"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/i18n/config";
import { noteTitle } from "@/lib/note-title";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useLang, useT } from "@/components/lang-provider";
import { NoteCard } from "@/components/outline/note-card";
import { NoteComposer } from "@/components/outline/note-composer";
import { SECTION_ADD_NOTE } from "@/components/outline/section-action";
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

/** The Group by picker, and on the tray the scope switch: This document or
    All notes. */
export function NotesOrganize({
  grouping,
  onGrouping,
  scope,
  onScope,
}: {
  grouping: NoteGrouping;
  onGrouping: (g: NoteGrouping) => void;
  scope?: NoteScope;
  onScope?: (s: NoteScope) => void;
}) {
  const t = useT();
  const pill = "rounded-full px-3 py-1 text-[11.5px] font-semibold";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {scope && onScope && (
        <div className="flex rounded-full border border-line p-0.5" role="group" aria-label={t("outline.notesScope")}>
          {(["project", "document"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onScope(s)}
              data-track={`notes-scope:${s}`}
              aria-pressed={scope === s}
              data-tip={t(s === "project" ? "outline.scopeProjectTitle" : "outline.scopeDocumentTitle")}
              className={`${pill} ${scope === s ? "bg-clay-100 text-clay-800" : "text-sand-600 hover:text-clay-800"}`}
            >
              {t(s === "project" ? "outline.scopeProject" : "outline.scopeDocument")}
            </button>
          ))}
        </div>
      )}
      <label className="flex items-center gap-1.5 text-[11.5px] text-sand-600">
        {t("outline.groupBy")}
        <select
          value={grouping}
          onChange={(e) => onGrouping(e.target.value as NoteGrouping)}
          data-track="notes-grouping"
          className="rounded-full border border-line bg-card px-2.5 py-1 text-[11.5px] font-semibold text-sand-700 outline-none hover:bg-clay-100"
        >
          {NOTE_GROUPINGS.map((g) => (
            <option key={g} value={g}>
              {t(`outline.${GROUPING_KEY[g]}`)}
            </option>
          ))}
        </select>
      </label>
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
};

/** The notes in every grouping but section: Last edited as one list, the
    others in groups. No drag: a grouping other than section moves no note. */
export function NoteGroups(props: NoteGroupsProps) {
  return props.grouping === "edited" ? <EditedNotes {...props} /> : <GroupedNotes {...props} />;
}

const allSections = (sections: SectionView[]): SectionView[] =>
  sections.flatMap((section) => [section, ...allSections(section.children)]);

/** Last edited: every note in one list, newest edit first. Note writes a
    new note in the first section, where a new note lands at the top (SPEC.md
    §6). Each section's composer is mounted, so a draft left open in any
    section reopens here as it does under Section. */
function EditedNotes({ tree, actions, variant, search, accepted }: NoteGroupsProps) {
  const t = useT();
  const lang = useLang();
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
  const sorted = groupNotes(notes, "edited", [], lang, { project: "", untitled: "", weekOf: () => "" })[0]?.notes ?? [];
  return (
    <div className="flex flex-col gap-2">
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
      {sorted.length === 0 ? (
        <p className="text-[13px] text-sand-600">{t("outline.byDocumentEmpty")}</p>
      ) : (
        <div className={variant === "page" ? "grid grid-cols-1 gap-2 lg:grid-cols-2" : "flex flex-col gap-2"}>
          {sorted.map((note) => (
            <NoteCard key={note.id} note={note} actions={actions} variant={variant} search={search} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One section's composer under Last edited: the Note button (the first
    section), and the composer while it is open, under the section's name. */
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
  const compose = useNoteCompose({ sectionId: section.id, notes: section.notes, actions, canEdit });
  useEffect(() => {
    onOwned(section.id, compose.noteId);
  }, [onOwned, section.id, compose.noteId]);
  useEffect(() => () => onOwned(section.id, null), [onOwned, section.id]);
  if (!(withAdd && canEdit) && !compose.composing) return null;
  return (
    <div className="flex flex-col gap-2">
      {withAdd && canEdit && !compose.composing && (
        <button
          onClick={compose.open}
          data-track="edited-add-note"
          data-tip={t("outline.addNoteInTitle", { section: section.title })}
          className={`self-start ${SECTION_ADD_NOTE}`}
        >
          <PlusIcon size={14} />
          {t("outline.addNoteBtn")}
        </button>
      )}
      {compose.composing && (
        <>
          <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{section.title}</span>
          {variant === "page" ? (
            <NoteComposer compose={compose} full padding="p-4" />
          ) : (
            <NoteComposer compose={compose} full={false} moreHref={`/n/${actions.notebookId}/notes`} padding="p-3" />
          )}
        </>
      )}
    </div>
  );
}

/** The notes in groups (groupNotes): a header per group that folds it, and
    the notes as cards. */
function GroupedNotes({
  tree,
  grouping,
  documents,
  actions,
  variant,
  search,
  accepted,
}: NoteGroupsProps) {
  const t = useT();
  const lang = useLang();
  const notes = flattenNotes(tree).filter((n) => (!accepted || n.status !== "PENDING") && noteMatches(n, search));
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
              <span className="text-[11px] text-sand-500">{group.notes.length}</span>
            </div>
            {!closed && (
              <div className={variant === "page" ? "grid grid-cols-1 gap-2 lg:grid-cols-2" : "flex flex-col gap-2"}>
                {group.notes.map((note) => (
                  <NoteCard key={note.id} note={note} actions={actions} variant={variant} search={search} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
