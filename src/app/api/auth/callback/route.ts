import { NextResponse } from "next/server";
import {
  appOrigin,
  googleEnabled,
  exchangeCode,
  sessionRedirect,
  signIn,
  signOut,
  STATE_COOKIE,
  stateValid,
} from "@/lib/auth";
import { appChallenge, appReturn, createAppHandoff } from "@/lib/app-handoff";
import { DRIVE_STATE_COOKIE } from "@/lib/constants";
import { completeDriveLink, cookieValue } from "@/lib/drive/link";

// Google redirects here; verify state, exchange the code, mint a session.
// Link Google Drive (SPEC.md §14) returns here as well — the one redirect
// URI registered on the OAuth client — and is told apart by its own state
// cookie, so a sign-in in flight in another tab cannot be mistaken for it.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  if (!googleEnabled()) return NextResponse.redirect(new URL("/", origin));
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const driveState = cookieValue(req, DRIVE_STATE_COOKIE);
  if (driveState && state === driveState) return completeDriveLink(req, origin);
  const cookieState = req.headers
    .get("cookie")
    ?.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))?.[1];

  // The app started this sign-in (SPEC.md §33, lib/app-handoff.ts): the
  // answer, a handoff or the reason it failed, goes back to the app.
  const app = appChallenge(req);
  const fail = (reason: string) =>
    app
      ? appReturn({ error: reason }, false)
      : NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent(reason)}`, origin));

  if (!code) return fail(url.searchParams.get("error") ?? "Google returned no code");
  if (!stateValid(state) || !cookieState || decodeURIComponent(cookieState) !== state) {
    return fail("Sign-in state mismatch — try again");
  }

  const profile = await exchangeCode(origin, code);
  if (!profile) return fail("Could not verify your Google identity");

  const signed = await signIn(profile);
  if (signed === "blocked") return fail("This email is blocked");
  if (app) {
    // The session signIn made would live in the sheet's browser, where no
    // one asked for it: the app's web view gets its own at the finish route.
    await signOut(signed.session.token);
    const res = appReturn({ token: await createAppHandoff(signed.user.email, app) }, false);
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  const res = sessionRedirect(origin, signed.session);
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
