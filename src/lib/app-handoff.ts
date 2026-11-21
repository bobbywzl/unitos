import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { APP_SCHEME } from "@/lib/app-shell";
import { APP_SIGNIN_COOKIE } from "@/lib/constants";
import { db } from "@/lib/db";

// Sign-in for the app (SPEC.md §33). Google refuses to sign anyone in inside
// an app's web view, so the app runs Google's and Apple's sign-in in the
// system's sign-in sheet, which is the system browser: the session cookie
// the callback would set lands in that browser, not in the app. The handoff
// carries the sign-in across:
//
// 1. The app makes a random verifier and opens the sheet at
//    /api/auth/login?app=<challenge> (or /api/auth/apple/login), where the
//    challenge is the verifier's SHA-256 in base64url. The route keeps the
//    challenge in a cookie beside the state cookie.
// 2. The callback, with that cookie, sets no session in the sheet. It stores
//    a handoff — a single-use token, two minutes — and ends at
//    unitos://signed-in?token=…, which closes the sheet and returns to the
//    app.
// 3. The app's web view opens /api/auth/app/finish?token=…&verifier=…. The
//    route redeems the handoff and sets the session cookie in the web view.
//
// The token alone signs no one in: the finish route also needs the verifier,
// which never left the app. The handoff is an EmailConfirmation row with
// purpose "app" (the row every other sign-in link uses: hashed, single-use,
// expiring), so the email routes, which ask for their own purpose, refuse it.

//
// The switch. `unitos://` is a custom scheme, and any app on a device can
// claim one. Someone who got a person to install such an app, and then to
// follow a link to /api/auth/login?app=<their own challenge> and sign in,
// could receive the token there and redeem it with their own verifier. So
// the handoff is off until APP_SIGNIN=on is set, which the owner does when
// the app is released: with it off, ?app= is ignored and every sign-in door
// does what it always did. The stronger door, for a later version of the
// app, is an https address the app claims through its associated domain
// (iOS 17.4, ASWebAuthenticationSession's https callback), which no other
// app can claim.

const HANDOFF_SECONDS = 120;

/** Whether the app's sign-in handoff is offered (APP_SIGNIN=on). */
export function appSignInOn(): boolean {
  return process.env.APP_SIGNIN === "on";
}
const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** A challenge as the app sends it: 32 bytes of SHA-256 in base64url. */
export function validChallenge(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The challenge of a verifier: what the app computed before it opened the sheet. */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const rowHash = (token: string, challenge: string) => sha256Hex(`${token}.${challenge}`);

/** Store a handoff for the account that just signed in; the token to send back to the app. */
export async function createAppHandoff(email: string, challenge: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  // One outstanding handoff per email; expired rows of any purpose go, as
  // they do when an email link is made (lib/auth.ts createEmailToken).
  await db.emailConfirmation.deleteMany({
    where: { OR: [{ email, purpose: "app" }, { expiresAt: { lt: new Date() } }] },
  });
  await db.emailConfirmation.create({
    data: {
      email,
      purpose: "app",
      tokenHash: rowHash(token, challenge),
      expiresAt: new Date(Date.now() + HANDOFF_SECONDS * 1000),
    },
  });
  return token;
}

/** Redeem a handoff: the email it was made for, once, within two minutes,
    and only with the verifier of the challenge it was made with. */
export async function redeemAppHandoff(token: string, verifier: string): Promise<string | null> {
  if (!appSignInOn()) return null;
  if (!/^[0-9a-f]{64}$/.test(token) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return null;
  const row = await db.emailConfirmation.findUnique({
    where: { tokenHash: rowHash(token, challengeOf(verifier)) },
  });
  if (!row || row.purpose !== "app") return null;
  await db.emailConfirmation.delete({ where: { id: row.id } }).catch(() => {});
  if (row.expiresAt < new Date()) return null;
  return row.email;
}

/** The challenge the sign-in started with, when the app started it. */
export function appChallenge(req: Request): string | null {
  if (!appSignInOn()) return null;
  const value = req.headers.get("cookie")?.match(new RegExp(`(?:^|; )${APP_SIGNIN_COOKIE}=([^;]+)`))?.[1];
  return validChallenge(value) ? value : null;
}

/** Remember that the app started this sign-in, when the handoff is on and
    the challenge is one. `crossSite`: Apple answers with a cross-site POST,
    which carries a SameSite=None cookie only. */
export function setAppChallenge(res: NextResponse, challenge: string | null, crossSite: boolean): void {
  if (!appSignInOn() || !validChallenge(challenge)) return;
  res.cookies.set(APP_SIGNIN_COOKIE, challenge, {
    httpOnly: true,
    secure: crossSite || process.env.NODE_ENV === "production",
    sameSite: crossSite ? "none" : "lax",
    path: "/",
    maxAge: 600,
  });
}

/** Back to the app: the sheet closes on this address. */
export function appReturn(params: { token: string } | { error: string }, crossSite: boolean): NextResponse {
  const url = `${APP_SCHEME}://signed-in?${new URLSearchParams(params).toString()}`;
  // 303 turns Apple's POST into a GET of the app's address.
  const res = new NextResponse(null, { status: 303, headers: { Location: url } });
  res.cookies.set(APP_SIGNIN_COOKIE, "", {
    path: "/",
    maxAge: 0,
    ...(crossSite ? { secure: true, sameSite: "none" as const } : {}),
  });
  return res;
}
