"use client";

import { ACCOUNT_HEADER } from "@/lib/constants";
import { duplicateOf, type DuplicateMatch } from "@/lib/documents/duplicate-answer";
import { confirmNoteDraft, holdNoteDraft, setHeldNoteDrafts } from "@/lib/note-drafts";
import { openDb, tx, UPLOADS, WRITES } from "@/lib/offline/db";
import { settleQueuedWrites } from "@/lib/save-state";
import { readAccountCookie, tabAccount } from "@/lib/tab-account";
import { MEDIA_EXTENSIONS, UPLOAD_CHUNK_BYTES } from "@/lib/video/types";

// Offline work (SPEC.md §17, Unitos Premium): writes and uploads made while
// offline queue in IndexedDB and sync in order when the browser is back
// online. The queue holds two kinds of records: API writes (JSON body, the
// note, section, annotation, and reply routes) and uploads (the file bytes,
// replayed through the same single-request or chunked path an online upload
// takes). Syncing is at-least-once: a record leaves the queue when the server
// takes it, and drops with a warning only when the server says it is stale
// (a 4xx refusal: the note, the section, or the right to write is gone). It
// stays for the next attempt on a network failure, a 401 (signed out: it
// waits for the sign-in), a 409 that says another account signed in (it
// waits for its own account), or a 5xx, a 408, or a 429 (the server is down
// or busy: it is tried again after a growing wait, for as long as it takes).
// Each record names the account that queued it and is sent only while that
// account is signed in; records of other accounts wait, uncounted and not
// drawn. One tab drains at a
// time (a Web Lock), so two open tabs never send a record twice, and the
// tabs share one wait between tries (TRIED_KEY): a failing write is tried
// by one tab at a time, never once per tab. A write the server cannot take
// now holds back only the later writes that name the same note, section,
// reply, or annotation; the writes after it that name other things go on.
// A queueable write to something a queued write names queues behind it
// (lib/api.ts): one sender per edit, in order. A note write
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
// Wi-Fi handover, a proxy reset) sends no online event, and a server that
// answered 5xx (a deploy) is tried again the same way. Tries count time,
// not page loads.
const RETRY_MS = [2_000, 4_000, 8_000, 15_000];
// The last drain that ended with writes still waiting, in any tab, and how
// many such drains ran one after another: the wait before the next try is
// the same for every tab.
const TRIED_KEY = "unitos-offline-tried";

export type QueuedWrite = {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  account: string | null;
  queuedAt: number;
  // Tries the server answered with an error (5xx, 408, 429).
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

/** The account signed in to the browser now; null with sign-in off, or
    signed out (the server then answers 401 and the record waits). */
function signedInAccount(): string | null {
  return readAccountCookie();
}

/** True when the record belongs to the account signed in now: it is sent,
    counted, and drawn. A record of another account waits for that account. */
export function queuedForThisAccount(record: { account: string | null }): boolean {
  const account = signedInAccount();
  return record.account === null || account === null || record.account === account;
}

// The records in a store that wait for the sync: a held repeat add waits for
// the reader's word instead (heldAdds), so it is not counted, and a record
// of another account waits for that account. Both stay in the queue all the
// same.
function waitingIn(store: typeof WRITES | typeof UPLOADS): Promise<number> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let n = 0;
        const t = db.transaction(store, "readonly");
        const req = t.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(n);
            return;
          }
          const record = cursor.value as QueuedWrite | QueuedUpload;
          if (!(record.held && record.held.length > 0) && queuedForThisAccount(record)) n++;
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

/** The records waiting for the sync, held repeat adds left out: the
    offline pill's count. */
export async function queuedCount(): Promise<number> {
  try {
    const [writes, uploads] = await Promise.all([waitingIn(WRITES), waitingIn(UPLOADS)]);
    return writes + uploads;
  } catch {
    return 0;
  }
}

const NOTE_TEXT_WRITE = /^\/api\/notes\/([^/]+)$/;

/** The note and the text a queued note write carries, if it carries one. */
function noteText(record: Pick<QueuedWrite, "path" | "method" | "body">): { noteId: string; content: string } | null {
  const body = record.body as { id?: unknown; content?: unknown } | undefined;
  if (typeof body?.content !== "string") return null;
  if (record.method === "PATCH") {
    const noteId = NOTE_TEXT_WRITE.exec(record.path)?.[1];
    return noteId ? { noteId, content: body.content } : null;
  }
  if (record.method === "POST" && record.path === "/api/notes" && typeof body.id === "string") {
    return { noteId: body.id, content: body.content };
  }
  return null;
}

