"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Person } from "@/lib/person";
import { readAccountCookie } from "@/lib/tab-account";
import type { SectionView } from "@/lib/types";

export type SyncPresence = Person & { documentId: string | null };

/** [cost10] The project's sections the poll read while the page's refresh
    waited (COST10-04): at `rev`, from GET …/notes-view. */
export type LiveNotes = { rev: number; sections: SectionView[] };

// Every open tab polls on this cadence, and each poll is a few database
// round trips, so the cadence is the corpus's baseline load. The presence
// window (sync/route.ts) is 25 s; a poll well inside it keeps people present.
const POLL_MS = 8_000;
// While another person has the same document open, their words land within
// seconds (SPEC.md §29).
const SHARED_POLL_MS = 2_000;

// Typing must never be clobbered: a refresh waits while an input, textarea, or
// editable block has focus, or a text selection is open. The page editor
// takes a refresh while typing: its save merges (components/docs/use-docs-save.ts).
function refreshSafe(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el?.closest("[data-docs-body]")) return true;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
    return false;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return false;
  return true;
}

/** A page's own save moved these corpora's revs ({ [notebookId]: rev }). */
export const OWN_SAVE_EVENT = "dissect:own-save";
/** A page needs the stored copy's highlights now (its marks changed). */
export const REFRESH_EVENT = "dissect:refresh-now";

// Live sync of one open corpus: poll the sync route, stamp presence, and
// refresh the page when the corpus's rev moves — that is how one reader sees
// another's changes land. Returns who else has the corpus open, and [cost10]
// the notes read in place of a refresh while one waits (COST10-04): while
// the graph is open (deferWhile), a rev move fetches the project's sections
// alone (GET …/notes-view, 7 to 23 KB) instead of the whole page's RSC
// (57 to 70 KB), the graph draws them, and the page's refresh runs once the
// graph closes. The reader's panes under the graph show the page as it was
// until then.
export function useNotebookSync({
  notebookId,
  documentId,
  rev,
  enabled,
  accountId,
  deferWhile = false,
}: {
  notebookId: string;
  documentId: string | null;
  rev: number;
  enabled: boolean;
  // The account this tab was rendered for; null = sign-in off, no check. When
  // the browser's account cookie stops matching (signed out or switched in
  // another tab), polling stops — the tab must not stamp presence or refresh
  // as someone else. The account guard shows the notice.
  accountId: string | null;
  /** [cost10] While true (the graph is open), a rev move reads the notes
      alone and the page's refresh waits (COST10-04). */
  deferWhile?: boolean;
}): { people: SyncPresence[]; live: LiveNotes | null } {
  const router = useRouter();
  const [people, setPeople] = useState<SyncPresence[]>([]);
  // [cost10] The notes read while the refresh waits, the rev they were read
  // for, and their answer's ETag (a 304 when a rev move changed no note).
  const [live, setLive] = useState<LiveNotes | null>(null);
  const liveRev = useRef(0);
  const liveEtag = useRef<string | null>(null);
  // The rev the page was rendered with. A server render carries the fresh
  // value back down, so a pending refresh settles here.
  const knownRev = useRef(rev);
  const refreshDue = useRef(false);
  // The newest rev a poll answered: a page render at or past it owes no
  // refresh (the page's own save landed it while one waited).
  const seenRev = useRef(rev);
  const inFlight = useRef(false);
  const shared = documentId !== null && people.some((p) => p.documentId === documentId);

  useEffect(() => {
    knownRev.current = Math.max(knownRev.current, rev);
    if (rev >= seenRev.current) refreshDue.current = false;
  }, [rev]);

  // The page's own save, when it was the only change, needs no refresh:
  // the page already shows it.
  useEffect(() => {
    const onOwn = (e: Event) => {
      const next = (e as CustomEvent<Record<string, number>>).detail?.[notebookId];
      if (next === knownRev.current + 1) knownRev.current = next;
    };
    const onRefresh = () => router.refresh();
    window.addEventListener(OWN_SAVE_EVENT, onOwn);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener(OWN_SAVE_EVENT, onOwn);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [notebookId, router]);

  useEffect(() => {
    if (!enabled) return;

    async function poll() {
      if (inFlight.current || document.hidden) return;
      if (accountId && readAccountCookie() !== accountId) return;
      inFlight.current = true;
      try {
        const doc = documentId ? `?doc=${encodeURIComponent(documentId)}` : "";
        const res = await fetch(`/api/notebooks/${notebookId}/sync${doc}`);
        // The project is gone for this account: the owner removed them, or
        // it was deleted. The page renders again (Page not found) once no
        // typing would be cut short; the words typed stay in their drafts.
        if (res.status === 404) {
          if (refreshSafe()) router.refresh();
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { rev: number; people: SyncPresence[] };
        // A new list only when someone comes, goes, or opens another
        // document: each new list renders the whole workspace.
        setPeople((old) => (JSON.stringify(old) === JSON.stringify(data.people) ? old : data.people));
        seenRev.current = Math.max(seenRev.current, data.rev);
        if (data.rev > knownRev.current) refreshDue.current = true;
        if (refreshDue.current && deferWhile) {
          // [cost10] COST10-04: the graph is open. The notes alone are read,
          // once per rev, and the refresh stays due for when it closes.
          if (data.rev > liveRev.current && refreshSafe()) {
            liveRev.current = data.rev;
            const notes = await fetch(`/api/notebooks/${notebookId}/notes-view`, {
              headers: liveEtag.current ? { "If-None-Match": liveEtag.current } : {},
            });
            if (notes.status === 304) setLive((old) => (old ? { rev: data.rev, sections: old.sections } : old));
            else if (notes.ok) {
              liveEtag.current = notes.headers.get("etag");
              const body = (await notes.json()) as { sections: SectionView[] };
              setLive({ rev: data.rev, sections: body.sections });
            } else liveRev.current = 0; // the next tick tries again
          }
        } else if (refreshDue.current && refreshSafe()) {
          refreshDue.current = false;
          knownRev.current = data.rev;
          router.refresh();
        }
      } catch {
        // Offline or a cold function: the next tick tries again.
      } finally {
        inFlight.current = false;
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), shared ? SHARED_POLL_MS : POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // deferWhile: the graph closed (or opened): the poll runs at once, so a
    // refresh that waited runs now.
  }, [notebookId, documentId, enabled, accountId, router, shared, deferWhile]);

  return { people, live };
}
