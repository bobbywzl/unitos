"use client";

import { ACCOUNT_HEADER } from "@/lib/constants";
import { tabAccount } from "@/lib/tab-account";
import { MEDIA_EXTENSIONS, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";

// Offline work (SPEC.md §17, Unitos Premium): writes and uploads made while
// offline queue in IndexedDB and sync in order when the browser is back
// online. The queue holds two kinds of records: API writes (JSON body, the
// note, section, annotation, and reply routes) and uploads (the file bytes,
// replayed through the same single-request or chunked path an online upload
// takes). Syncing is at-least-once: a record leaves the queue when the server
// answers, drops with a warning on a 4xx (stale by then), and stays for the
// next attempt on a network failure.

const DB_NAME = "unitos-offline";
const WRITES = "writes";
const UPLOADS = "uploads";
const PREMIUM_KEY = "unitos-premium";
const SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;

export type QueuedWrite = {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  account: string | null;
  queuedAt: number;
};

export type QueuedUpload = {
  notebookId: string;
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
  account: string | null;
  queuedAt: number;
};

// The last known premium state, mirrored to localStorage by the offline
// status component so the queue knows it even before any request succeeds.
export function offlinePremium(): boolean {
  try {
    return localStorage.getItem(PREMIUM_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPremium(premium: boolean) {
  try {
    localStorage.setItem(PREMIUM_KEY, premium ? "1" : "0");
  } catch {
    // Storage blocked: offline queueing stays off.
  }
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WRITES)) {
        db.createObjectStore(WRITES, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(UPLOADS)) {
        db.createObjectStore(UPLOADS, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

// Queued-count listeners: the offline status pill re-renders on every change.
const listeners = new Set<() => void>();
export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify() {
  for (const l of listeners) l();
}

export async function queuedCount(): Promise<number> {
  try {
    const [writes, uploads] = await Promise.all([
      tx<number>(WRITES, "readonly", (s) => s.count()),
      tx<number>(UPLOADS, "readonly", (s) => s.count()),
    ]);
    return writes + uploads;
  } catch {
    return 0;
  }
}

export async function queueWrite(path: string, method: QueuedWrite["method"], body?: unknown): Promise<void> {
  const record: QueuedWrite = { path, method, body, account: tabAccount(), queuedAt: Date.now() };
  await tx(WRITES, "readwrite", (s) => s.add(record));
  notify();
}

export async function queueUpload(file: File, notebookId: string): Promise<void> {
  const record: QueuedUpload = {
    notebookId,
    name: file.name,
    mimeType: file.type,
    bytes: await file.arrayBuffer(),
    account: tabAccount(),
    queuedAt: Date.now(),
  };
  await tx(UPLOADS, "readwrite", (s) => s.add(record));
  notify();
}

function headers(account: string | null, json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(account ? { [ACCOUNT_HEADER]: account } : {}),
  };
}

// One drained record: true = leave the queue (done or stale), false = network
// failure, stop and wait for the next online event.
async function sendWrite(record: QueuedWrite): Promise<boolean> {
  try {
    const res = await fetch(record.path, {
      method: record.method,
      headers: headers(record.account, record.body !== undefined),
      body: record.body !== undefined ? JSON.stringify(record.body) : undefined,
    });
    if (!res.ok) console.warn("Offline sync dropped a stale write:", record.path, res.status);
    return true;
  } catch {
    return false;
  }
}

// Video and audio replay through the chunked media path; PDFs and images
// (SPEC.md §16) through the PDF path — the split document-bar.tsx makes when
// the file is dropped online.
function isMediaRecord(record: QueuedUpload): boolean {
  return (
    record.mimeType.startsWith("video/") ||
    record.mimeType.startsWith("audio/") ||
    MEDIA_EXTENSIONS.test(record.name)
  );
}

async function sendUpload(record: QueuedUpload): Promise<boolean> {
  const bytes = new Uint8Array(record.bytes);
  const media = isMediaRecord(record);
  try {
    if (!media && bytes.length <= SINGLE_REQUEST_BYTES) {
      const form = new FormData();
      form.set("file", new File([record.bytes], record.name, { type: record.mimeType }));
      form.set("notebookId", record.notebookId);
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: headers(record.account, false),
        body: form,
      });
      if (!res.ok) console.warn("Offline sync dropped an upload:", record.name, res.status);
      return true;
    }
    // The chunked path, same as an online upload of a big file (SPEC.md §11).
    const uploadId = crypto.randomUUID();
    for (let index = 0, offset = 0; offset < bytes.length; index++, offset += UPLOAD_CHUNK_BYTES) {
      const chunk = bytes.slice(offset, offset + UPLOAD_CHUNK_BYTES);
      const res = await fetch(`/api/uploads?uploadId=${uploadId}&index=${index}`, {
        method: "POST",
        headers: headers(record.account, false),
        body: chunk,
      });
      if (!res.ok) {
        console.warn("Offline sync dropped an upload:", record.name, res.status);
        return true;
      }
    }
    const res = await fetch("/api/uploads/complete", {
      method: "POST",
      headers: headers(record.account, true),
      body: JSON.stringify({
        uploadId,
        filename: record.name,
        notebookId: record.notebookId,
        kind: media ? "video" : "pdf",
      }),
    });
    if (!res.ok) console.warn("Offline sync dropped an upload:", record.name, res.status);
    return true;
  } catch {
    return false;
  }
}

// The oldest record in a store, with its key — the next one to sync.
function firstRecord<T>(store: string): Promise<{ key: IDBValidKey; record: T } | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, "readonly");
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          resolve(cursor ? { key: cursor.primaryKey, record: cursor.value as T } : null);
        };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

let syncing = false;

// Drain the queue in order, writes before uploads. Called on the online event,
// on app start, and after new records land while online.
export async function syncQueue(): Promise<void> {
  if (syncing || isOffline()) return;
  syncing = true;
  notify();
  try {
    for (const store of [WRITES, UPLOADS] as const) {
      for (;;) {
        const head = await firstRecord<QueuedWrite | QueuedUpload>(store);
        if (!head) break;
        const done =
          store === WRITES
            ? await sendWrite(head.record as QueuedWrite)
            : await sendUpload(head.record as QueuedUpload);
        if (!done) return; // network failure: wait for the next online event
        await tx(store, "readwrite", (s) => s.delete(head.key));
        notify();
      }
    }
  } finally {
    syncing = false;
    notify();
  }
}

export function isSyncing(): boolean {
  return syncing;
}
