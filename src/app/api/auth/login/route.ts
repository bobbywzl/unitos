import { NextResponse } from "next/server";
import { setAppChallenge, validChallenge } from "@/lib/app-handoff";
import { appOrigin, googleAuthUrl, googleEnabled, newState, STATE_COOKIE } from "@/lib/auth";

// Start the Google sign-in flow: redirect to Google's consent screen.
// ?app=<challenge>: the app started it (lib/app-handoff.ts).
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
  // The app's sign-in sheet (SPEC.md §33): the callback hands the sign-in
  // back to the app instead of setting a session in the sheet.
  const app = new URL(req.url).searchParams.get("app");
  if (validChallenge(app)) setAppChallenge(res, app, false);
  return res;
}
