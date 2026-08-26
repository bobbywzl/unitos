import { NextResponse } from "next/server";
import {
  appOrigin,
  googleEnabled,
  exchangeCode,
  SESSION_COOKIE,
  signIn,
  STATE_COOKIE,
  stateValid,
} from "@/lib/auth";

// Google redirects here; verify state, exchange the code, mint a session.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  if (!googleEnabled()) return NextResponse.redirect(new URL("/", origin));
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.headers
    .get("cookie")
    ?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent(reason)}`, origin));

  if (!code) return fail(url.searchParams.get("error") ?? "Google returned no code");
  if (!stateValid(state) || !cookieState || decodeURIComponent(cookieState) !== state) {
    return fail("Sign-in state mismatch — try again");
  }

  const profile = await exchangeCode(origin, code);
  if (!profile) return fail("Could not verify your Google identity");

  const { session } = await signIn(profile);
  const res = NextResponse.redirect(new URL("/", origin));
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
