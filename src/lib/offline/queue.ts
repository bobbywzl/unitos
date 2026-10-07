"use client";

import { ACCOUNT_HEADER } from "@/lib/constants";
import { duplicateOf, type DuplicateMatch } from "@/lib/documents/duplicate-answer";
import { openDb, tx, UPLOADS, WRITES } from "@/lib/offline/db";
import { tabAccount } from "@/lib/tab-account";
import { MEDIA_EXTENSIONS, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";

// Offline work (SPEC.md §17, Unitos Premium): writes and uploads made while
// offline queue in IndexedDB and sync in order when the browser is back
// online. The queue holds two kinds of records: API writes (JSON body, the
// note, section, annotation, and reply routes) and uploads (the file bytes,
// replayed through the same single-request or chunked path an online upload
// takes). Syncing is at-least-once: a record leaves the queue when the server
// answers, drops with a warning on a 4xx other than 401 (stale by then), and
// stays for the next attempt on a network failure, a 401 (signed out: it
// waits for the sign-in), or a 5xx — a 5xx drops only on its MAX_ATTEMPTS-th
// try, so one bad record cannot hold the queue forever. One tab drains at a
// time (a Web Lock), so two open tabs never send a record twice. A note write
// is never refused for a part of it: a quote whose anchor no longer resolves
// lands its words without the source (replayBody), and words written to a
// note deleted meanwhile land in a new note (lib/notes/gone.ts). While
// records wait and the browser says online, a write that did not reach the
// server runs again after a growing wait (retryLater). A queued add of a
// file or a link the account already has comes back 409 `duplicate`
// (SPEC.md §15): it is never dropped. It stays queued, held with the
// documents the answer named, the drain passes over it, and the reader is
// asked on the next page (QueueSync): Add again sends it once more,
// confirmed; Open the one I have and Cancel take it out.

const PREMIUM_KEY = "unitos-premium";
const SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
const SYNC_LOCK = "unitos-offline-sync";
/** Fired on window when a drain sent at least one record. */
export const QUEUE_SYNCED_EVENT = "unitos:queue-synced";
/** Fired on window when a drain held a queued add for the reader's word. */
export const QUEUE_HELD_EVENT = "unitos:queue-held";
/** Fired on window when a note write's quote landed without its source: the
    anchor no longer resolves (detail: { noteId }). */
export const SOURCE_LOST_EVENT = "unitos:source-lost";
/** Fired on window when words written to a gone note were kept as a new
    note (detail: { from, to }; lib/notes/gone.ts). */
export const NOTE_KEPT_EVENT = "unitos:note-kept";
// While records wait and the browser says online, the drain runs again
// after a growing wait: a write that failed with the browser online (a
// Wi-Fi handover, a proxy reset) sends no online event. Only a write that
// did not reach the server runs again this way; a 5xx counts against its
// MAX_ATTEMPTS, so a timer never spends those tries.
const RETRY_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

export type QueuedWrite = {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  account: string | null;
  queuedAt: number;
  // Tries that met a 5xx.
  attempts?: number;
  // A repeat add waiting for the reader's word: the documents the 409 named.
  held?: DuplicateMatch[];
};

export type QueuedUpload = {
  notebookId: string;
  name: string;
  mimeType: string;
  bytes: ArrayBuffer;
  account: string | null;
  queuedAt: number;
  attempts?: number;
  // A repeat add waiting for the reader's word, and the reader's Add again.
  held?: DuplicateMatch[];
  confirmDuplicate?: boolean;
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

// A write queued since the last drain that reached the server: the network
// is down though the browser may still report itself online.
let queuedSinceSync = false;

/** The network is down: the browser says so, or a write just had to queue. */
export function networkDown(): boolean {
  return isOffline() || queuedSinceSync;
}

// A refresh held back while the network was down, owed once the queue drains.
let refreshOwed = false;

/** router.refresh(), unless the network is down. Offline, a refresh is a
    failed server fetch, which Next turns into a full page load — the
    offline page, or a saved copy without the change — and everything held
    in memory on the page is lost. It runs once the queue drains instead
    (QueueSync, components/offline/queue-sync.tsx). */
export function refreshWhenOnline(router: { refresh: () => void }): void {
  if (networkDown()) {
    refreshOwed = true;
    return;
  }
  router.refresh();
}

/** True once per refresh owed; clears it. */
export function takeOwedRefresh(): boolean {
  const owed = refreshOwed;
  refreshOwed = false;
  return owed;
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
  queuedSinceSync = true;
  notify();
  // Queued with the browser online: the server was out of reach for a
  // moment, so try again now rather than at the next online event.
  if (!isOffline()) void syncQueue();
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
  queuedSinceSync = true;
  notify();
  if (!isOffline()) void syncQueue();
}

function headers(account: string | null, json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(account ? { [ACCOUNT_HEADER]: account } : {}),
  };
}

// One drained record's outcome: "done" leaves the queue (sent, or stale on a
// 4xx), "wait" stops the drain and keeps it (no network, or a 401), "retry"
// stops the drain and counts a 5xx against it, `held` keeps it for the
// reader's word on a repeat add and the drain goes on.
type Sent = "done" | "wait" | "retry" | { held: DuplicateMatch[] };

/** A 409 that names a repeat add: the documents it names. */
async function heldBy(res: Response): Promise<DuplicateMatch[] | null> {
  if (res.status !== 409) return null;
  return duplicateOf(await res.clone().json().catch(() => null));
}

function outcome(res: Response, record: QueuedWrite | QueuedUpload, label: string): Sent {
  if (res.ok) return "done";
  if (res.status === 401) return "wait";
  if (res.status >= 500 && (record.attempts ?? 0) + 1 < MAX_ATTEMPTS) return "retry";
  console.warn("Offline sync dropped a write:", label, res.status);
  return "done";
}

const NOTE_WRITE = /^\/api\/notes(?:\/([^/]+))?$/;

/** The body a record replays with. A note write with a quote's source keeps
    its words when the anchor no longer resolves (onSourceLost "keep"): the
    words land without the source, never dropped with it. Records queued
    before this rule replay the same way. */
function replayBody(record: QueuedWrite): unknown {
  const body = record.body;
  if (!body || typeof body !== "object" || !NOTE_WRITE.test(record.path)) return body;
  if (record.method === "DELETE") return body;
  if ("source" in body || "addSource" in body) return { ...body, onSourceLost: "keep" };
  return body;
}

/** Tell the page what a note write's answer says: a quote that lost its
    source, words kept as a new note. */
async function announce(record: QueuedWrite, res: Response): Promise<void> {
  if (typeof window === "undefined" || !NOTE_WRITE.test(record.path) || record.method === "DELETE") return;
  const answer = (await res.json().catch(() => null)) as {
    id?: unknown;
    sourceDropped?: unknown;
    keptAs?: unknown;
    content?: unknown;
  } | null;
  if (!answer) return;
  const from = NOTE_WRITE.exec(record.path)?.[1];
  const id = typeof answer.id === "string" ? answer.id : from;
  if (answer.sourceDropped === true && id) {
    window.dispatchEvent(new CustomEvent(SOURCE_LOST_EVENT, { detail: { noteId: id } }));
  }
  if (typeof answer.keptAs === "string" && from && from !== answer.keptAs) {
    const content = typeof answer.content === "string" ? answer.content : undefined;
    window.dispatchEvent(new CustomEvent(NOTE_KEPT_EVENT, { detail: { from, to: answer.keptAs, content } }));
  }
}

async function sendWrite(record: QueuedWrite): Promise<Sent> {
  try {
    const body = replayBody(record);
    const res = await fetch(record.path, {
      method: record.method,
      headers: headers(record.account, body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.ok) await announce(record, res);
    const held = await heldBy(res);
    if (held) return { held };
    return outcome(res, record, record.path);
  } catch {
    return "wait";
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

async function sendUpload(record: QueuedUpload): Promise<Sent> {
  const bytes = new Uint8Array(record.bytes);
  const media = isMediaRecord(record);
  try {
    if (!media && bytes.length <= SINGLE_REQUEST_BYTES) {
      const form = new FormData();
      form.set("file", new File([record.bytes], record.name, { type: record.mimeType }));
      form.set("notebookId", record.notebookId);
      if (record.confirmDuplicate) form.set("confirmDuplicate", "1");
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: headers(record.account, false),
        body: form,
      });
      const held = await heldBy(res);
      if (held) return { held };
      return outcome(res, record, record.name);
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
      if (!res.ok) return outcome(res, record, record.name);
    }
    const res = await fetch("/api/uploads/complete", {
      method: "POST",
      headers: headers(record.account, true),
      body: JSON.stringify({
        uploadId,
        filename: record.name,
        notebookId: record.notebookId,
        kind: media ? "video" : "pdf",
        ...(record.confirmDuplicate ? { confirmDuplicate: true } : {}),
      }),
    });
    const held = await heldBy(res);
    if (held) return { held };
    return outcome(res, record, record.name);
  } catch {
    return "wait";
  }
}

// The oldest record in a store that is not held for the reader's word,
// with its key — the next one to sync.
function firstRecord<T extends { held?: unknown }>(store: string): Promise<{ key: IDBValidKey; record: T } | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, "readonly");
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor && (cursor.value as T).held) {
            cursor.continue();
            return;
          }
          resolve(cursor ? { key: cursor.primaryKey, record: cursor.value as T } : null);
        };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

