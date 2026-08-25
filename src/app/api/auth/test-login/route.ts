import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { appOrigin, authEnabled, createSession, SESSION_COOKIE, upsertUser } from "@/lib/auth";
import { db } from "@/lib/db";

// Token-gated test login for QA runs (Scalae pattern). Sealed unless the
// TEST_LOGIN_TOKEN env var is set — unset (the default and the steady state)
// this route is a 404 and the app has no test door. Rotating or removing the
// token seals it again immediately.
//
//   GET /api/auth/test-login?token=<TEST_LOGIN_TOKEN>&reader=<1-4>
//
// Signs into an isolated, clearly-labeled test account
// (test-reader-<n>@test.local) — never a real account. The first account ever
// adopts the local reader's corpora, so that seat is refused: a test account
// must not take real data.
export async function GET(req: Request) {
  const expected = process.env.TEST_LOGIN_TOKEN;
  if (!expected || !authEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const reader = Math.min(4, Math.max(1, Number(url.searchParams.get("reader")) || 1));
  const first = (await db.user.count()) === 0;
  const user = await upsertUser({
    email: `test-reader-${reader}@test.local`,
    name: `Test reader ${reader}`,
    picture: "",
  });
  // The first account adopted the local reader's corpora in upsertUser —
  // refuse the session so a test account never holds that seat with a cookie.
  if (first) {
    return NextResponse.json(
      { error: "Test login refused: this account is the deployment's first and adopted the local reader's corpora." },
      { status: 409 },
    );
  }
  const session = await createSession(user.id);
  const res = NextResponse.redirect(new URL("/", appOrigin(req)));
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return res;
}
