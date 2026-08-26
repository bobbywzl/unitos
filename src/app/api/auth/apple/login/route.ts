import { NextResponse } from "next/server";
import { APPLE_STATE_COOKIE, appleAuthUrl, appleEnabled, appOrigin, newState } from "@/lib/auth";

// Start the Apple sign-in flow: redirect to Apple's consent screen. The state
// cookie is SameSite=None because Apple returns the callback as a cross-site
// POST (form_post) — a Lax cookie would not ride along.
export async function GET(req: Request) {
  if (!appleEnabled()) return NextResponse.redirect(new URL("/", appOrigin(req)));
  const state = newState();
  const res = NextResponse.redirect(appleAuthUrl(appOrigin(req), state));
  res.cookies.set(APPLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 600,
  });
  return res;
}
