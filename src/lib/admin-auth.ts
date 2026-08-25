import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverT } from "@/lib/i18n/server";

export const ADMIN_COOKIE = "admin-auth";

// Password cookie gate (release-edu pattern, single admin in v1).
// Returns a response to send when the caller is not an admin, else null.
export async function adminApiGuard(): Promise<NextResponse | null> {
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (cookie !== "true") {
    const t = await serverT();
    return NextResponse.json({ error: t("common.unauthorized") }, { status: 401 });
  }
  return null;
}

export async function isAdmin(): Promise<boolean> {
  return (await cookies()).get(ADMIN_COOKIE)?.value === "true";
}
