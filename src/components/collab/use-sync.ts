"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Person } from "@/lib/person";
import { readAccountCookie } from "@/lib/tab-account";

export type SyncPresence = Person & { documentId: string | null };

const POLL_MS = 4_000;

// Typing must never be clobbered: a refresh waits while an input, textarea, or
// editable block has focus, or a text selection is open.
function refreshSafe(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
    return false;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return false;
  return true;
}

// Live sync of one open corpus: poll the sync route, stamp presence, and
// refresh the page when the corpus's rev moves — that is how one reader sees
// another's changes land. Returns who else has the corpus open.
export function useNotebookSync({
  notebookId,
  documentId,
  rev,
  enabled,
  accountId,
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
}): SyncPresence[] {
  const router = useRouter();
  const [people, setPeople] = useState<SyncPresence[]>([]);
  // The rev the page was rendered with. A server render carries the fresh
  // value back down, so a pending refresh settles here.
  const knownRev = useRef(rev);
  const refreshDue = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    knownRev.current = Math.max(knownRev.current, rev);
  }, [rev]);

  useEffect(() => {
    if (!enabled) return;

    async function poll() {
      if (inFlight.current || document.hidden) return;
      if (accountId && readAccountCookie() !== accountId) return;
      inFlight.current = true;
      try {
        const doc = documentId ? `?doc=${encodeURIComponent(documentId)}` : "";
        const res = await fetch(`/api/notebooks/${notebookId}/sync${doc}`);
        if (!res.ok) return;
        const data = (await res.json()) as { rev: number; people: SyncPresence[] };
        setPeople(data.people);
        if (data.rev > knownRev.current) refreshDue.current = true;
        if (refreshDue.current && refreshSafe()) {
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
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [notebookId, documentId, enabled, accountId, router]);

  return people;
}
