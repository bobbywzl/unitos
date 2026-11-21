import { NextResponse } from "next/server";
import { setAppChallenge } from "@/lib/app-handoff";
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
  // The app's sign-in sheet (SPEC.md §33): the callback hands the sign-in
  // back to the app instead of setting a session in the sheet.
  setAppChallenge(res, new URL(req.url).searchParams.get("app"), true);
  return res;
}