let syncing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retries = 0;

/** Run the drain again after a growing wait, while the browser says online. */
function retryLater() {
  if (typeof window === "undefined" || retryTimer || isOffline()) return;
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncQueue();
  }, wait);
}

// Drain the queue in order, writes before uploads. Called on the online event,
// on app start, and after new records land while online. One tab at a time:
// a tab waits out another tab's drain, then finds the records it sent gone.
export async function syncQueue(): Promise<void> {
  if (syncing || isOffline()) return;
  syncing = true;
  notify();
  let sent = 0;
  let held = 0;
  try {
    const drain = async () => {
      for (const store of [WRITES, UPLOADS] as const) {
        for (;;) {
          const head = await firstRecord<QueuedWrite | QueuedUpload>(store);
          if (!head) break;
          const result =
            store === WRITES
              ? await sendWrite(head.record as QueuedWrite)
              : await sendUpload(head.record as QueuedUpload);
          if (result === "wait") return "wait" as const;
          if (typeof result === "object") {
            await tx(store, "readwrite", (s) => s.put({ ...head.record, held: result.held }, head.key));
            held++;
            notify();
            continue;
          }
          if (result === "retry") {
            const attempts = (head.record.attempts ?? 0) + 1;
            await tx(store, "readwrite", (s) => s.put({ ...head.record, attempts }, head.key));
            return "retry" as const;
          }
          await tx(store, "readwrite", (s) => s.delete(head.key));
          sent++;
          notify();
        }
      }
      return "drained" as const;
    };
    const ended =
      typeof navigator !== "undefined" && navigator.locks
        ? await navigator.locks.request(SYNC_LOCK, drain)
        : await drain();
    if (ended === "drained") {
      queuedSinceSync = false;
      retries = 0;
    } else if (ended === "wait") retryLater();
  } finally {
    syncing = false;
    notify();
    if (sent > 0 && typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_SYNCED_EVENT));
    if (held > 0 && typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_HELD_EVENT));
  }
}

