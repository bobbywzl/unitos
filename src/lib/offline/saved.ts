"use client";

import { ACCOUNT_HEADER } from "@/lib/constants";
import { SAVED, openDb, tx } from "@/lib/offline/db";
import { readAccountCookie, tabAccount } from "@/lib/tab-account";

// Offline copies (SPEC.md §17, Unitos Ultra). A project saved for offline is
// its pages — the reader on each document and the notes full page — and the
// images those pages show, kept in the browser's cache under the project's
// own cache name, plus one row here in IndexedDB so the offline page can list
// it. The service worker (public/sw.js) serves the cache when the network is
// gone and refreshes any cached page or image it fetches while online. The
// route that lists what to save is the gate: GET /api/notebooks/<id>/offline
// answers 403 below Ultra.

export type SavedProject = {
  id: string;
  // The account that saved it (the readable account cookie); null with
  // sign-in off. The offline page lists the current account's rows only.
  account: string | null;
  title: string;
  sectionCount: number;
  documentCount: number;
  savedAt: number;
};

type OfflineInfo = {
  title: string;
  sectionCount: number;
  documents: { id: string; title: string; hasVideo: boolean }[];
};

export const PROJECT_CACHE_PREFIX = "unitos-project-";
const STATIC_CACHE = "unitos-static-v1";
// A saved project older than this refreshes in the background on the next
// online dashboard visit.
export const REFRESH_AFTER_MS = 60 * 60 * 1000;

const listeners = new Set<() => void>();
export function subscribeSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify() {
  for (const l of listeners) l();
}

export function offlineSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window && "indexedDB" in window;
}

