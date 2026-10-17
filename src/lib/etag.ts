import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// A JSON answer with an ETag, the hash of its body (COST5-09): the browser
// keeps the answer and asks again with If-None-Match on every fetch
// (no-cache), and an answer that did not change is a 304 with no body. The
// body is still built; what is saved is the transfer and the client's parse.
// private: the answer is this account's. A route with a cheap version key
// answers 304 before it builds the body (the graph's, lib/graph/version.ts).

export function etagOf(body: string): string {
  return `"b-${createHash("sha1").update(body).digest("base64url").slice(0, 27)}"`;
}

/** Whether If-None-Match names this ETag (a weak W/ prefix aside). */
export function matchesEtag(req: Request, etag: string): boolean {
  const sent = req.headers.get("if-none-match");
  return !!sent && sent.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}

export function jsonWithEtag(req: Request, value: unknown): NextResponse {
  const body = JSON.stringify(value);
  const etag = etagOf(body);
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (matchesEtag(req, etag)) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(body, { headers: { ...headers, "Content-Type": "application/json" } });
}
