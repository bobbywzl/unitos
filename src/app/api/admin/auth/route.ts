import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, ADMIN_COOKIE_MAX_AGE, signAdminCookie } from "@/lib/admin-cookie";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const loginSchema = z.object({ password: z.string().min(1).max(500) });

// Both sides are hashed first, so the constant-time compare also hides the
// password's length.
const digest = (text: string) => createHash("sha256").update(text).digest();

// Admin password login. No hardcoded fallback: unset password means admin is off.
// The cookie is signed with the password (lib/admin-cookie.ts).
export async function POST(req: Request) {
  const t = await serverT();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: t("api.adminNotConfigured") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, loginSchema);
  if (error) return error;
  if (!timingSafeEqual(digest(data.password), digest(adminPassword))) {
    return NextResponse.json({ error: t("api.invalidPassword") }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, await signAdminCookie(adminPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_COOKIE_MAX_AGE,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