/** The note drafts the queue holds: set again from the queue's note writes. */
async function holdQueuedNoteDrafts(): Promise<void> {
  try {
    const readAt = Date.now();
    const all = await tx<QueuedWrite[]>(WRITES, "readonly", (s) => s.getAll() as IDBRequest<QueuedWrite[]>);
    setHeldNoteDrafts(
      all.flatMap((r) => noteText(r) ?? []),
      readAt,
    );
  } catch {
    // IndexedDB unreadable: the holds stay as they are.
  }
}

/** What makes two queued writes the same: a note's text write by its text
    (the base and the source flags only say how it merges; one that lands
    leaves the note holding that text), anything else by its whole body. */
function sameness(record: Pick<QueuedWrite, "path" | "method" | "body">): string {
  const text = noteText(record);
  return text && record.method === "PATCH" ? `text:${text.content.trim()}` : JSON.stringify(record.body);
}

/** True when the last record that waits for this path, method, and account
    is the same write. Only the last: a write that brings back an earlier
    text after a different one must queue again. */
function waitsAlready(path: string, method: string, account: string | null, body: unknown): Promise<boolean> {
  const same = sameness({ path, method: method as QueuedWrite["method"], body });
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let last: string | null = null;
        const t = db.transaction(WRITES, "readonly");
        const req = t.objectStore(WRITES).openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            resolve(last === same);
            return;
          }
          const record = cursor.value as QueuedWrite;
          if (record.path === path && record.method === method && record.account === account) {
            last = sameness(record);
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

// An id the database or the browser made (lib/notes/client-id.ts).
const ID = /^[a-z0-9]{20,40}$/;

/** The notes, sections, replies, and annotations a write names: the ids in
    its path, and the body's id fields (`id`, `sectionId`, `sourceIds`, …). */
function idsOf(record: Pick<QueuedWrite, "path" | "body">): string[] {
  const ids = record.path
    .split("?")[0]
    .split("/")
    .filter((part) => ID.test(part));
  const body = record.body;
  if (body && typeof body === "object") {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (/(^id|Id)$/.test(key) && typeof value === "string" && ID.test(value)) ids.push(value);
      if (/Ids$/.test(key) && Array.isArray(value)) {
        for (const v of value) if (typeof v === "string" && ID.test(v)) ids.push(v);
      }
    }
  }
  return ids;
}

// False once a drain found the queue empty and nothing queued since in this
// tab: a write then needs no look at the queue before it leaves.
let mayWait = true;

/** True when a write of this account waits in the queue for something this
    write names: the write queues behind it (lib/api.ts), so the queue alone
    sends the edits of that note, in order. */
export async function waitsInQueue(path: string, body: unknown): Promise<boolean> {
  if (!mayWait || typeof indexedDB === "undefined") return false;
  const ids = new Set(idsOf({ path, body }));
  if (ids.size === 0) return false;
  try {
    const all = await tx<QueuedWrite[]>(WRITES, "readonly", (s) => s.getAll() as IDBRequest<QueuedWrite[]>);
    return all.some((r) => !(r.held && r.held.length > 0) && queuedForThisAccount(r) && idsOf(r).some((id) => ids.has(id)));
  } catch {
    return false;
  }
}

/** A status that says the server is down or busy, not that the write is
    wrong: the write is tried again. */
