"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DuplicateAskDialog, type DuplicateChoice } from "@/components/reader/duplicate-ask";
import {
  answerHeld,
  heldAdds,
  networkDown,
  QUEUE_HELD_EVENT,
  QUEUE_SYNCED_EVENT,
  syncQueue,
  takeOwedRefresh,
  type HeldAdd,
} from "@/lib/offline/queue";

// Offline work (SPEC.md §17): the queue of writes made offline drains on every
// page, not only in the reader — on app start, and when the browser is back
// online. A drain that sent records, or a refresh held back while the network
// was down (refreshWhenOnline), refreshes the page once, so the server's copy
// replaces what was shown optimistically. A queued add of a file or a link
// the account already has waits in the queue for the reader's word (SPEC.md
// §15): the ask shows here, on whatever page is open, one add at a time, and
// on the next page load again until it is answered.
export function QueueSync() {
  const router = useRouter();
  const [held, setHeld] = useState<HeldAdd[]>([]);
  const loadHeld = useCallback(() => {
    void heldAdds().then(setHeld);
  }, []);
  useEffect(() => {
    const sync = () => {
      void syncQueue().then(() => {
        if (!networkDown() && takeOwedRefresh()) router.refresh();
        loadHeld();
      });
    };
    const synced = () => {
      takeOwedRefresh();
      router.refresh();
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener(QUEUE_SYNCED_EVENT, synced);
    window.addEventListener(QUEUE_HELD_EVENT, loadHeld);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener(QUEUE_SYNCED_EVENT, synced);
      window.removeEventListener(QUEUE_HELD_EVENT, loadHeld);
    };
  }, [router, loadHeld]);

  const first = held[0];
  if (!first) return null;

  // Add again: back in the queue, confirmed. Open the one I have: the add
  // leaves the queue and the document opens where it is — a document in no
  // project goes into the project the add was queued for first. Cancel: the
  // add leaves the queue.
  async function choose(add: HeldAdd, choice: DuplicateChoice) {
    setHeld((list) => list.filter((h) => h !== add));
    await answerHeld(add, choice === "again").catch(() => {});
    if (choice !== "open") return;
    const match = add.documents[0];
    const notebookId = match.notebookId ?? add.notebookId;
    if (!notebookId) return;
    if (match.notebookId === null) {
      const res = await fetch(`/api/notebooks/${notebookId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: match.id }),
      }).catch(() => null);
      if (!res?.ok) return;
    }
    router.push(`/n/${notebookId}?doc=${encodeURIComponent(match.id)}`);
    router.refresh();
  }

  return (
    <DuplicateAskDialog key={String(first.key)} documents={first.documents} onChoose={(c) => void choose(first, c)} />
  );
}
