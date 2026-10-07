"use client";

import { useParams } from "next/navigation";
import type { GraphEdgeLink } from "@/lib/types";
import { ReplyThread } from "@/components/collab/reply-thread";
import { CommentIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The discussion on a link, on the graph (SPEC.md §13): a row of the curve's
// list counts the link's replies; the expanded link shows the thread — the
// same ReplyThread, and the same rules, as the reader's Annotations tab and
// the Recommended links list. A sent reply refreshes the page, so the counts
// on the row and the curve follow.

/** Under a link's reason: "2 replies" (open ones), "1 resolved". Nothing when there are none. */
export function LinkReplyCount({ link }: { link: GraphEdgeLink }) {
  const t = useT();
  const replies = link.replies ?? [];
  const open = replies.filter((r) => r.resolvedById === null).length;
  const resolved = replies.length - open;
  if (replies.length === 0) return null;
  return (
    <span data-graph-link-replies={link.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-sand-600">
      <CommentIcon size={11} />
      {open > 0 && (open === 1 ? t("graphNotes.replyCountOne") : t("graphNotes.replyCountMany", { n: open }))}
      {open > 0 && resolved > 0 && <span className="text-sand-400">·</span>}
      {resolved > 0 &&
        (resolved === 1 ? t("common.resolvedCountOne") : t("common.resolvedCountMany", { n: resolved }))}
    </span>
  );
}

/** The link's reply thread, under the expanded link. The reply carries the
    project (a link answers only in its own project). Esc in a reply box
    holding words only leaves the box: the box, its words, and the curve's
    list stay (ReplyThread itself would fold the box, and the next Esc would
    close the list and lose the words). */
export function LinkReplies({ link }: { link: GraphEdgeLink }) {
  const { notebookId } = useParams<{ notebookId?: string }>();
  return (
    <div
      data-graph-link-thread={link.id}
      onKeyDownCapture={(e) => {
        const box = e.target;
        if (e.key !== "Escape" || !(box instanceof HTMLTextAreaElement) || box.value.trim() === "") return;
        e.stopPropagation();
        // The focus goes to the panel holding the box, never to the page (WALK4-07).
        const home = box.closest<HTMLElement>("[data-graph-side-list][tabindex], [data-curve-list][tabindex]");
        if (home) home.focus({ preventScroll: true });
        else box.blur();
      }}
    >
      <ReplyThread
        target={{ docLinkId: link.id, notebookId }}
        replies={link.replies ?? []}
        crossAccount={link.crossAccount}
      />
    </div>
  );
}