export function isServerError(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/** Queue a write. attempts: 1 when the server already answered it with an
    error (lib/api.ts): the notes mark it Not saved from the start. behind:
    it never left, queued behind a write that waits (waitsInQueue); the
    queue's next try sends both. */
export async function queueWrite(
  path: string,
  method: QueuedWrite["method"],
  body?: unknown,
  attempts = 0,
  behind = false,
): Promise<void> {
  mayWait = true;
  const record: QueuedWrite = {
    path,
    method,
    body,
    account: tabAccount() ?? signedInAccount(),
    queuedAt: Date.now(),
    ...(attempts > 0 ? { attempts } : {}),
  };
  // A write the same as the last one that waits for its path is queued
  // already: a retry of a save that never reached the server queues it
  // once, and a note's text waits once however many saves carry it.
  if (!(await waitsAlready(path, method, record.account, body).catch(() => false))) {
    await tx(WRITES, "readwrite", (s) => s.add(record));
  }
  // The note's local draft keeps the words until the server takes them.
  const text = noteText(record);
  if (text) holdNoteDraft(text.noteId, text.content);
  queuedSinceSync = true;
  notify();
  // Queued with the browser online: the server was out of reach for a
  // moment, so try again now rather than at the next online event. Queued
  // behind a write that waits: at that write's next try.
  if (behind) retryLater();
  else if (!isOffline()) void syncQueue();
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

// One drained record's outcome: "done" leaves the queue (sent), "stale"
// leaves it with a warning (the server refused it for good), "wait" stops
// the drain and keeps it (no network, a 401, another account signed in),
// "retry" stops the drain and keeps it for the next try (the server is down
// or busy), `held` keeps it for the reader's word on a repeat add and the
// drain goes on.
type Sent = "done" | "stale" | "wait" | "retry" | { held: DuplicateMatch[] };

/** A 409 that names a repeat add: the documents it names. */
async function heldBy(res: Response): Promise<DuplicateMatch[] | null> {
  if (res.status !== 409) return null;
  return duplicateOf(await res.clone().json().catch(() => null));
}

/** A 409 from the middleware: the browser signed into another account. */
async function accountChanged(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  const body = (await res.clone().json().catch(() => null)) as { code?: unknown } | null;
  return body?.code === "accountChanged";
}

async function outcome(res: Response, label: string): Promise<Sent> {
  if (res.ok) return "done";
  if (res.status === 401 || (await accountChanged(res))) return "wait";
  if (isServerError(res.status)) return "retry";
  console.warn("Offline sync dropped a stale write:", label, res.status);
  return "stale";
}

const NOTE_WRITE = /^\/api\/notes(?:\/([^/]+))?$/;

// Note texts the server answered for records sent in this drain: their
// drafts are confirmed once the records left the queue.
const landed: { noteId: string; content: string }[] = [];

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
  // The server has the note's text now: a local draft holding the same text
  // is done, once the record left the queue (syncQueue). The text the server
  // answered, not the one sent: a write put together with a newer text keeps
  // the draft until that text matches.
  if (id && typeof answer.content === "string") landed.push({ noteId: id, content: answer.content });
  if (answer.sourceDropped === true && id) {
    window.dispatchEvent(new CustomEvent(SOURCE_LOST_EVENT, { detail: { noteId: id } }));
  }
  if (typeof answer.keptAs === "string" && from && from !== answer.keptAs) {
    const content = typeof answer.content === "string" ? answer.content : undefined;
    window.dispatchEvent(new CustomEvent(NOTE_KEPT_EVENT, { detail: { from, to: answer.keptAs, content } }));
  }
}

// What the server answered for a queued delete that landed, by its path:
// the History event an Undo pressed after the landing restores.
const deleted = new Map<string, unknown>();

/** The answer to a queued delete of `path` that landed in this tab, if any. */
export function landedDelete(path: string): unknown {
  return deleted.get(path);
}

/** Take the last queued write of `path` and `method` of this account out of
    the queue before it is sent: the pill's Undo of a delete that waits. True
    when one was taken out; false when it was sent already (or never queued). */
export async function dropQueuedWrite(path: string, method: QueuedWrite["method"]): Promise<boolean> {
  try {
    const db = await openDb();
    const taken = await new Promise<boolean>((resolve, reject) => {
      let last: IDBValidKey | null = null;
      const t = db.transaction(WRITES, "readwrite");
      const store = t.objectStore(WRITES);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const record = cursor.value as QueuedWrite;
          if (record.path === path && record.method === method && queuedForThisAccount(record)) last = cursor.primaryKey;
          cursor.continue();
          return;
        }
        if (last === null) {
          resolve(false);
          return;
        }
        const del = store.delete(last);
        del.onsuccess = () => resolve(true);
        del.onerror = () => reject(del.error);
      };
      req.onerror = () => reject(req.error);
      t.oncomplete = () => db.close();
    });
    if (taken) {
      await holdQueuedNoteDrafts();
      notify();
    }
    return taken;
  } catch {
    return false;
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
    const held = await heldBy(res);
    if (held) return { held };
    const result = await outcome(res, record.path);
    if (res.ok && record.method === "DELETE") deleted.set(record.path, await res.clone().json().catch(() => null));
    if (res.ok) await announce(record, res);
    return result;
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
      return outcome(res, record.name);
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
      if (!res.ok) return outcome(res, record.name);
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
    return outcome(res, record.name);
  } catch {
    return "wait";
  }
}

