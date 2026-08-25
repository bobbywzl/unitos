"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Instruments } from "@/components/works/instruments";

export type WorkItem = {
  id: string;
  title: string;
  sectionCount: number;
  documentCount: number;
  pendingCount: number;
  updatedAt: string;
};

// A work: a 5.5 × 8.5 book with a spine, its counts as tags, and the instrument
// fan behind the cover (design 2a). Rename and delete sit behind the quiet ⋯.
export function WorkCard({
  work,
  onRename,
  onDelete,
}: {
  work: WorkItem;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <li className="work relative list-none">
      <Instruments />

      <Link
        href={`/n/${work.id}`}
        className="relative z-1 flex aspect-[5.5/8.5] flex-col rounded-[18px] bg-sand-100 px-[18px] pt-6 pb-[18px] text-center shadow-soft transition-[transform,box-shadow] duration-300 hover:-translate-y-[5px] hover:shadow-lift"
      >
        <span
          aria-hidden
          className="absolute top-3 bottom-3 left-[13px] w-[3px] rounded-full bg-sand-300"
        />
        <span className="mt-14 px-2 font-display text-[22px] leading-[1.25]">{work.title}</span>
        <span aria-hidden className="mx-auto mt-4 size-2 rounded-full bg-sage-500" />
        <span className="mt-auto flex flex-wrap justify-center gap-1.5">
          <span className="rounded-full bg-sand-200 px-3 py-1 text-xs font-semibold text-sand-700">
            {t(work.sectionCount === 1 ? "works.sectionCountOne" : "works.sectionCountOther", {
              n: work.sectionCount,
            })}
          </span>
          <span className="rounded-full bg-sand-200 px-3 py-1 text-xs font-semibold text-sand-700">
            {t(work.documentCount === 1 ? "works.documentCountOne" : "works.documentCountOther", {
              n: work.documentCount,
            })}
          </span>
          {work.pendingCount > 0 && (
            <span className="rounded-full bg-clay-200 px-3 py-1 text-xs font-semibold text-clay-800">
              {t("works.pendingCount", { n: work.pendingCount })}
            </span>
          )}
        </span>
      </Link>

      <div ref={menuRef} className="absolute top-2.5 right-2.5 z-2">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={t("works.moreActionsFor", { title: work.title })}
          aria-expanded={menuOpen}
          className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 mt-1 flex w-36 flex-col overflow-hidden rounded-2xl bg-card py-1 shadow-float">
            <Link
              href={`/n/${work.id}/notes`}
              className="px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("works.notes")}
            </Link>
            <button
              onClick={() => {
                setMenuOpen(false);
                onRename(work.id, work.title);
              }}
              className="px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("works.rename")}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete(work.id);
              }}
              className="px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
            >
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
