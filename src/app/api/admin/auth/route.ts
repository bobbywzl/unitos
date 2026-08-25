import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE } from "@/lib/admin-auth";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

const loginSchema = z.object({ password: z.string().min(1).max(500) });

// Admin password login. No hardcoded fallback: unset password means admin is off.
export async function POST(req: Request) {
  const t = await serverT();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: t("api.adminNotConfigured") }, { status: 503 });
  }
  const { data, error } = await parseBody(req, loginSchema);
  if (error) return error;
  if (data.password !== adminPassword) {
    return NextResponse.json({ error: t("api.invalidPassword") }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "true", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
