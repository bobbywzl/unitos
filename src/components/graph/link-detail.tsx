"use client";

import { useParams } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { useLinkPassages } from "@/components/graph/link-passages";
import { AddToNote } from "@/components/graph/note-gather"; // [cover4]

// An expanded link (SPEC.md §13): why the link was made, then each end — the
// document's title, the passage the quote sits in with the quote lit, and a
// button that opens the reader there. The curve's list and the Recommended
// links list both expand a link this way. The passages load when the link
// opens (link-passages.ts); each quote shows at once.

export type LinkDetailLink = {
  id: string;
  fromDocumentId: string;
  fromTitle: string;
  toDocumentId: string;
  toTitle: string;
  quotedText: string;
  toQuotedText: string | null;
  fromBlockText?: string | null;
  toBlockText?: string | null;
  reason: string | null;
};

// How much of the block shows on each side of the quote.
const CONTEXT_CHARS = 260;

function clipStart(text: string): string {
  const line = text.replace(/\s+/g, " ");
  if (line.length <= CONTEXT_CHARS) return line;
  const tail = line.slice(line.length - CONTEXT_CHARS);
  const space = tail.indexOf(" ");
  return `…${space > 0 ? tail.slice(space + 1) : tail}`;
}

function clipEnd(text: string): string {
  const line = text.replace(/\s+/g, " ");
  if (line.length <= CONTEXT_CHARS) return line;
  const head = line.slice(0, CONTEXT_CHARS);
  const space = head.lastIndexOf(" ");
  return `${space > 0 ? head.slice(0, space) : head}…`;
}

/** The passage around a quote: the block's words before and after it, the
    quote lit between them. The quote alone when the block is gone or does
    not hold it. */
function Passage({ quote, blockText }: { quote: string; blockText: string | null }) {
  const at = blockText ? blockText.indexOf(quote) : -1;
  if (!blockText || at < 0) {
    return (
      <p className="text-[12.5px] leading-relaxed text-sand-700">
        <mark className="link-detail-quote">{quote}</mark>
      </p>
    );
  }
  return (
    <p className="text-[12.5px] leading-relaxed text-sand-700">
      {clipStart(blockText.slice(0, at))}
      <mark className="link-detail-quote">{quote}</mark>
      {clipEnd(blockText.slice(at + quote.length))}
    </p>
  );
}

function LinkEnd({
  documentId,
  title,
  quote,
  blockText,
  onOpen,
}: {
  documentId: string;
  title: string;
  quote: string | null;
  blockText: string | null;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-line bg-sand-50/60 p-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink">{title}</span>
        {quote && <AddToNote quote={{ documentId, text: quote }} /* [cover4] */ />}
        <button
          onClick={onOpen}
          data-track="graph-link-open"
          data-tip={t("panes.openLinkEnd", { title })}
          className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("panes.linkOpenEnd")}
        </button>
      </div>
      <div className="mt-1.5">
        {quote ? (
          <Passage quote={quote} blockText={blockText} />
        ) : (
          <p className="text-[12px] text-sand-500">{t("panes.linkEndWholeDocument")}</p>
        )}
      </div>
    </div>
  );
}

export function LinkDetail({
  link,
  onOpen,
  showReason = true,
}: {
  link: LinkDetailLink;
  /** Open the reader on this link, in the document of one end. */
  onOpen: (documentId: string) => void;
  /** False where the row above already shows the reason in full. */
  showReason?: boolean;
}) {
  const t = useT();
  const { notebookId } = useParams<{ notebookId?: string }>();
  const passages = useLinkPassages(notebookId, link);
  return (
    <div className="flex flex-col gap-2" data-track-surface="link-detail" data-link-passages={passages ? "" : undefined}>
      {showReason && (
        <div>
          <p className="text-[10.5px] font-bold tracking-[0.06em] text-sand-500 uppercase">{t("panes.linkWhy")}</p>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink">{link.reason ?? t("panes.linkNoReason")}</p>
        </div>
      )}
      <LinkEnd
        documentId={link.fromDocumentId}
        title={link.fromTitle}
        quote={link.quotedText}
        blockText={passages?.from ?? null}
        onOpen={() => onOpen(link.fromDocumentId)}
      />
      <LinkEnd
        documentId={link.toDocumentId}
        title={link.toTitle}
        quote={link.toQuotedText}
        blockText={passages?.to ?? null}
        onOpen={() => onOpen(link.toDocumentId)}
      />
    </div>
  );
}
