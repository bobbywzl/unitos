import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { SESSION_COOKIE, STATE_COOKIE, USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { outboundFetch } from "@/lib/outbound-fetch";

// Google sign-in (Scalae pattern): hand-rolled OIDC authorization-code flow,
// no dependencies; sessions in the database, token in an httpOnly cookie.
//
// DUAL MODE: with GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + SESSION_SECRET
// set, /signin gates the app and corpora belong to accounts. Unset, sign-in
// is off and the app runs as the local reader (USER_ID) — deploys never brick
// on missing credentials. The /admin area keeps its own ADMIN_PASSWORD gate,
// decoupled from reader sign-in.

export { SESSION_COOKIE, STATE_COOKIE };

const SESSION_DAYS = 30;

export function authEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET,
  );
}

// The implicit reader when sign-in is off. Not a database row.
export const LOCAL_USER: User = {
  id: USER_ID,
  email: "local@dissect",
  name: "Local reader",
  picture: "",
  createdAt: new Date(0),
  lastSeenAt: new Date(0),
};

const hmac = (data: string) =>
  createHmac("sha256", process.env.SESSION_SECRET ?? "dev").update(data).digest("hex");

// Signed OAuth state: random nonce + HMAC, round-tripped via cookie.
export function newState(): string {
  const nonce = randomBytes(16).toString("hex");
  return `${nonce}.${hmac(nonce)}`;
}

export function stateValid(state: string | null | undefined): boolean {
  if (!state) return false;
  const [nonce, sig] = state.split(".");
  if (!nonce || !sig) return false;
  const expect = hmac(nonce);
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
  }
}

// The app's own origin, for OAuth redirect URIs (proxy-aware on Vercel).
export function appOrigin(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export function googleAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type IdTokenClaims = {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

// Exchange the authorization code server-to-server and validate the identity.
// The id_token arrives directly from Google's token endpoint over TLS, so
// claims validation (iss/aud/exp/email_verified) suffices without local JWKS
// signature verification.
export async function exchangeCode(
  origin: string,
  code: string,
): Promise<{ email: string; name: string; picture: string } | null> {
  const res = await outboundFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/auth/callback`,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error("[auth] google token exchange failed:", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) return null;
  const payload = data.id_token.split(".")[1];
  if (!payload) return null;
  let claims: IdTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as IdTokenClaims;
  } catch {
    return null;
  }
  const issOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const audOk = claims.aud === process.env.GOOGLE_CLIENT_ID;
  const fresh = (claims.exp ?? 0) * 1000 > Date.now();
  if (!issOk || !audOk || !fresh || !claims.email || claims.email_verified === false) return null;
  return {
    email: claims.email,
    name: claims.name ?? claims.email.split("@")[0],
    picture: claims.picture ?? "",
  };
}

// Upsert the account. The first account ever adopts the local reader's data
// (corpora, profile, digests), so turning sign-in on never strands the work.
export async function upsertUser(profile: {
  email: string;
  name: string;
  picture: string;
}): Promise<User> {
  const email = profile.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return db.user.update({
      where: { id: existing.id },
      data: { name: profile.name, picture: profile.picture, lastSeenAt: new Date() },
    });
  }
  const first = (await db.user.count()) === 0;
  const user = await db.user.create({
    data: { email, name: profile.name, picture: profile.picture },
  });
  if (first) {
    await db.$transaction([
      db.notebook.updateMany({ where: { userId: USER_ID }, data: { userId: user.id } }),
      db.notebookDigest.updateMany({ where: { userId: USER_ID }, data: { userId: user.id } }),
      db.readerProfile.updateMany({ where: { userId: USER_ID }, data: { userId: user.id } }),
    ]);
  }
  return user;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

// Sign the profile in: upsert the account, mint a session.
export async function signIn(profile: { email: string; name: string; picture: string }) {
  const user = await upsertUser(profile);
  const session = await createSession(user.id);
  return { user, session };
}

export async function signOut(token: string | undefined): Promise<void> {
  if (token) await db.session.deleteMany({ where: { token } }).catch(() => {});
}

// Activity stamp, throttled to about one write per five minutes.
async function touchLastSeen(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  await db.user
    .updateMany({ where: { id: userId, lastSeenAt: { lt: cutoff } }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
}

// The signed-in account — or the local reader when sign-in is off.
export async function currentUser(): Promise<User | null> {
  if (!authEnabled()) return LOCAL_USER;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.deleteMany({ where: { token } }).catch(() => {});
    return null;
  }
  void touchLastSeen(session.userId);
  return session.user;
}

// Ownership gate for corpus routes: null = allowed, else the response to send.
// With sign-in off there is one reader and nothing to check. A corpus that is
// not yours answers 404, not 403 — its existence is not disclosed.
export async function notebookGuard(notebookId: string): Promise<NextResponse | null> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!authEnabled()) return null;
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    select: { userId: true },
  });
  if (!notebook || notebook.userId !== user.id) {
    return NextResponse.json({ error: "Corpus not found" }, { status: 404 });
  }
  return null;
}
