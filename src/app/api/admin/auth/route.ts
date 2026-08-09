import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE } from "@/lib/admin-auth";
import { parseBody } from "@/lib/validate";

const loginSchema = z.object({ password: z.string().min(1).max(500) });

// Admin password login. No hardcoded fallback: unset password means admin is off.
export async function POST(req: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: "Admin login is not configured (ADMIN_PASSWORD unset)." },
      { status: 503 },
    );
  }
  const { data, error } = await parseBody(req, loginSchema);
  if (error) return error;
  if (data.password !== adminPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
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
