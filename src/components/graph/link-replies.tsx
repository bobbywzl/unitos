"use client";

import { TEXT_META } from "./graph-ui";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { GraphEdgeLink } from "@/lib/types";
import type { GraphComment, ProjectCoverage } from "@/lib/graph/coverage-view";
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

// REV6-05: the store is read during render and written only from effects
// (the first look's `since`, a thread opened, a prune); another tab's write
// reaches this one by the `storage` event; a link that is gone leaves it.
//
// [lists9] What is new since this account's last visit (WALK9-06), on the
// same mark, from the same store and its one `since`: a link another person
// made, a comment another person wrote, or a comment's newest reply another
// person wrote, after `since` and not looked at since — a link's thread
// shown (LinkReplies), a comment's row pressed (useMarkCommentSeen). The
// curve draws the dot for a new link, the node's comments chip for a new
// comment or reply, and useNewCount counts them for the Documents head.

type Seen = { since: string; links: Record<string, string>; comments?: Record<string, string> };
const SEEN_PREFIX = "unitos-link-seen:";
const SEEN_KEY = (accountId: string, notebookId: string) => `${SEEN_PREFIX}${accountId}:${notebookId}`;
const seenListeners = new Set<() => void>();
const seenCache = new Map<string, Seen>();
const SEEN_KEEP_MS = 90 * 24 * 3600_000;

function stored(key: string): Seen | null {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as Seen).since === "string" && typeof (parsed as Seen).links === "object") {
      return parsed as Seen;
    }
  } catch {
    // storage off: the replies are not marked new
  }
  return null;
}

/** Read only: a first look starts now, and an effect stores it (keepSeen). */
function readSeen(key: string): Seen {
  const kept = seenCache.get(key);
  if (kept) return kept;
  const seen = stored(key) ?? { since: new Date().toISOString(), links: {} };
  seenCache.set(key, seen);
  return seen;
}

function writeSeen(key: string, next: Seen) {
  seenCache.set(key, next);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // kept for this tab only
  }
  for (const l of seenListeners) l();
}

/** The first look's `since` goes to storage, unless another tab stored one. */
function keepSeen(key: string) {
  if (stored(key)) return;
  writeSeen(key, readSeen(key));
}

function markSeen(key: string, linkId: string, at: string) {
  // Another tab's marks are read first, so this write keeps them.
  const seen = stored(key) ?? readSeen(key);
  if ((seen.links[linkId] ?? "") >= at) return;
  writeSeen(key, { ...seen, links: { ...seen.links, [linkId]: at } });
}

// [lists9] A comment looked at, with its newest words (WALK9-06).
function markCommentSeen(key: string, commentId: string, at: string) {
  const seen = stored(key) ?? readSeen(key);
  const comments = seen.comments ?? {};
  if ((comments[commentId] ?? "") >= at) return;
  writeSeen(key, { ...seen, comments: { ...comments, [commentId]: at } });
}

/** Drop the marks of links the graph's answer no longer holds: every one
    when the answer is whole (it holds the provenance links), else those
    whose last reply is older than 90 days. */
export function usePruneLinkSeen(notebookId: string, linkIds: string[] | null, whole: boolean) {
  const { myId, authOn } = useCollab();
  useEffect(() => {
    if (!authOn || !myId || !linkIds) return;
    const key = SEEN_KEY(myId, notebookId);
    const seen = stored(key);
    if (!seen) return;
    const live = new Set(linkIds);
    const cutoff = new Date(Date.now() - SEEN_KEEP_MS).toISOString();
    const links = Object.fromEntries(
      Object.entries(seen.links).filter(([id, at]) => live.has(id) || (!whole && at >= cutoff)),
    );
    // [lists9] A comment's mark drops once its words are older than 90 days.
    const comments = Object.fromEntries(Object.entries(seen.comments ?? {}).filter(([, at]) => at >= cutoff));
    const fewer =
      Object.keys(links).length < Object.keys(seen.links).length ||
      Object.keys(comments).length < Object.keys(seen.comments ?? {}).length;
    if (fewer) writeSeen(key, { ...seen, links, ...(seen.comments ? { comments } : {}) });
  }, [authOn, myId, notebookId, linkIds, whole]);
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && !e.key.startsWith(SEEN_PREFIX)) return;
  if (e.key === null) seenCache.clear();
  else seenCache.delete(e.key);
  for (const l of seenListeners) l();
}

