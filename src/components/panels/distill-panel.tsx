"use client";

import type { CorpusDistillationView, DistillationView, KeypointsView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";

// The Distill tab: the distillation (KEYPOINTS, the reader's Distill) and
// every extraction (DISTILL, the reader's Extract) of the open document, for
// reference. The distillation row opens the distilled page; an extraction row
// opens the extract page on that extraction; the buttons open the pages on
// their run views. The pages themselves delete what they show.
export function DistillPanel({
  documentId,
  keypoints,
  distillations,
  corpusDistillations,
  hasDocuments,
}: {
  documentId: string | null; // null = no text document open
  keypoints: KeypointsView | null;
  distillations: DistillationView[];
  corpusDistillations: CorpusDistillationView[];
  hasDocuments: boolean;
}) {
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const { canEdit } = useCollab();

  function openKeypoints() {
    if (!documentId) return;
    window.dispatchEvent(new CustomEvent("dissect:open-keypoints", { detail: { documentId } }));
  }

  function open(distillationId: string | null) {
    if (!documentId) return;
    window.dispatchEvent(
      new CustomEvent("dissect:open-distillation", { detail: { documentId, distillationId } }),
    );
  }

  function openCorpus(distillationId: string | null) {
    window.dispatchEvent(
      new CustomEvent("dissect:open-corpus-distillation", { detail: { distillationId } }),
    );
  }

  const heading = (text: string) => (
    <span className="block text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{text}</span>
  );

  const button = "flex w-full items-center justify-center rounded-full bg-card px-4 py-2.5 text-[13px] font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800";
  const row = "rounded-2xl bg-card px-4 py-2.5 text-left shadow-soft hover:bg-clay-100";

  // The corpus section stands on its own: it works with any document open, or none.
  const corpusSection = hasDocuments && (
    <div className="space-y-3">
      {canEdit && (
        <button
          onClick={() => openCorpus(null)}
          data-track="distill-corpus"
          className={button}
          data-tip={t("panels.distillCorpusTitle")}
        >
          {t("panes.distillCorpus")}
        </button>
      )}
      {corpusDistillations.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {corpusDistillations.map((d) => (
            <button
              key={d.id}
              onClick={() => openCorpus(d.id)}
              data-track="distill-corpus-open"
              className={row}
              data-tip={t("panels.openDistillation")}
            >
              <span className="block text-[13.5px] leading-snug font-semibold text-sand-800">
                {d.question}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
                {t(d.quotes.length === 1 ? "panels.quoteCountOne" : "panels.quoteCountMany", {
                  n: d.quotes.length,
                })}{" "}
                · {new Date(d.createdAt).toLocaleDateString(dateLocale)}
                <AuthorChip createdById={d.createdById} nameless size={13} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (!documentId) {
    return (
      <div className="space-y-3">
        {heading(t("panes.distill"))}
        {corpusSection}
        <p className="text-sm text-sand-600">{t("panels.distillNoDoc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {heading(t("panes.keypoints"))}
        {canEdit && (
          <button
            onClick={openKeypoints}
            data-track="keypoints-article"
            className={button}
            data-tip={t("panels.keypointsButtonTitle")}
          >
            {t("panels.keypointsArticle")}
          </button>
        )}
        {keypoints ? (
          <button
            onClick={openKeypoints}
            data-track="keypoints-open"
            className={`${row} block w-full`}
            data-tip={t("panels.openKeypoints")}
          >
            <span className="block text-[13.5px] leading-snug font-semibold text-sand-800">
              {keypoints.points[0]?.text ?? ""}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
              {t(keypoints.points.length === 1 ? "panels.pointCountOne" : "panels.pointCountMany", {
                n: keypoints.points.length,
              })}{" "}
              · {new Date(keypoints.createdAt).toLocaleDateString(dateLocale)}
              <AuthorChip createdById={keypoints.createdById} nameless size={13} />
            </span>
          </button>
        ) : (
          <p className="text-sm text-sand-600">{t("panels.keypointsEmpty")}</p>
        )}
      </div>

      <div className="space-y-3">
        {heading(t("panes.distill"))}
        {corpusSection}
        {canEdit && (
          <button
            onClick={() => open(null)}
            data-track="distill-article"
            className={button}
            data-tip={t("panels.distillButtonTitle")}
          >
            {t("panels.distillArticle")}
          </button>
        )}

        {distillations.length === 0 ? (
          <p className="text-sm text-sand-600">{t("panels.distillEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {distillations.map((d) => (
              <button
                key={d.id}
                onClick={() => open(d.id)}
                data-track="distill-open"
                className={row}
                data-tip={t("panels.openDistillation")}
              >
                <span className="block text-[13.5px] leading-snug font-semibold text-sand-800">
                  {d.question}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
                  {t(d.quotes.length === 1 ? "panels.quoteCountOne" : "panels.quoteCountMany", {
                    n: d.quotes.length,
                  })}{" "}
                  · {new Date(d.createdAt).toLocaleDateString(dateLocale)}
                  <AuthorChip createdById={d.createdById} nameless size={13} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
