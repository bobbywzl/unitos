import { googleEnabled } from "@/lib/auth";
import { outboundFetch } from "@/lib/outbound-fetch";
import { DRIVE_SCOPE } from "@/lib/drive/types";

// Linked Google Drive (SPEC.md §14): a durable drive.file grant on the
// account. The link flow is the same hand-rolled OAuth code flow sign-in uses
// (lib/auth.ts), asking for offline access; the refresh token lands on
// User.driveRefreshToken and /api/drive/token mints short-lived access tokens
// from it — the picker then opens without a consent popup per visit, and a
// pasted Drive link can import server-side.

// Linking rides the sign-in OAuth client and needs an account row to store
// the grant on, so it requires Google sign-in to be configured.
export function driveLinkEnabled(): boolean {
  return googleEnabled();
}

export function driveLinkAuthUrl(origin: string, state: string, email: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/drive/link/callback`,
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
      redirect_uri: `${origin}/api/drive/link/callback`,
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
