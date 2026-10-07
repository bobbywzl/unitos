"use client";

import type { TFunc } from "@/lib/i18n/dictionaries";
import type { CrossAccountView } from "@/lib/types";

// Remove and Dismiss on a link (SPEC.md §13). A link with replies asks first:
// the replies leave the project with the link. A link another person made
// asks too, and names them (WALK5-08): the link leaves the project for
// everyone. Remove only hides the link, and Undo and History's Restore bring
// it back (WALK5-01). Any other link goes at once.
export function confirmLinkRemoval(
  t: TFunc,
  replyCount: number,
  action: "remove" | "dismiss",
  madeBy?: string,
): boolean {
  if (replyCount === 0 && !madeBy) return true;
  const question =
    replyCount === 0
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
  return window.confirm(madeBy ? `${t("panes.confirmLinkMadeBy", { name: madeBy })} ${question}` : question);
}

/** The viewer may remove or dismiss the link: the server refuses everyone
    but the maker on a link shared across accounts. */
export function linkRemovable(crossAccount: CrossAccountView | undefined): boolean {
  return !crossAccount || (!crossAccount.outside && crossAccount.removable);
}
