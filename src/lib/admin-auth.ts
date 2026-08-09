import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const ADMIN_COOKIE = "admin-auth";

// Password cookie gate (release-edu pattern, single admin in v1).
// Returns a response to send when the caller is not an admin, else null.
export async function adminApiGuard(): Promise<NextResponse | null> {
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (cookie !== "true") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function isAdmin(): Promise<boolean> {
  return (await cookies()).get(ADMIN_COOKIE)?.value === "true";
}
