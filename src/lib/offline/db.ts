"use client";

// The one IndexedDB database of offline work (SPEC.md §17): the queue of
// writes and uploads made offline (queue.ts) and the list of projects saved
// for offline (saved.ts). One version, every store created here, so the two
// modules never race on an upgrade.

export const DB_NAME = "unitos-offline";
export const WRITES = "writes";
export const UPLOADS = "uploads";
export const SAVED = "saved";
const VERSION = 2;

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WRITES)) {
        db.createObjectStore(WRITES, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(UPLOADS)) {
        db.createObjectStore(UPLOADS, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(SAVED)) {
        db.createObjectStore(SAVED, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
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
