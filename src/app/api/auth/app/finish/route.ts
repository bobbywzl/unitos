import { NextResponse } from "next/server";
import { redeemAppHandoff } from "@/lib/app-handoff";
import { appOrigin, createSession, sessionRedirect } from "@/lib/auth";
import { emailBlocked } from "@/lib/block";
import { db } from "@/lib/db";

// The last step of the app's sign-in (SPEC.md §33, lib/app-handoff.ts): the
// app's web view opens this address with the token the sign-in sheet ended
// on and the verifier the app kept. The handoff is redeemed, once, and the
// session cookie is set here, in the web view. Every failure goes to the
// sign-in page with its reason, as the other sign-in doors do.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const params = new URL(req.url).searchParams;
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent(reason)}`, origin), 303);

  const email = await redeemAppHandoff(params.get("token") ?? "", params.get("verifier") ?? "");
  if (!email) return fail("Sign-in expired or already used — try again");
  if (await emailBlocked(email)) return fail("This email is blocked");
  // The callback made or found the account a moment ago.
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return fail("Sign-in expired or already used — try again");
  return sessionRedirect(origin, await createSession(user.id), "/");
}
