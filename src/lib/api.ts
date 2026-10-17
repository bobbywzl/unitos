import { ACCOUNT_HEADER } from "@/lib/constants";
import { DEFAULT_LANG, isLang, LANG_COOKIE, type Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";
import { newNoteId } from "@/lib/notes/client-id";
import { isAiCall } from "@/lib/offline/ai-routes";
import { isOffline, offlinePremium, queueWrite, isServerError, serverAnswered, waitsInQueue } from "@/lib/offline/queue";
import { beginWrite, endWrite } from "@/lib/save-state";
import { tabAccount } from "@/lib/tab-account";

// Offline work (SPEC.md §17, Unitos Premium): these writes replay cleanly and
// their callers never read the response body, so while offline they queue in
// IndexedDB and sync when the browser is back online. A write the server
// answered with an error (a 5xx, a 408, a 429: down or busy) queues the same
// way and is tried again, so a flaky server costs no more than no network.
// Everything else still fails — a queued response could not stand in for the
// real one. A caller that reads the answer but takes a queued one too says so
// (`queue: true`). A queueable write to a note (a section, a reply, an
// annotation) that a queued write names queues behind that write without
// leaving: the queue alone sends that note's edits, one after another, so a
// failing server is not sent the same edit by two senders.
const QUEUEABLE: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^\/api\/notes$/ },
  { method: "PATCH", path: /^\/api\/notes\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/notes\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/sections\/[^/]+$/ },
  { method: "POST", path: /^\/api\/replies$/ },
  { method: "PATCH", path: /^\/api\/replies\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/replies\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/blocks\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/blocks\/[^/]+$/ },
  // Join text (Merge with AI needs a model and never queues: isAiCall).
  { method: "POST", path: /^\/api\/notes\/merge$/ },
  // Resolve and Reopen on a comment.
  { method: "PATCH", path: /^\/api\/annotations\/[^/]+$/ },
  { method: "PATCH", path: /^\/api\/links\/[^/]+$/ },
  { method: "DELETE", path: /^\/api\/links\/[^/]+$/ },
];

function queueable(path: string, method: string, body: unknown, optIn = false): boolean {
  if (isAiCall(path, body) || method === "PUT") return false;
  return optIn || QUEUEABLE.some((q) => q.method === method && q.path.test(path));
}

// A note write as it waits in the offline queue (SPEC.md §17). A create
// carries its id, so the tray draws the note while it waits and a replay
// never makes it twice. An edit made from a base text is put together with
// the stored text on replay (onConflict "keep"): a queued write cannot read
// a 409, and the queue drops a refused write — the words must land.
function queuedBody(path: string, method: string, body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  if (method === "POST" && path === "/api/notes" && !("id" in body)) return { ...body, id: newNoteId() };
  if (method === "PATCH" && /^\/api\/notes\/[^/]+$/.test(path) && "baseContent" in body) {
    return { ...body, onConflict: "keep" };
  }
  return body;
}

/** A refused call: the status and the body the route answered with. */
/** The one failure line of a write (SPEC.md §17): "Not saved" and what the
    reader can do. The status and the server's text go to the console. */
