import { api, ApiError } from "@/lib/api";
import { JOT_BATCH_MAX, type Jotting, type JottingsSave } from "@/lib/jottings";
import { tabAccount } from "@/lib/tab-account";

// The jottings' save queue (SPEC.md §33). A stroke is written here, in
// localStorage, the moment the pen lifts, and leaves only when the server
// has answered that it is stored: a lost network, a reload, or a closed tab
// between the two loses no stroke (CLAUDE.md rule zero, 6). The queue is a
// log of what the reader did, in order, per account, project, and document.
// A save sends the log's net effect; the ops it covered leave on its answer.

export type JotOp =
  | { op: "add"; jotting: Jotting }
  | { op: "erase"; id: string }
  | { op: "restore"; id: string };

type Place = { notebookId: string; documentId: string };

const KEY = "unitos-jot-queue";
// A save the network failed is tried again after these waits, the last one
// again and again.
const RETRY_MS = [3_000, 10_000, 30_000, 60_000];
// A refusal no later try can change: the body is not valid, the account may
// not write here, or the document is not in the project. Those ops leave.
const FINAL_STATUS = new Set([400, 403, 404, 413]);

type Stored = Record<string, JotOp[]>;

// The log when localStorage refuses the write (full, or off): kept for the
// page's life, so the strokes still save while the tab stays open.
let memory: Stored | null = null;

function placeKey(place: Place): string {
  return `${tabAccount() ?? "local"}|${place.notebookId}|${place.documentId}`;
}

function readAll(): Stored {
  if (memory) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Stored): void {
  for (const key of Object.keys(all)) if (all[key].length === 0) delete all[key];
  try {
    if (Object.keys(all).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(all));
    memory = null;
  } catch {
    memory = all;
  }
}

/** The ops this account still has to save for the document, oldest first. */
export function queuedJotOps(place: Place): JotOp[] {
  return readAll()[placeKey(place)] ?? [];
}

/** What the first `count` ops come to: each stroke touched is added, erased,
    or restored once. A stroke added and erased in the same log is still
    added, then erased, so Undo can bring it back. */
export function netJotOps(ops: JotOp[]): Omit<JottingsSave, "notebookId"> {
  const added = new Map<string, Jotting>();
  const erased = new Map<string, boolean>();
  for (const op of ops) {
    if (op.op === "add") added.set(op.jotting.id, op.jotting);
    else erased.set(op.id, op.op === "erase");
  }
  const erase: string[] = [];
  const restore: string[] = [];
  for (const [id, gone] of erased) (gone ? erase : restore).push(id);
  return { add: [...added.values()], erase, restore };
}

const flushing = new Set<string>();
const retries = new Map<string, { tries: number; timer: ReturnType<typeof setTimeout> }>();

function retryLater(place: Place): void {
  const key = placeKey(place);
  const tries = retries.get(key)?.tries ?? 0;
  const wait = RETRY_MS[Math.min(tries, RETRY_MS.length - 1)];
  const timer = setTimeout(() => void flushJottings(place), wait);
  retries.set(key, { tries: tries + 1, timer });
}

/** Send what the queue holds for the document. One save at a time per
    document; ops queued while one is in flight go with the next. */
export async function flushJottings(place: Place): Promise<void> {
  const key = placeKey(place);
  if (flushing.has(key)) return;
  const pending = retries.get(key);
  if (pending) clearTimeout(pending.timer);
  // A save carries JOT_BATCH_MAX ops at most, so each list stays in the limit.
  const ops = queuedJotOps(place).slice(0, JOT_BATCH_MAX);
  if (ops.length === 0) {
    retries.delete(key);
    return;
  }
  flushing.add(key);
  let done = false;
  try {
    await api(`/api/documents/${place.documentId}/jottings`, "POST", {
      notebookId: place.notebookId,
      ...netJotOps(ops),
    });
    done = true;
  } catch (err) {
    done = err instanceof ApiError && FINAL_STATUS.has(err.status);
  } finally {
    flushing.delete(key);
  }
  if (!done) {
    retryLater(place);
    return;
  }
  retries.delete(key);
  const all = readAll();
  // The ops sent are the first ones of the log: later ops were appended.
  all[key] = (all[key] ?? []).slice(ops.length);
  writeAll(all);
  if (all[key]?.length) void flushJottings(place);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Add ops to the log and save soon: a word is many strokes, and they go in
    one save once the pen has rested. */
export function queueJotOps(place: Place, ops: JotOp[]): void {
  if (ops.length === 0) return;
  const key = placeKey(place);
  const all = readAll();
  all[key] = [...(all[key] ?? []), ...ops];
  writeAll(all);
  const waiting = timers.get(key);
  if (waiting) clearTimeout(waiting);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void flushJottings(place);
    }, 700),
  );
}

/** Save now: the page is being hidden or closed. */
export function flushJottingsNow(place: Place): void {
  const key = placeKey(place);
  const waiting = timers.get(key);
  if (waiting) clearTimeout(waiting);
  timers.delete(key);
  void flushJottings(place);
}
