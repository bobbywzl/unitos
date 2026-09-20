"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { HistoryIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";
import type { TKey } from "@/lib/i18n/dictionaries";

const KIND_KEY: Record<HistoryEntry["kind"], TKey> = {
  TEXT_EDIT: "panes.historyTextEdit",
  BLOCK_ADD: "panes.historyBlockAdd",
  BLOCK_REMOVE: "panes.historyBlockRemove",
  FORMAT: "panes.historyFormat",
  STYLE: "panes.historyStyle",
  LINK_ADD: "panes.historyLinkAdd",
  LINK_REMOVE: "panes.historyLinkRemove",
  NOTE_REMOVE: "panes.historyNoteRemove",
  SECTION_REMOVE: "panes.historySectionRemove",
  DOCUMENT_DETACH: "panes.historyDocumentDetach",
  NOTE_MERGE: "panes.historyNoteMerge",
};

const REMOVALS = new Set<HistoryEntry["kind"]>([
  "BLOCK_REMOVE",
  "LINK_REMOVE",
  "NOTE_REMOVE",
  "SECTION_REMOVE",
  "DOCUMENT_DETACH",
]);

type HistoryItem = { kind: "entry"; entry: HistoryEntry } | { kind: "run"; entries: HistoryEntry[] };

// Consecutive small edits by one person in one document fold into one
// item; a single small edit stands as itself.
function foldRuns(entries: HistoryEntry[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  let run: HistoryEntry[] = [];
  const flush = () => {
    if (run.length > 1) items.push({ kind: "run", entries: run });
    else if (run.length === 1) items.push({ kind: "entry", entry: run[0] });
    run = [];
  };
  for (const entry of entries) {
    const last = run[run.length - 1];
    if (entry.trivial && (!last || (last.userId === entry.userId && last.documentTitle === entry.documentTitle))) {
      run.push(entry);
      continue;
    }
    flush();
    if (entry.trivial) run.push(entry);
    else items.push({ kind: "entry", entry });
  }
  flush();
  return items;
}

// The History panel (SPEC.md §12): every edit and deletion in the corpus,
// newest first, each entry signed by the account that did it. A person's
// badge in the filter row narrows the feed to their actions.
export function HistoryControl({ history }: { history: HistoryEntry[] }) {
  const t = useT();
  const lang = useLang();
  const { authOn, people } = useCollab();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  // The folded runs of small edits the reader opened, by their first entry.
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const authors = [...new Set(history.map((e) => e.userId).filter((id): id is string => !!id))]
    .map((id) => people[id])
    .filter((p) => p !== undefined);
  const shown = personFilter ? history.filter((e) => e.userId === personFilter) : history;

  // One entry as a row: the person, the kind, the time, the snippet.
  const row = (entry: HistoryEntry) => {
    const person = entry.userId ? people[entry.userId] : undefined;
    return (
      <div key={entry.id} className="flex items-start gap-2.5">
        {person ? (
          <PersonBadge person={person} size={20} />
        ) : (
          <span className="size-5 shrink-0 rounded-full border border-dashed border-sand-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[12px]">
              {/* Without sign-in every entry is the local reader's. */}
              <span className="font-semibold">
                {person?.name ?? (authOn ? "?" : t("panes.historyYou"))}
              </span>{" "}
              <span className="text-sand-600">{t(KIND_KEY[entry.kind])}</span>
            </span>
            <span
              suppressHydrationWarning
              className="ml-auto shrink-0 text-[10px] text-sand-500"
            >
              {new Date(entry.createdAt).toLocaleString(dateLocale, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          {entry.content && (
            <p
              className={`line-clamp-2 text-[11.5px] text-sand-600 ${
                REMOVALS.has(entry.kind) ? "line-through decoration-sand-400" : ""
              }`}
            >
              {entry.content}
            </p>
          )}
          {entry.documentTitle && (
            <p className="truncate text-[10px] text-sand-500">{entry.documentTitle}</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={panelRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        data-track="history"
        aria-expanded={open}
        aria-label={t("panes.history")}
        data-tip={t("panes.historyTitle")}
        className="flex size-[34px] items-center justify-center rounded-full border border-line text-sand-600 hover:bg-clay-100 hover:text-clay-800"
      >
        <HistoryIcon size={16} />
      </button>

      <Presence show={open} exit="menu">
      {open && (
        <div className="menu-in absolute top-full right-0 z-30 mt-2 w-[420px] rounded-2xl bg-card p-4 shadow-float">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
              {t("panes.history")}
            </span>
            {authors.length > 1 && (
              <span className="ml-auto flex items-center gap-1">
                {authors.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPersonFilter(personFilter === p.id ? null : p.id)}
                    data-track="history-person"
                    aria-pressed={personFilter === p.id}
                    aria-label={p.name}
                    data-tip={p.name}
                    className={`rounded-full ${personFilter === p.id ? "ring-2 ring-clay-500" : "opacity-70 hover:opacity-100"}`}
                  >
                    <PersonBadge person={p} size={20} />
                  </button>
                ))}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-sand-500">{t("panes.historyDesc")}</p>

          <div className="mt-3 flex max-h-[420px] flex-col gap-2.5 overflow-y-auto pr-1">
            {shown.length === 0 && (
              <p className="text-[13px] text-sand-600">{t("panes.historyEmpty")}</p>
            )}
            {foldRuns(shown).map((item) => {
              if (item.kind === "run") {
                // A run of small edits by one person in one document, folded
                // into one row (SPEC.md §12); Show opens it.
                const first = item.entries[0];
                const person = first.userId ? people[first.userId] : undefined;
                const opened = openRuns.has(first.id);
                return (
                  <div key={`run-${first.id}`} className="flex flex-col gap-2.5">
                    <div className="flex items-start gap-2.5">
                      {person ? (
                        <PersonBadge person={person} size={20} />
                      ) : (
                        <span className="size-5 shrink-0 rounded-full border border-dashed border-sand-400" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate text-[12px]">
                            <span className="font-semibold">
                              {person?.name ?? (authOn ? "?" : t("panes.historyYou"))}
                            </span>{" "}
                            <span className="text-sand-600">{t("panes.historySmallEdits", { n: item.entries.length })}</span>
                          </span>
                          <button
                            onClick={() =>
                              setOpenRuns((prev) => {
                                const next = new Set(prev);
                                if (opened) next.delete(first.id);
                                else next.add(first.id);
                                return next;
                              })
                            }
                            data-track="history-small-edits"
                            aria-expanded={opened}
                            className="ml-auto shrink-0 text-[10px] font-semibold text-clay-700 hover:text-clay-800"
                          >
                            {t(opened ? "panes.historyHideSmall" : "panes.historyShowSmall")}
                          </button>
                        </div>
                        {first.documentTitle && (
                          <p className="truncate text-[10px] text-sand-500">{first.documentTitle}</p>
                        )}
                      </div>
                    </div>
                    {opened && <div className="flex flex-col gap-2.5 pl-4">{item.entries.map(row)}</div>}
                  </div>
                );
              }
              return row(item.entry);
            })}
          </div>
        </div>
      )}
      </Presence>
    </div>
  );
}
