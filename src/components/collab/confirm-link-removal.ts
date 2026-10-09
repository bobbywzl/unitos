"use client";

import type { TFunc } from "@/lib/i18n/dictionaries";
import type { CrossAccountView } from "@/lib/types";

// Remove and Dismiss on a link (SPEC.md §13). Remove only hides the link,
// with its replies, and Undo and History's Restore bring it back (WALK5-01),
// so it asks only when the link is not the reader's alone: another person
// made it (named, WALK5-08), or another person replied on it (WALK6-08).
// Dismiss of a recommended link deletes it with the reader's own replies,
// so it asks whenever the link has replies.
export function confirmLinkRemoval(
  t: TFunc,
  replyCount: number,
  action: "remove" | "dismiss",
  madeBy?: string,
  /** Remove: whether another person replied on the link. */
  othersReplied = true,
): boolean {
  const asksReplies = replyCount > 0 && (action === "dismiss" || othersReplied);
  if (!asksReplies && !madeBy) return true;
  const question = !asksReplies
    ? t("panes.confirmRemoveLinkForEveryone")
    : t(
        action === "remove"
          ? replyCount === 1
            ? "panes.confirmRemoveLinkReplyOne"
            : "panes.confirmRemoveLinkReplies"
          : replyCount === 1
            ? "panes.confirmDismissLinkReplyOne"
            : "panes.confirmDismissLinkReplies",
        { count: replyCount },
      );
  return window.confirm(madeBy ? t("panes.confirmLinkMadeBy", { name: madeBy, question }) : question);
}

/** The viewer may remove or dismiss the link: the server refuses everyone
    but the maker on a link shared across accounts. */
export function linkRemovable(crossAccount: CrossAccountView | undefined): boolean {
  return !crossAccount || (!crossAccount.outside && crossAccount.removable);
}
