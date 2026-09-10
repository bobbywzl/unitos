"use client";

import { useEffect, useRef, useState } from "react";
import { isImeKey } from "@/lib/ime";
import type { KeypointsView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";
import { jumpUnlessSelecting as jump, SelectionNotes } from "@/components/reader/selection-notes";
import { ThinkingIndicator } from "@/components/thinking";

type KeypointView = KeypointsView["points"][number];

// The distilled page — the reader's Distill (KEYPOINTS, SPEC.md §4, §6): a
// full-pane overlay over the article. Empty view offers Distill; the run view
// shows the scan; the show view lists the article's most important points as
// bullets, each anchored to the passage it comes from. Clicking a point jumps
// the reader to it; Add to notes lands it pending. A point whose words changed
// says "Anchor unresolved", never silently points at the wrong words (SPEC.md §5).
export function KeypointsPage({
  title,
  keypoints,
  running,
  error,
  canAddNotes,
  addNoteHint,
  onRun,
  onCancel,
  onClose,
  onDelete,
  onJump,
  onAddNote,
  onAddSelection,
}: {
  title: string; // the document's title
  keypoints: KeypointsView | null; // null = none yet
  running: boolean;
  error: string | null;
  canAddNotes: boolean;
  addNoteHint: string; // title for the Add to notes button
  onRun: () => void;
  onCancel: () => void; // abort the running scan; the stored distillation stays
  onClose: () => void;
  onDelete: () => void;
  onJump: (point: KeypointView) => void;
  onAddNote: (point: KeypointView) => Promise<boolean>;
  /** Text highlighted on this page: it lands as a pending note, anchored to
      the point it was highlighted inside when there is one (SPEC.md §6). */
  onAddSelection: (text: string, point: KeypointView | null) => Promise<boolean>;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Escape closes the page before anything under it reacts (capture, like the guide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape that dismisses a pinyin candidate list stays the IME's.
      if (isImeKey(e)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function addNote(point: KeypointView, key: string) {
    if (savingKey !== null || saved.has(key)) return;
    setSavingKey(key);
    const ok = await onAddNote(point);
    if (ok) setSaved((prev) => new Set(prev).add(key));
    setSavingKey(null);
  }

  return (
    // The page scrolls itself: the pane's scroll stays where the article left
    // it, and content taller than the pane never spills past the background
    // onto the article. overscroll-contain keeps the wheel from chaining into
    // the article scroll at the ends.
    <div
      ref={surfaceRef}
      data-selection-popover
      className="content-in absolute inset-0 z-30 overflow-y-auto overscroll-contain bg-paper print:hidden"
    >
      <SelectionNotes
        surface={surfaceRef}
        canAdd={canAddNotes && canEdit}
        hint={addNoteHint}
        onAdd={(text, quoteKey) =>
          onAddSelection(
            text,
            keypoints && quoteKey
              ? (keypoints.points[Number(quoteKey.split(":")[1])] ?? null)
              : null,
          )
        }
      />
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-center gap-2">
          <span className="font-display text-[18px]">{t("panes.keypoints")}</span>
          <span className="ml-auto flex items-center gap-3">
            {keypoints && !running && canEdit && (
              <>
                <button
                  onClick={onRun}
                  data-track="keypoints-page-regenerate"
                  className="text-xs font-semibold text-sand-600 hover:text-clay-800"
                  data-tip={t("panes.keypointsAgainTitle")}
                >
                  {t("panes.keypointsAgain")}
                </button>
                <button
                  onClick={onDelete}
                  data-track="keypoints-page-delete"
                  className="text-xs font-semibold text-red-500 hover:text-red-700"
                  data-tip={t("panes.deleteKeypoints")}
                >
                  {t("common.delete")}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              data-track="keypoints-page-close"
              aria-label={t("common.close")}
              data-tip={t("common.close")}
              className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
            >
              ✕
            </button>
          </span>
        </div>

        <h1 className="font-display text-[26px] leading-snug text-ink">{title}</h1>

        {running ? (
          <p className="mt-5 text-sm">
            <ThinkingIndicator
              label={t("panes.distillingArticle")}
              onStop={onCancel}
              stopLabel={t("common.cancel")}
              stopTitle={t("panes.stopDistill")}
            />
          </p>
        ) : keypoints ? (
          <div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-sand-500">
              {t(keypoints.points.length === 1 ? "panes.pointCount1" : "panes.pointCountN", {
                n: keypoints.points.length,
              })}{" "}
              · {new Date(keypoints.createdAt).toLocaleDateString(dateLocale)}
              <AuthorChip createdById={keypoints.createdById} />
            </p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <ul className="mt-5 flex flex-col gap-2">
              {keypoints.points.map((point, i) => {
                const key = `${keypoints.id}:${i}`;
                return (
                  <li
                    key={key}
                    data-quote-key={key}
                    className="group flex gap-3 rounded-2xl bg-card px-4 py-3 shadow-soft"
                  >
                    <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-clay-500" />
                    <div className="min-w-0 flex-1">
                      {point.orphaned ? (
                        <p className="text-[14.5px] leading-relaxed text-sand-700">{point.text}</p>
                      ) : (
                        <button
                          onClick={(e) => jump(e, () => onJump(point))}
                          data-track="keypoints-page-jump"
                          data-tip={t("panes.jumpToPassage")}
                          className="block w-full cursor-text text-left text-[14.5px] leading-relaxed text-sand-800 select-text hover:text-ink"
                        >
                          {point.text}
                        </button>
                      )}
                      <div className="mt-1.5 flex items-center gap-3">
                        {point.orphaned ? (
                          <span className="text-[11px] font-medium text-amber-700">
                            {t("panes.anchorUnresolvedChanged")}
                          </span>
                        ) : (
                          <span className="truncate text-[11.5px] text-sand-500">“{point.quotedText}”</span>
                        )}
                        {saved.has(key) ? (
                          <span className="shrink-0 text-[11.5px] font-semibold text-sage-700">
                            {t("panes.addedPendingInNotes")}
                          </span>
                        ) : (
                          <button
                            onClick={() => void addNote(point, key)}
                            data-track="keypoints-page-add-to-notes"
                            disabled={savingKey !== null || !canAddNotes || !canEdit}
                            data-tip={addNoteHint}
                            className="ml-auto shrink-0 rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                          >
                            {savingKey === key ? t("panes.adding") : t("panes.addToNotes")}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-sm text-sand-600">{t("panes.keypointsHint")}</p>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            {canEdit && (
              <button
                onClick={onRun}
                data-track="keypoints-page-run"
                className="mt-4 rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600"
              >
                {t("panes.keypointsArticle")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
