"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { MoreIcon } from "@/components/icons";
import { useEscapeLayer } from "@/lib/escape-layers";
import { isImeKey, useImeGuard } from "@/lib/ime";
import { LoadingDots } from "@/components/thinking";
import { TierMark } from "@/components/tier-mark";
import { Instruments } from "@/components/works/instruments";

export type WorkItem = {
  id: string;
  title: string;
  sectionCount: number;
  documentCount: number;
  collaboratorCount: number;
  pendingCount: number;
  updatedAt: string;
  // Set on the Shared with you shelf: the owner and this account's role.
  shared?: { ownerName: string; role: "editor" | "viewer" };
};

// A work: a 5.5 × 8.5 book with a spine, its counts as tags, and the instrument
// fan behind the cover (design 2a). Rename and delete sit behind the quiet ⋯.
// Rename turns the title into a field in place, as the reader's title does
// (notebook-title.tsx): Enter keeps, Escape drops, a blur keeps typed words.
// The menu opens under the title, so the reader sees which project it acts on.
// The title starts under the ⋯, with no empty band above it; on a phone two
// books stand side by side, so the type and the tags are a size smaller.
export function WorkCard({
  work,
  onRename,
  onDelete,
  onLeave,
  offline,
}: {
  work: WorkItem;
  onRename: (id: string, title: string) => Promise<void>;
  onDelete: (id: string) => void;
  onLeave?: (id: string) => void;
  // Offline copy (SPEC.md §17, Unitos Ultra): the card's state and the toggle.
  // Absent where the browser cannot hold one.
  offline?: { saved: boolean; saving: boolean; ultra: boolean; onToggle: (id: string) => void };
}) {
  const t = useT();
  const ime = useImeGuard();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The inline rename: the field's words, and the title shown until the
  // page's data has the new one.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [seenTitle, setSeenTitle] = useState(work.title);
  if (seenTitle !== work.title) {
    setSeenTitle(work.title);
    setSavedTitle(null);
  }
  const title = savedTitle ?? work.title;
  async function keepRename() {
    const next = renaming?.trim() ?? "";
    setRenaming(null);
    if (!next || next === title) return;
    setSavedTitle(next);
    try {
      await onRename(work.id, next);
    } catch {
      setSavedTitle(null);
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);
  // One Escape layer; the focus goes back to ⋯ (lib/escape-layers.ts).
  useEscapeLayer(menuOpen, () => setMenuOpen(false));

  return (
    <li className="work relative list-none">
      <Instruments />

      <Link
        href={`/n/${work.id}`}
        className="relative z-1 flex aspect-[5.5/8.5] flex-col rounded-[18px] bg-sand-100 px-3 pt-6 pb-3 sm:px-[18px] sm:pb-[18px] text-center shadow-soft transition-[transform,box-shadow] duration-300 hover:-translate-y-[5px] hover:shadow-lift"
      >
        <span
          aria-hidden
          className="absolute top-3 bottom-3 left-[13px] w-[3px] rounded-full bg-sand-300"
        />
        <span
          className={`mt-6 px-2 font-display text-[17px] leading-[1.25] break-words sm:text-[22px] ${renaming !== null ? "invisible" : ""}`}
        >
          {title}
        </span>
        {work.shared && (
          <span className="mt-1.5 px-2 text-xs text-sand-600">
            {t("works.byOwner", { name: work.shared.ownerName })}
          </span>
        )}
        <CoverDot />
        <span className="mt-auto flex flex-wrap justify-center gap-1 sm:gap-1.5">
          <span className="rounded-full bg-sand-200 px-2 py-1 text-xs font-semibold sm:px-3 text-sand-700">
            {t(work.sectionCount === 1 ? "works.sectionCountOne" : "works.sectionCountOther", {
              n: work.sectionCount,
            })}
          </span>
          <span className="rounded-full bg-sand-200 px-2 py-1 text-xs font-semibold sm:px-3 text-sand-700">
            {t(work.documentCount === 1 ? "works.documentCountOne" : "works.documentCountOther", {
              n: work.documentCount,
            })}
          </span>
          {work.pendingCount > 0 && (
            <span className="rounded-full bg-clay-200 px-2 py-1 text-xs font-semibold sm:px-3 text-clay-800">
              {t("works.pendingCount", { n: work.pendingCount })}
            </span>
          )}
          {offline?.saved && (
            <span className="rounded-full bg-sage-200 px-2 py-1 text-xs font-semibold sm:px-3 text-sage-800">
              {t("works.offlineBadge")}
            </span>
          )}
          {work.shared ? (
            <span className="rounded-full bg-sage-200 px-2 py-1 text-xs font-semibold sm:px-3 text-sage-800">
              {t(work.shared.role === "editor" ? "panes.roleEditor" : "panes.roleViewer")}
            </span>
          ) : (
            work.collaboratorCount > 0 && (
              <span className="rounded-full bg-sage-200 px-2 py-1 text-xs font-semibold sm:px-3 text-sage-800">
                {t("works.sharedBadge", { n: work.collaboratorCount })}
              </span>
            )
          )}
        </span>
      </Link>

      <div ref={menuRef} className="absolute top-2.5 right-2.5 z-2">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={t("works.moreActionsFor", { title: work.title })}
          data-tip={t("works.projectActions")}
          aria-expanded={menuOpen}
          className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800"
        >
          <MoreIcon size={16} />
        </button>
        {menuOpen && (
          <div className="absolute top-[calc(100%+64px)] right-0 flex w-44 flex-col overflow-hidden rounded-2xl bg-card py-1 shadow-float sm:top-[calc(100%+80px)]">
            <Link
              href={`/n/${work.id}/notes`}
              className="px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("works.notes")}
            </Link>
            {offline && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  offline.onToggle(work.id);
                }}
                disabled={offline.saving}
                className="flex items-center gap-1.5 px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                {offline.saving
                  ? t("works.savingOffline")
                  : offline.saved
                    ? t("works.removeOffline")
                    : t("works.saveOffline")}
                {!offline.ultra && !offline.saved && (
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-sand-600">
                    <TierMark state="ultra" size={10} />
                    {t("reader.ultra")}
                  </span>
                )}
              </button>
            )}
            {(!work.shared || work.shared.role === "editor") && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setRenaming(title);
                }}
                data-track="project-rename"
                className="px-4 py-2 text-left text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t("works.rename")}
              </button>
            )}
            {work.shared ? (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onLeave?.(work.id);
                }}
                className="px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                {t("panes.leave")}
              </button>
            ) : (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(work.id);
                }}
                className="px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                {t("common.delete")}
              </button>
            )}
          </div>
        )}
      </div>
      {renaming !== null && (
        <input
          autoFocus
          value={renaming}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => void keepRename()}
          {...ime.props}
          onKeyDown={(e) => {
            if (ime.isImeEnter(e) || isImeKey(e)) return;
            if (e.key === "Enter") void keepRename();
            if (e.key === "Escape") {
              e.stopPropagation();
              setRenaming(null);
            }
          }}
          maxLength={200}
          aria-label={t("works.corpusTitle")}
          data-track="project-rename-field"
          className="absolute inset-x-2 top-[52px] z-3 rounded-full bg-card px-3 py-1 text-center font-display text-[17px] shadow-soft outline-none sm:inset-x-3 sm:text-[20px]"
        />
      )}
    </li>
  );
}

/** The dot on the cover, and three dots in a wave while the project opens:
    the press answers at once, and the project's page lands a second later. */
function CoverDot() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span className="mx-auto mt-4 flex h-2 items-center text-sage-500">
      <LoadingDots />
    </span>
  ) : (
    <span aria-hidden className="mx-auto mt-4 size-2 rounded-full bg-sage-500" />
  );
}
