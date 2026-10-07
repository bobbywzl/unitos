"use client";

import { ChevronRightIcon } from "@/components/icons";
import { AddToNote } from "@/components/graph/note-gather";
import { sentencePrefix } from "@/lib/graph/quote-span";
import { useT } from "@/components/lang-provider";

// What a Stitch reply cites for one [block <id>] tag (StitchResult.cited):
// the document and the block's words, cut by the route.
export type StitchCitation = { documentId: string; title: string; text: string };

// A citation chip in a Stitch reply (SPEC.md §22): the cited document's
// title in place of the reader's ¶, so a claim from one document reads apart
// from a claim from another. A click opens the passage card.
export function StitchCitationChip({ citation, onOpen }: { citation: StitchCitation; onOpen: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      data-track="stitch-citation"
      data-tip={t("stitch.stitchCitationTitle", { title: citation.title })}
      className="mx-0.5 inline-flex max-w-[160px] items-center gap-1 rounded-full bg-clay-100 px-1.5 align-text-bottom text-[11px] font-semibold leading-[18px] text-clay-800 no-underline hover:bg-clay-200"
    >
      <span aria-hidden>¶</span>
      <span className="truncate">{citation.title}</span>
    </button>
  );
}

// The longest text of a cited block a reply carries (lib/graph/stitch.ts
// CITED_TEXT): a text this long was cut.
const CITED_CUT = 600;

// The passage card: over the Stitch box, inside the graph — the cited
// document's title, the passage, Open in reader, which closes the graph and
// opens the document at the block, and Add to note (VIEW5-04), which puts
// the passage in the graph's new note: the block's words, up to their last
// whole sentence when the reply cut them.
export function StitchPassageCard({
  citation,
  blockId,
  onOpenInReader,
  onClose,
}: {
  citation: StitchCitation;
  blockId?: string;
  onOpenInReader: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      data-track-surface="stitch-passage"
      role="dialog"
      aria-label={t("stitch.stitchPassage")}
      className="absolute inset-x-0 bottom-full mb-2 flex max-h-[45vh] flex-col gap-2 rounded-[18px] border border-line bg-card p-4 shadow-float"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-sand-500">{t("stitch.stitchPassageFrom")}</p>
          <p className="font-display text-[15px] leading-snug text-sand-900">{citation.title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-track="stitch-passage-close"
          aria-label={t("stitch.stitchPassageClose")}
          data-tip={t("stitch.stitchPassageClose")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          ✕
        </button>
      </div>
      <blockquote className="min-h-0 overflow-y-auto border-l-2 border-clay-300 pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-sand-800">
        {citation.text}
      </blockquote>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenInReader}
          data-track="stitch-passage-open"
          className="flex items-center gap-1 rounded-full bg-clay px-3 py-1 text-[12px] font-semibold text-clay-fg hover:bg-clay-600"
        >
          {t("stitch.stitchPassageOpen")}
          <ChevronRightIcon size={12} />
        </button>
        <AddToNote
          quote={{ documentId: citation.documentId, ...(blockId ? { blockId } : {}), text: sentencePrefix(citation.text, CITED_CUT) }}
          className="py-1 text-[12px]"
        />
      </span>
    </div>
  );
}
