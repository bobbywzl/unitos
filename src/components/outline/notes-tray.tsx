"use client";

import Link from "next/link";
import { useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { NoteView, SectionView } from "@/lib/types";
import { ChevronDownIcon, ChevronRightIcon } from "@/components/icons";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { NoteCard } from "@/components/outline/note-card";
import { NoteEditor } from "@/components/outline/note-editor";
import { Collapse } from "@/components/presence";
import { SelectionBar } from "@/components/outline/selection-bar";
import { filterSections, type OutlineActions } from "@/components/outline/use-outline";

// The tray is for triage, not reorganizing: pending notes hoist to the top as one
// queue, accepted notes sit under their section label (design 1a). Reordering,
// renaming, and composing at length live on the notes full page.
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
  const [query, setQuery] = useState("");
  const label = "text-[11px] font-bold tracking-[0.08em] uppercase";
  const shown = filterSections(tree, query);
  const needle = query.trim().toLowerCase();
  const shownPending = needle
    ? pending.filter((n) => n.content.toLowerCase().includes(needle))
    : pending;

  return (
    <div className="flex flex-col gap-3.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && !isImeKey(e) && setQuery("")}
        placeholder={t("outline.searchNotes")}
        aria-label={t("outline.searchNotes")}
        className="w-full rounded-full bg-card px-4 py-2 text-[13px] shadow-soft outline-none placeholder:text-sand-500"
      />

      {shownPending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className={`${label} text-clay-800`}>
              {t("outline.pendingHeader", { n: shownPending.length })}
            </span>
            <span className="ml-auto text-[11px] text-sand-500">{t("outline.trayKeyHint")}</span>
          </div>
          {shownPending.map((note) => (
            <NoteCard key={note.id} note={note} actions={actions} variant="tray" />
          ))}
        </div>
      )}

      {shown.map((section) => (
        <TraySection key={section.id} section={section} actions={actions} labelClass={label} />
      ))}

      {needle && shown.length === 0 && shownPending.length === 0 && (
        <p className="text-[13px] text-sand-600">
          {t("outline.noNotesMatch", { query: query.trim() })}
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
  );
}

function TraySection({
  section,
  actions,
  labelClass,
  nested,
}: {
  section: SectionView;
  actions: OutlineActions;
  labelClass: string;
  nested?: boolean;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const [collapsed, setCollapsed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const accepted = section.notes.filter((n) => n.status !== "PENDING");

  return (
    <div className={`group/section flex flex-col gap-2 ${nested ? "pl-3" : ""}`}>
      <div className="flex items-baseline gap-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          data-track="section-collapse"
          aria-expanded={!collapsed}
          className={`flex items-center gap-1 ${labelClass} text-sand-600 hover:text-clay-700`}
        >
          <span className="self-center text-sand-400">
            {collapsed ? <ChevronRightIcon size={11} /> : <ChevronDownIcon size={11} />}
          </span>
          {section.title}
        </button>
        {accepted.length > 0 && <span className="text-[11px] text-sand-500">{accepted.length}</span>}
        {!collapsed && canEdit && (
          <button
            onClick={() => setComposing(true)}
            data-track="section-add-note"
            className="ml-auto text-[11px] text-sand-600 opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100 hover:text-clay-700"
          >
            {t("outline.addNoteBtn")}
          </button>
        )}
      </div>

      <Collapse open={!collapsed}>
      {!collapsed && (
        <div className="flex flex-col gap-2">
          {accepted.map((note) => (
            <NoteCard key={note.id} note={note} actions={actions} variant="tray" />
          ))}

          {composing && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const trimmed = draft.trim();
                if (!trimmed) return;
                await actions.addNote(section.id, trimmed);
                setDraft("");
                setComposing(false);
              }}
            >
              <NoteEditor
                className="rounded-2xl bg-card p-3 shadow-soft"
                value={draft}
                onChange={setDraft}
                onKeyDown={(e) => {
                  if (isImeKey(e)) return;
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.closest("form")?.requestSubmit();
                  if (e.key === "Escape") setComposing(false);
                }}
                placeholder={t("outline.writeNotePlaceholder")}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  data-track="note-compose-save"
                  className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
                >
                  {t("common.save")}
                </button>
                <button
                  type="button"
                  onClick={() => setComposing(false)}
                  data-track="note-compose-cancel"
                  className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          )}

          {section.children.map((child) => (
            <TraySection
              key={child.id}
              section={child}
              actions={actions}
              labelClass={labelClass}
              nested
            />
          ))}
        </div>
      )}
      </Collapse>
    </div>
  );
}
