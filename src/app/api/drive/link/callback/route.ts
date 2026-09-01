import { NextResponse } from "next/server";
import { appOrigin, authEnabled, currentUser, stateValid } from "@/lib/auth";
import { DRIVE_RETURN_COOKIE, DRIVE_STATE_COOKIE } from "@/lib/constants";
import { db } from "@/lib/db";
import { driveLinkEnabled, exchangeDriveLinkCode } from "@/lib/drive/link";

// Google redirects here after the Link Google Drive consent (SPEC.md §14):
// verify state, exchange the code, store the refresh token on the account,
// return to where linking started. ?drive=linked / ?drive=link-failed tells
// the opener how it went.

function cookieValue(req: Request, name: string): string | null {
  const value = req.headers.get("cookie")?.match(new RegExp(`${name}=([^;]+)`))?.[1];
  return value ? decodeURIComponent(value) : null;
}

export async function GET(req: Request) {
  const origin = appOrigin(req);
  const user = await currentUser();
  const returnPath = cookieValue(req, DRIVE_RETURN_COOKIE) ?? "/settings";
  const target = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/settings";

  const finish = (result: "linked" | "link-failed") => {
    const url = new URL(target, origin);
    url.searchParams.set("drive", result);
    const res = NextResponse.redirect(url);
    res.cookies.set(DRIVE_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(DRIVE_RETURN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  if (!driveLinkEnabled() || !authEnabled() || !user) return finish("link-failed");
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = cookieValue(req, DRIVE_STATE_COOKIE);
  if (!code || !stateValid(state) || !cookieState || cookieState !== state) {
    return finish("link-failed");
  }

  const refreshToken = await exchangeDriveLinkCode(origin, code);
  if (!refreshToken) return finish("link-failed");
  await db.user.update({ where: { id: user.id }, data: { driveRefreshToken: refreshToken } });
  return finish("linked");
}
