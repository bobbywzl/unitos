"use client";

import { useEffect } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The reader's guide: every selection tool and feature, in one place.
// Opened from the ? button in the header. In the Reading, Editing, and Side
// panel sections the body strings carry their own leading separator and
// joining spaces (see dict/works.ts), so bold terms and bodies concatenate
// with no literal whitespace between them.

// The selection tools, in the toolbox's order: name key, body key.
const TOOLS: [TKey, TKey][] = [
  ["works.guideAssistant", "works.guideAssistantBody"],
  ["works.guideExplain", "works.guideExplainBody"],
  ["works.guideSimplify", "works.guideSimplifyBody"],
  ["works.guideExtract", "works.guideExtractBody"],
  ["works.guideColors", "works.guideColorsBody"],
  ["works.guideComment", "works.guideCommentBody"],
  ["works.guideAddTo", "works.guideAddToBody"],
  ["works.guideLink", "works.guideLinkBody"],
  ["works.guideVoice", "works.guideVoiceBody"],
];
export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const h = "font-display text-[15px] text-clay-800";
  const term = "font-semibold";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={t("works.guideLabel")}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[560px] max-w-full flex-col gap-4 overflow-y-auto rounded-[24px] bg-card p-6 shadow-float"
      >
        <div className="flex items-center">
          <span className="font-display text-[20px]">{t("works.guideTitle")}</span>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>

        {/* Circle & ask leads the guide (the signature move), emphasized. */}
        <section className="flex flex-col gap-1.5 rounded-2xl bg-clay-100/70 p-4">
          <span className={h}>{t("works.guideCircleHeader")}</span>
          <p className="text-[13px] leading-relaxed text-sand-800">{t("works.guideCircleBody")}</p>
          <p className="text-[13px] leading-relaxed text-sand-800">
            {t("works.guideCirclePagesBody")}
          </p>
        </section>

        {/* Every selection tool is its own card, styled like Circle & ask. */}
        <section className="flex flex-col gap-2">
          <span className={h}>{t("works.guideSelectHeader")}</span>
          <p className="text-[13px] leading-relaxed text-sand-800">{t("works.guideSelectTouch")}</p>
          {TOOLS.map(([nameKey, bodyKey]) => (
            <div key={nameKey} className="flex flex-col gap-1 rounded-2xl bg-clay-100/70 p-4">
              <span className={h}>{t(nameKey)}</span>
              <p className="text-[13px] leading-relaxed text-sand-800">{t(bodyKey)}</p>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={h}>{t("works.guideReadingHeader")}</span>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-sand-800">
            <li>
              <span className={term}>{t("works.guideAddUrl")}</span>
              {t("works.guideAddUrlBody")}
            </li>
            <li>
              <span className={term}>{t("works.guideAssistantMenu")}</span>
              {t("works.guideAssistantMenuBody")}
            </li>
            <li>
              <span className={term}>{t("works.guideContext")}</span>
              {t("works.guideContextBody")}
            </li>
            <li>
              <span className={term}>{t("works.guideKeyTerms")}</span>
              {t("works.guideKeyTermsBody")}
            </li>
            <li>
              <span className={term}>{t("works.guideDistill")}</span>
              {t("works.guideDistillBody1")}
              <span className={term}>{t("common.pending")}</span>
              {t("works.guideDistillBody2")}
            </li>
            <li>
              <span className={term}>{t("works.guideNotesTray")}</span>
              {t("works.guideNotesTrayBody")}
            </li>
            <li>
              <span className={term}>{t("works.guideFigureTools")}</span>
              {t("works.guideFigureToolsBody")}
            </li>
            <li>
              <span className={term}>{t("works.guideHandwritten")}</span>
              {t("works.guideHandwrittenBody")}
            </li>
            <li>
              <span className={term}>{t("works.guidePrint")}</span>
              {t("works.guidePrintBody")}
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={h}>{t("works.guideEditingHeader")}</span>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-sand-800">
            <li>
              <span className={term}>{t("works.guideDoubleClick")}</span>
              {t("works.guideDoubleClickBody")}
            </li>
            <li>{t("works.guideEditSelect")}</li>
            <li>
              <span className={term}>{t("works.guideEditsTab")}</span>
              {t("works.guideEditsTabBody")}
            </li>
            <li>{t("works.guideAnchors")}</li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={h}>{t("works.guidePanelHeader")}</span>
          <p className="text-[13px] leading-relaxed text-sand-800">
            <span className={term}>{t("works.notes")}</span>
            {t("works.guidePanelNotesBody")}
            <span className={term}>{t("works.guideAssistant")}</span>
            {t("works.guidePanelAssistantBody")}
            <span className={term}>{t("works.guideDistill")}</span>
            {t("works.guidePanelDistillBody")}
            <span className={term}>{t("works.guidePanelSummary")}</span>
            {t("works.guidePanelSummaryBody")}
            <span className={term}>{t("works.guidePanelAnnotations")}</span>
            {t("works.guidePanelAnnotationsBody")}
            <span className={term}>{t("works.guidePanelEdits")}</span>
            {t("works.guidePanelEditsBody")}
          </p>
        </section>
      </div>
    </div>
  );
}