// The oldest record in a store after the key `after` that is not held for
// the reader's word and belongs to the account signed in now, with its key —
// the next one to sync.
function nextRecord<T extends { held?: unknown; account: string | null }>(
  store: string,
  after: IDBValidKey | null,
): Promise<{ key: IDBValidKey; record: T } | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, "readonly");
        const req = t.objectStore(store).openCursor(after === null ? null : IDBKeyRange.lowerBound(after, true));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor && ((cursor.value as T).held || !queuedForThisAccount(cursor.value as T))) {
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

function readTried(): { at: number; n: number } {
  try {
    const value = JSON.parse(localStorage.getItem(TRIED_KEY) ?? "null") as { at?: unknown; n?: unknown } | null;
    if (typeof value?.at === "number" && typeof value.n === "number") return { at: value.at, n: value.n };
  } catch {
    // Storage blocked or unreadable: each tab waits on its own.
  }
  return { at: 0, n: 0 };
}

function writeTried(n: number) {
  try {
    localStorage.setItem(TRIED_KEY, JSON.stringify({ at: Date.now(), n }));
  } catch {
    // Storage blocked: each tab waits on its own.
  }
}

/** Run the drain again after a growing wait, while the browser says online.
    The wait counts from the last try of any tab: a tab whose timer ends
    while another tab tried meanwhile waits on. */
function retryLater() {
  if (typeof window === "undefined" || retryTimer || isOffline()) return;
  const tried = readTried();
  const wait = RETRY_MS[Math.min(tried.n, RETRY_MS.length - 1)];
  const due = Math.max(500, tried.at + wait - Date.now());
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const now = readTried();
    if (now.at + RETRY_MS[Math.min(now.n, RETRY_MS.length - 1)] - Date.now() > 250) retryLater();
    else void syncQueue(true);
  }, due);
  window.addEventListener("visibilitychange", onShown);
}

function onShown() {
  if (document.visibilityState === "visible") serverAnswered();
}

/** A request of the page got an answer from the server, or the tab is shown
    again: writes waiting for their next try go now, not after the wait (at
    most once per 2 s). */
export function serverAnswered(): void {
  if (!retryTimer || isOffline() || Date.now() - readTried().at < RETRY_MS[0]) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  void syncQueue();
}

// Drain the queue in order, writes before uploads. Called on the online event,
// on app start, and after new records land while online. One tab at a time:
// a tab waits out another tab's drain, then finds the records it sent gone.
// timed: the drain of a retry's wait; when another tab is draining, that
// tab's drain is the try, and this one waits again.
export async function syncQueue(timed = false): Promise<void> {
  // The drafts of note writes queued in an earlier page are held too.
  await holdQueuedNoteDrafts();
  if (syncing || isOffline()) return;
  syncing = true;
  notify();
  let sent = 0;
  let held = 0;
  try {
    const drain = async () => {
      let waiting = false;
      for (const store of [WRITES, UPLOADS] as const) {
        // What the writes the server could not take now name: a later write
        // that names one of them waits too, so the writes to one note,
        // section, reply, or annotation land in their order.
        const blocked = new Set<string>();
        let after: IDBValidKey | null = null;
        for (;;) {
          const head: { key: IDBValidKey; record: QueuedWrite | QueuedUpload } | null = await nextRecord<
            QueuedWrite | QueuedUpload
          >(store, after);
          if (!head) break;
          after = head.key;
          mayWait = true;
          const ids = store === WRITES ? idsOf(head.record as QueuedWrite) : [];
          if (ids.some((id) => blocked.has(id))) {
            for (const id of ids) blocked.add(id);
            continue;
          }
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
            // Tried again after the wait; the writes after it that name
            // other things go on now.
            waiting = true;
            for (const id of ids) blocked.add(id);
            if (!head.record.attempts) {
              await tx(store, "readwrite", (s) => s.put({ ...head.record, attempts: 1 }, head.key));
              notify();
            }
            continue;
          }
          await tx(store, "readwrite", (s) => s.delete(head.key));
          sent++;
          // The record left the queue: its text no longer holds the draft.
          // Sent, the server's text confirms the draft; stale, the draft
          // keeps the words and the notes try them again (use-outline.ts).
          if (store === WRITES) {
            await holdQueuedNoteDrafts();
            for (const t of landed.splice(0)) confirmNoteDraft(t.noteId, t.content);
          }
          notify();
        }
      }
      return waiting ? ("retry" as const) : ("drained" as const);
    };
    const ended =
      typeof navigator !== "undefined" && navigator.locks
        ? await navigator.locks.request(SYNC_LOCK, timed ? { ifAvailable: true } : {}, (lock) =>
            lock ? drain() : ("busy" as const),
          )
        : await drain();
    if (ended === "drained") {
      queuedSinceSync = false;
      mayWait = false;
      writeTried(0);
      // Every write that failed and queued has landed: the save line
      // stops reading Not saved.
      settleQueuedWrites();
    } else {
      if (ended !== "busy") writeTried(readTried().n + 1);
      retryLater();
    }
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
          if (record.held && record.held.length > 0 && queuedForThisAccount(record)) {
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
