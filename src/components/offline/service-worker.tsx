"use client";

import { useEffect } from "react";
import { useLang } from "@/components/lang-provider";
import { warmDb } from "@/lib/offline/saved";

// Registers the service worker (public/sw.js) that keeps the app loading
// offline (SPEC.md §17) and tells it the app's language, for the message an
// AI call gets offline. Production only: the dev server's chunks change on
// every edit and must not be cached.
export function ServiceWorker() {
  const lang = useLang();
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    void navigator.serviceWorker.ready
      .then((registration) => registration.active?.postMessage({ type: "lang", lang }))
      .catch(() => undefined);
    warmDb();
  }, [lang]);
  return null;
}
