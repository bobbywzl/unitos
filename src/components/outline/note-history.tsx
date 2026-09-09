"use client";

import { useEffect, useState } from "react";
import type { Person } from "@/lib/person";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";

// A note's own history (SPEC.md §12): who wrote the note and every edit of
// its text since, newest first, each signed and dated, each holding the text
// it left. Show text opens a version; Restore makes it the note's text again
// — an edit like any other, so it lands in the history too.

type Edit = { id: string; userId: string | null; content: string; createdAt: string; updatedAt: string };
type History = {
  createdAt: string;
  createdById: string | null;
  edits: Edit[];
  people: Record<string, Person>;
};

// One row: an edit, or the writing of the note at the bottom.
type Row = { key: string; userId: string | null; at: string; content: string | null; edit: boolean };

export function NoteHistory({
  noteId,
  content,
  updatedAt,
  onRestore,
}: {
  noteId: string;
  /** The note's text now: a version that matches it offers no Restore. */
  content: string;
  /** When the note last changed: the list reads again after a save. */
  updatedAt: string;
  /** Editors restore; absent for a viewer. */
  onRestore?: (content: string) => void | Promise<void>;
}) {
  const t = useT();
  const lang = useLang();
  const { people: known } = useCollab();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/notes/${noteId}/edits`)
      .then(async (res) => {
        if (!res.ok) throw new Error(t("common.requestFailedStatus", { status: res.status }));
        return (await res.json()) as History;
      })
      .then((data) => {
        if (live) setHistory(data);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : t("common.requestFailed"));
      });
    return () => {
      live = false;
    };
  }, [noteId, updatedAt, t]);

  if (error) return <p className="mt-2 text-[11px] text-red-500">{error}</p>;
  if (!history) return <p className="mt-2 text-[11px] text-sand-500">{t("common.loading")}</p>;

  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const rows: Row[] = [
    ...history.edits.map((e) => ({ key: e.id, userId: e.userId, at: e.updatedAt, content: e.content, edit: true })),
    { key: "created", userId: history.createdById, at: history.createdAt, content: null, edit: false },
  ];

  return (
    <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2.5">
      {rows.map((row) => {
        const person = row.userId ? (history.people[row.userId] ?? known[row.userId]) : undefined;
        const shown = open === row.key;
        const restorable = onRestore && row.content !== null && row.content.trim() !== content.trim();
        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              {person && (
                <span className="self-center">
                  <PersonBadge person={person} size={16} />
                </span>
              )}
              <span className="min-w-0 truncate text-[11px] text-sand-700">
                {person && <span className="font-semibold">{person.name} </span>}
                {t(row.edit ? "outline.historyEdited" : "outline.historyCreated")}
              </span>
              <span suppressHydrationWarning className="shrink-0 text-[10px] text-sand-500">
                {when(row.at)}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {row.content !== null && (
                  <button
                    onClick={() => setOpen(shown ? null : row.key)}
                    data-track="note-history-show"
                    className="text-[10px] font-semibold text-sand-500 hover:text-clay-700"
                  >
                    {t(shown ? "outline.historyHide" : "outline.historyShow")}
                  </button>
                )}
                {restorable && (
                  <button
                    onClick={() => void onRestore(row.content!)}
                    data-track="note-history-restore"
                    data-tip={t("outline.historyRestoreTitle")}
                    className="text-[10px] font-semibold text-sand-500 hover:text-sage-700"
                  >
                    {t("outline.historyRestore")}
                  </button>
                )}
              </span>
            </div>
            {shown && row.content !== null && (
              <div className="rounded-xl bg-sand-100 px-3 py-2 text-[12.5px]">
                <Markdown breaks>{row.content}</Markdown>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
