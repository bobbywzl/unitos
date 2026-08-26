import { NextResponse } from "next/server";
import { appOrigin, googleAuthUrl, googleEnabled, newState, STATE_COOKIE } from "@/lib/auth";

// Start the Google sign-in flow: redirect to Google's consent screen.
export async function GET(req: Request) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/", appOrigin(req)));
  const state = newState();
  const res = NextResponse.redirect(googleAuthUrl(appOrigin(req), state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
