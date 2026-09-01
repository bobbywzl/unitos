import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  sign as cryptoSign,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { ACCOUNT_COOKIE, APPLE_STATE_COOKIE, SESSION_COOKIE, STATE_COOKIE, USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { sendConfirmationEmail, sendResetEmail } from "@/lib/email";
import type { Lang } from "@/lib/i18n/config";
import { outboundFetch } from "@/lib/outbound-fetch";

// Google, Apple, and email sign-in (Scalae pattern): hand-rolled OIDC
// authorization-code flows plus an email confirmation flow, no dependencies;
// sessions in the database, token in an httpOnly cookie. Accounts key on the
// email, so one person signing in through any provider lands in one account.
//
// DUAL MODE: with SESSION_SECRET plus any provider's credentials set,
// /signin gates the app and corpora belong to accounts. Unset, sign-in is off
// and the app runs as the local reader (USER_ID) — deploys never brick on
// missing credentials. The /admin area keeps its own ADMIN_PASSWORD gate,
// decoupled from reader sign-in.

export { ACCOUNT_COOKIE, APPLE_STATE_COOKIE, SESSION_COOKIE, STATE_COOKIE };

const SESSION_DAYS = 30;

export function googleEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET,
  );
}

export function appleEnabled(): boolean {
  return Boolean(
    process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY &&
      process.env.SESSION_SECRET,
  );
}

export function emailEnabled(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.SESSION_SECRET,
  );
}

export function authEnabled(): boolean {
  return googleEnabled() || appleEnabled() || emailEnabled();
}

// The implicit reader when sign-in is off. Not a database row.
export const LOCAL_USER: User = {
  id: USER_ID,
  email: "local@dissect",
  name: "Local reader",
  picture: "",
  symbol: "",
  color: "",
  passwordHash: "",
  premium: true, // the local reader owns the instance; offline work is not gated
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

// ── Sign in with Apple ──────────────────────────────────────────────────────
// Same code flow with two Apple particulars: the callback arrives as a
// cross-site POST (response_mode form_post — required when scope asks for
// name or email), and the client_secret is a short-lived ES256 JWT signed
// with the developer key, not a stored string.

export function appleAuthUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/apple/callback`,
    response_type: "code",
    scope: "name email",
    response_mode: "form_post",
    state,
  });
  return `https://appleid.apple.com/auth/authorize?${p}`;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

// The client_secret Apple requires: ES256 JWT over the team, key, and
// Services ID, signed with the .p8 key (newlines may arrive escaped).
function appleClientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APPLE_KEY_ID }));
  const payload = b64url(
    JSON.stringify({
      iss: process.env.APPLE_TEAM_ID,
      iat: now,
      exp: now + 600,
      aud: "https://appleid.apple.com",
      sub: process.env.APPLE_CLIENT_ID,
    }),
  );
  const data = `${header}.${payload}`;
  const key = process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const signature = cryptoSign("sha256", Buffer.from(data), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${data}.${b64url(signature)}`;
}

// Apple sends the person's name exactly once — as a `user` JSON field on the
// first authorization's POST. Never again; capture it here or lose it.
export function appleUserName(userField: string | null): string | null {
  if (!userField) return null;
  try {
    const parsed = JSON.parse(userField) as { name?: { firstName?: string; lastName?: string } };
    const name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" ").trim();
    return name || null;
  } catch {
    return null;
  }
}

// Exchange the authorization code with Apple. The id_token arrives directly
// from Apple's token endpoint over TLS, so claims validation suffices, same
// as the Google exchange above. email_verified arrives as a string.
export async function appleExchangeCode(
  origin: string,
  code: string,
): Promise<{ email: string; name: string } | null> {
  let clientSecret: string;
  try {
    clientSecret = appleClientSecret();
  } catch (err) {
    console.error("[auth] apple client secret failed (check APPLE_PRIVATE_KEY):", err);
    return null;
  }
  const res = await outboundFetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID!,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/auth/apple/callback`,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.error("[auth] apple token exchange failed:", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { id_token?: string };
  const payload = data.id_token?.split(".")[1];
  if (!payload) return null;
  type AppleClaims = Omit<IdTokenClaims, "email_verified"> & {
    email_verified?: boolean | string;
  };
  let claims: AppleClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppleClaims;
  } catch {
    return null;
  }
  const issOk = claims.iss === "https://appleid.apple.com";
  const audOk = claims.aud === process.env.APPLE_CLIENT_ID;
  const fresh = (claims.exp ?? 0) * 1000 > Date.now();
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!issOk || !audOk || !fresh || !claims.email || !verified) return null;
  return { email: claims.email, name: claims.email.split("@")[0] };
}

// ── Email sign-in ───────────────────────────────────────────────────────────
// Standard confirmation flow: the form takes a name and an email, a link goes
// to that email, and the account is created only when the link is clicked.
// Tokens are stored hashed, expire after 30 minutes, and are single-use.

const EMAIL_CONFIRM_MINUTES = 30;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
type TokenPurpose = "signup" | "reset";

