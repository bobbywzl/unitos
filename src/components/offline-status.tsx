"use client";

import { useEffect, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import {
  isSyncing,
  queuedCount,
  rememberPremium,
  subscribeQueue,
  syncQueue,
  takeQuotesKept,
} from "@/lib/offline/queue";

// Offline work (SPEC.md §17, Unitos Premium): the pill in the workspace
// header. Hidden while online with an empty queue. Offline it says so — with
// the queued count for premium accounts, with the plain limit for the rest.
// Back online it shows the sync until the queue drains. It also mirrors the
// account's premium state for the queue and kicks off the sync.
export function OfflineStatus() {
  const t = useT();
  const { premium } = useCollab();
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // Quotes of a note saved offline that no longer resolved when it synced:
  // the note kept their words as text (REV5-06). Said for 10 seconds.
  const [kept, setKept] = useState(0);

  useEffect(() => {
    rememberPremium(premium);
  }, [premium]);

  useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      setSyncing(isSyncing());
      void queuedCount().then(setQueued);
      const n = takeQuotesKept();
      if (n > 0) setKept((prev) => prev + n);
    };
    update();
    const online = () => {
      update();
      void syncQueue().then(update);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", update);
    const unsubscribe = subscribeQueue(update);
    // App start with records left from the last session: sync now.
    void syncQueue().then(update);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", update);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (kept === 0) return;
    const timer = setTimeout(() => setKept(0), 10_000);
    return () => clearTimeout(timer);
  }, [kept]);

  // Over the graph too (it covers the header): a toast at the top.
  const keptNotice = kept > 0 && (
    <p
      role="status"
      data-offline-quotes-kept={kept}
      className="fixed top-3 left-1/2 z-[60] flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink/90 px-3.5 py-2 text-xs leading-snug text-paper shadow-float"
    >
      {kept === 1
        ? t("common.offlineQuoteKeptOne")
        : t("common.offlineQuotesKept", { n: kept })}
      <button
        onClick={() => setKept(0)}
        aria-label={t("common.close")}
        className="shrink-0 rounded-full px-1.5 text-paper/80 hover:bg-paper/20 hover:text-paper pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        ✕
      </button>
    </p>
  );
  if (!offline && queued === 0) return keptNotice || null;

  const label = offline
    ? premium
      ? queued > 0
        ? t("common.offlineQueued", { n: queued })
        : t("common.offlinePremium")
      : t("common.offlineReadOnly")
    : syncing || queued > 0
      ? t("common.offlineSyncing", { n: queued })
      : null;
  if (!label) return keptNotice || null;

  return (
    <>
      {keptNotice}
      <span
        role="status"
        className={`shrink-0 truncate rounded-full px-3 py-1 text-[11px] font-semibold ${
          offline ? "bg-sand-200 text-sand-700" : "bg-sage-200 text-sage-800"
        }`}
      >
        {label}
      </span>
    </>
  );
}
