import { NextResponse } from "next/server";
import { appOrigin, authEnabled, currentUser, newState } from "@/lib/auth";
import { DRIVE_RETURN_COOKIE, DRIVE_STATE_COOKIE } from "@/lib/constants";
import { db } from "@/lib/db";
import { driveLinkAuthUrl, driveLinkEnabled, revokeDriveToken } from "@/lib/drive/link";
import { serverT } from "@/lib/i18n/server";

// Link Google Drive (SPEC.md §14). GET starts the drive.file code flow for the
// signed-in account and returns to `next` after the callback; DELETE unlinks —
// revoke at Google, clear the stored refresh token.

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
};

export async function GET(req: Request) {
  const origin = appOrigin(req);
  const user = await currentUser();
  if (!driveLinkEnabled() || !authEnabled() || !user) {
    return NextResponse.redirect(new URL("/", origin));
  }
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/settings";
  // Same-origin paths only — never an open redirect.
  const returnPath = next.startsWith("/") && !next.startsWith("//") ? next : "/settings";
  const state = newState();
  const res = NextResponse.redirect(driveLinkAuthUrl(origin, state, user.email));
  res.cookies.set(DRIVE_STATE_COOKIE, state, cookieOpts);
  res.cookies.set(DRIVE_RETURN_COOKIE, returnPath, cookieOpts);
  return res;
}

export async function DELETE() {
  const t = await serverT();
  const user = await currentUser();
  if (!authEnabled() || !user) {
    return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  }
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { driveRefreshToken: true },
  });
  if (row?.driveRefreshToken) {
    await revokeDriveToken(row.driveRefreshToken);
    await db.user.update({ where: { id: user.id }, data: { driveRefreshToken: "" } });
  }
  return NextResponse.json({ linked: false });
}