export function isSyncing(): boolean {
  return syncing;
}

/** A queued add held for the reader's word on a repeat add (SPEC.md §15):
    where it is queued, the documents the 409 named, and the project it was
    queued for. */
export type HeldAdd = {
  store: typeof WRITES | typeof UPLOADS;
  key: IDBValidKey;
  documents: DuplicateMatch[];
  notebookId: string | null;
};

function heldIn(store: typeof WRITES | typeof UPLOADS): Promise<HeldAdd[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const found: HeldAdd[] = [];
        const t = db.transaction(store, "readonly");
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(found);
            return;
          }
          const record = cursor.value as QueuedWrite | QueuedUpload;
          if (record.held && record.held.length > 0) {
            const notebookId =
              "notebookId" in record
                ? record.notebookId
                : ((record.body as { notebookId?: unknown } | undefined)?.notebookId ?? null);
            found.push({
              store,
              key: cursor.primaryKey,
              documents: record.held,
              notebookId: typeof notebookId === "string" ? notebookId : null,
            });
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/** The queued adds waiting for the reader's word, oldest first. */
export async function heldAdds(): Promise<HeldAdd[]> {
  try {
    return [...(await heldIn(WRITES)), ...(await heldIn(UPLOADS))];
  } catch {
    return [];
  }
}

/** The reader's word on a held add: again, it goes back in the queue,
    confirmed, and the queue drains; otherwise (Open the one I have,
    Cancel) it leaves the queue. */
export async function answerHeld(add: HeldAdd, again: boolean): Promise<void> {
  if (!again) {
    await tx(add.store, "readwrite", (s) => s.delete(add.key));
    notify();
    return;
  }
  const record = await tx<QueuedWrite | QueuedUpload | undefined>(add.store, "readonly", (s) => s.get(add.key));
  if (!record) return;
  const next: QueuedWrite | QueuedUpload =
    "notebookId" in record
      ? { ...record, confirmDuplicate: true }
      : {
          ...record,
          body:
            record.body && typeof record.body === "object" ? { ...record.body, confirmDuplicate: true } : record.body,
        };
  delete next.held;
  await tx(add.store, "readwrite", (s) => s.put(next, add.key));
  notify();
  void syncQueue();
}
