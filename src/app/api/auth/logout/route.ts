import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE, appOrigin, SESSION_COOKIE, signOut } from "@/lib/auth";

// Delete the session and return to /signin.
export async function GET(req: Request) {
  const token = req.headers.get("cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  await signOut(token);
  const res = NextResponse.redirect(new URL("/signin", appOrigin(req)));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(ACCOUNT_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
