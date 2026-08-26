import { NextResponse } from "next/server";
import {
  APPLE_STATE_COOKIE,
  appleEnabled,
  appleExchangeCode,
  appleUserName,
  appOrigin,
  SESSION_COOKIE,
  signIn,
  stateValid,
} from "@/lib/auth";

// Apple posts here (response_mode form_post); verify state, exchange the
// code, mint a session. 303 turns the POST into a GET redirect.
export async function POST(req: Request) {
  const origin = appOrigin(req);
  if (!appleEnabled()) return NextResponse.redirect(new URL("/", origin), 303);
  const form = await req.formData().catch(() => null);
  const code = form?.get("code")?.toString() ?? null;
  const state = form?.get("state")?.toString() ?? null;
  const userField = form?.get("user")?.toString() ?? null;
  const cookieState = req.headers
    .get("cookie")
    ?.match(new RegExp(`${APPLE_STATE_COOKIE}=([^;]+)`))?.[1];

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent(reason)}`, origin), 303);

  if (!code) return fail(form?.get("error")?.toString() ?? "Apple returned no code");
  if (!stateValid(state) || !cookieState || decodeURIComponent(cookieState) !== state) {
    return fail("Sign-in state mismatch — try again");
  }

  const profile = await appleExchangeCode(origin, code);
  if (!profile) return fail("Could not verify your Apple identity");

  // The name arrives only on the first authorization; the email local part is
  // the standing fallback.
  const name = appleUserName(userField) ?? profile.name;
  const { session } = await signIn({ email: profile.email, name, picture: "" });
  const res = NextResponse.redirect(new URL("/", origin), 303);
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  res.cookies.set(APPLE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

// A stray GET (bookmark, reload of the POST result) goes back to the door.
export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/signin", appOrigin(req)), 303);
}
