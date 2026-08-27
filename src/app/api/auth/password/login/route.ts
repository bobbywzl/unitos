import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, emailEnabled, passwordLogin, sessionRedirect } from "@/lib/auth";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

// Email + password sign-in. Failures answer after a small delay to blunt
// guessing, and land back on /signin?mode=in with the reason.
export async function POST(req: Request) {
  const origin = appOrigin(req);
  if (!emailEnabled()) return NextResponse.redirect(new URL("/", origin), 303);

  const fail = async (reason: string) => {
    await new Promise((r) => setTimeout(r, 300));
    return NextResponse.redirect(
      new URL(`/signin?mode=in&error=${encodeURIComponent(reason)}`, origin),
      303,
    );
  };

  const form = await req.formData().catch(() => null);
  const parsed = Body.safeParse({
    email: form?.get("email")?.toString() ?? "",
    password: form?.get("password")?.toString() ?? "",
  });
  if (!parsed.success) return fail("Enter a valid email");

  const result = await passwordLogin(parsed.data.email, parsed.data.password);
  if (result === "bad") return fail("Wrong email or password");
  if (result === "nopass") {
    return fail("This account has no password yet — use Forgot password to set one");
  }
  return sessionRedirect(origin, result);
}
