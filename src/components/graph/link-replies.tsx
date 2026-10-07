"use client";

import { useParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import type { GraphEdgeLink } from "@/lib/types";
import { ReplyThread } from "@/components/collab/reply-thread";
import { useCollab } from "@/components/collab/collab-context";
import { CommentIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The discussion on a link, on the graph (SPEC.md §13): a row of the curve's
// list counts the link's replies; the expanded link shows the thread — the
// same ReplyThread, and the same rules, as the reader's Annotations tab and
// the Recommended links list. A sent reply refreshes the page, so the counts
// on the row and the curve follow.
//
// [layer5] New replies (WALK5-07): a reply another person wrote after this
// account last opened the link's thread counts as new: "· 1 new" on the
// row, a dot on the curve's replies mark. The last look is kept in this
// browser per account and project (`unitos-link-seen:<account>:<project>`):
// a per-viewer convenience, so a lost one loses no work, and replies older
// than the store's first read never count as new.

type Seen = { since: string; links: Record<string, string> };
const SEEN_KEY = (accountId: string, notebookId: string) => `unitos-link-seen:${accountId}:${notebookId}`;
const seenListeners = new Set<() => void>();
const seenCache = new Map<string, Seen>();

function readSeen(key: string): Seen {
  const kept = seenCache.get(key);
  if (kept) return kept;
  let seen: Seen | null = null;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as Seen).since === "string" && typeof (parsed as Seen).links === "object") {
      seen = parsed as Seen;
    }
  } catch {
    seen = null;
  }
  if (!seen) {
    seen = { since: new Date().toISOString(), links: {} };
    try {
      window.localStorage.setItem(key, JSON.stringify(seen));
    } catch {
      // storage off: the replies are not marked new
    }
  }
  seenCache.set(key, seen);
  return seen;
}

function markSeen(key: string, linkId: string, at: string) {
  const seen = readSeen(key);
  if ((seen.links[linkId] ?? "") >= at) return;
  const next = { ...seen, links: { ...seen.links, [linkId]: at } };
  seenCache.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // kept for this tab only
  }
  for (const l of seenListeners) l();
}

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
}

/** The open replies on a link another person wrote after this account last
    opened its thread. 0 on the server and with sign-in off (one reader). */
export function useNewReplies(link: GraphEdgeLink): number {
  const { notebookId } = useParams<{ notebookId?: string }>();
  const { myId, authOn } = useCollab();
  const key = authOn && myId && notebookId ? SEEN_KEY(myId, notebookId) : null;
  const seen = useSyncExternalStore(subscribeSeen, () => (key ? readSeen(key) : null), () => null);
  if (!seen) return 0;
  const after = link.id in seen.links ? seen.links[link.id] : seen.since;
  return (link.replies ?? []).filter((r) => r.resolvedById === null && r.userId !== myId && r.createdAt > after).length;
}

/** The new replies on any of a curve's links (the curve's replies mark). */
export function useAnyNewReplies(links: GraphEdgeLink[]): boolean {
  const { notebookId } = useParams<{ notebookId?: string }>();
  const { myId, authOn } = useCollab();
  const key = authOn && myId && notebookId ? SEEN_KEY(myId, notebookId) : null;
  const seen = useSyncExternalStore(subscribeSeen, () => (key ? readSeen(key) : null), () => null);
  if (!seen) return false;
  return links.some((l) => {
    const after = l.id in seen.links ? seen.links[l.id] : seen.since;
    return (l.replies ?? []).some((r) => r.resolvedById === null && r.userId !== myId && r.createdAt > after);
  });
}

/** Under a link's reason: "2 replies" (open ones), "1 resolved". Nothing when there are none. */
export function LinkReplyCount({ link }: { link: GraphEdgeLink }) {
  const t = useT();
  const replies = link.replies ?? [];
  const open = replies.filter((r) => r.resolvedById === null).length;
  const resolved = replies.length - open;
  const fresh = useNewReplies(link); // [layer5]
  if (replies.length === 0) return null;
  return (
    <span data-graph-link-replies={link.id} className="flex items-center gap-1.5 text-[11px] font-semibold text-sand-600">
      <CommentIcon size={11} />
      {open > 0 && (open === 1 ? t("graphNotes.replyCountOne") : t("graphNotes.replyCountMany", { n: open }))}
      {open > 0 && resolved > 0 && <span className="text-sand-400">·</span>}
      {resolved > 0 &&
        (resolved === 1 ? t("common.resolvedCountOne") : t("common.resolvedCountMany", { n: resolved }))}
      {/* [layer5] Replies another person wrote since this account last opened the link (WALK5-07). */}
      {fresh > 0 && (
        <span data-graph-link-new-replies={fresh} className="inline-flex items-center gap-1 text-[var(--kind-comment)]">
          <span aria-hidden className="size-1.5 rounded-full bg-[var(--kind-comment)]" />
          {fresh === 1 ? t("graphCover.newRepliesOne") : t("graphCover.newRepliesMany", { n: fresh })}
        </span>
      )}
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
  const { myId, authOn } = useCollab();
  // [layer5] The thread is open: its replies are seen (WALK5-07).
  const latest = (link.replies ?? []).reduce((a, r) => (r.createdAt > a ? r.createdAt : a), "");
  useEffect(() => {
    if (!authOn || !myId || !notebookId || !latest) return;
    markSeen(SEEN_KEY(myId, notebookId), link.id, latest);
  }, [authOn, myId, notebookId, link.id, latest]);
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
