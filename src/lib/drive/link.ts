import { NextResponse } from "next/server";
import { authEnabled, currentUser, googleEnabled, googleRedirectUri, stateValid } from "@/lib/auth";
import { DRIVE_RETURN_COOKIE, DRIVE_STATE_COOKIE } from "@/lib/constants";
import { db } from "@/lib/db";
import { outboundFetch } from "@/lib/outbound-fetch";
import { DRIVE_SCOPE } from "@/lib/drive/types";

// Linked Google Drive (SPEC.md §14): a durable drive.file grant on the
// account. The link flow is the same hand-rolled OAuth code flow sign-in uses
// (lib/auth.ts), asking for offline access; the refresh token lands on
// User.driveRefreshToken and /api/drive/token mints short-lived access tokens
// from it — the picker then opens without a consent popup per visit, and a
// pasted Drive link can import server-side.
//
// The flow returns to the sign-in redirect URI (googleRedirectUri): Google
// rejects any redirect_uri not registered on the OAuth client, and that one
// is the entry the deployer already made for sign-in. The sign-in callback
// tells a Drive link apart by its own state cookie and hands it to
// completeDriveLink below.

// Linking rides the sign-in OAuth client and needs an account row to store
// the grant on, so it requires Google sign-in to be configured.
export function driveLinkEnabled(): boolean {
  return googleEnabled();
}

export function driveLinkAuthUrl(origin: string, state: string, email: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: DRIVE_SCOPE,
    state,
    // offline + consent: Google returns a refresh token, every time.
    access_type: "offline",
    prompt: "consent",
    // Pre-select the account the reader signed in with.
    login_hint: email,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

// Exchange the authorization code for the refresh token to store.
export async function exchangeDriveLinkCode(
  origin: string,
  code: string,
): Promise<string | null> {
  const res = await outboundFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error("[drive] link code exchange failed:", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { refresh_token?: string };
  return data.refresh_token ?? null;
}

export function cookieValue(req: Request, name: string): string | null {
  const value = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${name}=([^;]+)`))?.[1];
  return value ? decodeURIComponent(value) : null;
}

// Google is returning from the Link Google Drive consent: verify the state
// against the Drive state cookie, exchange the code, store the refresh token
// on the signed-in account, and return to where linking started with
// ?drive=linked or ?drive=link-failed. Both cookies clear either way.
export async function completeDriveLink(req: Request, origin: string): Promise<NextResponse> {
  const returnPath = cookieValue(req, DRIVE_RETURN_COOKIE) ?? "/settings";
  const target = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/settings";
  const finish = (result: "linked" | "link-failed") => {
    const url = new URL(target, origin);
    url.searchParams.set("drive", result);
    const res = NextResponse.redirect(url);
    res.cookies.set(DRIVE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(DRIVE_RETURN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };
  const user = await currentUser();
  if (!driveLinkEnabled() || !authEnabled() || !user) return finish("link-failed");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = cookieValue(req, DRIVE_STATE_COOKIE);
  if (!code || !stateValid(state) || !cookieState || cookieState !== state) {
    if (url.searchParams.get("error")) console.warn("[drive] link declined:", url.searchParams.get("error"));
    return finish("link-failed");
  }
  const refreshToken = await exchangeDriveLinkCode(origin, code);
  if (!refreshToken) return finish("link-failed");
  await db.user.update({ where: { id: user.id }, data: { driveRefreshToken: refreshToken } });
  return finish("linked");
}

// Mint a short-lived access token from the stored refresh token. "revoked" =
// the grant is gone (the reader revoked it in their Google account); the
// caller clears the stored token and falls back to the per-visit grant.
export async function mintDriveAccessToken(
  refreshToken: string,
): Promise<{ token: string } | "revoked" | null> {
  const res = await outboundFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 && body.includes("invalid_grant")) return "revoked";
    console.error("[drive] token mint failed:", res.status, body);
    return null;
  }
  const data = (await res.json()) as { access_token?: string };
  return data.access_token ? { token: data.access_token } : null;
}

// Unlink: tell Google to revoke the grant. Best-effort — the stored token is
// cleared either way.
export async function revokeDriveToken(refreshToken: string): Promise<void> {
  try {
    await outboundFetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.warn("[drive] revoke failed:", err);
  }
}
