"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { clearNotSaved, notSavedText, readNotSaved, subscribeNotSaved } from "@/lib/offline/not-saved";
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
// account's premium state for the queue and kicks off the sync. A write the
// server refused on replay keeps its words in the not-saved list (REV9-03):
// online, with the queue drained, the pill says how many and copies their
// words on a press, then the list goes.
export function OfflineStatus() {
  const t = useT();
  const { myId, premium } = useCollab();
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // Quotes of a note saved offline that no longer resolved when it synced:
  // the note kept their words as text (REV5-06). Said for 10 seconds.
  const [kept, setKept] = useState(0);
  // Writes the queue dropped on replay, their words kept for this account
  // (lib/offline/not-saved.ts): the count, read again on every change.
  const notSaved = useSyncExternalStore(
    subscribeNotSaved,
    () => readNotSaved(myId).length,
    () => 0,
  );
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 3_000);
    return () => clearTimeout(timer);
  }, [copied]);

  // The words go to the clipboard, then the list goes. A clipboard the
  // browser refuses keeps the line: the words are still here.
  async function copyNotSaved() {
    const text = notSavedText(readNotSaved(myId));
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    clearNotSaved(myId);
    setCopied(true);
  }

  // A quote kept as text on replay (REV5-06): said in this same pill.
  if (kept > 0 && !offline) {
    return (
      <span
        role="status"
        data-offline-quotes-kept={kept}
        className="min-w-0 shrink truncate rounded-full bg-sand-200 px-3 py-1 text-[11px] font-semibold text-sand-700"
        title={
          kept === 1
            ? t("common.offlineQuoteKeptOne")
            : t("common.offlineQuotesKept", { n: kept })
        }
      >
        {kept === 1
          ? t("common.offlineQuoteKeptOne")
          : t("common.offlineQuotesKept", { n: kept })}
      </span>
    );
  }
  if (copied && !offline) {
    return (
      <span
        role="status"
        data-offline-not-saved-copied=""
        className="min-w-0 shrink truncate rounded-full bg-sand-200 px-3 py-1 text-[11px] font-semibold text-sand-700"
      >
        {t("common.offlineNotSavedCopied")}
      </span>
    );
  }
  // Dropped writes (REV9-03): the one line in the pill's place, until copied.
  if (notSaved > 0 && !offline && !syncing && queued === 0) {
    const label = notSaved === 1 ? t("common.offlineNotSavedOne") : t("common.offlineNotSaved", { n: notSaved });
    return (
      <button
        type="button"
        onClick={() => void copyNotSaved()}
        data-offline-not-saved={notSaved}
        data-track="offline-not-saved-copy"
        title={t("common.offlineNotSavedTip")}
        className="min-w-0 shrink truncate rounded-full bg-clay-100 px-3 py-1 text-[11px] font-semibold text-clay-800"
      >
        {label}
      </button>
    );
  }
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
