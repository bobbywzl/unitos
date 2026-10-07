"use client";

import { useSyncExternalStore } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { hasLinkDraft } from "@/lib/note-drafts";

// [ui5] WALK5-13: the Draft tag on a link row — the Links list, the node
// card, the reader's link card — when this browser holds words typed on the
// link and not sent: a reply or a Note on this link. Read each time the row
// draws; the words themselves stay where they were typed.

const noSubscribe = () => () => {};

export function LinkDraftTag({ linkId, className = "" }: { linkId: string; className?: string }) {
  const t = useT();
  const { myId } = useCollab();
  const draft = useSyncExternalStore(noSubscribe, () => hasLinkDraft(myId, linkId), () => false);
  if (!draft) return null;
  return (
    <span
      data-link-draft={linkId}
      data-tip={t("graphNotes.linkDraftTitle")}
      className={`inline-block shrink-0 rounded-full border border-dashed border-clay-300 px-1.5 text-[10px] font-semibold whitespace-nowrap text-clay-700 ${className}`}
    >
      {t("graphNotes.linkDraft")}
      <span className="sr-only">: {t("graphNotes.linkDraftTitle")}</span>
    </span>
  );
}