// Create the pending row for one email and purpose. One outstanding row per
// email and purpose; a request within 60 seconds of the last returns null so
// a refresh cannot flood an inbox.
async function createEmailToken(
  email: string,
  name: string,
  purpose: TokenPurpose,
): Promise<string | null> {
  const recent = await db.emailConfirmation.findFirst({
    where: { email, purpose, createdAt: { gt: new Date(Date.now() - 60_000) } },
    select: { id: true },
  });
  if (recent) return null;

  const token = randomBytes(32).toString("hex");
  await db.emailConfirmation.deleteMany({
    where: { OR: [{ email, purpose }, { expiresAt: { lt: new Date() } }] },
  });
  await db.emailConfirmation.create({
    data: {
      email,
      name,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + EMAIL_CONFIRM_MINUTES * 60_000),
    },
  });
  return token;
}

// Create the pending confirmation and send the email.
export async function startEmailConfirmation(
  origin: string,
  email: string,
  name: string,
  lang: Lang,
): Promise<boolean> {
  const token = await createEmailToken(email, name, "signup");
  if (!token) return true; // one is already on its way
  return sendConfirmationEmail(email, `${origin}/api/auth/email/confirm?token=${token}`, lang);
}

// Redeem the token: delete the row (single-use), reject expired, unknown, or
// wrong-purpose.
export async function confirmEmailToken(
  token: string,
  purpose: TokenPurpose,
): Promise<{ email: string; name: string } | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db.emailConfirmation.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.purpose !== purpose) return null;
  await db.emailConfirmation.delete({ where: { id: row.id } }).catch(() => {});
  if (row.expiresAt < new Date()) return null;
  return { email: row.email, name: row.name };
}

// Check the token without consuming it — the /reset page render.
export async function peekEmailToken(token: string, purpose: TokenPurpose): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const row = await db.emailConfirmation.findUnique({ where: { tokenHash: sha256(token) } });
  return Boolean(row && row.purpose === purpose && row.expiresAt >= new Date());
}

// ── Passwords ───────────────────────────────────────────────────────────────
// scrypt, no dependencies. Stored as "s1$<salt>$<hash>" (hex); "" = the
// account has no password (OAuth or link-only) — Forgot password sets one.

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, SCRYPT_OPTS).toString("hex");
  return `s1$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [tag, salt, hash] = stored.split("$");
  if (tag !== "s1" || !salt || !hash) return false;
  const check = scryptSync(password, salt, 64, SCRYPT_OPTS);
  const expect = Buffer.from(hash, "hex");
  return check.length === expect.length && timingSafeEqual(check, expect);
}

// Email + password → session. "bad" = unknown email or wrong password (one
// answer, no account enumeration); "nopass" = the account exists but has no
// password — the UI points that at Forgot password.
export async function passwordLogin(
  email: string,
  password: string,
): Promise<{ token: string; userId: string; expiresAt: Date } | "bad" | "nopass"> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return "bad";
  if (!user.passwordHash) return "nopass";
  if (!verifyPassword(password, user.passwordHash)) return "bad";
  return createSession(user.id);
}

export async function setPassword(userId: string, password: string): Promise<void> {
  await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(password) } });
}

// Create the pending reset and send the email — only when the account exists.
// The caller answers the same either way (no account enumeration).
export async function startPasswordReset(origin: string, email: string, lang: Lang): Promise<void> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return;
  const token = await createEmailToken(email, "", "reset");
  if (!token) return; // one is already on its way
  await sendResetEmail(email, `${origin}/reset?token=${token}`, lang);
}

// Redeem the reset token: set the new password, sign every other session out,
// mint a fresh one.
export async function resetPassword(
  token: string,
  password: string,
): Promise<{ token: string; userId: string; expiresAt: Date } | null> {
  const pending = await confirmEmailToken(token, "reset");
  if (!pending) return null;
  const user = await db.user.findUnique({ where: { email: pending.email }, select: { id: true } });
  if (!user) return null;
  await setPassword(user.id, password);
  await db.session.deleteMany({ where: { userId: user.id } }).catch(() => {});
  return createSession(user.id);
}

// The session cookie on a 303 redirect — every sign-in path ends here. The
// account cookie rides along: the readable account id open tabs watch, so a
// sign-out or account switch elsewhere in the browser surfaces instead of
// silently taking the tab over.
export function sessionRedirect(
  origin: string,
  session: { token: string; userId: string; expiresAt: Date },
  path = "/",
): NextResponse {
  const res = NextResponse.redirect(new URL(path, origin), 303);
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  res.cookies.set(ACCOUNT_COOKIE, session.userId, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}

// Refresh the account cookie on a plain response — the confirm endpoint uses
// this to heal sessions minted before the cookie existed.
export function setAccountCookie(res: NextResponse, userId: string): void {
  res.cookies.set(ACCOUNT_COOKIE, userId, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
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
    // The profile is the account's own (Settings): a sign-in only fills what
    // is empty, never overwrites a name or picture the person set.
    return db.user.update({
      where: { id: existing.id },
      data: {
        ...(existing.name ? {} : { name: profile.name }),
        ...(existing.picture ? {} : { picture: profile.picture }),
        lastSeenAt: new Date(),
      },
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

export async function createSession(
  userId: string,
): Promise<{ token: string; userId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { token, userId, expiresAt } });
  return { token, userId, expiresAt };
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

// The corpus access gate lives in lib/collab.ts (notebookAccess): owner plus
// collaborators, role-checked per route.
