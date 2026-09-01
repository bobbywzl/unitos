import { NextResponse } from "next/server";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { driveLinkEnabled, mintDriveAccessToken } from "@/lib/drive/link";
import { serverT } from "@/lib/i18n/server";

// A short-lived Drive access token minted from the linked account's refresh
// token (SPEC.md §14). The picker uses it instead of asking for a per-visit
// grant. 401 with linked false = not linked, or the grant was revoked at
// Google (then the stored token clears here) — the client falls back to the
// per-visit grant.
export async function POST() {
  const t = await serverT();
  const user = await currentUser();
  if (!authEnabled() || !user) {
    return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  }
  if (!driveLinkEnabled()) {
    return NextResponse.json({ error: t("api.driveNotLinked"), linked: false }, { status: 401 });
  }
  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { driveRefreshToken: true },
  });
  if (!row?.driveRefreshToken) {
    return NextResponse.json({ error: t("api.driveNotLinked"), linked: false }, { status: 401 });
  }
  const minted = await mintDriveAccessToken(row.driveRefreshToken);
  if (minted === "revoked") {
    await db.user.update({ where: { id: user.id }, data: { driveRefreshToken: "" } });
    return NextResponse.json({ error: t("api.driveNotLinked"), linked: false }, { status: 401 });
  }
  if (!minted) {
    return NextResponse.json({ error: t("api.driveTokenMintFailed") }, { status: 502 });
  }
  return NextResponse.json({ token: minted.token });
}
