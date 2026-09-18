"use client";

import { useEffect } from "react";
import { warmDb } from "@/lib/offline/saved";

// Registers the service worker (public/sw.js) that keeps the app loading
// offline (SPEC.md §17). Production only: the dev server's chunks change on
// every edit and must not be cached.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    warmDb();
  }, []);
  return null;
}
