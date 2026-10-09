"use client";

import { ApiError } from "@/lib/api";
import type { TFunc } from "@/lib/i18n/dictionaries";

// One failure line for the assistant (SPEC.md §7): a request that never
// reached the server, or a server that failed, reads as one plain sentence
// of the app's own, never the browser's words ("Failed to fetch"), a status
// code, or the server's raw text; that goes to the console. A refusal the
// server wrote for the reader (a 4xx with its reason, a 503 for an assistant
// with no key) keeps its words; the assistant's routes word a failed model
// call as the same plain line (api/assistant/failure-line.ts).

/** fetch for a call to the model: a dropped connection throws the plain
    line; a server failure (5xx) answers with the plain line as its error. */
export async function modelFetch(path: string, init: RequestInit, t: TFunc): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (init.signal?.aborted) throw err;
    console.error("assistant request", path, err);
    throw new Error(t("assistant.failedConnection"));
  }
  if (res.status < 500) return res;
  const raw = await res.text().catch(() => "");
  // A line the route worded for the reader (an assistant with no key, 503)
  // keeps its words; a failure (500) or a page from a proxy does not.
  let worded: string | null = null;
  if (res.status !== 500) {
    try {
      const json = JSON.parse(raw) as { error?: unknown };
      if (typeof json.error === "string" && json.error) worded = json.error;
    } catch {}
  }
  if (!worded) console.error("assistant request", path, res.status, raw.slice(0, 500));
  return new Response(JSON.stringify({ error: worded ?? t("assistant.failedServer") }), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The reason for a failed answer that came with no words for the reader:
    the plain line, the status to the console. */
export function noReason(res: Response, t: TFunc): string {
  console.error("assistant request", res.url, res.status);
  return t("assistant.failedServer");
}

// What the browsers say when a request never reached the server.
const NETWORK_WORDS = /^(failed to fetch|load failed|networkerror|network error|the network connection was lost)/i;

/** The line for a failure caught around api() or modelFetch. */
export function failureLine(err: unknown, t: TFunc): string {
  if (err instanceof TypeError || (err instanceof Error && NETWORK_WORDS.test(err.message))) {
    console.error("assistant request", err);
    return t("assistant.failedConnection");
  }
  if (err instanceof ApiError) {
    // The route's own words for the reader stay (a refusal, an assistant
    // with no key); a failure (500), or an answer with no words, does not.
    const detail = err.detail;
    const worded =
      detail !== null && typeof detail === "object" && "error" in detail && typeof detail.error === "string";
    if (worded && err.status !== 500) return err.message;
    console.error("assistant request", err.status, err.message);
    return t("assistant.failedServer");
  }
  return err instanceof Error && err.message ? err.message : t("assistant.failedServer");
}

/** A call that is not a model call failed (the conversations list, a
    conversation, an attachment, a comment): a reason the route worded for
    the reader (any status but 500) keeps its words; a failure (500), an
    answer with no words, or a page from a proxy reads as `plain`, the app's
    own line ("Not saved. Try again.", "Not loaded. Try again."), and the
    status and the server's text go to the console. */
export function callFailure(res: Response, body: unknown, plain: string): Error {
  const said =
    body !== null && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error
      ? body.error
      : null;
  if (said && res.status !== 500) return new Error(said);
  console.error("assistant request", res.url, res.status, said ?? "");
  return new Error(plain);
}

// A status line a helper outside the assistant throws (lib/images.ts).
const STATUS_WORDS = /^request failed \(\d+\)$/i;

/** The line for a failure caught around such a call: a dropped connection
    or a bare status line reads as `plain` (the technical text to the
    console); any other reason keeps its words. */
export function callLine(err: unknown, plain: string): string {
  if (err instanceof Error && err.message && !(err instanceof TypeError) && !NETWORK_WORDS.test(err.message) && !STATUS_WORDS.test(err.message)) {
    return err.message;
  }
  console.error("assistant request", err);
  return plain;
}
