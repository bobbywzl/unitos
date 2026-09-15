"use client";

import { useState } from "react";
import { AuthorChip } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";

// The stored extractions listed on the extract page — the document's and the
// project's alike (SPEC.md §4, §13). A row opens its extraction; the circle
// at its right selects it, and the bar above the rows deletes the selected
// extractions in one call; the ✕ deletes one.

export type ExtractionRow = {
  id: string;
  question: string;
  quoteCount: number;
  createdAt: string;
  createdById?: string;
};

function TickIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function ExtractionList({
  rows,
  canEdit,
  openTrack,
  onOpen,
  onDelete,
  onDeleteMany,
}: {
  rows: ExtractionRow[];
  canEdit: boolean;
  openTrack: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
}) {
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A row that is gone leaves the selection.
  const chosen = rows.filter((r) => selected.has(r.id)).map((r) => r.id);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="mt-8">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
          {t("panes.distilled")}
        </span>
        {canEdit && chosen.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-sand-600">{t("panes.distillSelected", { n: chosen.length })}</span>
            <button
              onClick={() => {
                onDeleteMany(chosen);
                setSelected(new Set());
              }}
              data-track="distill-delete-selected"
              data-tip={t("panes.deleteSelectedDistillationsTitle")}
              className="rounded-full bg-red-500 px-3 py-1 text-[11px] font-semibold text-white hover:bg-red-600"
            >
              {t("panes.deleteSelectedDistillations")}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              data-track="distill-clear-selection"
              className="rounded-full border border-line px-2.5 py-1 text-[11px] text-sand-700 hover:bg-clay-100"
            >
              {t("outline.clearSelection")}
            </button>
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {rows.map((d) => {
          const isSelected = selected.has(d.id);
          return (
            <div
              key={d.id}
              className={`flex items-center gap-2 rounded-2xl bg-card px-4 py-2.5 shadow-soft ${
                isSelected ? "outline-2 outline-clay-300" : ""
              }`}
            >
              <button
                onClick={() => onOpen(d.id)}
                data-track={openTrack}
                className="min-w-0 flex-1 text-left"
                data-tip={t("panes.openDistillation")}
              >
                <span className="block truncate text-[13.5px] font-semibold text-sand-800 hover:text-clay-800">
                  {d.question}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
                  {t(d.quoteCount === 1 ? "panes.quoteCount1" : "panes.quoteCountN", { n: d.quoteCount })}{" "}
                  · {new Date(d.createdAt).toLocaleDateString(dateLocale)}
                  <AuthorChip createdById={d.createdById} nameless size={13} />
                </span>
              </button>
              {canEdit && (
                <>
                  <button
                    onClick={() => toggle(d.id)}
                    data-track="distill-select"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={t("panes.selectDistillation")}
                    data-tip={t("panes.selectDistillationTitle")}
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isSelected
                        ? "border-clay bg-clay text-clay-fg"
                        : "border-sand-400 bg-card text-transparent hover:border-clay-500"
                    }`}
                  >
                    <TickIcon />
                  </button>
                  <button
                    onClick={() => onDelete(d.id)}
                    data-track={`${openTrack.replace(/-open$/, "")}-delete-item`}
                    aria-label={t("panes.deleteDistillation")}
                    data-tip={t("panes.deleteDistillation")}
                    className="shrink-0 rounded-full px-1.5 text-sand-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