function notSaved(): string {
  return translate(clientLang(), isOffline() ? "common.offline" : "common.notSaved");
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// The language on the client, outside React: the same cookie the layout reads.
export function clientLang(): Lang {
  if (typeof document === "undefined") return DEFAULT_LANG;
  const value = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]+)`))?.[1];
  return isLang(value) ? value : DEFAULT_LANG;
}

const NOTE_PATH = /^\/api\/notes\/[^/]+$/;

// Client-side fetch helper for JSON API routes. Every call counts in the
// save indicator (lib/save-state.ts): a call that needs a model too, so the
// line reads Saving… while the model works, and a stopped call counts as
// landed.
export async function api<T = unknown>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
  // signal: Stop aborts the request; the caller checks signal.aborted.
  // refusalIsAnswer: a refusal (409, a 4xx) answers a question, such as
  // whether an undo can still run; nothing went unsaved, so the save
  // indicator does not read Not saved.
  // queue: the caller takes a queued answer ({queued: true}) for a write
  // that is not in QUEUEABLE (the toolbox's highlight and comment).
  init?: { signal?: AbortSignal; refusalIsAnswer?: boolean; queue?: boolean },
): Promise<T> {
  beginWrite();
  try {
    const result = await send<T>(path, method, body, init);
    // Queued after the server answered with an error: Not saved until the
    // queue lands it (lib/offline/queue.ts settles the line).
    const failedQueued = Boolean(result && typeof result === "object" && (result as { serverError?: unknown }).serverError);
    endWrite(!failedQueued, failedQueued ? undefined : path.split("?")[0], failedQueued);
    return result;
  } catch (err) {
    const answered = Boolean(init?.refusalIsAnswer) && err instanceof ApiError && err.status >= 400 && err.status < 500;
    const ok = Boolean(init?.signal?.aborted) || answered;
    // A note's text that did not save stays Not saved until a write to the
    // note lands (its retry, use-outline.ts).
    const pathname = path.split("?")[0];
    endWrite(ok, !ok && method === "PATCH" && NOTE_PATH.test(pathname) ? pathname : undefined);
    throw err;
  }
}

async function send<T>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
  init?: { signal?: AbortSignal; queue?: boolean },
): Promise<T> {
  // The tab's rendered account rides along; the middleware rejects the call
  // when the browser has since signed into a different account (stale tab).
  const account = tabAccount();
  let res: Response;
  try {
    // Offline, a call that needs a model answers with the plain message
    // (SPEC.md §17): AI is off for every account until the network is back.
    if (isOffline() && isAiCall(path, body)) {
      throw new Error(translate(clientLang(), "common.offlineAi"));
    }
    if (isOffline()) throw new TypeError("offline");
    if (offlinePremium() && queueable(path, method, body, init?.queue) && (await waitsInQueue(path, body))) {
      return queue<T>(path, method, body, true, true);
    }
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(account ? { [ACCOUNT_HEADER]: account } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: init?.signal,
    });
  } catch (err) {
    // Stopped, not failed: the caller reads signal.aborted.
    if (init?.signal?.aborted) throw err;
    if (err instanceof Error && !(err instanceof TypeError)) throw err;
    // Network failure. With Unitos Premium the queueable writes save offline
    // and sync later (SPEC.md §17); everything else reports plainly.
    if (offlinePremium() && queueable(path, method, body, init?.queue)) {
      return queue<T>(path, method, body, false);
    }
    console.warn("Not saved:", method, path, err instanceof Error ? err.message : String(err));
    throw new Error(isAiCall(path, body) && !isOffline() && err instanceof Error ? err.message : notSaved());
  }
  // The server answers: writes waiting in the queue for their next try go now.
  if (res.ok) serverAnswered();
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    const said =
      detail && typeof detail === "object" && "error" in detail && typeof detail.error === "string" ? detail.error : null;
    const serverError = isServerError(res.status);
    // The server is down or busy: the write queues and is tried again.
    if (serverError && offlinePremium() && queueable(path, method, body, init?.queue)) {
      console.warn("Not saved, queued to try again:", method, path, res.status, said ?? "");
      return queue<T>(path, method, body, true);
    }
    // A refusal the route words for the reader (a 4xx) is shown as it is; a
    // server error or a refusal with no words is the one failure line, with
    // the status and the server's text in the console. A call that needs a
    // model keeps its own words (the assistant's failure lines).
    let message: string;
    if (isAiCall(path, body)) message = said ?? translate(clientLang(), "common.requestFailedStatus", { status: res.status });
    else if (lostEdit(res.status, said)) {
      // The account lost the right to write here (a role changed, a share
      // removed): the words are kept in the browser, and the line says so.
      console.warn("Not saved:", method, path, res.status, said ?? "");
      message = translate(clientLang(), "common.notSavedNoEdit");
    } else if (said && !serverError) message = said;
    else {
      console.warn("Not saved:", method, path, res.status, said ?? "");
      message = notSaved();
    }
    throw new ApiError(message, res.status, detail);
  }
  return res.json() as Promise<T>;
}

/** A refusal that says the account can no longer write in the project: a
    viewer now (403), or no longer a collaborator (404, the project hidden). */
function lostEdit(status: number, said: string | null): boolean {
  if (said === null) return false;
  const lang = clientLang();
  return (
    (status === 403 && said === translate(lang, "api.viewingOnly")) ||
    (status === 404 && said === translate(lang, "common.corpusNotFound"))
  );
}

/** Queue the write (SPEC.md §17) and answer as the queue does. serverError:
    the server answered with an error; the save line reads Not saved and the
    queued note is marked Not saved until the queue lands it. */
async function queue<T>(path: string, method: string, body: unknown, serverError: boolean, behind = false): Promise<T> {
  const queued = queuedBody(path, method, body);
  await queueWrite(path, method as "POST" | "PATCH" | "DELETE", queued, serverError ? 1 : 0, behind);
  const id = queued && typeof queued === "object" && "id" in queued ? queued.id : undefined;
  return { queued: true, ...(typeof id === "string" ? { id } : {}), ...(serverError ? { serverError: true } : {}) } as T;
}
