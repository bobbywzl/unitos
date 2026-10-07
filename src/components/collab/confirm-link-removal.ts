"use client";

import type { TFunc } from "@/lib/i18n/dictionaries";
import type { CrossAccountView } from "@/lib/types";

// Remove and Dismiss on a link (SPEC.md §13). A link with replies asks first:
// the replies leave the project with the link (rule zero item 1). A link
// with none goes at once, as before.
export function confirmLinkRemoval(t: TFunc, replyCount: number, action: "remove" | "dismiss"): boolean {
  if (replyCount === 0) return true;
  const key =
    action === "remove"
      ? replyCount === 1
        ? "panes.confirmRemoveLinkReplyOne"
        : "panes.confirmRemoveLinkReplies"
      : replyCount === 1
        ? "panes.confirmDismissLinkReplyOne"
        : "panes.confirmDismissLinkReplies";
  return window.confirm(t(key, { count: replyCount }));
}

/** The viewer may remove or dismiss the link: the server refuses everyone
    but the maker on a link shared across accounts. */
export function linkRemovable(crossAccount: CrossAccountView | undefined): boolean {
  return !crossAccount || (!crossAccount.outside && crossAccount.removable);
}