function subscribeSeen(listener: () => void) {
  if (seenListeners.size === 0) window.addEventListener("storage", onStorage);
  seenListeners.add(listener);
  return () => {
    seenListeners.delete(listener);
    if (seenListeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** The store of this account and project, kept from an effect. */
function useSeen(): { seen: Seen | null; myId: string } {
  const { notebookId } = useParams<{ notebookId?: string }>();
  const { myId, authOn } = useCollab();
  const key = authOn && myId && notebookId ? SEEN_KEY(myId, notebookId) : null;
  const seen = useSyncExternalStore(subscribeSeen, () => (key ? readSeen(key) : null), () => null);
  useEffect(() => {
    if (key) keepSeen(key);
  }, [key]);
  return { seen, myId };
}

// The open replies on a link another person wrote after this account last
// opened its thread (or after `since`, a thread never opened).
function newReplies(seen: Seen, myId: string, link: GraphEdgeLink): number {
  const after = link.id in seen.links ? seen.links[link.id] : seen.since;
  return (link.replies ?? []).filter((r) => r.resolvedById === null && r.userId !== myId && r.createdAt > after).length;
}

// [lists9] A link another person made after `since`, its thread never shown
// since (WALK9-06). A recommended link is nobody's until accepted.
function newLink(seen: Seen, myId: string, link: GraphEdgeLink): boolean {
  if (link.recommended || link.provenance || !link.createdById || link.createdById === myId || !link.createdAt) return false;
  return !(link.id in seen.links) && link.createdAt > seen.since;
}

// [lists9] An open comment another person wrote, or whose newest reply
// another person wrote, after this account last pressed its row (or after
// `since`). An answer from before the fields existed marks nothing.
function newComment(seen: Seen, myId: string, c: GraphComment): boolean {
  if (!c.open) return false;
  const after = seen.comments?.[c.id] ?? seen.since;
  const own = c.authorId !== null && c.authorId !== myId && (c.createdAt ?? "") > after;
  const reply = c.newest != null && !c.newest.resolved && c.newest.userId !== myId && c.newest.createdAt > after;
  return own || reply;
}

/** The open replies on a link another person wrote after this account last
    opened its thread. 0 on the server and with sign-in off (one reader). */
export function useNewReplies(link: GraphEdgeLink): number {
  const { seen, myId } = useSeen();
  return seen ? newReplies(seen, myId, link) : 0;
}

/** The new replies on any of a curve's links, or [lists9] a new link among
    them (the curve's dot, WALK9-06). */
export function useAnyNewReplies(links: GraphEdgeLink[]): boolean {
  const { seen, myId } = useSeen();
  if (!seen) return false;
  return links.some((l) => newLink(seen, myId, l) || newReplies(seen, myId, l) > 0);
}

/** [lists9] A link another person made since this account's last visit (WALK9-06). */
export function useNewLink(link: GraphEdgeLink): boolean {
  const { seen, myId } = useSeen();
  return seen !== null && newLink(seen, myId, link);
}

/** [lists9] A comment another person wrote, or whose newest reply another
    person wrote, since this account's last visit (WALK9-06). */
export function useNewComment(c: GraphComment): boolean {
  const { seen, myId } = useSeen();
  return seen !== null && newComment(seen, myId, c);
}

/** [lists9] useNewComment as a rule over a list: the node's comments chip,
    and a list that puts the new rows first. */
export function useNewComments(): (c: GraphComment) => boolean {
  const { seen, myId } = useSeen();
  return useCallback((c: GraphComment) => seen !== null && newComment(seen, myId, c), [seen, myId]);
}

/** [lists9] What is new since this account's last visit, counted once each
    (WALK9-06): the links another person made or replied on, and the
    comments another person wrote or replied on. For the Documents head. */
export function useNewCount(links: GraphEdgeLink[], coverage: ProjectCoverage | null | undefined): number {
  const { seen, myId } = useSeen();
  if (!seen) return 0;
  const onLinks = links.filter((l) => newLink(seen, myId, l) || newReplies(seen, myId, l) > 0).length;
  const onComments = Object.values(coverage?.documents ?? {}).reduce(
    (n, d) => n + (d.comments ?? []).filter((c) => newComment(seen, myId, c)).length,
    0,
  );
  return onLinks + onComments;
}

/** [lists9] A comment's row pressed: the comment, with its newest words, is
    looked at (WALK9-06). Nothing with sign-in off. */
export function useMarkCommentSeen(): (c: GraphComment) => void {
  const { notebookId } = useParams<{ notebookId?: string }>();
  const { myId, authOn } = useCollab();
  return useCallback(
    (c: GraphComment) => {
      const at = c.newest?.createdAt ?? c.createdAt;
      if (!authOn || !myId || !notebookId || !at) return;
      markCommentSeen(SEEN_KEY(myId, notebookId), c.id, at);
    },
    [authOn, myId, notebookId],
  );
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
    <span data-graph-link-replies={link.id} className={`flex items-center gap-1.5 ${TEXT_META} font-semibold text-sand-600`}>
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
export function LinkReplies({
  link,
  openRequest,
}: {
  link: GraphEdgeLink;
  /** [panel6] The link panel's Reply (WALK6-05): each new value opens the
      box, which sits above the replies. Left out: the thread's own Reply. */
  openRequest?: number;
}) {
  const { notebookId } = useParams<{ notebookId?: string }>();
  const { myId, authOn } = useCollab();
  // [layer5] The thread is open: its replies are seen (WALK5-07), and
  // [lists9] the link itself, a new one with no reply yet (WALK9-06).
  const latest = (link.replies ?? []).reduce((a, r) => (r.createdAt > a ? r.createdAt : a), link.createdAt ?? "");
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
        openRequest={openRequest}
        composerFirst={openRequest !== undefined}
      />
    </div>
  );
}
