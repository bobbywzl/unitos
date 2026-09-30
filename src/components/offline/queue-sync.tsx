"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { networkDown, QUEUE_SYNCED_EVENT, syncQueue, takeOwedRefresh } from "@/lib/offline/queue";

// Offline work (SPEC.md §17): the queue of writes made offline drains on every
// page, not only in the reader — on app start, and when the browser is back
// online. A drain that sent records, or a refresh held back while the network
// was down (refreshWhenOnline), refreshes the page once, so the server's copy
// replaces what was shown optimistically.
export function QueueSync() {
  const router = useRouter();
  useEffect(() => {
    const sync = () => {
      void syncQueue().then(() => {
        if (!networkDown() && takeOwedRefresh()) router.refresh();
      });
    };
    const synced = () => {
      takeOwedRefresh();
      router.refresh();
    };
    sync();
    window.addEventListener("online", sync);
    window.addEventListener(QUEUE_SYNCED_EVENT, synced);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener(QUEUE_SYNCED_EVENT, synced);
    };
  }, [router]);
  return null;
}
