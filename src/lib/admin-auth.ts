import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_COOKIE, verifyAdminCookie } from "@/lib/admin-cookie";
import { serverT } from "@/lib/i18n/server";

// Password cookie gate (release-edu pattern, single admin in v1). The cookie
// is signed (lib/admin-cookie.ts): a forged or expired one fails here.
// Returns a response to send when the caller is not an admin, else null.
export async function adminApiGuard(): Promise<NextResponse | null> {
  if (!(await isAdmin())) {
    const t = await serverT();
    return NextResponse.json({ error: t("common.unauthorized") }, { status: 401 });
  }
  return null;
}

export async function isAdmin(): Promise<boolean> {
  return verifyAdminCookie((await cookies()).get(ADMIN_COOKIE)?.value);
}