export async function listSaved(): Promise<SavedProject[]> {
  if (!offlineSupported()) return [];
  try {
    const rows = await tx<SavedProject[]>(SAVED, "readonly", (s) => s.getAll());
    const account = readAccountCookie();
    return rows
      .filter((r) => r.account === account)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function isSaved(id: string): Promise<boolean> {
  return (await listSaved()).some((r) => r.id === id);
}

// The pages a project's copy holds. The reader on each document is its own
// URL, the same one the document bar opens.
function pageUrls(id: string, info: OfflineInfo): string[] {
  return [
    `/n/${id}`,
    ...info.documents.map((d) => `/n/${id}?doc=${encodeURIComponent(d.id)}`),
    `/n/${id}/notes`,
  ];
}

const STATIC_RE = /\/_next\/static\/[^"'\s)\\]+/g;
const ASSET_RE = /\/api\/(?:images\/[A-Za-z0-9_-]+|documents\/[A-Za-z0-9_-]+\/(?:figure|page)\/[A-Za-z0-9_-]+)/g;

function collect(text: string, re: RegExp, into: Set<string>) {
  for (const m of text.matchAll(re)) into.add(m[0]);
}

// A response rebuilt from its text, for the cache. The vary key would keep a
// navigation from matching, cookies never belong in a cache, and the body is
// stored decoded, so the encoding and length headers must go.
function cacheable(res: Response, body: string): Response {
  const headers = new Headers(res.headers);
  for (const name of ["vary", "set-cookie", "content-encoding", "content-length"]) {
    headers.delete(name);
  }
  return new Response(body, { status: 200, headers });
}

async function fetchInfo(id: string): Promise<OfflineInfo> {
  const account = tabAccount();
  const res = await fetch(`/api/notebooks/${id}/offline`, {
    headers: account ? { [ACCOUNT_HEADER]: account } : {},
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const error = new Error(
      detail && typeof detail.error === "string" ? detail.error : `Request failed (${res.status})`,
    );
    (error as Error & { status: number }).status = res.status;
    throw error;
  }
  return (await res.json()) as OfflineInfo;
}

// One static file into the shared static cache, once. The app's chunks are
// content-hashed, so a cached one never goes stale.
async function keepStatic(cache: Cache, url: string, cssMedia: Set<string>) {
  const hit = await cache.match(url);
  if (hit) {
    if (url.endsWith(".css")) collect(await hit.text(), STATIC_RE, cssMedia);
    return;
  }
  const res = await fetch(url);
  if (!res.ok) return;
  if (url.endsWith(".css")) {
    const text = await res.clone().text();
    collect(text, STATIC_RE, cssMedia);
  }
  await cache.put(url, res);
}

// Save progress (SPEC.md §17): two stages, pages then files — the images
// the pages show, and the chunks and fonts they load. Real fetches counted
// as they land, the same rule the ingest progress card follows (never a
// simulated timer).
export type SaveProgress = { stage: "pages" | "files"; done: number; total: number };

// Save one project for offline, or refresh its copy: every page fetched
// again, the images they show fetched if missing, anything no longer
// referenced dropped. Throws with the route's message when the route refuses
// (403 below Ultra, 404 when the project is gone).
export async function saveProject(
  id: string,
  onProgress?: (progress: SaveProgress) => void,
): Promise<SavedProject> {
  const info = await fetchInfo(id);
  const pages = pageUrls(id, info);
  const cache = await caches.open(PROJECT_CACHE_PREFIX + id);
  const staticCache = await caches.open(STATIC_CACHE);
  const assets = new Set<string>();
  const statics = new Set<string>();

  let pagesDone = 0;
  onProgress?.({ stage: "pages", done: 0, total: pages.length });
  for (const page of pages) {
    const res = await fetch(page);
    const html = res.headers.get("content-type")?.includes("text/html") ?? false;
    if (!res.ok || res.redirected || !html) throw new Error(`Page failed (${res.status})`);
    const text = await res.text();
    await cache.put(page, cacheable(res, text));
    collect(text, ASSET_RE, assets);
    collect(text, STATIC_RE, statics);
    onProgress?.({ stage: "pages", done: ++pagesDone, total: pages.length });
  }

  // The chunks the pages load, and the fonts their stylesheets load, counted
  // with the images so one stage covers everything that is not a page.
  const cssMedia = new Set<string>();
  let filesDone = 0;
  const filesTotal = assets.size + statics.size;
  onProgress?.({ stage: "files", done: 0, total: filesTotal });

  for (const url of assets) {
    if (!(await cache.match(url))) {
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch {
        // One image missing does not fail the copy: the page shows its gap.
      }
    }
    onProgress?.({ stage: "files", done: ++filesDone, total: filesTotal });
  }

  for (const url of statics) {
    try {
      await keepStatic(staticCache, url, cssMedia);
    } catch {
      // A chunk that fails to fetch is retried on the next refresh.
    }
    onProgress?.({ stage: "files", done: ++filesDone, total: filesTotal });
  }
  for (const url of cssMedia) {
    try {
      await keepStatic(staticCache, url, new Set());
    } catch {
      // Same.
    }
  }

  const keep = new Set([...pages, ...assets].map((u) => new URL(u, location.origin).href));
  for (const req of await cache.keys()) {
    if (!keep.has(req.url)) await cache.delete(req);
  }

  const row: SavedProject = {
    id,
    account: readAccountCookie(),
    title: info.title,
    sectionCount: info.sectionCount,
    documentCount: info.documents.length,
    savedAt: Date.now(),
  };
  await tx(SAVED, "readwrite", (s) => s.put(row));
  notify();
  return row;
}

export async function removeSaved(id: string): Promise<void> {
  await caches.delete(PROJECT_CACHE_PREFIX + id);
  await tx(SAVED, "readwrite", (s) => s.delete(id));
  notify();
}

// Every offline copy of the current account, gone: called on sign out.
export async function clearSaved(): Promise<void> {
  if (!offlineSupported()) return;
  for (const row of await listSaved()) await removeSaved(row.id);
}

let refreshing = false;

// Refresh the copies older than REFRESH_AFTER_MS, one at a time, in the
// background. A copy whose project is gone or no longer readable (404, 403)
// is removed. Called from the dashboard while online.
export async function refreshSaved(): Promise<void> {
  if (refreshing || !offlineSupported() || !navigator.onLine) return;
  refreshing = true;
  try {
    const stale = (await listSaved()).filter((r) => Date.now() - r.savedAt > REFRESH_AFTER_MS);
    for (const row of stale) {
      try {
        await saveProject(row.id);
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 403 || status === 404) await removeSaved(row.id);
        else return; // network: the next visit tries again
      }
    }
  } finally {
    refreshing = false;
  }
}

// The database exists before the first read, so the offline page never
// waits on an upgrade that a save would have run.
export function warmDb(): void {
  if (!offlineSupported()) return;
  void openDb().then((db) => db.close()).catch(() => undefined);
}
