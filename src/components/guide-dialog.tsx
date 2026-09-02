"use client";

import { useEffect } from "react";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

// The reader's guide: Distill, Circle & ask, every selection tool, and the
// side panel, in one place. Opened from the ? button in the header. In the
// Side panel section the body strings carry their own leading separator and
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
      data-track-surface="topbar"
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
            data-track="guide-close"
            aria-label={t("common.close")}
            className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>

        {/* Distill leads the guide, emphasized. */}
        <section className="flex flex-col gap-1.5 rounded-2xl bg-clay-100/70 p-4">
          <span className={h}>{t("works.guideDistillHeader")}</span>
          <p className="text-[13px] leading-relaxed text-sand-800">{t("works.guideDistillBody")}</p>
          <p className="text-[13px] leading-relaxed text-sand-800">
            {t("works.guideDistillNotesBody")}
          </p>
        </section>

        {/* Circle & ask (the signature move), emphasized. */}
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
          {TOOLS.map(([nameKey, bodyKey]) => (
            <div key={nameKey} className="flex flex-col gap-1 rounded-2xl bg-clay-100/70 p-4">
              <span className={h}>{t(nameKey)}</span>
              <p className="text-[13px] leading-relaxed text-sand-800">{t(bodyKey)}</p>
            </div>
          ))}
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
