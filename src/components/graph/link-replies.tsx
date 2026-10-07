"use client";

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

/** The link's reply thread, under the expanded link. */
export function LinkReplies({ link }: { link: GraphEdgeLink }) {
  return (
    <div data-graph-link-thread={link.id}>
      <ReplyThread target={{ docLinkId: link.id }} replies={link.replies ?? []} />
    </div>
  );
}
