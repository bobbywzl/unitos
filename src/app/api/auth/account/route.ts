import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE, authEnabled, currentUser, setAccountCookie } from "@/lib/auth";

// The tab's authority on who is signed in. Open tabs compare the readable
// account cookie against the account they were rendered for and confirm a
// mismatch here before showing the account-changed notice. The response also
// re-stamps the cookie, healing sessions minted before the cookie existed.
export async function GET() {
  if (!authEnabled()) return NextResponse.json({ id: null, name: null });
  const user = await currentUser();
  if (!user) {
    const res = NextResponse.json({ id: null, name: null }, { status: 401 });
    res.cookies.set(ACCOUNT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  const res = NextResponse.json({ id: user.id, name: user.name });
  setAccountCookie(res, user.id);
  return res;
}
