"use client";

import type { CorpusDistillationView, DistillationView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { useT } from "@/components/lang-provider";

// The Distill tab: every distillation of the open document, for reference.
// A row opens the distilled page on that distillation; the button opens it on
// the ask view. The page itself deletes distillations.
export function DistillPanel({
  documentId,
  distillations,
  corpusDistillations,
  hasDocuments,
}: {
  documentId: string | null; // null = no text document open
  distillations: DistillationView[];
  corpusDistillations: CorpusDistillationView[];
  hasDocuments: boolean;
}) {
  const t = useT();
  const { canEdit } = useCollab();

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

  // The corpus section stands on its own: it works with any document open, or none.
  const corpusSection = hasDocuments && (
    <div className="space-y-3">
      {canEdit && (
        <button
          onClick={() => openCorpus(null)}
          className="flex w-full items-center justify-center rounded-full bg-card px-4 py-2.5 text-[13px] font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
          title={t("panels.distillCorpusTitle")}
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
              className="rounded-2xl bg-card px-4 py-2.5 text-left shadow-soft hover:bg-clay-100"
              title={t("panels.openDistillation")}
            >
              <span className="block text-[13.5px] leading-snug font-semibold text-sand-800">
                {d.question}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
                {t(d.quotes.length === 1 ? "panels.quoteCountOne" : "panels.quoteCountMany", {
                  n: d.quotes.length,
                })}{" "}
                · {new Date(d.createdAt).toLocaleDateString()}
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
        {corpusSection}
        <p className="text-sm text-sand-600">{t("panels.distillNoDoc")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {corpusSection}
      {canEdit && (
        <button
          onClick={() => open(null)}
          className="flex w-full items-center justify-center rounded-full bg-card px-4 py-2.5 text-[13px] font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
          title={t("panels.distillButtonTitle")}
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
              className="rounded-2xl bg-card px-4 py-2.5 text-left shadow-soft hover:bg-clay-100"
              title={t("panels.openDistillation")}
            >
              <span className="block text-[13.5px] leading-snug font-semibold text-sand-800">
                {d.question}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
                {t(d.quotes.length === 1 ? "panels.quoteCountOne" : "panels.quoteCountMany", {
                  n: d.quotes.length,
                })}{" "}
                · {new Date(d.createdAt).toLocaleDateString()}
                <AuthorChip createdById={d.createdById} nameless size={13} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
