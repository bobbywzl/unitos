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

  useEffect(() => {
    rememberPremium(premium);
  }, [premium]);

  useEffect(() => {
    const update = () => {
      setOffline(!navigator.onLine);
      setSyncing(isSyncing());
      void queuedCount().then(setQueued);
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

  if (!offline && queued === 0) return null;

  const label = offline
    ? premium
      ? queued > 0
        ? t("common.offlineQueued", { n: queued })
        : t("common.offlinePremium")
      : t("common.offlineReadOnly")
    : syncing || queued > 0
      ? t("common.offlineSyncing", { n: queued })
      : null;
  if (!label) return null;

  return (
    <span
      role="status"
      className={`shrink-0 truncate rounded-full px-3 py-1 text-[11px] font-semibold ${
        offline ? "bg-sand-200 text-sand-700" : "bg-sage-200 text-sage-800"
      }`}
    >
      {label}
    </span>
  );
}
