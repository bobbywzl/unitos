import { NextResponse } from "next/server";
import { appOrigin, confirmEmailToken, emailEnabled, sessionRedirect, signIn } from "@/lib/auth";

// The link in the confirmation email lands here. Redeem the token, create the
// account (this is the moment the user becomes a user), mint a session, and
// land on /welcome to set a password.
export async function GET(req: Request) {
  const origin = appOrigin(req);
  if (!emailEnabled()) return NextResponse.redirect(new URL("/", origin), 303);

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const pending = await confirmEmailToken(token, "signup");
  if (!pending) {
    return NextResponse.redirect(
      new URL(
        `/signin?error=${encodeURIComponent("Confirmation link expired or already used — request a new one")}`,
        origin,
      ),
      303,
    );
  }

  // The email local part is the standing fallback when the form left name empty.
  const name = pending.name || pending.email.split("@")[0];
  const { session } = await signIn({ email: pending.email, name, picture: "" });
  return sessionRedirect(origin, session, "/welcome");
}
