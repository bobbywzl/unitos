"use client";

import Link from "next/link";
import { useState } from "react";
import type { NoteView, SectionView } from "@/lib/types";
import { NoteCard } from "@/components/outline/note-card";
import type { OutlineActions } from "@/components/outline/use-outline";

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
  const label = "text-[11px] font-bold tracking-[0.08em] uppercase";

  return (
    <div className="flex flex-col gap-3.5">
      {pending.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className={`${label} text-clay-800`}>Pending · {pending.length}</span>
            <span className="ml-auto text-[11px] text-sand-500">⏎ accept · ⌫ reject</span>
          </div>
          {pending.map((note) => (
            <NoteCard key={note.id} note={note} actions={actions} variant="tray" />
          ))}
        </div>
      )}

      {tree.map((section) => (
        <TraySection key={section.id} section={section} actions={actions} labelClass={label} />
      ))}

      {tree.length === 0 && (
        <p className="text-[13px] text-sand-600">
          No sections yet. Add one on the{" "}
          <Link href={`/n/${actions.notebookId}/notes`} className="text-clay hover:text-clay-600">
            notes full page
          </Link>
          .
        </p>
      )}
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
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const accepted = section.notes.filter((n) => n.status !== "PENDING");

  return (
    <div className={`group/section flex flex-col gap-2 ${nested ? "pl-3" : ""}`}>
      <div className="flex items-baseline gap-2">
        <span className={`${labelClass} text-sand-600`}>{section.title}</span>
        {accepted.length > 0 && <span className="text-[11px] text-sand-500">{accepted.length}</span>}
        <button
          onClick={() => setComposing(true)}
          className="ml-auto text-[11px] text-sand-600 opacity-0 transition-opacity group-hover/section:opacity-100 focus-visible:opacity-100 hover:text-clay-700"
        >
          + note
        </button>
      </div>

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
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              if (e.key === "Escape") setComposing(false);
            }}
            placeholder="Write a note (markdown)"
            rows={3}
            className="w-full rounded-2xl bg-card p-3 text-[13.5px] shadow-soft outline-none placeholder:text-sand-500"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              className="rounded-full bg-sage-600 px-3.5 py-1 text-xs font-semibold text-sage-fg hover:bg-sage-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setComposing(false)}
              className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              Cancel
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
  );
}
