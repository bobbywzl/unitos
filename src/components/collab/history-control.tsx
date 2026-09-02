"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoryEntry } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { HistoryIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
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
};

const REMOVALS = new Set<HistoryEntry["kind"]>([
  "BLOCK_REMOVE",
  "LINK_REMOVE",
  "NOTE_REMOVE",
  "SECTION_REMOVE",
  "DOCUMENT_DETACH",
]);

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

  return (
    <div ref={panelRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={t("panes.history")}
        data-tooltip={t("panes.historyTitle")}
        className="flex size-[34px] items-center justify-center rounded-full border border-line text-sand-600 hover:bg-clay-100 hover:text-clay-800"
      >
        <HistoryIcon size={16} />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-[420px] rounded-2xl bg-card p-4 shadow-float">
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
                    aria-pressed={personFilter === p.id}
                    data-tooltip={p.name}
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
            {shown.map((entry) => {
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
            })}
          </div>
        </div>
      )}
    </div>
  );
}
